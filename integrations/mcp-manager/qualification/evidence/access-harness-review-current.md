# Access upstream harness current-tree review

Unfrozen source review; no immutable approval yet. No actual upstream package was executed.

## Confirmed boundaries

- Module import remains inert; explicit hosted-only guard precedes installation and workspace creation.
- Fresh hosted account boundary explicitly required because environment redirection does not contain os.userInfo().homedir.
- No production verifier or live config path is invoked. Custom transport is EOF-only, with no broad timed kill.
- Separate control/candidate stores, exact package/version/lock/integrity checks, sanitized child environment and full descriptor comparison are present.
- Network and bounded-test limitations are explicit; runtime/plugin/deployment claims remain separate.

## Findings

### AQ-1 — shell_blocklist

Command text itself contained blocked; ordinary command-not-found could satisfy generic denial regex.

Strict error prefix, structured blocked:true and exact command plus absent owned prefix-marker. Inspected compiled 0.3.1 and0.3.3 shapes support this assertion.

### AQ-2 — owned_configuration

Actual returned configuration values are not compared; hasConfigurationObject accepts mismatched roots/telemetry/blocked commands while the separate file assertion merely confirms harness-authored bytes.

Assert exact required fields from the actual returned configuration; add wrong-configuration rejection fixture.

### AQ-3 — owned_process_output_and_tree_cleanup

Requested three-line tail can pass when all 300 fixture marker lines are returned, since assertion only searches for marker299.

Assert exact returned marker sequence/count and bounded output; add full-buffer response rejection fixture.

