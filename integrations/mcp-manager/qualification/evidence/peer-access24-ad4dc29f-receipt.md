# Access PR24 diagnostic candidate ad4dc29f: hosted receipt

**Status: blocked on Linux PDF creation.** Exact candidate `ad4dc29f5f848368ccd5fd93373f4bc498784dfa`, tree `66549c0561d0bf2388ed0494727304d1c93cd15e`, completed [run 43293182649](https://github.com/MulattoTech/MTechLabs-Access/actions/runs/43293182649), attempt 1, with three successful checks and one failed check. No retry occurred.

| Exact check | Job ID | Result | Source/guard tests |
|---|---:|---|---|
| managed-mcp | 131444470867 | success | 100/100 pass, 0 fail, 0 skip |
| Upstream qualification / ubuntu-latest / Node 24 | 131444471273 | failure | 100/100 pass, 0 fail, 0 skip |
| test | 131444471455 | success | 123/123 pass, 0 fail, 0 skip |
| Upstream qualification / windows-latest / Node 24 | 131444471463 | success | 100/100 pass, 0 fail, 0 skip |

Both upstream jobs passed all 100 guard tests and the final tracked-source diff check. Root passed 123 tests; managed-mcp passed 100. All suites had zero skips/cancellations. Both real-platform jobs used Node v24.22.2 / npm 11.19.1.

## Fixed PDF failure observations

Both Linux lanes failed `pdf_create_and_read_fidelity` with `failureCode: write_pdf_tool_error`, null RPC error code, and these bounded fields:

| Observation | Control 0.3.1 | Candidate 0.3.3 |
|---|---|---|
| signals | browser_launch; filesystem_missing | browser_launch; filesystem_missing |
| errorCodes | empty | empty |
| isError / malformed | true / false | true / false |
| UTF-8 bytes / inspected characters | 693 / 693 | 695 / 695 |
| inspectionTruncated | false | false |
| textSha256 | `72f9739fce4c3e201b5497f617b306a275570c399a0a2dda1691ea3b580f8d57` | `9e5923c467423d99dbf2a04c5e820e0bb19e06d2d2940ff5ca47c3513db36425` |

The tool is write_pdf, stage pdf_create_and_read_fidelity, fixture owned-fixed-markdown-v1. **These are reported signals, not a causal conclusion.** No raw PDF error text is included or reproduced. The compact standalone evidence is `pdf-failure-observations.json` in the evidence directory.

## Four real lanes

All four lanes pass initialization, 53-tool discovery, owned configuration, file operations, manager read-only denial, search completion/pagination, shell blocklist and owned-process output/tree cleanup. Search observations independently cover six unique markers through pages of 2/2/2, stable session identity and final hasMoreResults=false. All four native ripgrep digests match the prior independently verified exact npm binaries. Tool arrays differ only in kill_process.description between control and candidate.

Both Windows lanes also pass PDF creation/read fidelity and admission release, completing all ten stages. Each recorded a 19,629-byte PDF. Control PDF SHA-256 is `76e91a5ac0ed4a10a0f7f7d94c68bc067f6a5675cfe21e5b0165d236d9e42af8`; candidate is `3ceaa4053a161cbdaad1c77192de48d4667e97e61e093a10c3ef5443c0106445`. Linux admission-release stages were not reached. Every lane records child exit 0 and gateway/upstream/owned process-tree shutdown.

## Identity and preservation

The candidate's real parents are `92f5579bdb8365013600fa210755f0671a23b868` and verified main `499255adf0c3988558eb4b1dd04ee95ad3c7da33`. All four logs record PR checkout `8541a7cda61d3b73ea3dc6e8652965afbf223f51`, whose tree exactly equals the candidate tree and whose parents are the current base and candidate. Actual main remains 499255ad.

All 26 checked package-manifest, lock and static-artifact evidence files remain unchanged. Both actual-main qualification receipts are committed byte-for-byte in this candidate.

## Preserved artifacts

| Platform | Artifact ID | ZIP bytes | Independently verified GitHub SHA-256 |
|---|---:|---:|---|
| Ubuntu | 13978086556 | 46,484 | `a89f3b5be0631c4176e28792414f36bee6129b89dd51a1774b4b3f9287b31158` |
| Windows | 13977114753 | 46,280 | `07bd561cfa368d087258a5fbea42c827e63c483b5b5e4f7be4e4253991652c11` |

Both ZIPs match API/upload-log digests. Complete decoded logs total **137,875 bytes**. Logs, 20 extracted reports, hashes, API identity and independent checks remain under `peer-access24-ad4dc29f-evidence`. This receipt does not approve a merge, alter the failed gate or claim production rollout. No mutation, retry or local upstream execution was performed.
