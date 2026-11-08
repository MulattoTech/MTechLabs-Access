# Private MTerm-CLI ChatGPT plugin download

This folder holds the exact owner-published ChatGPT plugin archive from Plugin Creator. The website serves the archive only after verified owner Cloudflare Access identity at `/admin/mcp/plugin/latest.tar.gz`. Its metadata and SHA-256 are at `/admin/mcp/plugin/latest.json`.

To publish a future release, first publish/update the **same** private ChatGPT plugin via Plugin Creator and verify its returned release/version. Fetch that exact release archive with the owner tool, validate its entries contain no secrets, copy it as `mterm-chatgpt-vX.Y.Z.tar.gz` into this folder, update `current.json` with its exact file, version and lowercase SHA-256, run `npm run build && npm run check && npm test`, then deploy the updated Worker and verify both owner and anonymous responses. This is not automatic synchronization from ChatGPT; do not claim a version is downloadable until the website deployment is verified.

Do not change MCP endpoint, Cloudflare Access policy, or client OAuth metadata merely to repair a ChatGPT account installation. A ChatGPT-side reconnect or installation still requires the user's interactive authorization.
