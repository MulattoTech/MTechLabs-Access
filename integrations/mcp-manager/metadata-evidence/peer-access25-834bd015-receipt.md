# Access PR25 descriptor candidate: failed hosted receipt

**Status: blocked.** Exact candidate `834bd0154a6838475dfdd1c10fd79d162edb7949`, tree `19081c847f0cba092eaba7c5c28423791edec058`, completed [run 43290464737](https://github.com/MulattoTech/MTechLabs-Access/actions/runs/43290464737), attempt 1, with one pass and one failure.

| Exact check | Job ID | Result |
|---|---:|---|
| test | 131435025778 | 123/123 pass, zero failures/skips/cancellations |
| managed-mcp | 131435026308 | 78/79 pass, one failure, zero skips/cancellations |

## Actual failure

`pause rejects queued work without killing an already dispatched command`, declared at `test/gateway.test.mjs:51:1`, fails at `test/gateway.test.mjs:58:44`:

```text
TypeError: Cannot read properties of undefined (reading 'code')
```

This is the same observed test/location/error recorded on Access PR24 candidate1123952b. The receipt does not independently infer its underlying cause. No rerun was requested or performed.

## Exact source and main identity

The candidate parent, PR base and actual main at observation are all `ba4a55b7ed351f7e60928179edaa7449de00be7d`. Both full logs record hosted PR checkout `64d48cb4c3b09172c9d5e63aca21628a072d7dc4`. That merge commit's tree exactly matches candidate tree `19081c847f0cba092eaba7c5c28423791edec058`; its parents are the exact base and candidate.

This independent branch has exactly the two current checks above. It does not include PR24's upstream qualification workflow; no upstream runtime result is attributed to it. The PR was draft/open when read.

## Retained evidence and boundary

Both complete decoded job logs and exact commit/PR/main/check/run/job records are retained in `peer-access25-834bd015-evidence`. Their combined decoded log size is **74,097 bytes**, with individual hashes in the JSON receipt. No source change, GitHub mutation, retry, local upstream execution or production action was performed. The failed managed-mcp gate prevents a successful qualification receipt for this candidate.
