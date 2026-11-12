// SPDX-License-Identifier: MIT
// AI-Change: 2026-11-12-engineering-descriptions (OpenAI / GPT-6 Astra Pro; self-reported)
// Static plain text: clients need no Markdown renderer to read these sections.
export const ENGINEERING_DESCRIPTIONS = Object.freeze({
  mterm_math_evaluate: `Purpose: Simplify a mathematical expression and calculate a numerical approximation with isolated SymPy.
Inputs: expression, up to 500 characters; optional precision, 8-100 digits, default 30. Use explicit multiplication, arithmetic, ^ or **, ASCII symbols, pi/E/I, and approved one-argument functions such as sqrt, sin, log and exp.
Permissions: Enabled managed policy and math capability; supported under read-only policy. Python with SymPy must be available.
Result/limits: Returns exact and approximate strings plus precision. Each string is limited to 2,000 characters. Expressions have complexity and exponent limits; the worker has a 10-second timeout and a 6,000-character output cap. Input is parsed as constrained mathematics.
Example: expression="sqrt(2)+1", precision=30.`,
  mterm_math_solve: `Purpose: Ask isolated SymPy to solve one equation for a selected variable.
Inputs: equation, up to 500 characters, with at most one =; without = the expression is set equal to zero. variable is an ASCII identifier of at most 16 characters. Use explicit multiplication and the supported mathematical expression syntax.
Permissions: Enabled managed policy and math capability; supported under read-only policy. Python with SymPy must be available.
Result/limits: Returns variable, solution strings and a truncated flag. At most 32 solutions are retained, each limited to 500 characters; the worker's 6,000-character output cap can reject larger results. The worker times out after 10 seconds. This interface does not accept systems of equations or custom assumptions.
Example: equation="x^2=4", variable="x".`,
  mterm_math_verify: `Purpose: Compare two mathematical expressions by simplifying their symbolic difference with SymPy.
Inputs: left and right, each up to 500 characters, using supported arithmetic, ASCII symbols and approved one-argument functions.
Permissions: Enabled managed policy and math capability; supported under read-only policy. Python with SymPy must be available.
Result/limits: Returns equivalent=true only when simplification produces zero, plus a difference string limited to 2,000 characters. A false result can mean the simplifier did not establish equivalence. Domain restrictions and assumptions require separate reasoning. The worker has a 10-second timeout, complexity limits and a 6,000-character output cap.
Example: left="(x+1)^2", right="x^2+2*x+1".`,
  mterm_math_convert_units: `Purpose: Convert a decimal value between supported units of the same dimension.
Inputs: value as a finite decimal string of at most 80 characters; from and to are case-sensitive unit codes. Length: m, km, cm, mm, mi, ft, in. Mass: kg, g, lb, oz. Time: s, min, h, day. Temperature codes: K, C and F (kelvin, °C and °F).
Permissions: Enabled managed policy and math capability; supported under read-only policy. The configured Python worker requires SymPy to start.
Result/limits: Returns the converted value as a string, source and target units, and dimension. Calculations use decimal arithmetic with 60-digit precision. Unsupported or incompatible pairs fail. The worker has a 10-second timeout and a 6,000-character output cap.
Example: value="25", from="C", to="F".`,
  mterm_system_inventory: `Purpose: Inspect the local host's basic operating-system and hardware inventory.
Inputs: None.
Permissions: Enabled managed policy and systemRead capability; supported under read-only policy. Windows hardware details additionally require usable PowerShell and system inventory commands.
Result/limits: Returns platform, OS release, architecture, logical CPU count, and total/free RAM in bytes. On Windows it also attempts GPU name, adapter memory, driver version, and drive-letter volume size/free-space data. Windows hardware details are null if that query fails; other platforms return the basic fields. The optional Windows query has a 16-second timeout and a 36,000-character output cap. CPU model and temperatures are not collected.`,
  mterm_container_list: `Purpose: Read the local Docker container listing and, on Windows, installed WSL distribution names.
Inputs: None.
Permissions: Enabled managed policy and systemRead capability; supported under read-only policy. Docker and WSL results depend on the installed commands and the host account's access.
Result/limits: docker contains available, raw output and truncated fields from docker ps -a using JSON-line formatting. It includes stopped containers. On Windows, wsl contains the same fields for the quiet distribution listing; elsewhere wsl is null. These are command snapshots, not live streams. Docker output is capped at 14,000 characters with a 12-second timeout; WSL output at 4,000 characters with a 10-second timeout. An unavailable command is reported in its result.`,
  mterm_vm_list: `Purpose: List local Hyper-V virtual machines and their current state and resource allocation.
Inputs: None.
Permissions: Enabled managed policy and vmRead capability; supported under read-only policy. Requires a Windows host, PowerShell and access to Hyper-V commands.
Result/limits: Returns JSON from Get-VM with name, state, generation, processor count, startup memory, assigned memory and uptime. The PowerShell JSON shape can vary for zero, one or multiple records. The query has a 16-second timeout and a 36,000-character output cap; command failure or truncated output returns an error. Use mterm_vm_inspect for one VM's adapters, disks and checkpoints.`,
  mterm_vm_inspect: `Purpose: Inspect one local Hyper-V VM's configuration and related resources.
Inputs: name is the exact VM name, 1-80 characters using ASCII letters/digits, spaces, or _ . ( ) -.
Permissions: Enabled managed policy and vmRead capability; supported under read-only policy. Requires Windows, PowerShell and access to Hyper-V commands.
Result/limits: Returns VM state, generation, CPU and memory settings, automatic start/stop actions, network adapters, attached disk locations and checkpoint names/times/types. Adapter data may include MAC and IP addresses; disk data includes local paths. The query has a 16-second timeout and a 36,000-character output cap; failure or truncation returns an error.
Example: name="dev-vm".`,
  mterm_vm_network_map: `Purpose: Inspect Hyper-V virtual switches and their VM network adapters on the local host.
Inputs: None.
Permissions: Enabled managed policy and vmRead capability; supported under read-only policy. Requires Windows, PowerShell and access to Hyper-V commands.
Result/limits: Returns switches with names, switch types and host interface descriptions, plus adapters with VM/name, switch name, MAC address, status and reported IP addresses. This is a configuration snapshot; it does not probe connectivity. The query has a 16-second timeout and a 36,000-character output cap. Command failure or truncated output returns an error.`,
  mterm_vm_disk_health: `Purpose: Inspect metadata for virtual disks attached to local Hyper-V VMs.
Inputs: None.
Permissions: Enabled managed policy and vmRead capability; supported under read-only policy. Requires Windows, PowerShell and access to Hyper-V VM and virtual-disk commands.
Result/limits: Returns each attached disk's VM name, local path, virtual capacity, backing-file size and VHD type. Despite the tool name, these fields do not establish disk integrity, SMART health or available host-volume space. A disk that cannot be inspected can fail the whole query. The query has a 16-second timeout and a 36,000-character output cap; failure or truncation returns an error.`,
  mterm_vm_diagnostics: `Purpose: Read recent warnings and errors from the local Hyper-V management event log.
Inputs: Optional hours is an integer from 1 to 168; default 24.
Permissions: Enabled managed policy and vmRead capability; supported under read-only policy. Requires Windows, PowerShell and access to the Hyper-V VMMS Admin event log.
Result/limits: Reads up to 40 events at warning/error levels from Microsoft-Windows-Hyper-V-VMMS-Admin within the lookback window. Returns event time, ID, level name and message. This covers that log rather than all guest or Hyper-V diagnostics. The query has a 16-second timeout and a 36,000-character output cap; truncated output returns an error.
Example: hours=48.`,
  mterm_vm_change_plan: `Purpose: Read a VM's current state and return advisory details for a proposed power or checkpoint action.
Inputs: Exact name, 1-80 characters using ASCII letters/digits, spaces, or _ . ( ) -; action is start, shutdown or checkpoint.
Permissions: Enabled managed policy and vmRead capability; supported under read-only policy. Requires Windows, PowerShell and Hyper-V access. vmPower is required for the later execution tool, not this preview.
Result/limits: Returns previewOnly=true, VM name/state, requested action, a static risk statement and execution prerequisites. It does not perform the action or verify all prerequisites, disk headroom or guest readiness. The state query has a 16-second timeout and a 36,000-character output cap.
Example: name="dev-vm", action="checkpoint".`,
  mterm_vm_start: `Purpose: Start a named local Hyper-V VM.
Inputs: name and confirmName must match exactly. The VM name is 1-80 characters using ASCII letters/digits, spaces, or _ . ( ) -.
Permissions: Enabled managed policy, writable policy and vmPower capability. Requires Windows, PowerShell and Hyper-V access. Manager memory and disk admission checks must pass.
Result/limits: Invokes Start-VM and returns the reported name and state. Starting the VM consumes host resources; the returned state does not establish guest application readiness. The command has a 30-second timeout and a 36,000-character output cap. A timeout or command error requires checking the VM's actual state before another attempt.
Example: name="dev-vm", confirmName="dev-vm".`,
  mterm_vm_shutdown: `Purpose: Request shutdown of a named local Hyper-V VM.
Inputs: name and confirmName must match exactly. The VM name is 1-80 characters using ASCII letters/digits, spaces, or _ . ( ) -.
Permissions: Enabled managed policy, writable policy and vmPower capability. Requires Windows, PowerShell and Hyper-V access.
Result/limits: Invokes Stop-VM with -Shutdown and -Passthru, then selects name and state. It supplies no force or turn-off flag. Acceptance of the command and guest shutdown depend on the host. Guest services can be interrupted. The command has a 30-second timeout and a 36,000-character output cap; after an error or timeout, inspect the VM before another attempt.
Example: name="dev-vm", confirmName="dev-vm".`,
  mterm_vm_checkpoint_create: `Purpose: Create a timestamp-named checkpoint for a local Hyper-V VM.
Inputs: name and confirmName must match exactly. The VM name is 1-80 characters using ASCII letters/digits, spaces, or _ . ( ) -.
Permissions: Enabled managed policy, writable policy and vmPower capability. Requires Windows, PowerShell and Hyper-V access. Manager memory and disk admission checks must pass.
Result/limits: Requires at least one attached disk and measurable free space of at least 10 GiB on each checked disk volume before calling Checkpoint-VM. Returns checkpoint name, VM name and created=true on success. Checkpoints consume disk space. The code does not select or verify production checkpoint type. The command has a 30-second timeout and a 36,000-character output cap; inspect actual checkpoints after uncertainty.
Example: name="dev-vm", confirmName="dev-vm".`,
  mterm_repo_inspect: `Purpose: Inspect a configured Git repository's branch, tracked changes and available development entry points.
Inputs: rootId identifies a configured local root; optional relativePath defaults to . and must select the Git repository's top-level directory within that root.
Permissions: Enabled managed policy and codeRead capability; supported under read-only policy.
Result/limits: Returns branch, HEAD, clean, modifiedFiles, statusTruncated, recognized top-level manifest names and up to 50 package script names marked as defined. clean and modifiedFiles exclude untracked files. Status is capped at 14,000 characters and 200 lines; manifest discovery samples up to 100 directory entries. Script bodies are not returned or executed. Git queries have 15-second timeouts.
Example: rootId="project", relativePath=".".`,
  mterm_code_diagnostics: `Purpose: Gather Git whitespace diagnostics and Node.js syntax checks for changed tracked JavaScript files.
Inputs: rootId and optional relativePath, default .; the selected directory must be the Git repository's top level within a configured root.
Permissions: Enabled managed policy and codeRead capability; supported under read-only policy. Manager memory and disk admission checks must pass.
Result/limits: Compares against HEAD and runs node --check on at most 25 changed .js, .mjs or .cjs files. Returns whitespace and per-file summaries plus moreFilesSkipped. It does not run project modules, scripts or tests, or perform type/semantic analysis. Each syntax command has an 8-second timeout and 4,000-character output cap; Git evidence is bounded. Serialized results over 48,000 characters fail. Untracked files are excluded.
Example: rootId="project".`,
  mterm_code_review_diff: `Purpose: Return bounded Git diff evidence for human or assistant review.
Inputs: rootId and optional relativePath, default ., selecting the repository top level. Optional base defaults to HEAD; accepts a simple ref of up to 80 ASCII letters/digits or _ . / -, rejecting a leading hyphen or consecutive dots.
Permissions: Enabled managed policy and codeRead capability; supported under read-only policy.
Result/limits: Returns base, whitespace diagnostics, diff statistics and a patch with two context lines. The comparison is from base to the current tracked working tree; untracked files are excluded. Output caps are 4,000 characters each for whitespace/statistics and 25,000 for the patch, with exit, timeout and truncation fields. Git commands have 15-second timeouts. This evidence does not certify correctness or security.
Example: rootId="project", base="HEAD".`,
  mterm_code_symbols: `Purpose: Find declaration-like lines in tracked working-tree files using a lexical pattern.
Inputs: rootId, optional relativePath defaulting to ., and query. The selected directory must be the repository top level. query is an ASCII identifier of 1-80 characters, beginning with a letter, _ or $, then letters/digits, _ or $.
Permissions: Enabled managed policy and codeRead capability; supported under read-only policy.
Result/limits: Uses Git grep with a regular expression for common function, class, def, interface, type and variable declarations. Returns identifier, up to 150 matching lines and a command-output truncated flag, with an 18,000-character capture limit and 15-second timeout. Heuristic matches can miss declarations or include unrelated text; this is not a compiler symbol index.
Example: rootId="project", query="fetchData".`,
  mterm_code_references: `Purpose: Find literal occurrences of an identifier-shaped string in tracked working-tree files.
Inputs: rootId, optional relativePath defaulting to ., and symbol. The selected directory must be the repository top level. symbol is an ASCII identifier of 1-80 characters, beginning with a letter, _ or $, then letters/digits, _ or $.
Permissions: Enabled managed policy and codeRead capability; supported under read-only policy.
Result/limits: Uses fixed-string Git grep, so longer identifiers, comments and strings may also match. Returns identifier, up to 150 matching lines and a command-output truncated flag. Captured output is limited to 18,000 characters and the command to 15 seconds. This is a text search, not semantic reference resolution; clipped results may be incomplete.
Example: rootId="project", symbol="fetchData".`,
  mterm_test_run: `Purpose: Execute one allowlisted test or validation command in a configured Git repository.
Inputs: rootId, optional relativePath defaulting to ., and command: npm-test, npm-lint, pytest or git-diff-check. The selected directory must be the repository top level.
Permissions: Enabled managed policy, writable policy and testRun capability. Manager memory and disk admission checks must pass, including for git-diff-check. Repository scripts can execute code and change files.
Result/limits: Runs npm test; npm run lint --if-present; python -m pytest -q; or git diff --check HEAD. Missing npm lint scripts may succeed because of --if-present. Returns command, success, exit code, output, truncation and timeout fields. Each command has a 60-second timeout and a 24,000-character output cap. Timeout termination targets the direct child; descendants may need inspection.
Example: rootId="project", command="npm-test".`,
  mterm_patch_apply_checked: `Purpose: Validate a Git patch against an expected HEAD and optionally apply it to the working tree.
Inputs: rootId, optional relativePath defaulting to ., patch of 10-20,000 characters, expectedHead as 40 lowercase hexadecimal characters, and explicit apply=true or false. The selected directory must be the repository top level.
Permissions: Enabled managed policy, writable policy and repoWrite capability are required even when apply=false.
Result/limits: Checks current HEAD once, runs git apply --check, and only applies the patch after a successful check when apply=true. Returns applied plus check/apply summaries; a successful preview also returns dryRun=true. Each Git operation has a 15-second timeout; check/apply output is capped at 5,000 characters each. Validation does not run tests or guarantee patch correctness, and the HEAD check is not an atomic lock.
Example: Use apply=false with the HEAD returned by mterm_repo_inspect.`,
  mterm_git_worktree_create: `Purpose: Create a separate Git worktree and a new branch from the selected repository's HEAD.
Inputs: rootId, optional relativePath defaulting to ., and a unique name of 2-40 characters: a lowercase ASCII letter followed by lowercase letters, digits or hyphens. The selected directory must be the repository top level.
Permissions: Enabled managed policy, writable policy and repoWrite capability. Manager memory and disk admission checks must pass.
Result/limits: Creates branch mterm/name and a destination under the manager's worktree directory. Existing destinations or branches prevent creation. Returns created, branch, destination on success, and a command summary. The source checkout is not switched; uncommitted changes are not copied into the new worktree. The Git command has a 30-second timeout and a 4,000-character output cap.
Example: rootId="project", name="review-one".`,
  mterm_job_submit: `Purpose: Queue one persistent repository diagnostics, test or Hyper-V inventory job and return its ID.
Inputs: kind is repo_diagnostics, run_tests or vm_inventory. Repository kinds require rootId and explicit relativePath, such as .; run_tests also requires command: npm-test, npm-lint, pytest or git-diff-check. The repository path must select its Git top level for execution.
Permissions: Enabled managed policy, writable policy and jobs capability. Submission also checks vmRead for VM inventory, codeRead for repository jobs, and testRun for tests. Tests can execute repository code and change files.
Result/limits: Returns ID, kind, queued state and creation time. Submission is blocked at 100 queued jobs or 1,000 retained records. Execution requires an active runner and writable policy; concurrency and timeout are configured. Inspect status/logs using the returned ID.
Example: kind="repo_diagnostics", rootId="project", relativePath=".".`,
  mterm_job_status: `Purpose: Read the durable state of a previously submitted job.
Inputs: id is the returned job UUID.
Permissions: Managed tools must be enabled. Supported under read-only policy and still available when the jobs capability is disabled.
Result/limits: Returns ID, kind, state, rootId, creation/update/start/finish timestamps, cancelRequested and resumeCount. States include queued, running, succeeded, failed, cancelled and interrupted. This reads one stored snapshot rather than waiting for completion. A cancellation request does not establish that child or descendant work has ended. Use mterm_job_logs for stored result evidence. An unknown ID currently returns an error through the tool wrapper.
Example: Call with the id returned by mterm_job_submit.`,
  mterm_job_logs: `Purpose: Retrieve stored result evidence and any recorded error for a job.
Inputs: id is the returned job UUID.
Permissions: Managed tools must be enabled. Supported under read-only policy and still available when the jobs capability is disabled.
Result/limits: Returns state, error, result and a note; an unknown ID returns null. Results normally appear after completion, so an active or cancelled-before-start job may have no result. Evidence is stored after execution rather than streamed live. Serialized job results over 48,000 characters are replaced by a truncation notice; the complete tool response also has a 48,000-character limit. Resuming a job clears its previous stored result and error.
Example: Call with the id returned by mterm_job_submit.`,
  mterm_job_cancel: `Purpose: Cancel a queued job or request interruption of a running job.
Inputs: id is the returned job UUID.
Permissions: Enabled managed policy, writable policy and jobs capability.
Result/limits: A queued job becomes cancelled immediately. A running job receives cancelRequested=true; the runner polls for that request and attempts to abort supported commands. Running work normally finishes as interrupted after the abort is observed. Cancellation targets direct child processes, does not guarantee descendant termination, and cannot interrupt the VM inventory command through its signal. Completed or other terminal-state jobs are returned unchanged. Returns a status snapshot; an unknown ID fails. Check status/logs and actual effects before requeueing.
Example: Call with the id of the job to stop.`,
  mterm_job_resume: `Purpose: Explicitly requeue a failed, interrupted or cancelled job from the beginning.
Inputs: id is the returned job UUID; confirm must be true after checking the previous outcome and possible remaining work.
Permissions: Enabled managed policy, writable policy and jobs capability. Execution still requires an active runner and writable policy.
Result/limits: Reuses the job ID and original kind, repository and command; it does not continue a suspended process or resume from partial progress. Clears prior result/error, start/finish timestamps and cancellation request, increments resumeCount, and returns queued status. Each job can be requeued at most three times. Queued, running or succeeded jobs cannot be resumed. Reexecution can repeat effects left by the previous attempt; inspect the previous evidence before calling.
Example: Use the id returned by mterm_job_submit with confirm=true.`,
});
