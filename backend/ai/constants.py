"""AI provider constants: language codes, preset directives, status labels."""

LANGUAGE_NAMES = {
    "en": "English",
    "es": "Spanish (Español)",
    "it": "Italian (Italiano)",
    "fr": "French (Français)",
    "de": "German (Deutsch)",
    "ko": "Korean (한국어)",
    "pt-BR": "Brazilian Portuguese (Português do Brasil)",
    "zh": "Chinese Simplified (简体中文)",
}


def normalize_lang(lang):
    candidate = str(lang or "").strip().replace("_", "-").lower()
    if candidate == "pt" or candidate.startswith("pt-"):
        return "pt-BR"
    if candidate == "ko" or candidate.startswith("ko-"):
        return "ko"
    if candidate == "zh" or candidate.startswith("zh-"):
        return "zh"
    base = candidate.split("-", 1)[0]
    return base if base in {"en", "es", "it", "fr", "de"} else "en"


RECOVERY_STATUS_LABELS = {
    "en": ["Full recovery", "Partial recovery", "Insufficient recovery", "Overtraining risk"],
    "it": ["Recupero completo", "Recupero parziale", "Recupero insufficiente", "Rischio sovrallenamento"],
    "es": ["Recuperación completa", "Recuperación parcial", "Recuperación insuficiente", "Riesgo de sobreentrenamiento"],
    "fr": ["Récupération complète", "Récupération partielle", "Récupération insuffisante", "Risque de surentraînement"],
    "de": ["Vollständige Erholung", "Teilweise Erholung", "Unzureichende Erholung", "Übertrainingsrisiko"],
    "ko": ["완전 회복", "부분 회복", "회복 부족", "과훈련 위험"],
    "pt-BR": ["Recuperação completa", "Recuperação parcial", "Recuperação insuficiente", "Risco de excesso de treino"],
    "zh": ["完全恢复", "部分恢复", "恢复不足", "过度训练风险"],
}


def recovery_status_for(score, lang):
    labels = RECOVERY_STATUS_LABELS[normalize_lang(lang)]
    idx = 0 if score >= 80 else 1 if score >= 60 else 2 if score >= 40 else 3
    return labels[idx]


PRESET_DIRECTIVES_IT = {
    "ipercalorico": "usa pasti caloricamente densi restando nel target calorico Flaro; non calcolare un surplus",
    "iperproteico": "privilegia alimenti proteici e distribuisce il target proteico Flaro tra i pasti; non creare un nuovo target",
    "ipocalorico": "usa pasti sazianti e a bassa densità calorica restando nel target Flaro; non calcolare un deficit",
    "bilanciato": "crea un piano vario e pratico intorno ai target calorici e macro Flaro",
    "keto": "usa alimenti chetogenici e carboidrati molto bassi; mantieni calorie e proteine Flaro e segnala sinteticamente l'eventuale conflitto con il target carboidrati",
    "vegetariano": "senza carne né pesce, latticini e uova ammessi, focus su legumi",
    "vegano": "100% vegetale, focus su legumi, cereali integrali, tofu, tempeh",
    "mediterraneo": "olio EVO, pesce azzurro, legumi, verdure, cereali integrali, frutta",
    "custom": "segui materialmente le istruzioni utente senza sostituire i target numerici Flaro",
    "ingredients": "usa prevalentemente gli ingredienti forniti; aggiungi solo normali ingredienti di base e non inventare ingredienti principali",
}

PRESET_DIRECTIVES_EN = {
    "ipercalorico": "use calorie-dense meals within Flaro's calorie target; do not calculate a surplus",
    "iperproteico": "prioritize protein-rich foods and distribute Flaro's protein target across meals; do not create a new target",
    "ipocalorico": "use filling, lower-calorie-density meals within Flaro's target; do not calculate a deficit",
    "bilanciato": "create a varied, practical plan around Flaro's calorie and macro targets",
    "keto": "use keto-compatible foods and very low carbohydrates; preserve Flaro calories and protein and briefly disclose any conflict with the carbohydrate target",
    "vegetariano": "no meat or fish, dairy and eggs allowed, focus on legumes",
    "vegano": "100% plant-based, legumes, whole grains, tofu, tempeh",
    "mediterraneo": "EVO olive oil, oily fish, legumes, vegetables, whole grains, fruit",
    "custom": "materially follow user instructions without replacing Flaro's numeric targets",
    "ingredients": "primarily use supplied ingredients; add only ordinary pantry staples and do not invent major ingredients",
}


def preset_directive(preset, lang):
    table = PRESET_DIRECTIVES_IT if lang == "it" else PRESET_DIRECTIVES_EN
    return table.get(preset, table["bilanciato"])
