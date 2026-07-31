"""Training readiness — "should I train today?".

The verdict is a scoring function over data other modules already compute, so
what matters is that the thresholds are pinned and that every reason carries the
points it cost. A card that shows its own working is only honest if the working
is stable, so most of this tests `compute_readiness` directly — it is pure, and
a threshold change should have to break a test on purpose.

The endpoint tests are read-only: readiness creates nothing, so there is no test
data to clean up off the shared admin account.
"""
import os

import pytest
import requests

from server import compute_readiness

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "cg3@lifeos.com"
ADMIN_PASSWORD = "test1234"


def muscle(group, hard_sets, zone, recovery, days_since=3, mrv=22):
    return {"muscle_group": group, "hard_sets": hard_sets, "zone": zone,
            "recovery": recovery, "days_since": days_since,
            "mev": 8, "mav": 16, "mrv": mrv, "last_trained": None}


def score_of(**kw):
    args = {"muscles": [], "untrained": [], "sleep": None, "health": None,
            "flags": {}, "trained_today": False, "streak_days": 0}
    args.update(kw)
    return compute_readiness(**args)


# ── the scoring function ──────────────────────────────────────────────────────

def test_nothing_against_you_is_a_full_score():
    r = score_of(untrained=["chest", "back"])
    assert r["score"] == 100
    assert r["verdict"] == "train"
    assert r["reasons"] == []


def test_score_is_clamped_to_0_100():
    # Every penalty at once must not produce a negative score.
    r = score_of(
        muscles=[muscle("chest", 30, "excessive", "worked", 0),
                 muscle("back", 28, "excessive", "worked", 0)],
        sleep={"hours": 4.0, "quality": 1},
        health={"resting_hr": 70, "resting_hr_baseline": 55,
                "hrv": 30, "hrv_baseline": 60},
        flags={"deload": 2, "plateau": 1},
        trained_today=True, streak_days=5,
    )
    assert r["score"] == 0
    assert r["verdict"] == "rest"
    # A bonus cannot push past 100 either.
    assert score_of(sleep={"hours": 9.0})["score"] == 100


@pytest.mark.parametrize("hours,effect", [(5.4, -25), (6.6, -12), (7.5, None), (8.2, 5)])
def test_sleep_bands(hours, effect):
    r = score_of(sleep={"hours": hours})
    sleep_reasons = [x for x in r["reasons"] if x["kind"] == "sleep"]
    if effect is None:
        assert sleep_reasons == []
    else:
        assert sleep_reasons[0]["effect"] == effect
        assert str(hours) in sleep_reasons[0]["text"]


def test_poor_sleep_quality_costs_on_top_of_duration():
    r = score_of(sleep={"hours": 5.0, "quality": 2})
    assert r["score"] == 100 - 25 - 8


def test_already_trained_today_is_the_biggest_single_penalty():
    r = score_of(trained_today=True)
    assert r["score"] == 65
    assert r["reasons"][0]["kind"] == "trained"


def test_streak_only_counts_from_three_days():
    assert score_of(streak_days=2)["score"] == 100
    assert score_of(streak_days=3)["score"] == 90


def test_over_mrv_names_the_muscle_and_the_set_count():
    r = score_of(muscles=[muscle("chest", 24, "excessive", "worked", 0, mrv=22)])
    volume = [x for x in r["reasons"] if x["kind"] == "volume"][0]
    assert "Chest" in volume["text"] and "24 of 22" in volume["text"]
    assert volume["effect"] == -10


def test_at_most_two_over_mrv_muscles_are_charged():
    r = score_of(muscles=[muscle(g, 30, "excessive", "worked", 0) for g in
                          ("chest", "back", "quads", "biceps")])
    assert len([x for x in r["reasons"] if x["kind"] == "volume"]) == 2


def test_resting_hr_needs_a_real_jump_to_count():
    base = {"resting_hr_baseline": 55, "hrv": None, "hrv_baseline": None}
    assert score_of(health={"resting_hr": 60, **base})["score"] == 100
    assert score_of(health={"resting_hr": 62, **base})["score"] == 85


def test_hrv_below_80_percent_of_baseline_counts():
    base = {"resting_hr": None, "resting_hr_baseline": None}
    assert score_of(health={"hrv": 50, "hrv_baseline": 60, **base})["score"] == 100
    assert score_of(health={"hrv": 45, "hrv_baseline": 60, **base})["score"] == 90


def test_a_baseline_of_none_is_never_compared():
    # A single synced day has no baseline — comparing against None must not throw
    # or invent a penalty.
    r = score_of(health={"resting_hr": 80, "resting_hr_baseline": None,
                         "hrv": 20, "hrv_baseline": None})
    assert r["score"] == 100


def test_untrained_muscles_lead_the_suggestion():
    # A muscle with no hard sets in 7 days never appears in `muscles` at all —
    # it is the freshest thing available and must be offered first.
    r = score_of(untrained=["quads", "hamstrings"],
                 muscles=[muscle("chest", 10, "optimal", "fresh", 4)])
    assert r["train"][:2] == ["quads", "hamstrings"]


def test_recovered_muscles_are_ordered_by_time_since_trained():
    r = score_of(muscles=[muscle("chest", 10, "optimal", "fresh", 2),
                          muscle("back", 9, "optimal", "fresh", 6)])
    assert r["train"] == ["back", "chest"]


def test_cooked_or_just_worked_muscles_go_on_the_avoid_list():
    r = score_of(muscles=[muscle("chest", 24, "excessive", "fresh", 3),
                          muscle("back", 20, "high", "fresh", 3),
                          muscle("quads", 4, "under", "worked", 0),
                          muscle("calves", 10, "optimal", "fresh", 3)])
    assert set(r["avoid"]) == {"chest", "back", "quads"}
    assert "calves" not in r["avoid"]


def test_a_suggested_muscle_is_never_also_on_the_avoid_list():
    r = score_of(untrained=["quads"],
                 muscles=[muscle("chest", 24, "excessive", "worked", 0),
                          muscle("back", 9, "optimal", "fresh", 5)])
    assert not set(r["train"]) & set(r["avoid"])


def test_verdict_band_edges():
    """70 and 40 are the boundaries — assert the score too, so a change to a
    penalty can't quietly slide a case across a band while the test still passes."""
    top = score_of(trained_today=True, sleep={"hours": 8.0})      # 100 - 35 + 5
    assert (top["score"], top["verdict"]) == (70, "train")

    just_under = score_of(trained_today=True)                     # 100 - 35
    assert (just_under["score"], just_under["verdict"]) == (65, "light")

    floor = score_of(trained_today=True, sleep={"hours": 5.0})    # 100 - 35 - 25
    assert (floor["score"], floor["verdict"]) == (40, "light")

    below = score_of(trained_today=True, sleep={"hours": 5.0}, flags={"deload": 1})
    assert (below["score"], below["verdict"]) == (30, "rest")


def test_rest_verdict_says_rest_even_when_muscles_are_available():
    r = score_of(untrained=["quads"], trained_today=True, sleep={"hours": 4.5},
                 flags={"deload": 1})
    assert r["verdict"] == "rest"
    assert r["headline"] == "Rest today"


def test_headline_names_the_muscles_when_training():
    r = score_of(untrained=["quads", "hamstrings"],
                 muscles=[muscle("chest", 24, "excessive", "worked", 0)])
    assert r["headline"] == "Train — quads or hamstrings"
    light = score_of(untrained=["quads"], trained_today=True,
                     muscles=[muscle("chest", 24, "excessive", "worked", 0)])
    assert light["headline"] == "Train light — quads"


def test_a_week_off_does_not_fake_a_preference():
    """Nothing trained in the window = 13 equally fresh groups, ordered only by
    however the landmarks table is written. Naming two of them would read as a
    recommendation with nothing behind it."""
    r = score_of(untrained=["chest", "back", "shoulders"])
    assert r["headline"] == "Train — everything is recovered"
    assert r["train"] == ["chest", "back", "shoulders"]  # still offered as chips
    # As soon as ANY muscle has been trained the ordering means something again.
    r2 = score_of(untrained=["quads"], muscles=[muscle("chest", 24, "excessive", "worked", 0)])
    assert r2["headline"] == "Train — quads"


def test_headline_survives_having_nothing_to_suggest():
    # Everything cooked, but the score is still fine — must not render "Train — ".
    r = score_of(muscles=[muscle("chest", 20, "high", "worked", 0)])
    assert r["train"] == []
    assert r["headline"] in ("Train", "Train light")


def test_reasons_are_ordered_worst_first():
    r = score_of(sleep={"hours": 5.0}, flags={"plateau": 1}, streak_days=3)
    effects = [x["effect"] for x in r["reasons"]]
    assert effects == sorted(effects)


def test_every_reason_carries_its_points_and_a_sentence():
    r = score_of(sleep={"hours": 5.0}, trained_today=True, flags={"deload": 1})
    assert r["reasons"]
    for reason in r["reasons"]:
        assert set(reason) == {"kind", "effect", "text"}
        assert isinstance(reason["effect"], int) and reason["effect"] != 0
        assert reason["text"].strip()
    # The arithmetic on the card has to add up to the score it sits under.
    assert r["score"] == 100 + sum(x["effect"] for x in r["reasons"])


# ── the endpoint ──────────────────────────────────────────────────────────────

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


def test_readiness_requires_auth(session):
    assert session.get(f"{API}/readiness").status_code in (401, 403)


def test_readiness_returns_a_complete_verdict(session, auth_headers):
    r = session.get(f"{API}/readiness", headers=auth_headers)
    assert r.status_code == 200, r.text
    d = r.json()
    assert 0 <= d["score"] <= 100
    assert d["verdict"] in ("train", "light", "rest")
    assert d["headline"]
    assert isinstance(d["train"], list) and isinstance(d["avoid"], list)
    assert isinstance(d["has_data"], bool)
    # The inputs are shipped so the card can show what the verdict was built on.
    for key in ("sleep", "health", "flags", "trained_today", "streak_days", "muscles"):
        assert key in d["inputs"]


def test_readiness_takes_the_callers_local_day(session, auth_headers):
    r = session.get(f"{API}/readiness", params={"date": "2019-03-14"}, headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["date"] == "2019-03-14"


@pytest.mark.parametrize("bad", ["14-03-2019", "2019-3-14", "yesterday", "2019-13-40"])
def test_readiness_rejects_a_malformed_date(session, auth_headers, bad):
    r = session.get(f"{API}/readiness", params={"date": bad}, headers=auth_headers)
    assert r.status_code == 400


def test_muscle_volume_and_readiness_agree(session, auth_headers):
    """Both read the one `_muscle_volume` helper — if that ever forks, the
    dashboard bars and the readiness verdict start contradicting each other."""
    mv = session.get(f"{API}/workouts/muscle-volume", headers=auth_headers).json()
    rd = session.get(f"{API}/readiness", headers=auth_headers).json()
    assert rd["inputs"]["muscles"] == mv
