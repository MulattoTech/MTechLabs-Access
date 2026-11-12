# Access PR27 initial candidate: independent CI receipt

**All three initial candidate checks passed.** Candidate `0f30a256a56d951595be4abf9791f74f30cb251a`, tree `7d523197fe2356667513271bd2ab14acf2628a18`, completed [run 43296210578](https://github.com/MulattoTech/MTechLabs-Access/actions/runs/43296210578), pull_request attempt 1.

| Exact check | Job ID | Result | Tests |
|---|---:|---|---|
| managed-mcp | 131455101056 | success | 93/93, zero failures/skips/cancellations |
| test | 131455101732 | success | 123/123, zero failures/skips/cancellations |
| managed-mcp-windows | 131455101841 | success | 93/93, zero failures/skips/cancellations |

Every log records checkout `b2136d3c078ca87f3a8d2ff643a50bf1f63ab391`. Its tree equals the candidate tree and its parents are baseline `499255adf0c3988558eb4b1dd04ee95ad3c7da33` plus the candidate. The candidate itself has baseline main 499255ad as its sole parent. Actual main at the final read is `ef8dce0e1863e63958c4421e8506c9bdb5e881e0`; the above checks qualify the earlier baseline only.

The published jobs implementation and new authorization regression file exactly match the previously frozen independent static review, by both SHA256 and Git blob identity. That review found no concrete in-scope remaining finding; it is explicitly a manual review rather than a completed formal security scan.

| Reviewed published file | SHA256 |
|---|---|
| integrations/mcp-manager/lib/jobs.mjs | `081f49980fbe4fc7b9cf541f283dec7b7b0af480e26a71f00e397f6e724c7366` |
| integrations/mcp-manager/test/job-authorization.test.mjs | `40f4678dbf1afab76238dced5aef51247c677acf33db93d27b072c7d2ab0311a` |

Three complete decoded logs total **100,303 bytes**, with hashes and API evidence retained under peer-access27-0f30a256-evidence.

This receipt qualifies the initial three-job source-test candidate only. The branch does not yet contain the upstream qualification workflow; integrating the qualified upstream main requires a new candidate and its expanded checks. No upstream real-lane success, merge, deployment, retry or mutation is claimed.
