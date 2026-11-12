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

Ordinary installs use `npm ci --ignore-scripts`. One explicit, pinned dependency
rebuild downloads the platform's ripgrep binary. The upstream onboarding and
telemetry postinstall scripts are not executed. Configuration and the upstream
environment switch disable telemetry, and a local HTTP fixture supplies feature
flags. Dependency installation and ripgrep use the network; upstream Chrome
discovery/download may also use it. This harness is not an egress sandbox.

## Actual compatibility checks

Each control/candidate lane launches the unchanged managed gateway with a fresh
configuration. That gateway launches the exact admitted package as
`node dist/index.js --no-onboarding`, matching the ordinary production **stdio**
dispatch. A real SDK client initializes and discovers all 53 tool descriptors,
checks configuration ownership, writes and reads an owned Unicode fixture,
checks file metadata, verifies manager read-only denial, exercises completed
content search and pagination, rejects an inert blocklisted command, reads
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

## Limits and deployment

This initial change has local guard-test evidence only until hosted receipts are
recorded. The guard unit tests use inert files and never install or run upstream.
It is a bounded compatibility qualification, not full security certification,
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
