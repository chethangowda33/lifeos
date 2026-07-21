"""LifeOS Backend — FastAPI + Motor (MongoDB).

Provides:
- Auth (JWT in httpOnly cookies + Bearer fallback)
- Exercises (seeded library)
- Programs (seeded, with routines)
- Custom Routines CRUD
- Body Metrics (log + history + ideal ranges)
"""
from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import re
import json
import uuid
import math
import hashlib
import secrets
import logging
from collections import Counter
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

import bcrypt
import jwt
from bson import ObjectId
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field

from seed_data import EXERCISES, PROGRAMS


# ──────────────────────────────────────────────────────────────────────────────
# Config
# ──────────────────────────────────────────────────────────────────────────────
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_TTL_MIN = 60 * 24  # 1 day
REFRESH_TOKEN_TTL_DAYS = 7
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "false").lower() == "true"  # set true in production (https)

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("lifeos")

# ── AI Coach config ──────────────────────────────────────────────────────────
COACH_MODEL = os.environ.get("COACH_MODEL", "claude-opus-4-7")
COACH_EFFORT = os.environ.get("COACH_EFFORT", "medium")  # low | medium | high | xhigh | max
GROQ_MODEL = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")
_anthropic_client = None


def get_anthropic():
    """Lazily build an AsyncAnthropic client; returns None if no key is configured."""
    global _anthropic_client
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        return None
    if _anthropic_client is None:
        from anthropic import AsyncAnthropic
        _anthropic_client = AsyncAnthropic(api_key=key)
    return _anthropic_client


def coach_provider() -> str:
    """Which LLM will the coach use? 'groq' wins if its key is set, else 'anthropic', else None."""
    if os.environ.get("GROQ_API_KEY"):
        return "groq"
    if os.environ.get("ANTHROPIC_API_KEY"):
        return "anthropic"
    return ""


async def call_groq(system: str, messages: List[Dict[str, str]]) -> str:
    """Call Groq's OpenAI-compatible chat completions endpoint."""
    import httpx
    key = os.environ["GROQ_API_KEY"]
    payload = {
        "model": GROQ_MODEL,
        "messages": [{"role": "system", "content": system}, *messages],
        "max_tokens": 1200,  # keep well within free-tier 4K/min output cap
        "temperature": 0.6,
    }
    async with httpx.AsyncClient(timeout=60) as http:
        r = await http.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json=payload,
        )
    if r.status_code >= 400:
        raise HTTPException(502, f"Groq error {r.status_code}: {r.text[:300]}")
    data = r.json()
    return (data.get("choices") or [{}])[0].get("message", {}).get("content", "").strip()


# ──────────────────────────────────────────────────────────────────────────────
# Helpers — auth
# ──────────────────────────────────────────────────────────────────────────────
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def _jwt_secret() -> str:
    return os.environ["JWT_SECRET"]


def create_access_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "type": "access",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_TTL_MIN),
    }
    return jwt.encode(payload, _jwt_secret(), algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "type": "refresh",
        "exp": datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_TTL_DAYS),
    }
    return jwt.encode(payload, _jwt_secret(), algorithm=JWT_ALGORITHM)


def set_auth_cookies(response: Response, access: str, refresh: str) -> None:
    response.set_cookie(
        key="access_token", value=access, httponly=True, secure=COOKIE_SECURE,
        samesite="lax", max_age=ACCESS_TOKEN_TTL_MIN * 60, path="/",
    )
    response.set_cookie(
        key="refresh_token", value=refresh, httponly=True, secure=COOKIE_SECURE,
        samesite="lax", max_age=REFRESH_TOKEN_TTL_DAYS * 24 * 3600, path="/",
    )


def clear_auth_cookies(response: Response) -> None:
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")


def serialize_user(doc: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": str(doc["_id"]),
        "email": doc["email"],
        "name": doc.get("name", ""),
        "role": doc.get("role", "user"),
        "created_at": doc["created_at"].isoformat() if isinstance(doc.get("created_at"), datetime) else doc.get("created_at"),
        "profile": doc.get("profile", {}),
    }


def _decode_access_token(token: str) -> Optional[Dict[str, Any]]:
    """Decode an access token, or None if it is expired, invalid, or the wrong type."""
    try:
        payload = jwt.decode(token, _jwt_secret(), algorithms=[JWT_ALGORITHM])
    except jwt.InvalidTokenError:  # covers ExpiredSignatureError
        return None
    return payload if payload.get("type") == "access" else None


async def get_current_user(request: Request) -> Dict[str, Any]:
    # Try EVERY credential presented, not just the first one. Reading the cookie
    # first and stopping there meant a stale cookie shadowed a valid Bearer token
    # and returned 401 while the caller was holding good credentials.
    candidates = []
    cookie_token = request.cookies.get("access_token")
    if cookie_token:
        candidates.append(cookie_token)
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        candidates.append(auth[7:])
    if not candidates:
        raise HTTPException(status_code=401, detail="Not authenticated")

    payload = next((p for p in (_decode_access_token(t) for t in candidates) if p), None)
    if not payload:
        raise HTTPException(status_code=401, detail="Token expired")
    try:
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid user id")
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


# ──────────────────────────────────────────────────────────────────────────────
# Pydantic Schemas
# ──────────────────────────────────────────────────────────────────────────────
class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str = ""
    invite_code: str = ""


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class UserProfileIn(BaseModel):
    name: Optional[str] = None  # top-level user field (not stored in profile)
    age: Optional[int] = None
    height_cm: Optional[float] = None
    weight_kg: Optional[float] = None
    sex: Optional[str] = None  # "male" | "female"


class RoutineExerciseIn(BaseModel):
    exercise_id: str
    sets: int = 3
    reps: int = 10
    notes: str = ""


class RoutineIn(BaseModel):
    name: str
    folder: str = ""  # Hevy-style grouping; "" = ungrouped
    exercises: List[RoutineExerciseIn] = []


class PlanDayExerciseIn(BaseModel):
    exercise_id: str
    sets: int = 3
    reps: int = 10
    notes: str = ""

    model_config = {"extra": "ignore"}


class PlanDayIn(BaseModel):
    name: str
    exercises: List[PlanDayExerciseIn] = []
    last_completed_at: Optional[str] = None

    model_config = {"extra": "ignore"}


class PlanIn(BaseModel):
    name: str
    source_program_id: Optional[str] = None
    days: List[PlanDayIn] = []
    # New shape: a plan (a "split") is an ordered list of Routines. `days` is the
    # legacy embedded shape and is kept so existing plans keep working.
    routine_ids: List[str] = []
    next_day_index: Optional[int] = 0
    cooldown_days: Optional[int] = None  # None = leave unchanged on update; 0 = guard off

    model_config = {"extra": "ignore"}


class BodyMetricIn(BaseModel):
    metric: str  # one of METRIC_DEFS
    value: float


class HabitIn(BaseModel):
    name: str
    emoji: str = "✅"
    type: str = "check"  # check | count
    target: Optional[float] = None  # daily target for count habits
    unit: str = ""
    model_config = {"extra": "ignore"}


class HabitLogIn(BaseModel):
    date: Optional[str] = None  # YYYY-MM-DD; defaults to today
    value: Optional[float] = None  # count habits set this value; check habits toggle


class SleepLogIn(BaseModel):
    date: Optional[str] = None  # night's date (YYYY-MM-DD); defaults to today
    hours: float
    quality: Optional[int] = None  # 1–5
    bedtime: str = ""
    wake_time: str = ""
    model_config = {"extra": "ignore"}


class HealthIngestIn(BaseModel):
    """Brand-agnostic daily health payload pushed by a phone automation / export app.
    Works with ANY source that writes to Apple Health (iPhone) or Health Connect
    (Android) — Apple/Garmin/Fitbit/Fastrack/phone pedometer all funnel through there."""
    date: Optional[str] = None  # YYYY-MM-DD; defaults to today
    steps: Optional[int] = None
    distance_km: Optional[float] = None
    resting_hr: Optional[int] = None
    avg_hr: Optional[int] = None              # average heart rate (bpm)
    hrv: Optional[float] = None               # HRV SDNN (ms) — basis of most stress scores
    spo2: Optional[float] = None              # blood oxygen (%)
    stress: Optional[int] = None             # 0–100 (watch-reported or HRV-derived)
    respiratory_rate: Optional[float] = None  # breaths/min
    active_energy: Optional[float] = None  # kcal
    sleep_hours: Optional[float] = None
    sleep_quality: Optional[int] = None  # 1–5
    model_config = {"extra": "ignore"}


# Daily metrics that upsert into health_daily (sleep is handled separately below).
HEALTH_DAILY_FIELDS = (
    "steps", "distance_km", "resting_hr", "avg_hr", "hrv",
    "spo2", "stress", "respiratory_rate", "active_energy",
)


class WorkoutSetIn(BaseModel):
    set_type: str = "working"  # working | warmup | dropset | failure | amrap
    kg: Optional[float] = None
    reps: Optional[int] = None
    duration_seconds: Optional[int] = None  # for time-based exercises
    distance_m: Optional[float] = None  # for cardio (pace = distance/duration)
    rpe: Optional[float] = None
    completed: bool = False


class WorkoutExerciseIn(BaseModel):
    exercise_id: str
    notes: str = ""
    rest_timer_seconds: int = 90
    superset_group_id: Optional[str] = None
    target_reps: Optional[int] = None  # routine's rep target — drives progression
    sets: List[WorkoutSetIn] = []

    model_config = {"extra": "ignore"}


class WorkoutSessionIn(BaseModel):
    name: str = "Workout"
    routine_id: Optional[str] = None
    plan_id: Optional[str] = None
    day_index: Optional[int] = None
    duration_seconds: int = 0
    description: str = ""
    exercises: List[WorkoutExerciseIn] = []


class WorkoutSettingsIn(BaseModel):
    default_rest_timer_seconds: Optional[int] = None
    previous_workout_values_mode: Optional[str] = None  # default | last_set | best_set
    keep_screen_awake_during_workout: Optional[bool] = None
    plate_calculator_enabled: Optional[bool] = None
    rpe_tracking_enabled: Optional[bool] = None
    smart_superset_scrolling: Optional[bool] = None
    inline_timer_enabled: Optional[bool] = None
    live_pr_notification_enabled: Optional[bool] = None
    bar_weight_kg: Optional[float] = None
    plate_inventory: Optional[List[float]] = None
    train_reminder_enabled: Optional[bool] = None
    train_reminder_time: Optional[str] = None  # "HH:MM" 24h
    tz_offset_minutes: Optional[int] = None  # local offset from UTC, for background push

    model_config = {"extra": "ignore"}


DEFAULT_WORKOUT_SETTINGS: Dict[str, Any] = {
    "default_rest_timer_seconds": 90,
    "previous_workout_values_mode": "default",
    "keep_screen_awake_during_workout": True,
    "plate_calculator_enabled": True,
    "rpe_tracking_enabled": True,
    "smart_superset_scrolling": True,
    "inline_timer_enabled": True,
    "live_pr_notification_enabled": True,
    "bar_weight_kg": 20.0,
    "plate_inventory": [25, 20, 15, 10, 5, 2.5, 1.25],
    "train_reminder_enabled": False,
    "train_reminder_time": "18:00",
}


# ──────────────────────────────────────────────────────────────────────────────
# Constants — body metric definitions with ideal ranges
# ──────────────────────────────────────────────────────────────────────────────
METRIC_DEFS: Dict[str, Dict[str, Any]] = {
    # Weight is a first-class tracked metric, not just a profile field — otherwise the
    # app can't draw the one trend users most expect. Its ideal range is height-dependent,
    # so metric_definitions() overrides these placeholders per user (BMI 18.5–24.9).
    "weight": {"label": "Weight", "unit": "kg", "ideal_min": 57, "ideal_max": 76, "auto": False},
    "body_fat": {"label": "Body Fat", "unit": "%", "ideal_min": 10, "ideal_max": 20, "auto": False},
    "muscle_mass": {"label": "Muscle Mass", "unit": "%", "ideal_min": 38, "ideal_max": 54, "auto": False},
    "bone_mass": {"label": "Bone Mass", "unit": "kg", "ideal_min": 2.5, "ideal_max": 3.5, "auto": False},
    "hydration": {"label": "Hydration", "unit": "%", "ideal_min": 55, "ideal_max": 65, "auto": False},
    "metabolic_age": {"label": "Metabolic Age", "unit": "years", "ideal_min": 18, "ideal_max": 40, "auto": False},
    "bmi": {"label": "BMI", "unit": "kg/m²", "ideal_min": 18.5, "ideal_max": 24.9, "auto": True},
    "bmr": {"label": "BMR", "unit": "kcal/day", "ideal_min": 1500, "ideal_max": 2200, "auto": True},
}


# ──────────────────────────────────────────────────────────────────────────────
# FastAPI app
# ──────────────────────────────────────────────────────────────────────────────
app = FastAPI(title="LifeOS API")
api = APIRouter(prefix="/api")


@api.get("/")
async def root():
    return {"app": "LifeOS", "status": "ok"}


# ── AUTH ──────────────────────────────────────────────────────────────────────
@api.post("/auth/register")
async def register(payload: RegisterIn, response: Response):
    # Invite-only mode: when INVITE_CODE is set in the environment, registration requires it.
    required_code = os.environ.get("INVITE_CODE", "")
    if required_code and payload.invite_code != required_code:
        raise HTTPException(status_code=403, detail="Invalid invite code — this app is invite-only")
    email = payload.email.lower()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user_doc = {
        "email": email,
        "password_hash": hash_password(payload.password),
        "name": payload.name or email.split("@")[0],
        "role": "user",
        "profile": {},
        "created_at": datetime.now(timezone.utc),
    }
    result = await db.users.insert_one(user_doc)
    user_doc["_id"] = result.inserted_id
    access = create_access_token(str(result.inserted_id), email)
    refresh = create_refresh_token(str(result.inserted_id))
    set_auth_cookies(response, access, refresh)
    return {"user": serialize_user(user_doc), "access_token": access}


@api.post("/auth/login")
async def login(payload: LoginIn, response: Response):
    email = payload.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    access = create_access_token(str(user["_id"]), email)
    refresh = create_refresh_token(str(user["_id"]))
    set_auth_cookies(response, access, refresh)
    return {"user": serialize_user(user), "access_token": access}


@api.post("/auth/logout")
async def logout(response: Response):
    clear_auth_cookies(response)
    return {"ok": True}


@api.get("/auth/me")
async def me(user=Depends(get_current_user)):
    return serialize_user(user)


async def require_admin(user=Depends(get_current_user)) -> Dict[str, Any]:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


@api.get("/admin/users")
async def admin_list_users(user=Depends(require_admin)):
    """Account management for the admin: who has an account, role, signup date."""
    docs = await db.users.find({}, {"password_hash": 0}).to_list(200)
    # Attach each user's workout count so the admin sees who's actually active.
    counts = await db.workout_sessions.aggregate(
        [{"$group": {"_id": "$user_id", "n": {"$sum": 1}}}]
    ).to_list(1000)
    by_uid = {c["_id"]: c["n"] for c in counts}
    out = []
    for d in docs:
        u = serialize_user(d)
        u["workout_count"] = by_uid.get(str(d["_id"]), 0)
        out.append(u)
    return out


@api.get("/admin/stats")
async def admin_stats(user=Depends(require_admin)):
    """App-wide overview for the admin dashboard."""
    week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    total_users = await db.users.count_documents({})
    admins = await db.users.count_documents({"role": "admin"})
    total_workouts = await db.workout_sessions.count_documents({})
    workouts_this_week = await db.workout_sessions.count_documents({"created_at": {"$gte": week_ago}})
    active_uids = await db.workout_sessions.distinct("user_id", {"created_at": {"$gte": week_ago}})
    return {
        "total_users": total_users,
        "admins": admins,
        "members": total_users - admins,
        "total_workouts": total_workouts,
        "workouts_this_week": workouts_this_week,
        "active_users_this_week": len(active_uids),
    }


@api.put("/auth/profile")
async def update_profile(payload: UserProfileIn, user=Depends(get_current_user)):
    # Merge with existing profile (partial update) — never wipe untouched fields.
    data = payload.model_dump()
    name = data.pop("name", None)
    merged = dict(user.get("profile") or {})
    prev_weight = merged.get("weight_kg")
    for k, v in data.items():
        if v is not None:
            merged[k] = v
    # Onboarding and the profile editor are where most people change their weight, so
    # record a history point here too — otherwise the trend only ever has one dot.
    if data.get("weight_kg") is not None and data["weight_kg"] != prev_weight:
        await db.body_metrics.insert_one({
            "user_id": str(user["_id"]), "metric": "weight", "value": float(data["weight_kg"]),
            "recorded_at": datetime.now(timezone.utc).isoformat(),
        })
    update = {"profile": merged}
    if name and name.strip():
        update["name"] = name.strip()
        user["name"] = name.strip()
    await db.users.update_one({"_id": user["_id"]}, {"$set": update})
    user["profile"] = merged
    return serialize_user(user)


# ── EXERCISES ─────────────────────────────────────────────────────────────────
class CustomExerciseIn(BaseModel):
    name: str
    muscle_group: str
    equipment: str
    instructions: str = ""

    model_config = {"extra": "ignore"}


async def get_optional_user(request: Request) -> Optional[Dict[str, Any]]:
    try:
        return await get_current_user(request)
    except HTTPException:
        return None


@api.get("/exercises")
async def list_exercises(
    muscle_group: Optional[str] = None,
    equipment: Optional[str] = None,
    search: Optional[str] = None,
    user=Depends(get_optional_user),
):
    # Library exercises (no owner) plus this user's own custom ones.
    if user:
        q: Dict[str, Any] = {"$or": [{"user_id": {"$exists": False}}, {"user_id": str(user["_id"])}]}
    else:
        q = {"user_id": {"$exists": False}}
    if muscle_group and muscle_group != "all":
        q["muscle_group"] = muscle_group
    if equipment and equipment != "all":
        q["equipment"] = equipment
    if search:
        q["name"] = {"$regex": search, "$options": "i"}
    docs = await db.exercises.find(q).sort("name", 1).to_list(2000)
    out = []
    for d in docs:
        d["id"] = str(d.pop("_id"))
        out.append(d)
    return out


@api.post("/exercises")
async def create_custom_exercise(payload: CustomExerciseIn, user=Depends(get_current_user)):
    doc = {
        "user_id": str(user["_id"]),
        "name": payload.name.strip(),
        "muscle_group": payload.muscle_group,
        "equipment": payload.equipment,
        "instructions": payload.instructions.strip(),
        "custom": True,
        "image_url": None,
        "animation_url": None,
        "secondary_muscles": [],
    }
    res = await db.exercises.insert_one(doc)
    doc["id"] = str(res.inserted_id)
    doc.pop("_id", None)
    return doc


@api.delete("/exercises/{exercise_id}")
async def delete_custom_exercise(exercise_id: str, user=Depends(get_current_user)):
    """Delete one of YOUR custom exercises. Library exercises (no user_id) are
    never deletable — the filter on user_id makes that impossible."""
    try:
        oid = ObjectId(exercise_id)
    except Exception:
        raise HTTPException(404, "Exercise not found")
    res = await db.exercises.delete_one({"_id": oid, "user_id": str(user["_id"]), "custom": True})
    if res.deleted_count == 0:
        raise HTTPException(404, "Custom exercise not found")
    # The note is keyed by exercise_id, so it would otherwise outlive the exercise.
    await db.exercise_notes.delete_many({"user_id": str(user["_id"]), "exercise_id": exercise_id})
    return {"ok": True}


@api.get("/exercises/meta")
async def exercises_meta():
    muscle_groups = sorted(m for m in await db.exercises.distinct("muscle_group") if m)
    equipment = sorted(e for e in await db.exercises.distinct("equipment") if e)
    return {"muscle_groups": muscle_groups, "equipment": equipment}


@api.get("/exercises/notes")
async def get_exercise_notes(user=Depends(get_current_user)):
    """Persistent per-exercise note map: {exercise_id: note}. Must stay registered before /exercises/{exercise_id}."""
    docs = await db.exercise_notes.find({"user_id": str(user["_id"])}).to_list(500)
    return {d["exercise_id"]: d.get("note", "") for d in docs}


@api.put("/exercises/{exercise_id}/note")
async def put_exercise_note(exercise_id: str, body: dict, user=Depends(get_current_user)):
    note = (body.get("note") or "").strip()
    key = {"user_id": str(user["_id"]), "exercise_id": exercise_id}
    if note:
        await db.exercise_notes.update_one(key, {"$set": {"note": note}}, upsert=True)
    else:
        await db.exercise_notes.delete_one(key)
    return {"note": note}


# ── PROGRAMS ──────────────────────────────────────────────────────────────────
async def _enrich_program_with_images(program: Dict[str, Any]) -> Dict[str, Any]:
    """Resolve exercise_ids inside a program's routines to full exercise data (name + image)."""
    ex_ids: List[str] = []
    for r in program.get("routines", []):
        for ex in r.get("exercises", []):
            if ex.get("exercise_id"):
                ex_ids.append(ex["exercise_id"])
    if not ex_ids:
        return program
    object_ids = []
    for eid in ex_ids:
        try:
            object_ids.append(ObjectId(eid))
        except Exception:
            continue
    cursor = db.exercises.find({"_id": {"$in": object_ids}})
    by_id: Dict[str, Dict[str, Any]] = {}
    async for doc in cursor:
        by_id[str(doc["_id"])] = doc
    for r in program.get("routines", []):
        for ex in r.get("exercises", []):
            ref = by_id.get(ex.get("exercise_id"))
            if ref:
                ex["image_url"] = ref.get("image_url")
                ex["muscle_group"] = ref.get("muscle_group")
                ex["equipment"] = ref.get("equipment")
                ex["instructions"] = ref.get("instructions")
                if not ex.get("name"):
                    ex["name"] = ref.get("name")
    return program


@api.get("/programs")
async def list_programs(level: Optional[str] = None, goal: Optional[str] = None, equipment: Optional[str] = None):
    q: Dict[str, Any] = {}
    if level and level != "all":
        q["level"] = level
    if goal and goal != "all":
        q["goal"] = goal
    if equipment and equipment != "all":
        q["equipment"] = equipment
    docs = await db.programs.find(q).to_list(100)
    for d in docs:
        d["id"] = str(d.pop("_id"))
    return docs


@api.get("/programs/{program_id}")
async def get_program(program_id: str):
    try:
        doc = await db.programs.find_one({"_id": ObjectId(program_id)})
    except Exception:
        raise HTTPException(404, "Program not found")
    if not doc:
        raise HTTPException(404, "Program not found")
    doc["id"] = str(doc.pop("_id"))
    await _enrich_program_with_images(doc)
    return doc


@api.get("/exercises/{exercise_id}")
async def get_exercise(exercise_id: str):
    try:
        doc = await db.exercises.find_one({"_id": ObjectId(exercise_id)})
    except Exception:
        raise HTTPException(404, "Exercise not found")
    if not doc:
        raise HTTPException(404, "Exercise not found")
    doc["id"] = str(doc.pop("_id"))
    return doc


# ── CUSTOM ROUTINES ───────────────────────────────────────────────────────────
@api.put("/routines/reorder")
async def reorder_routines(payload: Dict[str, Any], user=Depends(get_current_user)):
    ids = payload.get("ids") or []
    for i, rid in enumerate(ids):
        try:
            await db.routines.update_one(
                {"_id": ObjectId(rid), "user_id": str(user["_id"])}, {"$set": {"order": i}}
            )
        except Exception:
            continue
    return {"ok": True}


@api.get("/routines")
async def list_routines(user=Depends(get_current_user)):
    docs = await db.routines.find({"user_id": str(user["_id"])}).sort(
        [("order", 1), ("created_at", -1)]
    ).to_list(200)
    # Collect all exercise_ids to enrich
    all_ids = set()
    for d in docs:
        for ex in d.get("exercises", []):
            if ex.get("exercise_id"):
                all_ids.add(ex["exercise_id"])
    by_id: Dict[str, Dict[str, Any]] = {}
    if all_ids:
        object_ids = []
        for eid in all_ids:
            try:
                object_ids.append(ObjectId(eid))
            except Exception:
                continue
        async for ref in db.exercises.find({"_id": {"$in": object_ids}}):
            by_id[str(ref["_id"])] = ref
    for d in docs:
        d["id"] = str(d.pop("_id"))
        for ex in d.get("exercises", []):
            ref = by_id.get(ex.get("exercise_id"))
            if ref:
                ex["name"] = ref.get("name")
                ex["image_url"] = ref.get("image_url")
                ex["muscle_group"] = ref.get("muscle_group")
                ex["equipment"] = ref.get("equipment")
    return docs


@api.post("/routines")
async def create_routine(payload: RoutineIn, user=Depends(get_current_user)):
    doc = {
        "user_id": str(user["_id"]),
        "name": payload.name,
        "folder": payload.folder or "",
        "exercises": [e.model_dump() for e in payload.exercises],
        "created_at": datetime.now(timezone.utc),
    }
    res = await db.routines.insert_one(doc)
    doc["id"] = str(res.inserted_id)
    doc.pop("_id", None)
    return doc


@api.put("/routines/{routine_id}")
async def update_routine(routine_id: str, payload: RoutineIn, user=Depends(get_current_user)):
    try:
        oid = ObjectId(routine_id)
    except Exception:
        raise HTTPException(404, "Routine not found")
    res = await db.routines.update_one(
        {"_id": oid, "user_id": str(user["_id"])},
        {"$set": {
            "name": payload.name,
            "folder": payload.folder or "",
            "exercises": [e.model_dump() for e in payload.exercises],
        }},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Routine not found")
    return {"ok": True}


@api.put("/routines/{routine_id}/folder")
async def set_routine_folder(routine_id: str, body: dict, user=Depends(get_current_user)):
    """Move a routine into a folder (or out of one with ""). Hevy-style grouping."""
    try:
        oid = ObjectId(routine_id)
    except Exception:
        raise HTTPException(404, "Routine not found")
    folder = str(body.get("folder") or "").strip()[:60]
    res = await db.routines.update_one(
        {"_id": oid, "user_id": str(user["_id"])}, {"$set": {"folder": folder}}
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Routine not found")
    return {"ok": True, "folder": folder}


@api.delete("/routines/{routine_id}")
async def delete_routine(routine_id: str, user=Depends(get_current_user)):
    try:
        oid = ObjectId(routine_id)
    except Exception:
        raise HTTPException(404, "Routine not found")
    res = await db.routines.delete_one({"_id": oid, "user_id": str(user["_id"])})
    if res.deleted_count == 0:
        raise HTTPException(404, "Routine not found")
    return {"ok": True}


# ── PLANS (multi-day programs the user follows) ────────────────────────────────
async def _enrich_plan_days(docs: List[Dict[str, Any]]) -> None:
    """Attach exercise name/image/muscle_group/equipment to every day's exercises."""
    all_ids = set()
    for d in docs:
        for day in d.get("days", []):
            for ex in day.get("exercises", []):
                if ex.get("exercise_id"):
                    all_ids.add(ex["exercise_id"])
    by_id: Dict[str, Dict[str, Any]] = {}
    if all_ids:
        object_ids = []
        for eid in all_ids:
            try:
                object_ids.append(ObjectId(eid))
            except Exception:
                continue
        async for ref in db.exercises.find({"_id": {"$in": object_ids}}):
            by_id[str(ref["_id"])] = ref
    for d in docs:
        for day in d.get("days", []):
            for ex in day.get("exercises", []):
                ref = by_id.get(ex.get("exercise_id"))
                if ref:
                    ex["name"] = ref.get("name")
                    ex["image_url"] = ref.get("image_url")
                    ex["muscle_group"] = ref.get("muscle_group")
                    ex["equipment"] = ref.get("equipment")


def _serialize_plan_days(days: List[PlanDayIn]) -> List[Dict[str, Any]]:
    return [
        {
            "name": day.name,
            "exercises": [ex.model_dump() for ex in day.exercises],
            "last_completed_at": day.last_completed_at,
        }
        for day in days
    ]


async def _enrich_plan_routines(docs: List[Dict[str, Any]], user_id: str) -> None:
    """Attach the referenced Routines (in order) to every plan that uses the
    routine_ids shape, so the UI can render a split without embedded exercises."""
    all_ids = set()
    for d in docs:
        for rid in d.get("routine_ids") or []:
            all_ids.add(rid)
    if not all_ids:
        return
    oids = []
    for rid in all_ids:
        try:
            oids.append(ObjectId(rid))
        except Exception:
            continue
    by_id: Dict[str, Dict[str, Any]] = {}
    async for r in db.routines.find({"_id": {"$in": oids}, "user_id": user_id}):
        by_id[str(r["_id"])] = r
    for d in docs:
        out = []
        for rid in d.get("routine_ids") or []:
            r = by_id.get(rid)
            if r:
                out.append({
                    "id": rid,
                    "name": r.get("name"),
                    "folder": r.get("folder", ""),
                    "exercise_count": len(r.get("exercises") or []),
                })
        d["routines"] = out


@api.get("/plans")
async def list_plans(user=Depends(get_current_user)):
    docs = await db.plans.find({"user_id": str(user["_id"])}).sort("created_at", -1).to_list(200)
    await _enrich_plan_days(docs)
    await _enrich_plan_routines(docs, str(user["_id"]))
    for d in docs:
        d["id"] = str(d.pop("_id"))
    return docs


@api.post("/plans")
async def create_plan(payload: PlanIn, user=Depends(get_current_user)):
    doc = {
        "user_id": str(user["_id"]),
        "name": payload.name,
        "source_program_id": payload.source_program_id,
        "days": _serialize_plan_days(payload.days),
        "routine_ids": payload.routine_ids or [],
        "next_day_index": payload.next_day_index or 0,
        "cooldown_days": payload.cooldown_days if payload.cooldown_days is not None else 7,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    res = await db.plans.insert_one(doc)
    doc["id"] = str(res.inserted_id)
    doc.pop("_id", None)
    return doc


@api.put("/plans/{plan_id}")
async def update_plan(plan_id: str, payload: PlanIn, user=Depends(get_current_user)):
    try:
        oid = ObjectId(plan_id)
    except Exception:
        raise HTTPException(404, "Plan not found")
    update = {"name": payload.name, "days": _serialize_plan_days(payload.days)}
    if payload.routine_ids:
        update["routine_ids"] = payload.routine_ids
    if payload.next_day_index is not None:
        n = len(payload.routine_ids) or len(payload.days) or 1
        update["next_day_index"] = max(0, min(payload.next_day_index, n - 1))
    if payload.cooldown_days is not None:
        update["cooldown_days"] = max(0, payload.cooldown_days)
    res = await db.plans.update_one(
        {"_id": oid, "user_id": str(user["_id"])}, {"$set": update}
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Plan not found")
    return {"ok": True}


@api.post("/plans/{plan_id}/import-days")
async def import_plan_days_as_routines(plan_id: str, user=Depends(get_current_user)):
    """Non-destructive upgrade: copy each embedded plan day into a real Routine
    and point the plan at them via routine_ids.

    The original `days` array is deliberately left in place — nothing is deleted,
    so this is safe to run and easy to roll back. No-ops if already imported.
    """
    try:
        oid = ObjectId(plan_id)
    except Exception:
        raise HTTPException(404, "Plan not found")
    uid = str(user["_id"])
    plan = await db.plans.find_one({"_id": oid, "user_id": uid})
    if not plan:
        raise HTTPException(404, "Plan not found")
    if plan.get("routine_ids"):
        return {"ok": True, "already_imported": True, "routine_ids": plan["routine_ids"]}

    routine_ids: List[str] = []
    for day in plan.get("days") or []:
        exercises = [
            {
                "exercise_id": e.get("exercise_id"),
                "sets": e.get("sets", 3),
                "reps": e.get("reps", 10),
                "notes": e.get("notes", ""),
            }
            for e in (day.get("exercises") or [])
            if e.get("exercise_id")
        ]
        res = await db.routines.insert_one({
            "user_id": uid,
            "name": day.get("name") or "Day",
            "folder": plan.get("name") or "",   # group them under the split's name
            "exercises": exercises,
            "created_at": datetime.now(timezone.utc),
        })
        routine_ids.append(str(res.inserted_id))

    await db.plans.update_one({"_id": oid}, {"$set": {"routine_ids": routine_ids}})
    return {"ok": True, "already_imported": False, "routine_ids": routine_ids}


@api.delete("/plans/{plan_id}")
async def delete_plan(plan_id: str, user=Depends(get_current_user)):
    try:
        oid = ObjectId(plan_id)
    except Exception:
        raise HTTPException(404, "Plan not found")
    res = await db.plans.delete_one({"_id": oid, "user_id": str(user["_id"])})
    if res.deleted_count == 0:
        raise HTTPException(404, "Plan not found")
    return {"ok": True}


# ── BODY METRICS ──────────────────────────────────────────────────────────────
def _compute_bmi(weight_kg: float, height_cm: float) -> float:
    if not weight_kg or not height_cm:
        return 0.0
    h_m = height_cm / 100.0
    return round(weight_kg / (h_m * h_m), 1)


def _compute_bmr(weight_kg: float, height_cm: float, age: int, sex: str) -> float:
    # Mifflin-St Jeor
    if not (weight_kg and height_cm and age):
        return 0.0
    base = 10 * weight_kg + 6.25 * height_cm - 5 * age
    return round(base + (5 if sex == "male" else -161), 0)


def _compute_body_fat(bmi: float, age: int, sex: str) -> float:
    """Deurenberg formula — body fat % estimated from BMI, age, sex."""
    if not bmi or not age:
        return 0.0
    sex_factor = 1 if sex == "male" else 0
    bf = (1.20 * bmi) + (0.23 * age) - (10.8 * sex_factor) - 5.4
    return round(max(0.0, bf), 1)


def _compute_muscle_mass_pct(weight_kg: float, body_fat_pct: float) -> float:
    """Rough muscle-mass % estimate: skeletal muscle is ~half of lean mass for adults."""
    if not weight_kg or not body_fat_pct:
        return 0.0
    lean_pct = 100 - body_fat_pct
    # Skeletal muscle mass is roughly 45-55% of lean body mass in adults
    muscle_pct = lean_pct * 0.50
    return round(muscle_pct, 1)


def _compute_bone_mass(weight_kg: float, sex: str) -> float:
    """Bone mass in kg — roughly 3.5% of body weight for males, 3.0% for females."""
    if not weight_kg:
        return 0.0
    factor = 0.035 if sex == "male" else 0.030
    return round(weight_kg * factor, 2)


def _compute_hydration(body_fat_pct: float) -> float:
    """Hydration % — lean tissue is ~73% water, so total body water ≈ 73% × (1 − bf%)."""
    if not body_fat_pct:
        return 0.0
    return round(73.2 * (1 - body_fat_pct / 100), 1)


def _compute_metabolic_age(bmi: float, body_fat_pct: float, age: int, sex: str) -> float:
    """Very rough metabolic age estimate: actual age, nudged by how far body fat is from ideal."""
    if not (age and bmi):
        return 0.0
    ideal_bf = 15 if sex == "male" else 23
    delta = body_fat_pct - ideal_bf
    # +1 metabolic year per 2% above ideal body fat, capped ±15 yrs
    adjustment = max(-15, min(15, delta / 2.0))
    return round(age + adjustment, 0)


@api.get("/body-metrics/definitions")
async def metric_definitions(user=Depends(get_optional_user)):
    """Metric definitions, with weight's healthy range personalised to the user's
    height (a 'good' weight means nothing without one). Stays public — anonymous
    callers just get the placeholder range."""
    defs = {k: dict(v) for k, v in METRIC_DEFS.items()}
    height = ((user or {}).get("profile") or {}).get("height_cm") or 0
    if height:
        m2 = (height / 100.0) ** 2
        defs["weight"]["ideal_min"] = round(18.5 * m2, 1)
        defs["weight"]["ideal_max"] = round(24.9 * m2, 1)
    return defs


@api.get("/body-metrics/latest")
async def latest_metrics(user=Depends(get_current_user)):
    """Return the latest manually-logged value for each metric, falling back to
    a profile-based estimate. BMI and BMR are always auto-computed."""
    user_id = str(user["_id"])
    profile = user.get("profile", {}) or {}
    weight = profile.get("weight_kg") or 0
    height = profile.get("height_cm") or 0
    age = profile.get("age") or 0
    sex = profile.get("sex") or "male"

    # 1) Auto-computed core values
    bmi = _compute_bmi(weight, height)
    bmr = _compute_bmr(weight, height, age, sex)
    est_body_fat = _compute_body_fat(bmi, age, sex)
    est_muscle = _compute_muscle_mass_pct(weight, est_body_fat)
    est_bone = _compute_bone_mass(weight, sex)
    est_hydration = _compute_hydration(est_body_fat)
    est_metabolic_age = _compute_metabolic_age(bmi, est_body_fat, age, sex)

    estimates = {
        "weight": weight,  # falls back to the profile figure until a reading is logged
        "body_fat": est_body_fat,
        "muscle_mass": est_muscle,
        "bone_mass": est_bone,
        "hydration": est_hydration,
        "metabolic_age": est_metabolic_age,
        "bmi": bmi,
        "bmr": bmr,
    }

    result: Dict[str, Any] = {}
    for metric_key, defn in METRIC_DEFS.items():
        # Manual log overrides estimate (only for non-auto metrics)
        manual_doc = None
        if not defn["auto"]:
            manual_doc = await db.body_metrics.find_one(
                {"user_id": user_id, "metric": metric_key},
                sort=[("recorded_at", -1)],
            )
        if manual_doc:
            result[metric_key] = {
                "value": manual_doc["value"],
                "recorded_at": manual_doc["recorded_at"],
                "source": "manual",
            }
        else:
            est = estimates.get(metric_key, 0.0)
            result[metric_key] = {
                "value": est if est else None,
                "recorded_at": None,
                "source": "estimated" if est else "missing",
            }
    return result


@api.post("/body-metrics")
async def log_metric(payload: BodyMetricIn, user=Depends(get_current_user)):
    if payload.metric not in METRIC_DEFS:
        raise HTTPException(400, "Unknown metric")
    if METRIC_DEFS[payload.metric]["auto"]:
        raise HTTPException(400, "Auto-computed metric cannot be logged manually")
    doc = {
        "user_id": str(user["_id"]),
        "metric": payload.metric,
        "value": payload.value,
        "recorded_at": datetime.now(timezone.utc).isoformat(),
    }
    res = await db.body_metrics.insert_one(doc)
    # Weight drives BMI, BMR and every body-fat/muscle estimate, so a new reading has
    # to reach the profile too — otherwise the trend moves while the cards stay stale.
    if payload.metric == "weight":
        await db.users.update_one(
            {"_id": user["_id"]}, {"$set": {"profile.weight_kg": payload.value}}
        )
    doc["id"] = str(res.inserted_id)
    doc.pop("_id", None)
    return doc


@api.get("/body-metrics/history/{metric}")
async def metric_history(metric: str, user=Depends(get_current_user)):
    if metric not in METRIC_DEFS:
        raise HTTPException(400, "Unknown metric")
    docs = await db.body_metrics.find(
        {"user_id": str(user["_id"]), "metric": metric}
    ).sort("recorded_at", 1).to_list(500)
    for d in docs:
        d["id"] = str(d.pop("_id"))
    return docs


@api.delete("/body-metrics/{metric}")
async def clear_metric_logs(metric: str, user=Depends(get_current_user)):
    """Remove every manual log for this metric so the card reverts to its profile-based estimate."""
    if metric not in METRIC_DEFS:
        raise HTTPException(400, "Unknown metric")
    if METRIC_DEFS[metric]["auto"]:
        raise HTTPException(400, "BMI and BMR are always auto-computed; nothing to clear")
    res = await db.body_metrics.delete_many({"user_id": str(user["_id"]), "metric": metric})
    return {"deleted": res.deleted_count}


# ── HABITS ────────────────────────────────────────────────────────────────────
def _today_str() -> str:
    return datetime.now(timezone.utc).date().isoformat()


@api.get("/habits")
async def list_habits(user=Depends(get_current_user)):
    """Active habits with today's status, current streak, and recent history (for the heatmap)."""
    uid = str(user["_id"])
    habits = await db.habits.find({"user_id": uid, "archived": {"$ne": True}}).sort("created_at", 1).to_list(200)
    ids = [str(h["_id"]) for h in habits]
    logs = await db.habit_logs.find({"user_id": uid, "habit_id": {"$in": ids}}).to_list(10000)
    by_habit: Dict[str, Dict[str, Any]] = {}
    for l in logs:
        by_habit.setdefault(l["habit_id"], {})[l["date"]] = l
    today = _today_str()
    out = []
    for h in habits:
        hid = str(h["_id"])
        hlogs = by_habit.get(hid, {})

        def done_on(d: str) -> bool:
            l = hlogs.get(d)
            if not l:
                return False
            if h.get("type") == "count":
                return (l.get("value") or 0) >= (h.get("target") or 1)
            return bool(l.get("completed"))

        # streak: consecutive completed days ending today (or yesterday if today not yet done)
        streak = 0
        cur = datetime.now(timezone.utc).date()
        if not done_on(cur.isoformat()):
            cur = cur - timedelta(days=1)
        while done_on(cur.isoformat()):
            streak += 1
            cur = cur - timedelta(days=1)

        today_log = hlogs.get(today, {})
        history = {d: True for d in hlogs if done_on(d)}
        out.append({
            "id": hid, "name": h["name"], "emoji": h.get("emoji", "✅"),
            "type": h.get("type", "check"), "target": h.get("target"), "unit": h.get("unit", ""),
            "today_value": today_log.get("value"),
            "today_done": done_on(today),
            "streak": streak,
            "history": history,
        })
    return out


@api.post("/habits")
async def create_habit(payload: HabitIn, user=Depends(get_current_user)):
    doc = {
        "user_id": str(user["_id"]),
        "name": payload.name.strip() or "Habit",
        "emoji": payload.emoji or "✅",
        "type": payload.type if payload.type in ("check", "count") else "check",
        "target": payload.target,
        "unit": payload.unit,
        "archived": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    res = await db.habits.insert_one(doc)
    doc["id"] = str(res.inserted_id)
    doc.pop("_id", None)
    return doc


@api.put("/habits/{habit_id}")
async def update_habit(habit_id: str, payload: HabitIn, user=Depends(get_current_user)):
    upd = {"name": payload.name.strip(), "emoji": payload.emoji, "type": payload.type,
           "target": payload.target, "unit": payload.unit}
    res = await db.habits.update_one({"_id": ObjectId(habit_id), "user_id": str(user["_id"])}, {"$set": upd})
    if not res.matched_count:
        raise HTTPException(404, "Habit not found")
    return {"ok": True}


@api.delete("/habits/{habit_id}")
async def delete_habit(habit_id: str, user=Depends(get_current_user)):
    uid = str(user["_id"])
    await db.habits.delete_one({"_id": ObjectId(habit_id), "user_id": uid})
    await db.habit_logs.delete_many({"habit_id": habit_id, "user_id": uid})
    return {"ok": True}


@api.post("/habits/{habit_id}/log")
async def log_habit(habit_id: str, payload: HabitLogIn, user=Depends(get_current_user)):
    uid = str(user["_id"])
    habit = await db.habits.find_one({"_id": ObjectId(habit_id), "user_id": uid})
    if not habit:
        raise HTTPException(404, "Habit not found")
    d = payload.date or _today_str()
    key = {"user_id": uid, "habit_id": habit_id, "date": d}
    if habit.get("type") == "count":
        await db.habit_logs.update_one(key, {"$set": {"value": payload.value or 0}}, upsert=True)
    else:
        existing = await db.habit_logs.find_one(key)
        new_val = not (existing and existing.get("completed"))
        await db.habit_logs.update_one(key, {"$set": {"completed": new_val}}, upsert=True)
    return {"ok": True}


# ── SLEEP ─────────────────────────────────────────────────────────────────────
@api.get("/sleep")
async def list_sleep(user=Depends(get_current_user)):
    """Recent nights + summary stats (avg hours, avg quality, last night)."""
    uid = str(user["_id"])
    docs = await db.sleep_logs.find({"user_id": uid}).sort("date", -1).to_list(60)
    for d in docs:
        d["id"] = str(d.pop("_id"))
    recent = docs[:7]
    hours = [d["hours"] for d in recent if d.get("hours")]
    quals = [d["quality"] for d in recent if d.get("quality")]
    stats = {
        "avg_hours": round(sum(hours) / len(hours), 1) if hours else None,
        "avg_quality": round(sum(quals) / len(quals), 1) if quals else None,
        "last_hours": docs[0]["hours"] if docs else None,
        "nights_logged": len(docs),
    }
    return {"logs": docs, "stats": stats}


@api.post("/sleep")
async def log_sleep(payload: SleepLogIn, user=Depends(get_current_user)):
    uid = str(user["_id"])
    d = payload.date or _today_str()
    doc = {
        "user_id": uid, "date": d, "hours": payload.hours,
        "quality": payload.quality, "bedtime": payload.bedtime, "wake_time": payload.wake_time,
    }
    await db.sleep_logs.update_one({"user_id": uid, "date": d}, {"$set": doc}, upsert=True)
    saved = await db.sleep_logs.find_one({"user_id": uid, "date": d})
    saved["id"] = str(saved.pop("_id"))
    return saved


@api.delete("/sleep/{sleep_id}")
async def delete_sleep(sleep_id: str, user=Depends(get_current_user)):
    await db.sleep_logs.delete_one({"_id": ObjectId(sleep_id), "user_id": str(user["_id"])})
    return {"ok": True}


# ── HEALTH SYNC (brand-agnostic ingest for watch / phone health data) ──────────
async def _get_health_token(user: Dict[str, Any]) -> str:
    """Return the user's sync token, creating one on first use."""
    token = user.get("health_token")
    if not token:
        token = secrets.token_urlsafe(24)
        await db.users.update_one({"_id": user["_id"]}, {"$set": {"health_token": token}})
    return token


@api.get("/health/connection")
async def health_connection(user=Depends(get_current_user)):
    """Sync token + ingest URL for the Connections page."""
    token = await _get_health_token(user)
    return {"token": token, "ingest_path": "/api/health/ingest"}


@api.post("/health/connection/regenerate")
async def regenerate_health_token(user=Depends(get_current_user)):
    token = secrets.token_urlsafe(24)
    await db.users.update_one({"_id": user["_id"]}, {"$set": {"health_token": token}})
    return {"token": token}


@api.post("/health/ingest")
async def health_ingest(payload: HealthIngestIn, request: Request):
    """Token-authenticated ingest — called by a phone automation, NOT the browser.
    Auth via `X-Health-Token` header or `Authorization: Bearer <token>`."""
    token = request.headers.get("X-Health-Token", "")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(401, "Missing health sync token")
    user = await db.users.find_one({"health_token": token})
    if not user:
        raise HTTPException(401, "Invalid health sync token")

    uid = str(user["_id"])
    d = payload.date or _today_str()

    # Daily activity/health metrics → health_daily (upsert per day)
    daily = {}
    for f in HEALTH_DAILY_FIELDS:
        v = getattr(payload, f)
        if v is not None:
            daily[f] = v
    if daily:
        daily["synced_at"] = datetime.now(timezone.utc).isoformat()
        await db.health_daily.update_one(
            {"user_id": uid, "date": d}, {"$set": daily}, upsert=True,
        )

    # Sleep → reuse sleep_logs (one night per date)
    if payload.sleep_hours is not None:
        await db.sleep_logs.update_one(
            {"user_id": uid, "date": d},
            {"$set": {"user_id": uid, "date": d, "hours": payload.sleep_hours,
                      "quality": payload.sleep_quality, "source": "sync"}},
            upsert=True,
        )

    return {"ok": True, "date": d, "stored": list(daily.keys()) + (["sleep"] if payload.sleep_hours is not None else [])}


@api.get("/health/daily")
async def health_daily(user=Depends(get_current_user)):
    """Recent synced daily metrics (steps / resting HR / energy) + today's snapshot."""
    uid = str(user["_id"])
    docs = await db.health_daily.find({"user_id": uid}).sort("date", -1).to_list(30)
    for d in docs:
        d.pop("_id", None)
    today = next((x for x in docs if x["date"] == _today_str()), None)
    return {"days": docs, "today": today, "connected": bool(docs)}


# ── WORKOUT SESSIONS ──────────────────────────────────────────────────────────
@api.post("/workouts")
async def create_workout(payload: WorkoutSessionIn, user=Depends(get_current_user)):
    """Record a completed workout session."""
    # Compute aggregate stats from sets
    total_sets = 0
    completed_sets = 0
    total_volume = 0.0
    for ex in payload.exercises:
        for s in ex.sets:
            total_sets += 1
            if s.completed:
                completed_sets += 1
                if s.kg and s.reps:
                    total_volume += s.kg * s.reps

    # Store e1rm on every set at write time (Epley) — cheap, avoids recomputation.
    exercises_out = []
    for ex in payload.exercises:
        ex_d = ex.model_dump()
        for s in ex_d["sets"]:
            s["e1rm"] = _epley(s.get("kg") or 0, s.get("reps") or 0) if s.get("completed") else 0
        exercises_out.append(ex_d)

    doc = {
        "user_id": str(user["_id"]),
        "name": payload.name,
        "routine_id": payload.routine_id,
        "plan_id": payload.plan_id,
        "day_index": payload.day_index,
        "duration_seconds": payload.duration_seconds,
        "description": payload.description,
        "exercises": exercises_out,
        "total_sets": total_sets,
        "completed_sets": completed_sets,
        "total_volume_kg": round(total_volume, 1),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    res = await db.workout_sessions.insert_one(doc)
    doc["id"] = str(res.inserted_id)
    doc.pop("_id", None)

    # PRs + progression state (best-effort — never block the save)
    try:
        doc["pr_events"] = await _update_prs_and_progression(str(user["_id"]), exercises_out)
    except Exception:
        logger.exception("PR/progression update failed")
        doc["pr_events"] = []

    # If this workout came from a plan day, stamp it done and advance "next up".
    if payload.plan_id and payload.day_index is not None:
        try:
            plan = await db.plans.find_one(
                {"_id": ObjectId(payload.plan_id), "user_id": str(user["_id"])}
            )
            if plan:
                days = plan.get("days", [])
                if 0 <= payload.day_index < len(days):
                    days[payload.day_index]["last_completed_at"] = datetime.now(timezone.utc).isoformat()
                    await db.plans.update_one(
                        {"_id": plan["_id"]},
                        {"$set": {"days": days, "next_day_index": (payload.day_index + 1) % len(days)}},
                    )
        except Exception:
            pass  # plan tracking is best-effort; never block the save

    return doc


@api.get("/workouts")
async def list_workouts(user=Depends(get_current_user)):
    docs = await db.workout_sessions.find(
        {"user_id": str(user["_id"])}
    ).sort("created_at", -1).to_list(200)

    # Enrich every exercise with its name + image_url
    all_ids = set()
    for d in docs:
        for ex in d.get("exercises", []):
            if ex.get("exercise_id"):
                all_ids.add(ex["exercise_id"])
    by_id: Dict[str, Dict[str, Any]] = {}
    if all_ids:
        object_ids = []
        for eid in all_ids:
            try: object_ids.append(ObjectId(eid))
            except Exception: continue
        async for ref in db.exercises.find({"_id": {"$in": object_ids}}):
            by_id[str(ref["_id"])] = ref

    for d in docs:
        d["id"] = str(d.pop("_id"))
        for ex in d.get("exercises", []):
            ref = by_id.get(ex.get("exercise_id"))
            if ref:
                ex["name"] = ref.get("name")
                ex["image_url"] = ref.get("image_url")
                ex["muscle_group"] = ref.get("muscle_group")
    return docs


@api.get("/workouts/stats")
async def workout_stats(user=Depends(get_current_user)):
    """Cross-session aggregates for the Progress page."""
    pipeline = [
        {"$match": {"user_id": str(user["_id"])}},
        {"$group": {
            "_id": None,
            "total_workouts": {"$sum": 1},
            "total_volume": {"$sum": "$total_volume_kg"},
            "total_sets": {"$sum": "$completed_sets"},
            "total_duration": {"$sum": "$duration_seconds"},
        }},
    ]
    out = await db.workout_sessions.aggregate(pipeline).to_list(1)
    if not out:
        return {"total_workouts": 0, "total_volume": 0, "total_sets": 0, "total_duration": 0}
    s = out[0]
    return {
        "total_workouts": s["total_workouts"],
        "total_volume": round(s["total_volume"] or 0, 1),
        "total_sets": s["total_sets"],
        "total_duration": s["total_duration"],
    }


@api.put("/workouts/{workout_id}")
async def update_workout(workout_id: str, payload: WorkoutSessionIn, user=Depends(get_current_user)):
    """Edit a previously saved workout — fix weights/reps, add sets, or add/remove
    exercises. Recomputes aggregate stats; keeps the original date."""
    try: oid = ObjectId(workout_id)
    except Exception: raise HTTPException(404, "Workout not found")
    existing = await db.workout_sessions.find_one({"_id": oid, "user_id": str(user["_id"])})
    if not existing:
        raise HTTPException(404, "Workout not found")

    total_sets = 0
    completed_sets = 0
    total_volume = 0.0
    for ex in payload.exercises:
        for s in ex.sets:
            total_sets += 1
            if s.completed:
                completed_sets += 1
                if s.kg and s.reps:
                    total_volume += s.kg * s.reps

    exercises_out = []
    for ex in payload.exercises:
        ex_d = ex.model_dump()
        for s in ex_d["sets"]:
            s["e1rm"] = _epley(s.get("kg") or 0, s.get("reps") or 0) if s.get("completed") else 0
        exercises_out.append(ex_d)

    update = {
        "name": payload.name,
        "description": payload.description,
        "duration_seconds": payload.duration_seconds or existing.get("duration_seconds", 0),
        "exercises": exercises_out,
        "total_sets": total_sets,
        "completed_sets": completed_sets,
        "total_volume_kg": round(total_volume, 1),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.workout_sessions.update_one({"_id": oid}, {"$set": update})
    # Editing changes the sets PRs were derived from — replay so a lowered weight
    # can't leave the old PR standing (exercises removed by the edit need it too).
    touched = [e.get("exercise_id") for e in exercises_out]
    touched += [e.get("exercise_id") for e in existing.get("exercises", [])]
    await _rebuild_exercise_state(str(user["_id"]), touched)
    doc = await db.workout_sessions.find_one({"_id": oid})
    doc["id"] = str(doc.pop("_id"))
    doc.pop("user_id", None)
    return doc


@api.delete("/workouts/{workout_id}")
async def delete_workout(workout_id: str, user=Depends(get_current_user)):
    try: oid = ObjectId(workout_id)
    except Exception: raise HTTPException(404, "Workout not found")
    uid = str(user["_id"])
    doomed = await db.workout_sessions.find_one({"_id": oid, "user_id": uid})
    if not doomed:
        raise HTTPException(404, "Workout not found")
    await db.workout_sessions.delete_one({"_id": oid, "user_id": uid})
    # Drop the PRs/progression this session produced, then replay what's left.
    await _rebuild_exercise_state(uid, [e.get("exercise_id") for e in doomed.get("exercises", [])])
    return {"ok": True}


@api.get("/exercises/{exercise_id}/previous")
async def exercise_previous_session(exercise_id: str, mode: str = "default", user=Depends(get_current_user)):
    """Last completed sets for this exercise — used to populate the 'Previous' column.
    mode: default (per set index) | last_set (repeat final set) | best_set (repeat best set)."""
    doc = await db.workout_sessions.find_one(
        {"user_id": str(user["_id"]), "exercises.exercise_id": exercise_id},
        sort=[("created_at", -1)],
    )
    if not doc:
        return {"sets": []}
    for ex in doc.get("exercises", []):
        if ex.get("exercise_id") == exercise_id:
            sets = [s for s in ex.get("sets", []) if s.get("completed")]
            if sets and mode == "last_set":
                sets = [sets[-1]] * len(sets)
            elif sets and mode == "best_set":
                best = max(sets, key=lambda s: ((s.get("kg") or 0) * (s.get("reps") or 0), s.get("duration_seconds") or 0))
                sets = [best] * len(sets)
            return {"sets": sets}
    return {"sets": []}


# ── WORKOUT SETTINGS ──────────────────────────────────────────────────────────
@api.get("/workout-settings")
async def get_workout_settings(user=Depends(get_current_user)):
    return {**DEFAULT_WORKOUT_SETTINGS, **(user.get("workout_settings") or {})}


@api.put("/workout-settings")
async def update_workout_settings(payload: WorkoutSettingsIn, user=Depends(get_current_user)):
    merged = {**DEFAULT_WORKOUT_SETTINGS, **(user.get("workout_settings") or {})}
    for k, v in payload.model_dump().items():
        if v is not None:
            merged[k] = v
    await db.users.update_one({"_id": user["_id"]}, {"$set": {"workout_settings": merged}})
    return merged


# ── WEB PUSH (background train reminders) ─────────────────────────────────────
# useTrainReminder.js only fires while a tab is open. These endpoints let the
# service worker be notified with the app CLOSED. Degrades gracefully: with no
# VAPID keys set, /push/config reports unconfigured and the UI keeps the in-app
# reminder instead of offering a broken toggle.
class PushSubscriptionIn(BaseModel):
    endpoint: str
    keys: Dict[str, str] = {}
    model_config = {"extra": "ignore"}


# How long after the set time a reminder may still fire. Matches the frontend's
# GRACE_MINUTES so the in-app and background reminders behave identically.
PUSH_GRACE_MINUTES = 120


def push_configured() -> bool:
    return bool(os.environ.get("VAPID_PRIVATE_KEY") and os.environ.get("VAPID_PUBLIC_KEY"))


@api.get("/push/config")
async def push_config():
    return {"configured": push_configured(), "public_key": os.environ.get("VAPID_PUBLIC_KEY", "")}


@api.post("/push/subscribe")
async def push_subscribe(payload: PushSubscriptionIn, user=Depends(get_current_user)):
    await db.push_subscriptions.update_one(
        {"endpoint": payload.endpoint},
        {"$set": {"user_id": str(user["_id"]), "endpoint": payload.endpoint,
                  "keys": payload.keys, "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return {"ok": True}


@api.post("/push/unsubscribe")
async def push_unsubscribe(payload: PushSubscriptionIn, user=Depends(get_current_user)):
    res = await db.push_subscriptions.delete_many(
        {"endpoint": payload.endpoint, "user_id": str(user["_id"])}
    )
    return {"ok": True, "removed": res.deleted_count}


@api.post("/push/dispatch")
async def push_dispatch(request: Request):
    """Send train reminders that are due. Called by an EXTERNAL scheduler (cron-job.org,
    GitHub Actions, …) with the PUSH_DISPATCH_SECRET — the free Render tier sleeps, so
    the app cannot reliably wake itself. Idempotent per user per day."""
    secret = os.environ.get("PUSH_DISPATCH_SECRET", "")
    if not secret or request.headers.get("X-Dispatch-Secret") != secret:
        raise HTTPException(401, "Bad dispatch secret")
    if not push_configured():
        return {"ok": False, "reason": "VAPID keys not configured", "sent": 0}
    try:
        from pywebpush import webpush, WebPushException
    except ImportError:
        return {"ok": False, "reason": "pywebpush not installed", "sent": 0}

    now = datetime.now(timezone.utc)
    today = now.date().isoformat()
    sent = 0
    dropped = 0
    async for u in db.users.find({"workout_settings.train_reminder_enabled": True}):
        st = u.get("workout_settings") or {}
        when = st.get("train_reminder_time") or ""
        # Reminder times are the user's local wall clock; offset is stored at subscribe time.
        offset_min = int(st.get("tz_offset_minutes") or 0)
        local_now = now + timedelta(minutes=offset_min)
        try:
            hh, mm = (int(x) for x in when.split(":"))
        except (ValueError, AttributeError):
            continue
        # Fire only in a window after the set time. If the cron was down, or the user
        # enabled the reminder late in the day, a stale "time to train" hours after the
        # fact is worse than none — skip and catch them tomorrow.
        late_min = (local_now.hour * 60 + local_now.minute) - (hh * 60 + mm)
        if late_min < 0 or late_min > PUSH_GRACE_MINUTES:
            continue
        if st.get("last_push_date") == today:
            continue  # already reminded today
        subs = await db.push_subscriptions.find({"user_id": str(u["_id"])}).to_list(10)
        if not subs:
            continue
        body = "Your next session is ready."
        plan = await db.plans.find_one({"user_id": str(u["_id"])})
        if plan and plan.get("days"):
            # Same rule the NEXT UP card uses: the day rested longest.
            nxt = min(plan["days"], key=lambda d: d.get("last_completed_at") or "")
            body = f"{nxt.get('name')} is next in your rotation."
        for sub in subs:
            try:
                webpush(
                    subscription_info={"endpoint": sub["endpoint"], "keys": sub.get("keys", {})},
                    data=json.dumps({"title": "Time to train 🏋️", "body": body, "url": "/workout"}),
                    vapid_private_key=os.environ["VAPID_PRIVATE_KEY"],
                    vapid_claims={"sub": f"mailto:{os.environ.get('ADMIN_EMAIL', 'admin@lifeos.app')}"},
                )
                sent += 1
            except WebPushException:
                # 404/410 = the browser dropped the subscription; stop retrying it.
                await db.push_subscriptions.delete_one({"endpoint": sub["endpoint"]})
                dropped += 1
            except Exception:
                # A corrupt stored key raises ValueError deep in the crypto layer.
                # This loop serves EVERY user, so one bad row must not abort the run
                # and cost everyone else their reminder — drop it and keep going.
                logger.warning("push: dropping unusable subscription %s", sub.get("endpoint", "")[:60])
                await db.push_subscriptions.delete_one({"endpoint": sub["endpoint"]})
                dropped += 1
        await db.users.update_one({"_id": u["_id"]}, {"$set": {"workout_settings.last_push_date": today}})
    return {"ok": True, "sent": sent, "dropped": dropped}


# ──────────────────────────────────────────────────────────────────────────────
# INTELLIGENCE LAYER — PRs, e1RM, progression, volume landmarks, substitutes
# ──────────────────────────────────────────────────────────────────────────────
def _epley(kg: float, reps: int) -> float:
    """Estimated 1RM via Epley: weight * (1 + reps/30)."""
    if not kg or not reps:
        return 0.0
    return round(kg * (1 + reps / 30.0), 1)


def _movement_pattern(name: str, muscle_group: str) -> str:
    n = (name or "").lower()
    if any(k in n for k in ("squat", "lunge", "leg press", "leg extension", "step up")):
        return "squat"
    if any(k in n for k in ("deadlift", "leg curl", "glute", "hip thrust", "good morning", "pull through", "hyperextension")):
        return "hinge"
    if muscle_group == "back" or any(k in n for k in ("row", "pull up", "pulldown", "pullup", "chin", "face pull", "shrug")):
        return "pull"
    if muscle_group in ("chest", "shoulders", "triceps") or any(k in n for k in ("press", "push", "dip", "fly", "crossover", "pushdown", "extension", "raise")):
        return "push"
    return "isolation"


MAJOR_LIFTS = {
    "Barbell Bench Press": "bench",
    "Back Squat": "squat",
    "Deadlift": "deadlift",
    "Overhead Press": "ohp",
}

# Bodyweight multiples: [novice, intermediate, advanced, elite] — published strength standards.
STRENGTH_STANDARDS = {
    "bench": {"male": [0.75, 1.0, 1.5, 2.0], "female": [0.5, 0.75, 1.0, 1.4]},
    "squat": {"male": [1.0, 1.25, 1.75, 2.5], "female": [0.75, 1.0, 1.5, 2.0]},
    "deadlift": {"male": [1.25, 1.5, 2.0, 2.75], "female": [1.0, 1.25, 1.75, 2.25]},
    "ohp": {"male": [0.5, 0.75, 1.0, 1.4], "female": [0.35, 0.5, 0.75, 1.0]},
}

# Weekly hard-set volume landmarks per muscle group (published MEV/MAV/MRV ranges).
VOLUME_LANDMARKS = {
    "chest": {"mev": 8, "mav": 16, "mrv": 22},
    "back": {"mev": 10, "mav": 18, "mrv": 25},
    "shoulders": {"mev": 8, "mav": 18, "mrv": 26},
    "biceps": {"mev": 6, "mav": 14, "mrv": 20},
    "triceps": {"mev": 6, "mav": 14, "mrv": 18},
    "quads": {"mev": 8, "mav": 15, "mrv": 20},
    "hamstrings": {"mev": 6, "mav": 12, "mrv": 16},
    "glutes": {"mev": 6, "mav": 12, "mrv": 16},
    "calves": {"mev": 6, "mav": 12, "mrv": 16},
    "core": {"mev": 6, "mav": 15, "mrv": 20},
    "forearms": {"mev": 4, "mav": 10, "mrv": 14},
    "traps": {"mev": 4, "mav": 10, "mrv": 14},
    "lower back": {"mev": 4, "mav": 8, "mrv": 12},
}
DEFAULT_LANDMARK = {"mev": 8, "mav": 14, "mrv": 20}

PR_LABELS = {
    "weight": "Heaviest weight",
    "reps": "Most reps",
    "volume": "Best set volume",
    "e1rm": "Best estimated 1RM",
    "duration": "Longest duration",
    "distance": "Longest distance",
    "pace": "Best pace (km/h)",
}


async def _update_prs_and_progression(
    user_id: str, exercises: List[Dict[str, Any]], at: Optional[str] = None
) -> List[Dict[str, Any]]:
    """After a session save: recompute PRs + progression state per exercise.
    Returns the list of new PR events (for the save response toast).

    `at` stamps the resulting records with a specific time instead of "now" —
    used by _rebuild_exercise_state when replaying past sessions."""
    now = at or datetime.now(timezone.utc).isoformat()
    pr_events: List[Dict[str, Any]] = []

    # name lookup for events
    ex_ids = [e["exercise_id"] for e in exercises if e.get("exercise_id")]
    names: Dict[str, str] = {}
    oids = []
    for eid in set(ex_ids):
        try:
            oids.append(ObjectId(eid))
        except Exception:
            continue
    async for ref in db.exercises.find({"_id": {"$in": oids}}, {"name": 1}):
        names[str(ref["_id"])] = ref.get("name", "")

    for ex in exercises:
        eid = ex.get("exercise_id")
        done = [s for s in ex.get("sets", []) if s.get("completed") and s.get("set_type") != "warmup"]
        if not eid or not done:
            continue

        # ── session bests ────────────────────────────────────────────────────
        bests = {
            "weight": max((s.get("kg") or 0 for s in done), default=0),
            "reps": max((s.get("reps") or 0 for s in done), default=0),
            "volume": max(((s.get("kg") or 0) * (s.get("reps") or 0) for s in done), default=0),
            "e1rm": max((s.get("e1rm") or 0 for s in done), default=0),
            "duration": max((s.get("duration_seconds") or 0 for s in done), default=0),
            "distance": max((s.get("distance_m") or 0 for s in done), default=0),
            # pace as km/h (higher = better, so it fits the same "beat the stored value" compare)
            "pace": max((
                round(((s.get("distance_m") or 0) / 1000) / ((s.get("duration_seconds") or 0) / 3600), 2)
                for s in done if s.get("distance_m") and s.get("duration_seconds")
            ), default=0),
        }

        pr_doc = await db.personal_records.find_one({"user_id": user_id, "exercise_id": eid})
        records = (pr_doc or {}).get("records", {})
        changed = False
        for pr_type, val in bests.items():
            if val and val > (records.get(pr_type, {}).get("value") or 0):
                prev = records.get(pr_type, {}).get("value")
                records[pr_type] = {"value": val, "date": now}
                changed = True
                pr_events.append({
                    "user_id": user_id, "exercise_id": eid,
                    "exercise_name": names.get(eid, ""),
                    "pr_type": pr_type, "label": PR_LABELS[pr_type],
                    "value": val, "prev_value": prev, "created_at": now,
                })
        if changed:
            await db.personal_records.update_one(
                {"user_id": user_id, "exercise_id": eid},
                {"$set": {"records": records, "updated_at": now}},
                upsert=True,
            )

        # ── progression state (auto-regulated overload) ──────────────────────
        top = max(done, key=lambda s: (s.get("e1rm") or 0, s.get("kg") or 0))
        top_kg = top.get("kg") or 0
        top_reps = top.get("reps") or 0
        top_rpe = top.get("rpe")
        top_e1rm = top.get("e1rm") or 0

        state = await db.progression_states.find_one({"user_id": user_id, "exercise_id": eid}) or {}
        hist = (state.get("e1rm_history") or [])[-4:] + ([top_e1rm] if top_e1rm else [])
        prev_kg = state.get("last_weight") or 0

        high_rpe = top_rpe is not None and top_rpe >= 9
        no_progress = top_kg <= prev_kg and top_e1rm <= (state.get("last_e1rm") or 0)
        consec = (state.get("consecutive_high_rpe") or 0) + 1 if (high_rpe and no_progress) else (1 if high_rpe else 0)
        deload = consec >= 2

        # plateau: e1rm hasn't increased over last 3 sessions (±1% noise tolerance)
        plateau = False
        if len(hist) >= 3:
            recent = hist[-3:]
            plateau = max(recent[1:]) <= recent[0] * 1.01

        # Routine's target rep range drives the decision (default 8 when untracked)
        tgt = ex.get("target_reps") or 8
        if deload:
            trend, suggested = "deload", top_kg
        elif top_rpe is not None and top_rpe <= 7 and top_reps >= tgt:
            trend, suggested = "increase", top_kg + 2.5
        elif top_rpe is None and top_reps >= tgt + 2:
            trend, suggested = "increase", top_kg + 2.5
        elif high_rpe or top_reps < max(1, tgt - 2):
            trend, suggested = "hold", top_kg
        else:
            trend, suggested = "hold", top_kg

        await db.progression_states.update_one(
            {"user_id": user_id, "exercise_id": eid},
            {"$set": {
                "last_weight": top_kg, "last_reps": top_reps, "last_rpe": top_rpe,
                "last_e1rm": top_e1rm, "e1rm_history": hist,
                "consecutive_high_rpe": consec, "trend": trend,
                "suggested_kg": suggested, "target_reps": tgt, "deload_flag": deload,
                "plateau": plateau, "updated_at": now,
            }},
            upsert=True,
        )

    if pr_events:
        await db.pr_events.insert_many([dict(e) for e in pr_events])
        for e in pr_events:
            e.pop("_id", None)
    return pr_events


async def _rebuild_exercise_state(user_id: str, exercise_ids: List[str]) -> None:
    """Rebuild PRs + progression for these exercises by replaying surviving sessions.

    _update_prs_and_progression is incremental — each save folds into the state left
    by the one before it. So when a session is deleted or edited down, the PR and the
    e1rm history it produced cannot be undone in place: they would outlive the sets
    they came from (delete a mis-typed 300 kg session and the 300 kg PR sticks, and
    progression keeps prescribing it). Replaying the remaining sessions in order is
    what keeps derived state honest."""
    ids = [e for e in dict.fromkeys(exercise_ids) if e]
    if not ids:
        return

    await db.personal_records.delete_many({"user_id": user_id, "exercise_id": {"$in": ids}})
    await db.progression_states.delete_many({"user_id": user_id, "exercise_id": {"$in": ids}})
    await db.pr_events.delete_many({"user_id": user_id, "exercise_id": {"$in": ids}})

    cursor = db.workout_sessions.find(
        {"user_id": user_id, "exercises.exercise_id": {"$in": ids}}
    ).sort("created_at", 1)
    async for session in cursor:
        relevant = [e for e in session.get("exercises", []) if e.get("exercise_id") in ids]
        if relevant:
            await _update_prs_and_progression(user_id, relevant, at=session.get("created_at"))


@api.get("/progression")
async def get_progression(user=Depends(get_current_user)):
    """Per-exercise progression state map: {exercise_id: {suggested_kg, trend, deload_flag, plateau, ...}}"""
    docs = await db.progression_states.find({"user_id": str(user["_id"])}).to_list(500)
    out = {}
    for d in docs:
        d.pop("_id", None)
        d.pop("user_id", None)
        out[d.pop("exercise_id")] = d
    return out


@api.get("/exercises/{exercise_id}/records")
async def exercise_records(exercise_id: str, user=Depends(get_current_user)):
    doc = await db.personal_records.find_one({"user_id": str(user["_id"]), "exercise_id": exercise_id})
    return {"records": (doc or {}).get("records", {}), "labels": PR_LABELS}


@api.get("/records")
async def all_records(user=Depends(get_current_user)):
    """Every exercise's personal records for the PR trophy shelf, with names + headline PR."""
    docs = await db.personal_records.find({"user_id": str(user["_id"])}).to_list(500)
    oids = []
    for d in docs:
        try: oids.append(ObjectId(d["exercise_id"]))
        except Exception: pass
    names = {}
    async for ex in db.exercises.find({"_id": {"$in": oids}}, {"name": 1, "muscle_group": 1}):
        names[str(ex["_id"])] = {"name": ex.get("name", ""), "muscle_group": ex.get("muscle_group", "")}
    out = []
    for d in docs:
        recs = d.get("records", {})
        meta = names.get(d["exercise_id"], {})
        # headline = heaviest weight if present, else best e1rm
        headline = recs.get("weight") or recs.get("e1rm")
        out.append({
            "exercise_id": d["exercise_id"],
            "exercise_name": meta.get("name", "Exercise"),
            "muscle_group": meta.get("muscle_group", ""),
            "records": recs,
            "headline_value": (headline or {}).get("value"),
            "headline_unit": "kg",
        })
    out = [r for r in out if r["headline_value"]]
    out.sort(key=lambda r: r["headline_value"], reverse=True)
    return {"records": out, "labels": PR_LABELS}


@api.get("/exercises/{exercise_id}/history")
async def exercise_history(exercise_id: str, user=Depends(get_current_user)):
    """Every logged instance of this exercise, newest first, with per-session bests."""
    docs = await db.workout_sessions.find(
        {"user_id": str(user["_id"]), "exercises.exercise_id": exercise_id}
    ).sort("created_at", -1).to_list(200)
    out = []
    for d in docs:
        for ex in d.get("exercises", []):
            if ex.get("exercise_id") != exercise_id:
                continue
            done = [s for s in ex.get("sets", []) if s.get("completed")]
            working = [s for s in done if s.get("set_type") != "warmup"]
            out.append({
                "session_id": str(d["_id"]),
                "session_name": d.get("name"),
                "date": d.get("created_at"),
                "sets": done,
                "best_weight": max((s.get("kg") or 0 for s in working), default=0),
                "best_e1rm": max((s.get("e1rm") or _epley(s.get("kg") or 0, s.get("reps") or 0) for s in working), default=0),
                "total_volume": round(sum((s.get("kg") or 0) * (s.get("reps") or 0) for s in working), 1),
                "total_duration": sum(s.get("duration_seconds") or 0 for s in done),
            })
    return out


@api.get("/exercises/{exercise_id}/substitutes")
async def exercise_substitutes(exercise_id: str, user=Depends(get_current_user)):
    """Same primary muscle + comparable movement pattern — static lookup, no AI."""
    try:
        ex = await db.exercises.find_one({"_id": ObjectId(exercise_id)})
    except Exception:
        raise HTTPException(404, "Exercise not found")
    if not ex:
        raise HTTPException(404, "Exercise not found")
    pattern = _movement_pattern(ex.get("name", ""), ex.get("muscle_group", ""))
    candidates = await db.exercises.find({"muscle_group": ex.get("muscle_group"), "_id": {"$ne": ex["_id"]}}).to_list(100)
    subs = []
    for c in candidates:
        c_pat = _movement_pattern(c.get("name", ""), c.get("muscle_group", ""))
        c["id"] = str(c.pop("_id"))
        c["movement_pattern"] = c_pat
        if c_pat == pattern:
            subs.append(c)
    # fallback: same muscle group if no pattern match
    if not subs:
        subs = candidates
        for c in subs:
            if "_id" in c:
                c["id"] = str(c.pop("_id"))
    return {"movement_pattern": pattern, "substitutes": subs[:8]}


@api.get("/workouts/muscle-volume")
async def muscle_volume(user=Depends(get_current_user)):
    """Weekly hard sets (RPE≥6 or no RPE, excl. warmups) per muscle group vs MEV/MAV/MRV."""
    since = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    docs = await db.workout_sessions.find(
        {"user_id": str(user["_id"]), "created_at": {"$gte": since}}
    ).to_list(100)

    ex_ids = set()
    for d in docs:
        for ex in d.get("exercises", []):
            if ex.get("exercise_id"):
                ex_ids.add(ex["exercise_id"])
    muscle_by_id: Dict[str, str] = {}
    oids = []
    for eid in ex_ids:
        try:
            oids.append(ObjectId(eid))
        except Exception:
            continue
    async for ref in db.exercises.find({"_id": {"$in": oids}}, {"muscle_group": 1}):
        muscle_by_id[str(ref["_id"])] = ref.get("muscle_group", "other")

    counts: Dict[str, int] = {}
    last_trained: Dict[str, str] = {}
    for d in docs:
        created = d.get("created_at", "")
        for ex in d.get("exercises", []):
            mg = muscle_by_id.get(ex.get("exercise_id"), "other")
            for s in ex.get("sets", []):
                if not s.get("completed") or s.get("set_type") == "warmup":
                    continue
                rpe = s.get("rpe")
                if rpe is not None and rpe < 6:
                    continue
                counts[mg] = counts.get(mg, 0) + 1
                if created > last_trained.get(mg, ""):
                    last_trained[mg] = created

    now = datetime.now(timezone.utc)
    out = []
    for mg, n in sorted(counts.items(), key=lambda x: -x[1]):
        lm = VOLUME_LANDMARKS.get(mg, DEFAULT_LANDMARK)
        zone = "under" if n < lm["mev"] else ("optimal" if n <= lm["mav"] else ("high" if n <= lm["mrv"] else "excessive"))
        lt = last_trained.get(mg)
        days = None
        if lt:
            try:
                days = (now - datetime.fromisoformat(lt)).days
            except Exception:
                days = None
        recovery = "fresh" if days is None or days >= 2 else ("worked" if days < 1 else "recovering")
        out.append({"muscle_group": mg, "hard_sets": n, **lm, "zone": zone,
                    "last_trained": lt, "days_since": days, "recovery": recovery})
    return out


@api.get("/strength-standards")
async def strength_standards(user=Depends(get_current_user)):
    """Relative strength (e1RM / bodyweight) for the big lifts, ranked against published standards."""
    profile = user.get("profile", {}) or {}
    bw = profile.get("weight_kg") or 0
    sex = profile.get("sex") or "male"
    uid = str(user["_id"])

    name_to_id: Dict[str, str] = {}
    async for d in db.exercises.find({"name": {"$in": list(MAJOR_LIFTS.keys())}}, {"name": 1}):
        name_to_id[d["name"]] = str(d["_id"])

    out = []
    levels = ["novice", "intermediate", "advanced", "elite"]
    for name, key in MAJOR_LIFTS.items():
        eid = name_to_id.get(name)
        if not eid:
            continue
        pr = await db.personal_records.find_one({"user_id": uid, "exercise_id": eid})
        e1rm = ((pr or {}).get("records", {}).get("e1rm", {}) or {}).get("value") or 0
        ratio = round(e1rm / bw, 2) if (e1rm and bw) else 0
        level = "untrained"
        if ratio:
            thresholds = STRENGTH_STANDARDS[key].get(sex, STRENGTH_STANDARDS[key]["male"])
            for lvl, t in zip(levels, thresholds):
                if ratio >= t:
                    level = lvl
        out.append({
            "lift": name, "exercise_id": eid, "e1rm": e1rm,
            "bodyweight": bw, "ratio": ratio, "level": level,
        })
    return out


# ──────────────────────────────────────────────────────────────────────────────
# Seeding
# ──────────────────────────────────────────────────────────────────────────────
def _seed_signature() -> str:
    """Fingerprint of all seed data — seeding is skipped on boot when unchanged.
    (Re-seeding writes 1400+ docs one by one; over a cross-region Atlas link that
    is minutes of startup time on every wake.)"""
    h = hashlib.md5()
    h.update(repr(EXERCISES).encode())
    h.update(repr(PROGRAMS).encode())
    for fname in ("exercisedb_seed.json", "curated_animations.json"):
        p = ROOT_DIR / fname
        if p.exists():
            h.update(p.read_bytes())
    return h.hexdigest()


async def seed_exercises():
    """Seed exercises and always refresh image_url + image_url_end + instructions on startup."""
    existing = {d["name"]: d async for d in db.exercises.find({}, {"name": 1, "image_url": 1})}
    new_docs = []
    for e in EXERCISES:
        if e["name"] in existing:
            # update image fields + instructions in-place
            await db.exercises.update_one(
                {"name": e["name"]},
                {"$set": {
                    "image_url": e["image_url"],
                    "image_url_end": e["image_url_end"],
                    "instructions": e["instructions"],
                    "muscle_group": e["muscle_group"],
                    "equipment": e["equipment"],
                    "video_url": e.get("video_url"),
                    "secondary_muscles": e.get("secondary_muscles", []),
                }},
            )
        else:
            new_docs.append(e)
    if new_docs:
        await db.exercises.insert_many(new_docs)
        logger.info("Inserted %d new exercises", len(new_docs))
    logger.info("Refreshed images for %d existing exercises", len(existing))


async def seed_exercisedb_library():
    """Import the full ExerciseDB catalog (1,300+ exercises with GymVisual-style
    animated gif demonstrations — the same animation source Hevy uses)."""
    path = ROOT_DIR / "exercisedb_seed.json"
    if not path.exists():
        return
    data = json.loads(path.read_text(encoding="utf-8"))
    anim_by_name = {e["name"].lower(): e["animation_url"] for e in data}
    instr_by_name = {e["name"].lower(): e.get("instructions") or "" for e in data}
    existing = {}
    async for d in db.exercises.find({}, {"name": 1}):
        existing[d["name"].lower()] = d["_id"]
    new_docs, updated = [], 0
    for e in data:
        key = e["name"].lower()
        if key in existing:
            # curated exercise — animation + detailed step-by-step instructions
            await db.exercises.update_one(
                {"_id": existing[key]},
                {"$set": {
                    "animation_url": e["animation_url"], "image_url": e["animation_url"],
                    "image_url_end": None, "instructions": e.get("instructions") or "",
                }},
            )
            updated += 1
        else:
            doc = dict(e)
            doc["image_url"] = e["animation_url"]  # animated thumbnail in lists
            doc["image_url_end"] = None
            doc["video_url"] = None
            new_docs.append(doc)

    # Curated exercises whose names differ from the dataset — hand-verified map.
    map_path = ROOT_DIR / "curated_animations.json"
    if map_path.exists():
        curated_map = json.loads(map_path.read_text(encoding="utf-8"))
        for our_name, edb_name in curated_map.items():
            url = anim_by_name.get(edb_name.lower())
            oid = existing.get(our_name.lower())
            if url and oid:
                update = {"animation_url": url, "image_url": url, "image_url_end": None}
                detailed = instr_by_name.get(edb_name.lower())
                if detailed and "\n" in detailed:
                    update["instructions"] = detailed
                await db.exercises.update_one({"_id": oid}, {"$set": update})
                updated += 1
    if new_docs:
        await db.exercises.insert_many(new_docs)
        logger.info("ExerciseDB library: inserted %d new exercises", len(new_docs))
    logger.info("ExerciseDB library: attached animations to %d curated exercises", updated)


async def seed_programs():
    # Build name->id lookup of exercises
    name_to_id: Dict[str, str] = {}
    async for d in db.exercises.find({}, {"name": 1}):
        name_to_id[d["name"]] = str(d["_id"])

    existing_program_names = {d["name"] async for d in db.programs.find({}, {"name": 1})}

    docs_to_insert = []
    for p in PROGRAMS:
        if p["name"] in existing_program_names:
            continue
        # convert routines: replace exercise names with refs
        routines = []
        for r in p["routines"]:
            ex_refs = []
            for ex_name in r["exercises"]:
                if ex_name in name_to_id:
                    ex_refs.append({"exercise_id": name_to_id[ex_name], "name": ex_name, "sets": 3, "reps": 10})
            routines.append({"name": r["name"], "exercises": ex_refs})
        docs_to_insert.append({
            "name": p["name"],
            "level": p["level"],
            "goal": p["goal"],
            "equipment": p["equipment"],
            "duration_weeks": p["duration_weeks"],
            "description": p["description"],
            "routines": routines,
        })
    if docs_to_insert:
        await db.programs.insert_many(docs_to_insert)
        logger.info("Seeded %d programs", len(docs_to_insert))


async def backfill_intelligence():
    """One-time: replay historical sessions through the PR/progression engine
    and stamp e1rm on old sets. Guarded by a marker doc."""
    marker = await db.meta.find_one({"_id": "intelligence_backfill_v1"})
    if marker:
        return
    n = 0
    async for w in db.workout_sessions.find({}).sort("created_at", 1):
        exercises = w.get("exercises", [])
        dirty = False
        for ex in exercises:
            for s in ex.get("sets", []):
                if "e1rm" not in s:
                    s["e1rm"] = _epley(s.get("kg") or 0, s.get("reps") or 0) if s.get("completed") else 0
                    dirty = True
        if dirty:
            await db.workout_sessions.update_one({"_id": w["_id"]}, {"$set": {"exercises": exercises}})
        try:
            await _update_prs_and_progression(w["user_id"], exercises)
            n += 1
        except Exception:
            logger.exception("backfill failed for session %s", w.get("_id"))
    # Backfilled PR events shouldn't fire as "this week's PRs" — clear the event log.
    await db.pr_events.delete_many({})
    await db.meta.insert_one({"_id": "intelligence_backfill_v1", "sessions": n, "at": datetime.now(timezone.utc).isoformat()})
    logger.info("Intelligence backfill complete: %d sessions", n)


async def seed_admin_user():
    email = os.environ.get("ADMIN_EMAIL", "cg3@lifeos.com").lower()
    password = os.environ.get("ADMIN_PASSWORD", "test1234")
    existing = await db.users.find_one({"email": email})
    if existing is None:
        await db.users.insert_one({
            "email": email,
            "password_hash": hash_password(password),
            "name": "Demo User",
            "role": "admin",
            "profile": {"age": 28, "height_cm": 178, "weight_kg": 75, "sex": "male"},
            "created_at": datetime.now(timezone.utc),
        })
        logger.info("Seeded admin user %s", email)
    elif not verify_password(password, existing["password_hash"]):
        await db.users.update_one(
            {"email": email},
            {"$set": {"password_hash": hash_password(password)}},
        )
        logger.info("Updated admin password for %s", email)


@app.on_event("startup")
async def on_startup():
    # Indexes
    await db.users.create_index("email", unique=True)
    await db.routines.create_index([("user_id", 1), ("created_at", -1)])
    await db.plans.create_index([("user_id", 1), ("created_at", -1)])
    await db.body_metrics.create_index([("user_id", 1), ("metric", 1), ("recorded_at", -1)])
    await db.workout_sessions.create_index([("user_id", 1), ("created_at", -1)])
    await db.workout_sessions.create_index([("user_id", 1), ("exercises.exercise_id", 1), ("created_at", -1)])
    await db.personal_records.create_index([("user_id", 1), ("exercise_id", 1)], unique=True)
    await db.progression_states.create_index([("user_id", 1), ("exercise_id", 1)], unique=True)
    await db.exercise_notes.create_index([("user_id", 1), ("exercise_id", 1)], unique=True)
    await db.pr_events.create_index([("user_id", 1), ("created_at", -1)])
    await db.habits.create_index([("user_id", 1), ("created_at", 1)])
    await db.habit_logs.create_index([("user_id", 1), ("habit_id", 1), ("date", 1)], unique=True)
    await db.sleep_logs.create_index([("user_id", 1), ("date", 1)], unique=True)
    await db.health_daily.create_index([("user_id", 1), ("date", 1)], unique=True)
    await db.users.create_index("health_token", sparse=True)
    await db.knowledge.create_index([("title", 1)])
    # Seed — skipped when seed data hasn't changed since the last boot
    sig = _seed_signature()
    marker = await db.meta.find_one({"_id": "seed_signature"})
    if marker and marker.get("sig") == sig:
        logger.info("Seed data unchanged — skipping exercise/program seeding")
    else:
        await seed_exercises()
        await seed_exercisedb_library()
        await seed_programs()
        await db.meta.replace_one({"_id": "seed_signature"}, {"_id": "seed_signature", "sig": sig}, upsert=True)
    await seed_admin_user()
    try:
        await backfill_intelligence()
    except Exception:
        logger.exception("intelligence backfill failed")
    try:
        await ingest_knowledge()  # first run only (no-op if already populated)
    except Exception:
        logger.exception("knowledge ingest failed")


@app.on_event("shutdown")
async def on_shutdown():
    client.close()


# ── Mount + CORS ──────────────────────────────────────────────────────────────
# ──────────────────────────────────────────────────────────────────────────────
# AI COACH — RAG over a web-ingested knowledge base + the user's own logged data
# ──────────────────────────────────────────────────────────────────────────────
class CoachMessageIn(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class CoachChatIn(BaseModel):
    messages: List[CoachMessageIn] = []


# Reputable, scrape-friendly source topics (Wikipedia plain-text extracts).
KNOWLEDGE_TOPICS = [
    "Strength training", "Progressive overload", "Muscle hypertrophy",
    "Physical fitness", "Aerobic exercise", "Weight training",
    "Protein (nutrient)", "Carbohydrate", "Dietary fiber",
    "Basal metabolic rate", "Body mass index", "Exercise",
    "Stretching", "Warming up", "Delayed onset muscle soreness",
    "Overtraining", "Sleep hygiene", "Physical activity",
]

_STOPWORDS = set(
    "a an the of to in on for and or is are be was were it this that with as at by from "
    "how what why when who your you my me i we our can do does should would could will "
    "about into more most than then them they their has have had not no yes if but so".split()
)


def _tokenize(s: str) -> List[str]:
    return [t for t in re.findall(r"[a-z0-9]+", (s or "").lower()) if len(t) > 2 and t not in _STOPWORDS]


def _chunk_text(text: str, words_per_chunk: int = 180) -> List[str]:
    paras = [p.strip() for p in (text or "").split("\n") if p.strip() and not p.strip().startswith("==")]
    chunks: List[str] = []
    cur: List[str] = []
    n = 0
    for p in paras:
        w = p.split()
        if n + len(w) > words_per_chunk and cur:
            chunks.append(" ".join(cur))
            cur, n = [], 0
        cur.extend(w)
        n += len(w)
    if cur:
        chunks.append(" ".join(cur))
    return chunks


async def ingest_knowledge(force: bool = False) -> Dict[str, Any]:
    """Fetch fitness/nutrition articles from the web and store chunks in Mongo."""
    import httpx
    existing = await db.knowledge.count_documents({})
    if existing and not force:
        return {"skipped": True, "existing": existing}
    if force:
        await db.knowledge.delete_many({})

    docs: List[Dict[str, Any]] = []
    ua = "LifeOS-Coach/1.0 (https://github.com/lifeos; coach@lifeos.local) httpx"
    # Fetch one title per request — a single extracts query with many titles only
    # returns full text for a couple of pages, so we page through them individually.
    async with httpx.AsyncClient(timeout=20, headers={"User-Agent": ua}, follow_redirects=True) as http:
        for title in KNOWLEDGE_TOPICS:
            try:
                r = await http.get("https://en.wikipedia.org/w/api.php", params={
                    "action": "query", "prop": "extracts", "explaintext": 1,
                    "redirects": 1, "format": "json", "titles": title,
                })
                pages = r.json().get("query", {}).get("pages", {})
            except Exception:
                logger.exception("knowledge fetch failed for %s", title)
                continue
            for p in pages.values():
                got_title = p.get("title") or title
                extract = p.get("extract") or ""
                if not extract:
                    continue
                url = "https://en.wikipedia.org/wiki/" + got_title.replace(" ", "_")
                for ci, chunk in enumerate(_chunk_text(extract)[:8]):
                    docs.append({"title": got_title, "source_url": url, "chunk_index": ci, "text": chunk})
    if docs:
        await db.knowledge.insert_many(docs)
    logger.info("Ingested %d knowledge chunks", len(docs))
    return {"ingested": len(docs), "topics": len(KNOWLEDGE_TOPICS)}


async def retrieve_knowledge(query: str, k: int = 4) -> List[Dict[str, Any]]:
    """Lightweight keyword retrieval over the knowledge base (no embeddings needed)."""
    qset = set(_tokenize(query))
    if not qset:
        return []
    docs = await db.knowledge.find({}).to_list(3000)
    scored = []
    for d in docs:
        counts = Counter(_tokenize(f"{d.get('title','')} {d.get('text','')}"))
        score = sum(counts[t] for t in qset)
        score += 2 * len(qset & set(_tokenize(d.get("title", ""))))  # title match boost
        if score > 0:
            scored.append((score, d))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [d for _, d in scored[:k]]


async def build_user_context(user: Dict[str, Any]) -> str:
    """Compact snapshot of the user's own data to ground the coach's answers."""
    uid = str(user["_id"])
    profile = user.get("profile", {}) or {}
    name = user.get("name", "") or "the user"
    age, h, w, sex = profile.get("age"), profile.get("height_cm"), profile.get("weight_kg"), profile.get("sex")
    lines: List[str] = []
    if w and h:
        bmi = _compute_bmi(w, h)
        bmr = _compute_bmr(w, h, age or 0, sex or "male")
        lines.append(f"Profile: {name}, age {age}, {h} cm, {w} kg, {sex}. BMI {bmi}, BMR {bmr} kcal/day.")
    else:
        lines.append(f"Profile: {name} — body stats (height/weight) not set yet.")

    workouts = await db.workout_sessions.find({"user_id": uid}).sort("created_at", -1).to_list(10)
    if workouts:
        wk = [x for x in workouts if (x.get("created_at", "") or "") >= (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()]
        # The slice above is only the detail window — state the true lifetime total too,
        # or the coach reports "10 workouts" to someone who has logged hundreds.
        lifetime = await db.workout_sessions.count_documents({"user_id": uid})
        lines.append(f"Workouts: {lifetime} logged all-time, {len(wk)} in the last 7 days. Most recent {len(workouts)}:")
        for x in workouts[:5]:
            lines.append(
                f"  - {x.get('name')} on {(x.get('created_at') or '')[:10]}: "
                f"{round(x.get('total_volume_kg', 0) or 0)} kg volume, "
                f"{x.get('completed_sets', 0)}/{x.get('total_sets', 0)} sets, "
                f"{round((x.get('duration_seconds', 0) or 0) / 60)} min"
            )
    else:
        lines.append("Workouts: none logged yet.")

    plans = await db.plans.find({"user_id": uid}).to_list(10)
    for p in plans:
        days = p.get("days", [])
        nxt = days[min(p.get("next_day_index", 0), len(days) - 1)]["name"] if days else "-"
        done = [d["name"] for d in days if d.get("last_completed_at")]
        lines.append(f"Plan '{p.get('name')}': {len(days)} days, next up {nxt}. Recently trained: {', '.join(done) or 'none'}.")

    # ── Intelligence layer snapshot (compact — keep under ~1-2k tokens) ──────
    # PR events last 7 days
    since7 = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    prs = await db.pr_events.find({"user_id": uid, "created_at": {"$gte": since7}}).sort("created_at", -1).to_list(10)
    if prs:
        lines.append("New PRs this week: " + "; ".join(
            f"{p.get('exercise_name')} {p.get('label', p.get('pr_type'))} {p.get('value')}" for p in prs[:6]
        ))

    # Progression flags (deload/plateau) + trends
    states = await db.progression_states.find({"user_id": uid}).to_list(100)
    if states:
        ex_names: Dict[str, str] = {}
        oids = []
        for s in states:
            try:
                oids.append(ObjectId(s["exercise_id"]))
            except Exception:
                continue
        async for ref in db.exercises.find({"_id": {"$in": oids}}, {"name": 1}):
            ex_names[str(ref["_id"])] = ref.get("name", "")
        flagged = [s for s in states if s.get("deload_flag") or s.get("plateau")]
        for s in flagged[:5]:
            nm = ex_names.get(s["exercise_id"], "an exercise")
            flags = []
            if s.get("deload_flag"):
                flags.append("deload recommended")
            if s.get("plateau"):
                flags.append("plateaued (e1RM flat over 3 sessions)")
            lines.append(f"Progression flag — {nm}: {', '.join(flags)}. Last: {s.get('last_weight')}kg x {s.get('last_reps')} @RPE {s.get('last_rpe')}.")

    # Weekly muscle volume vs landmarks
    try:
        vol = await muscle_volume(user)  # reuse endpoint logic
        if vol:
            lines.append("Weekly hard sets per muscle: " + ", ".join(
                f"{v['muscle_group']} {v['hard_sets']} ({v['zone']})" for v in vol[:8]
            ))
    except Exception:
        pass

    # ── Health sync snapshot (steps/HR/HRV/stress from any watch or phone) ────
    try:
        hd = await db.health_daily.find({"user_id": uid}).sort("date", -1).to_list(7)
        if hd:
            def _avg(key):
                vals = [d[key] for d in hd if d.get(key) is not None]
                return round(sum(vals) / len(vals), 1) if vals else None
            parts = []
            for key, lbl, unit in (
                ("steps", "steps", ""), ("distance_km", "distance", " km"),
                ("resting_hr", "resting HR", " bpm"), ("hrv", "HRV", " ms"),
                ("stress", "stress", "/100"), ("spo2", "SpO2", "%"),
                ("active_energy", "active energy", " kcal"),
            ):
                a = _avg(key)
                if a is not None:
                    parts.append(f"{lbl} ~{a}{unit}/day")
            if parts:
                lines.append(f"Health (watch sync, {len(hd)}-day avg): " + ", ".join(parts) + ".")
    except Exception:
        pass

    # Sleep (last week of nights)
    try:
        sl = await db.sleep_logs.find({"user_id": uid}).sort("date", -1).to_list(7)
        hrs = [s["hours"] for s in sl if s.get("hours") is not None]
        if hrs:
            qs = [s["quality"] for s in sl if s.get("quality") is not None]
            q = f", quality ~{round(sum(qs) / len(qs), 1)}/5" if qs else ""
            lines.append(f"Sleep ({len(hrs)} recent nights): avg {round(sum(hrs) / len(hrs), 1)} h/night{q}.")
    except Exception:
        pass

    # Habits — 7-day adherence per habit, so the coach can coach the habits too.
    try:
        habits = await db.habits.find({"user_id": uid}).to_list(50)
        if habits:
            week = [(datetime.now(timezone.utc).date() - timedelta(days=i)).isoformat() for i in range(7)]
            logs = await db.habit_logs.find({"user_id": uid, "date": {"$in": week}}).to_list(500)
            by_habit: Dict[str, List[Dict[str, Any]]] = {}
            for lg in logs:
                by_habit.setdefault(lg.get("habit_id", ""), []).append(lg)
            parts = []
            for h in habits[:8]:
                mine = by_habit.get(str(h["_id"]), [])
                if h.get("type") == "count":
                    tgt = h.get("target") or 0
                    hits = sum(1 for lg in mine if tgt and (lg.get("value") or 0) >= tgt)
                    avg = round(sum(lg.get("value") or 0 for lg in mine) / 7, 1)
                    parts.append(f"{h.get('name')} {hits}/7 days at target (avg {avg} {h.get('unit', '')}".strip() + ")")
                else:
                    parts.append(f"{h.get('name')} {sum(1 for lg in mine if lg.get('completed'))}/7 days")
            lines.append("Habits (last 7 days): " + "; ".join(parts) + ".")
    except Exception:
        pass

    return "\n".join(lines)


COACH_SYSTEM = (
    "You are CG's LifeOS AI Coach — a sharp, supportive fitness, nutrition, and habit coach.\n"
    "You are given the user's OWN logged data plus reference-knowledge snippets retrieved for their question.\n\n"
    "Rules:\n"
    "- Ground advice in the user's actual data whenever relevant, and reference their real numbers.\n"
    "- The stored profile can be out of date. If the user states their own weight, height, age or sex and it"
    " conflicts with the profile below, believe the USER — they know their own body. Say the profile looks"
    " stale, plan using the numbers they gave you, and tell them it can be corrected. Never tell a user they"
    " are wrong about their own body.\n"
    "- When you propose daily targets or a meal plan, give concrete numbers (calories and grams per nutrient,"
    " and per meal). The user can apply them to their Intake tracker in one tap, so state them plainly rather"
    " than asking the user to copy them across by hand.\n"
    "- When present, factor in their watch/health data (steps, resting HR, HRV, stress, SpO2) and sleep —"
    " e.g. flag low sleep or high stress before pushing hard training, and connect recovery to performance.\n"
    "- Habit adherence is given as x/7 days. Treat a slipping habit as a lead, not a scolding: connect it to"
    " what the training and recovery data show, and suggest one small correction.\n"
    "- Use the reference knowledge for general facts. Never invent studies, citations, or statistics.\n"
    "- Be direct, specific, and actionable. Use short paragraphs and bullets; bold key numbers.\n"
    "- If the user has little or no logged data, say so and give one concrete first step.\n"
    "- Keep answers concise but complete. You are not a medical professional — add a brief caution for pain,"
    " injury, or medical topics and suggest seeing a professional when appropriate."
)


@api.get("/coach/status")
async def coach_status(user=Depends(get_current_user)):
    kb = await db.knowledge.count_documents({})
    provider = coach_provider()
    model = GROQ_MODEL if provider == "groq" else COACH_MODEL
    return {
        "configured": bool(provider),
        "provider": provider or None,
        "model": model,
        "knowledge_chunks": kb,
    }


@api.post("/coach/ingest")
async def coach_ingest(force: bool = False, user=Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    return await ingest_knowledge(force=force)


@api.post("/coach/chat")
async def coach_chat(payload: CoachChatIn, user=Depends(get_current_user)):
    msgs = [m for m in payload.messages if m.content and m.content.strip()]
    if not msgs:
        raise HTTPException(400, "No message provided")
    last_user = next((m.content for m in reversed(msgs) if m.role == "user"), msgs[-1].content)

    kb = await retrieve_knowledge(last_user, k=4)
    user_ctx = await build_user_context(user)
    sources = list(dict.fromkeys(d["title"] for d in kb))

    provider = coach_provider()
    if not provider:
        return {
            "configured": False,
            "reply": (
                "The AI Coach isn't connected yet. Add **GROQ_API_KEY** (free, get it at "
                "console.groq.com) or **ANTHROPIC_API_KEY** to `backend/.env` and restart the backend "
                "— then I'll answer using your workouts, plans, and body metrics, grounded in a "
                "fitness knowledge base."
            ),
            "sources": sources,
        }

    kb_text = "\n\n".join(f"[{d['title']}] {d['text']}" for d in kb) or "(no matching reference notes)"
    system = f"{COACH_SYSTEM}\n\n# The user's data\n{user_ctx}\n\n# Reference knowledge\n{kb_text}"

    chat_messages = [
        {"role": ("assistant" if m.role == "assistant" else "user"), "content": m.content} for m in msgs
    ]
    while chat_messages and chat_messages[0]["role"] != "user":
        chat_messages.pop(0)
    if not chat_messages:
        chat_messages = [{"role": "user", "content": last_user}]

    try:
        if provider == "groq":
            reply = await call_groq(system, chat_messages)
        else:
            # Opus 4.7 uses adaptive thinking; effort tunes depth/latency/cost.
            client = get_anthropic()
            resp = await client.messages.create(
                model=COACH_MODEL, max_tokens=1500, system=system, messages=chat_messages,
                thinking={"type": "adaptive"},
                output_config={"effort": COACH_EFFORT},
            )
            reply = "".join(b.text for b in resp.content if b.type == "text").strip()
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("coach chat failed")
        raise HTTPException(502, f"AI request failed: {e}")

    return {"configured": True, "provider": provider, "reply": reply, "sources": sources}


RECAP_SYSTEM = (
    "You are CG's LifeOS AI Coach writing the user's weekly training recap.\n"
    "Using ONLY their logged data below, write a short, motivating recap:\n"
    "- Open with one line on how the week went.\n"
    "- **Wins**: workouts done, total volume, and any PRs — use their real numbers and bold them.\n"
    "- **Watch**: any plateau/deload flags or clearly undertrained muscles.\n"
    "- **Next week**: one concrete focus.\n"
    "Keep it under 150 words, use short bullets, be specific to their numbers. "
    "If there is little data this week, say so warmly and give one first step."
)


@api.get("/coach/recap")
async def coach_recap(user=Depends(get_current_user)):
    """One-tap AI weekly recap grounded in the user's logged data."""
    provider = coach_provider()
    if not provider:
        return {"configured": False, "recap": "Connect the AI coach (set GROQ_API_KEY) to get weekly recaps."}
    ctx = await build_user_context(user)
    system = f"{RECAP_SYSTEM}\n\n# The user's data\n{ctx}"
    messages = [{"role": "user", "content": "Write my training recap for the past week."}]
    try:
        if provider == "groq":
            recap = await call_groq(system, messages)
        else:
            client = get_anthropic()
            resp = await client.messages.create(model=COACH_MODEL, max_tokens=600, system=system, messages=messages)
            recap = "".join(b.text for b in resp.content if b.type == "text").strip()
    except Exception as e:
        logger.exception("coach recap failed")
        raise HTTPException(502, f"AI request failed: {e}")
    return {"configured": True, "provider": provider, "recap": recap}


# ── INTAKE (calories / macros / micros — self-contained, see intake.py) ───────
# Dependencies are injected so intake.py never imports from server.py.
from intake import build_router as build_intake_router  # noqa: E402

api.include_router(build_intake_router(
    db=db,
    get_current_user=get_current_user,
    coach_provider=coach_provider,
    get_anthropic=get_anthropic,
    call_groq=call_groq,
    compute_bmr=_compute_bmr,
))

app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        os.environ.get("FRONTEND_URL", "http://localhost:3000"),
        "http://localhost:3000",
    ],
    # Local dev: allow any localhost port (echoes origin, so it works with
    # credentialed cookies) — a fixed dev-server port isn't guaranteed.
    allow_origin_regex=r"http://localhost:\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
