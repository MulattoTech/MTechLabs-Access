"""Low-cost, metadata-only PR backlog management for agent-driven repositories.

No PR code is checked out/executed. Never closes a PR or bypasses protections.
"""
import datetime as dt
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

REPO = os.environ["GITHUB_REPOSITORY"]
OWNER = REPO.split("/")[0].lower()
TOKEN = os.environ["GITHUB_TOKEN"]
P = "/repos/" + REPO
NOW = dt.datetime.now(dt.timezone.utc)
KINDS = ("ready", "running", "failed", "behind", "conflict", "stale", "draft", "review")
MANAGED = {"agent-triage:" + kind for kind in KINDS}
# Secure access/IPC workflows must pass all named jobs, not an arbitrary
# successful check. The main branch must independently enforce these checks.
REQUIRED_JOBS = frozenset({
    "test",
    "managed-mcp",
    "managed-mcp-windows",
    "Upstream qualification / ubuntu-latest / Node 24",
    "Upstream qualification / windows-latest / Node 24",
})
# Access is a security-sensitive repository. Automatic enrollment, including
# explicit opt-in, is limited to simple non-sensitive documentation edits.
PROTECTED_PR_NUMBERS = frozenset({45})
SENSITIVE_DOC_FRAGMENTS = (
    "/security", "/spec", "/runbooks", "/private", "/policy", "/maintainer",
    "/agents", "auth", "secret", "credential", "token", "/keys",
)


def safe_documentation_file(item):
    """Require a simple Markdown addition/edit, never a rename or unknown type."""
    if not isinstance(item, dict) or item.get("status") not in ("added", "modified"):
        return False
    # GitHub's changed-file filename is the new path of a rename; ignoring
    # previous_filename would allow src/auth.js -> docs/guide.md.
    if "previous_filename" in item:
        return False
    name = item.get("filename")
    if not isinstance(name, str) or not name.startswith("docs/") or not name.endswith(".md"):
        return False
    if (name != name.strip() or "\\" in name or "%" in name or
            any(part in ("", ".", "..") for part in name.split("/")) or
            any(ord(char) < 32 or ord(char) == 127 for char in name)):
        return False
    return not any(fragment in name.lower() for fragment in SENSITIVE_DOC_FRAGMENTS)


def api(method, path, payload=None, *, graphql=False):
    url = "https://api.github.com/graphql" if graphql else "https://api.github.com" + path
    req = urllib.request.Request(
        url, method=method, data=None if payload is None else json.dumps(payload).encode(),
        headers={"Authorization": "Bearer " + TOKEN,
                 "Accept": "application/vnd.github+json",
                 "X-GitHub-Api-Version": "2022-11-28",
                 "Content-Type": "application/json",
                 "User-Agent": "agent-pr-backlog-triage"})
    try:
        with urllib.request.urlopen(req, timeout=25) as response:
            raw = response.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"GitHub API HTTP {exc.code}: {exc.read(250).decode('utf-8', 'replace')}") from None


def get(path):
    return api("GET", P + path)


def timestamp(value):
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))


def prs():
    found = []
    for page in (1, 2, 3):
        batch = get("/pulls?state=open&sort=updated&direction=desc&per_page=100&page=" + str(page))
        found.extend(batch)
        if len(batch) < 100:
            break
    return found


def code_age_days(pr):
    # Labels/comments mutate pull_request.updated_at; use the actual head
    # commit timestamp so classification cannot refresh itself indefinitely.
    try:
        commit = get("/commits/" + pr["head"]["sha"])
        date = commit["commit"]["committer"]["date"]
        return max(0, (NOW - timestamp(date)).days)
    except (RuntimeError, KeyError, TypeError, ValueError):
        return 365  # Fail closed: never auto-merge a commit with unknown age.


HOSTED_WORKFLOW_ID = 402397153  # Verified .github/workflows/check.yml
HOSTED_WORKFLOW_PATH = ".github/workflows/check.yml"
HOSTED_REQUIRED_STAGES = {
    "test": frozenset({"Run npm test", "Run npm run check", "Run npm run build",
                       "Check generated UI matches its sources"}),
    "managed-mcp": frozenset({"Run npm test"}),
    "managed-mcp-windows": frozenset({"Run npm test"}),
    "Upstream qualification / ubuntu-latest / Node 24":
        frozenset({"Compare real pinned upstream packages in disposable stores",
                   "Preserve exact qualification and contract evidence"}),
    "Upstream qualification / windows-latest / Node 24":
        frozenset({"Compare real pinned upstream packages in disposable stores",
                   "Preserve exact qualification and contract evidence"}),
}


def hosted_job_evidence(sha, matching_checks):
    """Exact hosted workflow/run/job/step metadata for five required checks."""
    run_ids = set()
    job_ids = set()
    pinned_url = re.compile(
        r"https://github\.com/" + re.escape(REPO) +
        r"/actions/runs/([1-9][0-9]*)/job/([1-9][0-9]*)"
    )
    for item in matching_checks:
        if not isinstance(item, dict):
            return False
        url = item.get("details_url")
        matched = pinned_url.fullmatch(url) if isinstance(url, str) else None
        if (matched is None or type(item.get("id")) is not int or
                item["id"] != int(matched.group(2))):
            return False
        run_ids.add(int(matched.group(1)))
        job_ids.add(item["id"])
    if len(run_ids) != 1 or len(job_ids) != len(REQUIRED_JOBS):
        return False
    run_id = next(iter(run_ids))
    run = get("/actions/runs/" + str(run_id))
    if (not isinstance(run, dict) or type(run.get("id")) is not int or
            run["id"] != run_id or run.get("workflow_id") != HOSTED_WORKFLOW_ID or
            run.get("path") != HOSTED_WORKFLOW_PATH or
            run.get("head_sha") != sha or run.get("event") != "pull_request" or
            run.get("status") != "completed" or run.get("conclusion") != "success" or
            type(run.get("run_attempt")) is not int or run["run_attempt"] < 1):
        return False
    result = get("/actions/runs/" + str(run_id) + "/jobs?per_page=100")
    if not isinstance(result, dict):
        return False
    jobs = result.get("jobs")
    if (not isinstance(jobs, list) or type(result.get("total_count")) is not int or
            result["total_count"] != len(REQUIRED_JOBS) or
            len(jobs) != len(REQUIRED_JOBS)):
        return False
    seen = set()
    for job in jobs:
        if not isinstance(job, dict):
            return False
        name = job.get("name")
        if (name not in REQUIRED_JOBS or name in seen or
                type(job.get("id")) is not int or job["id"] not in job_ids or
                job.get("run_id") != run_id or job.get("head_sha") != sha or
                job.get("status") != "completed" or job.get("conclusion") != "success"):
            return False
        steps = job.get("steps")
        if (not isinstance(steps, list) or not steps or
                not all(isinstance(step, dict) for step in steps)):
            return False
        executed = {step["name"] for step in steps
                    if isinstance(step.get("name"), str) and
                    step.get("status") == "completed" and
                    step.get("conclusion") == "success"}
        if not HOSTED_REQUIRED_STAGES[name].issubset(executed):
            return False
        seen.add(name)
    return seen == REQUIRED_JOBS


def checks(sha):
    """Fail closed on missing, truncated or unverifiable hosted job evidence."""
    try:
        payload = get("/commits/" + sha + "/check-runs?per_page=100")
        combined = get("/commits/" + sha + "/status")
        runs, statuses = payload.get("check_runs"), combined.get("statuses")
        if (not isinstance(runs, list) or not isinstance(statuses, list) or
                type(payload.get("total_count")) is not int or
                payload["total_count"] != len(runs) or len(runs) >= 100 or
                len(statuses) >= 100):
            return False, False
        failed = any(r.get("status") == "completed" and r.get("conclusion") not in
                     ("success", "neutral", "skipped") for r in runs)
        failed |= any(s.get("state") in ("failure", "error") for s in statuses)
        pending = any(r.get("status") != "completed" for r in runs)
        pending |= any(s.get("state") not in ("success", "failure", "error") for s in statuses)
        by_name = {name: [r for r in runs if r.get("name") == name] for name in REQUIRED_JOBS}
        required_ok = all(
            len(matching) == 1 and matching[0].get("status") == "completed" and
            matching[0].get("conclusion") == "success" and
            matching[0].get("head_sha") == sha and
            matching[0].get("app", {}).get("slug") == "github-actions"
            for matching in by_name.values()
        )
        if required_ok and not failed and not pending:
            selected = [by_name[name][0] for name in sorted(REQUIRED_JOBS)]
            required_ok = hosted_job_evidence(sha, selected)
        return required_ok and not failed and not pending, failed
    except (RuntimeError, KeyError, ValueError, TypeError, AttributeError):
        return False, False


def protected_merge_policy(repo):
    """Require actual main branch protection; labels do not grant trust."""
    if repo.get("default_branch") != "main":
        return False
    try:
        branch = get("/branches/main")
        if branch.get("protected") is not True:
            return False
        protection = get("/branches/main/protection")
        reviews = protection.get("required_pull_request_reviews") or {}
        checks_required = protection.get("required_status_checks") or {}
        contexts = checks_required.get("contexts") or []
        named_checks = checks_required.get("checks") or []
        required = set(contexts) | {x.get("context") for x in named_checks}
        return (REQUIRED_JOBS.issubset(required) and
                checks_required.get("strict") is True and
                type(reviews.get("required_approving_review_count")) is int and
                reviews["required_approving_review_count"] >= 1 and
                reviews.get("dismiss_stale_reviews") is True and
                (protection.get("enforce_admins") or {}).get("enabled") is True)
    except (RuntimeError, KeyError, ValueError, TypeError, AttributeError):
        return False


def regular_doc_blobs_at_head(pr, files):
    """Verify PR-file identities and modes against the immutable Git tree."""
    sha = pr.get("head", {}).get("sha")
    if not isinstance(sha, str) or re.fullmatch(r"[0-9a-f]{40}", sha) is None:
        return False
    commit = get("/git/commits/" + sha)
    tree_sha = commit.get("tree", {}).get("sha")
    if (commit.get("sha") != sha or not isinstance(tree_sha, str) or
            re.fullmatch(r"[0-9a-f]{40}", tree_sha) is None):
        return False
    tree = get("/git/trees/" + tree_sha + "?recursive=1")
    entries = tree.get("tree")
    if (tree.get("sha") != tree_sha or tree.get("truncated") is not False or
            not isinstance(entries, list) or len(entries) > 10000):
        return False
    expected = {}
    for item in files:
        source = item.get("sha")
        name = item.get("filename")
        if (not isinstance(source, str) or
                re.fullmatch(r"[0-9a-f]{40}", source) is None or
                name in expected):
            return False
        expected[name] = source
    seen = set()
    for entry in entries:
        if not isinstance(entry, dict):
            return False
        name = entry.get("path")
        if name in expected:
            if (name in seen or entry.get("type") != "blob" or
                    entry.get("mode") != "100644" or
                    entry.get("sha") != expected[name]):
                return False
            seen.add(name)
    return seen == set(expected)


def protected_or_unverified_pr(pr):
    """Refuse auto-merge/refresh for access-code changes or unknown file lists."""
    if pr.get("number") in PROTECTED_PR_NUMBERS:
        return True
    count = pr.get("changed_files")
    if type(count) is not int or count < 1 or count >= 100:
        return True
    try:
        files = get("/pulls/" + str(pr["number"]) + "/files?per_page=100")
        if not isinstance(files, list) or len(files) != count:
            return True
        if not all(safe_documentation_file(item) for item in files):
            return True
        # Re-read the PR after listing files, then verify *actual Git object
        # modes and blob identities*, not only filename/status metadata.
        current = get("/pulls/" + str(pr["number"]))
        if (current.get("head", {}).get("sha") != pr.get("head", {}).get("sha") or
                current.get("base", {}).get("ref") != pr.get("base", {}).get("ref") or
                current.get("changed_files") != count):
            return True
        if not regular_doc_blobs_at_head(pr, files):
            return True
        # Pin the accepted tree to the current PR head after both Git lookups.
        latest = get("/pulls/" + str(pr["number"]))
        return (latest.get("head", {}).get("sha") != pr.get("head", {}).get("sha") or
                latest.get("base", {}).get("ref") != pr.get("base", {}).get("ref") or
                latest.get("changed_files") != count)

    except (RuntimeError, KeyError, ValueError, TypeError, AttributeError):
        return True


def classify(pr):
    age = code_age_days(pr)
    state = pr.get("mergeable_state")
    if pr["draft"]:
        return "draft", False
    if state == "dirty":
        return "conflict", False
    if age >= 30:
        return "stale", False
    if state == "behind":
        return "behind", False
    good, failed = checks(pr["head"]["sha"])
    if failed:
        return "failed", False
    if not good:
        return "running", False
    return ("ready" if state == "clean" else "review"), good


def docs_only(pr):
    if (pr["user"]["login"].lower() != OWNER or
            type(pr.get("changed_files")) is not int or
            not (1 <= pr["changed_files"] <= 8) or
            pr.get("additions", 9999) > 250 or
            pr.get("deletions", 9999) > 100):
        return False
    try:
        files = get("/pulls/" + str(pr["number"]) + "/files?per_page=100")
        return (isinstance(files, list) and
                len(files) == pr["changed_files"] and
                all(safe_documentation_file(item) for item in files))
    except (RuntimeError, KeyError, TypeError, ValueError, AttributeError):
        return False


def set_label(pr, kind):
    desired = "agent-triage:" + kind
    existing = {l["name"] for l in pr["labels"]}
    if desired not in existing:
        api("POST", P + "/issues/" + str(pr["number"]) + "/labels",
            {"labels": [desired]})
    for old in (MANAGED & existing) - {desired}:
        api("DELETE", P + "/issues/" + str(pr["number"]) +
            "/labels/" + urllib.parse.quote(old, safe=""))
    return existing


def main():
    repo = get("")
    if repo.get("archived") or repo.get("disabled"):
        return
    # If main has no independently enforced security policy, classification
    # and labeling may continue but integration actions remain prohibited.
    policy_qualified = protected_merge_policy(repo)
    if os.environ.get("GITHUB_EVENT_NAME") == "pull_request_target":
        with open(os.environ["GITHUB_EVENT_PATH"], encoding="utf-8") as f:
            event = json.load(f)
        target = event.get("number")
    else:
        target = None
    for name in sorted(MANAGED | {"agent:automerge", "agent:hold"}):
        try:
            api("POST", P + "/labels", {
                "name": name, "color": "c2d3dc",
                "description": "Managed by read-only PR triage and guarded native auto-merge"})
        except RuntimeError as exc:
            if "HTTP 422" not in str(exc):
                raise
    opened = prs()
    selected = [p for p in opened if p["number"] == target] if target else opened
    # Do not stack concurrent integration enrollments. Old stalled ones don't block.
    busy = any(p.get("auto_merge") and (NOW - timestamp(p["updated_at"])).days < 3
               for p in opened)
    arms, updates, counts = 0, 0, {}
    for item in selected:
        pr = get("/pulls/" + str(item["number"]))
        kind, good = classify(pr)
        counts[kind] = counts.get(kind, 0) + 1
        try:
            current = set_label(pr, kind)
        except RuntimeError as exc:
            print(f"PR #{pr['number']} couldn't be labeled: {exc}")
            continue
        age = code_age_days(pr)
        trusted = (pr["user"]["login"].lower() == OWNER and pr["head"].get("repo") and
                   pr["head"]["repo"]["full_name"].lower() == REPO.lower())
        if (not trusted or pr["draft"] or "agent:hold" in current or age >= 30 or
                pr["base"]["ref"] != repo["default_branch"] or not policy_qualified or
                protected_or_unverified_pr(pr)):
            continue
        opt_in = "agent:automerge" in current
        if opt_in and kind == "behind" and updates == 0:
            if not protected_merge_policy(repo):
                continue
            try:
                api("PUT", P + "/pulls/" + str(pr["number"]) + "/update-branch",
                    {"expected_head_sha": pr["head"]["sha"]})
                updates += 1
                print(f"PR #{pr['number']}: updated branch for CI")
            except RuntimeError as exc:
                print(f"PR #{pr['number']}: branch update deferred: {exc}")
            continue
        if (kind != "ready" or not good or pr.get("auto_merge") or
                not repo.get("allow_auto_merge") or busy or arms or
                not (opt_in or docs_only(pr))):
            continue
        if not protected_merge_policy(repo):
            continue
        try:
            result = api("POST", "/graphql", {
                "query": ("mutation($id:ID!){enablePullRequestAutoMerge("
                          "input:{pullRequestId:$id,mergeMethod:SQUASH})"
                          "{clientMutationId}}"),
                "variables": {"id": pr["node_id"]}
            }, graphql=True)
            if result.get("errors"):
                raise RuntimeError(str(result["errors"])[:240])
            arms = 1
            print(f"PR #{pr['number']}: native auto-merge armed")
        except RuntimeError as exc:
            print(f"PR #{pr['number']}: auto-merge deferred: {exc}")
    print("Triage summary:", json.dumps(counts, sort_keys=True),
          "armed:", arms, "branch updates:", updates)


if __name__ == "__main__":
    main()
