import asyncio

from ai.constants import (
    LANGUAGE_NAMES,
    RECOVERY_STATUS_LABELS,
    normalize_lang,
    recovery_status_for,
)
from ai.service import AIService


def test_active_ai_language_set_matches_product_locales():
    assert set(LANGUAGE_NAMES) == {
        "en", "it", "es", "fr", "de", "pt-BR", "ko", "zh"
    }
    assert set(RECOVERY_STATUS_LABELS) == set(LANGUAGE_NAMES)
    assert "Brazilian Portuguese" in LANGUAGE_NAMES["pt-BR"]
    assert "Korean" in LANGUAGE_NAMES["ko"]


def test_locale_variants_normalize_without_reactivating_legacy_locales():
    for value in ("pt", "pt-BR", "pt_BR", "PT-br"):
        assert normalize_lang(value) == "pt-BR"
    for value in ("ko", "ko-KR", "ko_KR", "KO-kr"):
        assert normalize_lang(value) == "ko"

    assert normalize_lang("el") == "en"
    assert normalize_lang("sq") == "en"
    assert normalize_lang("xx") == "en"


def test_new_locales_have_localized_recovery_statuses():
    assert recovery_status_for(90, "pt_BR") == "Recuperação completa"
    assert recovery_status_for(70, "ko-KR") == "부분 회복"
    assert recovery_status_for(90, "el") == "Full recovery"


class _CapturingProvider:
    def __init__(self):
        self.systems = []

    async def json_completion(self, *, system, prompt, **kwargs):
        self.systems.append(system)
        return {"recommendation": "ok", "workout_advice": "ok"}


def test_ai_prompts_explicitly_direct_new_locale_output():
    provider = _CapturingProvider()
    service = AIService(provider)

    async def exercise_locales():
        common = {
            "score": 80,
            "status": "status",
            "sleep_hours": 8,
            "sleep_quality": 8,
            "soreness": 2,
            "energy": 8,
            "stress": 2,
            "last_workout_intensity": "leggero",
        }
        await service.recovery_advice(lang="pt_BR", **common)
        await service.recovery_advice(lang="ko-KR", **common)

    asyncio.run(exercise_locales())

    assert "Brazilian Portuguese" in provider.systems[0]
    assert "Korean" in provider.systems[1]
