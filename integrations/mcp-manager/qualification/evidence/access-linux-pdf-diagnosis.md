# Linux PDF qualification diagnosis

**Cause remains unestablished. A diagnostic-only harness revision is appropriate.**

- write_pdf public error response contains Error-prefixed actual error.message; shared call helper discards it by asserting isError false. No gateway or stderr change is needed to classify the public result.
- Both versions use lazy md-to-pdf and Puppeteer, own temporary Chrome profile/local HTTP render server, cache then system Chrome then explicit Chrome download.
- Upstream uses CONFIG_FILE-adjacent puppeteer-cache; PUPPETEER_SKIP_DOWNLOAD only suppresses ordinary Puppeteer install behavior, not upstream explicit browser installation.
- The0.3.3 markdown module differs only in Docker-specific browser selection and no-sandbox flags. isDockerImage checks MCP_CLIENT_DOCKER===true; qualification environment does not admit that switch.
- Fixture Markdown/path/options are valid on actual Windows; this does not identify the Linux failure cause. Shared Linux browser launch, sandbox, native prerequisites or discovery problems are hypotheses only.

## Recommended boundary

Classify the public error from the fixed owned PDF fixture before the existing failing assertion. Retain only reviewed category/rule IDs, byte count, exact-text hash and boundedness metadata. Unknown, malformed and oversized results remain failures. No raw text, paths, URLs, stack, arbitrary metadata or credentials should be retained. Preserve browser sandbox and host guard, all existing gates, gateway and source locks.

The JSON companion binds exact inspected tarball files and gives negative acceptance tests. No upstream code was executed locally.
