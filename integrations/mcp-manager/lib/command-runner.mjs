import { spawn } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_TIMEOUT_MS = 300000;
const DEFAULT_MAX_OUTPUT = 24000;
const MAX_OUTPUT_CAP = 500000;

function normalizeBoundedInt(value, fallback, min, max) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) return fallback;
  return Math.min(value, max);
}

/** Launches one executable with an argument vector (never a shell command). */
export function runCommand(executable, args, { cwd, stdin, signal, timeoutMs = DEFAULT_TIMEOUT_MS, maxOutput = DEFAULT_MAX_OUTPUT, trimOutput = false } = {}) {
  return new Promise(resolve => {
    if (typeof executable !== 'string' || !executable.trim() || !Array.isArray(args)) {
      resolve({ ok: false, code: null, output: '', truncated: false, timedOut: false, aborted: false, error: 'invalid_command_spec' });
      return;
    }
    const safeTimeout = normalizeBoundedInt(timeoutMs, DEFAULT_TIMEOUT_MS, 1, MAX_TIMEOUT_MS);
    const safeMaxOutput = normalizeBoundedInt(maxOutput, DEFAULT_MAX_OUTPUT, 1, MAX_OUTPUT_CAP);
    let processHandle;
    try {
      processHandle = spawn(executable, args, {
        cwd, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
      });
    } catch {
      resolve({ ok: false, code: null, output: '', truncated: false, timedOut: false, aborted: false, error: 'process_launch_failed' });
      return;
    }
    let output = '', truncated = false, timedOut = false, aborted = false, launchError = null, settled = false, seenFirstChunk = false;
    const abort = () => { aborted = true; processHandle.kill(); };
    if (signal) { signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort(); }
    const capture = chunk => {
      if (output.length >= safeMaxOutput) { truncated = true; return; }
      const remaining = safeMaxOutput - output.length;
      let text = chunk.toString('utf8');
      if (!seenFirstChunk) {
        seenFirstChunk = true;
        text = text.replace(/^﻿/, '');
      }
      output += text.slice(0, remaining);
      if (text.length > remaining) truncated = true;
    };
    processHandle.stdout.on('data', capture);
    processHandle.stderr.on('data', capture);
    processHandle.on('error', () => { launchError = 'process_launch_failed'; });
    const timer = setTimeout(() => { timedOut = true; processHandle.kill(); }, safeTimeout);
    timer.unref?.();
    processHandle.on('close', (code, exitSignal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', abort);
      const finalOutput = trimOutput ? output.trim() : output;
      resolve({ ok: !timedOut && !aborted && !launchError && code === 0, code, exitSignal,
        output: finalOutput, truncated, timedOut, aborted, ...(launchError ? { error: launchError } : {}) });
    });
    processHandle.stdin.on('error', () => {});
    if (stdin !== undefined) processHandle.stdin.end(stdin);
    else processHandle.stdin.end();
  });
}
