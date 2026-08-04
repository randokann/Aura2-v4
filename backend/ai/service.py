"""AI service: high-level, provider-agnostic domain methods.

Business code (routes, models, DB) never talks to the underlying LLM SDK.
It only calls `AIService.<method>(...)`. Prompts and default-value handling
live here so a new provider can be plugged in without touching endpoints.
"""
from __future__ import annotations

import logging
import base64
from io import BytesIO
from PIL import Image
import pillow_heif

pillow_heif.register_heif_opener()
from typing import List, Optional

from .base import AIProvider, AIProviderError
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


class AIService:
    def __init__(self, provider: AIProvider):
        self._provider = provider

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
    ) -> dict:
        lang = normalize_lang(lang)
        lang_name = LANGUAGE_NAMES[lang]
        directive = preset_directive(preset, lang)

        ingredients_line = ""
        if ingredients:
            joined = ", ".join(ingredients[:40])
            if lang == "it":
                ingredients_line = f"Ingredienti disponibili (usali principalmente): {joined}."
            else:
                ingredients_line = f"Available ingredients (use them primarily): {joined}."

        if lang == "it":
            profile_info = ""
            if profile:
                profile_info = (
                    f"Utente: {profile.get('sex')}, {profile.get('age')} anni, {profile.get('height_cm')}cm, "
                    f"{profile.get('current_weight_kg')}kg (obiettivo {profile.get('target_weight_kg')}kg), "
                    f"attività {profile.get('activity_level')}, obiettivo {profile.get('goal')}."
                )
            system = (
                "Sei un nutrizionista sportivo italiano. Crea piani alimentari precisi, realistici e vari. "
                "Rispondi SEMPRE e SOLO con un oggetto JSON valido in italiano."
            )
            prompt = f"""Crea un piano alimentare di {days} giorni.
Preset: {preset} ({directive})
Target calorie/die: ~{target_kcal} kcal
Allergie/restrizioni: {allergies or "nessuna"}
{ingredients_line}
{profile_info}
{"Note utente: " + custom_prompt if custom_prompt else ""}

JSON:
{{
  "title": "titolo", "summary": "riassunto",
  "days": [{{"day": 1, "label": "Giorno 1", "meals": [
    {{"meal_type": "colazione|pranzo|cena|spuntino", "name": "...", "description": "...",
      "calories": n, "protein": g, "carbs": g, "fat": g, "ingredients": ["..."]}}
  ], "total_calories": s, "total_protein": s, "total_carbs": s, "total_fat": s}}]
}}
Genera 4 pasti al giorno. Vari i piatti. SOLO JSON."""
        else:
            profile_info = ""
            if profile:
                profile_info = (
                    f"User: {profile.get('sex')}, {profile.get('age')}y, {profile.get('height_cm')}cm, "
                    f"{profile.get('current_weight_kg')}kg (target {profile.get('target_weight_kg')}kg), "
                    f"activity {profile.get('activity_level')}, goal {profile.get('goal')}."
                )
            system = (
                f"You are a sports nutritionist. Create precise, realistic, varied meal plans. "
                f"ALWAYS respond ONLY with a valid JSON object. All string values MUST be in {lang_name}. "
                f"For meal_type ALWAYS use one of exactly: colazione, pranzo, cena, spuntino (internal keys)."
            )
            prompt = f"""Create a {days}-day meal plan.
Preset: {preset} ({directive})
Target calories/day: ~{target_kcal} kcal
Allergies/restrictions: {allergies or "none"}
{ingredients_line}
{profile_info}
{"User notes: " + custom_prompt if custom_prompt else ""}

JSON:
{{
  "title": "IN {lang_name}", "summary": "IN {lang_name}",
  "days": [{{"day": 1, "label": "Day 1 IN {lang_name}", "meals": [
    {{"meal_type": "colazione|pranzo|cena|spuntino", "name": "IN {lang_name}",
      "description": "IN {lang_name}", "calories": n, "protein": g, "carbs": g, "fat": g,
      "ingredients": ["IN {lang_name}"]}}
  ], "total_calories": s, "total_protein": s, "total_carbs": s, "total_fat": s}}]
}}
Generate 4 meals per day (colazione=breakfast, pranzo=lunch, spuntino=snack, cena=dinner).
All text in {lang_name}. JSON ONLY."""

        data = await self._provider.json_completion(
            system=system,
            prompt=prompt,
            temperature=0.4
        )

        data.setdefault("title", f"Plan {preset}")
        data.setdefault("summary", "")
        data.setdefault("days", [])

        return data

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

        if lang == "it":
            profile_info = ""
            if profile:
                profile_info = f"Utente {profile.get('sex')}, {profile.get('age')}a, {profile.get('current_weight_kg')}kg."
            system = (
                "Sei un preparatore atletico italiano. Programmi periodizzati, sicuri e progressivi. "
                "Rispondi SEMPRE e SOLO con JSON valido in italiano."
            )
            prompt = f"""Crea un programma settimanale.
Obiettivo: {goal}  Livello: {level}  Giorni/sett.: {days_per_week}
Attrezzatura: {equipment.replace('_', ' ')}
Focus: {focus_areas or "corpo intero"}
{plateau_context}{"Note plateau: " + plateau_info if plateau_info else ""}
{profile_info}

JSON:
{{
  "title": "...", "summary": "...", "weeks": 4,
  "days": [{{"day": 1, "label": "Lunedì – Push", "focus": "...",
    "exercises": [{{"name": "...", "sets": 4, "reps": "6-8", "rest_sec": 120, "notes": "..."}}]}}],
  "progression_tips": ["..."]
}}
{days_per_week} giorni, 5-7 esercizi. SOLO JSON."""
        else:
            profile_info = ""
            if profile:
                profile_info = f"User: {profile.get('sex')}, {profile.get('age')}y, {profile.get('current_weight_kg')}kg."
            system = (
                f"You are a strength & conditioning coach. Periodized, safe, progressive programs. "
                f"ALWAYS respond ONLY with valid JSON. All string values MUST be in {lang_name}."
            )
            prompt = f"""Create a weekly training program.
Goal: {goal}  Level: {level}  Days/week: {days_per_week}
Equipment: {equipment.replace('_', ' ')}
Focus: {focus_areas or "balanced full body"}
{plateau_context}{"Plateau notes: " + plateau_info if plateau_info else ""}
{profile_info}

JSON:
{{
  "title": "IN {lang_name}", "summary": "IN {lang_name}", "weeks": 4,
  "days": [{{"day": 1, "label": "IN {lang_name}", "focus": "IN {lang_name}",
    "exercises": [{{"name": "IN {lang_name}", "sets": 4, "reps": "6-8",
                    "rest_sec": 120, "notes": "IN {lang_name}"}}]}}],
  "progression_tips": ["IN {lang_name}"]
}}
{days_per_week} days, 5-7 exercises each. All text in {lang_name}. JSON ONLY."""

        data = await self._provider.json_completion(system=system, prompt=prompt, temperature=0.4)
        data.setdefault("title", f"Program {goal}")
        data.setdefault("summary", "")
        data.setdefault("weeks", 4)
        data.setdefault("days", [])
        data.setdefault("progression_tips", [])
        return data

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
            f"You are a food inventory expert. Look at a fridge/pantry/kitchen photo and identify "
            f"ALL edible ingredients you can recognize. Be thorough but only list items clearly visible. "
            f"Respond ONLY with valid JSON. Ingredient names MUST be in {lang_name}, "
            f"generic and short. Combine duplicates."
        )
        prompt = f"""Analyze this fridge/pantry photo. List every edible ingredient you can identify.

JSON:
{{
  "ingredients": ["IN {lang_name}", ...],
  "notes": "short note IN {lang_name}"
}}

Names must be generic and singular where possible. Do not invent items. JSON ONLY."""

        image_base64 = compress_image(image_base64)

        data = await self._provider.json_completion(
            system=system, prompt=prompt, images_base64=[image_base64], temperature=0.4,
        )
        ings = data.get("ingredients") or []
        seen, clean = set(), []
        for it in ings:
            if not isinstance(it, str):
                continue
            v = it.strip()[:50]
            if not v:
                continue
            k = v.lower()
            if k in seen:
                continue
            seen.add(k)
            clean.append(v)
            if len(clean) >= 40:
                break
        return {"ingredients": clean, "notes": data.get("notes", "")}

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