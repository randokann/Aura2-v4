import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { useAuth } from "./auth/AuthProvider";
import { useGuestMigration } from "./guestMigration/GuestMigrationProvider";
import { saveProfile } from "./lib/api";
import { supabase } from "./lib/supabase";
import {
    savePendingOnboarding,
    synchronizeAuthenticatedOnboarding,
} from "./lib/pendingOnboarding";

jest.mock("./auth/AuthProvider", () => ({
    useAuth: jest.fn(),
}));

jest.mock("./guestMigration/GuestMigrationProvider", () => ({
    useGuestMigration: jest.fn(),
}));

jest.mock("./lib/supabase", () => ({
    supabase: {
        auth: {
            signInWithOAuth: jest.fn(),
        },
    },
}));

jest.mock("./lib/api", () => ({
    associateDevice: jest.fn(),
    getDeviceId: jest.fn(() => "device-id"),
    getProfile: jest.fn(),
    saveProfile: jest.fn(),
}));

jest.mock("./lib/guestStorage", () => ({
    getGuestProfile: jest.fn(() => null),
    saveGuestProfile: jest.fn(),
}));

jest.mock("./lib/pendingOnboarding", () => ({
    clearPendingOnboarding: jest.fn(),
    readPendingOnboarding: jest.fn(() => null),
    savePendingOnboarding: jest.fn(),
    synchronizeAuthenticatedOnboarding: jest.fn(),
}));

jest.mock("@/App.css", () => ({}), { virtual: true });

jest.mock("@/lib/api", () => jest.requireMock("./lib/api"), { virtual: true });
jest.mock("@/lib/guestStorage", () => jest.requireMock("./lib/guestStorage"), { virtual: true });
jest.mock("@/lib/pendingOnboarding", () => jest.requireMock("./lib/pendingOnboarding"), { virtual: true });
jest.mock("@/guestMigration/GuestMigrationProvider", () => (
    jest.requireMock("./guestMigration/GuestMigrationProvider")
), { virtual: true });

jest.mock("@/i18n/LangContext", () => ({
    LangProvider: ({ children }) => children,
    useLang: () => ({ t: (key) => key }),
}), { virtual: true });

jest.mock("@/components/OnboardingDialog", () => ({
    OnboardingDialog: ({ authenticated, onSubmit }) => (
        <button
            type="button"
            data-testid="mock-onboarding"
            data-authenticated={String(authenticated)}
            onClick={() => onSubmit({
                name: "Google User",
                age: 30,
                sex: "femmina",
                height_cm: 168,
                current_weight_kg: 65,
                target_weight_kg: 62,
                activity_level: "moderato",
                goal: "dimagrire",
                accountMethod: "google",
            })}
        >
            Onboarding
        </button>
    ),
}), { virtual: true });

jest.mock("@/pages/EmailAuthCallback", () => ({
    EmailAuthCallback: () => <div data-testid="mock-email-callback">Callback only</div>,
}), { virtual: true });

jest.mock("@/components/BottomNav", () => ({ BottomNav: () => null }), { virtual: true });
jest.mock("@/pages/CameraPage", () => ({ CameraPage: () => null }), { virtual: true });
jest.mock("@/pages/DiaryPage", () => ({ DiaryPage: () => null }), { virtual: true });
jest.mock("@/pages/ProfilePage", () => ({ ProfilePage: () => null }), { virtual: true });
jest.mock("@/pages/MealPlanPage", () => ({ MealPlanPage: () => null }), { virtual: true });
jest.mock("@/pages/CoachPage", () => ({ CoachPage: () => null }), { virtual: true });
jest.mock("@/lib/sectionColors", () => ({ sectionStyle: () => ({}) }), { virtual: true });
jest.mock("sonner", () => ({ Toaster: () => null, toast: { error: jest.fn() } }));

describe("App authentication routing", () => {
    let container;
    let root;

    beforeEach(() => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
        localStorage.clear();
        window.history.replaceState({}, "", "/");
        useAuth.mockReturnValue({
            user: null,
            loading: false,
            authError: null,
            clearAuthError: jest.fn(),
        });
        useGuestMigration.mockReturnValue({
            settled: true,
            revision: 0,
            requiresDecision: false,
        });
        supabase.auth.signInWithOAuth.mockResolvedValue({ error: null });
    });

    afterEach(() => {
        if (root) act(() => root.unmount());
        container.remove();
        window.history.replaceState({}, "", "/");
        jest.clearAllMocks();
    });

    test("renders only the dedicated callback screen at /auth/callback", async () => {
        window.history.replaceState({}, "", "/auth/callback?code=example");

        await act(async () => {
            root.render(<App />);
        });

        expect(document.querySelector('[data-testid="mock-email-callback"]')).not.toBeNull();
        expect(document.querySelector('[data-testid="mock-onboarding"]')).toBeNull();
    });

    test("preserves the existing Google onboarding path on the app root", async () => {
        await act(async () => {
            root.render(<App />);
        });

        const onboarding = document.querySelector('[data-testid="mock-onboarding"]');
        expect(onboarding).not.toBeNull();
        expect(onboarding.dataset.authenticated).toBe("false");

        await act(async () => {
            onboarding.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });

        expect(savePendingOnboarding).toHaveBeenCalledWith(
            expect.objectContaining({ accountMethod: "google", name: "Google User" }),
            "google",
        );
        expect(supabase.auth.signInWithOAuth).toHaveBeenCalledWith({ provider: "google" });
    });

    test("lets an authenticated cross-device user finish a missing profile without re-authenticating", async () => {
        useAuth.mockReturnValue({
            user: { id: "email-user", email: "email@example.com" },
            loading: false,
            authError: null,
            clearAuthError: jest.fn(),
        });
        synchronizeAuthenticatedOnboarding.mockResolvedValue({
            status: "missing",
            profile: null,
        });
        saveProfile.mockResolvedValue({ user_id: "email-user", name: "Google User" });

        await act(async () => {
            root.render(<App />);
        });

        const onboarding = document.querySelector('[data-testid="mock-onboarding"]');
        expect(onboarding).not.toBeNull();
        expect(onboarding.dataset.authenticated).toBe("true");

        await act(async () => {
            onboarding.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });

        expect(saveProfile).toHaveBeenCalledWith(expect.not.objectContaining({
            accountMethod: expect.anything(),
        }));
        expect(savePendingOnboarding).not.toHaveBeenCalled();
        expect(supabase.auth.signInWithOAuth).not.toHaveBeenCalled();
    });

    test("waits for automatic guest import before authenticated profile resolution", async () => {
        useAuth.mockReturnValue({
            user: { id: "guest-upgrade", email: "guest@example.com" },
            loading: false,
            authError: null,
            clearAuthError: jest.fn(),
        });
        useGuestMigration.mockReturnValue({
            settled: false,
            revision: 0,
            requiresDecision: false,
        });
        synchronizeAuthenticatedOnboarding.mockResolvedValue({
            status: "existing",
            profile: { user_id: "guest-upgrade", name: "Imported Guest" },
        });

        await act(async () => {
            root.render(<App />);
        });
        expect(synchronizeAuthenticatedOnboarding).not.toHaveBeenCalled();
        expect(document.querySelector('[data-testid="mock-onboarding"]')).toBeNull();

        useGuestMigration.mockReturnValue({
            settled: true,
            revision: 1,
            requiresDecision: false,
        });
        await act(async () => {
            root.render(<App />);
        });

        expect(synchronizeAuthenticatedOnboarding).toHaveBeenCalledTimes(1);
        expect(document.querySelector('[data-testid="mock-onboarding"]')).toBeNull();
    });
});
