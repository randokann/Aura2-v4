"""Iteration 4: 8-language support + pantry/extract + workouts log_date filter."""
import base64
import re
import uuid
import pytest
import requests
from pathlib import Path

LONG_TIMEOUT = 180


def _b64(p: str) -> str:
    return base64.b64encode(Path(p).read_bytes()).decode()


@pytest.fixture(scope="module")
def food_b64():
    return _b64("/tmp/food.jpg")


# ---------- Language detection markers ----------
# Each marker set captures characters/words highly distinctive of that language.
LANG_MARKERS = {
    "es": re.compile(r"[ñáéíóúü¿¡]|(?:\b(?:de|la|el|los|las|con|del|para|es|una|uno|arroz|pollo|verduras|comida|desayuno|almuerzo|cena|proteínas|carbohidratos|grasas|entrenamiento|recuperación|fuerza|piernas|pecho|espalda|hombros)\b)", re.IGNORECASE),
    "fr": re.compile(r"[àâçéèêëîïôûùüÿœæ]|(?:\b(?:le|la|les|des|avec|une|pour|poulet|riz|légumes|repas|petit-déjeuner|déjeuner|dîner|protéines|glucides|graisses|entraînement|récupération|force|jambes|poitrine|dos|épaules)\b)", re.IGNORECASE),
    "de": re.compile(r"[äöüß]|(?:\b(?:der|die|das|und|mit|für|eine|einen|Hähnchen|Reis|Gemüse|Mahlzeit|Frühstück|Mittagessen|Abendessen|Proteine|Kohlenhydrate|Fette|Training|Erholung|Kraft|Beine|Brust|Rücken|Schultern|Übung|Sätze|Wiederholungen)\b)", re.IGNORECASE),
    "zh": re.compile(r"[\u4e00-\u9fff]"),
    "el": re.compile(r"[\u0370-\u03ff\u1f00-\u1fff]"),
    "sq": re.compile(r"\b(?:me|dhe|për|një|nga|është|mish|pulë|oriz|perime|vakt|mëngjes|drekë|darkë|proteina|karbohidrate|yndyra|stërvitje|rikuperim|forcë|këmbë|kraharor|shpinë|shpatull)\b", re.IGNORECASE),
}


def is_language(text: str, lang: str) -> int:
    if not text:
        return 0
    return len(LANG_MARKERS[lang].findall(text))


# =========================================================
# analyze-food multi-language regression (es, fr, de, zh)
# =========================================================
class TestAnalyzeFoodMultiLang:
    @pytest.mark.parametrize("lang", ["es", "fr", "de", "zh"])
    def test_analyze_food_lang(self, base_url, api_client, food_b64, lang):
        r = api_client.post(
            f"{base_url}/api/analyze-food",
            json={"image_base64": food_b64, "mime_type": "image/jpeg", "lang": lang},
            timeout=LONG_TIMEOUT,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "dish_name" in data and isinstance(data["dish_name"], str)
        assert "notes" in data
        combined = f"{data['dish_name']} {data.get('notes', '')} " + " ".join(
            f.get("name", "") for f in data.get("foods", [])
        )
        # Confidence should remain one of Italian internal keys
        assert data["confidence"] in ("alta", "media", "bassa")
        matches = is_language(combined, lang)
        assert matches >= 1, f"Expected {lang} content, got: {combined[:200]}"


# =========================================================
# meal-plan/generate lang=fr iperproteico days=2
# =========================================================
class TestMealPlanFrench:
    def test_meal_plan_fr_iperproteico(self, base_url, api_client, device_id):
        r = api_client.post(
            f"{base_url}/api/meal-plan/generate",
            json={
                "device_id": device_id,
                "preset": "iperproteico",
                "days": 2,
                "lang": "fr",
            },
            timeout=LONG_TIMEOUT,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data["days"], list) and len(data["days"]) >= 1
        # Aggregate all text
        blob = data.get("title", "") + " " + data.get("summary", "")
        for d in data["days"]:
            blob += " " + d.get("label", "")
            for m in d["meals"]:
                blob += " " + m.get("name", "") + " " + m.get("description", "")
                # meal_type must remain Italian internal keys
                assert m["meal_type"] in ("colazione", "pranzo", "cena", "spuntino")
        fr_count = is_language(blob, "fr")
        assert fr_count >= 3, f"Expected French content, got: {blob[:300]}"


# =========================================================
# coach/recovery for multiple langs -> status label from dict
# =========================================================
RECOVERY_LABELS = {
    "es": {"Recuperación completa", "Recuperación parcial", "Recuperación insuficiente", "Riesgo de sobreentrenamiento"},
    "fr": {"Récupération complète", "Récupération partielle", "Récupération insuffisante", "Risque de surentraînement"},
    "de": {"Vollständige Erholung", "Teilweise Erholung", "Unzureichende Erholung", "Übertrainingsrisiko"},
    "sq": {"Rikuperim i plotë", "Rikuperim i pjesshëm", "Rikuperim i pamjaftueshëm", "Rrezik mbistërvitjeje"},
    "el": {"Πλήρης ανάκαμψη", "Μερική ανάκαμψη", "Ανεπαρκής ανάκαμψη", "Κίνδυνος υπερπροπόνησης"},
    "zh": {"完全恢复", "部分恢复", "恢复不足", "过度训练风险"},
    "en": {"Full recovery", "Partial recovery", "Insufficient recovery", "Overtraining risk"},
}


class TestRecoveryMultiLang:
    @pytest.mark.parametrize("lang", ["es", "fr", "de", "sq", "el", "zh"])
    def test_recovery_status_label(self, base_url, api_client, device_id, lang):
        r = api_client.post(
            f"{base_url}/api/coach/recovery",
            json={
                "device_id": device_id,
                "sleep_hours": 8.0,
                "sleep_quality": 9,
                "soreness": 2,
                "energy": 9,
                "stress": 2,
                "last_workout_intensity": "leggero",
                "lang": lang,
            },
            timeout=LONG_TIMEOUT,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["status"] in RECOVERY_LABELS[lang], (
            f"lang={lang} status={data['status']} not in expected {RECOVERY_LABELS[lang]}"
        )
        assert 0 <= data["readiness_score"] <= 100

    def test_recovery_unknown_lang_falls_back_to_english(self, base_url, api_client, device_id):
        r = api_client.post(
            f"{base_url}/api/coach/recovery",
            json={
                "device_id": device_id,
                "sleep_hours": 8.0,
                "sleep_quality": 8,
                "soreness": 3,
                "energy": 8,
                "stress": 3,
                "last_workout_intensity": "moderato",
                "lang": "xx",
            },
            timeout=LONG_TIMEOUT,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["status"] in RECOVERY_LABELS["en"], (
            f"unknown lang should fall back to EN, got: {data['status']}"
        )


# =========================================================
# coach/program lang=de
# =========================================================
class TestProgramGerman:
    def test_program_de(self, base_url, api_client, device_id):
        r = api_client.post(
            f"{base_url}/api/coach/program",
            json={
                "device_id": device_id,
                "goal": "ipertrofia",
                "level": "intermedio",
                "days_per_week": 3,
                "equipment": "palestra_completa",
                "lang": "de",
            },
            timeout=LONG_TIMEOUT,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data["days"], list) and len(data["days"]) >= 1
        blob = data.get("title", "") + " " + data.get("summary", "")
        for d in data["days"]:
            blob += " " + d.get("label", "") + " " + d.get("focus", "")
            for ex in d["exercises"]:
                blob += " " + ex.get("name", "") + " " + ex.get("notes", "")
        blob += " ".join(data.get("progression_tips", []))
        de_count = is_language(blob, "de")
        assert de_count >= 3, f"Expected German content, got: {blob[:300]}"


# =========================================================
# pantry/extract
# =========================================================
class TestPantryExtract:
    @pytest.mark.parametrize("lang", ["en", "it"])
    def test_pantry_extract_lang(self, base_url, api_client, food_b64, device_id, lang):
        r = api_client.post(
            f"{base_url}/api/pantry/extract",
            json={"device_id": device_id, "image_base64": food_b64, "lang": lang},
            timeout=LONG_TIMEOUT,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "ingredients" in data and isinstance(data["ingredients"], list)
        assert len(data["ingredients"]) > 0, "Expected non-empty ingredients from real food image"
        assert len(data["ingredients"]) <= 40
        # dedupe check (case-insensitive)
        lowered = [i.lower() for i in data["ingredients"]]
        assert len(lowered) == len(set(lowered)), "Ingredients should be deduped"
        # each item is a string, non-empty, <=50 chars
        for it in data["ingredients"]:
            assert isinstance(it, str)
            assert 0 < len(it) <= 50

    def test_pantry_extract_missing_image_returns_400(self, base_url, api_client, device_id):
        r = api_client.post(
            f"{base_url}/api/pantry/extract",
            json={"device_id": device_id, "image_base64": "", "lang": "en"},
            timeout=30,
        )
        assert r.status_code == 400, r.text


# =========================================================
# workouts log_date filter
# =========================================================
class TestWorkoutsLogDateFilter:
    def test_workouts_log_date_filter(self, base_url, api_client):
        dev = f"TEST_iter4_wk_{uuid.uuid4().hex[:8]}"
        # log 2 workouts on today, 1 on another date
        today = "2026-01-15"
        other = "2025-12-01"
        payloads = [
            {"device_id": dev, "exercise": "Squat", "sets": 4, "reps": 8, "weight_kg": 80, "log_date": today},
            {"device_id": dev, "exercise": "Bench", "sets": 4, "reps": 8, "weight_kg": 60, "log_date": today},
            {"device_id": dev, "exercise": "Deadlift", "sets": 3, "reps": 5, "weight_kg": 100, "log_date": other},
        ]
        for p in payloads:
            r = api_client.post(f"{base_url}/api/workouts", json=p, timeout=30)
            assert r.status_code == 200, r.text

        # GET without log_date -> returns all 3
        r_all = api_client.get(f"{base_url}/api/workouts", params={"device_id": dev}, timeout=30)
        assert r_all.status_code == 200
        all_docs = r_all.json()
        assert len(all_docs) == 3, f"Expected 3 workouts, got {len(all_docs)}"

        # GET with log_date=today -> returns 2
        r_today = api_client.get(
            f"{base_url}/api/workouts",
            params={"device_id": dev, "log_date": today},
            timeout=30,
        )
        assert r_today.status_code == 200
        today_docs = r_today.json()
        assert len(today_docs) == 2
        assert all(d["log_date"] == today for d in today_docs)

        # GET with log_date=other -> returns 1
        r_other = api_client.get(
            f"{base_url}/api/workouts",
            params={"device_id": dev, "log_date": other},
            timeout=30,
        )
        assert r_other.status_code == 200
        other_docs = r_other.json()
        assert len(other_docs) == 1
        assert other_docs[0]["exercise"] == "Deadlift"
