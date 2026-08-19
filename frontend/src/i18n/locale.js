export const SUPPORTED_LANGUAGES = Object.freeze([
    "en",
    "es",
    "it",
    "fr",
    "de",
    "ko",
    "pt-BR",
    "zh",
]);

const LEGACY_LANGUAGES = new Set(["el", "sq"]);
const SIMPLE_LANGUAGE_CODES = new Set(["en", "es", "it", "fr", "de"]);

function canonicalCandidate(value) {
    return typeof value === "string"
        ? value.trim().replaceAll("_", "-").toLowerCase()
        : "";
}

export function normalizeSupportedLocale(value) {
    const candidate = canonicalCandidate(value);
    if (!candidate || LEGACY_LANGUAGES.has(candidate)) return null;

    if (candidate === "pt" || candidate.startsWith("pt-")) return "pt-BR";
    if (candidate === "ko" || candidate.startsWith("ko-")) return "ko";
    if (candidate === "zh" || candidate.startsWith("zh-")) return "zh";

    const base = candidate.split("-")[0];
    return SIMPLE_LANGUAGE_CODES.has(base) ? base : null;
}

export function preferredSupportedLocale(preferredLanguages = []) {
    for (const preferred of preferredLanguages) {
        const normalized = normalizeSupportedLocale(preferred);
        if (normalized) return normalized;
    }
    return "en";
}

export function browserPreferredLanguages(navigatorObject = globalThis.navigator) {
    if (!navigatorObject) return [];
    if (Array.isArray(navigatorObject.languages) && navigatorObject.languages.length) {
        return navigatorObject.languages;
    }
    return navigatorObject.language ? [navigatorObject.language] : [];
}

export function resolveStoredLocale(storedLocale, preferredLanguages) {
    const candidate = canonicalCandidate(storedLocale);
    if (LEGACY_LANGUAGES.has(candidate)) {
        return preferredSupportedLocale(
            preferredLanguages ?? browserPreferredLanguages(),
        );
    }

    return normalizeSupportedLocale(storedLocale) || "en";
}
