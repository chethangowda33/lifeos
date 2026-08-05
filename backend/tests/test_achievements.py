"""Achievements.

Badges are derived from data the user already logs, so the whole contract is:
they follow the numbers up AND back down, and "new" fires exactly once. The
tests earn a real badge through the API and then take it away again — anything
that survives the delete is the ghost-PR bug wearing a different hat.
"""
import os
from datetime import date, timedelta

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "cg3@lifeos.com"
# Local dev seed value. Override when pointing the suite anywhere else —
# the real password must never live in this repo.
ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD", "test1234")

# A week in 2019 — far from any real sleep data, and its own calendar week.
ISOLATED_WEEK = [(date(2019, 3, 4) + timedelta(days=i)).isoformat() for i in range(7)]


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


def fetch(session, auth_headers):
    r = session.get(f"{API}/achievements", headers=auth_headers)
    assert r.status_code == 200, r.text
    return r.json()


def badge(data, key):
    return next(a for a in data["achievements"] if a["key"] == key)


class TestShape:
    def test_every_badge_is_fully_described(self, session, auth_headers):
        d = fetch(session, auth_headers)
        assert d["total"] == len(d["achievements"]) > 0
        keys = [a["key"] for a in d["achievements"]]
        assert len(keys) == len(set(keys)), "duplicate achievement key"
        for a in d["achievements"]:
            assert a["name"] and a["description"] and a["group"] and a["icon"]
            assert a["target"] > 0
            assert 0 <= a["progress"] <= 1
            # A locked badge must never carry an unlock date — it reads as earned.
            if not a["unlocked"]:
                assert a["unlocked_at"] is None
            else:
                assert a["unlocked_at"]

    def test_progress_is_the_ratio_the_bar_will_draw(self, session, auth_headers):
        for a in fetch(session, auth_headers)["achievements"]:
            assert a["progress"] == pytest.approx(min(1.0, a["value"] / a["target"]), abs=0.001)

    def test_next_up_is_the_nearest_locked_badges(self, session, auth_headers):
        d = fetch(session, auth_headers)
        assert len(d["next_up"]) <= 3
        assert all(not a["unlocked"] for a in d["next_up"])
        progress = [a["progress"] for a in d["next_up"]]
        assert progress == sorted(progress, reverse=True)

    def test_counts_agree_with_the_list(self, session, auth_headers):
        d = fetch(session, auth_headers)
        assert d["unlocked_count"] == sum(1 for a in d["achievements"] if a["unlocked"])
        assert d["new_count"] == sum(1 for a in d["achievements"] if a["new"])

    def test_requires_auth(self):
        assert requests.get(f"{API}/achievements").status_code == 401
        assert requests.post(f"{API}/achievements/seen").status_code == 401


class TestEarningAndLosingABadge:
    """Seven nights of sleep unlocks 'Sleep on record'. Logged, checked, removed."""
    log_ids = []

    def test_01_locked_to_begin_with(self, session, auth_headers):
        b = badge(fetch(session, auth_headers), "sleep_7")
        assert b["unlocked"] is False and b["unlocked_at"] is None

    def test_02_logging_the_nights_unlocks_it_as_new(self, session, auth_headers):
        for d in ISOLATED_WEEK:
            r = session.post(f"{API}/sleep", headers=auth_headers,
                             json={"date": d, "hours": 7.5, "quality": 4})
            assert r.status_code == 200, r.text
            TestEarningAndLosingABadge.log_ids.append(r.json()["id"])

        data = fetch(session, auth_headers)
        b = badge(data, "sleep_7")
        assert b["unlocked"] is True and b["value"] >= 7
        assert b["unlocked_at"], "an unlocked badge needs the moment it happened"
        assert b["new"] is True, "a badge earned after the first read must announce itself"
        assert data["new_count"] >= 1
        # 7.5 h x 7 consecutive nights also earns the streak badge.
        assert badge(data, "sleep_streak_7")["unlocked"] is True

    def test_03_new_survives_a_second_read(self, session, auth_headers):
        """Reading the list is not seeing it — the dashboard must not eat the news."""
        assert badge(fetch(session, auth_headers), "sleep_7")["new"] is True

    def test_04_marking_seen_clears_it(self, session, auth_headers):
        r = session.post(f"{API}/achievements/seen", headers=auth_headers)
        assert r.status_code == 200 and r.json()["marked"] >= 1
        data = fetch(session, auth_headers)
        assert badge(data, "sleep_7")["new"] is False
        assert badge(data, "sleep_7")["unlocked"] is True
        assert data["new_count"] == 0

    def test_05_removing_the_data_takes_the_badge_with_it(self, session, auth_headers):
        for lid in self.log_ids:
            assert session.delete(f"{API}/sleep/{lid}", headers=auth_headers).status_code == 200
        b = badge(fetch(session, auth_headers), "sleep_7")
        assert b["unlocked"] is False, "a badge must not outlive the data that earned it"
        assert b["unlocked_at"] is None
        assert b["new"] is False

    def test_06_and_it_can_be_earned_again(self, session, auth_headers):
        r = session.post(f"{API}/sleep", headers=auth_headers,
                         json={"date": ISOLATED_WEEK[0], "hours": 7.5, "quality": 4})
        assert r.status_code == 200
        one = r.json()["id"]
        try:
            b = badge(fetch(session, auth_headers), "sleep_7")
            assert b["unlocked"] is False and b["progress"] > 0  # partial progress shows
        finally:
            assert session.delete(f"{API}/sleep/{one}", headers=auth_headers).status_code == 200
