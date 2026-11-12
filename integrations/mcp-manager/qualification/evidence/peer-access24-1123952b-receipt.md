# Access PR24: second hosted qualification receipt

**Status: blocked.** Candidate `1123952bfb1dee0c74d418ecd0833c1e9e34018d`, tree `4e6ae029da84181d454c2708e3ea066e9b7582a1`, completed [run 43286995191](https://github.com/MulattoTech/MTechLabs-Access/actions/runs/43286995191), attempt 1, with one successful job and three failures. No retries occurred.

## Four canonical checks

| Check | Job ID | Result | Tests |
|---|---:|---|---|
| managed-mcp | 131422907065 | failure | 89/90 pass, 1 fail, 0 skip |
| test | 131422907549 | success | 123/123 pass, 0 fail, 0 skip |
| Upstream qualification / ubuntu-latest / Node 24 | 131422907683 | failure | 90/90 pass, 0 fail, 0 skip |
| Upstream qualification / windows-latest / Node 24 | 131422908159 | failure | 90/90 pass, 0 fail, 0 skip |

All jobs used Node **v24.22.2** and npm **11.19.1**, with zero test cancellations. Both real-upstream jobs passed all 90 guard tests, resolving the earlier Windows workspace-separation obstruction, and both passed their final tracked-source diff check.

The separate managed-mcp job failed `pause rejects queued work without killing an already dispatched command` at `test/gateway.test.mjs:58:44`: `TypeError: Cannot read properties of undefined (reading 'code')`. This receipt does not infer the underlying cause.

## Exact search observations

Both platforms and both upstream versions reported:

```json
{"isError":false,"structured":false,"hasSessionId":false}
```

All four lanes stopped at `content_search_completion_and_pagination`, with `qualification_assertion_failed` and null RPC error code. Pagination was not reached. Successful earlier stages were initialization, full 53-tool discovery, owned configuration, file read/write/metadata and manager read-only denial. All four owned gateway/upstream process trees exited, with child exit code 0.

Independent comparison of each platform's archived tool arrays confirms 53 unique names, equal non-description fields, and only the expected `kill_process.description` change.

## Native binary identity

Both lanes on each platform recorded owned package paths and successful hosted version output: ripgrep **15.0.0**, revision **3a612f88b8**, PCRE2 **10.45**. Independent static downloads matched corrected-lock SRI, registry SRI and registry SHA-1. All **four hosted binary hashes** match those npm bytes:

| Exact package | Binary SHA-256 |
|---|---|
| `@vscode/ripgrep-linux-x64@1.18.0` | `193906679498de4d939345b937fa24e0e69a03c244bd70c859f5e41232713f21` |
| `@vscode/ripgrep-win32-x64@1.18.0` | `f9dde63498b3193f098355dbec97af99dc4f6b8fa0df5ed04114a03012c042cb` |

The reviewer did not execute either binary. Identity and version success do not substitute for completed search/process qualification.

## Checkout and lock identity

All logs record checkout `9c07543ad92348ccdd26db932673715ce22265fb`. Its tree equals the candidate tree; its parents are base `ba4a55b7ed351f7e60928179edaa7449de00be7d` plus candidate `1123952bfb1dee0c74d418ecd0833c1e9e34018d`.

Package manifests, locks and static artifact evidence are unchanged from the prior candidate. Both earlier failed receipt files are committed byte-for-byte. Windows raw lock hashes differ because of CRLF checkout bytes: reconstructing CRLF from the reviewed canonical files reproduces both Windows hashes exactly, with identical parsed JSON.

## Preserved artifacts

| Platform | Artifact ID | ZIP bytes | Verified GitHub ZIP SHA-256 |
|---|---:|---:|---|
| Ubuntu | 13974479660 | 34,394 | `46083415ad9956437d0941ba329a22b060a0446bbef4ae812412f9ea0f19a2be` |
| Windows | 13976365517 | 34,667 | `2bfa014eaec31c702a06e4ee4cc3e9f005bd6cfa1390b33fe6471f845309991f` |

Both ZIP hashes match GitHub API metadata and upload logs. Their 20 extracted report files, all four complete decoded job logs, exact check/run/job records, identity mapping, lock line-ending proof and native comparisons are retained under `peer-access24-1123952b-evidence`. No source/GitHub/production mutation or local upstream execution occurred. This receipt does not approve a merge or rollout.
