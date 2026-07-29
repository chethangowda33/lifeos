"""Input validation and error-code consistency.

Two classes of problem this locks in:

1. Values that were accepted unbounded and then silently skewed everything
   derived from them — a 9999-hour night wrecks the sleep average and the Life
   Score, an unvalidated date string is written happily and then never matches
   a query again, so the log simply disappears.

2. A malformed path id returned 500 on habits and sleep while every other
   module returned 404 for the same input. A client mistake is not a server
   fault, and the inconsistency made the API unpredictable.
"""
import os

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "cg3@lifeos.com"
ADMIN_PASSWORD = "test1234"

BAD_ID = "not-an-object-id"


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


class TestMalformedIdsReturn404:
    """Never 500. A bad id is the caller's mistake."""

    def test_habits(self, session, auth_headers):
        assert session.put(f"{API}/habits/{BAD_ID}", headers=auth_headers,
                           json={"name": "x", "type": "check"}).status_code == 404
        assert session.delete(f"{API}/habits/{BAD_ID}", headers=auth_headers).status_code == 404
        assert session.post(f"{API}/habits/{BAD_ID}/log", headers=auth_headers,
                            json={}).status_code == 404

    def test_sleep(self, session, auth_headers):
        assert session.delete(f"{API}/sleep/{BAD_ID}", headers=auth_headers).status_code == 404

    def test_already_guarded_modules_still_404(self, session, auth_headers):
        for path in (f"/workouts/{BAD_ID}", f"/routines/{BAD_ID}", f"/plans/{BAD_ID}"):
            assert session.delete(f"{API}{path}", headers=auth_headers).status_code == 404


class TestSleepValidation:
    def test_rejects_impossible_hours(self, session, auth_headers):
        for hours in (-1, 25, 9999):
            r = session.post(f"{API}/sleep", headers=auth_headers, json={"hours": hours})
            assert r.status_code == 422, f"accepted hours={hours}"

    def test_accepts_the_real_range(self, session, auth_headers):
        """hoursBetween() in the UI yields 0-24 inclusive — none of it may be rejected."""
        for hours in (0, 7.5, 24):
            r = session.post(f"{API}/sleep", headers=auth_headers,
                             json={"date": "2019-02-02", "hours": hours})
            assert r.status_code == 200, f"rejected legitimate hours={hours}"
        logs = session.get(f"{API}/sleep", headers=auth_headers).json()["logs"]
        night = next((l for l in logs if l["date"] == "2019-02-02"), None)
        if night:
            session.delete(f"{API}/sleep/{night['id']}", headers=auth_headers)

    def test_rejects_out_of_range_quality(self, session, auth_headers):
        for q in (0, 6, 99):
            r = session.post(f"{API}/sleep", headers=auth_headers, json={"hours": 7, "quality": q})
            assert r.status_code == 422, f"accepted quality={q}"

    def test_rejects_malformed_date(self, session, auth_headers):
        r = session.post(f"{API}/sleep", headers=auth_headers,
                         json={"hours": 7, "date": "yesterday"})
        assert r.status_code == 422


class TestHabitValidation:
    def test_rejects_blank_name(self, session, auth_headers):
        for name in ("", "   "):
            r = session.post(f"{API}/habits", headers=auth_headers,
                             json={"name": name, "type": "check"})
            assert r.status_code == 422, f"accepted name={name!r}"

    def test_rejects_unknown_type(self, session, auth_headers):
        """An unrecognised type silently behaved as a check habit, so a typo
        produced a habit whose target was quietly ignored."""
        r = session.post(f"{API}/habits", headers=auth_headers,
                         json={"name": "TEST_bad", "type": "banana"})
        assert r.status_code == 422

    def test_rejects_negative_target_and_value(self, session, auth_headers):
        r = session.post(f"{API}/habits", headers=auth_headers,
                         json={"name": "TEST_neg", "type": "count", "target": -5})
        assert r.status_code == 422

        habit = session.post(f"{API}/habits", headers=auth_headers,
                             json={"name": "TEST_val", "type": "count", "target": 8}).json()
        try:
            assert session.post(f"{API}/habits/{habit['id']}/log", headers=auth_headers,
                                json={"value": -3}).status_code == 422
            assert session.post(f"{API}/habits/{habit['id']}/log", headers=auth_headers,
                                json={"date": "nope"}).status_code == 422
        finally:
            session.delete(f"{API}/habits/{habit['id']}", headers=auth_headers)


class TestBodyMetricCeilings:
    """The ceiling is per metric — body fat is a percentage, BMR is kcal/day.
    A single global bound wrongly rejected a legitimate BMR."""

    def test_rejects_impossible_percentage(self, session, auth_headers):
        r = session.post(f"{API}/body-metrics", headers=auth_headers,
                         json={"metric": "body_fat", "value": 250})
        assert r.status_code == 400

    def test_rejects_negative(self, session, auth_headers):
        r = session.post(f"{API}/body-metrics", headers=auth_headers,
                         json={"metric": "body_fat", "value": -3})
        assert r.status_code == 422

    def test_accepts_a_plausible_reading(self, session, auth_headers):
        r = session.post(f"{API}/body-metrics", headers=auth_headers,
                         json={"metric": "body_fat", "value": 18.5})
        assert r.status_code == 200
        session.delete(f"{API}/body-metrics/body_fat", headers=auth_headers)

    def test_auto_metrics_still_rejected_before_any_ceiling(self, session, auth_headers):
        """BMR's real range (~1500-2200) must not be mistaken for out-of-range."""
        r = session.post(f"{API}/body-metrics", headers=auth_headers,
                         json={"metric": "bmr", "value": 1700})
        assert r.status_code == 400
        assert "Auto-computed" in r.json()["detail"]


class TestHealthIngestValidation:
    def test_rejects_out_of_range_metrics(self, session, health_token):
        for payload in ({"steps": -1}, {"spo2": 500}, {"sleep_hours": 99}, {"resting_hr": 5000}):
            r = session.post(f"{API}/health/ingest", headers={"X-Health-Token": health_token},
                             json=payload)
            assert r.status_code == 422, f"accepted {payload}"

    def test_rejects_malformed_date(self, session, health_token):
        r = session.post(f"{API}/health/ingest", headers={"X-Health-Token": health_token},
                         json={"steps": 100, "date": "today"})
        assert r.status_code == 422

    def test_raw_path_enforces_the_same_bounds(self, session, health_token):
        """The raw endpoint writes directly, so it must not become a way around
        the bounds the JSON endpoint enforces."""
        r = session.post(f"{API}/health/ingest/raw", params={"metric": "steps", "date": "2019-02-03"},
                         headers={"X-Health-Token": health_token}, data="99999999")
        body = r.json()
        assert body["stored"] is False
        assert body["rejected"] is not None

    def test_raw_path_rejects_malformed_date(self, session, health_token):
        r = session.post(f"{API}/health/ingest/raw", params={"metric": "steps", "date": "nope"},
                         headers={"X-Health-Token": health_token}, data="100")
        assert r.status_code == 400

    def test_raw_path_still_accepts_a_real_value(self, session, auth_headers, health_token):
        r = session.post(f"{API}/health/ingest/raw", params={"metric": "steps", "date": "2019-02-03"},
                         headers={"X-Health-Token": health_token}, data="9120")
        assert r.json()["stored"] is True
        session.delete(f"{API}/health/daily/2019-02-03", headers=auth_headers)
