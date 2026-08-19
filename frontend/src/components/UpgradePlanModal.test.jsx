import React, { useState } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { UpgradePlanModal } from "./UpgradePlanModal";

jest.mock("../i18n/LangContext", () => ({
    useLang: () => ({
        lang: "en",
        setLang: jest.fn(),
        t: (key, vars) => {
            const { TRANSLATIONS, interpolate } = jest.requireActual("../i18n/translations");
            const value = key.split(".").reduce((current, part) => current?.[part], TRANSLATIONS.en);
            return vars ? interpolate(value, vars) : value;
        },
    }),
}));

jest.mock("./ui/dialog", () => ({
    Dialog: ({ open, children }) => (open ? <div>{children}</div> : null),
    DialogClose: ({ children }) => children,
    DialogContent: ({ children, ...props }) => <div {...props}>{children}</div>,
    DialogDescription: ({ children, ...props }) => <p {...props}>{children}</p>,
    DialogHeader: ({ children, ...props }) => <div {...props}>{children}</div>,
    DialogTitle: ({ children, ...props }) => <h2 {...props}>{children}</h2>,
}));

function Harness() {
    const [open, setOpen] = useState(true);
    return <UpgradePlanModal open={open} onOpenChange={setOpen} />;
}

describe("UpgradePlanModal email authentication", () => {
    let container;
    let root;

    beforeEach(() => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    test("the enabled Email CTA opens the shared email-auth dialog", async () => {
        await act(async () => root.render(<Harness />));

        expect(document.body.textContent).toContain("Flaro account");
        expect(document.body.textContent).not.toMatch(/Aura2|details to be defined|not yet defined/);

        const emailCta = document.querySelector('[data-testid="upgrade-email-cta"]');
        expect(emailCta).not.toBeNull();
        expect(emailCta.disabled).toBe(false);

        await act(async () => {
            emailCta.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });

        expect(document.querySelector('[data-testid="email-auth-dialog"]')).not.toBeNull();
        expect(document.querySelector('[data-testid="email-auth-input"]')).not.toBeNull();
    });
});
