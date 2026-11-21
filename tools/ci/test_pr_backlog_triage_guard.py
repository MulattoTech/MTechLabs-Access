"""R61 disposable, network-free regression suite for guarded PR backlog automation."""
import copy
import importlib.util
import os
import unittest
from pathlib import Path
from unittest import mock

os.environ.setdefault("GITHUB_REPOSITORY", "MulattoTech/MTechLabs-Access")
os.environ.setdefault("GITHUB_TOKEN", "synthetic-not-a-credential")
source = Path(__file__).with_name("pr_backlog_triage.py")
spec = importlib.util.spec_from_file_location("r61_triage", source)
triage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(triage)
SHA = "a" * 40
REQ = sorted(triage.REQUIRED_JOBS)

def job(name, **overrides):
    result = {
        "name": name, "status": "completed", "conclusion": "success",
        "head_sha": SHA, "app": {"slug": "github-actions"},
    }
    result.update(overrides)
    return result

def check_snapshot(runs=None, **extra):
    runs = [job(n) for n in REQ] if runs is None else runs
    payload = {"check_runs": runs, "total_count": len(runs), **extra}
    return lambda path: (
        payload if path.endswith("/check-runs?per_page=100")
        else {"statuses": []} if path.endswith("/status")
        else (_ for _ in ()).throw(AssertionError("Unexpected mock endpoint " + path))
    )

def protected_branch(valid=True):
    return {
        "required_pull_request_reviews": {
            "required_approving_review_count": 1, "dismiss_stale_reviews": True,
        },
        "required_status_checks": {
            "strict": True, "contexts": REQ if valid else REQ[1:],
        },
        "enforce_admins": {"enabled": True},
    }

def policy_fixture(main_protected=True, protection=None):
    protection = protected_branch() if protection is None else protection
    def fetch(path):
        if path == "/branches/main": return {"protected": main_protected}
        if path == "/branches/main/protection": return protection
        raise AssertionError(path)
    return fetch

def pr_fixture(number=101, files=1, labels=None, draft=False, path="docs/guide.md"):
    return {
        "number": number, "node_id": "SYNTHETIC-NON-GITHUB-ID",
        "changed_files": files, "draft": draft,
        "mergeable_state": "clean",
        "head": {"sha": SHA, "repo": {"full_name": "MulattoTech/MTechLabs-Access"}},
        "base": {"ref": "main"}, "user": {"login": "MulattoTech"},
        "labels": [{"name": l} for l in (labels or [])],
        "auto_merge": None, "updated_at": "2026-11-20T00:00:00Z",
        "_test_path": path,
    }

class GuardTests(unittest.TestCase):
    def check(self, runs=None, **extra):
        with mock.patch.object(triage, "get", side_effect=check_snapshot(runs, **extra)):
            return triage.checks(SHA)

    def test_all_five_named_trusted_checks_pass(self):
        self.assertEqual(self.check(), (True, False))

    def test_unrelated_green_check_does_not_count(self):
        self.assertEqual(self.check([job("unrelated-lint")]), (False, False))

    def test_missing_required_job_fails_closed(self):
        self.assertEqual(self.check([job(n) for n in REQ[:-1]]), (False, False))

    def test_duplicate_required_job_fails_closed(self):
        runs = [job(n) for n in REQ]
        self.assertEqual(self.check(runs + [copy.deepcopy(runs[0])]), (False, False))

    def test_required_skipped_is_not_acceptance(self):
        runs = [job(n) for n in REQ]
        runs[0]["conclusion"] = "skipped"
        self.assertEqual(self.check(runs), (False, False))

    def test_untrusted_app_is_not_required_check(self):
        runs = [job(n) for n in REQ]
        runs[0]["app"] = {"slug": "other"}
        self.assertEqual(self.check(runs), (False, False))

    def test_wrong_commit_is_not_required_check(self):
        runs = [job(n) for n in REQ]
        runs[0]["head_sha"] = "b" * 40
        self.assertEqual(self.check(runs), (False, False))

    def test_failed_required_job_is_failure(self):
        runs = [job(n) for n in REQ]
        runs[0]["conclusion"] = "failure"
        self.assertEqual(self.check(runs), (False, True))

    def test_truncated_check_runs_unverified(self):
        self.assertEqual(self.check(extra="ignored"), (True, False))  # benign other metadata
        with mock.patch.object(triage, "get", side_effect=check_snapshot(**{"total_count": 101})):
            self.assertEqual(triage.checks(SHA), (False, False))

    def test_unprotected_main_fails_policy(self):
        with mock.patch.object(triage, "get", side_effect=policy_fixture(False)):
            self.assertFalse(triage.protected_merge_policy({"default_branch": "main"}))

    def test_policy_requires_all_five_names(self):
        with mock.patch.object(triage, "get", side_effect=policy_fixture(True, protected_branch(False))):
            self.assertFalse(triage.protected_merge_policy({"default_branch": "main"}))

    def test_protected_policy_with_reviews_and_stale_dismissal(self):
        with mock.patch.object(triage, "get", side_effect=policy_fixture()):
            self.assertTrue(triage.protected_merge_policy({"default_branch": "main"}))

    def test_missing_admin_enforcement_fails(self):
        data = protected_branch()
        data["enforce_admins"]["enabled"] = False
        with mock.patch.object(triage, "get", side_effect=policy_fixture(True, data)):
            self.assertFalse(triage.protected_merge_policy({"default_branch": "main"}))

    def test_pr45_always_protected_without_api_calls(self):
        with mock.patch.object(triage, "get", side_effect=AssertionError("no fetch")):
            self.assertTrue(triage.protected_or_unverified_pr(pr_fixture(45)))

    def test_source_or_workflow_changes_are_protected(self):
        for path in ("integrations/mcp-manager/gateway.mjs", ".github/workflows/check.yml",
                     "src/auth.js", "tools/ci/pr_backlog_triage.py",
                     "docs/engineering/access.md", "public/app.js"):
            pr = pr_fixture(path=path)
            with mock.patch.object(triage, "get", return_value=[{"filename": path}]):
                self.assertTrue(triage.protected_or_unverified_pr(pr), path)

    def test_regular_documentation_can_remain_eligible(self):
        pr = pr_fixture()
        def fetch(path):
            if path.endswith("/files?per_page=100"):
                return [{"filename": "docs/guide.md"}]
            if path == "/pulls/101":
                return pr
            raise AssertionError(path)
        with mock.patch.object(triage, "get", side_effect=fetch):
            self.assertFalse(triage.protected_or_unverified_pr(pr))

    def test_changed_head_after_file_list_fails_closed(self):
        pr = pr_fixture()
        changed = copy.deepcopy(pr)
        changed["head"]["sha"] = "b" * 40
        def fetch(path):
            return [{"filename": "docs/guide.md"}] if path.endswith("/files?per_page=100") else changed
        with mock.patch.object(triage, "get", side_effect=fetch):
            self.assertTrue(triage.protected_or_unverified_pr(pr))

    def test_unknown_or_truncated_files_fail_closed(self):
        pr = pr_fixture(files=2)
        with mock.patch.object(triage, "get", return_value=[{"filename": "docs/guide.md"}]):
            self.assertTrue(triage.protected_or_unverified_pr(pr))
        with mock.patch.object(triage, "get", return_value=[{"filename": "../escape.md"}, {"filename": "docs/guide.md"}]):
            self.assertTrue(triage.protected_or_unverified_pr(pr))

    def test_unprotected_repository_never_calls_automerge_or_branch_update(self):
        pr = pr_fixture(labels=["agent:automerge"])
        calls = []
        def fake_get(path):
            if path == "": return {
                "default_branch": "main", "allow_auto_merge": True, "archived": False,
            }
            if path == "/branches/main": return {"protected": False}
            if path.startswith("/pulls?"): return [pr]
            if path == "/pulls/101": return pr
            if path.startswith("/commits/") and path.endswith("/check-runs?per_page=100"):
                data = [job(n) for n in REQ]
                return {"check_runs": data, "total_count": len(data)}
            if path.startswith("/commits/") and path.endswith("/status"): return {"statuses": []}
            if path.startswith("/commits/"): return {"commit": {"committer": {"date": triage.NOW.isoformat()}}}
            raise AssertionError("unknown GET: " + path)
        def fake_api(method, path, payload=None, **kwargs):
            calls.append((method, path))
            return {}
        with mock.patch.object(triage, "get", side_effect=fake_get), mock.patch.object(triage, "api", side_effect=fake_api):
            triage.main()
        self.assertFalse(any("/graphql" in path or "/update-branch" in path for _, path in calls))

    def test_protected_pr45_not_enrolled_even_if_labeled_and_green(self):
        pr = pr_fixture(number=45, labels=["agent:automerge"])
        pr["draft"] = False  # synthetic negative control: even ready does not bypass
        with mock.patch.object(triage, "get", side_effect=AssertionError("should not fetch")):
            self.assertTrue(triage.protected_or_unverified_pr(pr))

    def test_genuinely_protected_ordinary_docs_pr_can_enroll(self):
        pr = pr_fixture(labels=["agent:automerge"])
        called = []
        def fetch(path):
            if path == "":
                return {"default_branch": "main", "allow_auto_merge": True, "archived": False}
            if path == "/branches/main": return {"protected": True}
            if path == "/branches/main/protection": return protected_branch()
            if path.startswith("/pulls?"): return [pr]
            if path == "/pulls/101": return pr
            if path == "/pulls/101/files?per_page=100": return [{"filename": "docs/guide.md"}]
            if path.startswith("/commits/") and path.endswith("/check-runs?per_page=100"):
                return {"check_runs": [job(n) for n in REQ], "total_count": len(REQ)}
            if path.startswith("/commits/") and path.endswith("/status"):
                return {"statuses": []}
            if path.startswith("/commits/"):
                return {"commit": {"committer": {"date": triage.NOW.isoformat()}}}
            raise AssertionError(path)
        def fake_api(method, path, payload=None, **kwargs):
            called.append((method, path))
            return {}
        with mock.patch.object(triage, "get", side_effect=fetch), mock.patch.object(
            triage, "api", side_effect=fake_api
        ):
            triage.main()
        self.assertEqual(sum(1 for method, path in called if path == "/graphql"), 1)
        self.assertFalse(any("/update-branch" in path for _, path in called))

    def test_protected_source_pr_cannot_enroll_under_valid_branch_policy(self):
        pr = pr_fixture(number=101, labels=["agent:automerge"], path="src/auth.js")
        with mock.patch.object(triage, "get", return_value=[{"filename": "src/auth.js"}]):
            self.assertTrue(triage.protected_or_unverified_pr(pr))


if __name__ == "__main__":
    unittest.main(verbosity=2)
