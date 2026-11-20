# Access #44 — R43/R45 isolated Windows source-fix candidate

**STATUS: PROPOSED SOURCE CORRECTION ONLY. NOT REVIEWED FOR MERGE, HOSTED-QUALIFIED, INSTALLED OR AUTHORIZED FOR DEV.**

**R45 follow-up:** The original R43 checkpoint changed one character-buffer allocation. A later source review found another `New-Object` invocation for native snapshot construction. The current candidate replaces **both** invocations with typed constructors and updates the source/diagnostic hashes. See [R45 constructor review](R45-NATIVE-CONSTRUCTOR-REVIEW.md) and its synthetic PowerShell tests. The historical R43 details and receipt below describe the earlier commit `b090674b359512dc50749f55f65170e1ac393e2a`, not the full current candidate.

Branch: `fix/access44-r43-native-array-candidate-20261120`

Exact starting commit: `f0855c1227aacc49071581bb52ba5566bc07ffce` (PR #45 draft head at branch creation).
Primary references: [Access issue #44](https://github.com/MulattoTech/MTechLabs-Access/issues/44), [isolation issue #46](https://github.com/MulattoTech/MTechLabs-Access/issues/46), [prior R42 source-bound investigation](https://github.com/MulattoTech/MTechLabs-Access/commit/91effa38ed146721fa71c4ee3f5df3a9260a3971).

## Original R43 candidate and rationale (historical)

In integrations/mcp-manager/windows-runtime-probe.ps1, replace exactly one command:

    $buffer = New-Object char[] 16385

with:

    $buffer = [char[]]::new(16385)

The buffer remains a zero-initialized System.Char array with length 16,385; the original read loop and 16,384-character input limit are unchanged. The intrinsic .NET array constructor no longer relies on resolving the New-Object PowerShell cmdlet at that specific source point. This is an *informed hypothesis*, not a proven cause or correction for the historical hosted failure.

The failed R6 Windows logs independently showed native-capture child-process termination after approximately 15 seconds in both mandatory Windows jobs, and an auxiliary non-acceptance diagnostic stopped at marker 78 immediately before the old command, without marker 79. It could not identify the true underlying cause. The current R7 five-job run failed before any steps, so no hosted evidence tests this candidate.

The second modified production-repository file, test/fixtures/reference-transport-child.mjs, updates the original PowerShell command's **four** diagnostic string anchors and refreshes the **two** frozen source/derivative SHA-256 constants. All **32** diagnostic anchor names remain. The diagnostic remains *failure-only* and explicitly non-acceptance evidence; no native-process/transport assertion, security policy, identity validation or deadline was relaxed.

## Original R43 local isolated checks and results (historical)

- 15/15 Node built-in-only tests in [native-array-source-candidate.test.cjs](native-array-source-candidate.test.cjs) passed. They verify single-line patch reversibility against the immutable PR45 probe SHA, exact six-edit diagnostic reconstruction against its original Git blob, unchanged caller/identity/transport controls, 32-anchored pure derivative transformation, correct new pinned SHA-256 values and unchanged 15-second native-capture timeout.
- Windows PowerShell 5.1 and PowerShell 7 both parsed the candidate probe without errors and created the same type and length of zeroed buffer using the new expression. [verify-native-array-ps5.ps1](verify-native-array-ps5.ps1) is source/AST-only and **does not invoke the runtime probe**.
- The local Node version used for source-only tests was 27.0.0-alpha.0.0.0; these checks do **not** replace frozen hosted Node 24 native Windows tests. No npm installation, copied package execution, remote network call or Windows account/ACL mutation was performed.

Run the isolated tests in this candidate checkout without invoking the manager's native fixture:

    node --test docs/engineering/2026-11-20-native-array-candidate/native-array-source-candidate.test.cjs
    powershell.exe -NoLogo -NoProfile -NonInteractive -File docs/engineering/2026-11-20-native-array-candidate/verify-native-array-ps5.ps1

## Mandatory acceptance remains unchanged

1. Independently review this precise two-file source change and its new hash pins. If the PR45 head or source tree changed, rebase/re-review explicitly; never apply a stale patch silently or treat this separate branch as already incorporated into PR45.
2. After GitHub Actions admission/billing is restored, run a genuinely hosted **Windows Node 24** candidate qualifying both managed-mcp-windows and Windows upstream-qualification jobs, including all 18 native disposable identity, pipe, protected-key and cleanup cases. Exact source identity and final natural cleanup are required. Owner-machine tests cannot substitute, and no hosted runner environment variables may be faked.
3. Preserve the exact unchanged Linux/Windows upstream 0.3.1 control and 0.3.3 candidate package/PDF fidelity stages (including the unresolved R6 control PDF timeout); preserve fail-closed error classification and don't increase timeouts merely to make a test pass. Require complete source review, immutable job logs/artifacts, and all five hosted jobs to pass.
4. Only after source acceptance consider a normal expected-head PR45 merge, followed by **distinct** actual-main hosted acceptance and issue #44 closeout evidence.
5. Only in a separate owner-approved operational change under issue #46, establish protected production and DEV parent namespaces, a real standard DEV account/token, negative ACL canaries, independent secrets/routing and rehearsed backup/rollback. Production remains in H: for now; DEV and port 19741 remain inactive.

**This branch is a reviewable source candidate, not a promise of successful native security qualification, an authorization to run or merge CI, or a production/DEV deployment.**
