# MTerm bridge liveness development checkpoint

The stateless MCP ping now uses the existing SDK HTTP protocol server without starting the managed workstation child. Authentication, Host/Origin checks, request limits and the full initialize/discovery/tool path are preserved. Ping success indicates bridge liveness. Use an actual read-only tool to confirm workstation connectivity.

The new regression initially failed because the cold fixture gateway entered ready state on ping. With the patch, authenticated ping returns the expected result while the gateway stays idle. An unauthenticated ping is denied, and the same fixture can subsequently initialize and list tools. The remote transport suite passed 9/9. The complete manager suite passed 442 tests with 2 skips and zero failures on Windows.

Production observations: an authenticated workstation command returned successfully in this conversation. Five unauthenticated requests to the public MCP endpoint returned 401 in 62 to 110 ms. The ChatGPT settings panel stall did not reproduce in these probes. No causal claim is made for cold start, OAuth, or settings UI rendering. The candidate has not been installed or verified through ChatGPT. Frequent pings can refresh the existing idle deadline for an already running backend.

Next qualification: compare authenticated cold discovery, warm discovery, and repeat after idle; record settings-resource and tool-call latency separately; test through the development plugin before any production promotion. Keep credentials and full settings payloads out of records.
