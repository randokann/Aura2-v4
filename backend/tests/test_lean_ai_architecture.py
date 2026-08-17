"""Deterministic tests for the lean AI planning contracts (no real AI calls)."""

import asyncio
import copy
import unittest
from unittest.mock import patch

from ai import AIProviderError, AIService
from ai.base import AIResponseFormatError
import ai.service as service_module


class FakeProvider:
    def __init__(self, *responses):
        self.responses = list(responses)
        self.calls = []

    async def json_completion(self, **kwargs):
        self.calls.append(kwargs)
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return copy.deepcopy(response)


TARGETS = {
    "calories": 2000,
    "protein": 130,
    "carbs": 230,
    "fat": 65,
    "fiber": 30,
    "bmi": 23.4,
    "goal": "mantenere",
    "activity_level": "moderato",
}


def meal_plan(days=1, calories_per_day=2000):
    meal_types = ["colazione", "pranzo", "spuntino", "cena"]
    result_days = []
    for day_number in range(1, days + 1):
        meals = []
        for meal_type in meal_types:
            meals.append({
                "meal_type": meal_type,
                "name": f"Meal {meal_type}",
                "description": "Practical meal",
                "calories": calories_per_day / 4,
                "protein": 30,
                "carbs": 50,
                "fat": 15,
                "ingredients": ["ingredient"],
            })
        result_days.append({
            "day": day_number,
            "label": f"Day {day_number}",
            "meals": meals,
            # Deliberately wrong: Aura2 must replace AI-provided day totals.
            "total_calories": 1,
            "total_protein": 1,
            "total_carbs": 1,
            "total_fat": 1,
        })
    return {"title": "Plan", "summary": "Summary", "days": result_days}


def generate_meal(provider, **overrides):
    params = {
        "preset": "bilanciato",
        "days": 1,
        "target_kcal": 2000,
        "allergies": "",
        "custom_prompt": "",
        "ingredients": [],
        "profile": None,
        "lang": "en",
        "planning_targets": TARGETS,
    }
    params.update(overrides)
    return asyncio.run(AIService(provider).generate_meal_plan(**params))


def workout_program(days=2, *, sets=3, rest_sec=90, exercise_name="Push-up"):
    return {
        "title": "Program",
        "summary": "Progressive plan",
        "weeks": 4,
        "days": [
            {
                "day": day,
                "label": f"Day {day}",
                "focus": "Full body",
                "exercises": [{
                    "name": exercise_name,
                    "sets": sets,
                    "reps": "8-10",
                    "rest_sec": rest_sec,
                    "notes": "Controlled tempo",
                }],
            }
            for day in range(1, days + 1)
        ],
        "progression_tips": ["Add repetitions gradually"],
    }


def generate_program(provider, **overrides):
    params = {
        "goal": "ipertrofia",
        "level": "principiante",
        "days_per_week": 2,
        "equipment": "corpo_libero",
        "focus_areas": "",
        "plateau_info": "",
        "plateau_context": "",
        "profile": None,
        "lang": "en",
    }
    params.update(overrides)
    return asyncio.run(AIService(provider).generate_program(**params))


def test_meal_plan_day_count_and_authoritative_summed_totals():
    provider = FakeProvider(meal_plan(days=2))
    result = generate_meal(provider, days=2)

    assert len(result["days"]) == 2
    assert result["days"][0]["total_calories"] == 2000
    assert result["days"][0]["total_protein"] == 120
    assert result["days"][0]["total_carbs"] == 200
    assert result["days"][0]["total_fat"] == 60


def test_meal_plan_calorie_tolerance_gets_one_repair():
    provider = FakeProvider(
        meal_plan(calories_per_day=900),
        meal_plan(calories_per_day=2000),
    )
    result = generate_meal(provider)

    assert result["days"][0]["total_calories"] == 2000
    assert len(provider.calls) == 2
    assert "REPAIR" in provider.calls[1]["prompt"]


def test_invalid_json_gets_one_repair():
    provider = FakeProvider(AIResponseFormatError("invalid JSON"), meal_plan())
    result = generate_meal(provider)

    assert result["days"][0]["total_calories"] == 2000
    assert len(provider.calls) == 2


def test_meal_plan_presets_keep_targets_authoritative():
    cases = [
        ("bilanciato", {}, "varied, practical plan"),
        ("keto", {}, "keto-compatible"),
        ("vegano", {}, "100% plant-based"),
        ("custom", {"custom_prompt": "No-cook lunches"}, "No-cook lunches"),
        ("ingredients", {"ingredients": ["beans", "rice"]}, "beans, rice"),
    ]
    for preset, kwargs, expected_prompt in cases:
        with unittest.TestCase().subTest(preset=preset):
            provider = FakeProvider(meal_plan())
            generate_meal(provider, preset=preset, **kwargs)

            prompt = provider.calls[0]["prompt"]
            assert expected_prompt in prompt
            assert "Authoritative Aura2 targets" in prompt
            assert "Protein: 130 g/day" in prompt


def test_malformed_meal_plan_fails_after_one_repair():
    provider = FakeProvider({"days": []}, {"title": "still malformed"})

    with unittest.TestCase().assertRaisesRegex(AIProviderError, "after one repair"):
        generate_meal(provider)
    assert len(provider.calls) == 2


def test_workout_day_count_positive_sets_and_rest():
    provider = FakeProvider(workout_program(days=3, sets=4, rest_sec=120))
    result = generate_program(provider, days_per_week=3)

    assert len(result["days"]) == 3
    assert result["days"][0]["exercises"][0]["sets"] == 4
    assert result["days"][0]["exercises"][0]["rest_sec"] == 120


def test_beginner_equipment_limited_workout_uses_fixed_constraints():
    provider = FakeProvider(workout_program())
    generate_program(provider, level="principiante", equipment="corpo_libero")

    prompt = provider.calls[0]["prompt"]
    assert "level=principiante" in prompt
    assert "equipment=corpo libero" in prompt
    assert "Use only the available equipment" in prompt


def test_invalid_workout_values_get_one_repair():
    provider = FakeProvider(
        workout_program(sets=0, rest_sec=-1),
        workout_program(sets=3, rest_sec=90),
    )
    result = generate_program(provider)

    assert result["days"][0]["exercises"][0]["sets"] == 3
    assert len(provider.calls) == 2


def test_malformed_workout_fails_after_one_repair():
    provider = FakeProvider({"days": []}, {"days": []})

    with unittest.TestCase().assertRaisesRegex(AIProviderError, "after one repair"):
        generate_program(provider)
    assert len(provider.calls) == 2


def extract_pantry(provider):
    with patch.object(service_module, "compress_image", lambda image: image):
        return asyncio.run(AIService(provider).extract_pantry(image_base64="image", lang="en"))


def test_pantry_normal_ingredient_list():
    provider = FakeProvider({"ingredients": ["apple", "milk"], "notes": "Visible food"})
    result = extract_pantry(provider)
    assert result == {"ingredients": ["apple", "milk"], "notes": "Visible food"}


def test_pantry_deduplicates_ingredients():
    provider = FakeProvider({"ingredients": ["Apple", " apple ", "MILK"], "notes": ""})
    result = extract_pantry(provider)
    assert result["ingredients"] == ["Apple", "MILK"]


def test_pantry_no_food_is_valid():
    provider = FakeProvider({"ingredients": [], "notes": "No visible food"})
    result = extract_pantry(provider)
    assert result["ingredients"] == []
    assert len(provider.calls) == 1


def test_malformed_pantry_fails_after_one_repair():
    provider = FakeProvider({"ingredients": "apple"}, {"ingredients": 3, "notes": []})
    with unittest.TestCase().assertRaisesRegex(AIProviderError, "after one repair"):
        extract_pantry(provider)
    assert len(provider.calls) == 2
