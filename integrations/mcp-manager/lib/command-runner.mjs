import { spawn } from 'node:child_process';

/** Launches one executable with an argument vector (never a shell command). */
export function runCommand(executable, args, { cwd, stdin, signal, timeoutMs = 15000, maxOutput = 24000 } = {}) {
  return new Promise(resolve => {
    let processHandle;
    try {
      processHandle = spawn(executable, args, {
        cwd, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
      });
    } catch {
      resolve({ ok: false, code: null, output: '', error: 'process_launch_failed' });
      return;
    }
    let output = '', truncated = false, timedOut = false, aborted = false, launchError = null, settled = false;
    const abort = () => { aborted = true; processHandle.kill(); };
    if (signal) { signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort(); }
    const capture = chunk => {
      if (output.length >= maxOutput) { truncated = true; return; }
      const remaining = maxOutput - output.length;
      const text = chunk.toString('utf8');
      output += text.slice(0, remaining);
      if (text.length > remaining) truncated = true;
    };
    processHandle.stdout.on('data', capture);
    processHandle.stderr.on('data', capture);
    processHandle.on('error', () => { launchError = 'process_launch_failed'; });
    const timer = setTimeout(() => { timedOut = true; processHandle.kill(); }, timeoutMs);
    timer.unref?.();
    processHandle.on('close', (code, exitSignal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', abort);
      resolve({ ok: !timedOut && !aborted && !launchError && code === 0, code, exitSignal,
        output, truncated, timedOut, aborted, ...(launchError ? { error: launchError } : {}) });
    });
    processHandle.stdin.on('error', () => {});
    if (stdin !== undefined) processHandle.stdin.end(stdin);
    else processHandle.stdin.end();
  });
}
