# Access PR24: exact hosted qualification receipt

**Status: blocked.** Run [43285538231](https://github.com/MulattoTech/MTechLabs-Access/actions/runs/43285538231), attempt 1, completed with failure. No retry, source edit, GitHub mutation or local upstream execution was performed by this reviewer.

## Source identity

- Candidate: `e7a4e434cc2c2b0c979cba94c273593bc6c80b28`.
- Candidate tree: `8959c7e93a15acbfd6c6c43e3d6e390ffcca7f8f`.
- Base: `ba4a55b7ed351f7e60928179edaa7449de00be7d`.
- Hosted PR checkout: `6fe2df3875a3092b0d2d6198004154d8fa4b9aaf`. Every job log records this checkout. Its Git tree equals the candidate tree, and its parents are the exact base and candidate.
- All **19 committed artifact/license evidence files** match the final static audit bytes by independent Git blob hashing.

## Four required jobs

| Exact check name | Job ID | Outcome | Test counts |
|---|---:|---|---|
| Upstream qualification / windows-latest / Node 24 | 131417855004 | failure | 83/90 pass, 7 fail, 0 skip |
| test | 131417855594 | success | 123/123 pass, 0 fail, 0 skip |
| Upstream qualification / ubuntu-latest / Node 24 | 131417855693 | failure | 90/90 pass, 0 fail, 0 skip |
| managed-mcp | 131417855791 | success | 90/90 pass, 0 fail, 0 skip |

Every job used Node **v24.22.2** and npm **11.19.1**. All test suites reported zero cancellations. Root test also passed check/build/generated-UI verification. Both qualification jobs passed the final tracked-source diff check.

## Ubuntu real-upstream result

The guard suite passed 90/90. Both installed, admitted lanes then passed initialization, the full 53-tool discovery, owned configuration, file read/write/metadata and manager read-only denial. Both stopped at `content_search_completion_and_pagination` with `failureCode: qualification_assertion_failed` and `rpcErrorCode: null`.

The report contains **no search observations or assertion actual/expected values**. It therefore does not identify the precise violated assertion or establish a candidate-specific regression. Both owned gateway/upstream process trees exited, with child exit code 0.

Independent comparison of the archived 53-tool arrays confirms equal names and every non-description field. The only field change is `kill_process.description`, matching the earlier static audit.

Both ripgrep-install logs contain a successful rebuild line followed by npm's warning that two install scripts are not yet covered by `allowScripts`. This is preserved as an observation, without claiming the intended binary ran or assigning the search failure to it.

## Windows result

The guard suite passed 83/90. Seven tests failed with `qualification_root_not_separate`, all raised at `createQualificationWorkspace` line 60 through the common fixture at test line 67. The real-upstream comparison step was skipped. The artifact upload reported no files; there is no Windows upstream qualification artifact.

## Preserved artifact

Ubuntu artifact **13973259442**, `upstream-qualification-ubuntu-latest-43285538231-1`, contains ten report/log files. Downloaded ZIP: **33,776 bytes**. Its independently computed SHA-256 equals the GitHub API and upload-log digest:

`ae5d574a10e00398a4f97797d47ee168a321079f5b5c03c896d26554e76d86fc`

All four complete decoded job logs, the ZIP and safely extracted reports, per-file hashes, exact run/check/job API records, source/merge-tree mapping and committed-evidence comparison are retained in `peer-access24-e7a4e434-evidence`. The JSON receipt records precise lane results, job IDs and log hashes.

This receipt records failed qualification evidence. It does not approve a merge or deployment.
