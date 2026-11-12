# Desktop Commander dependency qualification

The source candidate pins Desktop Commander **0.3.3**, with the manager's SDK
remaining **1.32.2**. The previously observed production installation remains
**0.3.1**. Editing or merging these source files does not deploy them or restart
the manager. Track the broader upgrade and acceptance scope in
[MTerm-CLI issue 10](https://github.com/MulattoTech/MTerm-CLI/issues/10).

## Reproducible control and candidate

`control-package.json` and `control-package-lock.json` preserve the exact original
runtime manifests from Access commit `ba4a55b7ed351f7e60928179edaa7449de00be7d`.
The candidate uses the adjacent `upstream-package.json` and
`upstream-package-lock.json`. `lock-delta.json` records every added, removed and
changed lock entry. Neither installation reuses the live runtime or an existing
user's configuration. npm integrity checks validate downloaded package bytes;
the harness independently binds the expected upstream name, version, tarball URL,
integrity, installed entry point and lock file.

The actual upstream tarballs were independently downloaded and compared without
executing them. Version 0.3.1 corresponds to upstream Git commit
`7251da501d760e6eb5f95d802d9b42c741190950`; version 0.3.3 corresponds to
`bce370e9395f5bc74eda34913e5ae1dee48df8f8`. The compiled stdio entry is unchanged.
The only compiled `server.js` descriptor change adds two sentences to
`kill_process` describing managed process-tree termination and virtual Node
sessions. Input schemas and static annotations are unchanged; the qualification
still compares the complete actual 53-tool discovery results.

## Execution boundary

Run `npm run qualify:upstream` only through this repository's new GitHub Actions
matrix on fresh **GitHub-hosted Ubuntu and Windows, Node 24**. The executable
refuses normal local or self-hosted invocation before installing anything or
creating a workspace. The explicit environment switch is an accident-prevention
guard, not host attestation or an OS sandbox. Do not set it on the owner's PC.

This boundary is necessary: upstream uses both `os.homedir()` and, for Windows
Chrome behavior, `os.userInfo().homedir`. Environment redirection alone therefore
does not isolate an existing user's account. The hosted runner is a disposable
account with no production mounts, owner credentials or service connection.
The workflow checkout disables persisted GitHub credentials; child environments
exclude token variables, Node preload hooks, arbitrary remote endpoints and user
npm configuration. Each lane has its own home, state, cache, fixtures and temp
directories under a fresh owned runner-temp directory outside the checkout.
The workspace identity and owner marker are rechecked. Linked install paths and
retargeted entry points are rejected.

Installs use `npm ci --ignore-scripts`. Both exact locks resolve
`@vscode/ripgrep` 1.18.0, whose platform binary ships in an optional npm package;
it has no postinstall downloader. The harness verifies that native package and
executes its owned binary with `--version`, recording the binary hash and path.
No lifecycle rebuild is needed. Upstream onboarding and telemetry postinstall
scripts are not executed. Configuration and the upstream
environment switch disable telemetry, and a local HTTP fixture supplies feature
flags. Dependency installation uses the network; upstream Chrome
discovery/download may also use it. This harness is not an egress sandbox.

## Actual compatibility checks

Each control/candidate lane launches the unchanged managed gateway with a fresh
configuration. That gateway launches the exact admitted package as
`node dist/index.js --no-onboarding`, matching the ordinary production **stdio**
dispatch. A real SDK client initializes and discovers all 53 tool descriptors,
checks configuration ownership, writes and reads an owned Unicode fixture,
checks file metadata, verifies manager read-only denial, exercises completed
content search and pagination through the public text-only wire response, rejects
an inert blocklisted command using the exact public denial message and absence of
an owned execution marker, reads
bounded process output and observes owned parent/child termination. The control
uses existing `force_terminate`; the candidate exercises the upgraded
`kill_process` managed-tree behavior. Both create a real PDF, verify its signature
and text through `read_file`, and verify that admission reservations are released.

Shutdown sends EOF only and records gateway exit, upstream exit and owned process
cleanup. It does not use the stock SDK transport's timed kill escalation. Failed
or uncertain cleanup is a failing result; the harness preserves evidence and
does not kill unrelated processes or delete uncertain state. The disposable
runner's normal lifecycle ends the test account.

All tool names, input schemas, annotations and output schemas must match the
control exactly. Description changes are retained separately. Full inventories,
contract deltas, install logs and per-lane results are uploaded even after a
failure, with source commit/tree, candidate commit, runtime versions and package
hashes. A count match alone cannot qualify the upgrade. Exact candidate review,
all required CI jobs, normal expected-head merge, and fresh actual-main jobs
remain necessary before source qualification is recorded.

## Failed qualification evidence and corrections

The initial hosted attempt is retained as a failed qualification: Ubuntu passed
both versions' initialization, 53-tool discovery, configuration and file/policy
probes, but failed a search assertion without enough diagnostic values to locate
it; Windows failed seven temporary-root guard fixtures before real execution.
The follow-up canonicalizes ordinary temporary path names while still rejecting
actual links, records bounded search observations, and verifies the exact native
ripgrep prerequisite.

The second hosted attempt is also retained as failed. Both platforms passed all
90 guards and all four lanes reached search with successful text-only responses.
The harness had incorrectly required internal structured search facts, which both
published versions strip before MCP serialization. The corrected parser consumes
the known bounded public format, accepts a single running match, and requires six
owned fixture matches, complete pages with consistent counts, exact more flags,
and disjoint full file coverage. Later pages must remain completed. Process-start
PID and command-denial checks likewise use their published public text forms;
configuration still requires the actual returned structured configuration.

The separate existing pause test failed under hosted scheduling because it used
elapsed time to guess when a request had started and queued. It now proves those
events with barriers and verifies that paused queued work is rejected while an
already dispatched operation finishes after its explicit release. The manager's
runtime admission behavior is unchanged. The revised local suite passes 95 tests.
Both prior failed receipts, bounded real reports, native binary comparison, public
wire diagnosis and actual red/green regressions are retained under `evidence/`.
Revised hosted qualification and exact immutable review remain required. The guard
unit tests use inert files and never install or run upstream.

## Linux PDF investigation

The third attempt passed the root and manager jobs and the full Windows
qualification. Both Windows versions completed all ten real stages, including
PDF creation/read fidelity and admission release, followed by clean EOF shutdown.
Both Linux versions passed search, blocklist and owned process-tree checks, then
failed PDF creation with `write_pdf_tool_error`. The original receipt does not
identify the underlying error, and static review establishes no browser cause.

The next candidate observes only the fixed owned PDF fixture's public error
before preserving that same failure. Reports contain fixed diagnostic rule IDs,
whitelisted error codes, byte count, exact UTF-8 text SHA-256 and whether the
16,384-character inspection was truncated or the response malformed. They never
retain raw error text, paths, URLs, stacks or arbitrary response metadata. These
are matched signals, not root-cause conclusions. Browser arguments, host guards,
all stage assertions, stderr handling and production code remain unchanged.

This candidate normally integrates descriptor main `499255ad` from PR25, whose
actual-main root 123 and manager 79 tests passed. The combined local manager suite
passes 100/100. The imported metadata retains the same 53-tool contract; only the
28 MTerm descriptions are more detailed in both control and candidate lanes.

## Bounded temporary-path experiment

The diagnostic attempt retained browser-launch and missing-filesystem signals
for both Linux versions; neither signal proves a root cause. Chromium's published
source creates a pathname Unix socket below a unique system temporary directory,
and Linux provides 108 bytes for its pathname including termination. The retained
runner paths give lane TMPDIR lengths 72/74 bytes; known Chrome/Chromium directory
variants predict 113-120-byte socket paths. The actual hosted browser version and
original socket error remain unknown.

The follow-up shortens only the active owned workspace prefix by 21 bytes, to
`mterm-q-`, and updates the matching artifact-upload glob. A regression derives
lane paths from the actual workspace/environment helpers, combines them with the
retained Linux runner-parent length and longest known browser socket suffix, and
fails before the change. The corrected predicted paths fit below 108 bytes. The
local manager suite passes 101/101. Nonce/dev/ino/link checks, separate lane homes,
browser arguments, host guards, all PDF/readback assertions and cleanup remain
unchanged. Fresh real Linux and Windows qualification is still mandatory.
Historical receipts and paths remain verbatim. Primary-source identities,
arithmetic, limitations and failed diagnostics are retained in `evidence/`.

## Limits and deployment

This is a bounded compatibility qualification, not full security certification,
full feature parity, release readiness or complete issue acceptance. It does not
test public remote mode, personal account OAuth, provider registration, Docker,
macOS, all cancellation races or a real two-computer setup.

Upstream 0.3.3 contains a remote authentication repair, but the existing managed
stdio entry does not construct that remote transport. This candidate therefore
does not establish that a deployed authentication exposure existed or that the
production deployment is repaired. Source, installed runtime and Cloudflare
worker/plugin deployment remain separate artifacts. Any later deployment needs
an independently reviewed reversible handoff with no active-user-work disruption.
Never use `verify-installation.mjs` for this candidate: that older helper names
the production Windows installation and has historical 25-tool count assertions.

Primary references:

- [Upstream source at 0.3.3](https://github.com/wonderwhy-er/DesktopCommanderMCP/tree/bce370e9395f5bc74eda34913e5ae1dee48df8f8)
- [Upstream npm package](https://www.npmjs.com/package/@wonderwhy-er/desktop-commander/v/0.3.3)
- [GitHub runner environment variables](https://docs.github.com/en/actions/reference/workflows-and-actions/variables)
- [Pinned ripgrep wrapper and platform-package layout](https://github.com/microsoft/vscode-ripgrep/tree/v1.18.0)
