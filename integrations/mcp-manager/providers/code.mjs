import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { runCommand } from '../lib/command-runner.mjs';

async function git(repo, args, options = {}) {
  return runCommand('git', ['-C', repo, ...args], { timeoutMs: 15000, maxOutput: 24000, ...options });
}

async function requireGitRepo(repo) {
  const result = await git(repo, ['rev-parse', '--show-toplevel'], { maxOutput: 1000 });
  if (!result.ok) throw new Error('not_a_git_repository');
  return result.output.trim();
}

function summary(result) {
  return { ok: result.ok, exitCode: result.code, output: result.output,
    truncated: result.truncated, timedOut: result.timedOut };
}

async function repoInspect(repo) {
  const [branch, head, status, files, manifestRaw] = await Promise.all([
    git(repo, ['branch', '--show-current'], { maxOutput: 200 }),
    git(repo, ['rev-parse', 'HEAD'], { maxOutput: 100 }),
    git(repo, ['status', '--short', '-uno'], { maxOutput: 14000 }),
    fs.readdir(repo).then(entries => entries.slice(0, 100)).catch(() => []),
    fs.readFile(path.join(repo, 'package.json'), 'utf8').catch(() => null),
  ]);
  let scripts = {};
  if (typeof manifestRaw === 'string' && manifestRaw.length < 65536) {
    try {
      const parsed = JSON.parse(manifestRaw);
      if (parsed.scripts && typeof parsed.scripts === 'object') {
        scripts = Object.fromEntries(Object.keys(parsed.scripts).slice(0, 50).map(k => [k, '<defined>']));
      }
    } catch { /* repositories without valid JSON package.json are normal */ }
  }
  return { branch: branch.output.trim(), head: head.output.trim(),
    clean: status.ok && !status.output.trim(), modifiedFiles: status.output.split(/\r?\n/).filter(Boolean).slice(0, 200),
    statusTruncated: status.truncated, manifests: files.filter(f =>
      /^(AGENTS\.md|package\.json|pyproject\.toml|go\.mod|Cargo\.toml|.*\.sln|wrangler\.jsonc|requirements\.txt)$/i.test(f)), scripts };
}

async function codeDiagnostics(repo, signal) {
  const [diff, changed] = await Promise.all([
    git(repo, ['diff', '--check', 'HEAD', '--'], { signal, maxOutput: 9000 }),
    git(repo, ['diff', '--name-only', '-z', 'HEAD', '--'], { signal, maxOutput: 30000 }),
  ]);
  if (!changed.ok) throw new Error('git_diff_failed');
  const rawEntries = changed.output
    .split('\0')
    .flatMap(entry => entry.split(/\r?\n/))
    .map(entry => entry.trim())
    .filter(Boolean)
    .filter(entry => !entry.startsWith('warning:'));
  const uniqueFiles = [...new Set(rawEntries)].filter(f => /\.(mjs|cjs|js)$/.test(f));
  const files = uniqueFiles.slice(0, 25);
  const canonicalRepo = await fs.realpath(repo);
  const syntax = await Promise.all(files.map(async file => {
    const absolute = path.resolve(canonicalRepo, file);
    const relative = path.relative(canonicalRepo, absolute);
    if (relative === '..' || relative.startsWith('..' + path.sep)) {
      return { file, ok: false, error: 'file_resolves_outside_repository_or_is_missing' };
    }
    const canonical = await fs.realpath(absolute).catch(() => null);
    const inside = canonical && path.relative(canonicalRepo, canonical);
    if (!inside || inside === '..' || inside.startsWith('..' + path.sep) || path.isAbsolute(inside)) {
      return { file, ok: false, error: 'file_resolves_outside_repository_or_is_missing' };
    }
    const checked = await runCommand(process.execPath, ['--check', canonical], { signal, timeoutMs: 8000, maxOutput: 4000 });
    return { file, ...summary(checked) };
  }));
  return { whitespace: summary(diff), syntax, moreFilesSkipped: uniqueFiles.length > 25,
    note: 'No package scripts, tests or application modules were executed.' };
}

async function reviewDiff(repo, args) {
  const base = args.base ?? 'HEAD';
  if (typeof base !== 'string' || !/^[a-zA-Z0-9_./-]{1,80}$/.test(base) || base.startsWith('-') || base.includes('..')) {
    throw new Error('invalid_base_ref');
  }
  const [check, stat, patch] = await Promise.all([
    git(repo, ['diff', '--check', base, '--'], { maxOutput: 4000 }),
    git(repo, ['diff', '--stat', base, '--'], { maxOutput: 4000 }),
    git(repo, ['diff', '--unified=2', base, '--'], { maxOutput: 25000 }),
  ]);
  return { base, whitespace: summary(check), statistics: summary(stat), patch: summary(patch),
    note: 'Review evidence, not an automated claim that the patch is correct or secure.' };
}

async function searchCode(repo, args, declarations) {
  const word = declarations ? args.query : args.symbol;
  if (typeof word !== 'string' || !/^[a-zA-Z_$][a-zA-Z0-9_$]{0,79}$/.test(word)) throw new Error('invalid_identifier');
  const pattern = declarations ? `(^|[[:space:]])(export[[:space:]]+)?(async[[:space:]]+)?(function|class|def|interface|type|const|let|var)[[:space:]]+${word}([^a-zA-Z0-9_$]|$)` : word;
  const argsGit = declarations ? ['grep', '-n', '-E', '-e', pattern, '--'] : ['grep', '-n', '-F', '-e', pattern, '--'];
  const result = await git(repo, argsGit, { timeoutMs: 15000, maxOutput: 18000 });
  if (![0, 1].includes(result.code)) throw new Error('git_search_failed');
  return { identifier: word, matches: result.output.split(/\r?\n/).filter(Boolean).slice(0, 150), truncated: result.truncated };
}

async function runTest(repo, args, signal) {
  const commands = {
    'npm-test': ['npm', ['test']],
    'npm-lint': ['npm', ['run', 'lint', '--if-present']],
    'pytest': ['python', ['-m', 'pytest', '-q']],
    'git-diff-check': ['git', ['-C', repo, 'diff', '--check', 'HEAD', '--']],
  };
  const selected = commands[args.command];
  if (!selected) throw new Error('unsupported_test_command');
  const result = await runCommand(selected[0], selected[1], { cwd: repo, signal, timeoutMs: 60000, maxOutput: 24000 });
  return { command: args.command, ...summary(result),
    warning: result.timedOut ? 'The command timed out; descendant processes may require separate inspection.' : undefined };
}

async function checkedPatch(repo, args) {
  if (typeof args.patch !== 'string' || args.patch.length < 10 || args.patch.length > 20000 ||
      typeof args.expectedHead !== 'string' || !/^[a-f0-9]{40}$/.test(args.expectedHead) ||
      typeof args.apply !== 'boolean') throw new Error('invalid_patch_request');
  const head = await git(repo, ['rev-parse', 'HEAD'], { maxOutput: 100 });
  if (!head.ok || head.output.trim() !== args.expectedHead) throw new Error('head_changed_reinspect_before_editing');
  const check = await git(repo, ['apply', '--check', '-'], { stdin: args.patch, maxOutput: 5000 });
  if (!check.ok) return { applied: false, check: summary(check) };
  if (!args.apply) return { applied: false, check: summary(check), dryRun: true };
  const apply = await git(repo, ['apply', '-'], { stdin: args.patch, maxOutput: 5000 });
  return { applied: apply.ok, check: summary(check), apply: summary(apply) };
}

async function createWorktree(repo, args, config) {
  if (typeof args.name !== 'string' || !/^[a-z][a-z0-9-]{1,39}$/.test(args.name)) throw new Error('invalid_worktree_name');
  const canonical = await fs.realpath(repo);
  const folder = path.basename(canonical).replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 25);
  const digest = createHash('sha256').update(canonical).digest('hex').slice(0, 12);
  const parent = path.join(config.stateDirectory, 'worktrees', folder + '-' + digest);
  await fs.mkdir(parent, { recursive: true, mode: 0o700 });
  const destination = path.join(parent, args.name);
  try { await fs.lstat(destination); throw new Error('worktree_path_exists'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const branch = 'mterm/' + args.name;
  const result = await git(repo, ['worktree', 'add', '-b', branch, destination, 'HEAD'], { timeoutMs: 30000, maxOutput: 4000 });
  return { created: result.ok, branch, destination: result.ok ? destination : null, ...summary(result),
    note: 'New worktrees use a separate branch; the original repository was not switched.' };
}

export async function codeOperation(name, args, repo, config, signal) {
  const topLevel = await requireGitRepo(repo);
  if (path.resolve(topLevel).toLowerCase() !== path.resolve(repo).toLowerCase()) {
    throw new Error('select_the_repository_root');
  }
  switch (name) {
    case 'mterm_repo_inspect': return repoInspect(repo);
    case 'mterm_code_diagnostics': return codeDiagnostics(repo, signal);
    case 'mterm_code_review_diff': return reviewDiff(repo, args);
    case 'mterm_code_symbols': return searchCode(repo, args, true);
    case 'mterm_code_references': return searchCode(repo, args, false);
    case 'mterm_test_run': return runTest(repo, args, signal);
    case 'mterm_patch_apply_checked': return checkedPatch(repo, args);
    case 'mterm_git_worktree_create': return createWorktree(repo, args, config);
    default: throw new Error('unknown_code_operation');
  }
}
