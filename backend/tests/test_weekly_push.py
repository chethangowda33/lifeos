"""Sunday weekly-recap push.

The schedule is the whole feature: this fires from an external cron that runs
every 15 minutes, has no memory, and may miss a run entirely. So the decision of
"is a recap due for this user right now" is a pure function over the user's
settings and their local clock, and it is what's tested here — delivery itself
is pywebpush's job and is proven separately on a real device.

`weekly_push_body` is tested for the one thing that isn't cosmetic: a week with
nothing in it produces no push at all.
"""
import os
from datetime import datetime

import pytest
import requests

from server import (WEEKLY_PUSH_GRACE_MINUTES, WEEKLY_PUSH_HOUR,
                    weekly_push_body, weekly_push_due)

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"

ON = {"weekly_report_push_enabled": True}
SUNDAY = datetime(2026, 8, 2, WEEKLY_PUSH_HOUR, 0)   # 2026-W31
SUNDAY_KEY = "2026-W31"


# ── when it fires ─────────────────────────────────────────────────────────────

def test_opted_out_is_never_due():
    assert weekly_push_due({}, SUNDAY) is None
    assert weekly_push_due({"weekly_report_push_enabled": False}, SUNDAY) is None


def test_due_on_sunday_evening():
    assert weekly_push_due(ON, SUNDAY) == SUNDAY_KEY


@pytest.mark.parametrize("day", [27, 28, 29, 30, 31, 1])  # Mon-Sat around that Sunday
def test_never_due_on_any_other_weekday(day):
    when = datetime(2026, 7 if day > 20 else 8, day, WEEKLY_PUSH_HOUR, 0)
    assert when.weekday() != 6, "fixture must not be a Sunday"
    assert weekly_push_due(ON, when) is None


def test_not_due_before_the_hour():
    assert weekly_push_due(ON, datetime(2026, 8, 2, WEEKLY_PUSH_HOUR - 1, 59)) is None
    assert weekly_push_due(ON, datetime(2026, 8, 2, 0, 0)) is None


def test_the_grace_window_has_an_end():
    """A cron outage must not deliver 'your week' at 3am Monday-morning-ish. The
    window closes and the recap is simply skipped."""
    last_ok = datetime(2026, 8, 2, WEEKLY_PUSH_HOUR + WEEKLY_PUSH_GRACE_MINUTES // 60, 0)
    assert weekly_push_due(ON, last_ok) == SUNDAY_KEY
    assert weekly_push_due(ON, last_ok.replace(minute=1)) is None


def test_only_sends_once_per_week():
    settings = {**ON, "last_weekly_push": SUNDAY_KEY}
    assert weekly_push_due(settings, SUNDAY) is None
    # ...but a run 15 minutes later inside the window is the same key, still silent.
    assert weekly_push_due(settings, SUNDAY.replace(minute=15)) is None


def test_last_weeks_stamp_does_not_block_this_week():
    assert weekly_push_due({**ON, "last_weekly_push": "2026-W30"}, SUNDAY) == SUNDAY_KEY


def test_week_key_is_zero_padded():
    """Unpadded, W5 and W50 sort and compare wrong, and a stamp written one way
    would never match one read the other."""
    assert weekly_push_due(ON, datetime(2026, 2, 1, WEEKLY_PUSH_HOUR, 0)) == "2026-W05"


def test_key_follows_the_iso_year_not_the_calendar_year():
    """Sunday 2027-01-03 closes the week that began Mon 2026-12-28 — ISO 2026-W53.
    Keying it '2027-W01' would fire twice across the new year."""
    assert weekly_push_due(ON, datetime(2027, 1, 3, WEEKLY_PUSH_HOUR, 0)) == "2026-W53"


# ── what it says ──────────────────────────────────────────────────────────────

def test_a_quiet_week_produces_no_push():
    assert weekly_push_body({"workouts": 0, "volume_kg": 0, "prs": []}) is None
    assert weekly_push_body({}) is None


def test_body_is_the_users_own_numbers():
    assert weekly_push_body(
        {"workouts": 4, "volume_kg": 18432.0, "prs": [1, 2]}
    ) == "4 sessions · 18.4k kg · 2 PRs"


def test_body_singulars():
    assert weekly_push_body({"workouts": 1, "volume_kg": 850.0, "prs": [1]}) == "1 session · 850 kg · 1 PR"


def test_body_omits_prs_when_there_were_none():
    body = weekly_push_body({"workouts": 3, "volume_kg": 5000.0, "prs": []})
    assert body == "3 sessions · 5.0k kg"
    assert "PR" not in body


# ── the dispatch endpoint ─────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def session():
    return requests.Session()


def test_dispatch_rejects_a_missing_or_wrong_secret(session):
    """The one guard on an unauthenticated, side-effectful endpoint. Worth a test
    of its own now that it also sends weekly recaps."""
    assert session.post(f"{API}/push/dispatch").status_code == 401
    assert session.post(f"{API}/push/dispatch",
                        headers={"X-Dispatch-Secret": "nope"}).status_code == 401
