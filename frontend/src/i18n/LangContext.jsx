import { createContext, useContext, useEffect, useState } from "react";
import { TRANSLATIONS, interpolate } from "./translations";

const LangContext = createContext({
    lang: "en",
    setLang: () => {},
    t: (key) => key,
});

// Non-sensitive UI preference (locale code only). No auth data ever stored here.
const LANG_KEY = "nutrisnap_lang";
const SUPPORTED = ["en", "es", "it", "fr", "de", "sq", "el", "zh"];

export const LangProvider = ({ children }) => {
    const [lang, setLangState] = useState(() => {
        const saved = localStorage.getItem(LANG_KEY);
        return SUPPORTED.includes(saved) ? saved : "en";
    });

    const setLang = (l) => {
        const next = SUPPORTED.includes(l) ? l : "en";
        setLangState(next);
        localStorage.setItem(LANG_KEY, next);
    };

    useEffect(() => {
        document.documentElement.lang = lang;
    }, [lang]);

    const t = (path, vars) => {
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
    };

    return (
        <LangContext.Provider value={{ lang, setLang, t }}>
            {children}
        </LangContext.Provider>
    );
};

export const useLang = () => useContext(LangContext);
