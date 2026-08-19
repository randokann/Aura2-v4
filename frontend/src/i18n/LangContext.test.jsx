import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { LangProvider, useLang } from "./LangContext";

function Observer() {
    const { lang, setLang, t } = useLang();
    return (
        <div>
            <span data-testid="locale">{lang}</span>
            <span data-testid="account-copy">{t("profile.account_connected")}</span>
            <button type="button" onClick={() => setLang("pt_BR")}>Português</button>
        </div>
    );
}

describe("LangProvider locale recovery", () => {
    let container;
    let root;
    let originalLanguages;

    beforeEach(() => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        originalLanguages = navigator.languages;
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
        localStorage.clear();
    });

    afterEach(() => {
        if (root) act(() => root.unmount());
        container.remove();
        localStorage.clear();
        Object.defineProperty(navigator, "languages", {
            configurable: true,
            value: originalLanguages,
        });
    });

    test.each(["el", "sq"])("recovers legacy %s through the supported device locale", async (legacy) => {
        localStorage.setItem("nutrisnap_lang", legacy);
        Object.defineProperty(navigator, "languages", {
            configurable: true,
            value: ["ko-KR", "en-US"],
        });

        await act(async () => root.render(<LangProvider><Observer /></LangProvider>));

        expect(document.querySelector('[data-testid="locale"]').textContent).toBe("ko");
        expect(document.querySelector('[data-testid="account-copy"]').textContent).toBe("계정 연결됨");
        expect(localStorage.getItem("nutrisnap_lang")).toBe("ko");
        expect(document.documentElement.lang).toBe("ko");
    });

    test("normalizes a selected pt_BR preference to pt-BR", async () => {
        await act(async () => root.render(<LangProvider><Observer /></LangProvider>));
        const button = document.querySelector("button");
        await act(async () => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));

        expect(document.querySelector('[data-testid="locale"]').textContent).toBe("pt-BR");
        expect(document.querySelector('[data-testid="account-copy"]').textContent).toBe("Conta conectada");
        expect(localStorage.getItem("nutrisnap_lang")).toBe("pt-BR");
        expect(document.documentElement.lang).toBe("pt-BR");
    });
});
