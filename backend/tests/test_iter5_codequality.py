"""Iteration 5: code-quality regression tests.

Covers:
- compute_bmi edge cases (height=0 => 'n/d'; normal => 'normopeso')
- extract_pantry 413 size guard (image_base64 > 8_000_000 chars)
- analyze_food behaviour is consistent (400 when missing image)
"""
import os
import sys
import pytest
import requests

# make server importable so we can unit-test compute_bmi directly
sys.path.insert(0, "/app/backend")
from server import compute_bmi  # noqa: E402


BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    from pathlib import Path
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().rstrip("/")


# ---------- compute_bmi unit tests ----------

class TestComputeBMI:
    def test_zero_height_returns_nd_category(self):
        bmi, cat = compute_bmi(70, 0)
        assert bmi == 0
        assert cat == "n/d"
        assert isinstance(cat, str) and len(cat) > 0

    def test_negative_height_returns_nd(self):
        bmi, cat = compute_bmi(70, -10)
        assert bmi == 0
        assert cat == "n/d"

    def test_normal_bmi(self):
        bmi, cat = compute_bmi(70, 170)
        assert 24.0 <= bmi <= 24.4
        assert cat == "normopeso"

    def test_underweight(self):
        bmi, cat = compute_bmi(45, 170)
        assert cat == "sottopeso"

    def test_overweight(self):
        bmi, cat = compute_bmi(80, 170)
        assert cat == "sovrappeso"

    def test_obese(self):
        bmi, cat = compute_bmi(100, 170)
        assert cat == "obesità"


# ---------- pantry 8MB size guard ----------

class TestPantrySizeGuard:
    def test_pantry_extract_rejects_oversized_image(self):
        # 8_000_001 chars => must return 413 quickly (no LLM call)
        big = "A" * 8_000_001
        r = requests.post(
            f"{BASE_URL}/api/pantry/extract",
            json={"device_id": "TEST_iter5_size", "image_base64": big, "lang": "en"},
            timeout=30,
        )
        assert r.status_code == 413, f"expected 413 got {r.status_code}: {r.text[:200]}"

    def test_pantry_extract_rejects_missing_image(self):
        r = requests.post(
            f"{BASE_URL}/api/pantry/extract",
            json={"device_id": "TEST_iter5_missing", "image_base64": "", "lang": "en"},
            timeout=15,
        )
        assert r.status_code == 400


# ---------- analyze_food input validation ----------

class TestAnalyzeFoodInputValidation:
    def test_analyze_food_missing_image_returns_400(self):
        r = requests.post(
            f"{BASE_URL}/api/analyze-food",
            json={"image_base64": "", "lang": "en"},
            timeout=15,
        )
        assert r.status_code == 400


# ---------- basic API health ----------

class TestRootEndpoint:
    def test_root(self):
        r = requests.get(f"{BASE_URL}/api/", timeout=10)
        assert r.status_code == 200
        assert "message" in r.json()
