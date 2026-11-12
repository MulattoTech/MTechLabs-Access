// SPDX-License-Identifier: MIT
// AI-Change: 2026-11-12-engineering-descriptions (OpenAI / GPT-6 Astra Pro; self-reported)
import { ENGINEERING_DESCRIPTIONS } from './engineering-descriptions.mjs';
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
  tool('mterm_math_evaluate', ENGINEERING_DESCRIPTIONS.mterm_math_evaluate, { expression: str('Math expression, e.g. sqrt(2)+1'), precision: int('Decimal digits', 8, 100) }, ['expression']),
  tool('mterm_math_solve', ENGINEERING_DESCRIPTIONS.mterm_math_solve, { equation: str('Equation such as x^2=4'), variable: str('Variable to solve for', 16) }, ['equation', 'variable']),
  tool('mterm_math_verify', ENGINEERING_DESCRIPTIONS.mterm_math_verify, { left: str('First expression'), right: str('Second expression') }, ['left', 'right']),
  tool('mterm_math_convert_units', ENGINEERING_DESCRIPTIONS.mterm_math_convert_units, { value: str('Decimal numeric value', 80), from: str('Source unit', 12), to: str('Target unit', 12) }, ['value', 'from', 'to']),
  tool('mterm_system_inventory', ENGINEERING_DESCRIPTIONS.mterm_system_inventory),
  tool('mterm_container_list', ENGINEERING_DESCRIPTIONS.mterm_container_list),
  tool('mterm_vm_list', ENGINEERING_DESCRIPTIONS.mterm_vm_list),
  tool('mterm_vm_inspect', ENGINEERING_DESCRIPTIONS.mterm_vm_inspect, vm, ['name']),
  tool('mterm_vm_network_map', ENGINEERING_DESCRIPTIONS.mterm_vm_network_map),
  tool('mterm_vm_disk_health', ENGINEERING_DESCRIPTIONS.mterm_vm_disk_health),
  tool('mterm_vm_diagnostics', ENGINEERING_DESCRIPTIONS.mterm_vm_diagnostics, { hours: int('Lookback hours', 1, 168) }),
  tool('mterm_vm_change_plan', ENGINEERING_DESCRIPTIONS.mterm_vm_change_plan, { ...vm, action: { type: 'string', enum: ['start', 'shutdown', 'checkpoint'] } }, ['name', 'action']),
  tool('mterm_vm_start', ENGINEERING_DESCRIPTIONS.mterm_vm_start, { ...vm, confirmName: str('Repeat the exact VM name to confirm', 80) }, ['name', 'confirmName'], false),
  tool('mterm_vm_shutdown', ENGINEERING_DESCRIPTIONS.mterm_vm_shutdown, { ...vm, confirmName: str('Repeat the exact VM name to confirm', 80) }, ['name', 'confirmName'], false),
  tool('mterm_vm_checkpoint_create', ENGINEERING_DESCRIPTIONS.mterm_vm_checkpoint_create, { ...vm, confirmName: str('Repeat the exact VM name to confirm', 80) }, ['name', 'confirmName'], false),
  tool('mterm_repo_inspect', ENGINEERING_DESCRIPTIONS.mterm_repo_inspect, root, ['rootId']),
  tool('mterm_code_diagnostics', ENGINEERING_DESCRIPTIONS.mterm_code_diagnostics, root, ['rootId']),
  tool('mterm_code_review_diff', ENGINEERING_DESCRIPTIONS.mterm_code_review_diff, { ...root, base: str('Optional Git base ref; defaults to HEAD', 80) }, ['rootId']),
  tool('mterm_code_symbols', ENGINEERING_DESCRIPTIONS.mterm_code_symbols, { ...root, query: str('Function, class or identifier to locate', 80) }, ['rootId', 'query']),
  tool('mterm_code_references', ENGINEERING_DESCRIPTIONS.mterm_code_references, { ...root, symbol: str('Exact identifier to search', 80) }, ['rootId', 'symbol']),
  tool('mterm_test_run', ENGINEERING_DESCRIPTIONS.mterm_test_run, { ...root, command: { type: 'string', enum: ['npm-test', 'npm-lint', 'pytest', 'git-diff-check'] } }, ['rootId', 'command'], false),
  tool('mterm_patch_apply_checked', ENGINEERING_DESCRIPTIONS.mterm_patch_apply_checked, { ...root, patch: str('Unified diff', 20000), expectedHead: str('Expected 40-character HEAD SHA', 40), apply: bool('Actually apply the patch; false validates only') }, ['rootId', 'patch', 'expectedHead', 'apply'], false),
  tool('mterm_git_worktree_create', ENGINEERING_DESCRIPTIONS.mterm_git_worktree_create, { ...root, name: str('Unique lowercase worktree name, e.g. sprint-one', 40) }, ['rootId', 'name'], false),
  tool('mterm_job_submit', ENGINEERING_DESCRIPTIONS.mterm_job_submit, { kind: { type: 'string', enum: ['repo_diagnostics', 'run_tests', 'vm_inventory'] }, ...root, command: { type: 'string', enum: ['npm-test', 'npm-lint', 'pytest', 'git-diff-check'] } }, ['kind'], false),
  tool('mterm_job_status', ENGINEERING_DESCRIPTIONS.mterm_job_status, { id: str('Job UUID', 36) }, ['id']),
  tool('mterm_job_logs', ENGINEERING_DESCRIPTIONS.mterm_job_logs, { id: str('Job UUID', 36) }, ['id']),
  tool('mterm_job_cancel', ENGINEERING_DESCRIPTIONS.mterm_job_cancel, { id: str('Job UUID', 36) }, ['id'], false),
  tool('mterm_job_resume', ENGINEERING_DESCRIPTIONS.mterm_job_resume, { id: str('Job UUID', 36), confirm: bool('I verified the previous outcome before requeueing') }, ['id', 'confirm'], false),
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
