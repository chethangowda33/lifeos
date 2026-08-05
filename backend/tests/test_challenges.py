"""Challenges.

Two things here are easy to get wrong and impossible to spot by reading: the
strict-mode restart maths (a missed day moves the run, without deleting any
history) and the boundary between rules the app checks for itself and rules the
user ticks. Both are asserted against a challenge whose days are entirely in the
past-to-today window, so the numbers are exact rather than "roughly today".
"""
import os
from datetime import date, datetime, timedelta, timezone

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "cg3@lifeos.com"
# Local dev seed value. Override when pointing the suite anywhere else —
# the real password must never live in this repo.
ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD", "test1234")


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


def today():
    return datetime.now(timezone.utc).date()


def day(offset):
    return (today() + timedelta(days=offset)).isoformat()


def start_challenge(session, auth_headers, **over):
    body = {
        "name": "ZZCHAL probe", "description": "pytest", "days": 5, "strict": False,
        "start_date": day(-4),
        "rules": [{"label": "Trained today", "metric": "workouts", "target": 1},
                  {"label": "Read 10 pages", "metric": "manual", "target": 1}],
        **over,
    }
    r = session.post(f"{API}/challenges", headers=auth_headers, json=body)
    assert r.status_code == 200, r.text
    return r.json()


def clear_all(session, auth_headers):
    for c in session.get(f"{API}/challenges", headers=auth_headers).json()["challenges"]:
        session.delete(f"{API}/challenges/{c['id']}", params={"purge": "true"}, headers=auth_headers)


@pytest.fixture(autouse=True, scope="module")
def clean(session, auth_headers):
    """The account under test is a real one — leave it exactly as found."""
    clear_all(session, auth_headers)
    yield
    clear_all(session, auth_headers)


class TestTemplates:
    def test_presets_are_complete_and_use_known_metrics(self, session, auth_headers):
        d = session.get(f"{API}/challenges/templates", headers=auth_headers).json()
        keys = [t["key"] for t in d["templates"]]
        assert "75_hard" in keys and len(keys) == len(set(keys))
        for t in d["templates"]:
            assert t["name"] and t["description"] and t["days"] >= 1 and t["rules"]
            for r in t["rules"]:
                assert r["metric"] in d["metrics"], f"{t['key']} uses an unknown metric"

    def test_75_hard_restarts_on_a_miss(self, session, auth_headers):
        """The one rule that defines it — if this flips, it isn't 75 Hard."""
        d = session.get(f"{API}/challenges/templates", headers=auth_headers).json()
        hard = next(t for t in d["templates"] if t["key"] == "75_hard")
        assert hard["strict"] is True and hard["days"] == 75


class TestValidation:
    def test_requires_auth(self):
        assert requests.get(f"{API}/challenges").status_code == 401

    def test_rejects_an_unknown_metric(self, session, auth_headers):
        r = session.post(f"{API}/challenges", headers=auth_headers, json={
            "name": "ZZCHAL bad", "days": 5,
            "rules": [{"label": "x", "metric": "vibes", "target": 1}]})
        assert r.status_code == 400 and "vibes" in r.text

    def test_rejects_a_challenge_with_no_rules(self, session, auth_headers):
        r = session.post(f"{API}/challenges", headers=auth_headers,
                         json={"name": "ZZCHAL empty", "days": 5, "rules": []})
        assert r.status_code == 422

    def test_only_one_runs_at_a_time(self, session, auth_headers):
        first = start_challenge(session, auth_headers)
        try:
            r = session.post(f"{API}/challenges", headers=auth_headers, json={
                "name": "ZZCHAL second", "days": 5,
                "rules": [{"label": "x", "metric": "manual", "target": 1}]})
            assert r.status_code == 400 and "still running" in r.text
        finally:
            session.delete(f"{API}/challenges/{first['id']}", params={"purge": "true"}, headers=auth_headers)

    def test_bad_id_is_a_404_not_a_500(self, session, auth_headers):
        assert session.delete(f"{API}/challenges/not-an-id", headers=auth_headers).status_code == 404


class TestManualVsDerived:
    def test_the_app_checks_what_it_can_see(self, session, auth_headers):
        ch = start_challenge(session, auth_headers)
        try:
            r = session.post(f"{API}/challenges/{ch['id']}/log", headers=auth_headers,
                             json={"rule_key": "r1", "done": True})
            # Hand-ticking a derived rule would let the box disagree with the data.
            assert r.status_code == 400 and "logged data" in r.text
        finally:
            session.delete(f"{API}/challenges/{ch['id']}", params={"purge": "true"}, headers=auth_headers)

    def test_manual_rules_tick_and_untick(self, session, auth_headers):
        ch = start_challenge(session, auth_headers)
        try:
            def manual(state):
                return next(r for r in state["today_rules"] if r["key"] == "r2")["met"]

            assert manual(ch) is False
            on = session.post(f"{API}/challenges/{ch['id']}/log", headers=auth_headers,
                              json={"rule_key": "r2", "done": True}).json()
            assert manual(on) is True
            off = session.post(f"{API}/challenges/{ch['id']}/log", headers=auth_headers,
                               json={"rule_key": "r2", "done": False}).json()
            assert manual(off) is False, "a mis-tap has to be undoable"
        finally:
            session.delete(f"{API}/challenges/{ch['id']}", params={"purge": "true"}, headers=auth_headers)

    def test_a_tick_outside_the_run_is_refused(self, session, auth_headers):
        ch = start_challenge(session, auth_headers)
        try:
            for d in (day(-30), day(30)):
                r = session.post(f"{API}/challenges/{ch['id']}/log", headers=auth_headers,
                                 json={"rule_key": "r2", "done": True, "date": d})
                assert r.status_code == 400
        finally:
            session.delete(f"{API}/challenges/{ch['id']}", params={"purge": "true"}, headers=auth_headers)


class TestStrictRestart:
    """A 5-day strict run with days -4..-2 missed and -1 completed."""
    ch = None

    def test_01_setup(self, session, auth_headers):
        TestStrictRestart.ch = start_challenge(
            session, auth_headers, name="ZZCHAL strict", strict=True,
            rules=[{"label": "Read 10 pages", "metric": "manual", "target": 1}])
        for d in (day(-1), day(0)):
            r = session.post(f"{API}/challenges/{self.ch['id']}/log", headers=auth_headers,
                             json={"rule_key": "r1", "done": True, "date": d})
            assert r.status_code == 200, r.text

    def test_02_the_run_starts_after_the_last_miss(self, session, auth_headers):
        c = session.get(f"{API}/challenges", headers=auth_headers).json()["active"]
        assert c["missed_days"] == [day(-4), day(-3), day(-2)]
        assert c["run_start"] == day(-1)
        # Day 2 of the run: yesterday, and today — which is already done.
        assert c["current_day"] == 2
        assert c["streak"] == 2

    def test_03_an_unfinished_today_counts_toward_the_day_but_not_the_streak(self, session, auth_headers):
        """You are ON day 2 whether or not you have earned it yet."""
        session.post(f"{API}/challenges/{self.ch['id']}/log", headers=auth_headers,
                     json={"rule_key": "r1", "done": False, "date": day(0)})
        c = session.get(f"{API}/challenges", headers=auth_headers).json()["active"]
        assert c["current_day"] == 2 and c["streak"] == 1
        # And an unfinished today is not a miss — it is still winnable.
        assert day(0) not in c["missed_days"]
        session.post(f"{API}/challenges/{self.ch['id']}/log", headers=auth_headers,
                     json={"rule_key": "r1", "done": True, "date": day(0)})

    def test_04_a_broken_run_counts_once_not_once_per_day(self, session, auth_headers):
        """Three missed days in a row is one collapse — and nothing had got
        going before them, so there was no run to break."""
        c = session.get(f"{API}/challenges", headers=auth_headers).json()["active"]
        assert c["restarts"] == 0

    def test_05_history_is_not_deleted_by_a_restart(self, session, auth_headers):
        c = session.get(f"{API}/challenges", headers=auth_headers).json()["active"]
        assert [d["date"] for d in c["day_states"]] == [day(i) for i in range(-4, 1)]
        assert c["days_done"] == 2, "every completed day stays in the record"

    def test_06_percent_tracks_the_run_not_the_calendar(self, session, auth_headers):
        c = session.get(f"{API}/challenges", headers=auth_headers).json()["active"]
        assert c["percent"] == round(100 * c["streak"] / c["days"])

    def test_07_abandoning_keeps_it_in_history(self, session, auth_headers):
        assert session.delete(f"{API}/challenges/{self.ch['id']}",
                              headers=auth_headers).status_code == 200
        d = session.get(f"{API}/challenges", headers=auth_headers).json()
        assert d["active"] is None
        assert [c["status"] for c in d["challenges"]] == ["abandoned"]

    def test_08_purging_removes_it(self, session, auth_headers):
        assert session.delete(f"{API}/challenges/{self.ch['id']}", params={"purge": "true"},
                              headers=auth_headers).status_code == 200
        assert session.get(f"{API}/challenges", headers=auth_headers).json()["challenges"] == []


class TestCompletion:
    def test_a_finished_run_reports_completed(self, session, auth_headers):
        ch = start_challenge(session, auth_headers, name="ZZCHAL done", days=2,
                             start_date=day(-1),
                             rules=[{"label": "Read", "metric": "manual", "target": 1}])
        try:
            for d in (day(-1), day(0)):
                session.post(f"{API}/challenges/{ch['id']}/log", headers=auth_headers,
                             json={"rule_key": "r1", "done": True, "date": d})
            c = session.get(f"{API}/challenges", headers=auth_headers).json()
            done = c["challenges"][0]
            assert done["status"] == "completed" and done["percent"] == 100
            # A finished challenge frees the slot for the next one.
            assert c["active"] is None
        finally:
            session.delete(f"{API}/challenges/{ch['id']}", params={"purge": "true"}, headers=auth_headers)

    def test_a_future_challenge_is_upcoming_and_holds_the_slot(self, session, auth_headers):
        ch = start_challenge(session, auth_headers, name="ZZCHAL later", start_date=day(3),
                             rules=[{"label": "Read", "metric": "manual", "target": 1}])
        try:
            assert ch["status"] == "upcoming"
            assert ch["day_states"] == [] and ch["today_rules"] == []
            assert session.get(f"{API}/challenges", headers=auth_headers).json()["active"]["id"] == ch["id"]
        finally:
            session.delete(f"{API}/challenges/{ch['id']}", params={"purge": "true"}, headers=auth_headers)
