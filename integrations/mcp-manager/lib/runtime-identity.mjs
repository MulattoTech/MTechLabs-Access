import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const WINDOWS_POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const probe = fileURLToPath(new URL('../windows-runtime-probe.ps1', import.meta.url));

export async function captureWindowsRuntime(roles = {}) {
  if (process.platform !== 'win32') throw new Error('dev_runtime_platform_unsupported');
  if (process.env.NODE_OPTIONS || process.env.NODE_PATH) throw new Error('node_preload_environment_rejected');
  if (!roles || typeof roles !== 'object' || Array.isArray(roles) ||
      Object.keys(roles).some(key => !['production', 'development'].includes(key))) throw new Error('invalid_observation_request');
  const payload = JSON.stringify({ ...roles, currentProcessId: process.pid, currentImage: process.execPath });
  if (Buffer.byteLength(payload) > 16384) throw new Error('runtime_observation_input_limit');
  return new Promise((resolve, reject) => {
    const child = execFile(WINDOWS_POWERSHELL, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', probe], {
      windowsHide: true, encoding: 'utf8', timeout: 15000, maxBuffer: 32768,
    }, (error, stdout, stderr) => {
      try {
        if (error || stderr.trim()) throw new Error('runtime_observation_unavailable');
        const value = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
        if (!value || value.schemaVersion !== 1 || typeof value.current !== 'object') throw new Error('runtime_observation_unavailable');
        resolve(value);
      } catch { reject(new Error('runtime_observation_unavailable')); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(payload);
  });
}
