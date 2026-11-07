import { readToolkit, allowedRepository } from './toolkit-config.mjs';
import { mathOperation } from '../providers/math.mjs';
import { vmOperation, systemOperation } from '../providers/infrastructure.mjs';
import { codeOperation } from '../providers/code.mjs';
import { submitJob, jobStatus, jobLogs, cancelJob, resumeJob } from './jobs.mjs';

const str = (description, maxLength = 500) => ({ type: 'string', description, maxLength });
const int = (description, minimum, maximum) => ({ type: 'integer', description, minimum, maximum });
const bool = description => ({ type: 'boolean', description });
const tool = (name, description, properties = {}, required = [], readonly = true) => ({
  name, description, annotations: { readOnlyHint: readonly, destructiveHint: !readonly },
  inputSchema: { type: 'object', properties, required, additionalProperties: false },
});
const root = { rootId: str('Configured local repository root identifier', 32), relativePath: str('Relative directory inside the configured root; defaults to .', 512) };
const vm = { name: str('Exact local Hyper-V virtual machine name', 80) };

export const ENGINEERING_TOOLS = Object.freeze([
  tool('mterm_math_evaluate', 'Safely simplify and numerically evaluate a mathematical expression using isolated SymPy.', { expression: str('Math expression, e.g. sqrt(2)+1'), precision: int('Decimal digits', 8, 100) }, ['expression']),
  tool('mterm_math_solve', 'Solve an algebraic equation for one variable without executing Python code.', { equation: str('Equation such as x^2=4'), variable: str('Variable to solve for', 16) }, ['equation', 'variable']),
  tool('mterm_math_verify', 'Check symbolic equivalence of two expressions.', { left: str('First expression'), right: str('Second expression') }, ['left', 'right']),
  tool('mterm_math_convert_units', 'Convert supported length, mass, time and temperature units with decimal arithmetic.', { value: str('Decimal numeric value', 80), from: str('Source unit', 12), to: str('Target unit', 12) }, ['value', 'from', 'to']),
  tool('mterm_system_inventory', 'Inspect host OS, CPU, RAM, logical disks and GPU model without modifying configuration.'),
  tool('mterm_container_list', 'Inspect Docker containers and WSL distributions without changing them.'),
  tool('mterm_vm_list', 'List local Hyper-V VMs with state and resource allocation.'),
  tool('mterm_vm_inspect', 'Inspect one Hyper-V VM configuration, adapters, attached disks, and checkpoints.', vm, ['name']),
  tool('mterm_vm_network_map', 'Inspect Hyper-V virtual switches and VM network adapters.'),
  tool('mterm_vm_disk_health', 'Report attached Hyper-V virtual disk paths and allocated VHDX sizes.'),
  tool('mterm_vm_diagnostics', 'Read recent Hyper-V event log warnings and errors.', { hours: int('Lookback hours', 1, 168) }),
  tool('mterm_vm_change_plan', 'Preview a proposed VM power or checkpoint operation; does not execute it.', { ...vm, action: { type: 'string', enum: ['start', 'shutdown', 'checkpoint'] } }, ['name', 'action']),
  tool('mterm_vm_start', 'Start a Hyper-V VM after an exact-name confirmation and explicit VM power permission.', { ...vm, confirmName: str('Repeat the exact VM name to confirm', 80) }, ['name', 'confirmName'], false),
  tool('mterm_vm_shutdown', 'Request a graceful guest shutdown; never force-turns off a VM.', { ...vm, confirmName: str('Repeat the exact VM name to confirm', 80) }, ['name', 'confirmName'], false),
  tool('mterm_vm_checkpoint_create', 'Create a production checkpoint of a VM, never restore or remove checkpoints.', { ...vm, confirmName: str('Repeat the exact VM name to confirm', 80) }, ['name', 'confirmName'], false),
  tool('mterm_repo_inspect', 'Inspect repository branch, cleanliness, scripts and development entry points.', root, ['rootId']),
  tool('mterm_code_diagnostics', 'Run non-executing diff and JavaScript syntax checks on changed files.', root, ['rootId']),
  tool('mterm_code_review_diff', 'Return a bounded, evidence-based Git diff and whitespace diagnostics.', { ...root, base: str('Optional Git base ref; defaults to HEAD', 80) }, ['rootId']),
  tool('mterm_code_symbols', 'Locate code declarations in tracked project files.', { ...root, query: str('Function, class or identifier to locate', 80) }, ['rootId', 'query']),
  tool('mterm_code_references', 'Find tracked references to an identifier without executing project code.', { ...root, symbol: str('Exact identifier to search', 80) }, ['rootId', 'symbol']),
  tool('mterm_test_run', 'Run a configured repository test command after test-execution permission is enabled.', { ...root, command: { type: 'string', enum: ['npm-test', 'npm-lint', 'pytest', 'git-diff-check'] } }, ['rootId', 'command'], false),
  tool('mterm_patch_apply_checked', 'Check Git patch application; applies only when apply=true and repository-write permission is enabled.', { ...root, patch: str('Unified diff', 20000), expectedHead: str('Expected 40-character HEAD SHA', 40), apply: bool('Actually apply the patch; false validates only') }, ['rootId', 'patch', 'expectedHead', 'apply'], false),
  tool('mterm_git_worktree_create', 'Create a separate named Git worktree on a new branch under the manager worktree directory.', { ...root, name: str('Unique lowercase worktree name, e.g. sprint-one', 40) }, ['rootId', 'name'], false),
  tool('mterm_job_submit', 'Queue one persistent, allowlisted diagnostics/test/VM inventory job with a durable ID.', { kind: { type: 'string', enum: ['repo_diagnostics', 'run_tests', 'vm_inventory'] }, ...root, command: { type: 'string', enum: ['npm-test', 'npm-lint', 'pytest', 'git-diff-check'] } }, ['kind'], false),
  tool('mterm_job_status', 'Read durable status of a previously submitted job.', { id: str('Job UUID', 36) }, ['id']),
  tool('mterm_job_logs', 'Retrieve bounded result evidence for a finished job.', { id: str('Job UUID', 36) }, ['id']),
  tool('mterm_job_cancel', 'Cancel a queued job or request controlled cancellation of a running job.', { id: str('Job UUID', 36) }, ['id'], false),
  tool('mterm_job_resume', 'Explicitly requeue an interrupted or failed job; never automatic retry.', { id: str('Job UUID', 36), confirm: bool('I verified the previous outcome before requeueing') }, ['id', 'confirm'], false),
]);

const capabilities = {
  math: /^mterm_math_/, systemRead: /^mterm_(system_|container_)/,
  vmRead: /^mterm_vm_(list|inspect|network_map|disk_health|diagnostics|change_plan)$/,
  vmPower: /^mterm_vm_(start|shutdown|checkpoint_create)$/,
  codeRead: /^mterm_(repo_inspect|code_)/,
  testRun: /^mterm_test_run$/,
  repoWrite: /^mterm_(patch_apply_checked|git_worktree_create)$/,
  jobs: /^mterm_job_/,
};

export const READ_ONLY_ENGINEERING_TOOLS = Object.freeze(ENGINEERING_TOOLS.filter(t => t.annotations.readOnlyHint).map(t => t.name));
const names = new Set(ENGINEERING_TOOLS.map(t => t.name));
export const isEngineeringTool = name => names.has(name);

export async function executeEngineeringTool(config, name, args = {}) {
  try {
    if (!isEngineeringTool(name)) throw new Error('unknown_engineering_tool');
    if (args === null || typeof args !== 'object' || Array.isArray(args)) throw new Error('invalid_arguments');
    const descriptor = ENGINEERING_TOOLS.find(t => t.name === name);
    for (const key of Object.keys(args)) if (!Object.hasOwn(descriptor.inputSchema.properties, key)) throw new Error('unsupported_argument');
    for (const key of descriptor.inputSchema.required) if (args[key] === undefined) throw new Error('missing_required_argument');
    const settings = await readToolkit(config);
    const capability = Object.keys(capabilities).find(k => capabilities[k].test(name));
    if (!capability || (!settings.capabilities[capability] &&
        !['mterm_job_status', 'mterm_job_logs'].includes(name))) throw new Error('tool_capability_disabled');
    let result;
    if (name.startsWith('mterm_math_')) result = await mathOperation(name, args, config);
    else if (name.startsWith('mterm_vm_')) result = await vmOperation(name, args);
    else if (name.startsWith('mterm_system_') || name.startsWith('mterm_container_')) result = await systemOperation(name);
    else if (name.startsWith('mterm_job_')) {
      if (name === 'mterm_job_submit') result = await submitJob(config, args);
      else if (name === 'mterm_job_status') result = await jobStatus(config, args.id);
      else if (name === 'mterm_job_logs') result = await jobLogs(config, args.id);
      else if (name === 'mterm_job_cancel') result = await cancelJob(config, args.id);
      else if (name === 'mterm_job_resume') result = await resumeJob(config, args.id, args.confirm);
    }
    else {
      const repository = await allowedRepository(config, args.rootId, args.relativePath ?? '.');
      result = await codeOperation(name, args, repository, config);
    }
    const serialized = JSON.stringify(result);
    if (serialized.length > 48000) throw new Error('result_too_large');
    return { content: [{ type: 'text', text: serialized }] };
  } catch (error) {
    const message = error instanceof Error && /^[a-z0-9_]+$/.test(error.message) ? error.message :
      error instanceof Error && error.message.length <= 240 ? error.message : 'engineering_tool_failed';
    return { isError: true, content: [{ type: 'text', text: message }] };
  }
}
