"""LifeOS backend integration tests.

Covers: auth, exercises, programs, routines CRUD, body metrics CRUD + auto BMI/BMR.
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "cg3@lifeos.com"
# Local dev seed value. Override when pointing the suite anywhere else —
# the real password must never live in this repo.
ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD", "test1234")


# ── Fixtures ────────────────────────────────────────────────────────────────
@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def auth(session):
    r = session.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    data = r.json()
    return {"token": data["access_token"], "user": data["user"], "cookies": r.cookies}


@pytest.fixture(scope="session")
def auth_headers(auth):
    return {"Authorization": f"Bearer {auth['token']}"}


# ── Auth tests ──────────────────────────────────────────────────────────────
class TestAuth:
    def test_login_success_returns_user_and_token(self, session):
        r = session.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        assert r.status_code == 200
        data = r.json()
        assert "access_token" in data and isinstance(data["access_token"], str)
        assert data["user"]["email"] == ADMIN_EMAIL
        assert data["user"]["role"] == "admin"
        # httpOnly cookies should be set
        assert "access_token" in r.cookies, f"cookies: {r.cookies}"
        assert "refresh_token" in r.cookies

    def test_login_invalid_password(self, session):
        r = session.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": "wrong"})
        assert r.status_code == 401

    def test_me_with_bearer(self, session, auth_headers):
        r = session.get(f"{API}/auth/me", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["email"] == ADMIN_EMAIL

    def test_me_without_auth(self, session):
        r = requests.get(f"{API}/auth/me")
        assert r.status_code == 401


# ── Exercises ───────────────────────────────────────────────────────────────
class TestExercises:
    def test_list_returns_full_library(self, session):
        r = session.get(f"{API}/exercises")
        assert r.status_code == 200
        data = r.json()
        assert len(data) >= 131, f"Expected the expanded 131-exercise library, got {len(data)}"
        sample = data[0]
        for k in ["name", "muscle_group", "equipment", "image_url", "instructions", "id"]:
            assert k in sample, f"Missing key {k}"

    def test_filter_by_muscle_group_chest(self, session):
        r = session.get(f"{API}/exercises", params={"muscle_group": "chest"})
        assert r.status_code == 200
        data = r.json()
        assert len(data) > 0
        assert all(e["muscle_group"] == "chest" for e in data)

    def test_search_press(self, session):
        r = session.get(f"{API}/exercises", params={"search": "press"})
        assert r.status_code == 200
        data = r.json()
        assert len(data) > 0
        assert all("press" in e["name"].lower() for e in data)

    def test_meta_endpoint(self, session):
        r = session.get(f"{API}/exercises/meta")
        assert r.status_code == 200
        d = r.json()
        assert "muscle_groups" in d and "equipment" in d
        assert isinstance(d["muscle_groups"], list) and len(d["muscle_groups"]) > 0
        assert isinstance(d["equipment"], list) and len(d["equipment"]) > 0


# ── Programs ────────────────────────────────────────────────────────────────
class TestPrograms:
    def test_list_returns_14(self, session):
        r = session.get(f"{API}/programs")
        assert r.status_code == 200
        data = r.json()
        assert len(data) == 14, f"Expected 14, got {len(data)}"
        p = data[0]
        assert "routines" in p
        assert isinstance(p["routines"], list)
        if p["routines"]:
            assert "exercises" in p["routines"][0]

    def test_filter_beginner(self, session):
        r = session.get(f"{API}/programs", params={"level": "beginner"})
        assert r.status_code == 200
        data = r.json()
        assert len(data) > 0
        assert all(p["level"] == "beginner" for p in data)

    def test_get_program_enriched(self, session):
        # List then fetch detail
        progs = session.get(f"{API}/programs").json()
        pid = progs[0]["id"]
        r = session.get(f"{API}/programs/{pid}")
        assert r.status_code == 200
        data = r.json()
        assert data["id"] == pid
        assert isinstance(data.get("routines"), list) and len(data["routines"]) > 0
        # find first exercise across routines
        first_ex = None
        for rt in data["routines"]:
            if rt.get("exercises"):
                first_ex = rt["exercises"][0]
                break
        assert first_ex is not None, "Program has no exercises"
        # Enriched fields
        for key in ["name", "image_url", "muscle_group", "equipment", "instructions"]:
            assert key in first_ex, f"Missing enriched field: {key}"
        assert first_ex["image_url"], "image_url empty"
        assert first_ex["name"], "name empty"

    def test_get_program_404(self, session):
        r = session.get(f"{API}/programs/000000000000000000000000")
        assert r.status_code == 404


# ── Exercise detail ─────────────────────────────────────────────────────────
class TestExerciseDetail:
    def test_get_exercise_by_id(self, session):
        first = session.get(f"{API}/exercises").json()[0]
        r = session.get(f"{API}/exercises/{first['id']}")
        assert r.status_code == 200
        d = r.json()
        assert d["id"] == first["id"]
        for k in ["name", "muscle_group", "equipment", "image_url", "instructions"]:
            assert k in d

    def test_get_exercise_404(self, session):
        r = session.get(f"{API}/exercises/000000000000000000000000")
        assert r.status_code == 404


# ── Custom routines CRUD ────────────────────────────────────────────────────
class TestRoutines:
    routine_id = None

    def test_create_routine(self, session, auth_headers):
        # need an exercise id
        ex = session.get(f"{API}/exercises").json()[0]
        r = session.post(
            f"{API}/routines",
            headers=auth_headers,
            json={"name": "TEST_Push Day", "exercises": [{"exercise_id": ex["id"], "sets": 3, "reps": 10}]},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["name"] == "TEST_Push Day"
        assert "_id" not in data
        assert "id" in data
        TestRoutines.routine_id = data["id"]

    def test_list_includes_created(self, session, auth_headers):
        r = session.get(f"{API}/routines", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        names = [d["name"] for d in data]
        assert "TEST_Push Day" in names
        # Verify exercise enrichment
        created = next(d for d in data if d["name"] == "TEST_Push Day")
        assert len(created["exercises"]) > 0
        ex = created["exercises"][0]
        for k in ["name", "image_url", "muscle_group", "equipment"]:
            assert k in ex, f"Missing enriched field: {k}"

    def test_update_routine(self, session, auth_headers):
        rid = TestRoutines.routine_id
        r = session.put(
            f"{API}/routines/{rid}",
            headers=auth_headers,
            json={"name": "TEST_Push Day 2", "exercises": []},
        )
        assert r.status_code == 200
        # verify
        r = session.get(f"{API}/routines", headers=auth_headers)
        assert any(d["id"] == rid and d["name"] == "TEST_Push Day 2" for d in r.json())

    def test_routines_require_auth(self, session):
        r = requests.get(f"{API}/routines")
        assert r.status_code == 401

    def test_delete_routine(self, session, auth_headers):
        rid = TestRoutines.routine_id
        r = session.delete(f"{API}/routines/{rid}", headers=auth_headers)
        assert r.status_code == 200
        r = session.get(f"{API}/routines", headers=auth_headers)
        assert all(d["id"] != rid for d in r.json())


# ── Body Metrics ────────────────────────────────────────────────────────────
class TestBodyMetrics:
    def test_definitions_has_7_metrics(self, session):
        r = session.get(f"{API}/body-metrics/definitions")
        assert r.status_code == 200
        defs = r.json()
        for k in ["body_fat", "muscle_mass", "bone_mass", "hydration", "metabolic_age", "bmi", "bmr"]:
            assert k in defs
            assert "ideal_min" in defs[k] and "ideal_max" in defs[k] and "unit" in defs[k] and "auto" in defs[k]
        assert defs["bmi"]["auto"] is True
        assert defs["bmr"]["auto"] is True

    def test_latest_auto_bmi_bmr(self, session, auth_headers):
        # ensure profile present
        session.put(f"{API}/auth/profile", headers=auth_headers,
                    json={"age": 28, "height_cm": 178, "weight_kg": 75, "sex": "male"})
        r = session.get(f"{API}/body-metrics/latest", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        assert "bmi" in data and "bmr" in data
        bmi = data["bmi"]["value"]
        bmr = data["bmr"]["value"]
        assert 23.0 <= bmi <= 24.5, f"BMI out of range: {bmi}"
        assert 1700 <= bmr <= 1760, f"BMR out of range: {bmr}"

    def test_log_body_fat_and_history(self, session, auth_headers):
        r = session.post(f"{API}/body-metrics", headers=auth_headers,
                         json={"metric": "body_fat", "value": 17.5})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["metric"] == "body_fat"
        assert data["value"] == 17.5
        assert "_id" not in data

        # history
        r = session.get(f"{API}/body-metrics/history/body_fat", headers=auth_headers)
        assert r.status_code == 200
        hist = r.json()
        assert any(h["value"] == 17.5 for h in hist)

    def test_auto_metric_log_rejected(self, session, auth_headers):
        r = session.post(f"{API}/body-metrics", headers=auth_headers,
                         json={"metric": "bmi", "value": 23.5})
        assert r.status_code == 400
        r = session.post(f"{API}/body-metrics", headers=auth_headers,
                         json={"metric": "bmr", "value": 1700})
        assert r.status_code == 400

    def test_profile_update_changes_bmi(self, session, auth_headers):
        # change weight, expect BMI change
        session.put(f"{API}/auth/profile", headers=auth_headers,
                    json={"age": 28, "height_cm": 178, "weight_kg": 85, "sex": "male"})
        r = session.get(f"{API}/body-metrics/latest", headers=auth_headers)
        bmi_85 = r.json()["bmi"]["value"]
        assert bmi_85 > 26
        # restore
        session.put(f"{API}/auth/profile", headers=auth_headers,
                    json={"age": 28, "height_cm": 178, "weight_kg": 75, "sex": "male"})

    def test_all_seven_metrics_with_source(self, session, auth_headers):
        """Verify body-metrics/latest returns ALL 7 metrics with computed values + source field."""
        # Restore profile to seeded values first
        session.put(f"{API}/auth/profile", headers=auth_headers,
                    json={"age": 28, "height_cm": 178, "weight_kg": 75, "sex": "male"})
        r = session.get(f"{API}/body-metrics/latest", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        expected_keys = ["body_fat", "muscle_mass", "bone_mass", "hydration", "metabolic_age", "bmi", "bmr"]
        for k in expected_keys:
            assert k in data, f"Missing metric {k}"
            entry = data[k]
            assert "value" in entry and "source" in entry, f"{k} missing value/source"
            assert entry["source"] in ("manual", "estimated", "missing")
            assert entry["value"] is not None, f"{k} value is None (source={entry['source']})"
        # Expected approximate values for profile {28, 178, 75, male}
        assert 23.5 <= data["bmi"]["value"] <= 23.9, f"BMI {data['bmi']['value']}"
        assert 1720 <= data["bmr"]["value"] <= 1740, f"BMR {data['bmr']['value']}"
        # body_fat ≈ 18 (Deurenberg)
        assert 17 <= data["body_fat"]["value"] <= 19
        # muscle_mass ≈ 41 (half of lean)
        assert 39 <= data["muscle_mass"]["value"] <= 43
        # bone_mass ≈ 2.63 (3.5% of 75)
        assert 2.5 <= data["bone_mass"]["value"] <= 2.8
        # hydration ≈ 59.5
        assert 58 <= data["hydration"]["value"] <= 61
        # metabolic_age ≈ 30
        assert 28 <= data["metabolic_age"]["value"] <= 33

    def test_manual_log_overrides_estimate_source(self, session, auth_headers):
        """After logging body_fat manually, source should become 'manual'."""
        session.put(f"{API}/auth/profile", headers=auth_headers,
                    json={"age": 28, "height_cm": 178, "weight_kg": 75, "sex": "male"})
        session.post(f"{API}/body-metrics", headers=auth_headers,
                     json={"metric": "body_fat", "value": 16.4})
        r = session.get(f"{API}/body-metrics/latest", headers=auth_headers)
        bf = r.json()["body_fat"]
        assert bf["source"] == "manual"
        assert bf["value"] == 16.4
        # bmi/bmr are auto => source should be "estimated"
        assert r.json()["bmi"]["source"] == "estimated"

    def test_partial_profile_update_preserves_fields(self, session, auth_headers):
        """PUT /auth/profile with only weight_kg should NOT wipe age/height/sex."""
        # Set baseline
        session.put(f"{API}/auth/profile", headers=auth_headers,
                    json={"age": 28, "height_cm": 178, "weight_kg": 75, "sex": "male"})
        # Now partial update — only weight
        r = session.put(f"{API}/auth/profile", headers=auth_headers,
                        json={"weight_kg": 80})
        assert r.status_code == 200
        profile = r.json()["profile"]
        assert profile.get("weight_kg") == 80
        assert profile.get("age") == 28, "age was wiped"
        assert profile.get("height_cm") == 178, "height was wiped"
        assert profile.get("sex") == "male", "sex was wiped"
        # BMI should reflect new weight ≈ 25.2
        bmi = session.get(f"{API}/body-metrics/latest", headers=auth_headers).json()["bmi"]["value"]
        assert 25.0 <= bmi <= 25.4, f"BMI after weight=80 is {bmi}"
        # restore
        session.put(f"{API}/auth/profile", headers=auth_headers,
                    json={"age": 28, "height_cm": 178, "weight_kg": 75, "sex": "male"})
