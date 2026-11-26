import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runCommand } from '../lib/command-runner.mjs';

const worker = fileURLToPath(new URL('../math_worker.py', import.meta.url));
const operations = new Map([
  ['mterm_math_evaluate', 'evaluate'],
  ['mterm_math_solve', 'solve'],
  ['mterm_math_verify', 'verify'],
  ['mterm_math_convert_units', 'convert_units'],
]);

export function supportedMathOperations() {
  return [...operations.keys()];
}

export async function mathOperation(name, args, config, options = {}) {
  const operation = operations.get(name);
  if (!operation) throw new Error('unsupported_math_operation');
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('invalid_math_arguments');
  const timeoutMs = options.timeoutMs ?? 10000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) throw new Error('invalid_math_timeout');
  const managedPython = path.join(config.stateDirectory, 'math-venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  let python = process.env.MTERM_MATH_PYTHON;
  if (!python) {
    try { await fs.access(managedPython); python = managedPython; }
    catch { python = 'python'; }
  }
  if (python !== 'python' && !path.isAbsolute(python)) throw new Error('invalid_python_configuration');
  const input = JSON.stringify({ ...args, operation });
  if (input.length > 4096) throw new Error('math_input_too_large');
  const result = await runCommand(python, ['-I', worker], { stdin: input, timeoutMs, maxOutput: 6000 });
  if (result.timedOut) throw new Error('math_timeout');
  if (!result.ok || result.truncated) throw new Error('math_worker_unavailable');
  let payload;
  try { payload = JSON.parse(result.output); }
  catch { throw new Error('invalid_math_result'); }
  if (payload.error) throw new Error(String(payload.error).slice(0, 240));
  if (payload.ok !== true || !payload.result) throw new Error('invalid_math_result');
  return payload.result;
}
