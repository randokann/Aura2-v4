"""Iteration 6 refactor invariants.

Ensures the AI provider modularization is truly decoupled and non-behavioral:
- server.py doesn't import emergentintegrations directly (only via `ai` pkg)
- get_ai_service() is a singleton (same id across calls/imports)
- compute_bmi / compute_calorie_goal remain in server.py (not moved to ai/)
- ai.constants exposes RECOVERY_STATUS_LABELS with identical labels/order.
"""
import sys
import re
from pathlib import Path

import pytest

SERVER_PATH = Path("/app/backend/server.py")
sys.path.insert(0, "/app/backend")


def test_server_does_not_import_emergentintegrations():
    src = SERVER_PATH.read_text()
    assert "emergentintegrations" not in src, (
        "server.py must not import emergentintegrations directly; use `ai` package"
    )


def test_server_imports_from_ai_package():
    src = SERVER_PATH.read_text()
    assert re.search(r"^from ai\b", src, re.MULTILINE), "server.py must import from `ai` package"
    assert "get_ai_service" in src


def test_get_ai_service_singleton():
    from ai import get_ai_service
    a = get_ai_service()
    b = get_ai_service()
    assert id(a) == id(b), "get_ai_service must return a singleton"


def test_get_ai_service_singleton_across_reimport():
    # Simulate two different call sites both fetching the service
    import importlib
    import ai as ai_mod
    importlib.reload(ai_mod)  # noqa: F841 (module cached in sys.modules)
    from ai import get_ai_service as g1
    from ai import get_ai_service as g2
    assert id(g1()) == id(g2())


def test_compute_helpers_still_in_server():
    import server
    assert callable(getattr(server, "compute_bmi", None))
    assert callable(getattr(server, "compute_calorie_goal", None))
    # ensure they were NOT re-exported from ai package
    import ai
    assert not hasattr(ai, "compute_bmi")
    assert not hasattr(ai, "compute_calorie_goal")


def test_compute_bmi_values_unchanged():
    from server import compute_bmi
    assert compute_bmi(70, 175) == (22.9, "normopeso")
    assert compute_bmi(50, 170) == (17.3, "sottopeso")
    assert compute_bmi(85, 170) == (29.4, "sovrappeso")
    assert compute_bmi(100, 170) == (34.6, "obesità")
    assert compute_bmi(70, 0) == (0, "n/d")


def test_recovery_status_labels_identical():
    from ai.constants import RECOVERY_STATUS_LABELS
    # Enforce previous known values (used by earlier tests)
    assert RECOVERY_STATUS_LABELS["en"] == [
        "Full recovery", "Partial recovery", "Insufficient recovery", "Overtraining risk"
    ]
    assert RECOVERY_STATUS_LABELS["it"][0] == "Recupero completo"
    assert RECOVERY_STATUS_LABELS["fr"][3] == "Risque de surentraînement"
    assert RECOVERY_STATUS_LABELS["zh"][0] == "完全恢复"
    # 8 languages
    assert set(RECOVERY_STATUS_LABELS.keys()) == {"en", "it", "es", "fr", "de", "sq", "el", "zh"}
    for labels in RECOVERY_STATUS_LABELS.values():
        assert len(labels) == 4


def test_ai_package_public_surface():
    import ai
    assert hasattr(ai, "get_ai_service")
    assert hasattr(ai, "AIProvider")
    assert hasattr(ai, "AIProviderError")
    assert hasattr(ai, "AIService")


def test_recovery_status_for_thresholds():
    from ai.constants import recovery_status_for
    assert recovery_status_for(90, "en") == "Full recovery"
    assert recovery_status_for(70, "en") == "Partial recovery"
    assert recovery_status_for(50, "en") == "Insufficient recovery"
    assert recovery_status_for(20, "en") == "Overtraining risk"
    # unknown lang falls back to en
    assert recovery_status_for(90, "xx") == "Full recovery"
