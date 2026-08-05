"""LifeOS iteration-3 tests — workout sessions + body metrics clear-log."""
import os
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


@pytest.fixture(scope="module")
def two_exercise_ids(session):
    ex = session.get(f"{API}/exercises").json()
    return ex[0]["id"], ex[1]["id"]


# ─── Workout sessions ────────────────────────────────────────────────────────
class TestWorkouts:
    workout_id = None
    exercise_id_used = None

    def test_create_workout_with_aggregates(self, session, auth_headers, two_exercise_ids):
        ex1, ex2 = two_exercise_ids
        TestWorkouts.exercise_id_used = ex1
        payload = {
            "name": "TEST_Workout iter3",
            "routine_id": None,
            "duration_seconds": 240,
            "description": "pytest workout",
            "exercises": [
                {
                    "exercise_id": ex1,
                    "notes": "test",
                    "rest_timer_seconds": 90,
                    "sets": [
                        {"set_type": "working", "kg": 60, "reps": 10, "rpe": 7, "completed": True},
                        {"set_type": "working", "kg": 60, "reps": 10, "completed": False},
                        {"set_type": "working", "kg": 60, "reps": 10, "completed": False},
                    ],
                },
                {
                    "exercise_id": ex2,
                    "notes": "",
                    "rest_timer_seconds": 60,
                    "sets": [
                        {"set_type": "working", "kg": 40, "reps": 12, "completed": False},
                        {"set_type": "working", "kg": 40, "reps": 12, "completed": False},
                        {"set_type": "working", "kg": 40, "reps": 12, "completed": False},
                    ],
                },
            ],
        }
        r = session.post(f"{API}/workouts", headers=auth_headers, json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "id" in data and "_id" not in data
        assert data["total_volume_kg"] == 600.0, f"volume={data['total_volume_kg']}"
        assert data["completed_sets"] == 1
        assert data["total_sets"] == 6
        TestWorkouts.workout_id = data["id"]

    def test_list_workouts_enriched(self, session, auth_headers):
        r = session.get(f"{API}/workouts", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list) and len(data) >= 1
        wk = next((w for w in data if w["id"] == TestWorkouts.workout_id), None)
        assert wk is not None, "Saved workout not in list"
        # Enrichment check
        first_ex = wk["exercises"][0]
        for key in ["name", "image_url"]:
            assert key in first_ex and first_ex[key], f"enrichment missing {key}"

    def test_workout_stats(self, session, auth_headers):
        r = session.get(f"{API}/workouts/stats", headers=auth_headers)
        assert r.status_code == 200
        s = r.json()
        for k in ["total_workouts", "total_volume", "total_sets", "total_duration"]:
            assert k in s
        assert s["total_workouts"] >= 1
        assert s["total_volume"] >= 600
        assert s["total_sets"] >= 1
        assert s["total_duration"] >= 240

    def test_exercise_previous(self, session, auth_headers):
        """Last completed sets for the exercise used above."""
        r = session.get(f"{API}/exercises/{TestWorkouts.exercise_id_used}/previous",
                        headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        assert "sets" in data
        sets = data["sets"]
        assert len(sets) >= 1, "expected at least 1 completed set"
        s0 = sets[0]
        assert s0["kg"] == 60 and s0["reps"] == 10 and s0["completed"] is True

    def test_exercise_previous_no_history(self, session, auth_headers):
        """Exercise never used returns empty sets."""
        # Use a valid ObjectId-shaped id that does not appear in any workout
        r = session.get(f"{API}/exercises/000000000000000000000000/previous",
                        headers=auth_headers)
        assert r.status_code == 200
        assert r.json() == {"sets": []}

    def test_workouts_require_auth(self, session):
        r = requests.get(f"{API}/workouts")
        assert r.status_code == 401
        r = requests.post(f"{API}/workouts", json={"name": "x"})
        assert r.status_code == 401

    def test_delete_workout(self, session, auth_headers):
        wid = TestWorkouts.workout_id
        r = session.delete(f"{API}/workouts/{wid}", headers=auth_headers)
        assert r.status_code == 200
        # Confirm it no longer appears
        r = session.get(f"{API}/workouts", headers=auth_headers)
        assert all(w["id"] != wid for w in r.json())

    def test_delete_workout_404(self, session, auth_headers):
        r = session.delete(f"{API}/workouts/000000000000000000000000", headers=auth_headers)
        assert r.status_code == 404


# ─── PR / progression rollback ───────────────────────────────────────────────
class TestDerivedStateRollback:
    """Deleting or correcting a session must retract the PRs and progression it
    produced. PRs are computed incrementally, so without a replay a mistyped
    500 kg set leaves a permanent PR and keeps being prescribed as the next
    target. Runs on a throwaway custom exercise so real PR history is untouched."""

    exercise_id = None

    def _pr_weight(self, session, auth_headers):
        r = session.get(f"{API}/exercises/{self.exercise_id}/records", headers=auth_headers)
        assert r.status_code == 200
        return (r.json().get("records") or {}).get("weight", {}).get("value")

    def _log(self, session, auth_headers, kg):
        payload = {
            "name": "TEST_PR_rollback", "duration_seconds": 60,
            "exercises": [{
                "exercise_id": self.exercise_id, "rest_timer_seconds": 90, "target_reps": 8,
                "sets": [{"set_type": "working", "kg": kg, "reps": 5, "rpe": 8, "completed": True}],
            }],
        }
        r = session.post(f"{API}/workouts", headers=auth_headers, json=payload)
        assert r.status_code == 200, r.text
        return r.json()["id"]

    def test_setup_custom_exercise(self, session, auth_headers):
        r = session.post(f"{API}/exercises", headers=auth_headers,
                         json={"name": "TEST_PR_Rollback Lift", "muscle_group": "chest",
                               "equipment": "barbell"})
        assert r.status_code == 200, r.text
        TestDerivedStateRollback.exercise_id = r.json()["id"]
        assert self._pr_weight(session, auth_headers) is None, "fresh exercise should have no PR"

    def test_delete_retracts_pr(self, session, auth_headers):
        good = self._log(session, auth_headers, 60)
        assert self._pr_weight(session, auth_headers) == 60

        bogus = self._log(session, auth_headers, 500)          # mistyped entry
        assert self._pr_weight(session, auth_headers) == 500
        prog = session.get(f"{API}/progression", headers=auth_headers).json()
        assert prog[self.exercise_id]["suggested_kg"] >= 500

        session.delete(f"{API}/workouts/{bogus}", headers=auth_headers)
        assert self._pr_weight(session, auth_headers) == 60, "bogus PR survived the delete"
        prog = session.get(f"{API}/progression", headers=auth_headers).json()
        assert prog[self.exercise_id]["suggested_kg"] < 500
        assert 583.3 not in prog[self.exercise_id]["e1rm_history"]

        session.delete(f"{API}/workouts/{good}", headers=auth_headers)
        assert self._pr_weight(session, auth_headers) is None, "PR outlived every session"

    def test_edit_retracts_pr(self, session, auth_headers):
        wid = self._log(session, auth_headers, 300)
        assert self._pr_weight(session, auth_headers) == 300

        stored = session.get(f"{API}/workouts", headers=auth_headers).json()
        wk = next(w for w in stored if w["id"] == wid)
        wk["exercises"][0]["sets"][0]["kg"] = 30                # correct the typo
        r = session.put(f"{API}/workouts/{wid}", headers=auth_headers,
                        json={"name": "TEST_PR_rollback", "duration_seconds": 60,
                              "exercises": wk["exercises"]})
        assert r.status_code == 200, r.text
        assert self._pr_weight(session, auth_headers) == 30, "corrected-away PR survived the edit"

        session.delete(f"{API}/workouts/{wid}", headers=auth_headers)

    def test_teardown_custom_exercise(self, session, auth_headers):
        r = session.delete(f"{API}/exercises/{self.exercise_id}", headers=auth_headers)
        assert r.status_code == 200
        remaining = session.get(f"{API}/exercises?search=TEST_PR_Rollback",
                                headers=auth_headers).json()
        assert remaining == []


# ─── Body metrics clear-log ──────────────────────────────────────────────────
class TestClearBodyMetric:
    def test_clear_body_fat_logs(self, session, auth_headers):
        # ensure profile and at least 2 logs exist
        session.put(f"{API}/auth/profile", headers=auth_headers,
                    json={"age": 28, "height_cm": 178, "weight_kg": 75, "sex": "male"})
        for v in (15.0, 16.0):
            session.post(f"{API}/body-metrics", headers=auth_headers,
                         json={"metric": "body_fat", "value": v})
        # confirm source=manual now
        latest = session.get(f"{API}/body-metrics/latest", headers=auth_headers).json()
        assert latest["body_fat"]["source"] == "manual"

        # clear
        r = session.delete(f"{API}/body-metrics/body_fat", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        assert "deleted" in data and data["deleted"] >= 2

        # latest should revert to estimated
        latest = session.get(f"{API}/body-metrics/latest", headers=auth_headers).json()
        assert latest["body_fat"]["source"] == "estimated"
        assert latest["body_fat"]["value"] is not None

    def test_clear_auto_metric_400(self, session, auth_headers):
        r = session.delete(f"{API}/body-metrics/bmi", headers=auth_headers)
        assert r.status_code == 400
        r = session.delete(f"{API}/body-metrics/bmr", headers=auth_headers)
        assert r.status_code == 400

    def test_clear_unknown_metric_400(self, session, auth_headers):
        r = session.delete(f"{API}/body-metrics/nope", headers=auth_headers)
        assert r.status_code == 400

    def test_clear_requires_auth(self):
        r = requests.delete(f"{API}/body-metrics/body_fat")
        assert r.status_code == 401


# ─── Weight as a first-class metric with a real time series ───────────────────
class TestWeightMetric:
    """Weight must be a tracked metric (so the app can draw a trend), its healthy
    range must follow the user's height, and a new reading must sync the profile
    (which drives BMI/BMR/body-fat estimates)."""

    def test_weight_is_defined_and_height_scaled(self, session, auth_headers):
        session.put(f"{API}/auth/profile", headers=auth_headers,
                    json={"age": 28, "height_cm": 178, "weight_kg": 75, "sex": "male"})
        defs = session.get(f"{API}/body-metrics/definitions", headers=auth_headers).json()
        assert "weight" in defs and defs["weight"]["auto"] is False
        # BMI 18.5–24.9 at 1.78 m → ~58.6–78.9 kg
        assert 57 <= defs["weight"]["ideal_min"] <= 60
        assert 77 <= defs["weight"]["ideal_max"] <= 80

    def test_logging_weight_builds_history_and_syncs_profile(self, session, auth_headers):
        session.delete(f"{API}/body-metrics/weight", headers=auth_headers)  # clean slate
        for v in (75.5, 75.0, 74.4):
            r = session.post(f"{API}/body-metrics", headers=auth_headers,
                             json={"metric": "weight", "value": v})
            assert r.status_code == 200

        hist = session.get(f"{API}/body-metrics/history/weight", headers=auth_headers).json()
        assert [h["value"] for h in hist] == [75.5, 75.0, 74.4], "history must be an ordered series"

        me = session.get(f"{API}/auth/me", headers=auth_headers).json()
        assert me["profile"]["weight_kg"] == 74.4, "latest reading must reach the profile"

        latest = session.get(f"{API}/body-metrics/latest", headers=auth_headers).json()
        assert latest["weight"]["source"] == "manual"
        assert latest["bmi"]["value"] < 23.7, "BMI must recompute from the new weight"

    def test_profile_edit_appends_a_point_but_not_duplicates(self, session, auth_headers):
        before = session.get(f"{API}/body-metrics/history/weight", headers=auth_headers).json()
        session.put(f"{API}/auth/profile", headers=auth_headers, json={"weight_kg": 73.8})
        after = session.get(f"{API}/body-metrics/history/weight", headers=auth_headers).json()
        assert len(after) == len(before) + 1, "changing weight in the profile records a point"

        session.put(f"{API}/auth/profile", headers=auth_headers, json={"weight_kg": 73.8})
        same = session.get(f"{API}/body-metrics/history/weight", headers=auth_headers).json()
        assert len(same) == len(after), "re-saving the same weight must not duplicate a point"

    def test_cleanup_weight(self, session, auth_headers):
        session.delete(f"{API}/body-metrics/weight", headers=auth_headers)
        session.put(f"{API}/auth/profile", headers=auth_headers, json={"weight_kg": 75})
        session.delete(f"{API}/body-metrics/weight", headers=auth_headers)
        hist = session.get(f"{API}/body-metrics/history/weight", headers=auth_headers).json()
        assert hist == []
