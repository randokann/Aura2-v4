"""Backend tests iteration 2: meal planning + fitness coaching + regression."""
import base64
import time
import pytest
import requests
from pathlib import Path


LONG_TIMEOUT = 120  # LLM calls can be slow


# ---------- Helpers ----------
def _load_b64(path: str) -> str:
    return base64.b64encode(Path(path).read_bytes()).decode()


@pytest.fixture(scope="module")
def frames_b64():
    # Use two real JPEG images fetched from unsplash saved to /tmp
    b1 = _load_b64("/tmp/img1.jpg")
    b2 = _load_b64("/tmp/img2.jpg")
    return [b1, b2, b1, b2, b1]  # 5 frames


# =========================================================
# REGRESSION: previous endpoints
# =========================================================
class TestRegression:
    def test_root(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/")
        assert r.status_code == 200
        assert "message" in r.json()

    def test_profile_create_and_get(self, base_url, api_client, device_id):
        payload = {
            "device_id": device_id,
            "name": "TEST_User",
            "age": 30,
            "sex": "maschio",
            "height_cm": 175,
            "current_weight_kg": 75,
            "target_weight_kg": 72,
            "activity_level": "moderato",
            "goal": "dimagrire",
        }
        r = api_client.post(f"{base_url}/api/profile", json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["device_id"] == device_id
        assert data["bmi"] > 0
        assert data["daily_calorie_goal"] > 1200

        r2 = api_client.get(f"{base_url}/api/profile/{device_id}")
        assert r2.status_code == 200
        assert r2.json()["device_id"] == device_id

    def test_meals_crud(self, base_url, api_client, device_id):
        meal_payload = {
            "device_id": device_id,
            "dish_name": "TEST_Insalata",
            "foods": [{"name": "insalata", "quantity": "100g", "calories": 50,
                       "protein": 2, "carbs": 5, "fat": 1, "fiber": 3}],
            "total_calories": 50, "total_protein": 2, "total_carbs": 5,
            "total_fat": 1, "total_fiber": 3,
            "meal_date": "2026-01-15", "meal_type": "pranzo"
        }
        r = api_client.post(f"{base_url}/api/meals", json=meal_payload)
        assert r.status_code == 200
        meal_id = r.json()["id"]

        r = api_client.get(f"{base_url}/api/meals", params={"device_id": device_id})
        assert r.status_code == 200
        assert any(m["id"] == meal_id for m in r.json())

        r = api_client.get(f"{base_url}/api/daily-summary",
                           params={"device_id": device_id, "meal_date": "2026-01-15"})
        assert r.status_code == 200
        assert r.json()["totals"]["meal_count"] >= 1

        r = api_client.delete(f"{base_url}/api/meals/{meal_id}",
                              params={"device_id": device_id})
        assert r.status_code == 200

        r = api_client.delete(f"{base_url}/api/meals/{meal_id}",
                              params={"device_id": device_id})
        assert r.status_code == 404


# =========================================================
# MEAL PLANNING
# =========================================================
class TestMealPlanning:
    _saved_plan_id = None

    def test_generate_iperproteico(self, base_url, api_client, device_id):
        payload = {"device_id": device_id, "preset": "iperproteico", "days": 3}
        r = api_client.post(f"{base_url}/api/meal-plan/generate",
                            json=payload, timeout=LONG_TIMEOUT)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "title" in data and data["title"]
        assert "summary" in data
        assert isinstance(data["days"], list) and len(data["days"]) >= 1
        day = data["days"][0]
        assert "meals" in day and len(day["meals"]) >= 1
        meal = day["meals"][0]
        for k in ["meal_type", "name", "calories", "protein", "carbs", "fat", "ingredients"]:
            assert k in meal, f"missing {k}"
        assert isinstance(meal["ingredients"], list)
        # save for later reuse
        pytest.iperproteico_plan = data

    def test_generate_custom(self, base_url, api_client, device_id):
        payload = {
            "device_id": device_id,
            "preset": "custom",
            "custom_prompt": "massa muscolare senza lattosio",
            "days": 2,
        }
        r = api_client.post(f"{base_url}/api/meal-plan/generate",
                            json=payload, timeout=LONG_TIMEOUT)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["title"]
        assert len(data["days"]) >= 1

    def test_save_list_delete_plan(self, base_url, api_client, device_id):
        plan = getattr(pytest, "iperproteico_plan", None)
        if plan is None:
            pytest.skip("no plan generated")
        save_payload = {**plan, "device_id": device_id, "preset": "iperproteico"}
        r = api_client.post(f"{base_url}/api/meal-plans", json=save_payload)
        assert r.status_code == 200, r.text
        saved = r.json()
        plan_id = saved["id"]
        assert saved["preset"] == "iperproteico"

        r = api_client.get(f"{base_url}/api/meal-plans", params={"device_id": device_id})
        assert r.status_code == 200
        assert any(p["id"] == plan_id for p in r.json())

        r = api_client.delete(f"{base_url}/api/meal-plans/{plan_id}",
                              params={"device_id": device_id})
        assert r.status_code == 200

        r = api_client.delete(f"{base_url}/api/meal-plans/{plan_id}",
                              params={"device_id": device_id})
        assert r.status_code == 404


# =========================================================
# FITNESS COACHING
# =========================================================
class TestCoach:
    def test_form_analysis(self, base_url, api_client, device_id, frames_b64):
        payload = {
            "device_id": device_id,
            "exercise_name": "Squat",
            "frames_base64": frames_b64,
        }
        r = api_client.post(f"{base_url}/api/coach/form-analysis",
                            json=payload, timeout=LONG_TIMEOUT)
        assert r.status_code == 200, r.text
        data = r.json()
        assert 0 <= data["overall_score"] <= 100
        assert data["verdict"]
        for k in ["strengths", "corrections", "risk_areas", "cues"]:
            assert isinstance(data[k], list)

    def test_program_generation(self, base_url, api_client, device_id):
        payload = {
            "device_id": device_id,
            "goal": "ipertrofia",
            "level": "intermedio",
            "days_per_week": 4,
            "equipment": "palestra_completa",
        }
        r = api_client.post(f"{base_url}/api/coach/program",
                            json=payload, timeout=LONG_TIMEOUT)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["title"]
        assert data["summary"] is not None
        assert data["weeks"] >= 1
        assert isinstance(data["days"], list) and len(data["days"]) >= 1
        d0 = data["days"][0]
        assert "focus" in d0
        assert isinstance(d0["exercises"], list) and len(d0["exercises"]) >= 1
        ex = d0["exercises"][0]
        for k in ["name", "sets", "reps", "rest_sec"]:
            assert k in ex
        assert isinstance(data["progression_tips"], list)

    def test_recovery_deterministic(self, base_url, api_client, device_id):
        payload = {
            "device_id": device_id,
            "sleep_hours": 7,
            "sleep_quality": 7,
            "soreness": 3,
            "energy": 7,
            "stress": 4,
            "last_workout_intensity": "moderato",
            "lang": "it",
        }
        # Compute expected score deterministically (mirror server formula)
        sleep_score = min(100, (7 / 8) * 100 * (7 / 10))  # 61.25
        soreness_score = (10 - 3) * 10  # 70
        energy_score = 7 * 10  # 70
        stress_score = (10 - 4) * 10  # 60
        base = (sleep_score * 0.35 + soreness_score * 0.25 +
                energy_score * 0.25 + stress_score * 0.15) - 12
        expected = max(0, min(100, round(base)))
        # expected buckets:
        # >=80 completo, >=60 parziale, >=40 insufficiente else sovrallenamento
        if expected >= 80:
            expected_status = "Recupero completo"
        elif expected >= 60:
            expected_status = "Recupero parziale"
        elif expected >= 40:
            expected_status = "Recupero insufficiente"
        else:
            expected_status = "Rischio sovrallenamento"

        r = api_client.post(f"{base_url}/api/coach/recovery",
                            json=payload, timeout=LONG_TIMEOUT)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["readiness_score"] == expected, \
            f"got {data['readiness_score']} expected {expected}"
        assert data["status"] == expected_status
        assert data["recommendation"]
        assert data["workout_advice"]

    def test_workouts_crud(self, base_url, api_client, device_id):
        payload = {
            "device_id": device_id,
            "exercise": "TEST_Panca piana",
            "sets": 4, "reps": 8, "weight_kg": 60,
            "duration_min": 0, "notes": "", "log_date": "2026-01-15",
        }
        r = api_client.post(f"{base_url}/api/workouts", json=payload)
        assert r.status_code == 200, r.text
        entry = r.json()
        assert entry["id"]
        assert entry["exercise"] == "TEST_Panca piana"

        # Add second workout to check sort
        time.sleep(1)
        payload2 = {**payload, "exercise": "TEST_Squat", "weight_kg": 80}
        r = api_client.post(f"{base_url}/api/workouts", json=payload2)
        assert r.status_code == 200
        latest_id = r.json()["id"]

        r = api_client.get(f"{base_url}/api/workouts", params={"device_id": device_id})
        assert r.status_code == 200
        data = r.json()
        assert len(data) >= 2
        # Latest should be first (sorted by created_at desc)
        assert data[0]["id"] == latest_id
