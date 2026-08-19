import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { useAuth } from "../auth/AuthProvider";
import { useGuestMigration } from "../guestMigration/GuestMigrationProvider";
import { getProfile, saveProfile } from "../lib/api";
import {
    PENDING_ONBOARDING_KEY,
    readPendingOnboarding,
    savePendingOnboarding,
} from "../lib/pendingOnboarding";
import { EmailAuthCallback } from "./EmailAuthCallback";

jest.mock("../auth/AuthProvider", () => ({
    useAuth: jest.fn(),
}));

jest.mock("../guestMigration/GuestMigrationProvider", () => ({
    useGuestMigration: jest.fn(),
}));

jest.mock("../i18n/LangContext", () => {
    const { TRANSLATIONS, interpolate } = jest.requireActual("../i18n/translations");
    const t = (key, vars) => {
        const value = key.split(".").reduce((current, part) => current?.[part], TRANSLATIONS.en);
        return vars ? interpolate(value, vars) : value;
    };
    return {
        useLang: () => ({ lang: "en", setLang: jest.fn(), t }),
    };
});

jest.mock("../lib/api", () => ({
    getProfile: jest.fn(),
    saveProfile: jest.fn(),
}));

const FORM = {
    name: "Flaro User",
    age: 30,
    sex: "femmina",
    height_cm: 168,
    current_weight_kg: 65,
    target_weight_kg: 62,
    activity_level: "moderato",
    goal: "dimagrire",
};

describe("EmailAuthCallback", () => {
    let authState;
    let container;
    let root;
    let callbacks;
    let migrationState;

    async function renderCallback(autoContinueDelay = null) {
        await act(async () => {
            root.render(
                <EmailAuthCallback
                    autoContinueDelay={autoContinueDelay}
                    onContinue={callbacks.onContinue}
                    onReturnToSignIn={callbacks.onReturnToSignIn}
                    onRetryAuth={callbacks.onRetryAuth}
                    onClose={callbacks.onClose}
                />
            );
        });
    }

    async function click(testId) {
        const button = document.querySelector(`[data-testid="${testId}"]`);
        expect(button).not.toBeNull();
        await act(async () => {
            button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
    }

    beforeEach(() => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        localStorage.clear();
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
        callbacks = {
            onContinue: jest.fn(),
            onReturnToSignIn: jest.fn(),
            onRetryAuth: jest.fn(),
            onClose: jest.fn(),
        };
        authState = {
            user: null,
            loading: true,
            authError: null,
            clearAuthError: jest.fn(),
        };
        useAuth.mockImplementation(() => authState);
        migrationState = { settled: true, requiresDecision: false };
        useGuestMigration.mockImplementation(() => migrationState);
    });

    afterEach(() => {
        if (root) act(() => root.unmount());
        container.remove();
        localStorage.clear();
        jest.useRealTimers();
        jest.clearAllMocks();
    });

    test("same-browser new user waits for auth, creates the pending profile, and clears pending data", async () => {
        savePendingOnboarding(FORM, "email");
        getProfile.mockResolvedValue(null);
        saveProfile.mockResolvedValue({ user_id: "new-user", ...FORM });

        await renderCallback();
        expect(document.body.textContent).toContain("Confirming your email");
        expect(getProfile).not.toHaveBeenCalled();

        authState = {
            ...authState,
            loading: false,
            user: { id: "new-user", email: "new@example.com" },
        };
        await renderCallback();

        expect(getProfile).toHaveBeenCalledWith("authenticated");
        expect(saveProfile).toHaveBeenCalledTimes(1);
        expect(saveProfile).toHaveBeenCalledWith(FORM);
        expect(readPendingOnboarding()).toBeNull();
        expect(document.body.textContent).toContain("Email confirmed");
        expect(document.querySelector('[data-testid="email-callback-continue"]')).not.toBeNull();
    });

    test("existing email user preserves the existing profile without creating another one", async () => {
        savePendingOnboarding(FORM, "email");
        const existingProfile = { user_id: "existing-user", name: "Existing" };
        getProfile.mockResolvedValue(existingProfile);
        authState = {
            ...authState,
            loading: false,
            user: { id: "existing-user", email: "existing@example.com" },
        };

        await renderCallback();

        expect(getProfile).toHaveBeenCalledTimes(1);
        expect(saveProfile).not.toHaveBeenCalled();
        expect(readPendingOnboarding()).toBeNull();
        expect(document.body.textContent).toContain("Email confirmed");
        expect(document.querySelector('[data-testid="email-callback-continue"]')).not.toBeNull();
    });

    test("automatically continues into Flaro after successful completion", async () => {
        jest.useFakeTimers();
        getProfile.mockResolvedValue({ user_id: "returning-user", name: "Returning" });
        authState = {
            ...authState,
            loading: false,
            user: { id: "returning-user", email: "returning@example.com" },
        };

        await renderCallback(900);
        expect(document.body.textContent).toContain("Email confirmed");

        act(() => jest.advanceTimersByTime(900));
        expect(callbacks.onContinue).toHaveBeenCalledTimes(1);
        jest.useRealTimers();
    });

    test("cross-device callback without pending onboarding remains authenticated and offers profile setup", async () => {
        getProfile.mockResolvedValue(null);
        authState = {
            ...authState,
            loading: false,
            user: { id: "cross-device-user", email: "cross@example.com" },
        };

        await renderCallback();

        expect(localStorage.getItem(PENDING_ONBOARDING_KEY)).toBeNull();
        expect(getProfile).toHaveBeenCalledTimes(1);
        expect(saveProfile).not.toHaveBeenCalled();
        expect(document.body.textContent).toContain("Email confirmed");
        expect(document.body.textContent).toContain("there's no need to verify your email again");
        expect(document.querySelector('[data-testid="email-callback-setup"]')).not.toBeNull();
        expect(authState.clearAuthError).not.toHaveBeenCalled();
    });

    test("same-browser callback waits for guest migration before resolving the imported profile", async () => {
        authState = {
            ...authState,
            loading: false,
            user: { id: "migrating-user", email: "migrating@example.com" },
        };
        migrationState = { settled: false, requiresDecision: false };
        getProfile.mockResolvedValue({ user_id: "migrating-user", name: "Imported Guest" });

        await renderCallback();

        expect(getProfile).not.toHaveBeenCalled();
        expect(document.body.textContent).toContain("Confirming your email");

        migrationState = { settled: true, requiresDecision: false };
        await renderCallback();

        expect(getProfile).toHaveBeenCalledWith("authenticated");
        expect(saveProfile).not.toHaveBeenCalled();
        expect(document.querySelector('[data-testid="email-callback-continue"]')).not.toBeNull();
    });

    test("existing-account confirmation pauses automatic callback continuation", async () => {
        jest.useFakeTimers();
        authState = {
            ...authState,
            loading: false,
            user: { id: "existing-user", email: "existing@example.com" },
        };
        migrationState = { settled: true, requiresDecision: true };
        getProfile.mockResolvedValue({ user_id: "existing-user", name: "Existing" });

        await renderCallback(900);
        act(() => jest.advanceTimersByTime(900));

        expect(callbacks.onContinue).not.toHaveBeenCalled();
        migrationState = { settled: true, requiresDecision: false };
        await renderCallback(900);
        act(() => jest.advanceTimersByTime(900));
        expect(callbacks.onContinue).toHaveBeenCalledTimes(1);
    });

    test("profile-save failure retains pending onboarding and succeeds on retry", async () => {
        savePendingOnboarding(FORM, "email");
        getProfile.mockResolvedValue(null);
        saveProfile
            .mockRejectedValueOnce(new Error("backend unavailable"))
            .mockResolvedValueOnce({ user_id: "retry-user", ...FORM });
        authState = {
            ...authState,
            loading: false,
            user: { id: "retry-user", email: "retry@example.com" },
        };

        await renderCallback();

        expect(document.body.textContent).toContain("Email confirmed");
        expect(document.body.textContent).toContain("couldn't finish setting up your profile");
        expect(readPendingOnboarding()?.form).toEqual(FORM);
        expect(saveProfile).toHaveBeenCalledTimes(1);

        await click("email-callback-retry-profile");

        expect(getProfile).toHaveBeenCalledTimes(2);
        expect(saveProfile).toHaveBeenCalledTimes(2);
        expect(readPendingOnboarding()).toBeNull();
        expect(document.querySelector('[data-testid="email-callback-continue"]')).not.toBeNull();
    });

    test("invalid or expired callback shows a recoverable error without running profile setup", async () => {
        authState = {
            ...authState,
            loading: false,
            authError: "This sign-in link is invalid or has expired. Request a new link and try again.",
        };

        await renderCallback();

        expect(document.body.textContent).toContain("We couldn't confirm this link");
        expect(document.body.textContent).toContain("invalid or has expired");
        expect(getProfile).not.toHaveBeenCalled();
        expect(saveProfile).not.toHaveBeenCalled();

        await click("email-callback-return");
        expect(authState.clearAuthError).toHaveBeenCalledTimes(1);
        expect(callbacks.onReturnToSignIn).toHaveBeenCalledTimes(1);
    });

    test("session restore or network failure stays on the callback and can be retried", async () => {
        authState = {
            ...authState,
            loading: false,
            authError: "Authentication couldn't be restored. Please check your connection and try again.",
        };

        await renderCallback();

        expect(document.querySelector('[data-testid="email-callback-retry-auth"]')).not.toBeNull();
        expect(getProfile).not.toHaveBeenCalled();

        await click("email-callback-retry-auth");
        expect(authState.clearAuthError).toHaveBeenCalledTimes(1);
        expect(callbacks.onRetryAuth).toHaveBeenCalledTimes(1);
    });

    test("repeated auth renders share one in-flight profile completion", async () => {
        savePendingOnboarding(FORM, "email");
        let resolveExistingProfile;
        getProfile.mockReturnValue(new Promise((resolve) => {
            resolveExistingProfile = resolve;
        }));
        saveProfile.mockResolvedValue({ user_id: "duplicate-user", ...FORM });
        authState = {
            ...authState,
            loading: false,
            user: { id: "duplicate-user", email: "duplicate@example.com" },
        };

        await renderCallback();
        expect(getProfile).toHaveBeenCalledTimes(1);

        authState = {
            ...authState,
            user: { id: "duplicate-user", email: "duplicate@example.com" },
        };
        await renderCallback();
        expect(getProfile).toHaveBeenCalledTimes(1);

        await act(async () => {
            resolveExistingProfile(null);
        });

        expect(getProfile).toHaveBeenCalledTimes(1);
        expect(saveProfile).toHaveBeenCalledTimes(1);
        expect(readPendingOnboarding()).toBeNull();
        expect(document.querySelector('[data-testid="email-callback-continue"]')).not.toBeNull();
    });
});
