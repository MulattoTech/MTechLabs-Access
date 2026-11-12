# Desktop Commander artifact and lock review evidence

Independent read-only review completed on 2026-11-12. The reviewed source pin is Desktop Commander 0.3.3, compared with 0.3.1. The corrected candidate lock SHA-256 is `1d28de913c330ce071735b594367e110c5752cec5a476d6da8bd327f6f52c143`.

Read `artifact-review.md` for the outcome, identity table, compiled behavior, resolved lock correction and acceptance limits. `artifact-review.json` provides machine-readable identity and decision evidence. The `added-dependencies` directory covers all 31 added lock paths / 29 unique artifacts and preserves complete shipped license text plus detected embedded notices.

`lock-audit/libc-drift-evidence.json` is historical failure evidence. `lock-audit/libc-repair-receipt.json` records its independently checked correction; all unrelated existing lock entries now exactly match control. No artifact identity or unrelated lock-drift blocker remains within this static review.

This evidence permits assessment of the exact candidate. It does not establish runtime tool compatibility, Windows process behavior, baseline native prerequisites, complete source build reproduction, cryptographic registry/Sigstore trust, final redistribution clearance, or a production rollout. No upstream code or lifecycle hook was executed, and neither repository nor production was changed by the reviewer.

`FILE-SHA256.json` hashes the files in this subset. Original downloaded archives and full static extraction evidence remain outside this subset. Parent-directory source locks are independently identified by their exact hashes; they are not duplicated here.
