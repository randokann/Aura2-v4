"""AI service: high-level, provider-agnostic domain methods.

Business code (routes, models, DB) never talks to the underlying LLM SDK.
It only calls `AIService.<method>(...)`. Prompts and default-value handling
live here so a new provider can be plugged in without touching endpoints.
"""
from __future__ import annotations

import logging
import base64
import json
import math
from io import BytesIO
from PIL import Image
import pillow_heif

pillow_heif.register_heif_opener()
from typing import List, Optional

from .base import AIProvider, AIProviderError, AIResponseFormatError
from .constants import (
    LANGUAGE_NAMES,
    normalize_lang,
    preset_directive,
)

logger = logging.getLogger(__name__)


def compress_image(image_base64: str) -> str:
    """
    Resize large images before sending them to Gemini.
    Keeps aspect ratio and compresses to JPEG.
    """
    image_bytes = base64.b64decode(image_base64)
    image = Image.open(BytesIO(image_bytes))
    image.thumbnail((1024, 1024))
    if image.mode != "RGB":
        image = image.convert("RGB")
    output = BytesIO()
    image.save(output, format="JPEG", quality=85, optimize=True)
    return base64.b64encode(output.getvalue()).decode()


class _AIOutputValidationError(ValueError):
    """The provider returned JSON that does not satisfy a feature contract."""


def _string(value, field: str, *, allow_empty: bool = False) -> str:
    if not isinstance(value, str) or (not allow_empty and not value.strip()):
        raise _AIOutputValidationError(f"{field} must be a string")
    return value


def _number(value, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise _AIOutputValidationError(f"{field} must be numeric")
    value = float(value)
    if not math.isfinite(value) or value < 0:
        raise _AIOutputValidationError(f"{field} must be finite and non-negative")
    return value


def _positive_int(value, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise _AIOutputValidationError(f"{field} must be a positive integer")
    return value


def _string_list(value, field: str) -> List[str]:
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise _AIOutputValidationError(f"{field} must be a list of strings")
    return value


MEAL_TYPES = {"colazione", "pranzo", "cena", "spuntino"}
MEAL_PLAN_CALORIE_TOLERANCE = 0.20


def _validate_meal_plan(data: dict, *, requested_days: int, target_kcal: int) -> dict:
    if not isinstance(data, dict):
        raise _AIOutputValidationError("meal plan must be a JSON object")

    title = _string(data.get("title"), "title")
    summary = _string(data.get("summary"), "summary", allow_empty=True)
    days = data.get("days")
    if not isinstance(days, list) or len(days) != requested_days:
        raise _AIOutputValidationError(f"days must contain exactly {requested_days} items")

    normalized_days = []
    for index, day in enumerate(days, start=1):
        if not isinstance(day, dict):
            raise _AIOutputValidationError(f"days[{index}] must be an object")
        day_number = _positive_int(day.get("day"), f"days[{index}].day")
        if day_number != index:
            raise _AIOutputValidationError("day numbers must be sequential starting at 1")
        label = _string(day.get("label"), f"days[{index}].label")
        meals = day.get("meals")
        if not isinstance(meals, list) or len(meals) != len(MEAL_TYPES):
            raise _AIOutputValidationError("each day must contain exactly four meals")

        normalized_meals = []
        seen_types = set()
        totals = {"calories": 0.0, "protein": 0.0, "carbs": 0.0, "fat": 0.0}
        for meal_index, meal in enumerate(meals, start=1):
            path = f"days[{index}].meals[{meal_index}]"
            if not isinstance(meal, dict):
                raise _AIOutputValidationError(f"{path} must be an object")
            meal_type = meal.get("meal_type")
            if meal_type not in MEAL_TYPES or meal_type in seen_types:
                raise _AIOutputValidationError(f"{path}.meal_type is invalid or duplicated")
            seen_types.add(meal_type)

            normalized_meal = {
                "meal_type": meal_type,
                "name": _string(meal.get("name"), f"{path}.name"),
                "description": _string(
                    meal.get("description"), f"{path}.description", allow_empty=True
                ),
                "ingredients": _string_list(meal.get("ingredients"), f"{path}.ingredients"),
            }
            for nutrient in totals:
                value = _number(meal.get(nutrient), f"{path}.{nutrient}")
                normalized_meal[nutrient] = value
                totals[nutrient] += value
            normalized_meals.append(normalized_meal)

        if seen_types != MEAL_TYPES:
            raise _AIOutputValidationError("each required meal type must appear once per day")

        allowed_delta = max(200.0, target_kcal * MEAL_PLAN_CALORIE_TOLERANCE)
        if abs(totals["calories"] - target_kcal) > allowed_delta:
            raise _AIOutputValidationError(
                f"day {index} calories must be within {allowed_delta:.0f} kcal of {target_kcal}"
            )

        normalized_days.append({
            "day": day_number,
            "label": label,
            "meals": normalized_meals,
            "total_calories": round(totals["calories"], 1),
            "total_protein": round(totals["protein"], 1),
            "total_carbs": round(totals["carbs"], 1),
            "total_fat": round(totals["fat"], 1),
        })

    return {"title": title, "summary": summary, "days": normalized_days}


_EQUIPMENT_CONFLICT_TERMS = {
    "corpo_libero": (
        "barbell", "dumbbell", "kettlebell", "cable", "machine",
        "bilanciere", "manubrio", "manubri", "kettlebell", "cavo", "macchina",
    ),
    "casa_manubri": (
        "barbell", "cable", "machine", "bilanciere", "cavo", "macchina",
    ),
    "outdoor": (
        "barbell", "dumbbell", "kettlebell", "cable", "machine",
        "bilanciere", "manubrio", "manubri", "kettlebell", "cavo", "macchina",
    ),
}


def _validate_program(data: dict, *, requested_days: int, equipment: str) -> dict:
    if not isinstance(data, dict):
        raise _AIOutputValidationError("program must be a JSON object")

    title = _string(data.get("title"), "title")
    summary = _string(data.get("summary"), "summary", allow_empty=True)
    weeks = _positive_int(data.get("weeks"), "weeks")
    tips = _string_list(data.get("progression_tips"), "progression_tips")
    days = data.get("days")
    if not isinstance(days, list) or len(days) != requested_days:
        raise _AIOutputValidationError(f"days must contain exactly {requested_days} items")

    conflict_terms = _EQUIPMENT_CONFLICT_TERMS.get(equipment, ())
    normalized_days = []
    for index, day in enumerate(days, start=1):
        if not isinstance(day, dict):
            raise _AIOutputValidationError(f"days[{index}] must be an object")
        day_number = _positive_int(day.get("day"), f"days[{index}].day")
        if day_number != index:
            raise _AIOutputValidationError("day numbers must be sequential starting at 1")
        label = _string(day.get("label"), f"days[{index}].label")
        focus = _string(day.get("focus"), f"days[{index}].focus")
        exercises = day.get("exercises")
        if not isinstance(exercises, list) or not exercises:
            raise _AIOutputValidationError("each training day must contain exercises")

        normalized_exercises = []
        for exercise_index, exercise in enumerate(exercises, start=1):
            path = f"days[{index}].exercises[{exercise_index}]"
            if not isinstance(exercise, dict):
                raise _AIOutputValidationError(f"{path} must be an object")
            name = _string(exercise.get("name"), f"{path}.name")
            sets = _positive_int(exercise.get("sets"), f"{path}.sets")
            reps = _string(exercise.get("reps"), f"{path}.reps")
            rest_sec = exercise.get("rest_sec")
            if (
                isinstance(rest_sec, bool)
                or not isinstance(rest_sec, int)
                or not 0 <= rest_sec <= 600
            ):
                raise _AIOutputValidationError(f"{path}.rest_sec must be an integer from 0 to 600")
            notes = _string(exercise.get("notes", ""), f"{path}.notes", allow_empty=True)

            searchable = f"{name} {notes}".lower()
            if any(term in searchable for term in conflict_terms):
                raise _AIOutputValidationError(
                    f"{path} conflicts with requested equipment {equipment}"
                )
            normalized_exercises.append({
                "name": name,
                "sets": sets,
                "reps": reps,
                "rest_sec": rest_sec,
                "notes": notes,
            })

        normalized_days.append({
            "day": day_number,
            "label": label,
            "focus": focus,
            "exercises": normalized_exercises,
        })

    return {
        "title": title,
        "summary": summary,
        "weeks": weeks,
        "days": normalized_days,
        "progression_tips": tips,
    }


def _validate_pantry(data: dict) -> dict:
    if not isinstance(data, dict):
        raise _AIOutputValidationError("pantry result must be a JSON object")
    ingredients = _string_list(data.get("ingredients"), "ingredients")
    notes = _string(data.get("notes"), "notes", allow_empty=True)

    seen, clean = set(), []
    for ingredient in ingredients:
        value = ingredient.strip()[:50]
        if not value:
            continue
        key = value.casefold()
        if key in seen:
            continue
        seen.add(key)
        clean.append(value)
        if len(clean) >= 40:
            break
    return {"ingredients": clean, "notes": notes}


class AIService:
    def __init__(self, provider: AIProvider):
        self._provider = provider

    async def _validated_completion(
        self,
        *,
        system: str,
        prompt: str,
        validator,
        repair_constraint: str,
        images_base64: Optional[List[str]] = None,
        temperature: float = 0.4,
    ) -> dict:
        """Validate one generation and allow one narrowly scoped repair."""
        candidate = None
        first_error = None
        try:
            candidate = await self._provider.json_completion(
                system=system,
                prompt=prompt,
                images_base64=images_base64,
                temperature=temperature,
                max_retries=0,
            )
            return validator(candidate)
        except (AIResponseFormatError, _AIOutputValidationError) as exc:
            first_error = exc

        candidate_context = ""
        if candidate is not None:
            candidate_context = (
                "\nCandidate to correct:\n"
                + json.dumps(candidate, ensure_ascii=False)[:6000]
            )
        repair_prompt = (
            f"{prompt}\n\nREPAIR: Return the same result corrected to match the required "
            f"schema and constraints. {repair_constraint} "
            f"Validation problem: {first_error}.{candidate_context}"
        )
        try:
            repaired = await self._provider.json_completion(
                system=system,
                prompt=repair_prompt,
                images_base64=images_base64,
                temperature=temperature,
                max_retries=0,
            )
            return validator(repaired)
        except (AIProviderError, _AIOutputValidationError) as exc:
            raise AIProviderError(
                f"AI output remained invalid after one repair: {exc}"
            ) from exc

    # ---------------- food analysis ----------------

    async def analyze_food(self, *, image_base64: str, lang: str = "en") -> dict:
        lang = normalize_lang(lang)
        lang_name = LANGUAGE_NAMES[lang]

        system = (
            f"You are an expert nutritionist specialized in food image analysis. "
            f"Estimate calories and macronutrients as accurately as possible. "
            f"Respond ONLY with valid JSON. "
            f"All human-readable text must be in {lang_name}. "

            f"Your confidence score must represent how certain you are about the calorie estimate. "

            f"IMPORTANT RULE: "
            f"If confidence score is below 65, do NOT guess. "
            f"Ask the user for clarification. "

            f"When clarification is needed:"
            f"- Ask only one question."
            f"- Ask the question that would most improve the accuracy of the analysis."
            f"- The missing information can be about food identification, ingredients, portion size, weight estimation, container fullness, dimensions, preparation method, or any other relevant uncertainty."
            f"- Provide 2 to 4 possible answers."
            f"- Options must be short and realistic."
            f"- Never provide more than 4 options."
        )

        prompt = f"""
Analyze this food image. First determine if the image contains edible food.
Only perform nutrition analysis if food is present.
If no food is present, return CASE 0.


CASE 0:

If the image does not contain edible food:

Return:

{{
  "is_food": false,
  "needs_clarification": false,
  "message": "No food detected."
}}

Do not ask clarification.
Do not estimate calories.
Do not invent food.

CASE 1:
If confidence score >= 65:

Return:

{{
  "is_food": true,
  "needs_clarification": false,

  "dish_name": "food name",

  "confidence": {{
      "score": 85,
      "reasons": [
          "reason explaining confidence"
      ]
  }},

  "foods": [
 {{
   "name": "chicken breast",
   "estimated_grams": 150,
   "nutrition_per_100g": {{
      "calories": 165,
      "protein": 31,
      "carbs": 0,
      "fat": 3.6,
      "fiber": 0
   }}
 }}
],

  "notes": "additional information"
}}


CASE 2:
If confidence score < 65:

Return:

{{
 "is_food": true, 
 "needs_clarification": true,

  "clarification": {{
      "question": "one question to improve accuracy",
      "options": [
          "option 1",
          "option 2",
          "option 3",
          "option 4"
      ],
      "clarification_type": "general"
  }}
}}


Rules:
- Confidence score must be realistic.
- Use scores:
  ( 90-100 only for very clear foods with visible portions.
    70-89 for mostly clear foods with minor uncertainty.
    40-69 when ingredients, portions, or cooking methods are uncertain.
    Below 40 when the food cannot be reliably identified. )
- If confidence is below 65, ask clarification.
- Do not increase confidence just to avoid asking a question.
- Maximum 4 clarification options.
- Never invent unrealistic options.
Important:
- Provide complete nutrition_per_100g with calories, protein, carbs, fat, fiber.
- Aura2 backend will calculate final totals.
- Do not calculate meal totals.
- Do not invent hidden ingredients.
- Only estimate foods, grams, and nutrition values per 100g.
- If confidence < 65, ask clarification.
- JSON ONLY.
"""

        image_base64 = compress_image(image_base64)

        data = await self._provider.json_completion(
            system=system,
            prompt=prompt,
            images_base64=[image_base64],
            temperature=0.3,
        )

        confidence_score = (
            data.get("confidence", {}).get("score", 0)
        )

        if data.get("is_food") is False:
            return data

        needs_clarification = confidence_score < 65
        data["needs_clarification"] = needs_clarification

        if needs_clarification:
            # Ensure we only return the clarification structure and strip any foods/totals
            data.pop("foods", None)
            data.pop("dish_name", None)
            data.pop("notes", None)
            for total_key in ("total_calories", "total_protein", "total_carbs",
                              "total_fat", "total_fiber"):
                data.pop(total_key, None)
            # Guarantee clarification object exists
            data.setdefault("clarification", {
                "question": "",
                "options": [],
                "clarification_type": "general"
            })
            return data

        # Confidence is >= 65: process foods and calculate totals
        if data.get("foods"):
            totals = {
                "total_calories": 0,
                "total_protein": 0,
                "total_carbs": 0,
                "total_fat": 0,
                "total_fiber": 0,
            }

            for food in data["foods"]:
                grams = food.get("estimated_grams", 0)
                nutrition = food.get("nutrition_per_100g", {})

                multiplier = grams / 100

                totals["total_calories"] += nutrition.get("calories", 0) * multiplier
                totals["total_protein"] += nutrition.get("protein", 0) * multiplier
                totals["total_carbs"] += nutrition.get("carbs", 0) * multiplier
                totals["total_fat"] += nutrition.get("fat", 0) * multiplier
                totals["total_fiber"] += nutrition.get("fiber", 0) * multiplier

            data.update(totals)

            # Convert each food item for frontend compatibility
            for food in data["foods"]:
                food["quantity"] = f'{food.get("estimated_grams", 0)}g'
                food["calories"] = round(
                    food.get("nutrition_per_100g", {}).get("calories", 0)
                    * food.get("estimated_grams", 0)
                    / 100
                )

        # Ensure all expected keys exist
        data.setdefault("dish_name", "Unknown dish")
        data.setdefault(
            "confidence",
            {"score": 50, "reasons": ["No confidence score provided"]}
        )
        data.setdefault("foods", [])
        data.setdefault("notes", "")
        for k in ("total_calories", "total_protein", "total_carbs",
                  "total_fat", "total_fiber"):
            data.setdefault(k, 0)

        return data

    # ---------------- meal planning ----------------

    async def generate_meal_plan(
        self,
        *,
        preset: str,
        days: int,
        target_kcal: int,
        allergies: str,
        custom_prompt: str,
        ingredients: List[str],
        profile: Optional[dict],
        lang: str,
        planning_targets: Optional[dict] = None,
    ) -> dict:
        lang = normalize_lang(lang)
        lang_name = LANGUAGE_NAMES[lang]
        directive = preset_directive(preset, lang)
        targets = dict(planning_targets or {})
        targets["calories"] = target_kcal
        target_labels = (
            ("Calorie", "Proteine", "Carboidrati", "Grassi", "Fibre", "BMI", "Obiettivo", "Attività")
            if lang == "it"
            else ("Calories", "Protein", "Carbohydrates", "Fat", "Fiber", "BMI", "Goal", "Activity")
        )
        target_keys = (
            "calories", "protein", "carbs", "fat", "fiber", "bmi", "goal", "activity_level"
        )
        units = {
            "calories": " kcal/day",
            "protein": " g/day",
            "carbs": " g/day",
            "fat": " g/day",
            "fiber": " g/day",
        }
        target_lines = []
        for label, key in zip(target_labels, target_keys):
            value = targets.get(key)
            if value is not None:
                target_lines.append(f"- {label}: {value}{units.get(key, '')}")

        secondary_profile = ""
        if profile:
            available = [
                f"sex={profile.get('sex')}" if profile.get("sex") else "",
                f"age={profile.get('age')}" if profile.get("age") else "",
                f"height_cm={profile.get('height_cm')}" if profile.get("height_cm") else "",
                f"weight_kg={profile.get('current_weight_kg')}" if profile.get("current_weight_kg") else "",
            ]
            secondary_profile = ", ".join(item for item in available if item)

        system = (
            f"You compose practical meal plans. Aura2 has already calculated all supplied numeric "
            f"nutrition targets; never recompute or override BMI, BMR/TDEE, calories, macros, fiber, "
            f"or weight direction. Select foods, portions, recipes, and variety around those constraints. "
            f"Return only valid JSON; all human-readable strings must be in {lang_name}. "
            "Keep meal_type as the internal keys colazione, pranzo, cena, spuntino."
        )
        prompt = f"""Compose a {days}-day meal plan with exactly four meals per day.
Preset: {preset} — {directive}
Authoritative Aura2 targets:
{chr(10).join(target_lines)}
Allergies/restrictions: {allergies or "none"}
Available ingredients: {", ".join(ingredients[:40]) if ingredients else "none supplied"}
User instructions: {custom_prompt or "none"}
Secondary profile context (do not calculate targets from it): {secondary_profile or "none"}

Schema:
{{"title":"...","summary":"...","days":[{{"day":1,"label":"...","meals":[
{{"meal_type":"colazione|pranzo|cena|spuntino","name":"...","description":"...",
"calories":0,"protein":0,"carbs":0,"fat":0,"ingredients":["..."]}}
],"total_calories":0,"total_protein":0,"total_carbs":0,"total_fat":0}}]}}
Use realistic non-negative estimates. JSON only."""

        return await self._validated_completion(
            system=system,
            prompt=prompt,
            validator=lambda data: _validate_meal_plan(
                data, requested_days=days, target_kcal=target_kcal
            ),
            repair_constraint=(
                f"Return exactly {days} sequential days, each with one of every required meal type; "
                f"keep each day's meal-calorie sum within 20% of {target_kcal} kcal."
            ),
        )

    # ---------------- form analysis ----------------

    async def analyze_exercise_form(
        self, *, exercise_name: str, frames_base64: List[str], lang: str,
    ) -> dict:
        lang = normalize_lang(lang)
        lang_name = LANGUAGE_NAMES[lang]
        if lang == "it":
            system = (
                "Sei un coach di forza e biomeccanica italiano. Analizzi la tecnica dai fotogrammi. "
                "Sii preciso e orientato alla sicurezza. Rispondi SEMPRE e SOLO con JSON valido in italiano."
            )
            prompt = f"""Analizza la tecnica di "{exercise_name}" su questi {len(frames_base64)} fotogrammi.
JSON:
{{
  "exercise": "{exercise_name}", "overall_score": 0-100,
  "verdict": "Ottima|Buona|Discreta|Da correggere",
  "strengths": ["..."], "corrections": ["..."],
  "risk_areas": ["..."], "cues": ["..."]
}}
SOLO JSON."""
            default_verdict = "Discreta"
        else:
            system = (
                f"You are a strength & biomechanics coach. Analyze exercise technique from frames. "
                f"Be precise, safety-oriented. ALWAYS respond ONLY with valid JSON. "
                f"All string values MUST be in {lang_name}."
            )
            prompt = f"""Analyze the technique of "{exercise_name}" on these {len(frames_base64)} frames.
JSON:
{{
  "exercise": "{exercise_name}", "overall_score": 0-100,
  "verdict": "short evaluation word IN {lang_name}",
  "strengths": ["IN {lang_name}"], "corrections": ["IN {lang_name}"],
  "risk_areas": ["IN {lang_name}"], "cues": ["IN {lang_name}"]
}}
All text in {lang_name}. JSON ONLY."""
            default_verdict = "Fair"

        data = await self._provider.json_completion(
            system=system, prompt=prompt, images_base64=frames_base64, temperature=0.4,
        )
        data.setdefault("exercise", exercise_name)
        data.setdefault("overall_score", 70)
        data.setdefault("verdict", default_verdict)
        for k in ("strengths", "corrections", "risk_areas", "cues"):
            data.setdefault(k, [])
        return data

    # ---------------- training program ----------------

    async def generate_program(
        self, *, goal: str, level: str, days_per_week: int, equipment: str,
        focus_areas: str, plateau_info: str, plateau_context: str,
        profile: Optional[dict], lang: str,
    ) -> dict:
        lang = normalize_lang(lang)
        lang_name = LANGUAGE_NAMES[lang]
        profile_info = "none"
        if profile:
            values = [
                f"sex={profile.get('sex')}" if profile.get("sex") else "",
                f"age={profile.get('age')}" if profile.get("age") else "",
                f"weight_kg={profile.get('current_weight_kg')}" if profile.get("current_weight_kg") else "",
            ]
            profile_info = ", ".join(value for value in values if value) or "none"

        system = (
            f"You compose safe, progressive training programs from fixed Aura2 constraints. "
            f"Do not change the goal, training-day count, experience level, or available equipment, "
            f"and do not make medical or rehabilitation conclusions. Select exercises, sets, reps, "
            f"rest, volume distribution, and progression guidance. Return only valid JSON; all "
            f"human-readable strings must be in {lang_name}."
        )
        prompt = f"""Compose one weekly training program.
Fixed constraints: goal={goal}; level={level}; days={days_per_week}; equipment={equipment.replace('_', ' ')}.
Focus areas: {focus_areas or "balanced full body"}
Plateau context: {(plateau_context + plateau_info).strip() or "none"}
Secondary profile context: {profile_info}

Schema:
{{"title":"...","summary":"...","weeks":4,"days":[{{"day":1,"label":"...","focus":"...",
"exercises":[{{"name":"...","sets":4,"reps":"6-8","rest_sec":120,"notes":"..."}}]}}],
"progression_tips":["..."]}}
Return exactly {days_per_week} days with 5-7 exercises each. Use only the available equipment. JSON only."""

        return await self._validated_completion(
            system=system,
            prompt=prompt,
            validator=lambda data: _validate_program(
                data, requested_days=days_per_week, equipment=equipment
            ),
            repair_constraint=(
                f"Return exactly {days_per_week} sequential training days with non-empty exercises, "
                f"positive integer sets, 0-600 second rests, and no equipment beyond {equipment}."
            ),
        )

    # ---------------- recovery advice ----------------

    async def recovery_advice(
        self, *, score: int, status: str, sleep_hours: float, sleep_quality: int,
        soreness: int, energy: int, stress: int, last_workout_intensity: str, lang: str,
    ) -> dict:
        """Only the free-text advice comes from the LLM. Score+status are algorithmic."""
        lang = normalize_lang(lang)
        lang_name = LANGUAGE_NAMES[lang]

        if lang == "it":
            system = "Sei un coach del recupero italiano. Rispondi con JSON valido in italiano."
            prompt = f"""Un atleta ha readiness score {score}/100 ({status}).
Dati: sonno {sleep_hours}h qualità {sleep_quality}/10, DOMS {soreness}/10, energia {energy}/10,
stress {stress}/10, ultimo workout {last_workout_intensity}.

JSON:
{{
  "readiness_score": {score}, "status": "{status}",
  "recommendation": "raccomandazione recupero in 2 frasi",
  "workout_advice": "consiglio pratico allenamento in 1-2 frasi"
}}
SOLO JSON."""
        else:
            system = (
                f"You are a recovery coach. Respond with valid JSON. "
                f"All string values MUST be in {lang_name}."
            )
            prompt = f"""Athlete readiness {score}/100 ({status}).
Data: sleep {sleep_hours}h quality {sleep_quality}/10, DOMS {soreness}/10, energy {energy}/10,
stress {stress}/10, last workout {last_workout_intensity}.

JSON:
{{
  "readiness_score": {score}, "status": "{status}",
  "recommendation": "recovery recommendation in 2 sentences IN {lang_name}",
  "workout_advice": "practical training advice in 1-2 sentences IN {lang_name}"
}}
JSON ONLY."""

        data = await self._provider.json_completion(system=system, prompt=prompt, temperature=0.4)
        data.setdefault("recommendation", "")
        data.setdefault("workout_advice", "")
        return data

    # ---------------- pantry / fridge scan ----------------

    async def extract_pantry(self, *, image_base64: str, lang: str) -> dict:
        lang = normalize_lang(lang)
        lang_name = LANGUAGE_NAMES[lang]

        system = (
            f"Identify only visible edible ingredients in an image. Use short generic names in "
            f"{lang_name}; deduplicate and ignore non-food items and unnecessary brands. Recognize "
            f"clear labels, but never guess hidden contents or opaque containers. Return only valid JSON."
        )
        prompt = f"""Inspect this fridge or pantry image.

Schema: {{"ingredients":["short generic visible food"],"notes":"concise note"}}
If no food is visible or identification is uncertain, return an empty ingredients list and a concise explanation.
Do not calculate nutrition or suggest meals. JSON only."""

        image_base64 = compress_image(image_base64)

        return await self._validated_completion(
            system=system,
            prompt=prompt,
            images_base64=[image_base64],
            validator=_validate_pantry,
            repair_constraint="Return ingredients as a string list and notes as a string.",
        )

    # ---------------- food clarification ----------------

    async def clarify_food_analysis(
        self,
        *,
        image_base64: str,
        original_question: str,
        user_answer: str,
        clarification_type: str,
        lang: str = "en",
    ) -> dict:

        lang = normalize_lang(lang)
        lang_name = LANGUAGE_NAMES[lang]

        system = (
            f"You are an expert nutritionist. "
            f"You previously requested clarification about a food image. "
            f"The user provided additional information. "
            f"Now produce the final calorie and macro estimation. "
            f"Provide complete nutrition_per_100g (calories, protein, carbs, fat, fiber). "
            f"Respond ONLY with valid JSON. "
            f"All text must be in {lang_name}."
        )

        prompt = f"""
The previous clarification question was:

{original_question}

The user answered:

{user_answer}


Re-analyze the food image using this additional information.

Return:

{{
  "dish_name": "food name",

  "confidence": {{
      "score": 90,
      "reasons": [
          "why confidence improved"
      ]
  }},

  "foods": [
    {{
      "name": "food",
      "estimated_grams": 250,
      "nutrition_per_100g": {{
          "calories": 0,
          "protein": 0,
          "carbs": 0,
          "fat": 0,
          "fiber": 0
      }}
    }}
],
  "notes": "notes"
}}

JSON ONLY.
"""

        image_base64 = compress_image(image_base64)

        data = await self._provider.json_completion(
            system=system,
            prompt=prompt,
            images_base64=[image_base64],
            temperature=0.3,
        )

        # After clarification, we always have enough confidence to return a complete analysis.
        # Calculate totals and format foods exactly like the initial analysis.
        if data.get("foods"):
            totals = {
                "total_calories": 0,
                "total_protein": 0,
                "total_carbs": 0,
                "total_fat": 0,
                "total_fiber": 0,
            }

            for food in data["foods"]:
                grams = food.get("estimated_grams", 0)
                nutrition = food.get("nutrition_per_100g", {})

                multiplier = grams / 100

                totals["total_calories"] += nutrition.get("calories", 0) * multiplier
                totals["total_protein"] += nutrition.get("protein", 0) * multiplier
                totals["total_carbs"] += nutrition.get("carbs", 0) * multiplier
                totals["total_fat"] += nutrition.get("fat", 0) * multiplier
                totals["total_fiber"] += nutrition.get("fiber", 0) * multiplier

            data.update(totals)

            for food in data["foods"]:
                food["quantity"] = f'{food.get("estimated_grams", 0)}g'
                food["calories"] = round(
                    food.get("nutrition_per_100g", {}).get("calories", 0)
                    * food.get("estimated_grams", 0)
                    / 100
                )

        # Set defaults for any missing fields
        data.setdefault("dish_name", "Unknown dish")
        data.setdefault(
            "confidence",
            {"score": 70, "reasons": []}
        )
        data.setdefault("foods", [])
        data.setdefault("notes", "")

        for k in (
            "total_calories",
            "total_protein",
            "total_carbs",
            "total_fat",
            "total_fiber",
        ):
            data.setdefault(k, 0)

        return data
