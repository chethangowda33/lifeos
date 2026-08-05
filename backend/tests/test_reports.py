"""Period reports (weekly / monthly).

A report is the one screen where the AI speaks in the user's own numbers, so what
matters is that the numbers are *computed*, not narrated. These lock in the three
things that break silently: the period boundaries (including the year rollover and
the still-running period), and that every figure moves with the underlying data —
and moves back when it is deleted.

The narrative itself is not asserted here: it costs an LLM call and its wording is
not a contract. The guard that stops it being called for an empty period is.
"""
import os
from datetime import datetime, timezone

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "cg3@lifeos.com"
# Local dev seed value. Override when pointing the suite anywhere else —
# the real password must never live in this repo.
ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD", "test1234")

# Far from any real data, so recovery assertions neither read nor disturb it.
ISOLATED_DAY = "2019-03-14"  # a Thursday


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def auth_headers(session):
    r = session.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def get_report(session, auth_headers, **params):
    r = session.get(f"{API}/reports", params=params, headers=auth_headers)
    assert r.status_code == 200, r.text
    return r.json()


class TestPeriodBounds:
    @pytest.mark.parametrize("period,offset,today,start,end", [
        # Thursday — the week runs Monday to Sunday and can spill into next month.
        ("week", 0, "2026-07-30", "2026-07-27", "2026-08-02"),
        ("week", 1, "2026-07-30", "2026-07-20", "2026-07-26"),
        # Sunday is the LAST day of its week, not the first.
        ("week", 0, "2026-03-01", "2026-02-23", "2026-03-01"),
        ("month", 0, "2026-07-30", "2026-07-01", "2026-07-31"),
        ("month", 1, "2026-01-15", "2025-12-01", "2025-12-31"),  # year rollover
        ("month", 0, "2026-02-15", "2026-02-01", "2026-02-28"),
        ("month", 0, "2024-02-15", "2024-02-01", "2024-02-29"),  # leap year
    ])
    def test_bounds(self, session, auth_headers, period, offset, today, start, end):
        d = get_report(session, auth_headers, period=period, offset=offset, today=today)
        assert (d["start"], d["end"]) == (start, end)

    def test_running_period_counts_only_the_days_that_happened(self, session, auth_headers):
        """A habit at 2/7 on a Tuesday reads as failure. Score the days elapsed."""
        d = get_report(session, auth_headers, period="week", offset=0, today="2026-07-30")
        assert d["days_total"] == 7 and d["days_elapsed"] == 4 and d["current"] is True

    def test_finished_period_counts_every_day(self, session, auth_headers):
        d = get_report(session, auth_headers, period="week", offset=1, today="2026-07-30")
        assert d["days_elapsed"] == 7 and d["current"] is False

    def test_previous_block_is_the_period_before(self, session, auth_headers):
        d = get_report(session, auth_headers, period="month", offset=0, today="2026-01-10")
        assert d["label"] == "January 2026"
        assert d["previous"]["label"] == "December 2025"

    def test_monthly_target_scales_with_the_weekly_setting(self, session, auth_headers):
        """The weekly goal is a user setting; a month is not 4 weeks."""
        wk = get_report(session, auth_headers, period="week", offset=0, today="2026-07-30")
        mo = get_report(session, auth_headers, period="month", offset=0, today="2026-07-30")
        assert mo["workout_target"] == round(wk["workout_target"] * 31 / 7)


class TestValidation:
    @pytest.mark.parametrize("params", [
        {"period": "year"},
        {"period": "week", "today": "30-07-2026"},
        {"period": "week", "offset": 999},
        {"period": "week", "offset": -1},
    ])
    def test_rejected(self, session, auth_headers, params):
        r = session.get(f"{API}/reports", params=params, headers=auth_headers)
        assert r.status_code == 400, r.text

    def test_requires_auth(self):
        # Not the shared session — logging in put an auth cookie on it.
        assert requests.get(f"{API}/reports").status_code == 401

    def test_narrative_refuses_an_empty_period(self, session, auth_headers):
        """Nothing to narrate — and no reason to spend an AI call finding out."""
        r = session.post(f"{API}/reports/narrative",
                         params={"period": "week", "offset": 400, "today": "2026-07-30"},
                         headers=auth_headers)
        assert r.status_code == 400


class TestTrainingNumbersFollowTheData:
    """Run against a throwaway custom exercise so real PR/progression state is
    never touched, and delete everything afterwards."""
    exercise_id = None
    workout_id = None
    baseline = None

    @staticmethod
    def _today():
        # Workout timestamps are UTC, so the window has to be asked for in UTC.
        return datetime.now(timezone.utc).date().isoformat()

    def test_01_baseline(self, session, auth_headers):
        r = session.post(f"{API}/exercises", headers=auth_headers, json={
            "name": "ZZREPORT Test Lift", "muscle_group": "chest", "equipment": "barbell",
        })
        assert r.status_code == 200, r.text
        TestTrainingNumbersFollowTheData.exercise_id = r.json()["id"]
        TestTrainingNumbersFollowTheData.baseline = get_report(
            session, auth_headers, period="week", offset=0, today=self._today())

    def test_02_logging_a_workout_moves_every_figure(self, session, auth_headers):
        r = session.post(f"{API}/workouts", headers=auth_headers, json={
            "name": "ZZREPORT session", "duration_seconds": 600,
            "exercises": [{
                "exercise_id": self.exercise_id, "notes": "", "rest_timer_seconds": 90,
                "sets": [
                    {"set_type": "warmup", "kg": 20, "reps": 10, "completed": True},
                    {"set_type": "working", "kg": 50, "reps": 10, "rpe": 8, "completed": True},
                    {"set_type": "working", "kg": 50, "reps": 8, "rpe": 9, "completed": True},
                    {"set_type": "working", "kg": 50, "reps": 8, "completed": False},
                ],
            }],
        })
        assert r.status_code == 200, r.text
        TestTrainingNumbersFollowTheData.workout_id = r.json()["id"]

        before, after = self.baseline["training"], get_report(
            session, auth_headers, period="week", offset=0, today=self._today())["training"]
        assert after["workouts"] == before["workouts"] + 1
        assert after["sets"] == before["sets"] + 3          # completed only
        assert after["duration_seconds"] == before["duration_seconds"] + 600
        # Volume counts the warm-up (as /workouts does); hard sets must not.
        assert after["volume_kg"] == pytest.approx(before["volume_kg"] + 200 + 500 + 400)

    def test_03_hard_sets_exclude_warmups(self, session, auth_headers):
        d = get_report(session, auth_headers, period="week", offset=0, today=self._today())
        chest = next((m for m in d["training"]["muscles"] if m["muscle_group"] == "chest"), None)
        was = next((m for m in self.baseline["training"]["muscles"]
                    if m["muscle_group"] == "chest"), {"hard_sets": 0})
        assert chest and chest["hard_sets"] == was["hard_sets"] + 2

    def test_04_exercise_is_ranked_by_its_volume(self, session, auth_headers):
        d = get_report(session, auth_headers, period="week", offset=0, today=self._today())
        mine = next(x for x in d["training"]["top_exercises"] if x["name"] == "ZZREPORT Test Lift")
        assert mine["sets"] == 3 and mine["volume_kg"] == pytest.approx(1100)
        assert mine["best_e1rm"] > 50  # Epley on 50 kg x 10

    def test_05_signature_tracks_the_numbers(self, session, auth_headers):
        """A cached narrative is marked stale by comparing this — if it didn't
        move with the data, a rewritten week would keep last week's story."""
        d = get_report(session, auth_headers, period="week", offset=0, today=self._today())
        assert d["signature"] != self.baseline["signature"]

    def test_06_deleting_puts_it_all_back(self, session, auth_headers):
        assert session.delete(f"{API}/workouts/{self.workout_id}",
                              headers=auth_headers).status_code == 200
        assert session.delete(f"{API}/exercises/{self.exercise_id}",
                              headers=auth_headers).status_code == 200
        after = get_report(session, auth_headers, period="week", offset=0, today=self._today())
        assert after["training"] == self.baseline["training"]
        assert after["signature"] == self.baseline["signature"]


class TestRecoveryBlock:
    def test_sleep_lands_in_the_right_week_and_leaves_cleanly(self, session, auth_headers):
        before = get_report(session, auth_headers, period="week", offset=0, today=ISOLATED_DAY)
        assert before["recovery"]["sleep_nights"] == 0

        r = session.post(f"{API}/sleep", headers=auth_headers,
                         json={"date": ISOLATED_DAY, "hours": 7.5, "quality": 4})
        assert r.status_code == 200, r.text
        log_id = r.json()["id"]
        try:
            d = get_report(session, auth_headers, period="week", offset=0, today=ISOLATED_DAY)
            assert d["recovery"]["sleep_nights"] == 1
            assert d["recovery"]["sleep_avg_hours"] == 7.5
            assert d["recovery"]["sleep_quality"] == 4
            assert d["has_data"] is True
            # The week before must not see it — an off-by-one here would move a
            # night into the wrong report and nobody would ever notice.
            prev = get_report(session, auth_headers, period="week", offset=1, today=ISOLATED_DAY)
            assert prev["recovery"]["sleep_nights"] == 0
        finally:
            assert session.delete(f"{API}/sleep/{log_id}", headers=auth_headers).status_code == 200
        after = get_report(session, auth_headers, period="week", offset=0, today=ISOLATED_DAY)
        assert after["recovery"]["sleep_nights"] == 0
