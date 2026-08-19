import copy
import os
import sys
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError
from pydantic import ValidationError

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent
sys.path.insert(0, str(BACKEND_DIR))

# server.py constructs its clients at import time. Force inert values even when
# the developer shell contains live credentials, then restore the process env.
_IMPORT_ENV = {
    "SUPABASE_URL": "https://guest-import-tests.supabase.co",
    "SUPABASE_SERVICE_ROLE_KEY": "guest-import-test-key",
    "GOOGLE_API_KEY": "guest-import-test-key",
    "AI_PROVIDER": "gemini",
}
_PREVIOUS_IMPORT_ENV = {key: os.environ.get(key) for key in _IMPORT_ENV}
os.environ.update(_IMPORT_ENV)
try:
    import server  # noqa: E402
finally:
    for _key, _value in _PREVIOUS_IMPORT_ENV.items():
        if _value is None:
            os.environ.pop(_key, None)
        else:
            os.environ[_key] = _value

AUTH_USER_ID = "11111111-1111-4111-8111-111111111111"
OTHER_USER_ID = "22222222-2222-4222-8222-222222222222"
SOURCE_GUEST_ID = "33333333-3333-4333-8333-333333333333"
MEAL_TARGET_ID = "55555555-5555-4555-8555-555555555555"
WORKOUT_TARGET_ID = "66666666-6666-4666-8666-666666666666"
PLAN_TARGET_ID = "77777777-7777-4777-8777-777777777777"


def valid_profile():
    return {
        "name": "Ada",
        "age": 34,
        "sex": "femmina",
        "height_cm": 168.0,
        "current_weight_kg": 64.0,
        "target_weight_kg": 60.0,
        "activity_level": "moderato",
        "goal": "dimagrire",
    }


def valid_food():
    return {
        "name": "Pasta",
        "quantity": "100 g",
        "calories": 350.0,
        "protein": 12.0,
        "carbs": 70.0,
        "fat": 2.0,
        "fiber": 4.0,
    }


def valid_meal(client_import_id="meal-local-1"):
    return {
        "client_import_id": client_import_id,
        "dish_name": "Pasta al pomodoro",
        "foods": [valid_food()],
        "total_calories": 420.0,
        "total_protein": 15.0,
        "total_carbs": 78.0,
        "total_fat": 6.0,
        "total_fiber": 5.0,
        "meal_date": "2026-08-18",
        "meal_type": "pranzo",
        "notes": "Guest lunch",
    }


def valid_workout(client_import_id="workout-local-1"):
    return {
        "client_import_id": client_import_id,
        "exercise": "Squat",
        "sets": 3,
        "reps": 8,
        "weight_kg": 60.0,
        "duration_min": 20,
        "notes": "Felt good",
        "log_date": "2026-08-18",
    }


def valid_planned_meal():
    return {
        "meal_type": "pranzo",
        "name": "Rice bowl",
        "description": "Rice, beans and vegetables",
        "calories": 600.0,
        "protein": 25.0,
        "carbs": 90.0,
        "fat": 14.0,
        "ingredients": ["rice", "beans", "vegetables"],
    }


def valid_plan(client_import_id="plan-local-1"):
    return {
        "client_import_id": client_import_id,
        "title": "Guest plan",
        "summary": "A saved guest plan",
        "preset": "bilanciato",
        "days": [
            {
                "day": 1,
                "label": "Day 1",
                "meals": [valid_planned_meal()],
                "total_calories": 600.0,
                "total_protein": 25.0,
                "total_carbs": 90.0,
                "total_fat": 14.0,
            }
        ],
    }


def valid_request(*, include_profile=True):
    return {
        "version": 1,
        "source_guest_id": SOURCE_GUEST_ID,
        "confirm_existing_account": False,
        "profile": valid_profile() if include_profile else None,
        "meals": [valid_meal()],
        "workouts": [valid_workout()],
        "meal_plans": [valid_plan()],
    }


def imported_response():
    return {
        "status": "imported",
        "profile": {"outcome": "imported"},
        "meals": [
            {
                "client_import_id": "meal-local-1",
                "outcome": "imported",
                "target_id": MEAL_TARGET_ID,
            }
        ],
        "workouts": [
            {
                "client_import_id": "workout-local-1",
                "outcome": "imported",
                "target_id": WORKOUT_TARGET_ID,
            }
        ],
        "meal_plans": [
            {
                "client_import_id": "plan-local-1",
                "outcome": "imported",
                "target_id": PLAN_TARGET_ID,
            }
        ],
    }


class RpcExecution:
    def __init__(self, callback):
        self.callback = callback

    def execute(self):
        value = self.callback()
        if isinstance(value, Exception):
            raise value
        return SimpleNamespace(data=value)


class FakeSupabase:
    """RPC-only fake: accidental use of ordinary table CRUD fails loudly."""

    def __init__(self, result):
        self.result = result
        self.calls = []

    def rpc(self, name, params):
        self.calls.append((name, params))
        return RpcExecution(
            lambda: self.result(params) if callable(self.result) else self.result
        )


def authenticate_as(user_id):
    async def current_user():
        return {"id": user_id, "email": "guest-import@example.test"}

    server.app.dependency_overrides[server.get_current_user] = current_user


@pytest.fixture(autouse=True)
def restore_dependency_overrides():
    previous = dict(server.app.dependency_overrides)
    yield
    server.app.dependency_overrides.clear()
    server.app.dependency_overrides.update(previous)


@pytest.fixture
def client_factory(monkeypatch):
    clients = []

    def factory(result, user_id=AUTH_USER_ID):
        fake = FakeSupabase(result)
        monkeypatch.setattr(server, "supabase", fake)
        authenticate_as(user_id)
        client = TestClient(server.app)
        clients.append(client)
        return client, fake

    yield factory

    for client in clients:
        client.close()


def test_new_account_batch_uses_jwt_user_and_recomputes_profile(client_factory):
    client, fake = client_factory(imported_response())
    payload = valid_request()

    response = client.post("/api/guest-import", json=payload)

    assert response.status_code == 200
    assert response.json() == imported_response()
    assert len(fake.calls) == 1
    rpc_name, params = fake.calls[0]
    assert rpc_name == "import_guest_data"
    assert params["p_user_id"] == AUTH_USER_ID
    assert params["p_user_id"] != params["p_source_guest_id"]
    assert params["p_source_guest_id"] == SOURCE_GUEST_ID
    assert params["p_confirm_existing_account"] is False

    raw_profile = payload["profile"]
    computed = server.compute_calorie_goal(server.ProfileInput(**raw_profile))
    profile_item = params["p_profile"]
    assert profile_item["client_import_id"] == "profile"
    assert profile_item["data"] == {
        **raw_profile,
        **computed,
        "height_cm": 168,
    }
    assert profile_item["payload_hash"] == server._canonical_guest_import_hash(
        raw_profile
    )
    assert set(raw_profile).isdisjoint(
        {"daily_calorie_goal", "bmi", "device_id", "user_id"}
    )

    meal_item = params["p_meals"][0]
    assert meal_item["client_import_id"] == "meal-local-1"
    assert "client_import_id" not in meal_item["data"]
    assert meal_item["data"]["meal_date"] == "2026-08-18"
    assert params["p_workouts"][0]["data"]["log_date"] == "2026-08-18"
    assert not hasattr(fake, "table")


@pytest.mark.parametrize(
    "mutate",
    [
        lambda p: p.update({"user_id": OTHER_USER_ID}),
        lambda p: p["profile"].update({"daily_calorie_goal": 1}),
        lambda p: p["profile"].update({"bmi": 1}),
        lambda p: p["profile"].update({"device_id": OTHER_USER_ID}),
        lambda p: p["meals"][0].update({"id": OTHER_USER_ID}),
        lambda p: p["meals"][0].update({"user_id": OTHER_USER_ID}),
        lambda p: p["meals"][0].update({"image_base64": "secret"}),
        lambda p: p["meals"][0]["foods"][0].update({"device_id": OTHER_USER_ID}),
        lambda p: p["workouts"][0].update({"user_id": OTHER_USER_ID}),
        lambda p: p["meal_plans"][0]["days"][0]["meals"][0].update(
            {"user_id": OTHER_USER_ID}
        ),
    ],
)
def test_database_ownership_and_derived_fields_are_rejected(client_factory, mutate):
    client, fake = client_factory(imported_response())
    payload = valid_request()
    mutate(payload)

    response = client.post("/api/guest-import", json=payload)

    assert response.status_code == 422
    assert fake.calls == []


@pytest.mark.parametrize(
    "mutate",
    [
        lambda p: p.update({"version": 2}),
        lambda p: p.update({"version": True}),
        lambda p: p.update({"source_guest_id": "not-a-uuid"}),
        lambda p: p["profile"].pop("name"),
        lambda p: p["meals"][0].update({"client_import_id": "bad\u0000id"}),
        lambda p: p["meals"][0].update({"meal_date": "2026-02-30"}),
        lambda p: p["meals"][0].update({"meal_date": "2026-8-1"}),
        lambda p: p["meals"][0].update({"meal_type": "brunch"}),
        lambda p: p["meals"][0].update({"total_calories": -1.0}),
        lambda p: p["meals"][0].update({"total_calories": "420"}),
        lambda p: p["profile"].update({"height_cm": True}),
        lambda p: p["meals"][0].update({"foods": []}),
        lambda p: p["workouts"][0].update({"log_date": "yesterday"}),
        lambda p: p["workouts"][0].update({"sets": -1}),
        lambda p: p["workouts"][0].update({"sets": 0, "reps": 0, "duration_min": 0}),
        lambda p: p["meal_plans"][0].update({"days": []}),
        lambda p: p["meal_plans"][0]["days"][0]["meals"][0].update({"calories": -1.0}),
        lambda p: p["meal_plans"][0]["days"].append(
            copy.deepcopy(p["meal_plans"][0]["days"][0])
        ),
    ],
)
def test_malformed_items_return_422_without_rpc(client_factory, mutate):
    client, fake = client_factory(imported_response())
    payload = valid_request()
    mutate(payload)

    response = client.post("/api/guest-import", json=payload)

    assert response.status_code == 422
    assert fake.calls == []


def test_batch_limits_duplicate_ids_and_empty_batch_are_rejected(client_factory):
    client, fake = client_factory(imported_response())

    too_many = valid_request(include_profile=False)
    too_many["workouts"] = [valid_workout(f"workout-{index}") for index in range(501)]
    assert client.post("/api/guest-import", json=too_many).status_code == 422

    duplicate = valid_request(include_profile=False)
    duplicate["meals"].append(valid_meal("meal-local-1"))
    assert client.post("/api/guest-import", json=duplicate).status_code == 422

    empty = {
        "version": 1,
        "source_guest_id": SOURCE_GUEST_ID,
        "confirm_existing_account": False,
        "profile": None,
        "meals": [],
        "workouts": [],
        "meal_plans": [],
    }
    assert client.post("/api/guest-import", json=empty).status_code == 422
    assert fake.calls == []


def test_non_finite_numbers_are_rejected_by_models():
    meal = valid_meal()
    meal["total_calories"] = float("inf")
    with pytest.raises(ValidationError):
        server.GuestImportMealInput(**meal)

    workout = valid_workout()
    workout["weight_kg"] = float("nan")
    with pytest.raises(ValidationError):
        server.GuestImportWorkoutInput(**workout)


def test_integer_heavy_guest_json_is_accepted(client_factory):
    def integerize(value):
        if isinstance(value, dict):
            return {key: integerize(item) for key, item in value.items()}
        if isinstance(value, list):
            return [integerize(item) for item in value]
        if isinstance(value, float) and value.is_integer():
            return int(value)
        return value

    client, fake = client_factory(imported_response())
    response = client.post("/api/guest-import", json=integerize(valid_request()))

    assert response.status_code == 200
    assert len(fake.calls) == 1


def test_confirmation_response_contract_is_preserved_by_endpoint(
    client_factory,
):
    rpc_result = {
        "status": "confirmation_required",
        "existing_profile": True,
        "guest_meals": 1,
        "guest_workouts": 1,
        "guest_meal_plans": 1,
    }
    client, fake = client_factory(rpc_result)

    response = client.post("/api/guest-import", json=valid_request())

    assert response.status_code == 200
    assert response.json() == rpc_result
    assert len(fake.calls) == 1
    assert fake.calls[0][1]["p_confirm_existing_account"] is False
    assert not hasattr(fake, "table")


def test_confirmed_existing_response_contract_supports_skipped_profile(
    client_factory,
):
    rpc_result = imported_response()
    rpc_result["profile"] = {"outcome": "skipped_existing"}
    client, fake = client_factory(rpc_result)
    payload = valid_request()
    payload["confirm_existing_account"] = True

    response = client.post("/api/guest-import", json=payload)

    assert response.status_code == 200
    assert response.json()["profile"] == {"outcome": "skipped_existing"}
    assert all(
        result["outcome"] == "imported"
        for key in ("meals", "workouts", "meal_plans")
        for result in response.json()[key]
    )
    assert fake.calls[0][1]["p_confirm_existing_account"] is True
    assert not hasattr(fake, "table")


def test_hashing_is_canonical_and_excludes_item_identity():
    first = {"outer": {"b": 2, "a": 1}, "items": ["a", "b"]}
    reordered = {"items": ["a", "b"], "outer": {"a": 1, "b": 2}}
    changed = {"items": ["b", "a"], "outer": {"a": 1, "b": 2}}

    first_hash = server._canonical_guest_import_hash(first)
    assert first_hash == server._canonical_guest_import_hash(reordered)
    assert first_hash != server._canonical_guest_import_hash(changed)
    assert len(first_hash) == 64
    assert set(first_hash) <= set("0123456789abcdef")

    item = server.GuestImportMealInput(**valid_meal("local-id-a"))
    same_content = server.GuestImportMealInput(**valid_meal("local-id-b"))
    first_rpc_item = server._guest_import_rpc_item(item)
    second_rpc_item = server._guest_import_rpc_item(same_content)
    assert first_rpc_item["payload_hash"] == second_rpc_item["payload_hash"]
    assert "client_import_id" not in first_rpc_item["data"]
    assert "user_id" not in first_rpc_item["data"]
    assert "created_at" not in first_rpc_item["data"]


class StatefulImportSupabase:
    """Small ledger simulator for HTTP retry/hash behavior; SQL is reviewed separately."""

    def __init__(self):
        self.calls = []
        self.ledger = {}
        self.domain_writes = 0
        self.account_has_data = False

    def rpc(self, name, params):
        self.calls.append((name, params))
        return RpcExecution(lambda: self._execute(params))

    def _execute(self, params):
        requested = []
        for entity_type, param_name in (
            ("meal", "p_meals"),
            ("workout", "p_workouts"),
            ("meal_plan", "p_meal_plans"),
        ):
            requested.extend((entity_type, item) for item in params[param_name])

        for entity_type, item in requested:
            key = (
                params["p_user_id"],
                params["p_source_guest_id"],
                entity_type,
                item["client_import_id"],
            )
            existing = self.ledger.get(key)
            if existing and existing["payload_hash"] != item["payload_hash"]:
                raise APIError(
                    {
                        "message": "GUEST_IMPORT_COLLISION",
                        "code": "23505",
                        "hint": None,
                        "details": f"{entity_type}:{item['client_import_id']}",
                    }
                )

        new_items = [
            (entity_type, item)
            for entity_type, item in requested
            if (
                params["p_user_id"],
                params["p_source_guest_id"],
                entity_type,
                item["client_import_id"],
            )
            not in self.ledger
        ]
        if (
            self.account_has_data
            and not params["p_confirm_existing_account"]
            and new_items
        ):
            return {
                "status": "confirmation_required",
                "existing_profile": False,
                "guest_meals": len(params["p_meals"]),
                "guest_workouts": len(params["p_workouts"]),
                "guest_meal_plans": len(params["p_meal_plans"]),
            }

        results = {"meal": [], "workout": [], "meal_plan": []}
        for entity_type, item in requested:
            key = (
                params["p_user_id"],
                params["p_source_guest_id"],
                entity_type,
                item["client_import_id"],
            )
            existing = self.ledger.get(key)
            if existing:
                outcome = "already_imported"
                target_id = existing["target_id"]
            else:
                target_id = str(uuid.uuid5(uuid.NAMESPACE_URL, repr(key)))
                self.ledger[key] = {
                    "payload_hash": item["payload_hash"],
                    "target_id": target_id,
                }
                self.domain_writes += 1
                self.account_has_data = True
                outcome = "imported"
            results[entity_type].append(
                {
                    "client_import_id": item["client_import_id"],
                    "outcome": outcome,
                    "target_id": target_id,
                }
            )

        return {
            "status": "imported",
            "profile": None,
            "meals": results["meal"],
            "workouts": results["workout"],
            "meal_plans": results["meal_plan"],
        }


def test_endpoint_retry_contract_with_simulated_ledger_has_no_duplicates(monkeypatch):
    fake = StatefulImportSupabase()
    monkeypatch.setattr(server, "supabase", fake)
    authenticate_as(AUTH_USER_ID)
    payload = valid_request(include_profile=False)
    payload["workouts"] = []
    payload["meal_plans"] = []

    with TestClient(server.app) as client:
        first = client.post("/api/guest-import", json=payload)
        # Treat the first response as lost and retry the exact request.
        second = client.post("/api/guest-import", json=payload)

    assert first.status_code == 200
    assert first.json()["meals"][0]["outcome"] == "imported"
    assert second.status_code == 200
    assert second.json()["meals"][0]["outcome"] == "already_imported"
    assert (
        second.json()["meals"][0]["target_id"] == first.json()["meals"][0]["target_id"]
    )
    assert fake.domain_writes == 1


def test_same_scoped_id_with_changed_content_is_409(monkeypatch):
    fake = StatefulImportSupabase()
    monkeypatch.setattr(server, "supabase", fake)
    authenticate_as(AUTH_USER_ID)
    payload = valid_request(include_profile=False)
    payload["workouts"] = []
    payload["meal_plans"] = []

    with TestClient(server.app) as client:
        assert client.post("/api/guest-import", json=payload).status_code == 200
        payload["meals"][0]["notes"] = "changed content"
        collision = client.post("/api/guest-import", json=payload)

    assert collision.status_code == 409
    assert collision.json()["detail"]["code"] == "GUEST_IMPORT_COLLISION"
    assert fake.domain_writes == 1


def test_mixed_replay_and_new_item_requires_confirmation_without_new_write(
    monkeypatch,
):
    fake = StatefulImportSupabase()
    monkeypatch.setattr(server, "supabase", fake)
    authenticate_as(AUTH_USER_ID)
    payload = valid_request(include_profile=False)
    payload["workouts"] = []
    payload["meal_plans"] = []

    with TestClient(server.app) as client:
        assert client.post("/api/guest-import", json=payload).status_code == 200
        payload["meals"].append(valid_meal("meal-local-2"))
        confirmation = client.post("/api/guest-import", json=payload)

    assert confirmation.status_code == 200
    assert confirmation.json()["status"] == "confirmation_required"
    assert fake.domain_writes == 1


def test_rpc_failure_is_safe_and_has_no_crud_fallback(client_factory, caplog):
    client, fake = client_factory(RuntimeError("sensitive database detail"))

    response = client.post("/api/guest-import", json=valid_request())

    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "GUEST_IMPORT_FAILED"
    assert "sensitive database detail" not in response.text
    assert "sensitive database detail" not in caplog.text
    assert len(fake.calls) == 1
    assert not hasattr(fake, "table")


def test_invalid_rpc_response_is_rejected(client_factory):
    client, _ = client_factory({"status": "imported", "unexpected": True})

    response = client.post("/api/guest-import", json=valid_request())

    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "GUEST_IMPORT_INVALID_RESPONSE"


def test_missing_rpc_response_is_rejected(client_factory):
    client, fake = client_factory(imported_response())

    class MissingResponseExecution:
        def execute(self):
            return None

    fake.rpc = lambda name, params: MissingResponseExecution()
    response = client.post("/api/guest-import", json=valid_request())

    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "GUEST_IMPORT_INVALID_RESPONSE"


def test_unauthenticated_endpoint_returns_401(monkeypatch):
    fake = FakeSupabase(imported_response())
    monkeypatch.setattr(server, "supabase", fake)
    server.app.dependency_overrides.clear()

    with TestClient(server.app) as client:
        response = client.post("/api/guest-import", json=valid_request())

    assert response.status_code == 401
    assert fake.calls == []


def test_source_guest_id_cannot_select_another_authenticated_user(client_factory):
    client, fake = client_factory(imported_response(), user_id=AUTH_USER_ID)
    payload = valid_request()
    payload["source_guest_id"] = OTHER_USER_ID

    response = client.post("/api/guest-import", json=payload)

    assert response.status_code == 200
    params = fake.calls[0][1]
    assert params["p_user_id"] == AUTH_USER_ID
    assert params["p_source_guest_id"] == OTHER_USER_ID


def test_sql_static_transaction_and_security_invariants():
    migration_path = (
        REPO_ROOT
        / "supabase"
        / "migrations"
        / "20260819000000_guest_import_infrastructure.sql"
    )
    sql = migration_path.read_text()
    function_sql = sql[sql.index("create or replace function") :]

    assert "security definer" in function_sql
    assert "set search_path = pg_catalog" in function_sql
    assert "pg_advisory_xact_lock" in function_sql
    assert "hashtextextended('guest-import:' || p_user_id::text" in function_sql
    assert "GUEST_IMPORT_COLLISION" in function_sql
    assert function_sql.index("GUEST_IMPORT_COLLISION") < function_sql.index(
        "confirmation_required"
    )
    assert "exception when" not in function_sql.lower()
    assert "on conflict (user_id) do nothing" in function_sql
    assert "upsert" not in function_sql.lower()
    assert "enable row level security" in sql
    assert "from public, anon, authenticated" in sql
    assert "to service_role" in sql
