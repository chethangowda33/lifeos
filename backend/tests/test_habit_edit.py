"""Editing a habit must not cost you its history.

Until 2026-07-31 the UI had no edit path at all — `PUT /habits/{id}` existed but
nothing called it — so fixing a typo or nudging a target meant delete-and-recreate,
which threw away the streak and every logged day. Now that the button exists, the
thing worth locking in is that the definition changes and the log does not.

`target` is written unconditionally on purpose: this is a full-object PUT, and
switching a count habit to a check habit has to clear the target. That is the
opposite of the ingest rule (never destroy what you weren't given) and the
distinction is deliberate — a PUT carries the whole object, an ingest doesn't.
"""
import os

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


@pytest.fixture
def habit(session, auth_headers):
    """A throwaway count habit, removed however the test ends."""
    r = session.post(f"{API}/habits", headers=auth_headers,
                     json={"name": "ZZ test protein", "emoji": "🥚", "type": "count",
                           "target": 150, "unit": "g"})
    assert r.status_code == 200, r.text
    h = r.json()
    yield h
    session.delete(f"{API}/habits/{h['id']}", headers=auth_headers)


def fetch(session, auth_headers, habit_id):
    habits = session.get(f"{API}/habits", headers=auth_headers).json()
    return next((x for x in habits if x["id"] == habit_id), None)


def test_renaming_keeps_the_streak_and_the_log(session, auth_headers, habit):
    """The reason the edit button had to exist: the old workaround was
    delete-and-recreate, which reset the streak to zero."""
    session.post(f"{API}/habits/{habit['id']}/log", headers=auth_headers, json={"value": 150})
    before = fetch(session, auth_headers, habit["id"])
    assert before["today_value"] == 150 and before["streak"] == 1

    r = session.put(f"{API}/habits/{habit['id']}", headers=auth_headers,
                    json={"name": "ZZ test protein renamed", "emoji": "🍳",
                          "type": "count", "target": 150, "unit": "g"})
    assert r.status_code == 200, r.text

    after = fetch(session, auth_headers, habit["id"])
    assert after["name"] == "ZZ test protein renamed"
    assert after["emoji"] == "🍳"
    assert after["today_value"] == 150
    assert after["streak"] == 1, "renaming must not cost the streak"


def test_raising_a_target_re_scores_history_against_the_new_bar(session, auth_headers, habit):
    """Worth knowing before you nudge a target: completion is judged against the
    CURRENT target, not the one in force on the day. Log 150 against a 150 goal
    and you're on a streak; raise the goal to 165 and that day stops counting.

    That is the right call — a streak should mean "I hit my goal", not "I hit
    some goal I used to have" — but it is retroactive and it surprises people."""
    session.post(f"{API}/habits/{habit['id']}/log", headers=auth_headers, json={"value": 150})
    assert fetch(session, auth_headers, habit["id"])["streak"] == 1

    session.put(f"{API}/habits/{habit['id']}", headers=auth_headers,
                json={"name": "ZZ test protein", "emoji": "🥚", "type": "count",
                      "target": 165, "unit": "g"})

    after = fetch(session, auth_headers, habit["id"])
    assert after["target"] == 165
    assert after["today_value"] == 150, "the logged value itself is untouched"
    assert after["streak"] == 0, "150 no longer clears a 165 bar"

    # ...and lowering it back restores the day, because nothing was destroyed.
    session.put(f"{API}/habits/{habit['id']}", headers=auth_headers,
                json={"name": "ZZ test protein", "emoji": "🥚", "type": "count",
                      "target": 150, "unit": "g"})
    assert fetch(session, auth_headers, habit["id"])["streak"] == 1


def test_switching_a_count_habit_to_a_check_clears_the_target(session, auth_headers, habit):
    r = session.put(f"{API}/habits/{habit['id']}", headers=auth_headers,
                    json={"name": "ZZ test protein", "emoji": "🥚", "type": "check",
                          "target": None, "unit": ""})
    assert r.status_code == 200
    after = fetch(session, auth_headers, habit["id"])
    assert after["type"] == "check"
    assert after["target"] is None, "a leftover target would make a check habit unsatisfiable"


def test_logging_works_with_no_request_body(session, auth_headers, auth_headers_check_habit):
    """Every field on HabitLogIn has a default, so a bodyless POST is a perfectly
    valid "tick today". It used to 422 while `{}` returned 200 — a trap for the
    offline queue, which replays whatever body it stored."""
    hid = auth_headers_check_habit
    r = session.post(f"{API}/habits/{hid}/log", headers=auth_headers)
    assert r.status_code == 200, r.text
    habits = session.get(f"{API}/habits", headers=auth_headers).json()
    assert next(x for x in habits if x["id"] == hid)["today_done"] is True


@pytest.fixture
def auth_headers_check_habit(session, auth_headers):
    r = session.post(f"{API}/habits", headers=auth_headers,
                     json={"name": "ZZ test check", "emoji": "✅", "type": "check"})
    h = r.json()
    yield h["id"]
    session.delete(f"{API}/habits/{h['id']}", headers=auth_headers)


def test_editing_someone_elses_habit_is_a_404(session, auth_headers, habit):
    """Scoped by user_id, so a valid id belonging to another account must not
    resolve — the same guard the delete path has."""
    r = session.put(f"{API}/habits/507f1f77bcf86cd799439011", headers=auth_headers,
                    json={"name": "nope", "emoji": "x", "type": "check"})
    assert r.status_code == 404
