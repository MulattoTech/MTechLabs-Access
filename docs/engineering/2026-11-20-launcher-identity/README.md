# Verify the Windows manager invocation before reusing its listener

Source repair for [Access issue 32](https://github.com/MulattoTech/MTechLabs-Access/issues/32),
prepared on 2026-11-20 UTC from main
`8322c04bdc722a9cd333a347448ae56eaa3b8b1d`, tree
`822e8c8b945e6cd75da010e5877701ae967a7e1b`.

## Problem and resulting behavior

The original launcher accepted the expected Node executable whenever its command
line contained the text of the expected admin entry. It did not establish that
the text was the entry argument or that the intended manager configuration was
selected. It also did not compare the returned process PID with the listener owner.

The repair checks one returned process, its PID, the executable path, and exactly
four Windows arguments: executable, admin entry, literal `--config`, configuration.
Paths must be absolute drive paths and compare equal after Windows normalization,
using ordinal case-insensitive comparison. Unsupported flags, extra arguments,
missing metadata and parsing errors do not establish ownership. Failure messages
remain generic and do not echo another process's command line.

The implementation uses the native
[CommandLineToArgvW API](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-commandlinetoargvw).
Every nonzero native allocation is released with `LocalFree` in `finally`,
including argument-count failures. Empty, oversized and NUL-bearing command lines
are refused before parsing. This does not attest running source bytes or remove
same-user spoofing and PID-race limits.

## Original failure and unchanged-fixture result

The independently reviewed [frozen plan](frozen-plan.json) contains 26 named
decision cells. Both executions use native Windows PowerShell 5.1.26100.9818
(Desktop edition, Win32NT). Only the actual production function definitions are
loaded through the PowerShell AST. The launcher body is excluded; listener and
CIM observations are simulated. No real listener query, manager start/stop,
service change, production state write or upstream qualification is performed.

| Observation | Original source | Corrected source |
| --- | --- | --- |
| Matrix | 13 pass, 13 fail | 26 pass, 0 fail |
| Wrongly accepted process/configuration cases | 13 | 0 |
| Existing valid invocation/listener/error controls | 13 pass | Same 13 controls pass |
| Unexpected errors, invalid returns, query faults or blocked side-effect attempts | 0 | 0 |
| Private fixture argument leaks | 0 | 0 |
| Native fixture child exit | Natural exit 1 | Natural exit 0 |
| Capture | Complete, bounded, no timeout, empty stderr | Same conditions |

The original failures cover a different or lookalike configuration, absent or
duplicate configuration arguments, extra arguments, a lookalike entry, entry text
inside an unrelated command/eval payload, unsupported Node flags, an incorrect
flag case, a relative executable argument and a mismatched process PID. All first
observations are retained before assertions. Both fixture files remain byte-for-byte
unchanged between the original and corrected executions.

- [Original normalized receipt](red-original-receipt.json) and [original connector result](red-original-tool.json).
- [Corrected normalized receipt](green-receipt.json) and [corrected connector result](green-tool.json).
- [Independent review record](independent-review.json).
- [Local ordinary gates](local-gates.json).

The native child exit codes are captured directly. Connector parent completion
messages are retained separately and do not establish an additional parent exit
code. These are simulated ownership decisions on an actual Windows parser, not a
claim that a production process was observed being misidentified.

## Source identity and ordinary gates

| Input | SHA-256 |
| --- | --- |
| Original launcher | `daf5856c9e317b295340e0b1e8cb794be39f4a5695997d212389ec76086fb5e1` |
| Corrected launcher | `8a509310401320ad659325a67f705c8eeef21a242682d204e63d3d63d4c729c0` |
| Frozen PowerShell fixture | `76850b30c31921c260e583ab480810dcbacea2ea521314e0f1c10539f4c433bf` |
| Frozen Node wrapper | `221f26996d3c03041487efafaf05955c6cbb4a24b134f735951f4c2162ecf1dc` |

The repository root suite passes 128/128, with build, syntax checks and generated
UI equality passing. The Linux manager suite passes 115 tests; its one new native
Windows parent is explicitly skipped there. The unchanged ordinary wrapper runs
all 26 decision cells as subtests on Windows PowerShell 5.1. Hosted Windows wrapper
execution, all five exact-candidate jobs and all five distinct actual-main jobs
remain required before final issue acceptance. The live upstream qualification
harness remains restricted to its existing disposable GitHub-hosted environments.

Final publication, immutable commit/tree binding, hosted qualification, normal
merge, claim release and explicit issue completion belong in the existing
[issue 32](https://github.com/MulattoTech/MTechLabs-Access/issues/32) record after
those operations actually succeed. This preparation record does not predeclare them.

## Scope and continuation

The initial installation constants and complete existing launcher main body are
unchanged. No port, mutex, shortcut, policy, credential, dependency, plugin package,
Cloudflare route, service or deployed runtime is changed by this source batch.
There is no model invocation. Reverting the source change is the rollback for this
batch; a production deployment needs its own reviewed operational handoff.

This is groundwork for reliable DEV selection. Independent DEV still needs
separate state, listener identity, App/grant routing and a genuinely isolated
upstream user profile. Separate manager directories alone do not isolate Desktop
Commander's per-user configuration and logs. CLI issues 209/246 and the broader
roadmap acceptance remain open.

Implementation owner: OpenAI / GPT-6 Astra Pro, ChatGPT Web, self-reported.
Independent reviewer: `/root/repository_baseline`. One root writer owns the source;
the independent agent performs read-only source and evidence review.
