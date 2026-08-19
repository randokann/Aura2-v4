import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { TRANSLATIONS, interpolate } from "./translations";
import { normalizeSupportedLocale, resolveStoredLocale } from "./locale";

const LangContext = createContext({
    lang: "en",
    setLang: () => {},
    t: (key) => key,
});

// Non-sensitive UI preference (locale code only). No auth data ever stored here.
const LANG_KEY = "nutrisnap_lang";

export const LangProvider = ({ children }) => {
    const [lang, setLangState] = useState(() => {
        const saved = localStorage.getItem(LANG_KEY);
        return resolveStoredLocale(saved);
    });

    const setLang = useCallback((l) => {
        const next = normalizeSupportedLocale(l) || "en";
        setLangState(next);
        localStorage.setItem(LANG_KEY, next);
    }, []);

    useEffect(() => {
        document.documentElement.lang = lang;
        localStorage.setItem(LANG_KEY, lang);
    }, [lang]);

    const t = useCallback((path, vars) => {
        const parts = path.split(".");
        // Try selected lang, fall back to English if a key is missing
        for (const dict of [TRANSLATIONS[lang], TRANSLATIONS.en]) {
            let cur = dict;
            let ok = true;
            for (const p of parts) {
                if (cur && typeof cur === "object" && p in cur) cur = cur[p];
                else { ok = false; break; }
            }
            if (ok) return vars ? interpolate(cur, vars) : cur;
        }
        return path;
    }, [lang]);

    return (
        <LangContext.Provider value={{ lang, setLang, t }}>
            {children}
        </LangContext.Provider>
    );
};

export const useLang = () => useContext(LangContext);
