"""The tests of .github/workflows/merge-by-policy.yml and its keyless wake.

The policy step's script is run as GitHub runs it (bash -e -c <the step's text>, the step's env) against a stand-in `gh` that answers from a table and
logs each call with the NAME of the token it carried (read or app, never a value). A call the table does not hold exits 99, so a call the script was
not meant to make is a red test. Nothing here reaches GitHub. Standard library only: run with `python3 -I .github/merge-by-policy/test_merge_by_policy.py`.
"""
import base64, json, os, re, shutil, stat, subprocess, sys, tempfile, unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
WF = os.path.join(ROOT, ".github", "workflows")


def read(path):
    with open(path) as f:
        return f.read()


def code(text):
    """A workflow file without its comment lines."""
    return "\n".join(l for l in text.split("\n") if not l.lstrip().startswith("#"))


RAW = read(os.path.join(WF, "merge-by-policy.yml"))
WAKE = read(os.path.join(WF, "merge-by-policy-wake.yml"))


def step_run(raw, name):
    """The text of a step's `run: |` block, dedented, read from the file as GitHub reads it (no YAML library needed)."""
    lines = raw.split("\n")
    start = next(i for i, l in enumerate(lines) if l.strip() == "- name: " + name)
    i = next(j for j in range(start, len(lines)) if lines[j].strip() == "run: |")
    out = []
    for l in lines[i + 1:]:
        if l.strip() and not l.startswith(" " * 10):
            break
        out.append(l[10:])
    return "\n".join(out).rstrip() + "\n"


SCRIPT = step_run(RAW, "Switch auto-merge on or off by the policy")
FAILSAFE = step_run(RAW, "Switch off auto-merge after a failure")

HEAD = "0123456789abcdef0123456789abcdef01234567"
OTHER = "89abcdef0123456789abcdef0123456789abcdef"
MAIN = "fedcba9876543210fedcba9876543210fedcba98"
BASE = "1111111111111111111111111111111111111111"
OPENED = "2026-11-10T09:30:00Z"
T0 = "2026-11-10T10:00:00Z"
RETARGET = "2026-11-10T11:00:00Z"
LATER = "2026-11-10T12:00:00Z"
SLUG = "merge-app"
OURS = SLUG + "[bot]"
CODEOWNERS = "# only this file waits for its owner\n/.github/CODEOWNERS   @owner\n/docs/owned/   @owner\n"

PR_Q = "api repos/o/r/pulls/7"
FILES_Q = "api repos/o/r/pulls/7/files?per_page=100&page=1"
CO_Q = "api repos/o/r/contents/.github/CODEOWNERS?ref=" + MAIN
TESTS_Q = "api repos/o/r/commits/%s/check-runs?check_name=all-tests&app_id=15368&filter=all&per_page=100" % HEAD
LINT_Q = "api repos/o/r/commits/%s/check-runs?check_name=lint&app_id=15368&filter=all&per_page=100" % HEAD
REVIEWS_Q = "api repos/o/r/pulls/7/reviews?per_page=100&page=1"
TIMELINE_Q = "api repos/o/r/issues/7/timeline?per_page=100&page=1"
HEADPRS_Q = "api repos/o/r/commits/%s/pulls?per_page=100" % HEAD
SIBS_Q = "api repos/o/r/pulls?state=all&head=o%3Afeature&per_page=100"
RULES_Q = "api repos/o/r/rules/branches/main?per_page=100"
GRAPHQL = "api graphql"
ENABLE = "pr merge 7 --auto --squash --match-head-commit " + HEAD
DISABLE = "pr merge 7 --disable-auto"


def wq(suite):
    return "api repos/o/r/actions/runs?check_suite_id=%d&per_page=100" % suite


def pr(**over):
    d = {"state": "open", "draft": False, "title": "Add a thing", "base": {"ref": "main", "sha": BASE},
         "head": {"sha": HEAD, "ref": "feature", "repo": {"full_name": "o/r"}}, "created_at": OPENED, "user": {"login": "author"},
         "labels": [], "changed_files": 1, "auto_merge": None, "mergeable_state": "blocked", "merged": False}
    d.update(over)
    return d


OUR_AUTO = {"enabled_by": {"login": OURS}, "merge_method": "squash"}
THEIR_AUTO = {"enabled_by": {"login": "owner"}, "merge_method": "squash"}


def run(name, status, conclusion, id, head=HEAD, at=T0, app=15368):
    return {"id": id, "name": name, "status": status, "conclusion": conclusion, "head_sha": head, "app": {"id": app}, "started_at": at, "check_suite": {"id": 900 + id}}


def runs(*r):
    return {"total_count": len(r), "check_runs": list(r)}


def wrun(**over):
    d = {"path": ".github/workflows/tests.yml", "event": "pull_request", "head_sha": HEAD, "head_branch": "feature", "created_at": T0,
         "pull_requests": [{"number": 7, "base": {"ref": "main"}}]}
    d.update(over)
    return {"workflow_runs": [d]}


def review(login, state="APPROVED", commit=HEAD, at=T0, id=60):
    return {"id": id, "user": {"login": login}, "state": state, "commit_id": commit, "submitted_at": at}


def rules(approvals=1, dismiss=True, last_push=True, owners=True, checks=(("all-tests", 15368),)):
    return [
        {"type": "pull_request", "parameters": {"required_approving_review_count": approvals, "dismiss_stale_reviews_on_push": dismiss,
                                                "require_last_push_approval": last_push, "require_code_owner_review": owners}},
        {"type": "required_status_checks", "parameters": {"required_status_checks": [{"context": c, "integration_id": a} for c, a in checks]}},
    ]


def files(*names):
    return [{"status": "modified", "filename": n} if isinstance(n, str) else {"status": "renamed", "filename": n[1], "previous_filename": n[0]} for n in names]


def history(*nodes, cut=False, **extra):
    """The auto-merge history as GitHub answers it: the newest events, and whether older ones were left out (`cut`). `extra` adds or replaces
    fields of the connection, e.g. a totalCount, which under the query's itemTypes filter counts all timeline items, not just the nodes."""
    conn = {"pageInfo": {"hasPreviousPage": cut}, "nodes": list(nodes)}
    conn.update(extra)
    return {"data": {"repository": {"pullRequest": {"timelineItems": conn}}}}


OFF_BY_GITHUB = {"__typename": "AutoMergeDisabledEvent", "createdAt": T0, "reasonCode": "repository_rule_violation", "actor": {"login": SLUG}}
OFF_BY_PERSON = {"__typename": "AutoMergeDisabledEvent", "createdAt": T0, "reasonCode": None, "actor": {"login": "owner"}}
OFF_BY_US = {"__typename": "AutoMergeDisabledEvent", "createdAt": T0, "reasonCode": None, "actor": {"login": SLUG}}
ON_BY_US = {"__typename": "AutoMergeEnabledEvent", "createdAt": T0, "actor": {"login": SLUG}}

PASSES = "passes"
TOO_LONG = "the pull request's auto-merge history is longer than this job reads"
UNREADABLE = "the pull request's auto-merge history could not be read"


def without_page_info(*nodes):
    h = history(*nodes)
    del h["data"]["repository"]["pullRequest"]["timelineItems"]["pageInfo"]
    return h


# Each answer GitHub can give for the auto-merge history, and how the step must end on it: past the guard, or red with this message.
HISTORY_ANSWERS = [
    ("a totalCount above the filtered nodes, none of them, as measured", history(totalCount=12), PASSES),
    ("a totalCount above the filtered nodes", history(ON_BY_US, OFF_BY_US, totalCount=12), PASSES),
    ("older events left out, no nodes", history(cut=True), TOO_LONG),
    ("older events left out", history(ON_BY_US, cut=True), TOO_LONG),
    ("older events left out, with a totalCount that fits", history(ON_BY_US, cut=True, totalCount=1), TOO_LONG),
    ("no pageInfo", without_page_info(ON_BY_US), UNREADABLE),
    ("a pageInfo without the flag", history(ON_BY_US, pageInfo={}), UNREADABLE),
    ("a null pageInfo", history(ON_BY_US, pageInfo=None), UNREADABLE),
] + [("the flag %r" % (v,), history(ON_BY_US, cut=v), UNREADABLE) for v in ("false", "true", 0, 1, None)]


def ended_as(r, how):
    """Whether a run of the step ended as `how` says (one of the answers' ends above)."""
    if how == PASSES:
        return r.exit == 0 and r.enabled
    return r.exit != 0 and not r.enabled and ("FAILED: " + how) in r.summary


def history_world(answer):
    w = ok_world()
    w[GRAPHQL] = {"out": answer}
    return w


def history_query(r):
    """The text of the history query the step sent, or None."""
    return next((c for c in r.calls if c.startswith("read api graphql ")), None)


def ok_world():
    return {
        PR_Q: {"out": pr()},
        "api repos/o/r": {"out": {"full_name": "o/r", "allow_auto_merge": True}},
        RULES_Q: {"out": rules()},
        FILES_Q: {"out": files("plugins/x/src/plan.ts")},
        CO_Q: {"out": {"type": "file", "encoding": "base64", "content": base64.b64encode(CODEOWNERS.encode()).decode()}},
        TESTS_Q: {"out": runs(run("all-tests", "completed", "success", 40))},
        wq(940): {"out": wrun()},
        REVIEWS_Q: {"out": [review("reviewer-bot[bot]")]},
        TIMELINE_Q: {"out": [{"event": "labeled", "created_at": "2026-11-10T09:00:00Z"}]},
        HEADPRS_Q: {"out": [{"number": 7, "state": "open"}]},
        SIBS_Q: {"out": [{"number": 7, "state": "open", "head": {"sha": HEAD}}]},
        GRAPHQL: {"out": history()},
        ENABLE: {"out": ""},
        DISABLE: {"out": ""},
    }


def changing(*names):
    w = ok_world()
    w[FILES_Q] = {"out": files(*names)}
    w[PR_Q] = {"out": pr(changed_files=len(names))}
    return w


def with_pr(w, **over):
    cur = dict(w[PR_Q]["out"])
    cur.update(over)
    w = dict(w)
    w[PR_Q] = {"out": cur}
    return w


FAKE_GH = r'''#!/usr/bin/env python3
import json, os, sys
d = os.environ["FAKE_DIR"]
key = " ".join(sys.argv[1:])
tok = os.environ.get("GH_TOKEN", "")
kind = "app" if tok == "app-token" else ("read" if tok == "read-token" else "other")
with open(os.path.join(d, "calls"), "a") as f:
    f.write(kind + " " + key + "\n")
world = json.load(open(os.path.join(d, "world.json")))
if key.startswith("api graphql ") and key not in world:
    key = "api graphql"
if key not in world and key.startswith("api repos/o/r/git/trees/"):
    sha = key[len("api repos/o/r/git/trees/"):].split("?")[0]
    entries = {}
    for k, v in world.items():
        if k.startswith("api repos/o/r/pulls/7/files"):
            for f in v.get("out", []) or []:
                for n in (f.get("filename"), f.get("previous_filename")):
                    if n:
                        entries[n] = ("blob", "100644")
    for n, tm in world.get("_modes", {}).get(sha, {}).items():
        entries[n] = tuple(tm)
    tree = [{"path": n, "type": tm[0], "mode": tm[1]} for n, tm in entries.items() if tm[0] != "absent"]
    sys.stdout.write(json.dumps({"sha": sha, "truncated": world.get("_truncated", False), "tree": tree}))
    sys.exit(0)
if key not in world:
    sys.stderr.write("unexpected gh call\n")
    sys.exit(99)
a = world[key]
if isinstance(a, list):
    p = os.path.join(d, "count.json")
    counts = json.load(open(p)) if os.path.exists(p) else {}
    n = counts.get(key, 0)
    counts[key] = n + 1
    json.dump(counts, open(p, "w"))
    a = a[min(n, len(a) - 1)]
if a.get("exit"):
    sys.stderr.write("boom\n")
    sys.exit(a["exit"])
out = a.get("out", "")
sys.stdout.write(out if isinstance(out, str) else json.dumps(out))
'''


class Result:
    def __init__(self, exit, calls, summary, out):
        self.exit, self.calls, self.summary, self.out = exit, calls, summary, out

    @property
    def writes(self):
        return [c for c in self.calls if " pr merge " in c]

    @property
    def enabled(self):
        return ("app " + ENABLE) in self.calls


def run_script(world, script=SCRIPT, **env):
    d = tempfile.mkdtemp(prefix="mbp-")
    b = tempfile.mkdtemp(prefix="mbp-bin-")
    try:
        with open(os.path.join(d, "world.json"), "w") as f:
            json.dump(world, f)
        g = os.path.join(b, "gh")
        with open(g, "w") as f:
            f.write(FAKE_GH.replace("#!/usr/bin/env python3", "#!" + sys.executable, 1))
        os.chmod(g, stat.S_IRWXU)
        e = {"PATH": b + ":" + os.path.dirname(sys.executable) + ":/usr/bin:/bin", "HOME": d, "LC_ALL": "C", "FAKE_DIR": d,
             "GITHUB_STEP_SUMMARY": os.path.join(d, "summary"), "GH_TOKEN": "app-token", "READ_TOKEN": "read-token", "APP_SLUG": SLUG,
             "GH_REPO": "o/r", "MAIN_SHA": MAIN, "EVENT_NAME": "pull_request_target", "PR_NUMBER": "7", "HEAD_SHA": HEAD,
             "PR_TITLE": "Add a thing", "BASE_CHANGED": "false", "REVIEWER_LOGINS": "reviewer-bot[bot], second"}
        e.update(env)
        p = subprocess.run(["bash", "-e", "-c", script], env=e, capture_output=True, text=True)
        calls = read(os.path.join(d, "calls")).rstrip("\n").split("\n") if os.path.exists(os.path.join(d, "calls")) else []
        summary = read(os.path.join(d, "summary")) if os.path.exists(os.path.join(d, "summary")) else ""
        return Result(p.returncode, calls, summary, p.stdout + p.stderr)
    finally:
        shutil.rmtree(d, ignore_errors=True)
        shutil.rmtree(b, ignore_errors=True)


class Base(unittest.TestCase):
    def refused(self, r, why):
        self.assertEqual(r.exit, 0, r.out)
        self.assertEqual(r.writes, [], r.out)
        self.assertRegex(r.summary, why)

    def failed_closed(self, r):
        self.assertNotEqual(r.exit, 0, r.out)
        self.assertNotIn("app " + ENABLE, r.calls)
        self.assertIn("FAILED", r.summary)


class Qualifies(Base):
    def test_switches_on_squash_auto_merge_pinned_to_the_head_with_the_app_token(self):
        r = run_script(ok_world())
        self.assertEqual(r.exit, 0, r.out)
        self.assertEqual(r.writes, ["app " + ENABLE])
        self.assertIn("auto-merge is on", r.summary)

    def test_reads_use_the_read_only_token_except_settings_and_rules(self):
        r = run_script(ok_world())
        for c in r.calls:
            if c.startswith("app "):
                self.assertIn(c, ["app api repos/o/r", "app " + RULES_Q, "app " + ENABLE])
            else:
                self.assertTrue(c.startswith("read "), c)

    def test_auto_merge_someone_else_switched_on_is_left_alone(self):
        r = run_script(with_pr(ok_world(), auto_merge=THEIR_AUTO))
        self.assertEqual(r.writes, [])
        self.assertIn("already on", r.summary)

    def test_every_required_check_is_read_and_must_pass(self):
        w = ok_world()
        w[RULES_Q] = {"out": rules(checks=(("all-tests", 15368), ("lint", 15368)))}
        w[LINT_Q] = {"out": runs(run("lint", "completed", "success", 41))}
        self.assertTrue(run_script(w).enabled)
        w[LINT_Q] = {"out": runs(run("lint", "completed", "failure", 41))}
        self.refused(run_script(w), "did not pass")
        w[LINT_Q] = {"out": runs(run("lint", "in_progress", None, 41))}
        self.refused(run_script(w), "has not finished")


class Rules(Base):
    def test_main_requires_no_approval(self):
        w = ok_world(); w[RULES_Q] = {"out": rules(approvals=0)}
        self.refused(run_script(w), "requires no approving review")

    def test_stale_approvals_not_dismissed(self):
        w = ok_world(); w[RULES_Q] = {"out": rules(dismiss=False)}
        self.refused(run_script(w), "dismiss stale approvals")

    def test_last_push_rule_off(self):
        w = ok_world(); w[RULES_Q] = {"out": rules(last_push=False)}
        self.refused(run_script(w), "most recent push")

    def test_code_owner_rule_off(self):
        w = ok_world(); w[RULES_Q] = {"out": rules(owners=False)}
        self.refused(run_script(w), "code owner")

    def test_all_tests_not_required(self):
        w = ok_world(); w[RULES_Q] = {"out": rules(checks=())}
        self.refused(run_script(w), "do not include all-tests")

    def test_all_tests_required_but_pinned_to_another_app(self):
        w = ok_world(); w[RULES_Q] = {"out": rules(checks=(("all-tests", 1234),))}
        self.refused(run_script(w), "do not include all-tests")

    def test_a_required_check_not_pinned_to_an_app(self):
        w = ok_world(); w[RULES_Q] = {"out": rules(checks=(("all-tests", 15368), ("lint", None)))}
        self.refused(run_script(w), "not pinned to an app")

    def test_no_pull_request_rule(self):
        w = ok_world(); w[RULES_Q] = {"out": [rules()[1]]}
        self.refused(run_script(w), "no active pull_request rule")

    def test_the_rules_as_they_are_on_a_repository_with_none(self):
        w = ok_world(); w[RULES_Q] = {"out": [{"type": "deletion"}, {"type": "non_fast_forward"}]}
        self.refused(run_script(w), "no active pull_request rule")

    def test_allow_auto_merge_off(self):
        w = ok_world(); w["api repos/o/r"] = {"out": {"full_name": "o/r", "allow_auto_merge": False}}
        self.refused(run_script(w), "does not allow auto-merge")


class Checks(Base):
    def test_all_tests_red(self):
        w = ok_world(); w[TESTS_Q] = {"out": runs(run("all-tests", "completed", "failure", 40))}
        self.refused(run_script(w), "did not pass")

    def test_all_tests_pending(self):
        w = ok_world(); w[TESTS_Q] = {"out": runs(run("all-tests", "queued", None, 40))}
        self.refused(run_script(w), "has not finished")

    def test_all_tests_missing(self):
        w = ok_world(); w[TESTS_Q] = {"out": runs()}
        self.refused(run_script(w), "no run on the head")

    def test_a_newer_red_run_beats_an_older_green_one(self):
        w = ok_world(); w[TESTS_Q] = {"out": runs(run("all-tests", "completed", "success", 40), run("all-tests", "completed", "failure", 45))}
        self.refused(run_script(w), "did not pass")

    def test_a_run_from_another_app_counts_for_nothing(self):
        w = ok_world(); w[TESTS_Q] = {"out": runs(run("all-tests", "completed", "success", 40, app=999))}
        self.refused(run_script(w), "no run on the head")

    def test_a_run_on_another_head_counts_for_nothing(self):
        w = ok_world(); w[TESTS_Q] = {"out": runs(run("all-tests", "completed", "success", 40, head=OTHER))}
        self.refused(run_script(w), "no run on the head")

    def test_all_tests_from_another_workflow_event_or_pull_request(self):
        for over in ({"path": ".github/workflows/other.yml"}, {"event": "push"}, {"head_branch": "elsewhere"},
                     {"pull_requests": [{"number": 8, "base": {"ref": "main"}}]}, {"pull_requests": [{"number": 7, "base": {"ref": "dev"}}]}):
            w = ok_world(); w[wq(940)] = {"out": wrun(**over)}
            self.refused(run_script(w), "not from a run of .github/workflows/tests.yml")

    def test_a_full_page_of_check_runs_fails_closed(self):
        w = ok_world(); w[TESTS_Q] = {"out": {"total_count": 100, "check_runs": [run("all-tests", "completed", "success", 40)]}}
        self.failed_closed(run_script(w))


class Reviews(Base):
    def test_no_approval(self):
        w = ok_world(); w[REVIEWS_Q] = {"out": []}
        self.refused(run_script(w), "approving review")

    def test_head_moved_after_the_review(self):
        w = ok_world(); w[REVIEWS_Q] = {"out": [review("reviewer-bot[bot]", commit=OTHER)]}
        self.refused(run_script(w), "approving review")

    def test_a_later_change_request_by_the_same_reviewer_wins(self):
        w = ok_world(); w[REVIEWS_Q] = {"out": [review("reviewer-bot[bot]", id=60), review("reviewer-bot[bot]", "CHANGES_REQUESTED", id=61)]}
        self.refused(run_script(w), "requests changes")

    def test_another_reviewer_requesting_changes_blocks(self):
        w = ok_world(); w[REVIEWS_Q] = {"out": [review("reviewer-bot[bot]"), review("someone", "CHANGES_REQUESTED", id=62)]}
        self.refused(run_script(w), "requests changes")

    def test_a_dismissed_approval_does_not_count(self):
        w = ok_world(); w[REVIEWS_Q] = {"out": [review("reviewer-bot[bot]", id=60), review("reviewer-bot[bot]", "DISMISSED", id=61)]}
        self.refused(run_script(w), "approving review")

    def test_a_comment_after_an_approval_changes_nothing(self):
        w = ok_world(); w[REVIEWS_Q] = {"out": [review("reviewer-bot[bot]", id=60), review("reviewer-bot[bot]", "COMMENTED", id=61)]}
        self.assertTrue(run_script(w).enabled)

    def test_the_authors_own_approval_and_the_merge_apps_count_for_nothing(self):
        for who in ("author", OURS):
            w = ok_world(); w[REVIEWS_Q] = {"out": [review(who)]}
            self.refused(run_script(w), "approving review")

    def test_two_required_need_two(self):
        w = ok_world(); w[RULES_Q] = {"out": rules(approvals=2)}
        self.refused(run_script(w), "asks for 2")
        w[REVIEWS_Q] = {"out": [review("reviewer-bot[bot]"), review("second", id=61)]}
        self.assertTrue(run_script(w).enabled)

    def test_an_approval_from_before_the_last_base_change(self):
        w = ok_world()
        w[TIMELINE_Q] = {"out": [{"event": "base_ref_changed", "created_at": RETARGET}]}
        w[TESTS_Q] = {"out": runs(run("all-tests", "completed", "success", 40, at=LATER))}
        w[wq(940)] = {"out": wrun(created_at=LATER)}
        self.refused(run_script(w), "approving review")
        w[REVIEWS_Q] = {"out": [review("reviewer-bot[bot]", at=LATER)]}
        self.assertTrue(run_script(w).enabled)


class Reviewers(Base):
    def test_an_approval_by_a_login_on_the_list_arms(self):
        self.assertTrue(run_script(ok_world(), REVIEWER_LOGINS="reviewer-bot[bot]").enabled)

    def test_an_approval_by_a_login_not_on_the_list_does_not(self):
        w = ok_world(); w[REVIEWS_Q] = {"out": [review("drive-by-user")]}
        self.refused(run_script(w), "approving review")

    def test_github_actions_never_counts_even_when_listed(self):
        w = ok_world(); w[REVIEWS_Q] = {"out": [review("github-actions[bot]")]}
        self.refused(run_script(w, REVIEWER_LOGINS="github-actions[bot],reviewer-bot[bot]"), "approving review")
        self.refused(run_script(w, REVIEWER_LOGINS="github-actions[bot]"), "unset or empty")

    def test_an_empty_or_unset_list_refuses_everything(self):
        for v in ("", " , ", ","):
            self.refused(run_script(ok_world(), REVIEWER_LOGINS=v), "unset or empty")

    def test_an_entry_that_is_not_a_login_fails_closed(self):
        self.failed_closed(run_script(ok_world(), REVIEWER_LOGINS="reviewer-bot[bot], bad login"))


class Refusals(Base):
    def test_a_root_or_docs_codeowners_file(self):
        for path in ("CODEOWNERS", "docs/CODEOWNERS", "Docs/codeowners"):
            self.refused(run_script(changing("plugins/x/a.ts", path)), "CODEOWNERS file")

    def test_codeowners_itself(self):
        self.refused(run_script(changing("plugins/x/a.ts", ".github/CODEOWNERS")), "CODEOWNERS path")

    def test_codeowners_in_another_case(self):
        self.refused(run_script(changing(".github/codeowners")), "CODEOWNERS path")

    def test_an_owned_folder(self):
        self.refused(run_script(changing("docs/owned/x.md")), "CODEOWNERS path")

    def test_an_owned_path_hidden_as_a_rename_source(self):
        self.refused(run_script(changing((".github/CODEOWNERS", ".github/OWNERS")) ), "CODEOWNERS path")

    def test_a_codeowners_line_it_cannot_read_fails_closed(self):
        w = ok_world()
        w[CO_Q] = {"out": {"type": "file", "encoding": "base64", "content": base64.b64encode(b"*.js @owner\n").decode()}}
        self.failed_closed(run_script(w))

    def test_a_hold_title_in_the_event_switches_off_whoever_switched_on(self):
        r = run_script(with_pr(ok_world(), auto_merge=THEIR_AUTO), PR_TITLE="  hold: wait")
        self.assertEqual(r.writes, ["app " + DISABLE])

    def test_a_hold_title_read_live_with_auto_merge_off(self):
        self.refused(run_script(with_pr(ok_world(), title="HOLD: x")), "held")

    def test_the_hold_label(self):
        self.refused(run_script(with_pr(ok_world(), labels=[{"name": " Hold "}])), "held")

    def test_hold_later_in_the_title_does_not_hold(self):
        self.assertTrue(run_script(with_pr(ok_world(), title="Fix the HOLD: button"), PR_TITLE="Fix the HOLD: button").enabled)

    def test_a_draft(self):
        self.refused(run_script(with_pr(ok_world(), draft=True)), "draft")

    def test_a_draft_whose_auto_merge_this_app_switched_on_is_switched_off(self):
        r = run_script(with_pr(ok_world(), draft=True, auto_merge=OUR_AUTO))
        self.assertEqual(r.writes, ["app " + DISABLE])

    def test_another_base(self):
        self.refused(run_script(with_pr(ok_world(), base={"ref": "dev", "sha": BASE})), "target main")

    def test_a_fork_and_a_deleted_fork(self):
        self.refused(run_script(with_pr(ok_world(), head={"sha": HEAD, "ref": "feature", "repo": {"full_name": "x/r"}})), "fork")
        self.refused(run_script(with_pr(ok_world(), head={"sha": HEAD, "ref": "feature", "repo": None})), "fork")

    def test_a_merge_conflict(self):
        self.refused(run_script(with_pr(ok_world(), mergeable_state="dirty")), "conflict")

    def test_a_file_list_that_does_not_match_the_count(self):
        self.refused(run_script(with_pr(ok_world(), changed_files=2)), "does not match")

    def test_a_symlink_at_the_head(self):
        w = ok_world(); w["_modes"] = {HEAD: {"plugins/x/src/plan.ts": ["blob", "120000"]}}
        self.refused(run_script(w), "symlink")

    def test_a_submodule_at_the_base(self):
        w = ok_world(); w["_modes"] = {BASE: {"plugins/x/src/plan.ts": ["commit", "160000"]}}
        self.refused(run_script(w), "symlink")

    def test_a_head_that_moved_while_the_job_read_it(self):
        w = ok_world(); w[PR_Q] = [{"out": pr()}, {"out": pr(head={"sha": OTHER, "ref": "feature", "repo": {"full_name": "o/r"}})}]
        r = run_script(w)
        self.assertEqual(r.writes, [])
        self.assertIn("head moved", r.summary)

    def test_an_event_whose_head_is_no_longer_the_pull_requests(self):
        r = run_script(ok_world(), HEAD_SHA=OTHER)
        self.assertEqual(r.writes, [])
        self.assertIn("no longer the one of this event", r.summary)

    def test_a_hold_that_appears_just_before_the_switch_on(self):
        w = ok_world(); w[PR_Q] = [{"out": pr()}, {"out": pr(title="HOLD: wait")}]
        r = run_script(w)
        self.assertEqual(r.writes, [])

    def test_a_hold_label_that_appears_just_before_the_switch_on(self):
        w = ok_world(); w[PR_Q] = [{"out": pr()}, {"out": pr(labels=[{"name": "hold"}])}]
        r = run_script(w)
        self.assertEqual(r.writes, [])
        self.assertIn("held while this job read it", r.summary)

    def test_an_api_error_fails_closed(self):
        w = ok_world(); w[RULES_Q] = {"exit": 1}
        self.failed_closed(run_script(w))

    def test_a_pull_request_answer_with_no_auto_merge_field_fails_closed(self):
        p = pr(); del p["auto_merge"]
        w = ok_world(); w[PR_Q] = {"out": p}
        self.failed_closed(run_script(w))


class Retarget(Base):
    def test_the_retarget_event_switches_off_and_reads_nothing_else(self):
        r = run_script(with_pr(ok_world(), auto_merge=THEIR_AUTO), BASE_CHANGED="true")
        self.assertEqual(r.writes, ["app " + DISABLE])
        self.assertEqual([c for c in r.calls if " api " in c], ["read " + PR_Q])

    def test_green_checks_from_before_the_retarget_are_refused(self):
        w = ok_world(); w[TIMELINE_Q] = {"out": [{"event": "base_ref_changed", "created_at": RETARGET}]}
        self.refused(run_script(w), "before the pull request was opened or before its last base change")

    def test_a_head_shared_with_another_open_pull_request(self):
        w = ok_world(); w[HEADPRS_Q] = {"out": [{"number": 7, "state": "open"}, {"number": 8, "state": "open"}]}
        self.refused(run_script(w), "another open pull request")

    def test_a_closed_pull_request_from_the_same_branch_at_this_head(self):
        w = ok_world(); w[SIBS_Q] = {"out": [{"number": 7, "state": "open", "head": {"sha": HEAD}}, {"number": 5, "state": "closed", "head": {"sha": HEAD}}]}
        self.refused(run_script(w), "another pull request from this branch")

    def test_checks_from_before_the_opening(self):
        w = ok_world(); w[PR_Q] = {"out": pr(created_at=LATER)}
        self.refused(run_script(w), "before the pull request was opened")


class ReArm(Base):
    def test_off_by_github_is_switched_back_on(self):
        w = ok_world(); w[GRAPHQL] = {"out": history(ON_BY_US, OFF_BY_GITHUB)}
        self.assertTrue(run_script(w, EVENT_NAME="workflow_run", HEAD_SHA="", PR_TITLE="").enabled)

    def test_off_by_this_app_is_switched_back_on(self):
        w = ok_world(); w[GRAPHQL] = {"out": history(ON_BY_US, OFF_BY_US)}
        self.assertTrue(run_script(w).enabled)

    def test_off_by_a_person_stays_off(self):
        w = ok_world(); w[GRAPHQL] = {"out": history(ON_BY_US, OFF_BY_PERSON)}
        r = run_script(w)
        self.assertEqual(r.writes, [])
        self.assertIn("a person switched auto-merge off", r.summary)

    def test_three_github_switch_offs_and_no_fourth(self):
        w = ok_world(); w[GRAPHQL] = {"out": history(ON_BY_US, OFF_BY_GITHUB, ON_BY_US, OFF_BY_GITHUB, ON_BY_US, OFF_BY_GITHUB)}
        self.assertEqual(run_script(w).writes, [])

    def test_a_total_count_above_the_filtered_nodes_gets_past_the_history_check(self):
        for name, answer, how in HISTORY_ANSWERS:
            if how == PASSES:
                with self.subTest(name):
                    r = run_script(history_world(answer))
                    self.assertTrue(ended_as(r, how), r.out)
                    self.assertEqual(r.writes, ["app " + ENABLE])

    def test_a_history_longer_than_it_reads_fails_closed(self):
        for name, answer, how in HISTORY_ANSWERS:
            if how == TOO_LONG:
                with self.subTest(name):
                    r = run_script(history_world(answer))
                    self.failed_closed(r)
                    self.assertTrue(ended_as(r, how), r.out)

    def test_a_missing_or_non_boolean_flag_fails_closed_as_unreadable(self):
        for name, answer, how in HISTORY_ANSWERS:
            if how == UNREADABLE:
                with self.subTest(name):
                    r = run_script(history_world(answer))
                    self.failed_closed(r)
                    self.assertTrue(ended_as(r, how), r.out)

    def test_the_history_query_asks_whether_older_events_were_left_out_and_not_for_a_total(self):
        q = history_query(run_script(ok_world()))
        self.assertIn("timelineItems(last:100,itemTypes:[AUTO_MERGE_ENABLED_EVENT,AUTO_MERGE_DISABLED_EVENT])", q)
        self.assertIn("pageInfo{hasPreviousPage}", q)
        self.assertNotIn("totalCount", q)
        self.assertNotIn("totalCount", code(SCRIPT))

    def test_a_history_cut_short_stops_before_the_re_arm_rules_are_read(self):
        w = history_world(history(ON_BY_US, OFF_BY_PERSON, cut=True))
        self.failed_closed(run_script(w))

    def test_the_re_arm_rules_still_apply_when_the_total_count_is_above_the_nodes(self):
        person = run_script(history_world(history(ON_BY_US, OFF_BY_PERSON, totalCount=12)))
        self.assertEqual(person.writes, [])
        self.assertIn("a person switched auto-merge off", person.summary)
        capped = run_script(history_world(history(ON_BY_US, OFF_BY_GITHUB, ON_BY_US, OFF_BY_GITHUB, ON_BY_US, OFF_BY_GITHUB, totalCount=12)))
        self.assertEqual(capped.writes, [])
        self.assertIn("GitHub switched this pull request's auto-merge off 3 times", capped.summary)
        self.assertTrue(run_script(history_world(history(ON_BY_US, OFF_BY_GITHUB, totalCount=12))).enabled)

    def test_this_apps_auto_merge_on_a_pull_request_that_no_longer_qualifies_is_switched_off(self):
        w = with_pr(ok_world(), auto_merge=OUR_AUTO); w[TESTS_Q] = {"out": runs(run("all-tests", "completed", "failure", 40))}
        self.assertEqual(run_script(w).writes, ["app " + DISABLE])

    def test_a_persons_auto_merge_on_a_pull_request_that_does_not_qualify_is_left(self):
        w = with_pr(ok_world(), auto_merge=THEIR_AUTO); w[TESTS_Q] = {"out": runs(run("all-tests", "completed", "failure", 40))}
        self.assertEqual(run_script(w).writes, [])


class HistoryGuardMutants(unittest.TestCase):
    """Each mutant is the step's script with one change to the history guard; the tests above must tell it from the real script. A mutant that
    does not apply, or that no longer runs at all, would be caught by nothing, so those are checked first."""

    MUTANTS = [
        ("the guard is gone", "if cut is not False:", "if False:"),
        ("the guard is inverted", "if cut is not False:", "if cut is not True:"),
        ("the guard only looks when there are nodes", "if cut is not False:", "if cut is not False and nodes:"),
        ("the guard reads the total again", "if cut is not False:", 'if items.get("totalCount", 0) > len(nodes):'),
        ("the guard ends the job green", 'fail("the pull request\'s auto-merge history is longer', 'finish("the pull request\'s auto-merge history is longer'),
        ("the flag need not be a boolean", "isinstance(cut, bool) and ", ""),
        ("a missing flag reads as not cut", 'items["pageInfo"]["hasPreviousPage"]', 'items.get("pageInfo", {}).get("hasPreviousPage", False)'),
        ("the query does not ask for the flag", "pageInfo{hasPreviousPage} ", ""),
        ("the query asks for the total as well", "pageInfo{hasPreviousPage} ", "totalCount pageInfo{hasPreviousPage} "),
    ]

    @staticmethod
    def caught(script):
        """The first thing the tests above check that this script does differently from the real one, or None."""
        r = run_script(ok_world(), script=script)
        if "Traceback" in r.out or "SyntaxError" in r.out:
            raise AssertionError("the mutant no longer runs: " + r.out)
        q = history_query(r)
        if q is None or "pageInfo{hasPreviousPage}" not in q or "totalCount" in q:
            return "the history query"
        for name, answer, how in HISTORY_ANSWERS:
            if not ended_as(run_script(history_world(answer), script=script), how):
                return name
        return None

    def test_every_mutant_is_caught(self):
        for name, old, new in self.MUTANTS:
            with self.subTest(name):
                self.assertEqual(SCRIPT.count(old), 1, "the mutant does not apply")
                self.assertIsNotNone(self.caught(SCRIPT.replace(old, new)), "no test tells this mutant from the real script")


class FailSafe(Base):
    def failsafe(self, p):
        return run_script({PR_Q: {"out": p}, DISABLE: {"out": ""}}, script=FAILSAFE)

    @unittest.skipUnless(shutil.which("jq"), "jq is not installed")
    def test_the_fail_closed_step(self):
        self.assertEqual(self.failsafe(pr(auto_merge=OUR_AUTO)).writes, ["app " + DISABLE])
        self.assertEqual(self.failsafe(pr(auto_merge=THEIR_AUTO, title="  Hold: x")).writes, ["app " + DISABLE])
        self.assertEqual(self.failsafe(pr(auto_merge=THEIR_AUTO, labels=[{"name": " HOLD "}])).writes, ["app " + DISABLE])
        self.assertEqual(self.failsafe(pr(auto_merge=THEIR_AUTO)).writes, [])
        self.assertEqual(self.failsafe(pr()).writes, [])


class Shape(unittest.TestCase):
    def test_triggers_run_mains_copy_only(self):
        on = RAW[RAW.index("\non:\n"):RAW.index("\npermissions: {}\n")]
        self.assertIn("pull_request_target:", on)
        self.assertIn("workflow_run:", on)
        self.assertIn("workflows: [Tests, merge-by-policy-wake]", on)
        self.assertNotRegex(on, r"\n  pull_request:|\n  pull_request_review:|\n  check_run:|\n  push:|\n  workflow_dispatch:")

    def test_the_on_switch_and_the_workflow_run_arm(self):
        cond = RAW[RAW.index("    if: >-"):RAW.index("    concurrency:")]
        self.assertIn("vars.MERGE_APP_CLIENT_ID != ''", cond)
        self.assertIn("github.event.workflow_run.path == '.github/workflows/tests.yml'", cond)
        self.assertIn("github.event.workflow_run.head_repository.full_name == github.repository", cond)
        self.assertIn("github.event.pull_request.head.repo.full_name == github.repository", cond)

    def test_permissions_none_at_the_top_reads_only_in_the_job_two_for_the_app(self):
        self.assertIn("\npermissions: {}\n", RAW)
        job = RAW[RAW.index("    permissions:\n"):RAW.index("    steps:")]
        self.assertNotIn("write", job)
        self.assertEqual(re.findall(r"permission-([a-z-]+): (\w+)", RAW), [("contents", "write"), ("pull-requests", "write")])

    def test_no_checkout_one_pinned_action_no_expression_in_run_one_secret_once(self):
        self.assertEqual(re.findall(r"uses: (\S+)", RAW), ["actions/create-github-app-token@64ab729a6294000f5aa4a4bc0b73d1f32bc45510"])
        self.assertEqual(re.findall(r"secrets\.[A-Z_]+", RAW), ["secrets.MERGE_APP_PRIVATE_KEY"])
        self.assertIn("environment: merge-by-policy", RAW)
        for text in (SCRIPT, FAILSAFE):
            self.assertNotIn("${{", text)
        self.assertNotIn("checkout", code(RAW))
        self.assertNotIn("--admin", code(RAW))

    def test_the_concurrency_group_is_the_jobs_and_never_cancels(self):
        self.assertNotIn("\nconcurrency:", RAW)
        self.assertIn("    concurrency:\n      group: merge-by-policy-", RAW)
        self.assertIn("cancel-in-progress: false", RAW)

    def test_the_fail_closed_step_runs_after_a_failure_or_a_cancel(self):
        self.assertIn("if: (failure() || cancelled()) && steps.token.outcome == 'success'", RAW)

    def test_the_wake_holds_nothing(self):
        self.assertIn("\npermissions: {}\n", WAKE)
        for word in ("secrets.", "environment:", "uses:", "${{", "checkout"):
            self.assertNotIn(word, code(WAKE))
        self.assertIn("pull_request_review:", WAKE)

    def test_tests_is_the_name_the_workflow_run_trigger_waits_for(self):
        tests = read(os.path.join(WF, "tests.yml"))
        self.assertRegex(tests, r"(?m)^name: Tests$")
        self.assertRegex(tests, r"(?m)^  all-tests:$")
        self.assertRegex(WAKE, r"(?m)^name: merge-by-policy-wake$")


if __name__ == "__main__":
    unittest.main(verbosity=2)
