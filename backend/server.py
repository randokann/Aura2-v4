import os
import logging
import uuid
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from supabase import create_client, Client

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

supabase: Client = create_client(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY
)

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Header
from auth import get_current_user
from starlette.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Literal
from datetime import datetime, timezone, timedelta
from ai import get_ai_service, AIProviderError
from ai.constants import recovery_status_for

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000",],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

api_router = APIRouter()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Single AI service used by every endpoint. Swap providers via AI_PROVIDER env.
ai = get_ai_service()


# Meal-plan generation is deliberately controlled separately from saved plans.
# The daily total is persisted in Supabase; this in-process window only prevents
# accidental double submissions while a request is already being handled.
MEAL_PLAN_DAILY_GENERATION_LIMIT = 2
MEAL_PLAN_SHORT_RATE_LIMIT_SECONDS = 10
_meal_plan_request_times: dict[str, datetime] = {}
GUEST_MEAL_PLAN_LIFETIME_LIMIT = 3
GUEST_PANTRY_LIFETIME_LIMIT = 1
GUEST_PANTRY_SHORT_RATE_LIMIT_SECONDS = 10
_guest_pantry_request_times: dict[str, datetime] = {}


# ============ MODELS ============

class FoodItem(BaseModel):
    name: str
    quantity: str
    calories: float
    protein: float = 0
    carbs: float = 0
    fat: float = 0
    fiber: float = 0

class AnalyzeRequest(BaseModel):
    image_base64: str
    mime_type: str = "image/jpeg"
    lang: str = "en"

class AnalyzeResponse(BaseModel):
    dish_name: str
    confidence: dict
    foods: List[FoodItem]
    total_calories: float
    total_protein: float
    total_carbs: float
    total_fat: float
    total_fiber: float
    notes: str

class Clarification(BaseModel):
    question: str
    options: List[str]
    clarification_type: str = "ingredient"


class AnalyzeResponseWithClarification(BaseModel):
    needs_clarification: bool = False
    clarification: Optional[Clarification] = None

    dish_name: Optional[str] = None
    confidence: Optional[dict] = None
    foods: Optional[List[FoodItem]] = None

    total_calories: Optional[float] = None
    total_protein: Optional[float] = None
    total_carbs: Optional[float] = None
    total_fat: Optional[float] = None
    total_fiber: Optional[float] = None

    notes: Optional[str] = None


class ClarifyRequest(BaseModel):
    device_id: Optional[str] = None          # kept for compatibility, ignored
    image_base64: str
    original_question: str
    user_answer: str
    clarification_type: str = "ingredient"
    lang: str = "en"

class AssociateRequest(BaseModel):
    device_id: str                           # kept for compatibility, ignored

class Profile(BaseModel):
    model_config = ConfigDict(extra="ignore")
    device_id: Optional[str] = None          # kept for compatibility, not stored
    user_id: Optional[str] = None
    name: Optional[str] = ""
    age: int = 30
    sex: Literal["maschio", "femmina"] = "maschio"
    height_cm: float = 170
    current_weight_kg: float = 70
    target_weight_kg: float = 68
    activity_level: Literal["sedentario", "leggero", "moderato", "intenso", "molto_intenso"] = "moderato"
    goal: Literal["dimagrire", "mantenere", "aumentare"] = "mantenere"
    daily_calorie_goal: float = 2000
    protein_goal: float = 120
    carbs_goal: float = 250
    fat_goal: float = 65
    fiber_goal: float = 30
    bmi: float = 0
    bmi_category: str = ""
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class ProfileInput(BaseModel):
    device_id: Optional[str] = None          # kept for compatibility, ignored
    name: Optional[str] = ""
    age: int
    sex: Literal["maschio", "femmina"]
    height_cm: float
    current_weight_kg: float
    target_weight_kg: float
    activity_level: Literal["sedentario", "leggero", "moderato", "intenso", "molto_intenso"]
    goal: Literal["dimagrire", "mantenere", "aumentare"]

class MealCreate(BaseModel):
    device_id: Optional[str] = None          # kept for compatibility, ignored
    dish_name: str
    foods: List[FoodItem]
    total_calories: float
    total_protein: float
    total_carbs: float
    total_fat: float
    total_fiber: float
    image_base64: Optional[str] = ""
    meal_date: str
    meal_type: Literal["colazione", "pranzo", "cena", "spuntino"] = "pranzo"
    notes: str = ""

class Meal(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    device_id: Optional[str] = None          # kept for compatibility, not stored
    user_id: Optional[str] = None
    dish_name: str
    foods: List[FoodItem]
    total_calories: float
    total_protein: float
    total_carbs: float
    total_fat: float
    total_fiber: float
    image_base64: str = ""
    meal_date: str
    meal_type: str
    notes: str = ""
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


# ============ NON-AI HELPERS ============

def compute_bmi(weight_kg: float, height_cm: float):
    height_m = height_cm / 100
    bmi = round(weight_kg / (height_m ** 2), 1)

    if bmi < 18.5:
        category = "underweight"
    elif bmi < 25:
        category = "normal"
    elif bmi < 30:
        category = "overweight"
    else:
        category = "obese"

    return bmi, category


def _ai_error(e: Exception, generic: str = "AI error") -> HTTPException:
    """Return a stable HTTP error when the provider request fails."""
    logger.error("%s: %s", generic, e)
    return HTTPException(status_code=502, detail=generic)


def _meal_plan_limit_error(code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=429,
        detail={
            "code": code,
            "message": message,
            "daily_limit": MEAL_PLAN_DAILY_GENERATION_LIMIT,
        },
    )


def _guest_limit_error(code: str, message: str, limit: int) -> HTTPException:
    return HTTPException(
        status_code=429,
        detail={"code": code, "message": message, "limit": limit},
    )


def _guest_id_or_error(device_id: Optional[str]) -> str:
    if not device_id:
        raise HTTPException(
            status_code=400,
            detail={"code": "GUEST_DEVICE_ID_REQUIRED", "message": "A guest device_id is required."},
        )
    try:
        return str(uuid.UUID(device_id))
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(
            status_code=400,
            detail={"code": "INVALID_GUEST_DEVICE_ID", "message": "Guest device_id must be a UUID."},
        )


async def _optional_current_user(authorization: Optional[str]) -> Optional[dict]:
    if not authorization:
        return None
    return await get_current_user(authorization)


def _enforce_meal_plan_short_rate_limit(user_id: str) -> None:
    now = datetime.now(timezone.utc)
    previous = _meal_plan_request_times.get(user_id)
    if previous and now - previous < timedelta(seconds=MEAL_PLAN_SHORT_RATE_LIMIT_SECONDS):
        raise _meal_plan_limit_error(
            "MEAL_PLAN_RATE_LIMITED",
            "Please wait a few seconds before generating another meal plan.",
        )
    _meal_plan_request_times[user_id] = now


def _enforce_guest_pantry_short_rate_limit(guest_id: str) -> None:
    now = datetime.now(timezone.utc)
    previous = _guest_pantry_request_times.get(guest_id)
    if previous and now - previous < timedelta(seconds=GUEST_PANTRY_SHORT_RATE_LIMIT_SECONDS):
        raise _guest_limit_error(
            "GUEST_PANTRY_RATE_LIMITED",
            "Please wait a few seconds before scanning the pantry again.",
            GUEST_PANTRY_LIFETIME_LIMIT,
        )
    _guest_pantry_request_times[guest_id] = now


def _has_reached_meal_plan_daily_limit(user_id: str) -> bool:
    today = datetime.now(timezone.utc).date().isoformat()
    response = (
        supabase.table("meal_plan_generation_limits")
        .select("successful_generations")
        .eq("user_id", user_id)
        .eq("generation_date", today)
        .execute()
    )
    if not response.data:
        return False
    return response.data[0].get("successful_generations", 0) >= MEAL_PLAN_DAILY_GENERATION_LIMIT


def _record_successful_meal_plan_generation(user_id: str) -> bool:
    """Atomically reserve one of today's two successful-response slots."""
    today = datetime.now(timezone.utc).date().isoformat()
    response = supabase.rpc(
        "record_successful_meal_plan_generation",
        {"p_user_id": user_id, "p_generation_date": today},
    ).execute()
    return response.data is True


def _has_reached_guest_meal_plan_limit(guest_id: str) -> bool:
    response = (
        supabase.table("guest_meal_plan_generation_limits")
        .select("successful_generations")
        .eq("guest_id", guest_id)
        .execute()
    )
    return bool(response.data and response.data[0].get("successful_generations", 0) >= GUEST_MEAL_PLAN_LIFETIME_LIMIT)


def _record_successful_guest_meal_plan_generation(guest_id: str) -> bool:
    response = supabase.rpc(
        "record_successful_guest_meal_plan_generation",
        {"p_guest_id": guest_id},
    ).execute()
    return response.data is True


def _has_reached_guest_pantry_limit(guest_id: str) -> bool:
    response = (
        supabase.table("guest_pantry_scan_limits")
        .select("successful_scans")
        .eq("guest_id", guest_id)
        .execute()
    )
    return bool(response.data and response.data[0].get("successful_scans", 0) >= GUEST_PANTRY_LIFETIME_LIMIT)


def _record_successful_guest_pantry_scan(guest_id: str) -> bool:
    response = supabase.rpc(
        "record_successful_guest_pantry_scan",
        {"p_guest_id": guest_id},
    ).execute()
    return response.data is True

def resolve_weight_direction(goal: str, current_weight_kg: float, target_weight_kg: float) -> str:
    diff = target_weight_kg - current_weight_kg
    if goal == "dimagrire" or diff < -0.5:
        return "dimagrire"
    if goal == "aumentare" or diff > 0.5:
        return "aumentare"
    return "mantenere"


def compute_calorie_goal(p: ProfileInput) -> dict:
    # --- Calorie calculation (unchanged) ---
    if p.sex == "maschio":
        bmr = 10 * p.current_weight_kg + 6.25 * p.height_cm - 5 * p.age + 5
    else:
        bmr = 10 * p.current_weight_kg + 6.25 * p.height_cm - 5 * p.age - 161

    factors = {
        "sedentario": 1.2,
        "leggero": 1.375,
        "moderato": 1.55,
        "intenso": 1.725,
        "molto_intenso": 1.9
    }
    tdee = bmr * factors[p.activity_level]

    weight_direction = resolve_weight_direction(
        p.goal, p.current_weight_kg, p.target_weight_kg
    )
    if weight_direction == "dimagrire":
        calorie_goal = tdee - 500
    elif weight_direction == "aumentare":
        calorie_goal = tdee + 400
    else:
        calorie_goal = tdee

    calorie_goal = max(1200, round(calorie_goal))

    # --- Dynamic macros ---
    # 1. Protein goal (g/kg) based on goal
    if p.goal == "dimagrire":
        protein_multiplier = 1.8
    elif p.goal == "aumentare":
        protein_multiplier = 1.7
    else:  # mantenere or fallback
        protein_multiplier = 1.6

    protein_g = round(p.current_weight_kg * protein_multiplier)

    # 2. Fat goal (g/kg) – fixed for simplicity, but could also be made goal‑dependent if desired
    fat_g = round(p.current_weight_kg * 0.8)

    # 3. Carbs are the remaining calories (after protein and fat)
    #    protein = 4 kcal/g, fat = 9 kcal/g
    remaining_calories = calorie_goal - (protein_g * 4) - (fat_g * 9)
    # Ensure carbs are not negative; if they are, we cap fat/protein (though unlikely with these numbers)
    if remaining_calories < 0:
        # fallback: set carbs to 0 and recalculate fat/protein? 
        # But with reasonable multipliers, remaining_calories should be positive.
        # We'll just set carbs to 0 and adjust protein slightly? Let's keep it simple:
        carbs_g = 0
    else:
        carbs_g = round(remaining_calories / 4)

    # 4. Fiber (unchanged)
    fiber_g = 30 if p.sex == "maschio" else 25

    # 5. BMI (unchanged)
    bmi, bmi_cat = compute_bmi(p.current_weight_kg, p.height_cm)

    return {
        "daily_calorie_goal": calorie_goal,
        "protein_goal": protein_g,
        "carbs_goal": carbs_g,
        "fat_goal": fat_g,
        "fiber_goal": fiber_g,
        "bmi": bmi,
        "bmi_category": bmi_cat,
    }


# ============ AUTH DEPENDENCY ============

async def get_current_user_id(user=Depends(get_current_user)) -> str:
    """Return the authenticated user's id."""
    return user["id"]


# ============ FOOD / MEALS ============

@api_router.get("/")
async def root():
    return {"message": "NutriSnap API attiva"}


@api_router.post("/analyze-food", response_model=AnalyzeResponseWithClarification)
async def analyze_food(req: AnalyzeRequest):
    if not req.image_base64:
        raise HTTPException(status_code=400, detail="image_base64 required")

    try:
        data = await ai.analyze_food(
            image_base64=req.image_base64,
            lang=req.lang,
        )
    except AIProviderError as e:
        raise _ai_error(e, "Food analysis error")

    return AnalyzeResponseWithClarification(**data)


@api_router.get("/me")
async def get_me(user=Depends(get_current_user)):
    return {
        "user_id": user["id"],
        "email": user["email"]
    }


@api_router.post("/clarify-food", response_model=AnalyzeResponse)
async def clarify_food(req: ClarifyRequest):
    if not req.image_base64:
        raise HTTPException(status_code=400, detail="image_base64 required")

    try:
        data = await ai.clarify_food_analysis(
            image_base64=req.image_base64,
            original_question=req.original_question,
            user_answer=req.user_answer,
            clarification_type=req.clarification_type,
            lang=req.lang,
        )
    except AIProviderError as e:
        raise _ai_error(e, "Clarification error")

    return AnalyzeResponse(**data)


@api_router.post("/auth/associate")
async def associate_device(req: AssociateRequest, user=Depends(get_current_user)):
    """
    Legacy endpoint: no longer associates device data (no device_id column).
    Returns success without performing any database operation.
    """
    logger.warning(f"Associate called for user {user['id']} with device {req.device_id} – ignored.")
    return {"ok": True, "user_id": user["id"], "device_id": req.device_id, "summary": {}}


@api_router.post("/profile", response_model=Profile)
async def save_profile(p: ProfileInput, user_id: str = Depends(get_current_user_id)):
    # Defensive fallback: if the incoming payload contains an empty or missing `goal`,
    # derive it from the provided weights so the downstream logic (calorie/macros)
    # can continue to work without breaking. This does not change the API contract
    # or the ProfileInput model — it's purely a runtime safeguard.
    try:
        p_dict = p.model_dump()
    except Exception:
        # If model_dump is not available for some reason, fallback to attribute access
        p_dict = {
            "name": getattr(p, "name", ""),
            "age": getattr(p, "age", 30),
            "sex": getattr(p, "sex", "maschio"),
            "height_cm": getattr(p, "height_cm", 170),
            "current_weight_kg": getattr(p, "current_weight_kg", 70),
            "target_weight_kg": getattr(p, "target_weight_kg", 68),
            "activity_level": getattr(p, "activity_level", "moderato"),
            "goal": getattr(p, "goal", None),
        }

    goal_raw = p_dict.get("goal")
    if goal_raw is None or (isinstance(goal_raw, str) and goal_raw.strip() == ""):
        # derive goal from weights using the exact logic requested
        try:
            cur = float(p_dict.get("current_weight_kg", 0))
            tgt = float(p_dict.get("target_weight_kg", 0))
        except Exception:
            cur = p_dict.get("current_weight_kg", 0)
            tgt = p_dict.get("target_weight_kg", 0)

        if tgt < cur:
            derived_goal = "dimagrire"
        elif tgt > cur:
            derived_goal = "aumentare"
        else:
            derived_goal = "mantenere"

        p_dict["goal"] = derived_goal
    else:
        # keep provided goal exactly as-is
        derived_goal = goal_raw

    # create a validated ProfileInput instance to pass to existing logic
    try:
        p_safe = ProfileInput(**p_dict)
    except Exception:
        # If validation fails for any reason, fall back to the original `p` object
        p_safe = p

    goals = compute_calorie_goal(p_safe)

    profile_data = {
        "user_id": user_id,
        "name": p_safe.name or "",
        "age": p_safe.age,
        "sex": p_safe.sex,
        "height_cm": p_safe.height_cm,
        "current_weight_kg": p_safe.current_weight_kg,
        "target_weight_kg": p_safe.target_weight_kg,
        "activity_level": p_safe.activity_level,
        "goal": p_dict.get("goal", getattr(p_safe, "goal", "mantenere")),
        **goals,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    if "height_cm" in profile_data:
        profile_data["height_cm"] = int(float(profile_data["height_cm"]))

    # Upsert on user_id (must be unique)
    supabase.table("profiles").upsert(profile_data, on_conflict="user_id").execute()

    return Profile(**profile_data)


@app.get("/test-supabase")
def test_supabase():
    result = supabase.table("profiles").select("*").limit(1).execute()
    return result.data


@api_router.get("/profile/{device_id}", response_model=Optional[Profile])
async def get_profile(device_id: str, user_id: str = Depends(get_current_user_id)):
    resp = supabase.table("profiles").select("*").eq("user_id", user_id).execute()
    if resp.data:
        return Profile(**resp.data[0])
    return None


@api_router.post("/meals", response_model=Meal)
async def create_meal(m: MealCreate, user_id: str = Depends(get_current_user_id)):
    meal_data = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "dish_name": m.dish_name,
        "foods": [f.model_dump() for f in m.foods],
        "total_calories": m.total_calories,
        "total_protein": m.total_protein,
        "total_carbs": m.total_carbs,
        "total_fat": m.total_fat,
        "total_fiber": m.total_fiber,
        "meal_date": m.meal_date,
        "meal_type": m.meal_type,
        "notes": m.notes,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    meal_data.pop("image_base64", None)

    supabase.table("meals").insert(meal_data).execute()
    return Meal(**meal_data)


@api_router.get("/meals", response_model=List[Meal])
async def list_meals(
    device_id: Optional[str] = None,
    meal_date: Optional[str] = None,
    user_id: str = Depends(get_current_user_id)
):
    query = supabase.table("meals").select("*").eq("user_id", user_id)
    if meal_date:
        query = query.eq("meal_date", meal_date)
    resp = query.order("created_at", desc=True).execute()
    docs = resp.data
    return [Meal(**d) for d in docs]


@api_router.delete("/meals/{meal_id}")
async def delete_meal(meal_id: str, device_id: Optional[str] = None, user_id: str = Depends(get_current_user_id)):
    resp = supabase.table("meals").delete().eq("id", meal_id).eq("user_id", user_id).execute()
    if not resp.data:
        raise HTTPException(status_code=404, detail="Pasto non trovato")
    return {"ok": True}


@api_router.get("/daily-summary")
async def daily_summary(
    meal_date: str,
    device_id: Optional[str] = None,
    user_id: str = Depends(get_current_user_id)
):
    # Fetch meals for the day
    resp_meals = supabase.table("meals").select("*").eq("user_id", user_id).eq("meal_date", meal_date).execute()
    docs = resp_meals.data

    # Fetch profile
    resp_profile = supabase.table("profiles").select("*").eq("user_id", user_id).execute()
    profile_doc = resp_profile.data[0] if resp_profile.data else None

    totals = {
        "calories": sum(d.get("total_calories", 0) for d in docs),
        "protein": sum(d.get("total_protein", 0) for d in docs),
        "carbs": sum(d.get("total_carbs", 0) for d in docs),
        "fat": sum(d.get("total_fat", 0) for d in docs),
        "fiber": sum(d.get("total_fiber", 0) for d in docs),
        "meal_count": len(docs),
    }

    goals = None
    if profile_doc:
        goals = {
            "calories": profile_doc.get("daily_calorie_goal", 2000),
            "protein": profile_doc.get("protein_goal", 120),
            "carbs": profile_doc.get("carbs_goal", 250),
            "fat": profile_doc.get("fat_goal", 65),
            "fiber": profile_doc.get("fiber_goal", 30),
        }

    return {
        "totals": totals,
        "goals": goals,
        "meal_date": meal_date
    }


# ============ MEAL PLANNING ============

class PlanningTargets(BaseModel):
    """Non-authorizing nutrition constraints already calculated by Aura2."""

    calories: float = Field(ge=800, le=6000)
    protein: Optional[float] = Field(default=None, ge=0, le=500)
    carbs: Optional[float] = Field(default=None, ge=0, le=1000)
    fat: Optional[float] = Field(default=None, ge=0, le=500)
    fiber: Optional[float] = Field(default=None, ge=0, le=150)
    bmi: Optional[float] = Field(default=None, ge=10, le=80)
    goal: Optional[Literal["dimagrire", "mantenere", "aumentare"]] = None
    activity_level: Optional[Literal["sedentario", "leggero", "moderato", "intenso", "molto_intenso"]] = None


class MealPlanRequest(BaseModel):
    device_id: Optional[str] = None          # quota identity for unauthenticated guests
    preset: Literal["ipercalorico", "iperproteico", "ipocalorico", "bilanciato", "keto", "vegetariano", "vegano", "mediterraneo", "custom", "ingredients"] = "bilanciato"
    custom_prompt: str = ""
    days: int = Field(default=3, ge=1, le=7)
    target_calories: Optional[int] = Field(default=None, ge=800, le=6000)
    allergies: str = ""
    ingredients: List[str] = Field(default_factory=list, max_length=40)
    planning_targets: Optional[PlanningTargets] = None
    lang: str = "en"


class PantryExtractRequest(BaseModel):
    device_id: Optional[str] = None
    image_base64: str
    lang: str = "en"


class PantryExtractResponse(BaseModel):
    ingredients: List[str]
    notes: str = ""

class PlannedMeal(BaseModel):
    meal_type: Literal["colazione", "pranzo", "cena", "spuntino"]
    name: str
    description: str
    calories: float = Field(ge=0)
    protein: float = Field(ge=0)
    carbs: float = Field(ge=0)
    fat: float = Field(ge=0)
    ingredients: List[str] = Field(default_factory=list)

class PlannedDay(BaseModel):
    day: int = Field(ge=1)
    label: str
    meals: List[PlannedMeal]
    total_calories: float = Field(ge=0)
    total_protein: float = Field(ge=0)
    total_carbs: float = Field(ge=0)
    total_fat: float = Field(ge=0)

class MealPlanResponse(BaseModel):
    title: str
    summary: str
    days: List[PlannedDay]

class MealPlanSave(MealPlanResponse):
    device_id: Optional[str] = None          # kept for compatibility, ignored
    preset: str = "custom"

class SavedMealPlan(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    device_id: Optional[str] = None          # kept for compatibility, not stored
    user_id: Optional[str] = None
    title: str
    summary: str
    preset: str
    days: List[PlannedDay]
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


def normalize_planning_targets(
    *,
    profile: Optional[dict],
    guest_targets: Optional[PlanningTargets],
    calorie_override: Optional[int],
) -> dict:
    """Create one authoritative planning-target shape for auth and guest flows."""
    source = {}
    if profile:
        derived = {}
        try:
            derived = compute_calorie_goal(ProfileInput(**profile))
        except (TypeError, ValueError):
            logger.warning("Profile raw fields unavailable for target fallback")

        def stored_or_derived(stored_key: str, derived_key: str):
            value = profile.get(stored_key)
            if value is None or (stored_key == "bmi" and value <= 0):
                return derived.get(derived_key)
            return value

        source = {
            "calories": stored_or_derived("daily_calorie_goal", "daily_calorie_goal"),
            "protein": stored_or_derived("protein_goal", "protein_goal"),
            "carbs": stored_or_derived("carbs_goal", "carbs_goal"),
            "fat": stored_or_derived("fat_goal", "fat_goal"),
            "fiber": stored_or_derived("fiber_goal", "fiber_goal"),
            "bmi": stored_or_derived("bmi", "bmi"),
            "goal": resolve_weight_direction(
                profile.get("goal", "mantenere"),
                profile.get("current_weight_kg", 0),
                profile.get("target_weight_kg", profile.get("current_weight_kg", 0)),
            ),
            "activity_level": profile.get("activity_level"),
        }
    elif guest_targets:
        # These are generation constraints only. They never select or authorize data.
        source = guest_targets.model_dump()

    source["calories"] = calorie_override or source.get("calories") or 2000
    return PlanningTargets(**source).model_dump()


@api_router.post("/meal-plan/generate", response_model=MealPlanResponse)
async def generate_meal_plan(
    req: MealPlanRequest,
    authorization: Optional[str] = Header(None),
):
    user = await _optional_current_user(authorization)
    guest_id = None

    if user:
        user_id = user["id"]
        if _has_reached_meal_plan_daily_limit(user_id):
            raise _meal_plan_limit_error(
                "MEAL_PLAN_DAILY_LIMIT_REACHED",
                "You have reached today's limit of 2 meal-plan generations.",
            )
        _enforce_meal_plan_short_rate_limit(user_id)
        resp_profile = supabase.table("profiles").select("*").eq("user_id", user_id).execute()
        profile = resp_profile.data[0] if resp_profile.data else None
    else:
        guest_id = _guest_id_or_error(req.device_id)
        if _has_reached_guest_meal_plan_limit(guest_id):
            raise _guest_limit_error(
                "GUEST_MEAL_PLAN_LIMIT_REACHED",
                "You have reached the lifetime limit of 3 guest meal-plan generations.",
                GUEST_MEAL_PLAN_LIFETIME_LIMIT,
            )
        _enforce_meal_plan_short_rate_limit(f"guest:{guest_id}")
        profile = None

    days = req.days
    planning_targets = normalize_planning_targets(
        profile=profile,
        guest_targets=None if user else req.planning_targets,
        calorie_override=req.target_calories,
    )
    target_kcal = round(planning_targets["calories"])
    try:
        data = await ai.generate_meal_plan(
            preset=req.preset, days=days, target_kcal=int(target_kcal),
            allergies=req.allergies, custom_prompt=req.custom_prompt,
            ingredients=req.ingredients, profile=profile, lang=req.lang,
            planning_targets=planning_targets,
        )
    except AIProviderError as e:
        raise _ai_error(e, "Meal plan error")

    plan = MealPlanResponse(**data)
    if user:
        if not _record_successful_meal_plan_generation(user_id):
            raise _meal_plan_limit_error(
                "MEAL_PLAN_DAILY_LIMIT_REACHED",
                "You have reached today's limit of 2 meal-plan generations.",
            )
    elif not _record_successful_guest_meal_plan_generation(guest_id):
        raise _guest_limit_error(
            "GUEST_MEAL_PLAN_LIMIT_REACHED",
            "You have reached the lifetime limit of 3 guest meal-plan generations.",
            GUEST_MEAL_PLAN_LIFETIME_LIMIT,
        )
    return plan


@api_router.post("/pantry/extract", response_model=PantryExtractResponse)
async def extract_pantry(
    req: PantryExtractRequest,
    authorization: Optional[str] = Header(None),
):
    if not req.image_base64:
        raise HTTPException(status_code=400, detail="image_base64 required")
    if len(req.image_base64) > 8_000_000:
        raise HTTPException(status_code=413, detail="image_base64 too large")

    user = await _optional_current_user(authorization)
    guest_id = None
    if not user:
        guest_id = _guest_id_or_error(req.device_id)
        if _has_reached_guest_pantry_limit(guest_id):
            raise _guest_limit_error(
                "GUEST_PANTRY_LIMIT_REACHED",
                "You have reached the lifetime limit of 1 guest pantry scan.",
                GUEST_PANTRY_LIFETIME_LIMIT,
            )
        _enforce_guest_pantry_short_rate_limit(guest_id)

    try:
        data = await ai.extract_pantry(image_base64=req.image_base64, lang=req.lang)
    except AIProviderError as e:
        raise _ai_error(e, "Pantry scan error")

    result = PantryExtractResponse(**data)
    if guest_id and not _record_successful_guest_pantry_scan(guest_id):
        raise _guest_limit_error(
            "GUEST_PANTRY_LIMIT_REACHED",
            "You have reached the lifetime limit of 1 guest pantry scan.",
            GUEST_PANTRY_LIFETIME_LIMIT,
        )
    return result


@api_router.post("/meal-plans", response_model=SavedMealPlan)
async def save_meal_plan(payload: MealPlanSave, user_id: str = Depends(get_current_user_id)):
    saved = SavedMealPlan(
        user_id=user_id,
        title=payload.title,
        summary=payload.summary,
        preset=payload.preset,
        days=payload.days,
    )
    doc = saved.model_dump()
    # remove device_id if present (compatibility)
    doc.pop("device_id", None)
    supabase.table("meal_plans").insert(doc).execute()
    return SavedMealPlan(**doc)


@api_router.get("/meal-plans", response_model=List[SavedMealPlan])
async def list_meal_plans(device_id: Optional[str] = None, user_id: str = Depends(get_current_user_id)):
    resp = supabase.table("meal_plans").select("*").eq("user_id", user_id).order("created_at", desc=True).execute()
    return [SavedMealPlan(**d) for d in resp.data]


@api_router.delete("/meal-plans/{plan_id}")
async def delete_meal_plan(plan_id: str, device_id: Optional[str] = None, user_id: str = Depends(get_current_user_id)):
    resp = supabase.table("meal_plans").delete().eq("id", plan_id).eq("user_id", user_id).execute()
    if not resp.data:
        raise HTTPException(404, "Piano non trovato")
    return {"ok": True}


# ============ FITNESS COACHING ============

class FormAnalysisRequest(BaseModel):
    device_id: Optional[str] = None          # kept for compatibility, ignored
    exercise_name: str
    frames_base64: List[str]
    lang: str = "en"

class FormAnalysisResponse(BaseModel):
    exercise: str
    overall_score: int
    verdict: str
    strengths: List[str]
    corrections: List[str]
    risk_areas: List[str]
    cues: List[str]

class ProgramRequest(BaseModel):
    device_id: Optional[str] = None          # kept for compatibility, ignored
    goal: Literal["forza", "ipertrofia", "dimagrimento", "resistenza", "mobilita"] = "ipertrofia"
    level: Literal["principiante", "intermedio", "avanzato"] = "intermedio"
    days_per_week: int = Field(default=4, ge=1, le=7)
    equipment: Literal["palestra_completa", "casa_manubri", "corpo_libero", "outdoor"] = "palestra_completa"
    focus_areas: str = ""
    plateau_info: str = ""
    lang: str = "en"

class WorkoutExercise(BaseModel):
    name: str
    sets: int = Field(ge=1)
    reps: str
    rest_sec: int = Field(ge=0, le=600)
    notes: str = ""

class WorkoutDay(BaseModel):
    day: int = Field(ge=1)
    label: str
    focus: str
    exercises: List[WorkoutExercise]

class ProgramResponse(BaseModel):
    title: str
    summary: str
    weeks: int
    days: List[WorkoutDay]
    progression_tips: List[str]

class RecoveryRequest(BaseModel):
    device_id: Optional[str] = None          # kept for compatibility, ignored
    sleep_hours: float
    sleep_quality: int
    soreness: int
    energy: int
    stress: int
    last_workout_intensity: Literal["nessuno", "leggero", "moderato", "intenso"] = "moderato"
    lang: str = "en"

class RecoveryResponse(BaseModel):
    readiness_score: int
    status: str
    recommendation: str
    workout_advice: str

class WorkoutLog(BaseModel):
    device_id: Optional[str] = None          # kept for compatibility, ignored
    exercise: str
    sets: int
    reps: int
    weight_kg: float = 0
    duration_min: int = 0
    notes: str = ""
    log_date: str

class WorkoutEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    device_id: Optional[str] = None          # kept for compatibility, not stored
    user_id: Optional[str] = None
    exercise: str
    sets: int
    reps: int
    weight_kg: float = 0
    duration_min: int = 0
    notes: str = ""
    log_date: str
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


@api_router.post("/coach/form-analysis", response_model=FormAnalysisResponse)
async def analyze_form(req: FormAnalysisRequest):
    if not req.frames_base64:
        raise HTTPException(400, "Need at least 1 frame")
    try:
        data = await ai.analyze_exercise_form(
            exercise_name=req.exercise_name, frames_base64=req.frames_base64, lang=req.lang,
        )
    except AIProviderError as e:
        raise _ai_error(e, "Form analysis error")
    return FormAnalysisResponse(**data)


@api_router.post("/coach/program", response_model=ProgramResponse)
async def generate_program(req: ProgramRequest, user_id: str = Depends(get_current_user_id)):
    # Fetch profile
    resp_profile = supabase.table("profiles").select("*").eq("user_id", user_id).execute()
    profile = resp_profile.data[0] if resp_profile.data else None

    # Fetch recent workouts
    resp_workouts = supabase.table("workouts").select("*").eq("user_id", user_id).order("created_at", desc=True).limit(30).execute()
    recent = resp_workouts.data

    plateau_context = ""
    if recent and not req.plateau_info:
        exercises: dict = {}
        for w in recent:
            exercises.setdefault(w["exercise"], []).append(w.get("weight_kg", 0))
        stalled = [ex for ex, ws in exercises.items() if len(ws) >= 3 and max(ws) - min(ws) < 2.5]
        if stalled:
            plateau_context = f"Plateau detected on: {', '.join(stalled[:3])}. "

    try:
        data = await ai.generate_program(
            goal=req.goal, level=req.level, days_per_week=req.days_per_week,
            equipment=req.equipment, focus_areas=req.focus_areas,
            plateau_info=req.plateau_info, plateau_context=plateau_context,
            profile=profile, lang=req.lang,
        )
    except AIProviderError as e:
        raise _ai_error(e, "Program error")
    return ProgramResponse(**data)


@api_router.post("/coach/recovery", response_model=RecoveryResponse)
async def estimate_recovery(req: RecoveryRequest):
    sleep_score = min(100, (req.sleep_hours / 8) * 100 * (req.sleep_quality / 10))
    soreness_score = (10 - req.soreness) * 10
    energy_score = req.energy * 10
    stress_score = (10 - req.stress) * 10
    intensity_penalty = {"nessuno": 0, "leggero": 5, "moderato": 12, "intenso": 22}[req.last_workout_intensity]
    base = (sleep_score * 0.35 + soreness_score * 0.25 + energy_score * 0.25 + stress_score * 0.15) - intensity_penalty
    score = max(0, min(100, round(base)))
    status = recovery_status_for(score, req.lang)

    try:
        advice = await ai.recovery_advice(
            score=score, status=status,
            sleep_hours=req.sleep_hours, sleep_quality=req.sleep_quality,
            soreness=req.soreness, energy=req.energy, stress=req.stress,
            last_workout_intensity=req.last_workout_intensity, lang=req.lang,
        )
    except AIProviderError as e:
        raise _ai_error(e, "Recovery advice error")

    return RecoveryResponse(
        readiness_score=score, status=status,
        recommendation=advice.get("recommendation", ""),
        workout_advice=advice.get("workout_advice", ""),
    )


@api_router.post("/workouts", response_model=WorkoutEntry)
async def log_workout(w: WorkoutLog, user_id: str = Depends(get_current_user_id)):
    entry = WorkoutEntry(**w.model_dump())
    doc = entry.model_dump()
    doc["user_id"] = user_id
    doc.pop("device_id", None)  # compatibility, not stored
    supabase.table("workouts").insert(doc).execute()
    return WorkoutEntry(**doc)


@api_router.get("/workouts", response_model=List[WorkoutEntry])
async def list_workouts(
    device_id: Optional[str] = None,
    limit: int = 50,
    log_date: Optional[str] = None,
    user_id: str = Depends(get_current_user_id)
):
    query = supabase.table("workouts").select("*").eq("user_id", user_id)
    if log_date:
        query = query.eq("log_date", log_date)
    resp = query.order("created_at", desc=True).limit(limit).execute()
    return [WorkoutEntry(**d) for d in resp.data]


@api_router.delete("/workouts/{workout_id}")
async def delete_workout(
    workout_id: str,
    user_id: str = Depends(get_current_user_id)
):
    print(f"DELETE WORKOUT: workout_id={workout_id}, user_id={user_id}")

    result = (
        supabase
        .table("workouts")
        .delete()
        .eq("id", workout_id)
        .eq("user_id", user_id)
        .execute()
    )

    return {"success": True}

app.include_router(api_router, prefix="/api")
