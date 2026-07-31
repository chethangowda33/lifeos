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
from datetime import date, datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

import bcrypt
import jwt
from bson import ObjectId
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field, field_validator

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


def _oid(value: str, what: str = "Not found") -> ObjectId:
    """Parse a path id, or 404.

    A malformed id is a client mistake, not a server fault. Calling ObjectId()
    bare raises InvalidId, which FastAPI surfaces as a 500 — habits and sleep
    did exactly that while workouts, routines and plans returned 404 for the
    same input. One helper keeps every module answering the same way."""
    try:
        return ObjectId(value)
    except Exception:
        raise HTTPException(404, what)


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


_DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")


def _check_date(v: Optional[str]) -> Optional[str]:
    """Reject a date that isn't YYYY-MM-DD.

    These values are used as raw lookup keys. An unvalidated one is written
    happily and then never matches anything again — the log silently vanishes
    rather than erroring, which is the hardest kind of bug to notice."""
    if v is None or v == "":
        return None
    if not _DATE_RE.fullmatch(v):
        raise ValueError("date must be YYYY-MM-DD")
    return v


class BodyMetricIn(BaseModel):
    metric: str  # one of METRIC_DEFS
    # Only the floor is universal. The ceiling depends entirely on the metric —
    # body fat is a percentage, BMR is ~1500-2200 kcal/day — so it is enforced
    # per metric in log_metric() against METRIC_DEFS["max"].
    value: float = Field(ge=0)


class HabitIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    emoji: str = "✅"
    type: str = "check"  # check | count
    target: Optional[float] = Field(default=None, ge=0, le=100000)
    unit: str = ""
    model_config = {"extra": "ignore"}

    @field_validator("type")
    @classmethod
    def _known_type(cls, v: str) -> str:
        # Anything unrecognised silently behaved as a check habit, so a typo
        # produced a habit whose target was quietly ignored.
        if v not in ("check", "count"):
            raise ValueError("type must be 'check' or 'count'")
        return v

    @field_validator("name")
    @classmethod
    def _non_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("name cannot be blank")
        return v


class HabitLogIn(BaseModel):
    date: Optional[str] = None  # YYYY-MM-DD; defaults to today
    value: Optional[float] = Field(default=None, ge=0, le=100000)

    _v_date = field_validator("date")(_check_date)


class SleepLogIn(BaseModel):
    date: Optional[str] = None  # night's date (YYYY-MM-DD); defaults to today
    # A night cannot be negative or longer than a day. Unbounded, one bad entry
    # skewed the 7-night average and the Sleep part of the Life Score.
    hours: float = Field(ge=0, le=24)
    quality: Optional[int] = Field(default=None, ge=1, le=5)
    bedtime: str = ""
    wake_time: str = ""
    model_config = {"extra": "ignore"}

    _v_date = field_validator("date")(_check_date)


class HealthIngestIn(BaseModel):
    """Brand-agnostic daily health payload pushed by a phone automation / export app.
    Works with ANY source that writes to Apple Health (iPhone) or Health Connect
    (Android) — Apple/Garmin/Fitbit/Fastrack/phone pedometer all funnel through there."""
    # Bounds are deliberately generous — the point is to reject a mis-mapped
    # automation field (a timestamp landing in `steps`, a metre value in
    # `distance_km`) rather than to police physiology.
    date: Optional[str] = None  # YYYY-MM-DD; defaults to today
    steps: Optional[int] = Field(default=None, ge=0, le=300000)
    distance_km: Optional[float] = Field(default=None, ge=0, le=1000)
    resting_hr: Optional[int] = Field(default=None, ge=0, le=300)
    avg_hr: Optional[int] = Field(default=None, ge=0, le=300)
    hrv: Optional[float] = Field(default=None, ge=0, le=1000)
    spo2: Optional[float] = Field(default=None, ge=0, le=100)
    stress: Optional[int] = Field(default=None, ge=0, le=100)
    respiratory_rate: Optional[float] = Field(default=None, ge=0, le=200)
    active_energy: Optional[float] = Field(default=None, ge=0, le=50000)
    sleep_hours: Optional[float] = Field(default=None, ge=0, le=24)
    sleep_quality: Optional[int] = Field(default=None, ge=1, le=5)
    model_config = {"extra": "ignore"}

    _v_date = field_validator("date")(_check_date)


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
    weekly_report_push_enabled: Optional[bool] = None  # Sunday-evening "your week" push
    tz_offset_minutes: Optional[int] = None  # local offset from UTC, for background push
    weekly_workout_target: Optional[int] = None  # sessions/week the dashboard + Life Score measure against

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
    "weekly_report_push_enabled": False,
    "weekly_workout_target": 4,
}


class ChallengeRuleIn(BaseModel):
    label: str = Field(min_length=1, max_length=60)
    metric: str  # one of CHALLENGE_METRICS
    target: float = Field(default=1, ge=0, le=100_000)

    model_config = {"extra": "ignore"}


class ChallengeIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    description: str = Field(default="", max_length=300)
    days: int = Field(ge=1, le=365)
    strict: bool = False  # a missed day restarts the run (the 75 Hard rule)
    rules: List[ChallengeRuleIn] = Field(min_length=1, max_length=8)
    start_date: Optional[str] = None  # defaults to the caller's today
    template: Optional[str] = None

    model_config = {"extra": "ignore"}

    _v_start = field_validator("start_date")(_check_date)


class ChallengeLogIn(BaseModel):
    rule_key: str = Field(min_length=1, max_length=20)
    done: bool = True
    date: Optional[str] = None

    model_config = {"extra": "ignore"}

    _v_date = field_validator("date")(_check_date)


# ──────────────────────────────────────────────────────────────────────────────
# Constants — body metric definitions with ideal ranges
# ──────────────────────────────────────────────────────────────────────────────
METRIC_DEFS: Dict[str, Dict[str, Any]] = {
    # Weight is a first-class tracked metric, not just a profile field — otherwise the
    # app can't draw the one trend users most expect. Its ideal range is height-dependent,
    # so metric_definitions() overrides these placeholders per user (BMI 18.5–24.9).
    # `max` is a plausibility ceiling, NOT the ideal range — a user may log well
    # outside ideal and should be allowed to. It exists only to catch a typo or a
    # wrong-unit entry (lbs into a kg field) before it skews every derived chart.
    "weight": {"label": "Weight", "unit": "kg", "ideal_min": 57, "ideal_max": 76, "auto": False, "max": 500},
    "body_fat": {"label": "Body Fat", "unit": "%", "ideal_min": 10, "ideal_max": 20, "auto": False, "max": 100},
    "muscle_mass": {"label": "Muscle Mass", "unit": "%", "ideal_min": 38, "ideal_max": 54, "auto": False, "max": 100},
    "bone_mass": {"label": "Bone Mass", "unit": "kg", "ideal_min": 2.5, "ideal_max": 3.5, "auto": False, "max": 20},
    "hydration": {"label": "Hydration", "unit": "%", "ideal_min": 55, "ideal_max": 65, "auto": False, "max": 100},
    "metabolic_age": {"label": "Metabolic Age", "unit": "years", "ideal_min": 18, "ideal_max": 40, "auto": False, "max": 120},
    "bmi": {"label": "BMI", "unit": "kg/m²", "ideal_min": 18.5, "ideal_max": 24.9, "auto": True, "max": 100},
    "bmr": {"label": "BMR", "unit": "kcal/day", "ideal_min": 1500, "ideal_max": 2200, "auto": True, "max": 10000},
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
    defn = METRIC_DEFS[payload.metric]
    if defn["auto"]:
        raise HTTPException(400, "Auto-computed metric cannot be logged manually")
    ceiling = defn.get("max")
    if ceiling is not None and payload.value > ceiling:
        raise HTTPException(400, f"{defn['label']} cannot exceed {ceiling} {defn['unit']}")
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
    res = await db.habits.update_one(
        {"_id": _oid(habit_id, "Habit not found"), "user_id": str(user["_id"])}, {"$set": upd}
    )
    if not res.matched_count:
        raise HTTPException(404, "Habit not found")
    return {"ok": True}


@api.delete("/habits/{habit_id}")
async def delete_habit(habit_id: str, user=Depends(get_current_user)):
    uid = str(user["_id"])
    await db.habits.delete_one({"_id": _oid(habit_id, "Habit not found"), "user_id": uid})
    await db.habit_logs.delete_many({"habit_id": habit_id, "user_id": uid})
    return {"ok": True}


@api.post("/habits/{habit_id}/log")
async def log_habit(habit_id: str, payload: HabitLogIn, user=Depends(get_current_user)):
    uid = str(user["_id"])
    habit = await db.habits.find_one({"_id": _oid(habit_id, "Habit not found"), "user_id": uid})
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
    await db.sleep_logs.delete_one({"_id": _oid(sleep_id, "Sleep log not found"), "user_id": str(user["_id"])})
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


async def _user_from_health_token(request: Request) -> Dict[str, Any]:
    """Token auth for phone automations, which cannot hold a login session."""
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
    return user


# Matches a bare number, optionally decimal/negative. Used only on the text
# fallback below, where Shortcuts has already flattened samples to a string.
_NUM_RE = re.compile(r"-?\d+(?:\.\d+)?")


def _sum_health_payload(raw: str) -> Dict[str, Any]:
    """Sum whatever a Shortcuts 'Health Samples' variable serialised into.

    Shortcuts renders that variable differently per iOS version — a JSON array,
    an array of objects, or newline-separated text like "412 count". Rather than
    betting on one shape, parse JSON when it is JSON and fall back to pulling the
    numbers out of the text, reporting which path was taken so a wrong guess is
    visible instead of silently producing a wrong total."""
    raw = (raw or "").strip()
    if not raw:
        return {"total": None, "count": 0, "parsed_as": "empty"}

    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        data = None

    if data is not None:
        if isinstance(data, (int, float)):
            return {"total": float(data), "count": 1, "parsed_as": "json-number"}
        if isinstance(data, list):
            vals: List[float] = []
            for item in data:
                if isinstance(item, (int, float)):
                    vals.append(float(item))
                elif isinstance(item, dict):
                    # sample objects vary: {"value": 412} / {"quantity": 412} / …
                    for k in ("value", "quantity", "amount", "count"):
                        if isinstance(item.get(k), (int, float)):
                            vals.append(float(item[k]))
                            break
                elif isinstance(item, str):
                    m = _NUM_RE.search(item)
                    if m:
                        vals.append(float(m.group()))
            if vals:
                return {"total": sum(vals), "count": len(vals), "parsed_as": "json-list"}
        if isinstance(data, dict):
            for k in ("value", "quantity", "amount", "count", "total"):
                if isinstance(data.get(k), (int, float)):
                    return {"total": float(data[k]), "count": 1, "parsed_as": "json-object"}

    # Text fallback: one sample per line, take the FIRST number on each line so a
    # trailing timestamp ("412 count, 21 Jul 2026") cannot inflate the total.
    vals = []
    for line in raw.splitlines():
        m = _NUM_RE.search(line)
        if m:
            vals.append(float(m.group()))
    if vals:
        return {"total": sum(vals), "count": len(vals), "parsed_as": "text-lines"}
    return {"total": None, "count": 0, "parsed_as": "unrecognised"}


@api.post("/health/ingest/raw")
async def health_ingest_raw(request: Request, metric: str = "steps", date: Optional[str] = None):
    """Sum raw Health samples server-side.

    The two-step phone recipe (Find Health Samples → Calculate Statistics) fails
    quietly on some devices: Calculate Statistics yields nothing and the JSON field
    is sent as null. This endpoint takes the Find Health Samples output directly so
    the automation is one action shorter and the fragile step disappears.

    Always echoes `received_preview` so a serialisation this parser does not know
    about can be identified from the response instead of guessed at."""
    user = await _user_from_health_token(request)
    if metric not in HEALTH_DAILY_FIELDS and metric != "sleep_hours":
        raise HTTPException(400, f"Unknown metric '{metric}'")

    if date is not None and not _DATE_RE.fullmatch(date):
        raise HTTPException(400, "date must be YYYY-MM-DD")

    raw = (await request.body()).decode("utf-8", errors="replace")
    parsed = _sum_health_payload(raw)
    uid = str(user["_id"])
    d = date or _today_str()

    stored = False
    rejected = None
    if parsed["total"] is not None:
        value = round(parsed["total"], 2)
        # Run the summed value through the same bounds the JSON endpoint uses, so
        # a mis-mapped Shortcuts field can't write a nonsense figure by taking the
        # raw path instead. Reported rather than silently dropped.
        try:
            HealthIngestIn(**{metric: value})
            in_range = True
        except Exception:
            rejected = f"{value} is out of range for {metric}"
            in_range = False

        if in_range:
            if metric == "sleep_hours":
                await db.sleep_logs.update_one(
                    {"user_id": uid, "date": d},
                    {"$set": {"user_id": uid, "date": d, "hours": value, "source": "sync"}},
                    upsert=True,
                )
            else:
                await db.health_daily.update_one(
                    {"user_id": uid, "date": d},
                    {"$set": {metric: value, "synced_at": datetime.now(timezone.utc).isoformat()}},
                    upsert=True,
                )
            stored = True

    return {
        "ok": True, "date": d, "metric": metric, "stored": stored,
        "total": parsed["total"], "samples": parsed["count"],
        "parsed_as": parsed["parsed_as"],
        "rejected": rejected,
        "received_preview": raw[:300],
    }


@api.delete("/health/daily/{date}")
async def delete_health_day(date: str, user=Depends(get_current_user)):
    """Remove a synced day. A bad automation run could previously write wrong
    numbers with no way to clear them."""
    res = await db.health_daily.delete_one({"user_id": str(user["_id"]), "date": date})
    return {"ok": True, "deleted": res.deleted_count}


@api.post("/health/ingest")
async def health_ingest(payload: HealthIngestIn, request: Request):
    """Token-authenticated ingest — called by a phone automation, NOT the browser.
    Auth via `X-Health-Token` header or `Authorization: Bearer <token>`."""
    user = await _user_from_health_token(request)
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


# Sunday-evening weekly recap. Reports are pull-only and nobody opens an app to
# read a report they don't know exists.
WEEKLY_PUSH_WEEKDAY = 6   # Sunday, matching the Monday-start weeks _period_bounds uses
WEEKLY_PUSH_HOUR = 19     # 19:00 local
WEEKLY_PUSH_GRACE_MINUTES = 180


def weekly_push_due(settings: Dict[str, Any], local_now: datetime) -> Optional[str]:
    """The ISO week key to stamp if a weekly recap is due for this user right
    now, else None. Pure, so the schedule is testable without a scheduler.

    The key is the week being *reported on*, which is why it's derived from
    `local_now` rather than counted — a cron that misses a Sunday must not fire
    a stale recap on Monday, and one that runs four times inside the window must
    only send once."""
    if not settings.get("weekly_report_push_enabled"):
        return None
    if local_now.weekday() != WEEKLY_PUSH_WEEKDAY:
        return None
    late = (local_now.hour * 60 + local_now.minute) - WEEKLY_PUSH_HOUR * 60
    if late < 0 or late > WEEKLY_PUSH_GRACE_MINUTES:
        return None
    year, week, _ = local_now.isocalendar()
    key = f"{year}-W{week:02d}"
    return None if settings.get("last_weekly_push") == key else key


def weekly_push_body(training: Dict[str, Any]) -> Optional[str]:
    """One line of the user's own numbers — or None when there's nothing to say.

    A "0 sessions this week" push is a guilt-trip that costs us notification
    permission, and the people it would reach are the ones least likely to want
    it. Silence is the better failure mode."""
    sessions = training.get("workouts") or 0
    if not sessions:
        return None
    volume = training.get("volume_kg") or 0
    vol = f"{round(volume / 1000, 1)}k kg" if volume >= 1000 else f"{round(volume)} kg"
    parts = [f"{sessions} session{'s' if sessions != 1 else ''}", vol]
    prs = len(training.get("prs") or [])
    if prs:
        parts.append(f"{prs} PR{'s' if prs != 1 else ''}")
    return " · ".join(parts)


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


async def _push_subs(uid: str) -> List[Dict[str, Any]]:
    return await db.push_subscriptions.find({"user_id": uid}).to_list(10)


async def _send_push(subs: List[Dict[str, Any]], payload: Dict[str, Any],
                     webpush, WebPushException) -> tuple:
    """Deliver one payload to every subscription of one user → (sent, dropped).

    The ONE place a push is sent, so the reminder and the weekly recap can't
    drift apart on how a dead subscription is handled."""
    sent = dropped = 0
    for sub in subs:
        try:
            webpush(
                subscription_info={"endpoint": sub["endpoint"], "keys": sub.get("keys", {})},
                data=json.dumps(payload),
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
            # and cost everyone else their notification — drop it and keep going.
            logger.warning("push: dropping unusable subscription %s", sub.get("endpoint", "")[:60])
            await db.push_subscriptions.delete_one({"endpoint": sub["endpoint"]})
            dropped += 1
    return sent, dropped


@api.post("/push/dispatch")
async def push_dispatch(request: Request):
    """Send train reminders and weekly recaps that are due. Called by an EXTERNAL
    scheduler (cron-job.org, GitHub Actions, …) with the PUSH_DISPATCH_SECRET — the
    free Render tier sleeps, so the app cannot reliably wake itself. Reminders are
    idempotent per user per day, recaps per user per ISO week."""
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
        subs = await _push_subs(str(u["_id"]))
        if not subs:
            continue
        body = "Your next session is ready."
        plan = await db.plans.find_one({"user_id": str(u["_id"])})
        if plan and plan.get("days"):
            # Same rule the NEXT UP card uses: the day rested longest.
            nxt = min(plan["days"], key=lambda d: d.get("last_completed_at") or "")
            body = f"{nxt.get('name')} is next in your rotation."
        s, d = await _send_push(
            subs, {"title": "Time to train 🏋️", "body": body, "url": "/workout"},
            webpush, WebPushException,
        )
        sent += s
        dropped += d
        await db.users.update_one({"_id": u["_id"]}, {"$set": {"workout_settings.last_push_date": today}})

    # ── Weekly recap: Sunday evening, the week that ends today ────────────────
    weekly_sent = 0
    async for u in db.users.find({"workout_settings.weekly_report_push_enabled": True}):
        st = u.get("workout_settings") or {}
        local_now = now + timedelta(minutes=int(st.get("tz_offset_minutes") or 0))
        week_key = weekly_push_due(st, local_now)
        if not week_key:
            continue
        uid = str(u["_id"])
        subs = await _push_subs(uid)
        if not subs:
            continue
        # The same numbers /reports shows for this week — the push must never be
        # able to say something the page then contradicts.
        bounds = _period_bounds("week", 0, local_now.date().isoformat())
        body = weekly_push_body(await _report_training(uid, bounds["start"], bounds["end"]))
        # A quiet week still stamps, or an untrained user gets this retried every
        # 15 minutes until the window closes.
        if body:
            s, d = await _send_push(
                subs, {"title": "Your week 📊", "body": body, "url": "/reports"},
                webpush, WebPushException,
            )
            weekly_sent += s
            dropped += d
        await db.users.update_one({"_id": u["_id"]},
                                  {"$set": {"workout_settings.last_weekly_push": week_key}})

    return {"ok": True, "sent": sent, "dropped": dropped, "weekly_sent": weekly_sent}


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


async def _muscle_volume(uid: str) -> List[Dict[str, Any]]:
    """Weekly hard sets (RPE≥6 or no RPE, excl. warmups) per muscle group vs
    MEV/MAV/MRV. The ONE place this is computed — /workouts/muscle-volume and
    /readiness both read it, so the dashboard and the readiness card can never
    disagree about whether a muscle is cooked."""
    since = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    docs = await db.workout_sessions.find(
        {"user_id": uid, "created_at": {"$gte": since}}
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


@api.get("/workouts/muscle-volume")
async def muscle_volume(user=Depends(get_current_user)):
    return await _muscle_volume(str(user["_id"]))


# ── TRAINING READINESS ────────────────────────────────────────────────────────
# "Should I train today?" — muscle recovery, weekly volume vs MEV/MAV/MRV,
# plateau/deload flags, sleep and resting HR/HRV are all computed already and
# nothing put them together into an answer.
#
# Deliberately NOT an LLM call. Every input is a number and the arithmetic IS
# the product — each reason carries the points it cost, so the card can show its
# own working and the user can disagree with a threshold rather than with a
# black box.


def compute_readiness(
    muscles: List[Dict[str, Any]],
    untrained: List[str],
    sleep: Optional[Dict[str, Any]],
    health: Optional[Dict[str, Any]],
    flags: Dict[str, int],
    trained_today: bool,
    streak_days: int,
) -> Dict[str, Any]:
    """Score 0-100 → verdict, plus what to train and what to leave alone.

    Pure: no DB access, so the thresholds are directly testable."""
    score = 100
    reasons: List[Dict[str, Any]] = []

    def hit(kind: str, effect: int, text: str) -> None:
        nonlocal score
        score += effect
        reasons.append({"kind": kind, "effect": effect, "text": text})

    if trained_today:
        hit("trained", -35, "You already trained today")

    if sleep and sleep.get("hours") is not None:
        h = sleep["hours"]
        if h < 6:
            hit("sleep", -25, f"Slept {h}h last night")
        elif h < 7:
            hit("sleep", -12, f"Slept {h}h last night")
        elif h >= 8:
            hit("sleep", 5, f"Slept {h}h — well rested")
        q = sleep.get("quality")
        if q is not None and q <= 2:
            hit("sleep", -8, f"Sleep quality {q}/5")

    if streak_days >= 3:
        hit("streak", -10, f"{streak_days} training days in a row")

    # Over MRV is the strongest training-side signal — name the muscles, with
    # the set count, so the number is checkable against the volume bars.
    for m in [x for x in muscles if x["zone"] == "excessive"][:2]:
        hit("volume", -10,
            f"{m['muscle_group'].capitalize()} is over MRV ({m['hard_sets']} of {m['mrv']} hard sets)")
    high = [m for m in muscles if m["zone"] == "high"]
    if high:
        names = ", ".join(m["muscle_group"] for m in high[:2])
        hit("volume", -5, f"{names.capitalize()} near MRV this week")

    if flags.get("deload"):
        n = flags["deload"]
        hit("progression", -10, f"{n} exercise{'s' if n > 1 else ''} flagged for deload")
    if flags.get("plateau"):
        n = flags["plateau"]
        hit("progression", -5, f"{n} exercise{'s' if n > 1 else ''} plateaued")

    if health:
        rhr, rhr_base = health.get("resting_hr"), health.get("resting_hr_baseline")
        if rhr and rhr_base and rhr - rhr_base >= 7:
            hit("hr", -15, f"Resting HR {round(rhr)} bpm vs your {round(rhr_base)} average")
        hrv, hrv_base = health.get("hrv"), health.get("hrv_baseline")
        if hrv and hrv_base and hrv <= hrv_base * 0.8:
            hit("hrv", -10,
                f"HRV {round(hrv)} ms, {round((1 - hrv / hrv_base) * 100)}% below your average")

    score = max(0, min(100, score))
    verdict = "train" if score >= 70 else ("light" if score >= 40 else "rest")

    # A muscle with no hard sets in the last 7 days never appears in `muscles` at
    # all — those are the freshest of the lot, so they lead the suggestion.
    ready: List[str] = list(untrained)
    ready += [m["muscle_group"] for m in
              sorted([m for m in muscles
                      if m["recovery"] == "fresh" and m["zone"] in ("under", "optimal")],
                     key=lambda m: -(m["days_since"] or 0))]
    train = ready[:3]
    avoid = [m["muscle_group"] for m in muscles
             if m["zone"] in ("high", "excessive") or m["recovery"] == "worked"][:3]

    # With nothing trained in the window every group is equally fresh, and the
    # first two are just whatever order the landmarks table happens to be in —
    # naming them would assert a preference the data doesn't support.
    everything_fresh = not muscles and bool(untrained)
    if verdict == "rest":
        headline = "Rest today"
    elif everything_fresh:
        headline = ("Train light — everything is recovered" if verdict == "light"
                    else "Train — everything is recovered")
    elif train:
        label = " or ".join(train[:2])
        headline = f"Train light — {label}" if verdict == "light" else f"Train — {label}"
    else:
        headline = "Train light" if verdict == "light" else "Train"

    return {
        "score": score,
        "verdict": verdict,
        "headline": headline,
        "train": train,
        "avoid": avoid,
        "reasons": sorted(reasons, key=lambda r: r["effect"]),
    }


@api.get("/readiness")
async def training_readiness(date: Optional[str] = None, user=Depends(get_current_user)):
    """Should I train today, and on what?

    `date` is the CALLER'S local day, same as /life-score — sleep is stored
    against the local date, so a UTC default reads the wrong night for anyone
    east of UTC between midnight and their offset."""
    uid = str(user["_id"])
    if date and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
        raise HTTPException(400, "date must be YYYY-MM-DD")
    today = date or _today_str()
    try:
        day = datetime.strptime(today, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        raise HTTPException(400, "date must be YYYY-MM-DD")

    muscles = await _muscle_volume(uid)
    seen = {m["muscle_group"] for m in muscles}
    untrained = [g for g in VOLUME_LANDMARKS if g not in seen]

    # Last night = today's log (logged on waking) falling back to yesterday's.
    yesterday = (day - timedelta(days=1)).date().isoformat()
    sleep_doc = (await db.sleep_logs.find_one({"user_id": uid, "date": today})
                 or await db.sleep_logs.find_one({"user_id": uid, "date": yesterday}))
    sleep = ({"date": sleep_doc.get("date"), "hours": sleep_doc.get("hours"),
              "quality": sleep_doc.get("quality")} if sleep_doc else None)

    # Health: the latest synced day measured against the days BEFORE it. A
    # baseline that includes today would dilute the very spike we're looking for.
    since = (day - timedelta(days=7)).date().isoformat()
    hrows = await db.health_daily.find(
        {"user_id": uid, "date": {"$gte": since, "$lte": today}}
    ).to_list(30)
    health = None
    if hrows:
        latest = max(hrows, key=lambda r: r.get("date", ""))
        prior = [r for r in hrows if r.get("date") != latest.get("date")]

        def baseline(key: str) -> Optional[float]:
            vals = [r[key] for r in prior if r.get(key) is not None]
            return round(sum(vals) / len(vals), 1) if vals else None

        health = {
            "date": latest.get("date"),
            "steps": latest.get("steps"),
            "resting_hr": latest.get("resting_hr"), "resting_hr_baseline": baseline("resting_hr"),
            "hrv": latest.get("hrv"), "hrv_baseline": baseline("hrv"),
        }

    since14 = (day - timedelta(days=14)).isoformat()
    sessions = await db.workout_sessions.find(
        {"user_id": uid, "created_at": {"$gte": since14}}, {"created_at": 1}
    ).to_list(100)
    days_trained = {s["created_at"][:10] for s in sessions if s.get("created_at")}
    trained_today = today in days_trained
    # Consecutive training days ending today — or ending yesterday, so a rest day
    # that has only just started doesn't read as a broken streak.
    streak = 0
    cursor = day.date() if trained_today else (day - timedelta(days=1)).date()
    while cursor.isoformat() in days_trained:
        streak += 1
        cursor -= timedelta(days=1)

    states = await db.progression_states.find({"user_id": uid}).to_list(500)
    flags = {"deload": sum(1 for s in states if s.get("deload_flag")),
             "plateau": sum(1 for s in states if s.get("plateau"))}

    ever = await db.workout_sessions.count_documents({"user_id": uid})
    out = compute_readiness(muscles, untrained, sleep, health, flags, trained_today, streak)
    return {
        **out,
        "date": today,
        "has_data": bool(ever or sleep or health),
        "inputs": {"sleep": sleep, "health": health, "flags": flags,
                   "trained_today": trained_today, "streak_days": streak,
                   "muscles": muscles},
    }


# ── LIFE SCORE ────────────────────────────────────────────────────────────────
IDEAL_SLEEP_HOURS = 7.5
DAILY_STEP_TARGET = 8000


def _pct(value: float, target: float) -> float:
    """Progress toward a target as 0-100, never above 100."""
    if not target:
        return 0.0
    return max(0.0, min(100.0, (value / target) * 100.0))


@api.get("/life-score")
async def life_score(date: Optional[str] = None, user=Depends(get_current_user)):
    """Daily 0-100 per life category, computed from actually-logged data.

    Design rule: a category is only scored when the user genuinely tracks it.
    Averaging in a zero for every module someone doesn't use would tell a
    dedicated lifter who never logs meals that their life is a 40 — punishing
    them for the app's breadth rather than reflecting their effort. Untracked
    categories are returned with `available: false` and left out of the overall.

    `date` is the CALLER'S local day. Habits, sleep and intake are all stored
    against the user's local date, so defaulting to the UTC date would read the
    wrong day for anyone east of UTC between midnight and their offset — in IST
    that is 00:00-05:30, where a ticked habit would score zero."""
    uid = str(user["_id"])
    if date and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
        raise HTTPException(400, "date must be YYYY-MM-DD")
    today = date or _today_str()
    try:
        day = datetime.strptime(today, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        raise HTTPException(400, "date must be YYYY-MM-DD")
    yesterday = (day - timedelta(days=1)).date().isoformat()
    cats: List[Dict[str, Any]] = []

    # ── Fitness: sessions so far this week, Monday-based to match the ring ────
    # Read the user's own weekly target — someone training 6x/week would otherwise
    # be permanently capped at "67%" by a hardcoded 4.
    settings = {**DEFAULT_WORKOUT_SETTINGS, **(user.get("workout_settings") or {})}
    weekly_target = max(1, int(settings.get("weekly_workout_target") or 4))
    monday = day - timedelta(days=day.weekday())
    week_workouts = await db.workout_sessions.count_documents(
        {"user_id": uid, "created_at": {"$gte": monday.isoformat()}}
    )
    ever = await db.workout_sessions.count_documents({"user_id": uid})
    cats.append({
        "key": "fitness", "label": "Fitness",
        "score": round(_pct(week_workouts, weekly_target)),
        "available": ever > 0,
        "detail": f"{week_workouts} of {weekly_target} sessions this week",
    })

    # ── Nutrition: today's calories + protein against the user's own targets ──
    entries = await db.intake_entries.find({"user_id": uid, "date": today}).to_list(200)
    kcal = protein = 0.0
    for e in entries:
        qty = e.get("quantity") or 1
        n = e.get("nutrients") or {}
        kcal += (n.get("calories") or 0) * qty
        protein += (n.get("protein_g") or n.get("protein") or 0) * qty
    tdoc = await db.intake_targets.find_one({"user_id": uid}) or {}
    tset = tdoc.get("targets") or {}
    kcal_t = tset.get("calories") or 2000
    prot_t = tset.get("protein_g") or 150
    # Calories and protein weighted equally — hitting protein matters as much as
    # total energy for anyone training.
    cats.append({
        "key": "nutrition", "label": "Nutrition",
        "score": round((_pct(kcal, kcal_t) + _pct(protein, prot_t)) / 2),
        "available": len(entries) > 0,
        "detail": f"{round(kcal)} / {round(kcal_t)} kcal · {round(protein)} / {round(prot_t)}g protein",
    })

    # ── Habits: today's completions across active habits ──────────────────────
    habits = await db.habits.find({"user_id": uid, "archived": {"$ne": True}}).to_list(200)
    done = 0
    if habits:
        hlogs = await db.habit_logs.find(
            {"user_id": uid, "habit_id": {"$in": [str(h["_id"]) for h in habits]}, "date": today}
        ).to_list(500)
        by_id = {l["habit_id"]: l for l in hlogs}
        for h in habits:
            l = by_id.get(str(h["_id"]))
            if not l:
                continue
            if h.get("type") == "count":
                if (l.get("value") or 0) >= (h.get("target") or 1):
                    done += 1
            elif l.get("completed"):
                done += 1
    cats.append({
        "key": "habits", "label": "Habits",
        "score": round(_pct(done, len(habits))) if habits else 0,
        "available": len(habits) > 0,
        "detail": f"{done} of {len(habits)} done today" if habits else "No habits yet",
    })

    # ── Sleep: most recent night within 2 days (last night may not be logged yet)
    recent = await db.sleep_logs.find({"user_id": uid}).sort("date", -1).to_list(1)
    night = recent[0] if recent else None
    fresh = bool(night and night.get("date", "") >= yesterday)
    hours = (night or {}).get("hours") or 0
    # Oversleeping is not better than sleeping well, so score distance from ideal
    # rather than raw hours — 9h and 6h are both off-target.
    sleep_score = max(0.0, 100.0 - (abs(hours - IDEAL_SLEEP_HOURS) / IDEAL_SLEEP_HOURS) * 100.0) if hours else 0.0
    cats.append({
        "key": "sleep", "label": "Sleep",
        "score": round(sleep_score),
        "available": fresh,
        "detail": f"{hours}h last night" if fresh else "Not logged",
    })

    # ── Activity: steps from whatever watch/phone syncs in ────────────────────
    hd = await db.health_daily.find_one({"user_id": uid, "date": today})
    steps = (hd or {}).get("steps") or 0
    cats.append({
        "key": "activity", "label": "Activity",
        "score": round(_pct(steps, DAILY_STEP_TARGET)),
        "available": bool(hd and steps),
        "detail": f"{round(steps):,} of {DAILY_STEP_TARGET:,} steps" if steps else "No watch data",
    })

    # A stale category keeps its computed number internally but must not show one —
    # "89" next to "not logged" reads as a bug.
    for c in cats:
        if not c["available"]:
            c["score"] = 0

    scored = [c["score"] for c in cats if c["available"]]
    # One category is not a life score, it is that category wearing a different
    # label — and presenting it as an overall (often a 0 early in the week) is
    # both misleading and discouraging. Withhold the number until there are at
    # least two signals; the breakdown still shows what to start tracking.
    overall = round(sum(scored) / len(scored)) if len(scored) >= 2 else None
    return {
        "date": today,
        "overall": overall,
        "tracked": len(scored),
        "needs_more_tracking": overall is None,
        "categories": cats,
    }


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


# ── PERIOD REPORTS (weekly / monthly) ─────────────────────────────────────────
# A report is DETERMINISTIC first: every figure below is computed from logged
# data and returned on its own, so the page reads fine with the AI switched off.
# The narrative is a layer on top and is handed exactly these numbers — never the
# free-form coach context — so it cannot cite a figure the user can't also read
# as text. Narratives are cached per period (an LLM call per page view would be
# both slow and pointless); `stale` marks one whose numbers have since moved.
REPORT_PERIODS = ("week", "month")


def _next_day(d: str) -> str:
    return (date.fromisoformat(d) + timedelta(days=1)).isoformat()


def _period_bounds(period: str, offset: int, today: Optional[str]) -> Dict[str, Any]:
    """Inclusive start/end of the week or month `offset` periods back.

    `today` is the CALLER'S local date, for the same reason `/life-score` takes
    one: habits, sleep and intake are keyed on the user's own calendar day, so
    deriving the boundary from the server's UTC date puts an IST user in the
    wrong week between midnight and 05:30."""
    if period not in REPORT_PERIODS:
        raise HTTPException(400, "period must be 'week' or 'month'")
    if not 0 <= offset <= 520:
        raise HTTPException(400, "offset must be between 0 and 520")
    try:
        base = date.fromisoformat(today) if today else datetime.now(timezone.utc).date()
    except ValueError:
        raise HTTPException(400, "today must be YYYY-MM-DD")

    if period == "week":
        start = base - timedelta(days=base.weekday() + 7 * offset)
        end = start + timedelta(days=6)
        # No %-d / %#d — that flag differs between Linux (prod) and Windows (dev).
        label = f"{start.strftime('%b')} {start.day} – {end.strftime('%b')} {end.day}, {end.year}"
    else:
        y, m = base.year, base.month - offset
        while m <= 0:
            y, m = y - 1, m + 12
        start = date(y, m, 1)
        end = date(y + (m == 12), (m % 12) + 1, 1) - timedelta(days=1)
        label = f"{start.strftime('%B')} {start.year}"

    # A period still running is scored against the days that have actually
    # happened — 2/7 habit days reads as failure when only 2 days have passed.
    elapsed = (min(end, base) - start).days + 1 if base >= start else 0
    return {
        "period": period, "offset": offset, "label": label,
        "start": start.isoformat(), "end": end.isoformat(),
        "days_total": (end - start).days + 1,
        "days_elapsed": max(0, min((end - start).days + 1, elapsed)),
        "current": offset == 0,
    }


async def _report_training(uid: str, start: str, end: str) -> Dict[str, Any]:
    docs = await db.workout_sessions.find({
        "user_id": uid,
        "created_at": {"$gte": f"{start}T00:00:00", "$lt": f"{_next_day(end)}T00:00:00"},
    }).to_list(500)

    ex_ids = {ex["exercise_id"] for d in docs for ex in d.get("exercises", []) if ex.get("exercise_id")}
    oids = []
    for eid in ex_ids:
        try:
            oids.append(ObjectId(eid))
        except Exception:
            continue
    refs: Dict[str, Dict[str, Any]] = {}
    async for r in db.exercises.find({"_id": {"$in": oids}}, {"name": 1, "muscle_group": 1}):
        refs[str(r["_id"])] = r

    per_ex: Dict[str, Dict[str, Any]] = {}
    muscles: Dict[str, int] = {}
    days, volume, sets, duration = set(), 0.0, 0, 0
    for d in docs:
        days.add((d.get("created_at") or "")[:10])
        volume += d.get("total_volume_kg") or 0
        sets += d.get("completed_sets") or 0
        duration += d.get("duration_seconds") or 0
        for ex in d.get("exercises", []):
            ref = refs.get(ex.get("exercise_id") or "", {})
            name = ref.get("name") or ex.get("name") or "Exercise"
            mg = ref.get("muscle_group") or "other"
            slot = per_ex.setdefault(name, {"name": name, "muscle_group": mg,
                                            "sets": 0, "volume_kg": 0.0, "best_e1rm": 0.0})
            for s in ex.get("sets", []):
                if not s.get("completed"):
                    continue
                slot["sets"] += 1
                slot["volume_kg"] += (s.get("kg") or 0) * (s.get("reps") or 0)
                slot["best_e1rm"] = max(slot["best_e1rm"], s.get("e1rm") or 0)
                # Hard sets follow the same rule as /workouts/muscle-volume —
                # warm-ups and RPE<6 count toward volume nowhere else either.
                rpe = s.get("rpe")
                if s.get("set_type") == "warmup" or (rpe is not None and rpe < 6):
                    continue
                muscles[mg] = muscles.get(mg, 0) + 1

    prs = await db.pr_events.find({
        "user_id": uid,
        "created_at": {"$gte": f"{start}T00:00:00", "$lt": f"{_next_day(end)}T00:00:00"},
    }).sort("created_at", -1).to_list(50)

    top = sorted(per_ex.values(), key=lambda x: -x["volume_kg"])[:5]
    for t in top:
        t["volume_kg"] = round(t["volume_kg"], 1)
        t["best_e1rm"] = round(t["best_e1rm"], 1)
    return {
        "workouts": len(docs),
        "days_trained": len([d for d in days if d]),
        "volume_kg": round(volume, 1),
        "sets": sets,
        "duration_seconds": duration,
        "top_exercises": top,
        "muscles": [{"muscle_group": k, "hard_sets": v}
                    for k, v in sorted(muscles.items(), key=lambda x: -x[1])],
        "prs": [{"exercise": p.get("exercise_name"), "label": p.get("label") or p.get("pr_type"),
                 "value": p.get("value"), "date": (p.get("created_at") or "")[:10]} for p in prs[:12]],
    }


async def _report_recovery(uid: str, start: str, end: str) -> Dict[str, Any]:
    rng = {"$gte": start, "$lte": end}
    sleep = await db.sleep_logs.find({"user_id": uid, "date": rng}).to_list(200)
    health = await db.health_daily.find({"user_id": uid, "date": rng}).to_list(200)

    def avg(rows: List[Dict[str, Any]], key: str) -> Optional[float]:
        vals = [r[key] for r in rows if r.get(key) is not None]
        return round(sum(vals) / len(vals), 1) if vals else None

    steps = avg(health, "steps")
    return {
        "sleep_nights": len(sleep),
        "sleep_avg_hours": avg(sleep, "hours"),
        "sleep_quality": avg(sleep, "quality"),
        "days_synced": len(health),
        "steps_avg": int(steps) if steps is not None else None,
        "resting_hr_avg": avg(health, "resting_hr"),
        "hrv_avg": avg(health, "hrv"),
        "active_energy_avg": avg(health, "active_energy"),
    }


async def _report_habits(uid: str, start: str, end: str, days_elapsed: int) -> List[Dict[str, Any]]:
    habits = await db.habits.find({"user_id": uid, "archived": {"$ne": True}}).to_list(50)
    if not habits or days_elapsed <= 0:
        return []
    logs = await db.habit_logs.find({"user_id": uid, "date": {"$gte": start, "$lte": end}}).to_list(5000)
    by_habit: Dict[str, List[Dict[str, Any]]] = {}
    for lg in logs:
        by_habit.setdefault(lg.get("habit_id", ""), []).append(lg)
    out = []
    for h in habits:
        mine = by_habit.get(str(h["_id"]), [])
        if h.get("type") == "count":
            tgt = h.get("target") or 0
            done = sum(1 for lg in mine if tgt and (lg.get("value") or 0) >= tgt)
        else:
            done = sum(1 for lg in mine if lg.get("completed"))
        out.append({"name": h.get("name"), "emoji": h.get("emoji"), "done": done,
                    "days": days_elapsed, "pct": round(_pct(done, days_elapsed))})
    return sorted(out, key=lambda x: -x["pct"])


async def _report_nutrition(uid: str, start: str, end: str) -> Optional[Dict[str, Any]]:
    rows = await db.intake_entries.find(
        {"user_id": uid, "date": {"$gte": start, "$lte": end}}
    ).to_list(5000)
    if not rows:
        return None
    from intake import _sum  # deferred: intake is wired in at the bottom of this file
    by_date: Dict[str, List[Dict[str, Any]]] = {}
    for e in rows:
        by_date.setdefault(e.get("date", ""), []).append(e)
    totals = [_sum(v) for v in by_date.values()]
    n = len(totals)
    return {
        "days_logged": n,
        "avg_calories": round(sum(t.get("calories", 0) for t in totals) / n),
        "avg_protein_g": round(sum(t.get("protein_g", 0) for t in totals) / n),
    }


def _report_signature(training: Dict[str, Any], recovery: Dict[str, Any]) -> str:
    """Short hash of the headline numbers — a cached narrative that no longer
    matches these is shown as stale rather than silently misreporting."""
    payload = json.dumps([
        training["workouts"], training["volume_kg"], training["sets"],
        training["duration_seconds"], len(training["prs"]),
        recovery["sleep_nights"], recovery["sleep_avg_hours"], recovery["days_synced"],
    ], sort_keys=True)
    return hashlib.sha1(payload.encode()).hexdigest()[:12]


async def _build_report(user: Dict[str, Any], period: str, offset: int,
                        today: Optional[str]) -> Dict[str, Any]:
    uid = str(user["_id"])
    b = _period_bounds(period, offset, today)
    prev_b = _period_bounds(period, offset + 1, today)

    training = await _report_training(uid, b["start"], b["end"])
    prev_training = await _report_training(uid, prev_b["start"], prev_b["end"])
    recovery = await _report_recovery(uid, b["start"], b["end"])
    habits = await _report_habits(uid, b["start"], b["end"], b["days_elapsed"])
    nutrition = await _report_nutrition(uid, b["start"], b["end"])

    settings = {**DEFAULT_WORKOUT_SETTINGS, **(user.get("workout_settings") or {})}
    weekly_target = max(1, int(settings.get("weekly_workout_target") or 4))
    weeks = b["days_total"] / 7
    signature = _report_signature(training, recovery)

    cached = await db.reports.find_one({"user_id": uid, "period": period, "start": b["start"]})
    narrative = None
    if cached:
        narrative = {
            "text": cached.get("text", ""),
            "generated_at": cached.get("created_at"),
            "provider": cached.get("provider"),
            "stale": cached.get("signature") != signature,
        }

    return {
        **b,
        "workout_target": round(weekly_target * weeks),
        "training": training,
        "previous": {
            "label": prev_b["label"], "workouts": prev_training["workouts"],
            "volume_kg": prev_training["volume_kg"], "sets": prev_training["sets"],
            "duration_seconds": prev_training["duration_seconds"],
        },
        "recovery": recovery,
        "habits": habits,
        "nutrition": nutrition,
        "has_data": bool(training["workouts"] or recovery["sleep_nights"]
                         or recovery["days_synced"] or habits or nutrition),
        "signature": signature,
        "narrative": narrative,
        "ai_configured": bool(coach_provider()),
    }


REPORT_SYSTEM = (
    "You are CG's LifeOS AI Coach writing the user's {period}ly report for {label}.\n"
    "You are given ONLY the computed numbers below — every one of them is also shown to the "
    "user on the same page. Use them; never invent a figure, an exercise or a study.\n\n"
    "Write:\n"
    "- One opening line on how the {period} went.\n"
    "- **Wins** — sessions, volume, PRs, habit streaks. Bold the real numbers.\n"
    "- **Watch** — undertrained muscles, a drop vs the previous {period}, short sleep, "
    "slipping habits. Be honest but never scolding.\n"
    "- **Next {period}** — exactly one concrete focus.\n"
    "Compare against the previous {period} when the numbers make it meaningful. "
    "Keep it under {words} words, short bullets, second person. "
    "If there is little data, say so warmly and give one first step."
)


@api.get("/reports")
async def get_report(period: str = "week", offset: int = 0, today: Optional[str] = None,
                     user=Depends(get_current_user)):
    """Computed summary for one week/month, plus the cached AI narrative if any."""
    return await _build_report(user, period, offset, today)


@api.post("/reports/narrative")
async def write_report_narrative(period: str = "week", offset: int = 0, today: Optional[str] = None,
                                 user=Depends(get_current_user)):
    """Generate (and cache) the AI narrative for one period."""
    report = await _build_report(user, period, offset, today)
    # An empty period is a bad request whether or not a provider is configured —
    # there is nothing to narrate, and asking anyway just burns a call.
    if not report["has_data"]:
        raise HTTPException(400, "Nothing logged in this period yet")
    provider = coach_provider()
    if not provider:
        return {**report, "configured": False}

    facts = {k: report[k] for k in ("label", "start", "end", "days_elapsed", "workout_target",
                                    "training", "previous", "recovery", "habits", "nutrition")}
    system = REPORT_SYSTEM.format(period=period, label=report["label"],
                                  words=200 if period == "week" else 300)
    messages = [{"role": "user", "content": json.dumps(facts, default=str)}]
    try:
        if provider == "groq":
            text = await call_groq(system, messages)
        else:
            client = get_anthropic()
            resp = await client.messages.create(model=COACH_MODEL, max_tokens=900,
                                                system=system, messages=messages)
            text = "".join(b.text for b in resp.content if b.type == "text").strip()
    except Exception as e:
        logger.exception("report narrative failed")
        raise HTTPException(502, f"AI request failed: {e}")

    now = datetime.now(timezone.utc).isoformat()
    await db.reports.update_one(
        {"user_id": str(user["_id"]), "period": period, "start": report["start"]},
        {"$set": {"text": text, "provider": provider, "signature": report["signature"],
                  "label": report["label"], "created_at": now}},
        upsert=True,
    )
    return {**report, "configured": True,
            "narrative": {"text": text, "generated_at": now, "provider": provider, "stale": False}}


# ── ACHIEVEMENTS ──────────────────────────────────────────────────────────────
# Badges are DERIVED, never logged: every one is a threshold on data the user has
# already recorded, so nothing new has to be tracked to earn them. The only thing
# stored is the moment each was first observed — the state itself is recomputed,
# which means an achievement can't drift out of sync with the data behind it (and
# deleting a mistyped 500 kg set correctly takes its badge with it).
#
# Locked badges show progress on purpose. "3 of 10 workouts" is the part that
# motivates; a wall of grey padlocks is just a list of things you haven't done.
ACHIEVEMENTS: List[Dict[str, Any]] = [
    # metric → the key returned by _achievement_metrics
    {"key": "workouts_1", "group": "Consistency", "icon": "dumbbell", "metric": "workouts",
     "target": 1, "name": "First rep", "description": "Log your first workout"},
    {"key": "workouts_10", "group": "Consistency", "icon": "dumbbell", "metric": "workouts",
     "target": 10, "name": "Getting into it", "description": "Log 10 workouts"},
    {"key": "workouts_25", "group": "Consistency", "icon": "dumbbell", "metric": "workouts",
     "target": 25, "name": "Habit forming", "description": "Log 25 workouts"},
    {"key": "workouts_50", "group": "Consistency", "icon": "dumbbell", "metric": "workouts",
     "target": 50, "name": "Half century", "description": "Log 50 workouts"},
    {"key": "workouts_100", "group": "Consistency", "icon": "dumbbell", "metric": "workouts",
     "target": 100, "name": "Century club", "description": "Log 100 workouts"},
    {"key": "workouts_250", "group": "Consistency", "icon": "dumbbell", "metric": "workouts",
     "target": 250, "name": "Iron veteran", "description": "Log 250 workouts"},
    {"key": "weekstreak_2", "group": "Consistency", "icon": "calendar", "metric": "week_streak",
     "target": 2, "name": "Two in a row", "description": "Hit your weekly training goal 2 weeks running"},
    {"key": "weekstreak_4", "group": "Consistency", "icon": "calendar", "metric": "week_streak",
     "target": 4, "name": "Month on target", "description": "Hit your weekly training goal 4 weeks running"},
    {"key": "weekstreak_12", "group": "Consistency", "icon": "calendar", "metric": "week_streak",
     "target": 12, "name": "Quarter on target", "description": "Hit your weekly training goal 12 weeks running"},

    {"key": "volume_10k", "group": "Volume", "icon": "weight", "metric": "volume_kg",
     "target": 10_000, "name": "Ten tonnes", "description": "Lift 10,000 kg in total"},
    {"key": "volume_50k", "group": "Volume", "icon": "weight", "metric": "volume_kg",
     "target": 50_000, "name": "Fifty tonnes", "description": "Lift 50,000 kg in total"},
    {"key": "volume_250k", "group": "Volume", "icon": "weight", "metric": "volume_kg",
     "target": 250_000, "name": "Quarter million", "description": "Lift 250,000 kg in total"},
    {"key": "volume_1m", "group": "Volume", "icon": "weight", "metric": "volume_kg",
     "target": 1_000_000, "name": "Millionaire", "description": "Lift 1,000,000 kg in total"},
    {"key": "time_10h", "group": "Volume", "icon": "clock", "metric": "duration_seconds",
     "target": 36_000, "name": "Ten hours in", "description": "Spend 10 hours training"},
    {"key": "time_50h", "group": "Volume", "icon": "clock", "metric": "duration_seconds",
     "target": 180_000, "name": "Fifty hours in", "description": "Spend 50 hours training"},
    {"key": "time_100h", "group": "Volume", "icon": "clock", "metric": "duration_seconds",
     "target": 360_000, "name": "Hundred hours in", "description": "Spend 100 hours training"},

    {"key": "pr_1", "group": "Strength", "icon": "trophy", "metric": "prs",
     "target": 1, "name": "First record", "description": "Set your first personal record"},
    {"key": "pr_10", "group": "Strength", "icon": "trophy", "metric": "prs",
     "target": 10, "name": "Record breaker", "description": "Set 10 personal records"},
    {"key": "pr_50", "group": "Strength", "icon": "trophy", "metric": "prs",
     "target": 50, "name": "Never satisfied", "description": "Set 50 personal records"},

    {"key": "habit_streak_7", "group": "Habits", "icon": "flame", "metric": "habit_streak",
     "target": 7, "name": "Week of discipline", "description": "Keep one habit for 7 days straight"},
    {"key": "habit_streak_30", "group": "Habits", "icon": "flame", "metric": "habit_streak",
     "target": 30, "name": "Thirty-day habit", "description": "Keep one habit for 30 days straight"},
    {"key": "habit_done_100", "group": "Habits", "icon": "flame", "metric": "habit_completions",
     "target": 100, "name": "Hundred check-ins", "description": "Complete a habit 100 times"},

    {"key": "sleep_7", "group": "Recovery", "icon": "moon", "metric": "sleep_nights",
     "target": 7, "name": "Sleep on record", "description": "Log 7 nights of sleep"},
    {"key": "sleep_30", "group": "Recovery", "icon": "moon", "metric": "sleep_nights",
     "target": 30, "name": "A month of nights", "description": "Log 30 nights of sleep"},
    {"key": "sleep_streak_7", "group": "Recovery", "icon": "moon", "metric": "sleep_good_streak",
     "target": 7, "name": "Seven good nights", "description": "Sleep 7 h or more, 7 nights running"},
    {"key": "steps_10k", "group": "Recovery", "icon": "footprints", "metric": "best_steps",
     "target": 10_000, "name": "Ten thousand steps", "description": "Walk 10,000 steps in a day"},
    {"key": "synced_30", "group": "Recovery", "icon": "footprints", "metric": "days_synced",
     "target": 30, "name": "Wired up", "description": "Sync 30 days of health data"},

    {"key": "intake_7", "group": "Nutrition", "icon": "apple", "metric": "intake_days",
     "target": 7, "name": "Watching what you eat", "description": "Log your food on 7 days"},
    {"key": "intake_30", "group": "Nutrition", "icon": "apple", "metric": "intake_days",
     "target": 30, "name": "Tracked for a month", "description": "Log your food on 30 days"},
]


def _longest_run(dates: set) -> int:
    """Longest run of consecutive calendar days in a set of YYYY-MM-DD strings."""
    days = sorted(d for d in dates if d)
    best = run = 0
    prev: Optional[date] = None
    for s in days:
        try:
            cur = date.fromisoformat(s)
        except ValueError:
            continue  # a malformed key can't extend a streak, but must not end the scan
        run = run + 1 if prev is not None and (cur - prev).days == 1 else 1
        best = max(best, run)
        prev = cur
    return best


async def _achievement_metrics(user: Dict[str, Any]) -> Dict[str, float]:
    """Every number the badge thresholds are checked against, computed fresh."""
    uid = str(user["_id"])
    stats = await workout_stats(user)

    settings = {**DEFAULT_WORKOUT_SETTINGS, **(user.get("workout_settings") or {})}
    weekly_target = max(1, int(settings.get("weekly_workout_target") or 4))
    per_week: Dict[str, int] = {}
    async for w in db.workout_sessions.find({"user_id": uid}, {"created_at": 1}):
        try:
            d = date.fromisoformat((w.get("created_at") or "")[:10])
        except ValueError:
            continue
        monday = (d - timedelta(days=d.weekday())).isoformat()
        per_week[monday] = per_week.get(monday, 0) + 1
    # Count back from this week, or from last week when this one is still in
    # progress — an unfinished week must not break a streak it could still meet.
    today = datetime.now(timezone.utc).date()
    cursor = today - timedelta(days=today.weekday())
    if per_week.get(cursor.isoformat(), 0) < weekly_target:
        cursor -= timedelta(days=7)
    week_streak = 0
    while per_week.get(cursor.isoformat(), 0) >= weekly_target:
        week_streak += 1
        cursor -= timedelta(days=7)

    habits = await db.habits.find({"user_id": uid}).to_list(200)
    habit_logs = await db.habit_logs.find({"user_id": uid}).to_list(20000)
    by_habit: Dict[str, List[Dict[str, Any]]] = {}
    for lg in habit_logs:
        by_habit.setdefault(lg.get("habit_id", ""), []).append(lg)
    habit_completions = 0
    habit_streak = 0
    for h in habits:
        tgt = h.get("target") or 1
        counted = h.get("type") == "count"
        done = {lg.get("date") for lg in by_habit.get(str(h["_id"]), [])
                if ((lg.get("value") or 0) >= tgt if counted else bool(lg.get("completed")))}
        habit_completions += len(done)
        habit_streak = max(habit_streak, _longest_run(done))

    sleep = await db.sleep_logs.find({"user_id": uid}).to_list(3000)
    health = await db.health_daily.find({"user_id": uid}).to_list(3000)
    intake_days = await db.intake_entries.distinct("date", {"user_id": uid})

    return {
        "workouts": stats["total_workouts"],
        "volume_kg": stats["total_volume"],
        "duration_seconds": stats["total_duration"],
        "prs": await db.pr_events.count_documents({"user_id": uid}),
        "week_streak": week_streak,
        "habit_completions": habit_completions,
        "habit_streak": habit_streak,
        "sleep_nights": len(sleep),
        "sleep_good_streak": _longest_run({s.get("date") for s in sleep if (s.get("hours") or 0) >= 7}),
        "best_steps": max([h.get("steps") or 0 for h in health], default=0),
        "days_synced": len(health),
        "intake_days": len(intake_days),
    }


@api.get("/achievements")
async def list_achievements(user=Depends(get_current_user)):
    uid = str(user["_id"])
    metrics = await _achievement_metrics(user)
    stored = {d["key"]: d for d in await db.achievement_unlocks.find({"user_id": uid}).to_list(500)}
    # An account with history earns a pile on its first ever read. Flagging all of
    # them "new" would bury the one that actually just happened, so the first pass
    # is recorded as already seen.
    first_pass = not stored
    now = datetime.now(timezone.utc).isoformat()

    out, fresh, retracted = [], [], []
    for a in ACHIEVEMENTS:
        value = metrics.get(a["metric"], 0) or 0
        target = a["target"]
        unlocked = value >= target
        rec = stored.get(a["key"])
        if unlocked and not rec:
            rec = {"user_id": uid, "key": a["key"], "unlocked_at": now, "seen": first_pass}
            fresh.append(rec)
        elif rec and not unlocked:
            # The data that earned it is gone (a workout deleted, a log removed).
            # Drop the record too rather than leave a badge the numbers no longer
            # support — the same lesson as the ghost PRs in §14.
            retracted.append(a["key"])
            rec = None
        out.append({
            "key": a["key"], "group": a["group"], "icon": a["icon"], "name": a["name"],
            "description": a["description"], "target": target,
            # The frontend needs the metric to know whether "36000" is kilos,
            # seconds or a count of days before it can label the progress bar.
            "metric": a["metric"],
            "value": round(value, 1),
            "progress": round(min(1.0, value / target), 3) if target else 0,
            "unlocked": unlocked,
            "unlocked_at": rec.get("unlocked_at") if rec else None,
            # Stays true until the achievements page is opened, so a badge earned
            # mid-workout is still announced whenever the user next looks.
            "new": bool(rec and not rec.get("seen")),
        })
    if fresh:
        await db.achievement_unlocks.insert_many(fresh)
    if retracted:
        await db.achievement_unlocks.delete_many({"user_id": uid, "key": {"$in": retracted}})

    unlocked = [a for a in out if a["unlocked"]]
    return {
        "achievements": out,
        "groups": list(dict.fromkeys(a["group"] for a in ACHIEVEMENTS)),
        "unlocked_count": len(unlocked),
        "total": len(out),
        "new_count": sum(1 for a in out if a["new"]),
        # The three nearest misses — the useful half of a locked badge.
        "next_up": sorted([a for a in out if not a["unlocked"]],
                          key=lambda a: -a["progress"])[:3],
    }


@api.post("/achievements/seen")
async def mark_achievements_seen(user=Depends(get_current_user)):
    res = await db.achievement_unlocks.update_many(
        {"user_id": str(user["_id"]), "seen": {"$ne": True}}, {"$set": {"seen": True}})
    return {"ok": True, "marked": res.modified_count}


# ── CHALLENGES ────────────────────────────────────────────────────────────────
# A challenge is a run of days with rules that must all be met each day. Wherever
# the app can already see the answer it checks itself — a workout logged is a
# workout logged, and asking the user to also tick a box for it is how challenge
# trackers become a second chore. Only what the app genuinely cannot observe
# (pages read, a photo taken, water drunk) is a manual tick.
#
# `strict` is the 75 Hard rule: miss a day and the run restarts. That is derived
# too — nothing is reset or deleted, the current run is simply measured from the
# day after the last miss, so the history stays honest and the restart count is a
# fact about the data rather than a counter someone has to keep in sync.
CHALLENGE_METRICS: Dict[str, Dict[str, Any]] = {
    "workouts": {"label": "Workouts logged", "unit": "sessions", "compare": "min", "source": "workouts"},
    "steps": {"label": "Steps", "unit": "steps", "compare": "min", "source": "health"},
    "sleep_hours": {"label": "Sleep", "unit": "h", "compare": "min", "source": "sleep"},
    "calories_max": {"label": "Calories under", "unit": "kcal", "compare": "max", "source": "intake"},
    "protein_g": {"label": "Protein", "unit": "g", "compare": "min", "source": "intake"},
    "intake_logged": {"label": "Food logged", "unit": "entries", "compare": "min", "source": "intake"},
    "habits_all": {"label": "All habits done", "unit": "habits", "compare": "min", "source": "habits"},
    "manual": {"label": "Ticked by hand", "unit": "", "compare": "min", "source": "manual"},
}

CHALLENGE_TEMPLATES: List[Dict[str, Any]] = [
    {
        "key": "75_hard", "name": "75 Hard", "days": 75, "strict": True,
        "description": "Two workouts a day, one of them outdoors. Follow your nutrition. "
                       "No missed days — slip once and you start again at day 1.",
        "rules": [
            {"label": "Two workouts", "metric": "workouts", "target": 2},
            {"label": "Followed my nutrition", "metric": "intake_logged", "target": 1},
            {"label": "Drank 4 litres of water", "metric": "manual", "target": 1},
            {"label": "Read 10 pages", "metric": "manual", "target": 1},
            {"label": "Progress photo", "metric": "manual", "target": 1},
        ],
    },
    {
        "key": "30_day_cut", "name": "30-Day Cut", "days": 30, "strict": False,
        "description": "A month of eating in a deficit while keeping protein and training high.",
        "rules": [
            {"label": "Calories under target", "metric": "calories_max", "target": 2000},
            {"label": "Protein hit", "metric": "protein_g", "target": 150},
            {"label": "Trained today", "metric": "workouts", "target": 1},
            {"label": "8,000 steps", "metric": "steps", "target": 8000},
        ],
    },
    {
        "key": "21_day_reset", "name": "21-Day Reset", "days": 21, "strict": False,
        "description": "Three weeks of getting the basics right — habits, sleep, movement.",
        "rules": [
            {"label": "Every habit done", "metric": "habits_all", "target": 1},
            {"label": "7 hours of sleep", "metric": "sleep_hours", "target": 7},
            {"label": "8,000 steps", "metric": "steps", "target": 8000},
        ],
    },
    {
        "key": "consistency_14", "name": "14-Day Consistency", "days": 14, "strict": False,
        "description": "Two weeks of showing up. One session, one honest food log, a decent night.",
        "rules": [
            {"label": "Trained today", "metric": "workouts", "target": 1},
            {"label": "Food logged", "metric": "intake_logged", "target": 1},
            {"label": "7 hours of sleep", "metric": "sleep_hours", "target": 7},
        ],
    },
]


def _date_range(start: str, end: str) -> List[str]:
    a, b = date.fromisoformat(start), date.fromisoformat(end)
    return [(a + timedelta(days=i)).isoformat() for i in range((b - a).days + 1)]


async def _challenge_daily_data(uid: str, ch: Dict[str, Any], dates: List[str]) -> Dict[str, Dict[str, float]]:
    """Every metric a rule might ask about, per date, fetched once for the range."""
    needed = {CHALLENGE_METRICS.get(r["metric"], {}).get("source") for r in ch.get("rules", [])}
    start, end = dates[0], dates[-1]
    out: Dict[str, Dict[str, float]] = {d: {} for d in dates}

    if "workouts" in needed:
        async for w in db.workout_sessions.find(
            {"user_id": uid, "created_at": {"$gte": f"{start}T00:00:00", "$lt": f"{_next_day(end)}T00:00:00"}},
            {"created_at": 1},
        ):
            d = (w.get("created_at") or "")[:10]
            if d in out:
                out[d]["workouts"] = out[d].get("workouts", 0) + 1

    if "health" in needed:
        for h in await db.health_daily.find({"user_id": uid, "date": {"$gte": start, "$lte": end}}).to_list(400):
            if h.get("date") in out:
                out[h["date"]]["steps"] = h.get("steps") or 0

    if "sleep" in needed:
        for s in await db.sleep_logs.find({"user_id": uid, "date": {"$gte": start, "$lte": end}}).to_list(400):
            if s.get("date") in out:
                out[s["date"]]["sleep_hours"] = s.get("hours") or 0

    if "intake" in needed:
        from intake import _sum  # deferred: intake is wired in at the bottom of this file
        rows = await db.intake_entries.find({"user_id": uid, "date": {"$gte": start, "$lte": end}}).to_list(5000)
        by_date: Dict[str, List[Dict[str, Any]]] = {}
        for e in rows:
            by_date.setdefault(e.get("date", ""), []).append(e)
        for d, entries in by_date.items():
            if d not in out:
                continue
            totals = _sum(entries)
            out[d].update({
                "intake_logged": len(entries),
                "calories_max": totals.get("calories", 0),
                "protein_g": totals.get("protein_g", 0),
            })

    if "habits" in needed:
        habits = await db.habits.find({"user_id": uid, "archived": {"$ne": True}}).to_list(100)
        logs = await db.habit_logs.find({"user_id": uid, "date": {"$gte": start, "$lte": end}}).to_list(5000)
        done_count: Dict[str, int] = {}
        by_id = {str(h["_id"]): h for h in habits}
        for lg in logs:
            h = by_id.get(lg.get("habit_id", ""))
            if not h or lg.get("date") not in out:
                continue
            ok = ((lg.get("value") or 0) >= (h.get("target") or 1)) if h.get("type") == "count" else bool(lg.get("completed"))
            if ok:
                done_count[lg["date"]] = done_count.get(lg["date"], 0) + 1
        for d in dates:
            # With no habits set up the rule can't be satisfied — reporting 0 of 0
            # as "done" would hand out a free tick every day.
            out[d]["habits_all"] = 1 if habits and done_count.get(d, 0) >= len(habits) else 0

    if "manual" in needed:
        for lg in await db.challenge_logs.find(
            {"user_id": uid, "challenge_id": str(ch["_id"]), "date": {"$gte": start, "$lte": end}}
        ).to_list(500):
            if lg.get("date") in out:
                for k, v in (lg.get("values") or {}).items():
                    out[lg["date"]][f"manual:{k}"] = 1 if v else 0

    return out


def _rule_state(rule: Dict[str, Any], day: Dict[str, float]) -> Dict[str, Any]:
    metric = rule["metric"]
    target = rule.get("target") or 1
    value = day.get(f"manual:{rule['key']}", 0) if metric == "manual" else (day.get(metric) or 0)
    compare = CHALLENGE_METRICS.get(metric, {}).get("compare", "min")
    # A "stay under" rule is only met once there is something to judge — an
    # untouched food diary is not a day under 2,000 kcal.
    met = (value <= target and day.get("intake_logged", 0) > 0) if compare == "max" else value >= target
    return {**rule, "value": round(value, 1), "met": bool(met), "compare": compare,
            "unit": CHALLENGE_METRICS.get(metric, {}).get("unit", "")}


async def _challenge_progress(user: Dict[str, Any], ch: Dict[str, Any], today: str) -> Dict[str, Any]:
    uid = str(user["_id"])
    start = ch["start_date"]
    total = int(ch.get("days") or 1)
    last = (date.fromisoformat(start) + timedelta(days=total - 1)).isoformat()
    if today < start:
        dates: List[str] = []
    else:
        dates = _date_range(start, min(today, last))

    daily = await _challenge_daily_data(uid, ch, dates) if dates else {}
    day_states, today_rules = [], []
    for d in dates:
        states = [_rule_state(r, daily.get(d, {})) for r in ch["rules"]]
        day_states.append({"date": d, "complete": all(s["met"] for s in states),
                           "met": sum(1 for s in states if s["met"]), "of": len(states)})
        if d == today:
            today_rules = states

    done = sum(1 for d in day_states if d["complete"])
    # Only a day that is over can be a miss — today is still winnable.
    past = [d for d in day_states if d["date"] < today]
    misses = [d["date"] for d in past if not d["complete"]]

    # "Restarts" is how many times a run that had got going was broken — three
    # missed days in a row is one collapse, not three.
    restarts, streak_so_far = 0, 0
    for d in past:
        if d["complete"]:
            streak_so_far += 1
        else:
            restarts += 1 if streak_so_far else 0
            streak_so_far = 0

    if ch.get("strict") and misses:
        run_start = (date.fromisoformat(misses[-1]) + timedelta(days=1)).isoformat()
        run = [d for d in day_states if d["date"] >= run_start]
        # Today is the day you are ON, not a day you have banked — it counts
        # toward current_day but never toward the completed streak.
        streak = sum(1 for d in run if d["complete"])
        current_day = len(run)
    else:
        run_start = start
        streak = done
        current_day = len(dates)

    completed = (streak >= total) if ch.get("strict") else (done >= total)
    if ch.get("abandoned_at"):
        status = "abandoned"
    elif completed:
        status = "completed"
    elif today > last:
        status = "ended"
    elif today < start:
        status = "upcoming"
    else:
        status = "active"

    return {
        "id": str(ch["_id"]), "name": ch["name"], "description": ch.get("description", ""),
        "days": total, "strict": bool(ch.get("strict")), "template": ch.get("template"),
        "rules": ch["rules"], "start_date": start, "end_date": last,
        "status": status, "current_day": min(current_day, total), "days_done": done,
        "streak": streak, "restarts": restarts if ch.get("strict") else 0,
        "missed_days": misses, "run_start": run_start,
        "today_rules": today_rules, "day_states": day_states,
        "percent": round(100 * (streak if ch.get("strict") else done) / total),
    }


def _clean_rules(rules: List[ChallengeRuleIn]) -> List[Dict[str, Any]]:
    out = []
    for i, r in enumerate(rules):
        if r.metric not in CHALLENGE_METRICS:
            raise HTTPException(400, f"Unknown rule metric '{r.metric}'")
        # Keys are assigned here, never taken from the client: they are the join
        # key for manual ticks, so a duplicate would tie two rules together.
        out.append({"key": f"r{i + 1}", "label": r.label.strip(),
                    "metric": r.metric, "target": r.target})
    return out


@api.get("/challenges/templates")
async def challenge_templates():
    return {"templates": CHALLENGE_TEMPLATES, "metrics": CHALLENGE_METRICS}


@api.get("/challenges")
async def list_challenges(today: Optional[str] = None, user=Depends(get_current_user)):
    try:
        day = date.fromisoformat(today).isoformat() if today else datetime.now(timezone.utc).date().isoformat()
    except ValueError:
        raise HTTPException(400, "today must be YYYY-MM-DD")
    docs = await db.challenges.find({"user_id": str(user["_id"])}).sort("created_at", -1).to_list(50)
    out = [await _challenge_progress(user, ch, day) for ch in docs]
    active = next((c for c in out if c["status"] in ("active", "upcoming")), None)
    return {"active": active, "challenges": out, "today": day}


@api.post("/challenges")
async def create_challenge(payload: ChallengeIn, user=Depends(get_current_user)):
    uid = str(user["_id"])
    today = datetime.now(timezone.utc).date().isoformat()
    existing = await db.challenges.find({"user_id": uid, "abandoned_at": None}).to_list(50)
    for ch in existing:
        prog = await _challenge_progress(user, ch, payload.start_date or today)
        # One at a time on purpose: two challenges with conflicting daily rules
        # is a way to fail both.
        if prog["status"] in ("active", "upcoming"):
            raise HTTPException(400, f"'{ch['name']}' is still running — finish or abandon it first")

    doc = {
        "user_id": uid, "name": payload.name.strip(), "description": payload.description.strip(),
        "days": payload.days, "strict": payload.strict, "rules": _clean_rules(payload.rules),
        "start_date": payload.start_date or today, "template": payload.template,
        "abandoned_at": None, "created_at": datetime.now(timezone.utc).isoformat(),
    }
    res = await db.challenges.insert_one(doc)
    doc["_id"] = res.inserted_id
    return await _challenge_progress(user, doc, today)


@api.post("/challenges/{challenge_id}/log")
async def log_challenge_rule(challenge_id: str, payload: ChallengeLogIn, user=Depends(get_current_user)):
    uid = str(user["_id"])
    ch = await db.challenges.find_one({"_id": _oid(challenge_id, "Challenge not found"), "user_id": uid})
    if not ch:
        raise HTTPException(404, "Challenge not found")
    rule = next((r for r in ch["rules"] if r["key"] == payload.rule_key), None)
    if not rule:
        raise HTTPException(404, "Rule not found")
    if rule["metric"] != "manual":
        # Ticking a derived rule by hand would let the box disagree with the data
        # underneath it, which is exactly the thing this design avoids.
        raise HTTPException(400, f"'{rule['label']}' is checked from your logged data, not by hand")

    day = payload.date or datetime.now(timezone.utc).date().isoformat()
    if not (ch["start_date"] <= day <= (date.fromisoformat(ch["start_date"]) + timedelta(days=ch["days"] - 1)).isoformat()):
        raise HTTPException(400, "That date is outside the challenge")
    await db.challenge_logs.update_one(
        {"user_id": uid, "challenge_id": challenge_id, "date": day},
        {"$set": {f"values.{payload.rule_key}": payload.done}},
        upsert=True,
    )
    return await _challenge_progress(user, ch, datetime.now(timezone.utc).date().isoformat())


@api.delete("/challenges/{challenge_id}")
async def abandon_challenge(challenge_id: str, purge: bool = False, user=Depends(get_current_user)):
    """Abandon a challenge (kept in history), or `purge=true` to erase it."""
    uid = str(user["_id"])
    oid = _oid(challenge_id, "Challenge not found")
    if purge:
        res = await db.challenges.delete_one({"_id": oid, "user_id": uid})
        if not res.deleted_count:
            raise HTTPException(404, "Challenge not found")
        await db.challenge_logs.delete_many({"user_id": uid, "challenge_id": challenge_id})
        return {"ok": True, "purged": True}
    res = await db.challenges.update_one(
        {"_id": oid, "user_id": uid},
        {"$set": {"abandoned_at": datetime.now(timezone.utc).isoformat()}})
    if not res.matched_count:
        raise HTTPException(404, "Challenge not found")
    return {"ok": True, "purged": False}


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
