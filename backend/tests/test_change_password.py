"""Changing your own password.

⚠️ **LOCAL ONLY — do not point this file at prod.** It changes the admin account's
password and changes it back. The restore is in a `finally`, and the last test
asserts the original password still works, but a hard crash between the two would
leave the shared account on the temporary password. Every other suite logs in with
that account, so the blast radius is the whole run.

Background: `seed_admin_user` used to reset ADMIN_EMAIL's password to
`ADMIN_PASSWORD` on every boot whenever they differed, which made this feature
pointless for the main account — the change reverted on the next restart, and
Render restarts often. That reset is now opt-in via `ADMIN_PASSWORD_RESET`.
"""
import os

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "cg3@lifeos.com"
# Local dev seed value. Override when pointing the suite anywhere else —
# the real password must never live in this repo.
ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD", "test1234")
TEMP_PASSWORD = "zz-temp-pw-9137"

# ⚠️ OPT-IN. This suite briefly changes the password that EVERY other suite logs
# in with, so including it in a normal run makes the whole run flaky: any module
# whose auth fixture initialises inside that window gets a 401. Observed exactly
# that — one full run failed 6 tests, the next passed 224.
#
# Run it deliberately:  RUN_PASSWORD_TESTS=1 python -m pytest tests/test_change_password.py
pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_PASSWORD_TESTS") != "1",
    reason="mutates the shared admin password — run explicitly with RUN_PASSWORD_TESTS=1",
)


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def login(session, password):
    return session.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": password})


@pytest.fixture(scope="module")
def auth_headers(session):
    r = login(session, ADMIN_PASSWORD)
    assert r.status_code == 200, "suite expects the admin account on its documented password"
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def change(session, auth_headers, current, new):
    return session.post(f"{API}/auth/change-password", headers=auth_headers,
                        json={"current_password": current, "new_password": new})


# ── guards (no state change, safe to re-run) ─────────────────────────────────

def test_requires_authentication(session):
    r = session.post(f"{API}/auth/change-password",
                     json={"current_password": "x", "new_password": "whatever1"})
    assert r.status_code in (401, 403)


def test_wrong_current_password_is_rejected(session, auth_headers):
    """The whole point of asking for the current one: a borrowed session must not
    be enough to lock the owner out."""
    r = change(session, auth_headers, "definitely-not-it", "whatever1")
    assert r.status_code == 400
    assert login(session, ADMIN_PASSWORD).status_code == 200, "password must be untouched"


def test_a_too_short_new_password_is_rejected(session, auth_headers):
    r = change(session, auth_headers, ADMIN_PASSWORD, "abc")
    assert r.status_code == 422
    assert login(session, ADMIN_PASSWORD).status_code == 200


def test_reusing_the_same_password_is_rejected(session, auth_headers):
    r = change(session, auth_headers, ADMIN_PASSWORD, ADMIN_PASSWORD)
    assert r.status_code == 400


# ── the round trip ───────────────────────────────────────────────────────────

def test_password_actually_changes_and_the_old_one_stops_working(session, auth_headers):
    assert change(session, auth_headers, ADMIN_PASSWORD, TEMP_PASSWORD).status_code == 200
    try:
        assert login(session, TEMP_PASSWORD).status_code == 200, "new password should work"
        assert login(session, ADMIN_PASSWORD).status_code == 401, "old password should not"
    finally:
        # Restore with a token minted from whichever password currently works.
        tok = login(session, TEMP_PASSWORD)
        if tok.status_code == 200:
            hdr = {"Authorization": f"Bearer {tok.json()['access_token']}"}
            change(session, hdr, TEMP_PASSWORD, ADMIN_PASSWORD)
    assert login(session, ADMIN_PASSWORD).status_code == 200, "RESTORE FAILED — fix before rerunning"
