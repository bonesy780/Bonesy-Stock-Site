"""Check the data about to be published, write site/status.json, and raise an alert when something stays broken.

Every build step already keeps the last good data when its source fails, so a failure no longer blanks a
page. The risk that's left is the site quietly going stale. This step looks at each data file's own
timestamp and size, and at which build steps failed, then:
- writes site/status.json (what's fresh, what isn't, and which steps failed) for anyone checking by hand;
- opens a GitHub issue, assigned to the repository owner, when a problem lasts more than one run (GitHub
  emails the owner), adds a comment when the list of problems changes, and closes the issue once
  everything is healthy again.

It never fails the build. Run from the repo root after the build steps:
    STEPS='{"prices": "success", ...}' python scripts/check_site.py
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from safe_io import read_json, write_json  # noqa: E402

SITE = Path(__file__).resolve().parent.parent / "site"
STATUS = SITE / "status.json"
TITLE = "Site health: data is not updating"

# file, what the reader sees, timestamp key, hours before it counts as stale, smallest sensible size
# (Full refreshes run weekday evenings and Sunday midday, so the longest normal gap is Friday night to Sunday.)
DATASETS = [
    ("data.json", "Top stocks, buy and sell ideas", "generated", 44, lambda d: sum(len(i.get("top") or []) for i in d.get("indexes") or []) >= 40),
    ("market.json", "Screener, heatmap, movers and tools", "generated", 44, lambda d: len(d.get("stocks") or []) >= 1000),
    ("news.json", "Market news", "generated", 3, lambda d: sum(len(m.get("stories") or []) for m in d.get("markets") or []) >= 20),
    ("aerospace.json", "Aerospace & Defence page", "generated", 3, lambda d: len(d.get("stocks") or []) >= 30),
    ("daily/news.json", "Daily News page", "generated", 3, lambda d: len(d.get("stories") or []) >= 200),
    ("re/data.json", "Real estate markets", "updated", 44, lambda d: len(d.get("markets") or []) >= 50),
    ("re/news.json", "Housing news", "updated", 4, lambda d: sum(len(v) for v in (d.get("news") or {}).values()) >= 20),
    ("stocks.json", "Stock lookup search list", None, None, lambda d: len(d or []) >= 1000),
]
# Consecutive failed runs of one step before it's reported (quick steps run every 15 minutes)
STEP_STREAK = 3


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def when(v):
    try:
        d = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def check(now: datetime) -> tuple[dict, dict[str, str]]:
    """Each dataset's state, and the problems found keyed by what is wrong (so a problem can be
    recognised from one run to the next even though its wording, such as an age in hours, changes)."""
    sets, problems = {}, {}
    for path, label, key, max_h, enough in DATASETS:
        d = read_json(SITE / path, None)
        row = {"label": label}
        if d is None:
            row["ok"] = False
            problems[f"{path}:missing"] = f"{label} ({path}) is missing or unreadable"
        else:
            row["ok"] = True
            at = when(d.get(key)) if key and isinstance(d, dict) else None
            if at:
                row["updated"] = at.isoformat(timespec="minutes")
                row["ageHours"] = round((now - at).total_seconds() / 3600, 1)
                row["maxHours"] = max_h
                if row["ageHours"] > max_h:
                    row["ok"] = False
                    problems[f"{path}:stale"] = f"{label} ({path}) was last updated {row['ageHours']:.0f} hours ago"
            try:
                big_enough = enough(d)
            except Exception:  # noqa: BLE001
                big_enough = False
            if not big_enough:
                row["ok"] = False
                problems[f"{path}:small"] = f"{label} ({path}) has far less data than usual"
            if isinstance(d, dict) and path == "data.json":
                stale = [i["name"] for i in d.get("indexes") or [] if i.get("stale")]
                if stale:
                    row["staleIndexes"] = stale
                    problems["data.json:staleIndexes"] = ("Showing the last good list for " + ", ".join(stale)
                                                          + " (prices didn't come back)")
        sets[path] = row
    return sets, problems


def github(method: str, path: str, **kw):
    token, repo = os.environ.get("GITHUB_TOKEN"), os.environ.get("GITHUB_REPOSITORY")
    if not token or not repo:
        return None
    r = requests.request(method, f"https://api.github.com/repos/{repo}{path}", timeout=20,
                         headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"}, **kw)
    r.raise_for_status()
    return r.json() if r.content else None


def alert(problems: list[str], changed: bool, run_url: str) -> None:
    """Open, update or close the one health issue."""
    issues = github("GET", "/issues", params={"state": "open", "creator": "github-actions[bot]", "per_page": 50}) or []
    open_issue = next((i for i in issues if i.get("title") == TITLE and "pull_request" not in i), None)
    if problems:
        body = ("The automatic data refresh has hit problems that lasted more than one run. The site keeps "
                "showing the last good data meanwhile.\n\n" + "\n".join(f"- {p}" for p in problems)
                + f"\n\nLatest run: {run_url}\n\nThis issue closes itself once everything is updating again.")
        if not open_issue:
            owner = os.environ.get("GITHUB_REPOSITORY_OWNER")
            github("POST", "/issues", json={"title": TITLE, "body": body, **({"assignees": [owner]} if owner else {})})
            log("opened a site health issue")
        elif changed:
            github("POST", f"/issues/{open_issue['number']}/comments", json={"body": "Problems now:\n\n" + "\n".join(f"- {p}" for p in problems) + f"\n\nRun: {run_url}"})
            log("updated the site health issue")
    elif open_issue:
        github("POST", f"/issues/{open_issue['number']}/comments", json={"body": f"Everything is updating again ({run_url}). Closing."})
        github("PATCH", f"/issues/{open_issue['number']}", json={"state": "closed", "state_reason": "completed"})
        log("closed the site health issue")


def main():
    now = datetime.now(timezone.utc)
    prev = read_json(STATUS, {}) or {}
    sets, problems = check(now)

    # Steps that failed this run (continue-on-error keeps the run going), counted across runs
    try:
        steps = json.loads(os.environ.get("STEPS") or "{}")
    except ValueError:
        steps = {}
    streaks = dict(prev.get("failStreak") or {})
    for name, outcome in steps.items():
        if outcome == "failure":
            streaks[name] = streaks.get(name, 0) + 1
        elif outcome == "success":
            streaks.pop(name, None)
    failing = {k: v for k, v in streaks.items() if v >= STEP_STREAK}
    step_problems = [f"The '{k}' step has failed {v} runs in a row" for k, v in sorted(failing.items())]

    # Data problems count once they are seen in two checks in a row (one slow run isn't worth an email)
    before = set(prev.get("seen") or [])
    lasting = [msg for key, msg in problems.items() if key in before]
    report = lasting + step_problems
    keys = sorted(k for k in problems if k in before) + sorted(failing)
    run_url = f"{os.environ.get('GITHUB_SERVER_URL', 'https://github.com')}/{os.environ.get('GITHUB_REPOSITORY', '')}/actions/runs/{os.environ.get('GITHUB_RUN_ID', '')}"
    found = list(problems.values()) + step_problems
    status = {"checked": now.isoformat(timespec="minutes"), "ok": not found,
              "datasets": sets, "problems": found, "seen": sorted(problems),
              "failStreak": streaks, "reported": keys}
    write_json(STATUS, status, ensure_ascii=False)
    for p in found:
        log(f"::warning::{p}")
    log(f"site check: {'all fresh' if not found else str(len(found)) + ' problem(s)'}")
    try:
        alert(report, keys != (prev.get("reported") or []), run_url)
    except Exception as e:  # noqa: BLE001  never fail the build over the alert itself
        log(f"::warning::could not update the site health issue ({e})")


if __name__ == "__main__":
    main()
