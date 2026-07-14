"""Intake — calorie / macro / micronutrient tracking.

Self-contained module. Everything this feature needs lives here; `server.py`
mounts it with `build_router(...)` and injects its dependencies, so nothing in
the rest of the backend has to know this exists. Delete the mount + this file
and the app is unchanged.

Two ways to log food:
  1. Manual  — the user types the numbers (or a description we price with AI).
  2. Photo   — the user snaps the meal; a vision model identifies it and
               estimates nutrients. Nothing is saved until the user confirms.

Collections owned by this module (both scoped by user_id):
  intake_entries  — one document per logged food item
  intake_targets  — one document per user (daily goals)
"""
import base64
import binascii
import json
import logging
import os
import re
from datetime import datetime, timezone, timedelta
from typing import Any, Callable, Dict, List, Optional

import httpx
from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger("lifeos.intake")


# ──────────────────────────────────────────────────────────────────────────────
# Nutrient definitions — the single source of truth for the whole feature.
# The AI prompt, the DB shape, the API schema and the UI all derive from this.
# Add a nutrient here and it flows everywhere; nothing else needs to change.
# ──────────────────────────────────────────────────────────────────────────────
NUTRIENTS: List[Dict[str, Any]] = [
    # key,            label,          unit,   group,   default target (male/female)
    {"key": "calories",     "label": "Calories",    "unit": "kcal", "group": "energy"},
    {"key": "protein_g",    "label": "Protein",     "unit": "g",    "group": "macro"},
    {"key": "carbs_g",      "label": "Carbs",       "unit": "g",    "group": "macro"},
    {"key": "fat_g",        "label": "Fat",         "unit": "g",    "group": "macro"},
    {"key": "fiber_g",      "label": "Fiber",       "unit": "g",    "group": "macro"},
    {"key": "sugar_g",      "label": "Sugar",       "unit": "g",    "group": "macro", "limit": True},
    {"key": "sat_fat_g",    "label": "Saturated fat", "unit": "g",  "group": "macro", "limit": True},
    {"key": "sodium_mg",    "label": "Sodium",      "unit": "mg",   "group": "micro", "limit": True},
    {"key": "potassium_mg", "label": "Potassium",   "unit": "mg",   "group": "micro"},
    {"key": "calcium_mg",   "label": "Calcium",     "unit": "mg",   "group": "micro"},
    {"key": "iron_mg",      "label": "Iron",        "unit": "mg",   "group": "micro"},
    {"key": "magnesium_mg", "label": "Magnesium",   "unit": "mg",   "group": "micro"},
    {"key": "zinc_mg",      "label": "Zinc",        "unit": "mg",   "group": "micro"},
    {"key": "vitamin_c_mg", "label": "Vitamin C",   "unit": "mg",   "group": "micro"},
    {"key": "vitamin_a_mcg", "label": "Vitamin A",  "unit": "mcg",  "group": "micro"},
    {"key": "vitamin_d_mcg", "label": "Vitamin D",  "unit": "mcg",  "group": "micro"},
    {"key": "cholesterol_mg", "label": "Cholesterol", "unit": "mg", "group": "micro", "limit": True},
]

NUTRIENT_KEYS = [n["key"] for n in NUTRIENTS]
MEALS = ["breakfast", "lunch", "dinner", "snack", "pre_workout", "post_workout"]

# Micronutrient RDAs — used when the user hasn't set their own targets.
# "limit" nutrients are ceilings to stay under, not goals to hit.
RDA = {
    "male": {
        "fiber_g": 38, "sugar_g": 50, "sat_fat_g": 22, "sodium_mg": 2300,
        "potassium_mg": 3400, "calcium_mg": 1000, "iron_mg": 8, "magnesium_mg": 400,
        "zinc_mg": 11, "vitamin_c_mg": 90, "vitamin_a_mcg": 900, "vitamin_d_mcg": 15,
        "cholesterol_mg": 300,
    },
    "female": {
        "fiber_g": 25, "sugar_g": 40, "sat_fat_g": 18, "sodium_mg": 2300,
        "potassium_mg": 2600, "calcium_mg": 1000, "iron_mg": 18, "magnesium_mg": 310,
        "zinc_mg": 8, "vitamin_c_mg": 75, "vitamin_a_mcg": 700, "vitamin_d_mcg": 15,
        "cholesterol_mg": 300,
    },
}


# ──────────────────────────────────────────────────────────────────────────────
# AI config — vision + text nutrition estimation
# ──────────────────────────────────────────────────────────────────────────────
VISION_MODEL = os.environ.get("INTAKE_VISION_MODEL", "claude-opus-4-8")
GROQ_VISION_MODEL = os.environ.get(
    "INTAKE_GROQ_VISION_MODEL", "meta-llama/llama-4-scout-17b-16e-instruct"
)
MAX_IMAGE_BYTES = 5 * 1024 * 1024
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}

ANALYZE_SYSTEM = (
    "You are a nutrition analyst for CG's LifeOS. Identify the food and estimate its "
    "nutrition as accurately as a careful dietitian would.\n\n"
    "Rules:\n"
    "- Estimate the ACTUAL portion shown or described, not a generic 100g serving. "
    "Use plate size, utensils, and hands for scale in photos.\n"
    "- You understand Indian food deeply — roti, dal, sabzi, paneer, biryani, idli, dosa, "
    "sambar, poha, upma, curd rice, ghee, chutney. Assume home-style Indian cooking "
    "(and its typical oil/ghee content) unless the image says otherwise.\n"
    "- Return ONE item per distinct food on the plate. A thali is several items, not one.\n"
    "- Every nutrient field is required. Estimate it — never return null and never omit it. "
    "Use 0 only when the food genuinely contains none.\n"
    "- confidence: 'high' when the food and portion are unambiguous, 'medium' when the "
    "portion is a judgement call, 'low' when the food itself is uncertain.\n"
    "- notes: one short sentence on what you assumed (portion size, cooking method, oil). "
    "This is what lets the user correct you.\n"
    "- If the image contains no food at all, return an empty items array and say so in summary."
)

# Structured output schema — guarantees parseable JSON, no regex salvage needed.
_ITEM_PROPS: Dict[str, Any] = {
    "name": {"type": "string", "description": "Short food name, e.g. '2 chapati' or 'Paneer butter masala'"},
    "serving": {"type": "string", "description": "The portion you estimated, e.g. '1 medium bowl (200g)'"},
    "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
    "notes": {"type": "string", "description": "One sentence on assumptions made"},
}
for _n in NUTRIENTS:
    _ITEM_PROPS[_n["key"]] = {
        "type": "number",
        "description": f"{_n['label']} in {_n['unit']} for this portion",
    }

ANALYZE_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": _ITEM_PROPS,
                "required": ["name", "serving", "confidence", "notes"] + NUTRIENT_KEYS,
                "additionalProperties": False,
            },
        },
        "summary": {"type": "string", "description": "One line describing the whole meal"},
    },
    "required": ["items", "summary"],
    "additionalProperties": False,
}


# ──────────────────────────────────────────────────────────────────────────────
# Request / response models
# ──────────────────────────────────────────────────────────────────────────────
class NutrientsIn(BaseModel):
    """Every nutrient is optional on the way in; missing ones store as 0."""
    model_config = {"extra": "ignore"}

    calories: float = 0
    protein_g: float = 0
    carbs_g: float = 0
    fat_g: float = 0
    fiber_g: float = 0
    sugar_g: float = 0
    sat_fat_g: float = 0
    sodium_mg: float = 0
    potassium_mg: float = 0
    calcium_mg: float = 0
    iron_mg: float = 0
    magnesium_mg: float = 0
    zinc_mg: float = 0
    vitamin_c_mg: float = 0
    vitamin_a_mcg: float = 0
    vitamin_d_mcg: float = 0
    cholesterol_mg: float = 0


# ──────────────────────────────────────────────────────────────────────────────
# Coach → Intake bridge.
#
# The coach can only talk. These schemas let us read a plan it proposed back out
# of its own words, show the user exactly what would change, and write it only
# if they say yes. Nothing here invents numbers: the extractor is told to return
# null for anything the coach did not actually state, and every field below is
# nullable for exactly that reason.
# ──────────────────────────────────────────────────────────────────────────────
def _nullable(kind: str) -> Dict[str, Any]:
    """A value the coach may simply not have mentioned."""
    return {"anyOf": [{"type": kind}, {"type": "null"}]}


PLAN_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "proposes_changes": {
            "type": "boolean",
            "description": "True only if the coach actually proposed body stats, daily targets, or meals.",
        },
        "profile": {
            "type": "object",
            "description": "Body stats the USER stated about themselves in this conversation. Null for anything not stated.",
            "properties": {
                "age": _nullable("integer"),
                "height_cm": _nullable("number"),
                "weight_kg": _nullable("number"),
                "sex": {"anyOf": [{"type": "string", "enum": ["male", "female"]}, {"type": "null"}]},
            },
            "required": ["age", "height_cm", "weight_kg", "sex"],
            "additionalProperties": False,
        },
        "targets": {
            "type": "object",
            "description": "Daily targets the COACH proposed. Null for any nutrient it did not give a number for.",
            "properties": {k: _nullable("number") for k in NUTRIENT_KEYS},
            "required": NUTRIENT_KEYS,
            "additionalProperties": False,
        },
        "meals": {
            "type": "array",
            "description": "Meals the coach suggested. Empty if it suggested none.",
            "items": {
                "type": "object",
                "properties": {
                    "meal": {"type": "string", "enum": MEALS},
                    "name": {"type": "string"},
                    "serving": {"type": "string"},
                    **{k: {"type": "number"} for k in NUTRIENT_KEYS},
                },
                "required": ["meal", "name", "serving"] + NUTRIENT_KEYS,
                "additionalProperties": False,
            },
        },
        "summary": {"type": "string", "description": "One line: what this plan changes."},
    },
    "required": ["proposes_changes", "profile", "targets", "meals", "summary"],
    "additionalProperties": False,
}

PLAN_SYSTEM = (
    "You extract a structured plan from a coaching conversation. You are a parser, not a coach.\n\n"
    "Rules:\n"
    "- Extract ONLY what was actually said. If the coach did not give a number for something, return null. "
    "Never invent, never fill gaps with what you think is healthy, never carry over defaults.\n"
    "- targets: the daily targets the COACH proposed. Given a range ('1900-2000 kcal'), take the midpoint. "
    "Given a per-kg figure ('1.6-2.0 g/kg'), compute it from the weight the plan is actually based on.\n"
    "- profile: body stats the USER stated about THEMSELVES. If the user said their weight or height and it "
    "differs from what the coach used, return what the USER said — they know their own body. "
    "Convert to metric (feet/inches to cm, pounds to kg). Null for anything they did not state.\n"
    "- meals: every meal the coach suggested, with its nutrients for the portion described. If the coach gave "
    "only some nutrients, estimate the rest from the food itself — a meal with no numbers is useless to log.\n"
    "- proposes_changes: false if the coach was just chatting and proposed no stats, targets or meals."
)

SUGGEST_SYSTEM = (
    "You are CG's LifeOS nutrition coach suggesting the user's NEXT meal, right now.\n\n"
    "You are given their targets, what they have already eaten today, and what is left. Rules:\n"
    "- Fit the gap. The meal you suggest should move them toward what's REMAINING — especially protein — "
    "without blowing the calories left. Do not suggest a 900 kcal meal when 400 remain.\n"
    "- Suggest real food they would plausibly eat, in normal home portions. This user eats Indian food: "
    "think roti, dal, sabzi, paneer, curd, eggs, chicken, rice, poha, idli — not quinoa and salmon "
    "unless their logged history shows they eat that way.\n"
    "- Return the meal broken into its component items, each with full nutrition for the portion given.\n"
    "- Do not repeat something they have already eaten today.\n"
    "- reason: one short sentence on why this meal, referencing their actual remaining numbers."
)

SUGGEST_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "meal": {"type": "string", "enum": MEALS},
        "title": {"type": "string", "description": "What the meal is, in a few words"},
        "reason": {"type": "string"},
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "serving": {"type": "string"},
                    **{k: {"type": "number"} for k in NUTRIENT_KEYS},
                },
                "required": ["name", "serving"] + NUTRIENT_KEYS,
                "additionalProperties": False,
            },
        },
    },
    "required": ["meal", "title", "reason", "items"],
    "additionalProperties": False,
}


class EntryIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    meal: str = "snack"
    date: Optional[str] = None  # YYYY-MM-DD; defaults to today
    serving: str = ""
    quantity: float = 1.0  # multiplies the nutrients below
    source: str = "manual"  # manual | photo | text
    confidence: Optional[str] = None
    notes: str = ""
    nutrients: NutrientsIn = Field(default_factory=NutrientsIn)

    model_config = {"extra": "ignore"}


class AnalyzePhotoIn(BaseModel):
    """`image` is a data URL (data:image/jpeg;base64,...) or bare base64."""
    image: str
    hint: str = ""  # optional user hint, e.g. "the dal is homemade, low oil"

    model_config = {"extra": "ignore"}


class AnalyzeTextIn(BaseModel):
    text: str = Field(min_length=1, max_length=500)

    model_config = {"extra": "ignore"}


class TargetsIn(BaseModel):
    """Only the keys the user actually set. Unset keys fall back to computed defaults."""
    model_config = {"extra": "allow"}


class ChatTurn(BaseModel):
    role: str
    content: str

    model_config = {"extra": "ignore"}


class ExtractPlanIn(BaseModel):
    """The coach turns to read a plan out of — normally the user's message and the
    reply to it, so we can catch body stats the user stated about themselves."""
    messages: List[ChatTurn] = Field(min_length=1, max_length=8)

    model_config = {"extra": "ignore"}


class PlanMealIn(BaseModel):
    meal: str = "snack"
    name: str = Field(min_length=1, max_length=120)
    serving: str = ""
    nutrients: NutrientsIn = Field(default_factory=NutrientsIn)

    model_config = {"extra": "ignore"}


class ProfileIn(BaseModel):
    age: Optional[int] = None
    height_cm: Optional[float] = None
    weight_kg: Optional[float] = None
    sex: Optional[str] = None

    model_config = {"extra": "ignore"}


class ApplyPlanIn(BaseModel):
    """Whatever the user ticked. Anything omitted or null is simply not applied —
    declining is the default, not an exception."""
    profile: Optional[ProfileIn] = None
    targets: Optional[Dict[str, Optional[float]]] = None
    meals: Optional[List[PlanMealIn]] = None
    summary: str = ""

    model_config = {"extra": "ignore"}


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────
def _today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _valid_date(d: Optional[str]) -> str:
    d = (d or "").strip() or _today()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", d):
        raise HTTPException(400, "date must be YYYY-MM-DD")
    return d


def _decode_image(raw: str) -> tuple[str, str]:
    """data-URL or bare base64 → (media_type, clean base64). Rejects oversized/non-images."""
    media_type = "image/jpeg"
    data = raw.strip()

    m = re.match(r"^data:([\w./+-]+);base64,(.*)$", data, re.DOTALL)
    if m:
        media_type, data = m.group(1), m.group(2)

    if media_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(400, f"Unsupported image type '{media_type}'. Use JPEG, PNG, WebP or GIF.")

    data = re.sub(r"\s+", "", data)
    try:
        decoded = base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(400, "Image is not valid base64.")
    if not decoded:
        raise HTTPException(400, "Image is empty.")
    if len(decoded) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "Image is too large — keep it under 5 MB.")

    return media_type, data


def _clean_item(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Coerce one AI-returned item into our shape. Never trust the model's types."""
    def num(key: str) -> float:
        v = raw.get(key)
        try:
            f = float(v)
        except (TypeError, ValueError):
            return 0.0
        # Guard against a hallucinated absurdity poisoning the day's totals.
        if f != f or f < 0 or f > 100000:
            return 0.0
        return round(f, 2)

    conf = str(raw.get("confidence", "medium")).lower()
    return {
        "name": str(raw.get("name") or "Food").strip()[:120],
        "serving": str(raw.get("serving") or "").strip()[:120],
        "confidence": conf if conf in ("high", "medium", "low") else "medium",
        "notes": str(raw.get("notes") or "").strip()[:300],
        "nutrients": {k: num(k) for k in NUTRIENT_KEYS},
    }


def _serialize(doc: Dict[str, Any]) -> Dict[str, Any]:
    doc["id"] = str(doc.pop("_id"))
    doc.pop("user_id", None)
    return doc


def _scaled(entry: Dict[str, Any]) -> Dict[str, float]:
    """An entry's nutrients after applying its quantity multiplier."""
    q = entry.get("quantity", 1) or 1
    n = entry.get("nutrients", {}) or {}
    return {k: round((n.get(k, 0) or 0) * q, 2) for k in NUTRIENT_KEYS}


def _sum(entries: List[Dict[str, Any]]) -> Dict[str, float]:
    totals = {k: 0.0 for k in NUTRIENT_KEYS}
    for e in entries:
        for k, v in _scaled(e).items():
            totals[k] += v
    return {k: round(v, 1) for k, v in totals.items()}


# ──────────────────────────────────────────────────────────────────────────────
# Router factory — dependencies are injected so this file imports nothing
# from server.py (no circular import, and it's trivially testable in isolation).
# ──────────────────────────────────────────────────────────────────────────────
def build_router(
    *,
    db,
    get_current_user: Callable,
    coach_provider: Callable[[], str],
    get_anthropic: Callable,
    call_groq: Callable,
    compute_bmr: Callable[[float, float, int, str], float],
) -> APIRouter:
    router = APIRouter(prefix="/intake", tags=["intake"])

    # ── AI plumbing ───────────────────────────────────────────────────────────
    def vision_provider() -> str:
        """Which model sees the photo. Anthropic first — it's markedly better at
        portion estimation on mixed Indian plates. Groq is the free fallback."""
        forced = os.environ.get("INTAKE_VISION_PROVIDER", "").strip().lower()
        if forced in ("anthropic", "groq"):
            return forced
        if os.environ.get("ANTHROPIC_API_KEY"):
            return "anthropic"
        if os.environ.get("GROQ_API_KEY"):
            return "groq"
        return ""

    async def _analyze_anthropic(
        content: List[Dict[str, Any]], system: str, schema: Dict[str, Any]
    ) -> Dict[str, Any]:
        client = get_anthropic()
        if client is None:
            raise HTTPException(503, "Anthropic key not configured.")
        resp = await client.messages.create(
            model=VISION_MODEL,
            max_tokens=3000,
            system=system,
            messages=[{"role": "user", "content": content}],
            output_config={"format": {"type": "json_schema", "schema": schema}},
        )
        text = "".join(b.text for b in resp.content if b.type == "text").strip()
        return json.loads(text)

    async def _analyze_groq(
        content: List[Dict[str, Any]], system: str, schema: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Groq's OpenAI-compatible endpoint. No structured-output support, so we
        put the schema in the prompt, ask for JSON mode, and parse defensively."""
        key = os.environ.get("GROQ_API_KEY")
        if not key:
            raise HTTPException(503, "Groq key not configured.")

        # Translate our Anthropic-shaped blocks to OpenAI-shaped ones.
        oa_content: List[Dict[str, Any]] = []
        for block in content:
            if block["type"] == "text":
                oa_content.append({"type": "text", "text": block["text"]})
            elif block["type"] == "image":
                src = block["source"]
                oa_content.append({
                    "type": "image_url",
                    "image_url": {"url": f"data:{src['media_type']};base64,{src['data']}"},
                })

        full_system = (
            f"{system}\n\n"
            "Respond with ONLY a JSON object matching this schema:\n"
            f"{json.dumps(schema)}"
        )
        async with httpx.AsyncClient(timeout=90) as http:
            r = await http.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json={
                    "model": GROQ_VISION_MODEL,
                    "messages": [
                        {"role": "system", "content": full_system},
                        {"role": "user", "content": oa_content},
                    ],
                    "max_tokens": 3000,
                    "temperature": 0.3,
                    "response_format": {"type": "json_object"},
                },
            )
        if r.status_code >= 400:
            raise HTTPException(502, f"Groq vision error {r.status_code}: {r.text[:300]}")
        text = (r.json().get("choices") or [{}])[0].get("message", {}).get("content", "")
        # JSON mode is best-effort on Groq — salvage the object if it's wrapped in prose.
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            m = re.search(r"\{.*\}", text, re.DOTALL)
            if not m:
                raise HTTPException(502, "AI did not return usable JSON.")
            return json.loads(m.group(0))

    async def ask_model(
        content: List[Dict[str, Any]],
        system: str = ANALYZE_SYSTEM,
        schema: Dict[str, Any] = ANALYZE_SCHEMA,
    ) -> Dict[str, Any]:
        """One AI call, whichever provider is configured. Returns raw parsed JSON.
        Callers clean it — we never trust the model's shape."""
        provider = vision_provider()
        if not provider:
            raise HTTPException(
                503,
                "This needs an AI key. Add ANTHROPIC_API_KEY (best estimates) or "
                "GROQ_API_KEY (free) to backend/.env and restart.",
            )
        try:
            if provider == "anthropic":
                data = await _analyze_anthropic(content, system, schema)
            else:
                data = await _analyze_groq(content, system, schema)
        except HTTPException:
            raise
        except json.JSONDecodeError:
            logger.exception("intake: model returned non-JSON")
            raise HTTPException(502, "AI response could not be read. Try again.")
        except Exception as e:
            logger.exception("intake AI call failed")
            raise HTTPException(502, f"AI request failed: {e}")
        data["provider"] = provider
        return data

    async def analyze(content: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Identify food. Returns candidates — never saved, always confirmed first."""
        data = await ask_model(content)
        items = [_clean_item(i) for i in (data.get("items") or []) if isinstance(i, dict)]
        return {
            "provider": data["provider"],
            "items": items[:12],
            "summary": str(data.get("summary") or "").strip()[:300],
        }

    # ── Targets ───────────────────────────────────────────────────────────────
    async def resolve_targets(user: Dict[str, Any]) -> Dict[str, Any]:
        """User's saved targets, with anything unset derived from their profile."""
        uid = str(user["_id"])
        profile = user.get("profile", {}) or {}
        sex = profile.get("sex") if profile.get("sex") in ("male", "female") else "male"
        w, h, age = profile.get("weight_kg"), profile.get("height_cm"), profile.get("age")

        defaults: Dict[str, float] = dict(RDA[sex])
        if w and h and age:
            # Maintenance ≈ BMR × 1.45 (lightly-to-moderately active).
            kcal = round(compute_bmr(w, h, age, sex) * 1.45)
            protein = round(w * 1.8)                       # 1.8 g/kg — training population
            fat = round(kcal * 0.25 / 9)                   # 25% of calories
            carbs = round(max(kcal - protein * 4 - fat * 9, 0) / 4)
            defaults.update({"calories": kcal, "protein_g": protein, "fat_g": fat, "carbs_g": carbs})
        else:
            defaults.update({"calories": 2000, "protein_g": 120, "fat_g": 60, "carbs_g": 220})

        saved = await db.intake_targets.find_one({"user_id": uid}) or {}
        custom = {k: v for k, v in (saved.get("targets") or {}).items() if k in NUTRIENT_KEYS and v is not None}

        return {
            "targets": {**defaults, **custom},
            "auto": {k: k not in custom for k in NUTRIENT_KEYS},
            "profile_complete": bool(w and h and age),
        }

    @router.get("/meta")
    async def meta():
        """Nutrient definitions + meal slots. The UI builds itself from this, so
        adding a nutrient to NUTRIENTS above needs no frontend change."""
        return {"nutrients": NUTRIENTS, "meals": MEALS}

    @router.get("/status")
    async def status(user=Depends(get_current_user)):
        provider = vision_provider()
        return {
            "configured": bool(provider),
            "provider": provider or None,
            "model": VISION_MODEL if provider == "anthropic" else (GROQ_VISION_MODEL if provider else None),
        }

    @router.get("/targets")
    async def get_targets(user=Depends(get_current_user)):
        return await resolve_targets(user)

    @router.put("/targets")
    async def put_targets(payload: TargetsIn, user=Depends(get_current_user)):
        """Send a nutrient key with a number to pin it; send null to hand it back
        to the auto-computed default."""
        uid = str(user["_id"])
        saved = await db.intake_targets.find_one({"user_id": uid}) or {}
        targets = dict(saved.get("targets") or {})

        for k, v in payload.model_dump().items():
            if k not in NUTRIENT_KEYS:
                continue
            if v is None:
                targets.pop(k, None)
                continue
            try:
                f = float(v)
            except (TypeError, ValueError):
                raise HTTPException(400, f"{k} must be a number")
            if f < 0:
                raise HTTPException(400, f"{k} cannot be negative")
            targets[k] = round(f, 2)

        await db.intake_targets.update_one(
            {"user_id": uid},
            {"$set": {"targets": targets, "updated_at": datetime.now(timezone.utc).isoformat()}},
            upsert=True,
        )
        return await resolve_targets(user)

    # ── Analysis (never writes — the user confirms first) ─────────────────────
    @router.post("/analyze/photo")
    async def analyze_photo(payload: AnalyzePhotoIn, user=Depends(get_current_user)):
        media_type, data = _decode_image(payload.image)
        prompt = "Identify every food in this photo and estimate its nutrition."
        if payload.hint.strip():
            prompt += f"\n\nThe user adds: {payload.hint.strip()[:300]}"
        return await analyze([
            {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": data}},
            {"type": "text", "text": prompt},
        ])

    @router.post("/analyze/text")
    async def analyze_text(payload: AnalyzeTextIn, user=Depends(get_current_user)):
        return await analyze([
            {"type": "text", "text": f"Estimate the nutrition of this meal: {payload.text.strip()}"}
        ])

    # ── Entries ───────────────────────────────────────────────────────────────
    @router.post("/entries")
    async def create_entry(payload: EntryIn, user=Depends(get_current_user)):
        """The confirm step. AI analysis lands here only if the user says yes."""
        if payload.quantity <= 0:
            raise HTTPException(400, "quantity must be greater than 0")

        doc = {
            "user_id": str(user["_id"]),
            "date": _valid_date(payload.date),
            "meal": payload.meal if payload.meal in MEALS else "snack",
            "name": payload.name.strip(),
            "serving": payload.serving.strip()[:120],
            "quantity": round(payload.quantity, 2),
            "source": payload.source if payload.source in ("manual", "photo", "text") else "manual",
            "confidence": payload.confidence if payload.confidence in ("high", "medium", "low") else None,
            "notes": payload.notes.strip()[:300],
            "nutrients": {k: round(max(getattr(payload.nutrients, k), 0), 2) for k in NUTRIENT_KEYS},
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        res = await db.intake_entries.insert_one(doc)
        doc["_id"] = res.inserted_id
        return _serialize(doc)

    @router.put("/entries/{entry_id}")
    async def update_entry(entry_id: str, payload: EntryIn, user=Depends(get_current_user)):
        if payload.quantity <= 0:
            raise HTTPException(400, "quantity must be greater than 0")
        try:
            oid = ObjectId(entry_id)
        except Exception:
            raise HTTPException(404, "Entry not found")

        upd = {
            "date": _valid_date(payload.date),
            "meal": payload.meal if payload.meal in MEALS else "snack",
            "name": payload.name.strip(),
            "serving": payload.serving.strip()[:120],
            "quantity": round(payload.quantity, 2),
            "notes": payload.notes.strip()[:300],
            "nutrients": {k: round(max(getattr(payload.nutrients, k), 0), 2) for k in NUTRIENT_KEYS},
        }
        res = await db.intake_entries.update_one(
            {"_id": oid, "user_id": str(user["_id"])}, {"$set": upd}
        )
        if not res.matched_count:
            raise HTTPException(404, "Entry not found")
        saved = await db.intake_entries.find_one({"_id": oid})
        return _serialize(saved)

    @router.delete("/entries/{entry_id}")
    async def delete_entry(entry_id: str, user=Depends(get_current_user)):
        try:
            oid = ObjectId(entry_id)
        except Exception:
            raise HTTPException(404, "Entry not found")
        res = await db.intake_entries.delete_one({"_id": oid, "user_id": str(user["_id"])})
        if not res.deleted_count:
            raise HTTPException(404, "Entry not found")
        return {"ok": True}

    @router.get("/day")
    async def day(date: Optional[str] = None, user=Depends(get_current_user)):
        """Everything the day view needs in one round trip: entries grouped by
        meal, running totals, targets, and what's left."""
        uid = str(user["_id"])
        d = _valid_date(date)

        raw = await db.intake_entries.find({"user_id": uid, "date": d}).sort("created_at", 1).to_list(300)
        entries = []
        for doc in raw:
            scaled = _scaled(doc)
            e = _serialize(doc)
            e["totals"] = scaled  # nutrients × quantity, so the UI never re-does the math
            entries.append(e)

        totals = _sum(raw)
        tgt = await resolve_targets(user)
        targets = tgt["targets"]

        return {
            "date": d,
            "entries": entries,
            "by_meal": {m: [e for e in entries if e["meal"] == m] for m in MEALS},
            "totals": totals,
            "targets": targets,
            "remaining": {k: round(targets.get(k, 0) - totals.get(k, 0), 1) for k in NUTRIENT_KEYS},
            "auto": tgt["auto"],
            "profile_complete": tgt["profile_complete"],
        }

    @router.get("/history")
    async def history(days: int = 14, user=Depends(get_current_user)):
        """Daily totals for the trend chart."""
        days = max(1, min(days, 90))
        uid = str(user["_id"])
        start = (datetime.now(timezone.utc).date() - timedelta(days=days - 1)).isoformat()

        raw = await db.intake_entries.find({"user_id": uid, "date": {"$gte": start}}).to_list(5000)
        by_date: Dict[str, List[Dict[str, Any]]] = {}
        for e in raw:
            by_date.setdefault(e["date"], []).append(e)

        out = []
        for i in range(days):
            d = (datetime.now(timezone.utc).date() - timedelta(days=days - 1 - i)).isoformat()
            out.append({"date": d, "logged": d in by_date, **_sum(by_date.get(d, []))})

        tgt = await resolve_targets(user)
        logged = [x for x in out if x["logged"]]
        avg = {
            k: round(sum(x[k] for x in logged) / len(logged), 1) if logged else 0
            for k in NUTRIENT_KEYS
        }
        return {"days": out, "targets": tgt["targets"], "averages": avg, "days_logged": len(logged)}

    # ── Coach → Intake bridge ─────────────────────────────────────────────────
    # The coach proposes; the user disposes. Extract reads a plan out of what the
    # coach said and returns it as a diff against reality. Apply writes only the
    # parts the user ticked. Neither step assumes consent.

    def _clean_plan_meal(raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        item = _clean_item(raw)  # same defensive coercion as photo analysis
        meal = str(raw.get("meal", "snack")).lower()
        name = item["name"]
        if not name or name == "Food":
            return None
        return {
            "meal": meal if meal in MEALS else "snack",
            "name": name,
            "serving": item["serving"],
            "nutrients": item["nutrients"],
        }

    async def _enrich_meals(meals: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Fill in the nutrients the coach never mentioned.

        The extractor is a strict parser — it records only what was actually said,
        so a meal written as "3 eggs, oatmeal, banana (430 kcal, 25g protein)"
        arrives with zero carbs, zero fat and zero micros. That's faithful, but
        logging it would report a day with no iron in it.

        So we cost the food itself, using the same estimator the photo path uses,
        and keep the coach's own numbers wherever it gave one — its figures win,
        we only fill the gaps.
        """
        if not meals:
            return meals

        # One call for the whole plan rather than one per meal.
        listing = "\n".join(
            f"{i + 1}. {m['name']}" + (f" — {m['serving']}" if m["serving"] else "")
            for i, m in enumerate(meals)
        )
        try:
            data = await ask_model([{
                "type": "text",
                "text": (
                    "Estimate full nutrition for each of these planned meals. Return one item per "
                    f"numbered line, in the same order:\n\n{listing}"
                ),
            }])
        except HTTPException:
            logger.warning("intake: meal enrichment failed; keeping the coach's numbers as-is")
            return meals

        estimates = [_clean_item(i) for i in (data.get("items") or []) if isinstance(i, dict)]
        if len(estimates) != len(meals):
            # Order broke — fall back to matching on name, and skip what we can't match.
            by_name = {e["name"].lower(): e for e in estimates}
            estimates = [by_name.get(m["name"].lower()) for m in meals]

        for meal, est in zip(meals, estimates):
            if not est:
                continue
            for k in NUTRIENT_KEYS:
                if not meal["nutrients"].get(k):  # the coach didn't say — estimate it
                    meal["nutrients"][k] = est["nutrients"].get(k, 0)
            if not meal["serving"]:
                meal["serving"] = est["serving"]
        return meals

    @router.post("/plan/extract")
    async def extract_plan(payload: ExtractPlanIn, user=Depends(get_current_user)):
        """Read the coach's proposal back out of its own words. Writes nothing.

        Returns a diff: `current` is what's true now, `proposed` is what the coach
        said. The UI shows both so the user can see exactly what would change."""
        transcript = "\n\n".join(
            f"{'USER' if t.role == 'user' else 'COACH'}: {t.content.strip()}"
            for t in payload.messages
            if t.content and t.content.strip()
        )
        if not transcript:
            raise HTTPException(400, "Nothing to read.")

        data = await ask_model(
            [{"type": "text", "text": f"Extract the plan from this conversation:\n\n{transcript}"}],
            system=PLAN_SYSTEM,
            schema=PLAN_SCHEMA,
        )

        # ── Targets: keep only nutrients the coach actually gave a number for.
        raw_targets = data.get("targets") or {}
        proposed_targets: Dict[str, float] = {}
        for k in NUTRIENT_KEYS:
            v = raw_targets.get(k)
            if v is None:
                continue
            try:
                f = float(v)
            except (TypeError, ValueError):
                continue
            if f > 0:
                proposed_targets[k] = round(f, 1)

        # ── Profile: only what the user said about their own body.
        raw_profile = data.get("profile") or {}
        proposed_profile: Dict[str, Any] = {}
        for key, lo, hi in (("age", 5, 120), ("height_cm", 80, 250), ("weight_kg", 20, 400)):
            v = raw_profile.get(key)
            if v is None:
                continue
            try:
                f = float(v)
            except (TypeError, ValueError):
                continue
            if lo <= f <= hi:
                proposed_profile[key] = int(f) if key == "age" else round(f, 1)
        if raw_profile.get("sex") in ("male", "female"):
            proposed_profile["sex"] = raw_profile["sex"]

        meals = [m for m in (_clean_plan_meal(x) for x in (data.get("meals") or []) if isinstance(x, dict)) if m]
        meals = await _enrich_meals(meals[:8])

        current = await resolve_targets(user)
        profile = user.get("profile", {}) or {}

        # Drop anything that isn't actually a change — a diff of nothing is noise.
        proposed_profile = {k: v for k, v in proposed_profile.items() if profile.get(k) != v}
        proposed_targets = {
            k: v for k, v in proposed_targets.items()
            if round(current["targets"].get(k, 0), 1) != v
        }

        return {
            "provider": data["provider"],
            "proposes_changes": bool(proposed_profile or proposed_targets or meals),
            "summary": str(data.get("summary") or "").strip()[:300],
            "current": {
                "profile": {k: profile.get(k) for k in ("age", "height_cm", "weight_kg", "sex")},
                "targets": current["targets"],
                "auto": current["auto"],
            },
            "proposed": {
                "profile": proposed_profile,
                "targets": proposed_targets,
                "meals": meals,
            },
        }

    @router.post("/plan/apply")
    async def apply_plan(payload: ApplyPlanIn, user=Depends(get_current_user)):
        """Write only what the user ticked. An empty payload is a valid no-op —
        saying no costs nothing."""
        uid = str(user["_id"])
        applied: List[str] = []

        # ── Body stats
        if payload.profile:
            fields = payload.profile.model_dump(exclude_none=True)
            if fields.get("sex") not in ("male", "female"):
                fields.pop("sex", None)
            if fields:
                await db.users.update_one(
                    {"_id": user["_id"]},
                    {"$set": {f"profile.{k}": v for k, v in fields.items()}},
                )
                applied.append("profile")

        # ── Daily targets (reuse the same pinning rules as the Targets dialog)
        if payload.targets:
            saved = await db.intake_targets.find_one({"user_id": uid}) or {}
            targets = dict(saved.get("targets") or {})
            changed = False
            for k, v in payload.targets.items():
                if k not in NUTRIENT_KEYS or v is None:
                    continue
                try:
                    f = float(v)
                except (TypeError, ValueError):
                    continue
                if f < 0:
                    continue
                targets[k] = round(f, 2)
                changed = True
            if changed:
                await db.intake_targets.update_one(
                    {"user_id": uid},
                    {"$set": {"targets": targets, "updated_at": datetime.now(timezone.utc).isoformat()}},
                    upsert=True,
                )
                applied.append("targets")

        # ── Meal plan. Saved, not logged: it's a template you can one-tap into a
        # day, so accepting a plan never silently fills your tracker with food
        # you haven't eaten.
        if payload.meals:
            meals = [
                {
                    "meal": m.meal if m.meal in MEALS else "snack",
                    "name": m.name.strip()[:120],
                    "serving": m.serving.strip()[:120],
                    "nutrients": {k: round(max(getattr(m.nutrients, k), 0), 2) for k in NUTRIENT_KEYS},
                }
                for m in payload.meals
            ]
            await db.intake_plans.update_one(
                {"user_id": uid},
                {"$set": {
                    "meals": meals,
                    "summary": payload.summary.strip()[:300],
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }},
                upsert=True,
            )
            applied.append("meals")

        # Re-read so the client gets the truth, not what it hoped it wrote.
        fresh_user = await db.users.find_one({"_id": user["_id"]})
        tgt = await resolve_targets(fresh_user)
        plan = await db.intake_plans.find_one({"user_id": uid})
        return {
            "applied": applied,
            "targets": tgt["targets"],
            "profile": fresh_user.get("profile", {}),
            "plan": {"meals": plan["meals"], "summary": plan.get("summary", "")} if plan else None,
        }

    @router.get("/plan")
    async def get_plan(user=Depends(get_current_user)):
        plan = await db.intake_plans.find_one({"user_id": str(user["_id"])})
        if not plan:
            return {"plan": None}
        return {"plan": {
            "meals": plan.get("meals", []),
            "summary": plan.get("summary", ""),
            "created_at": plan.get("created_at"),
        }}

    @router.delete("/plan")
    async def delete_plan(user=Depends(get_current_user)):
        """Bin the coach's plan. Nothing already logged is touched."""
        await db.intake_plans.delete_one({"user_id": str(user["_id"])})
        return {"ok": True}

    @router.post("/suggest")
    async def suggest(date: Optional[str] = None, user=Depends(get_current_user)):
        """'What should I eat now?' — grounded in what's actually left today.
        Returns a suggestion to confirm or ignore; logs nothing."""
        uid = str(user["_id"])
        d = _valid_date(date)

        entries = await db.intake_entries.find({"user_id": uid, "date": d}).to_list(300)
        totals = _sum(entries)
        tgt = await resolve_targets(user)
        targets = tgt["targets"]
        remaining = {k: round(targets.get(k, 0) - totals.get(k, 0), 1) for k in NUTRIENT_KEYS}

        eaten = ", ".join(f"{e['name']} ({e['meal']})" for e in entries) or "nothing yet"
        plan = await db.intake_plans.find_one({"user_id": uid})
        plan_text = ""
        if plan and plan.get("meals"):
            plan_text = "\nTheir agreed plan includes: " + "; ".join(
                f"{m['meal']}: {m['name']}" for m in plan["meals"]
            )

        headline = ["calories", "protein_g", "carbs_g", "fat_g"]
        ctx = (
            f"Local time context: it is {datetime.now(timezone.utc).strftime('%H:%M')} UTC.\n"
            f"Eaten today: {eaten}.\n"
            "Targets vs eaten vs remaining:\n"
            + "\n".join(
                f"  {k}: target {targets.get(k, 0)}, eaten {totals.get(k, 0)}, remaining {remaining.get(k, 0)}"
                for k in headline
            )
            + plan_text
            + "\n\nSuggest their next meal."
        )

        data = await ask_model([{"type": "text", "text": ctx}], system=SUGGEST_SYSTEM, schema=SUGGEST_SCHEMA)
        items = [_clean_item(i) for i in (data.get("items") or []) if isinstance(i, dict)]
        meal = str(data.get("meal", "snack")).lower()
        return {
            "provider": data["provider"],
            "meal": meal if meal in MEALS else "snack",
            "title": str(data.get("title") or "").strip()[:120],
            "reason": str(data.get("reason") or "").strip()[:300],
            "items": items[:8],
            "remaining": remaining,
        }

    return router
