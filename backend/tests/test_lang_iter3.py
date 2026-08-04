"""Iteration 3: EN/IT language support + ingredients preset for meal plans."""
import base64
import re
import pytest
import requests
from pathlib import Path

LONG_TIMEOUT = 180


def _b64(p: str) -> str:
    return base64.b64encode(Path(p).read_bytes()).decode()


@pytest.fixture(scope="module")
def food_b64():
    # /tmp/food.jpg is a real food image
    return _b64("/tmp/food.jpg")


@pytest.fixture(scope="module")
def form_frames():
    b1 = _b64("/tmp/img1.jpg")
    b2 = _b64("/tmp/img2.jpg")
    return [b1, b2, b1, b2]


# Heuristic: count IT-typical stopwords/diacritics/keywords vs EN
IT_MARKERS = re.compile(
    r"\b(della|degli|delle|con|una|uno|il|lo|la|gli|questo|questa|piatto|"
    r"proteine|carboidrati|grassi|pasto|verdure|pollo|riso|olio|uova|"
    r"colazione|pranzo|cena|spuntino|allenamento|recupero|forza)\b",
    re.IGNORECASE,
)
EN_MARKERS = re.compile(
    r"\b(the|and|with|this|that|dish|meal|breakfast|lunch|dinner|snack|"
    r"chicken|rice|broccoli|eggs|protein|carbs|fat|training|recovery|workout|strength)\b",
    re.IGNORECASE,
)


def lang_ratio(text: str):
    it = len(IT_MARKERS.findall(text or ""))
    en = len(EN_MARKERS.findall(text or ""))
    return it, en


# ============== analyze-food ==============
class TestAnalyzeFoodLang:
    def test_default_lang_works(self, base_url, api_client, food_b64):
        r = api_client.post(
            f"{base_url}/api/analyze-food",
            json={"image_base64": food_b64},
            timeout=LONG_TIMEOUT,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["dish_name"]
        assert isinstance(data["foods"], list) and len(data["foods"]) >= 1
        assert data["confidence"] in ("alta", "media", "bassa")

    def test_lang_en(self, base_url, api_client, food_b64):
        r = api_client.post(
            f"{base_url}/api/analyze-food",
            json={"image_base64": food_b64, "lang": "en"},
            timeout=LONG_TIMEOUT,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        combined = f"{data.get('dish_name','')} {data.get('notes','')}"
        it, en = lang_ratio(combined)
        assert en >= it, f"expected English dominant, got it={it} en={en}: {combined}"
        # confidence intentionally kept Italian keys
        assert data["confidence"] in ("alta", "media", "bassa")

    def test_lang_it(self, base_url, api_client, food_b64):
        r = api_client.post(
            f"{base_url}/api/analyze-food",
            json={"image_base64": food_b64, "lang": "it"},
            timeout=LONG_TIMEOUT,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        combined = f"{data.get('dish_name','')} {data.get('notes','')}"
        it, en = lang_ratio(combined)
        assert it >= en, f"expected Italian dominant, got it={it} en={en}: {combined}"


# ============== meal-plan/generate ==============
class TestMealPlanLang:
    def test_ingredients_preset_en(self, base_url, api_client, device_id):
        ingredients = ["chicken breast", "rice", "broccoli", "olive oil", "eggs"]
        payload = {
            "device_id": device_id,
            "preset": "ingredients",
            "ingredients": ingredients,
            "days": 2,
            "lang": "en",
        }
        r = api_client.post(
            f"{base_url}/api/meal-plan/generate", json=payload, timeout=LONG_TIMEOUT
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["title"]
        assert len(data["days"]) >= 1

        # Collect all ingredient strings + meal names
        all_text = []
        for day in data["days"]:
            for meal in day["meals"]:
                all_text.append(meal.get("name", ""))
                all_text.extend(meal.get("ingredients", []))
                # meal_type keys stay Italian
                assert meal["meal_type"] in (
                    "colazione", "pranzo", "cena", "spuntino"
                ), meal["meal_type"]
        joined = " ".join(all_text).lower()
        # At least 2 of the provided ingredients must appear
        matches = sum(
            1 for ing in ["chicken", "rice", "broccoli", "olive oil", "egg"]
            if ing in joined
        )
        assert matches >= 2, f"ingredients not used enough. joined={joined[:500]}"

        # Language check
        summary = data.get("summary", "") + " " + " ".join(all_text)
        it, en = lang_ratio(summary)
        assert en >= it, f"expected English content, it={it} en={en}"

    def test_bilanciato_en_keeps_italian_meal_type_keys(
        self, base_url, api_client, device_id
    ):
        payload = {
            "device_id": device_id,
            "preset": "bilanciato",
            "days": 2,
            "lang": "en",
        }
        r = api_client.post(
            f"{base_url}/api/meal-plan/generate", json=payload, timeout=LONG_TIMEOUT
        )
        assert r.status_code == 200, r.text
        data = r.json()
        seen_types = set()
        for day in data["days"]:
            for meal in day["meals"]:
                assert meal["meal_type"] in (
                    "colazione", "pranzo", "cena", "spuntino"
                ), f"meal_type not Italian internal key: {meal['meal_type']}"
                seen_types.add(meal["meal_type"])
        assert len(seen_types) >= 2

        # Content should be English
        text = data.get("summary", "")
        for day in data["days"]:
            for meal in day["meals"]:
                text += " " + meal.get("name", "") + " " + " ".join(meal.get("ingredients", []))
        it, en = lang_ratio(text)
        assert en >= it, f"expected English content in bilanciato en; it={it} en={en}"

    def test_iperproteico_it(self, base_url, api_client, device_id):
        payload = {
            "device_id": device_id,
            "preset": "iperproteico",
            "days": 2,
            "lang": "it",
        }
        r = api_client.post(
            f"{base_url}/api/meal-plan/generate", json=payload, timeout=LONG_TIMEOUT
        )
        assert r.status_code == 200, r.text
        data = r.json()
        text = data.get("summary", "")
        for day in data["days"]:
            for meal in day["meals"]:
                text += " " + meal.get("name", "") + " " + " ".join(meal.get("ingredients", []))
        it, en = lang_ratio(text)
        assert it >= en, f"expected Italian content; it={it} en={en}"

    def test_no_lang_defaults_ok(self, base_url, api_client, device_id):
        # Backward compat: no lang key => should default and succeed
        payload = {"device_id": device_id, "preset": "bilanciato", "days": 1}
        r = api_client.post(
            f"{base_url}/api/meal-plan/generate", json=payload, timeout=LONG_TIMEOUT
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["title"] and len(data["days"]) >= 1


# ============== coach/recovery ==============
class TestRecoveryLang:
    def _payload(self, device_id, lang):
        p = {
            "device_id": device_id,
            "sleep_hours": 7,
            "sleep_quality": 7,
            "soreness": 3,
            "energy": 7,
            "stress": 4,
            "last_workout_intensity": "moderato",
        }
        if lang is not None:
            p["lang"] = lang
        return p

    def test_recovery_en_status(self, base_url, api_client, device_id):
        r = api_client.post(
            f"{base_url}/api/coach/recovery",
            json=self._payload(device_id, "en"),
            timeout=LONG_TIMEOUT,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["status"] in (
            "Full recovery", "Partial recovery",
            "Insufficient recovery", "Overtraining risk",
        ), f"unexpected EN status: {data['status']}"
        # Recommendation should be English-dominant
        combined = f"{data.get('recommendation','')} {data.get('workout_advice','')}"
        it, en = lang_ratio(combined)
        assert en >= it, f"expected English recommendation; it={it} en={en}: {combined}"

    def test_recovery_it_status(self, base_url, api_client, device_id):
        r = api_client.post(
            f"{base_url}/api/coach/recovery",
            json=self._payload(device_id, "it"),
            timeout=LONG_TIMEOUT,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["status"] in (
            "Recupero completo", "Recupero parziale",
            "Recupero insufficiente", "Rischio sovrallenamento",
        ), f"unexpected IT status: {data['status']}"

    def test_recovery_no_lang_defaults(self, base_url, api_client, device_id):
        r = api_client.post(
            f"{base_url}/api/coach/recovery",
            json=self._payload(device_id, None),
            timeout=LONG_TIMEOUT,
        )
        assert r.status_code == 200, r.text


# ============== coach/program ==============
class TestProgramLang:
    def test_program_en(self, base_url, api_client, device_id):
        payload = {
            "device_id": device_id,
            "goal": "ipertrofia",
            "level": "intermedio",
            "days_per_week": 3,
            "equipment": "palestra_completa",
            "lang": "en",
        }
        r = api_client.post(
            f"{base_url}/api/coach/program", json=payload, timeout=LONG_TIMEOUT
        )
        assert r.status_code == 200, r.text
        data = r.json()
        text = data.get("title", "") + " " + (data.get("summary") or "")
        for day in data["days"]:
            text += " " + day.get("focus", "")
            for ex in day.get("exercises", []):
                text += " " + ex.get("name", "") + " " + (ex.get("notes") or "")
        text += " " + " ".join(data.get("progression_tips") or [])
        it, en = lang_ratio(text)
        assert en >= it, f"expected English program; it={it} en={en}: {text[:400]}"


# ============== coach/form-analysis ==============
class TestFormAnalysisLang:
    def test_form_analysis_en(self, base_url, api_client, device_id, form_frames):
        payload = {
            "device_id": device_id,
            "exercise_name": "Squat",
            "frames_base64": form_frames,
            "lang": "en",
        }
        r = api_client.post(
            f"{base_url}/api/coach/form-analysis",
            json=payload, timeout=LONG_TIMEOUT,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert 0 <= data["overall_score"] <= 100
        assert isinstance(data["strengths"], list)
        assert isinstance(data["corrections"], list)
        text = " ".join(
            (data.get("strengths") or []) + (data.get("corrections") or [])
            + (data.get("cues") or [])
        )
        text += " " + (data.get("verdict") or "")
        it, en = lang_ratio(text)
        assert en >= it, f"expected English form analysis; it={it} en={en}: {text[:400]}"
