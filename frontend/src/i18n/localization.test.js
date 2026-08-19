import { LANGUAGES } from "./languages";
import {
    SUPPORTED_LANGUAGES,
    normalizeSupportedLocale,
    resolveStoredLocale,
} from "./locale";
import { COMMON_INGREDIENTS, TRANSLATIONS } from "./translations";

const SELECTOR_ORDER = ["en", "es", "it", "fr", "de", "ko", "pt-BR", "zh"];

function leaves(value, prefix = "") {
    return Object.entries(value).flatMap(([key, child]) => {
        const path = prefix ? `${prefix}.${key}` : key;
        return child && typeof child === "object" && !Array.isArray(child)
            ? leaves(child, path)
            : [[path, child]];
    });
}

function placeholders(value) {
    return [...String(value).matchAll(/\{(\w+)\}/g)]
        .map((match) => match[1])
        .sort();
}

describe("Flaro localization registry", () => {
    test("exposes exactly the final eight selectable languages in preserved slot order", () => {
        expect(SUPPORTED_LANGUAGES).toEqual(SELECTOR_ORDER);
        expect(LANGUAGES.map(({ code }) => code)).toEqual(SELECTOR_ORDER);
        expect(LANGUAGES).toEqual([
            { code: "en", name: "English", flag: "🇬🇧" },
            { code: "es", name: "Español", flag: "🇪🇸" },
            { code: "it", name: "Italiano", flag: "🇮🇹" },
            { code: "fr", name: "Français", flag: "🇫🇷" },
            { code: "de", name: "Deutsch", flag: "🇩🇪" },
            { code: "ko", name: "한국어", flag: "🇰🇷" },
            { code: "pt-BR", name: "Português (Brasil)", flag: "🇧🇷" },
            { code: "zh", name: "中文", flag: "🇨🇳" },
        ]);
        expect(TRANSLATIONS.el).toBeUndefined();
        expect(TRANSLATIONS.sq).toBeUndefined();
    });

    test("normalizes Brazilian Portuguese, Korean, and existing locale variants", () => {
        ["pt", "pt-BR", "pt_BR", "PT-br"].forEach((value) => {
            expect(normalizeSupportedLocale(value)).toBe("pt-BR");
        });
        ["ko", "ko-KR", "ko_KR", "KO-kr"].forEach((value) => {
            expect(normalizeSupportedLocale(value)).toBe("ko");
        });
        expect(normalizeSupportedLocale("fr-CA")).toBe("fr");
        expect(normalizeSupportedLocale("zh-Hans-CN")).toBe("zh");
    });

    test("legacy el and sq preferences use a supported device locale or English", () => {
        expect(resolveStoredLocale("el", ["pt_PT", "en-US"])).toBe("pt-BR");
        expect(resolveStoredLocale("sq", ["ko-KR", "en-US"])).toBe("ko");
        expect(resolveStoredLocale("el", ["el-GR"])).toBe("en");
        expect(resolveStoredLocale("sq", ["sq-AL"])).toBe("en");
    });

    test("all active dictionaries match reviewed English keys and placeholders", () => {
        const english = new Map(leaves(TRANSLATIONS.en));
        Object.entries(TRANSLATIONS).forEach(([locale, dictionary]) => {
            const translated = new Map(leaves(dictionary));
            expect([...translated.keys()].sort()).toEqual([...english.keys()].sort());
            english.forEach((source, path) => {
                const value = translated.get(path);
                expect(typeof value).toBe("string");
                expect(value.trim()).not.toBe("");
                expect(placeholders(value)).toEqual(placeholders(source));
            });
        });
    });

    test("each active locale has localized ingredient suggestions and clean branding", () => {
        expect(Object.keys(COMMON_INGREDIENTS).sort())
            .toEqual([...SUPPORTED_LANGUAGES].sort());
        SUPPORTED_LANGUAGES.forEach((locale) => {
            expect(COMMON_INGREDIENTS[locale].length).toBeGreaterThanOrEqual(20);
        });

        const visibleCopy = JSON.stringify({ TRANSLATIONS, LANGUAGES });
        expect(visibleCopy).not.toMatch(/Aura2|NutriSnap|Emergent|Fullstack App/);
        expect(TRANSLATIONS["pt-BR"].profile.save_sync_title).toMatch(/sincronize/i);
        expect(TRANSLATIONS.ko.profile.account_connected).toMatch(/[가-힣]/);
    });
});
