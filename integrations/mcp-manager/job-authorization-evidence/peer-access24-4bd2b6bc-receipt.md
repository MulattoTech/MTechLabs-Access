# Access PR24 candidate4bd2b6bc: independent hosted receipt

**All four candidate checks passed.** Exact head `4bd2b6bc5aeeec17e4b076eec4947081d2363c1d`, tree `fe52f5d5720c6a34ee6bbec387b1dc098ea8f2d3`, completed [run 43295709466](https://github.com/MulattoTech/MTechLabs-Access/actions/runs/43295709466), pull_request attempt1. This is candidate qualification; actual main remained `499255adf0c3988558eb4b1dd04ee95ad3c7da33`.

| Required check | Job ID | Result | Source/guard tests |
|---|---:|---|---|
| test | 131453368713 | success | 123/123, zero failures/skips/cancellations |
| managed-mcp | 131453369219 | success | 101/101, zero failures/skips/cancellations |
| Upstream qualification / ubuntu-latest / Node 24 | 131453369237 | success | 101/101, zero failures/skips/cancellations |
| Upstream qualification / windows-latest / Node 24 | 131453369301 | success | 101/101, zero failures/skips/cancellations |

Both upstream jobs also passed tracked-source preservation. All jobs used Node v24.22.2 / npm11.19.1; real reports bind libuv1.52.1, SDK1.32.2 and zero model calls.

## Four real package lanes

Both versions,0.3.1 control and0.3.3 candidate, passed all ten stages on Linux and Windows: initialization,53-tool discovery, owned configuration, file operations, manager read-only denial, search completion/pagination, shell blocklist, owned-process output/tree cleanup, PDF creation/readback and admission release. All lanes recorded gateway child exit0 and upstream/owned-process-tree shutdown.

| Platform | Lane | PDF bytes | Reported PDF SHA256 |
|---|---|---:|---|
| linux | control | 13,242 | `39672a1190a40fa57cceedf8c8874558bb6ebb1f9540c038886009682412b2d4` |
| linux | candidate | 13,242 | `35cfb60ce1a487dca301b8171093b8186b30f7ad26b5fb3f3fccaa7bb3822e55` |
| win32 | control | 19,629 | `6a030e5b36769dde4d670a00757fec4e06fb91427b64664fa61007dfa6031c66` |
| win32 | candidate | 19,629 | `e69a9f0c7b8db7e39bf0e43b17d80fff0c78dfbb4fddde0b08c29facedea712f` |

Independent report checks confirm six unique search markers through pages2/2/2, stable session identity and final exhaustion. The53-tool arrays have identical non-description fields; only kill_process.description differs between control and candidate. All four native ripgrep hashes match independently verified exact npm artifacts. No pdfFailure remains in any lane.

## Assertions and source identity

The PR checkout `d9d9188b9c8d9321328f5d5b5334178cd72a4da6` has the exact candidate tree and parents actual main499255ad plus candidate4bd2b6bc. The candidate has sole parentad4dc29f. The exact qualify-upstream, verify-clients and gateway blobs are unchanged fromad4. All26 checked manifests, locks and static audit-evidence files are unchanged, and the prior failed receipt plus actual-main receipt are committed exactly.

The only executable/configuration differences are the shorter owned workspace prefix, three fixed diagnostic patterns, matching artifact-upload glob, and additive tests. PDF size/signature/readback criteria, process and permission assertions, EOF cleanup, host/ownership guards and Chrome/environment behavior remain unchanged. The successful intervention supports the temp-geometry hypothesis; it does not establish the unrecorded original fatal error.

## Preserved evidence

| Platform artifact | ID | ZIP bytes | Verified GitHub SHA256 |
|---|---:|---:|---|
| upstream-qualification-ubuntu-latest-43295709466-1 | 13980085028 | 45,543 | `9a9543cf9e57a67559b6f59c1190184707fb3ec4820a3615a93ff2cf76c1458a` |
| upstream-qualification-windows-latest-43295709466-1 | 13979616151 | 45,784 | `be02f1e6c8d483aa5207aa1006fa2db812d0a5a5acfd4a938d27e94e3861e4bb` |

Both ZIPs match API and upload-log digests. Four complete decoded logs total **138,315bytes**. Twenty extracted reports, per-file hashes, API identities and independent consistency checks are retained under peer-access24-4bd2b6bc-evidence.

This receipt establishes the bounded candidate qualification only. It does not claim actual-main qualification, deployment or full mission acceptance. No retry, repository/GitHub mutation, or local upstream execution occurred.
