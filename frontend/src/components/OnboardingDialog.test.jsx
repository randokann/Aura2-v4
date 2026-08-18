import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { OnboardingDialog } from "./OnboardingDialog";

jest.mock("../i18n/LangContext", () => ({
    useLang: () => ({
        lang: "en",
        setLang: jest.fn(),
        t: (key) => key,
    }),
}));

jest.mock("./EmailAuthDialog", () => ({ EmailAuthDialog: () => null }));
jest.mock("../lib/pendingOnboarding", () => ({ savePendingOnboarding: jest.fn() }));
jest.mock("../lib/sectionColors", () => ({ sectionStyle: () => ({}) }));

describe("OnboardingDialog authentication step", () => {
    let container;
    let root;

    async function click(testId) {
        const button = document.querySelector(`[data-testid="${testId}"]`);
        expect(button).not.toBeNull();
        await act(async () => {
            button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
    }

    async function reachFinalStep() {
        for (let step = 0; step < 4; step += 1) {
            await click("onb-next");
        }
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
        jest.clearAllMocks();
    });

    test("keeps Google as an unchanged account option for unauthenticated onboarding", async () => {
        const onSubmit = jest.fn();
        await act(async () => root.render(<OnboardingDialog onSubmit={onSubmit} />));
        await reachFinalStep();

        expect(document.querySelector('[data-testid="onb-google"]')).not.toBeNull();
        await click("onb-google");
        await click("onb-continue");

        expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
            accountMethod: "google",
            goal: "dimagrire",
        }));
    });

    test("authenticated users finish profile setup without another auth choice", async () => {
        const onSubmit = jest.fn();
        await act(async () => root.render(
            <OnboardingDialog authenticated onSubmit={onSubmit} />
        ));
        await reachFinalStep();

        expect(document.body.textContent).toContain("You're already signed in");
        expect(document.querySelector('[data-testid="onb-google"]')).toBeNull();
        expect(document.querySelector('[data-testid="onb-email"]')).toBeNull();
        await click("onb-continue");

        expect(onSubmit).toHaveBeenCalledWith(expect.not.objectContaining({
            accountMethod: expect.anything(),
        }));
    });
});
