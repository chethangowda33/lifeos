"""Life Score + raw health ingest.

Both shipped in session 6 with no coverage because Docker was down. These lock in
the judgement calls that are easy to regress silently: which categories count, the
two-signal rule, timezone handling, and how raw Health samples are summed.
"""
import os
from datetime import date, timedelta

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "cg3@lifeos.com"
ADMIN_PASSWORD = "test1234"


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


@pytest.fixture(scope="module")
def health_token(session, auth_headers):
    return session.get(f"{API}/health/connection", headers=auth_headers).json()["token"]


# A day far from any real data, so these tests neither read nor disturb it.
ISOLATED_DAY = "2019-03-14"
PRIOR_DAY = "2019-03-13"


class TestLifeScore:
    def test_shape_and_categories(self, session, auth_headers):
        r = session.get(f"{API}/life-score", params={"date": ISOLATED_DAY}, headers=auth_headers)
        assert r.status_code == 200
        d = r.json()
        assert d["date"] == ISOLATED_DAY
        keys = [c["key"] for c in d["categories"]]
        assert keys == ["fitness", "nutrition", "habits", "sleep", "activity"]
        for c in d["categories"]:
            assert 0 <= c["score"] <= 100, f"{c['key']} out of range"
            assert isinstance(c["available"], bool)

    def test_untracked_categories_score_zero_not_stale(self, session, auth_headers):
        """An unavailable category must not report a leftover number — "89" beside
        "not logged" reads as a bug."""
        d = session.get(f"{API}/life-score", params={"date": ISOLATED_DAY},
                        headers=auth_headers).json()
        for c in d["categories"]:
            if not c["available"]:
                assert c["score"] == 0, f"{c['key']} kept a stale score"

    def test_overall_withheld_until_two_signals(self, session, auth_headers):
        """One category averaged is that category relabelled — and usually a
        demoralising 0. It must be withheld, with the flag set."""
        d = session.get(f"{API}/life-score", params={"date": ISOLATED_DAY},
                        headers=auth_headers).json()
        if d["tracked"] < 2:
            assert d["overall"] is None
            assert d["needs_more_tracking"] is True
        else:
            assert isinstance(d["overall"], int)
            assert d["needs_more_tracking"] is False

    def test_rejects_malformed_date(self, session, auth_headers):
        for bad in ("not-a-date", "2026-13-01x", "22-07-2026"):
            r = session.get(f"{API}/life-score", params={"date": bad}, headers=auth_headers)
            assert r.status_code == 400, f"accepted {bad!r}"

    def test_scores_the_requested_day_not_utc_today(self, session, auth_headers):
        """The regression that shipped in session 6: habits/sleep/intake are stored
        against the user's LOCAL date, so scoring the UTC day reads the wrong one
        east of UTC before ~06:00."""
        habit = session.post(f"{API}/habits", headers=auth_headers,
                             json={"name": "TEST_tz_habit", "emoji": "T", "type": "check"}).json()
        try:
            session.post(f"{API}/habits/{habit['id']}/log", headers=auth_headers,
                         json={"date": ISOLATED_DAY})

            on_day = session.get(f"{API}/life-score", params={"date": ISOLATED_DAY},
                                 headers=auth_headers).json()
            off_day = session.get(f"{API}/life-score", params={"date": PRIOR_DAY},
                                  headers=auth_headers).json()

            hd_on = next(c for c in on_day["categories"] if c["key"] == "habits")
            hd_off = next(c for c in off_day["categories"] if c["key"] == "habits")
            assert hd_on["score"] == 100, "the ticked day must see the tick"
            assert hd_off["score"] == 0, "the day before must not"
        finally:
            session.delete(f"{API}/habits/{habit['id']}", headers=auth_headers)

    def test_weekly_target_drives_fitness(self, session, auth_headers):
        """A 6x/week lifter must not be capped by a hardcoded 4."""
        before = session.get(f"{API}/workout-settings", headers=auth_headers).json()
        try:
            for n in (2, 6):
                session.put(f"{API}/workout-settings", headers=auth_headers,
                            json={"weekly_workout_target": n})
                d = session.get(f"{API}/life-score", params={"date": ISOLATED_DAY},
                                headers=auth_headers).json()
                fit = next(c for c in d["categories"] if c["key"] == "fitness")
                assert f"of {n} sessions" in fit["detail"], fit["detail"]
            # 0 must fall back rather than divide by zero
            session.put(f"{API}/workout-settings", headers=auth_headers,
                        json={"weekly_workout_target": 0})
            r = session.get(f"{API}/life-score", params={"date": ISOLATED_DAY}, headers=auth_headers)
            assert r.status_code == 200
        finally:
            session.put(f"{API}/workout-settings", headers=auth_headers,
                        json={"weekly_workout_target": before.get("weekly_workout_target", 4)})

    def test_requires_auth(self):
        assert requests.get(f"{API}/life-score").status_code == 401


class TestRawHealthIngest:
    """Shortcuts serialises a Health Samples variable differently per iOS version,
    so the parser must cope with every shape — and must never inflate a total."""

    def _send(self, session, token, body, metric="steps"):
        return session.post(
            f"{API}/health/ingest/raw", params={"metric": metric, "date": ISOLATED_DAY},
            headers={"X-Health-Token": token, "Content-Type": "text/plain"}, data=body,
        ).json()

    @pytest.mark.parametrize("body,expected", [
        ("412", 412),
        ("[120, 200, 92]", 412),
        ('[{"value":120},{"value":200},{"value":92}]', 412),
        ('[{"quantity":250},{"quantity":162}]', 412),
        ("120 count\n200 count\n92 count", 412),
        ('{"value": 412}', 412),
    ])
    def test_every_serialisation_sums_correctly(self, session, health_token, body, expected):
        assert self._send(session, health_token, body)["total"] == expected

    def test_timestamps_do_not_inflate_the_total(self, session, health_token):
        """Only the first number per line counts — otherwise a trailing date turns
        412 steps into thousands."""
        body = ("120 count, 21 Jul 2026 at 5:30 PM\n"
                "200 count, 21 Jul 2026 at 6:45 PM\n"
                "92 count, 21 Jul 2026 at 7:10 PM")
        assert self._send(session, health_token, body)["total"] == 412

    def test_unusable_bodies_are_not_stored(self, session, health_token):
        for body in ("", "no numbers here"):
            d = self._send(session, health_token, body)
            assert d["stored"] is False
            assert d["total"] is None

    def test_echoes_what_it_received(self, session, health_token):
        """The echo is what made the original phone-side failure diagnosable."""
        assert self._send(session, health_token, "412")["received_preview"] == "412"

    def test_rejects_bad_token_and_unknown_metric(self, session, health_token):
        r = session.post(f"{API}/health/ingest/raw", params={"metric": "steps"},
                         headers={"X-Health-Token": "bogus"}, data="1")
        assert r.status_code == 401
        r = session.post(f"{API}/health/ingest/raw", params={"metric": "hacker"},
                         headers={"X-Health-Token": health_token}, data="1")
        assert r.status_code == 400

    def test_persists_and_can_be_deleted(self, session, auth_headers, health_token):
        self._send(session, health_token, "4321")
        days = session.get(f"{API}/health/daily", headers=auth_headers).json()["days"]
        row = next((d for d in days if d["date"] == ISOLATED_DAY), None)
        assert row and row["steps"] == 4321

        # DELETE /health/daily/{date} — added because a bad sync previously could
        # not be cleared at all.
        r = session.delete(f"{API}/health/daily/{ISOLATED_DAY}", headers=auth_headers)
        assert r.status_code == 200 and r.json()["deleted"] == 1
        days = session.get(f"{API}/health/daily", headers=auth_headers).json()["days"]
        assert not any(d["date"] == ISOLATED_DAY for d in days)

    def test_sleep_routes_to_the_sleep_module(self, session, auth_headers, health_token):
        self._send(session, health_token, "7.5", metric="sleep_hours")
        logs = session.get(f"{API}/sleep", headers=auth_headers).json()["logs"]
        night = next((l for l in logs if l["date"] == ISOLATED_DAY), None)
        assert night and night["hours"] == 7.5
        session.delete(f"{API}/sleep/{night['id']}", headers=auth_headers)
