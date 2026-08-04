"""AI provider constants: language codes, preset directives, status labels."""

LANGUAGE_NAMES = {
    "en": "English",
    "es": "Spanish (Español)",
    "it": "Italian (Italiano)",
    "fr": "French (Français)",
    "de": "German (Deutsch)",
    "sq": "Albanian (Shqip)",
    "el": "Greek (Ελληνικά)",
    "zh": "Chinese Simplified (简体中文)",
}


def normalize_lang(lang):
    return lang if lang in LANGUAGE_NAMES else "en"


RECOVERY_STATUS_LABELS = {
    "en": ["Full recovery", "Partial recovery", "Insufficient recovery", "Overtraining risk"],
    "it": ["Recupero completo", "Recupero parziale", "Recupero insufficiente", "Rischio sovrallenamento"],
    "es": ["Recuperación completa", "Recuperación parcial", "Recuperación insuficiente", "Riesgo de sobreentrenamiento"],
    "fr": ["Récupération complète", "Récupération partielle", "Récupération insuffisante", "Risque de surentraînement"],
    "de": ["Vollständige Erholung", "Teilweise Erholung", "Unzureichende Erholung", "Übertrainingsrisiko"],
    "sq": ["Rikuperim i plotë", "Rikuperim i pjesshëm", "Rikuperim i pamjaftueshëm", "Rrezik mbistërvitjeje"],
    "el": ["Πλήρης ανάκαμψη", "Μερική ανάκαμψη", "Ανεπαρκής ανάκαμψη", "Κίνδυνος υπερπροπόνησης"],
    "zh": ["完全恢复", "部分恢复", "恢复不足", "过度训练风险"],
}


def recovery_status_for(score, lang):
    labels = RECOVERY_STATUS_LABELS.get(lang, RECOVERY_STATUS_LABELS["en"])
    idx = 0 if score >= 80 else 1 if score >= 60 else 2 if score >= 40 else 3
    return labels[idx]


PRESET_DIRECTIVES_IT = {
    "ipercalorico": "surplus calorico per aumento massa muscolare (+400 kcal sopra TDEE), alto in carboidrati complessi",
    "iperproteico": "alto contenuto proteico (2g/kg peso corporeo), bilanciato in carbo e grassi",
    "ipocalorico": "deficit calorico moderato per dimagrimento (-500 kcal), alto volume, saziante",
    "bilanciato": "distribuzione classica 30/40/30 (P/C/G), varietà di alimenti",
    "keto": "chetogenica: <30g carbo/die, alto grassi, moderata proteina",
    "vegetariano": "senza carne né pesce, latticini e uova ammessi, focus su legumi",
    "vegano": "100% vegetale, focus su legumi, cereali integrali, tofu, tempeh",
    "mediterraneo": "olio EVO, pesce azzurro, legumi, verdure, cereali integrali, frutta",
    "custom": "seguire istruzioni utente",
    "ingredients": "costruire i pasti usando prevalentemente gli ingredienti forniti dall'utente",
}

PRESET_DIRECTIVES_EN = {
    "ipercalorico": "caloric surplus for muscle mass gain (+400 kcal above TDEE), high in complex carbs",
    "iperproteico": "high protein (2g/kg bodyweight), balanced carbs and fats",
    "ipocalorico": "moderate caloric deficit for fat loss (-500 kcal), high volume, satiating",
    "bilanciato": "balanced 30/40/30 distribution (P/C/F), variety of foods",
    "keto": "ketogenic: <30g carbs/day, high fat, moderate protein",
    "vegetariano": "no meat or fish, dairy and eggs allowed, focus on legumes",
    "vegano": "100% plant-based, legumes, whole grains, tofu, tempeh",
    "mediterraneo": "EVO olive oil, oily fish, legumes, vegetables, whole grains, fruit",
    "custom": "follow user instructions",
    "ingredients": "build meals primarily using the ingredients provided by the user",
}


def preset_directive(preset, lang):
    table = PRESET_DIRECTIVES_IT if lang == "it" else PRESET_DIRECTIVES_EN
    return table.get(preset, table["bilanciato"])
