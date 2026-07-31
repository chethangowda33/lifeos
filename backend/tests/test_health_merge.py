"""Health ingest must not let a resync destroy a real day.

Steps, distance and active energy only accumulate across a day, so a sync
reporting LESS than what is already stored is never a correction — it is a
broken automation or a second device that wasn't carried. Bounds checking
cannot catch it (8 is a perfectly legal step count); only the day's own history
can. This is a real failure that shipped: a Shortcuts recipe posted the sample
count instead of the sum and the server stored 8 over a genuine 52.

Resting HR and HRV are deliberately NOT protected — those legitimately fall.

The end-to-end tests write to an isolated 2019 date on the admin account and
delete it again, so they never touch real data.
"""
import os

import pytest
import requests

from server import MONOTONIC_DAILY_FIELDS, merge_daily_metrics

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "cg3@lifeos.com"
ADMIN_PASSWORD = "test1234"

ISOLATED_DAY = "2019-03-14"      # far from any real sync
ISOLATED_DAY_RAW = "2019-03-15"  # a day of its own — the guard is stateful, so
                                 # the two end-to-end tests must not share one


# ── the merge rule ────────────────────────────────────────────────────────────

def test_a_lower_step_count_never_overwrites_a_higher_one():
    """The exact bug: 52 real steps already stored, automation reports 8."""
    to_store, kept = merge_daily_metrics({"steps": 52}, {"steps": 8})
    assert to_store == {}
    assert kept == ["steps"]


def test_a_higher_step_count_is_stored():
    to_store, kept = merge_daily_metrics({"steps": 52}, {"steps": 8432})
    assert to_store == {"steps": 8432}
    assert kept == []


def test_an_equal_value_is_stored_harmlessly():
    to_store, kept = merge_daily_metrics({"steps": 52}, {"steps": 52})
    assert to_store == {"steps": 52} and kept == []


def test_the_first_sync_of_a_day_always_stores():
    to_store, kept = merge_daily_metrics({}, {"steps": 8})
    assert to_store == {"steps": 8} and kept == []


@pytest.mark.parametrize("field", MONOTONIC_DAILY_FIELDS)
def test_every_monotonic_field_is_protected(field):
    _, kept = merge_daily_metrics({field: 100}, {field: 1})
    assert kept == [field]


@pytest.mark.parametrize("field", ["resting_hr", "hrv", "spo2", "stress", "avg_hr",
                                   "respiratory_rate"])
def test_metrics_that_legitimately_fall_are_not_protected(field):
    """A resting heart rate dropping is the good news, not a bug. Guarding these
    would freeze a user's best readings in place forever."""
    to_store, kept = merge_daily_metrics({field: 70}, {field: 55})
    assert to_store == {field: 55} and kept == []


def test_one_bad_field_does_not_block_the_others():
    to_store, kept = merge_daily_metrics(
        {"steps": 8432, "resting_hr": 70},
        {"steps": 8, "resting_hr": 58, "hrv": 42},
    )
    assert to_store == {"resting_hr": 58, "hrv": 42}
    assert kept == ["steps"]


def test_distance_is_compared_as_a_float():
    to_store, kept = merge_daily_metrics({"distance_km": 6.4}, {"distance_km": 0.3})
    assert to_store == {} and kept == ["distance_km"]


def test_a_stored_boolean_is_not_treated_as_a_number():
    """`True` compares as 1 in Python. A junk value in the field must not make a
    real step count look like a decrease."""
    to_store, kept = merge_daily_metrics({"steps": True}, {"steps": 5000})
    assert to_store == {"steps": 5000} and kept == []


def test_missing_or_null_existing_values_are_ignored():
    assert merge_daily_metrics({"steps": None}, {"steps": 12})[0] == {"steps": 12}


# ── end to end, against a live backend ────────────────────────────────────────

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
def health_headers(session, auth_headers):
    r = session.get(f"{API}/health/connection", headers=auth_headers)
    assert r.status_code == 200, r.text
    return {"X-Health-Token": r.json()["token"], "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def clean_isolated_day(session, auth_headers):
    """Remove the scratch day before and after, so a failed run can't leave data
    on the shared admin account. Requested explicitly — autouse would drag the
    pure tests above onto a live server for no reason."""
    for day in (ISOLATED_DAY, ISOLATED_DAY_RAW):
        session.delete(f"{API}/health/daily/{day}", headers=auth_headers)
    yield
    for day in (ISOLATED_DAY, ISOLATED_DAY_RAW):
        session.delete(f"{API}/health/daily/{day}", headers=auth_headers)


def stored_day(session, auth_headers, day=ISOLATED_DAY):
    days = session.get(f"{API}/health/daily", headers=auth_headers).json()["days"]
    return next((d for d in days if d["date"] == day), None)


def test_a_resync_cannot_erase_a_real_day(session, health_headers, auth_headers, clean_isolated_day):
    ingest = lambda body: session.post(f"{API}/health/ingest", json=body, headers=health_headers)

    first = ingest({"date": ISOLATED_DAY, "steps": 8432, "resting_hr": 70})
    assert first.status_code == 200, first.text
    assert "steps" in first.json()["stored"]
    assert stored_day(session, auth_headers)["steps"] == 8432

    # The bug: a second sync reports the sample count instead of the sum.
    second = ingest({"date": ISOLATED_DAY, "steps": 8})
    assert second.status_code == 200
    assert second.json()["kept_existing"] == ["steps"]
    assert "steps" not in second.json()["stored"]
    assert stored_day(session, auth_headers)["steps"] == 8432, "the real day was overwritten"

    # Later in the day, a genuinely higher figure still gets through.
    third = ingest({"date": ISOLATED_DAY, "steps": 11000})
    assert third.json()["kept_existing"] == []
    assert stored_day(session, auth_headers)["steps"] == 11000

    # ...while a falling resting HR is stored, because that one is real.
    fourth = ingest({"date": ISOLATED_DAY, "resting_hr": 54})
    assert fourth.json()["kept_existing"] == []
    assert stored_day(session, auth_headers)["resting_hr"] == 54


def test_the_raw_endpoint_is_guarded_too(session, health_headers, auth_headers, clean_isolated_day):
    """The raw path is the one the iPhone recipe actually uses, so the guard
    matters more here than on the JSON endpoint."""
    url = f"{API}/health/ingest/raw?metric=steps&date={ISOLATED_DAY_RAW}"
    post = lambda body: session.post(url, data=body,
                                     headers={"X-Health-Token": health_headers["X-Health-Token"]})

    assert post("9000").json()["stored"] is True
    low = post("8").json()
    assert low["kept_existing"] == ["steps"]
    assert low["stored"] is False
    assert low["total"] == 8, "the parsed figure is still reported back"
    assert stored_day(session, auth_headers, ISOLATED_DAY_RAW)["steps"] == 9000
