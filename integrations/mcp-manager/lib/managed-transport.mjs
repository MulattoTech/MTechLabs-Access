import { spawn } from 'node:child_process';
import { createLineFramer } from './framing.mjs';

// SDK-compatible stdio transport with an intentional difference from the SDK's
// stock transport: close sends EOF only. It never escalates to process signals.
// A closing child must actually exit before the remote bridge can replace it.
export class ManagedStdioTransport {
  constructor({ nodePath, gatewayPath, configPath, cwd }) {
    this.options = { nodePath, gatewayPath, configPath, cwd };
    this.child = null;
    this.closing = false;
    this.started = false;
    this.completed = new Promise(resolve => { this.resolveCompleted = resolve; });
  }

  async start() {
    if (this.started) throw new Error('already_started');
    this.started = true;
    const { nodePath, gatewayPath, configPath, cwd } = this.options;
    const child = this.child = spawn(nodePath, [gatewayPath, '--config', configPath, '--client', 'remote-web'], {
      cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false,
      // Existing OS environment only; no HTTP credentials or tool arguments
      // are added to the environment or the command line.
      env: process.env,
    });
    const safeError = () => this.onerror?.(new Error('managed_transport_error'));
    const frames = createLineFramer({
      maxBytes: 8 * 1024 * 1024,
      onLine: line => {
        try { this.onmessage?.(JSON.parse(line)); } catch { safeError(); }
      },
      onError: safeError,
    });
    child.stdout.on('data', chunk => frames.push(chunk));
    child.stdout.once('end', () => frames.end());
    child.stdout.on('error', safeError);
    child.stdin.on('error', safeError);
    // The gateway diagnostics are generic, but do not forward child logs into
    // a web result or a management log at all.
    child.stderr.on('data', () => {});
    child.stderr.on('error', safeError);
    child.on('error', safeError);
    child.once('close', () => {
      this.child = null;
      this.closing = true;
      this.onclose?.();
      this.resolveCompleted();
    });
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', () => reject(new Error('managed_spawn_failed')));
    });
  }

  async send(message) {
    const stream = this.child?.stdin;
    if (this.closing || !stream || stream.destroyed || stream.writableEnded) throw new Error('managed_transport_closed');
    const frame = JSON.stringify(message) + '\n';
    if (Buffer.byteLength(frame) > 1024 * 1024) throw new Error('managed_frame_too_large');
    await new Promise((resolve, reject) => {
      stream.write(frame, cause => cause ? reject(new Error('managed_write_failed')) : resolve());
    });
  }

  async close() {
    if (this.closing) return;
    this.closing = true;
    if (!this.child) {
      this.onclose?.();
      this.resolveCompleted();
      return;
    }
    this.child.stdin.end();
    // No waiting/kill escalation here. The bridge owns completed and remains
    // in closing state if an upstream process does not exit on EOF.
  }
}

export function isValidJsonRpcMethod(method) {
  return typeof method === "string" && method.length > 0 && method.length <= 128 && !/\s/.test(method);
}
