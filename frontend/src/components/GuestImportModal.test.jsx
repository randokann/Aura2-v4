import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { GuestImportModal } from "./GuestImportModal";

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
    Dialog: ({ open, children }) => open ? <div>{children}</div> : null,
    DialogContent: ({ children, onEscapeKeyDown, onInteractOutside, ...props }) => (
        <section {...props}>{children}</section>
    ),
    DialogDescription: ({ children, ...props }) => <p {...props}>{children}</p>,
    DialogHeader: ({ children, ...props }) => <div {...props}>{children}</div>,
    DialogTitle: ({ children, ...props }) => <h2 {...props}>{children}</h2>,
}));

describe("GuestImportModal", () => {
    let container;
    let root;

    async function render(props) {
        await act(async () => {
            root.render(<GuestImportModal {...props} />);
        });
    }

    beforeEach(() => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        if (root) act(() => root.unmount());
        container.remove();
    });

    test("shows existing-account merge policy, counts, and explicit choices", async () => {
        const onImport = jest.fn();
        const onContinue = jest.fn();
        await render({
            mode: "confirmation_required",
            counts: { meals: 2, workouts: 3, mealPlans: 4 },
            onImport,
            onContinue,
        });

        expect(document.body.textContent).toContain("Import data from this device?");
        expect(document.body.textContent).toContain("profile and saved data will stay unchanged");
        const countCards = document.querySelectorAll('[data-testid="guest-import-counts"] > div');
        expect(Array.from(countCards).map((card) => card.firstChild.textContent))
            .toEqual(["2", "3", "4"]);

        await act(async () => {
            document.querySelector('[data-testid="guest-import-confirm"]')
                .dispatchEvent(new MouseEvent("click", { bubbles: true }));
            document.querySelector('[data-testid="guest-import-continue"]')
                .dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        expect(onImport).toHaveBeenCalledTimes(1);
        expect(onContinue).toHaveBeenCalledTimes(1);
    });

    test("failure offers Retry and Continue without claiming data was lost", async () => {
        await render({ mode: "failed", onRetry: jest.fn(), onContinue: jest.fn() });

        expect(document.body.textContent).toContain("We couldn't sync the data from this device yet.");
        expect(document.body.textContent).toContain("device data is still safe");
        expect(document.querySelector('[data-testid="guest-import-retry"]')).not.toBeNull();
        expect(document.querySelector('[data-testid="guest-import-continue"]'))
            .not.toBeNull();
    });

    test("importing state prevents duplicate import actions", async () => {
        await render({ mode: "importing" });

        expect(document.body.textContent).toContain("Importing device data");
        expect(document.querySelector('[data-testid="guest-import-confirm"]')).toBeNull();
        expect(document.querySelector('[data-testid="guest-import-retry"]')).toBeNull();
    });
});
