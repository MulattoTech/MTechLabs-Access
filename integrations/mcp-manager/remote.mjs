import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonBody } from './lib/http-body.mjs';
import { ManagedStdioTransport } from './lib/managed-transport.mjs';
import { MANAGER_VERSION } from './lib/status.mjs';

const MAX_HTTP_REQUESTS = 64;
const MAX_BODY_BYTES = 1024 * 1024;
const MAY_START_BACKGROUND_WORK = new Set(['start_process', 'start_search', 'interact_with_process']);
const POLICY_DENIALS = new Map([
  [-32010, 'Managed tools are paused. This request was not executed.'],
  [-32011, 'This tool is not allowed by the managed read-only policy. This request was not executed.'],
  [-32012, 'Available memory is below the configured launch-admission threshold. This request was not executed.'],
  [-32013, 'The managed request capacity is full. This request was not executed.'],
  [-32014, 'Managed policy is unavailable or invalid. This request was not executed.'],
  [-32016, 'The queued request expired before execution.'],
  [-32017, 'Shared admission coordination is unavailable. This request was not executed.'],
  [-32018, 'Available installation-volume disk space is below the admission threshold or could not be verified. This request was not executed.'],
  [-32800, 'The request was cancelled before execution.'],
]);

async function loadSdk() {
  const [server, http, client, types] = await Promise.all([
    import('@modelcontextprotocol/sdk/server/index.js'),
    import('@modelcontextprotocol/sdk/server/streamableHttp.js'),
    import('@modelcontextprotocol/sdk/client/index.js'),
    import('@modelcontextprotocol/sdk/types.js'),
  ]);
  return { ...server, ...http, ...client, ...types };
}

function failure(response, status, code, message, id = null) {
  if (response.headersSent || response.destroyed) return;
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }));
}

function toolWithoutUnsupportedUi(tool) {
  if (!tool?._meta || typeof tool._meta !== 'object' || Array.isArray(tool._meta)) return tool;
  const meta = { ...tool._meta };
  delete meta['ui/resourceUri'];
  delete meta['openai/outputTemplate'];
  if (meta.ui && typeof meta.ui === 'object') delete meta.ui;
  return { ...tool, _meta: meta };
}

export function createRemoteMcp(config, {
  configPath,
  idleTimeoutMs = 5 * 60 * 1000,
  upstreamTimeoutMs = 125000,
  maxHttpRequests = MAX_HTTP_REQUESTS,
  sdkLoader = loadSdk,
} = {}) {
  if (!Number.isInteger(maxHttpRequests) || maxHttpRequests < 1 || maxHttpRequests > MAX_HTTP_REQUESTS) throw new Error('invalid_http_concurrency');
  const configured = typeof configPath === 'string' && path.isAbsolute(configPath);
  const gatewayPath = fileURLToPath(new URL('./gateway.mjs', import.meta.url));
  let sdk;
  let sdkPromise;
  let backend;
  let starting;
  let closing;
  let idleTimer;
  let state = configured ? 'idle' : 'unavailable';
  let stopping = false;
  let activeHttpRequests = 0;
  let activeUpstreamRequests = 0;
  let mayHaveDetachedJobs = false;
  let lastToolListCount = null;
  let lastSuccessfulRequestAt = null;
  let lastSuccessfulToolAt = null;
  const observedClients = new Map();

  function status() {
    return {
      transport: 'streamable-http', endpoint: '/mcp', state, sdkLoaded: Boolean(sdk),
      sharedBackend: true, activeHttpRequests, activeUpstreamRequests,
      maxHttpRequests, idleTimeoutSeconds: idleTimeoutMs / 1000,
      idleTeardownDeferred: mayHaveDetachedJobs,
      lastToolListCount, lastSuccessfulRequestAt, lastSuccessfulToolAt,
      clientIdentityTracked: false,
      resourceSupport: backend ? Boolean(backend.capabilities.resources) : null,
      promptSupport: backend ? Boolean(backend.capabilities.prompts) : null,
      observedClients: [...observedClients.values()],
    };
  }

  function scheduleIdleClose() {
    clearTimeout(idleTimer);
    if (!backend || stopping || activeHttpRequests || activeUpstreamRequests || mayHaveDetachedJobs) return;
    idleTimer = setTimeout(() => { void closeBackend(false); }, idleTimeoutMs);
    idleTimer.unref?.();
  }

  async function ensureSdk() {
    if (!sdkPromise) {
      sdkPromise = sdkLoader().then(value => { sdk = value; return value; }).catch(() => {
        sdkPromise = undefined;
        state = 'unavailable';
        throw new Error('sdk_unavailable');
      });
    }
    return sdkPromise;
  }

  async function closeBackend(manual) {
    clearTimeout(idleTimer);
    if (closing) return closing;
    if (!backend) return;
    if (!manual && (activeHttpRequests || activeUpstreamRequests || mayHaveDetachedJobs)) return;
    const owned = backend;
    state = 'closing';
    closing = (async () => {
      await owned.client.close();
      // Do not start a replacement while the owned gateway is still exiting.
      // There is deliberately no timeout followed by kill or process-tree kill.
      await owned.transport.completed;
      if (backend === owned) backend = undefined;
      mayHaveDetachedJobs = false;
      state = stopping ? 'stopped' : 'idle';
      closing = undefined;
    })();
    return closing;
  }

  async function ensureBackend() {
    if (!configured || stopping || closing) throw new Error('backend_unavailable');
    clearTimeout(idleTimer);
    if (starting) return starting;
    if (backend) return backend;
    state = 'starting';
    starting = (async () => {
      const api = await ensureSdk();
      const transport = new ManagedStdioTransport({
        nodePath: config.nodePath, gatewayPath, configPath, cwd: path.dirname(gatewayPath),
      });
      const client = new api.Client({ name: 'm-techlabs-remote-bridge', version: MANAGER_VERSION }, { capabilities: {} });
      // No raw exception, tool arguments, environment, or child log forwarding.
      client.onerror = () => {};
      const owned = { client, transport, capabilities: {} };
      backend = owned;
      client.onclose = () => {
        if (backend !== owned || closing) return;
        backend = undefined;
        mayHaveDetachedJobs = false;
        state = stopping ? 'stopped' : 'idle';
      };
      try {
        await client.connect(transport, { timeout: 30000 });
        owned.capabilities = client.getServerCapabilities() ?? {};
        state = 'ready';
        return owned;
      } catch {
        state = 'unavailable';
        // Gracefully finish only this failed transport. Later calls do not
        // create another gateway while this one is still closing.
        void closeBackend(true).catch(() => {});
        throw new Error('backend_unavailable');
      }
    })().finally(() => { starting = undefined; });
    return starting;
  }

  function safeUpstreamError(cause) {
    const denial = POLICY_DENIALS.get(cause?.code);
    if (denial) return new sdk.McpError(cause.code, denial);
    return new sdk.McpError(-32020,
      'The local MCP operation did not complete normally. It may still be running and was not retried or killed.');
  }

  async function invoke(operation, { toolName } = {}) {
    activeUpstreamRequests += 1;
    try {
      const result = await operation();
      lastSuccessfulRequestAt = new Date().toISOString();
      if (toolName && result?.isError !== true) lastSuccessfulToolAt = lastSuccessfulRequestAt;
      if (MAY_START_BACKGROUND_WORK.has(toolName)) mayHaveDetachedJobs = true;
      return result;
    } catch (cause) {
      if (MAY_START_BACKGROUND_WORK.has(toolName) && !POLICY_DENIALS.has(cause?.code)) mayHaveDetachedJobs = true;
      throw safeUpstreamError(cause);
    } finally {
      activeUpstreamRequests -= 1;
      scheduleIdleClose();
    }
  }

  function protocolServer(owned) {
    const hasResources = Boolean(owned.capabilities.resources);
    const hasPrompts = Boolean(owned.capabilities.prompts);
    const capabilities = { tools: {} };
    if (hasResources) capabilities.resources = {};
    if (hasPrompts) capabilities.prompts = {};
    // Do not promise subscriptions, listChanged, sampling, tasks, or sessions
    // through a stateless bridge that does not implement them.
    const server = new sdk.Server({ name: 'MTerm-CLI Desktop Bridge', version: MANAGER_VERSION }, { capabilities });
    server.onerror = () => {};
    const options = { timeout: upstreamTimeoutMs };
    server.setRequestHandler(sdk.ListToolsRequestSchema, request => invoke(async () => {
      const result = await owned.client.listTools(request.params, options);
      lastToolListCount = result.tools.length;
      return hasResources ? result : { ...result, tools: result.tools.map(toolWithoutUnsupportedUi) };
    }));
    server.setRequestHandler(sdk.CallToolRequestSchema, request => invoke(
      () => owned.client.callTool(request.params, sdk.CallToolResultSchema, options),
      { toolName: request.params.name },
    ));
    if (hasResources) {
      server.setRequestHandler(sdk.ListResourcesRequestSchema, request => invoke(() => owned.client.listResources(request.params, options)));
      server.setRequestHandler(sdk.ListResourceTemplatesRequestSchema, request => invoke(() => owned.client.listResourceTemplates(request.params, options)));
      server.setRequestHandler(sdk.ReadResourceRequestSchema, request => invoke(() => owned.client.readResource(request.params, options)));
    }
    if (hasPrompts) {
      server.setRequestHandler(sdk.ListPromptsRequestSchema, request => invoke(() => owned.client.listPrompts(request.params, options)));
      server.setRequestHandler(sdk.GetPromptRequestSchema, request => invoke(() => owned.client.getPrompt(request.params, options)));
    }
    return server;
  }

  async function handle(request, response) {
    // The caller MUST perform bearer, Host, and Origin checks before this method.
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (request.method !== 'POST') {
      request.resume();
      response.setHeader('Allow', 'POST');
      return failure(response, 405, -32000, 'This stateless MCP endpoint accepts POST only.');
    }
    if (!configured || stopping || closing) {
      request.resume();
      return failure(response, 503, -32020, 'The local MCP bridge is unavailable.');
    }
    if (activeHttpRequests >= maxHttpRequests || activeUpstreamRequests >= maxHttpRequests) {
      request.resume();
      return failure(response, 429, -32013, 'The remote MCP request capacity is full. This request was not executed.');
    }
    activeHttpRequests += 1;
    clearTimeout(idleTimer);
    let server;
    let transport;
    try {
      let body;
      try { body = await readJsonBody(request, MAX_BODY_BYTES); }
      catch { return failure(response, 400, -32700, 'Send one JSON-RPC message no larger than 1 MiB.'); }
      if (!body || typeof body !== 'object' || Array.isArray(body) || body.jsonrpc !== '2.0') {
        return failure(response, 400, -32600, 'A single JSON-RPC message is required.');
      }
      const owned = await ensureBackend();
      server = protocolServer(owned);
      transport = new sdk.StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await server.connect(transport);
      const finished = new Promise(resolve => {
        response.once('finish', resolve);
        response.once('close', resolve);
      });
      await transport.handleRequest(request, response, body);
      await finished;
      // Initialize reports a client label, not an identity or an OAuth grant.
      // Keep a bounded, sanitized observation so the dashboard can distinguish
      // a configured connection from a client that actually reached the bridge.
      if (body.method === 'initialize' && response.statusCode === 200) {
        const info = server.getClientVersion();
        if (info && typeof info.name === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9 _.@()-]{0,79}$/.test(info.name)) {
          const version = typeof info.version === 'string' && /^[a-zA-Z0-9_.+-]{1,40}$/.test(info.version) ? info.version : null;
          const key = info.name + ':' + (version ?? 'unknown');
          observedClients.delete(key);
          observedClients.set(key, { name: info.name, version, lastInitializedAt: new Date().toISOString(), evidence: 'protocol-initialize' });
          if (observedClients.size > 8) observedClients.delete(observedClients.keys().next().value);
        }
      }
    } catch {
      failure(response, 503, -32020, 'The local MCP bridge is unavailable. No automatic tool retry was attempted.');
    } finally {
      // These are per-HTTP-request server objects, not the shared stdio client.
      await server?.close().catch(() => {});
      await transport?.close().catch(() => {});
      activeHttpRequests -= 1;
      scheduleIdleClose();
    }
  }

  async function close() {
    stopping = true;
    clearTimeout(idleTimer);
    if (starting) await starting.catch(() => {});
    await closeBackend(true);
    state = 'stopped';
  }

  return { handle, status, close };
}
