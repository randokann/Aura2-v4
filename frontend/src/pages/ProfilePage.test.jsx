import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { useAuth } from "../auth/AuthProvider";
import { useGuestMigration } from "../guestMigration/GuestMigrationProvider";
import { saveProfile } from "../lib/api";
import {
    getGuestProfile,
    isGuestMode,
    saveGuestProfile,
} from "../lib/guestStorage";
import { supabase } from "../lib/supabase";
import { ProfilePage } from "./ProfilePage";

jest.mock("../auth/AuthProvider", () => ({
    useAuth: jest.fn(),
}));

jest.mock("../guestMigration/GuestMigrationProvider", () => ({
    useGuestMigration: jest.fn(),
}));

jest.mock("../lib/api", () => ({
    getDeviceId: jest.fn(() => "guest-device-id"),
    saveProfile: jest.fn(),
}));

jest.mock("../lib/guestStorage", () => ({
    getGuestProfile: jest.fn(),
    isGuestMode: jest.fn(),
    saveGuestProfile: jest.fn(),
}));

jest.mock("../lib/supabase", () => ({
    supabase: {
        auth: {
            signInWithOAuth: jest.fn(),
        },
    },
}));

jest.mock("../i18n/LangContext", () => ({
    useLang: () => ({
        lang: "en",
        setLang: jest.fn(),
        t: (key) => key,
    }),
}));

jest.mock("../i18n/languages", () => ({
    LANGUAGES: [],
}));

jest.mock("../components/EmailAuthDialog", () => ({
    EmailAuthDialog: ({ open, title }) => (
        open ? <div data-testid="shared-email-auth-dialog">{title}</div> : null
    ),
}));

jest.mock("sonner", () => ({
    toast: {
        error: jest.fn(),
        success: jest.fn(),
    },
}));

const PROFILE = {
    name: "Guest User",
    age: 30,
    sex: "maschio",
    height_cm: 180,
    current_weight_kg: 80,
    target_weight_kg: 75,
    activity_level: "moderato",
    goal: "dimagrire",
    daily_calorie_goal: 2200,
    protein_goal: 144,
    carbs_goal: 250,
    fat_goal: 64,
    fiber_goal: 30,
    bmi: 24.7,
    bmi_category: "normal",
    device_id: "guest-device-id",
};

describe("ProfilePage Account & Sync section", () => {
    let container;
    let root;

    async function renderProfile(props = {}) {
        await act(async () => {
            root.render(<ProfilePage profile={PROFILE} {...props} />);
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
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
        localStorage.clear();

        useAuth.mockReturnValue({ user: null });
        useGuestMigration.mockReturnValue({
            status: "idle",
            hasImportableData: false,
            profileNeedsReconciliation: false,
            requestDeviceImport: jest.fn(),
        });
        isGuestMode.mockReturnValue(true);
        getGuestProfile.mockReturnValue(PROFILE);
        saveGuestProfile.mockReturnValue(true);
        supabase.auth.signInWithOAuth.mockResolvedValue({ error: null });
    });

    afterEach(() => {
        if (root) act(() => root.unmount());
        container.remove();
        localStorage.clear();
        jest.clearAllMocks();
    });

    test("shows the guest card after BMI and before personal profile fields", async () => {
        await renderProfile();

        const bmiCard = document.querySelector('[data-testid="bmi-card"]');
        const accountSection = document.querySelector('[data-testid="profile-account-section"]');
        const nameInput = document.querySelector('[data-testid="profile-name"]');

        expect(accountSection).not.toBeNull();
        expect(accountSection.textContent).toContain("Save & sync your progress");
        expect(accountSection.textContent).toContain("Flaro account");
        expect(bmiCard.compareDocumentPosition(accountSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(accountSection.compareDocumentPosition(nameInput) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    test("starts the existing Google OAuth flow without changing guest storage", async () => {
        const guestSnapshot = {
            aura2_guest_profile: JSON.stringify(PROFILE),
            aura2_guest_meals: JSON.stringify([{ id: "meal-1" }]),
            aura2_guest_workouts: JSON.stringify([{ id: "workout-1" }]),
            aura2_guest_meal_plans: JSON.stringify([{ id: "plan-1" }]),
            aura2_guest_mode: "true",
        };
        Object.entries(guestSnapshot).forEach(([key, value]) => localStorage.setItem(key, value));

        await renderProfile();
        await click("profile-account-google");

        expect(supabase.auth.signInWithOAuth).toHaveBeenCalledWith({ provider: "google" });
        expect(saveGuestProfile).not.toHaveBeenCalled();
        Object.entries(guestSnapshot).forEach(([key, value]) => {
            expect(localStorage.getItem(key)).toBe(value);
        });
    });

    test("opens the shared EmailAuthDialog without changing guest storage", async () => {
        localStorage.setItem("aura2_guest_profile", JSON.stringify(PROFILE));
        localStorage.setItem("aura2_guest_mode", "true");

        await renderProfile();
        await click("profile-account-email");

        expect(document.querySelector('[data-testid="shared-email-auth-dialog"]')).not.toBeNull();
        expect(document.body.textContent).toContain("Continue with Email");
        expect(localStorage.getItem("aura2_guest_profile")).toBe(JSON.stringify(PROFILE));
        expect(localStorage.getItem("aura2_guest_mode")).toBe("true");
        expect(saveGuestProfile).not.toHaveBeenCalled();
        expect(supabase.auth.signInWithOAuth).not.toHaveBeenCalled();
    });

    test("replaces guest CTAs with connected account information for authenticated users", async () => {
        useAuth.mockReturnValue({
            user: { id: "user-1", email: "person@example.com" },
        });

        await renderProfile();

        const accountSection = document.querySelector('[data-testid="profile-account-section"]');
        expect(accountSection.textContent).toContain("Account connected");
        expect(accountSection.textContent).toContain("person@example.com");
        expect(document.querySelector('[data-testid="profile-account-google"]')).toBeNull();
        expect(document.querySelector('[data-testid="profile-account-email"]')).toBeNull();
    });

    test("offers the shared recovery action when authenticated device data remains", async () => {
        const requestDeviceImport = jest.fn();
        useAuth.mockReturnValue({
            user: { id: "user-1", email: "person@example.com" },
        });
        useGuestMigration.mockReturnValue({
            status: "deferred",
            hasImportableData: true,
            profileNeedsReconciliation: false,
            requestDeviceImport,
        });

        await renderProfile();

        const accountSection = document.querySelector('[data-testid="profile-account-section"]');
        expect(accountSection.textContent).toContain("Data from this device is available to import");
        await click("profile-import-device-data");
        expect(requestDeviceImport).toHaveBeenCalledTimes(1);
        expect(document.querySelector('[data-testid="profile-account-google"]')).toBeNull();
        expect(document.querySelector('[data-testid="profile-account-email"]')).toBeNull();
    });

    test("keeps guest profile editing and saving behavior unchanged", async () => {
        const onUpdated = jest.fn();
        await renderProfile({ onUpdated });

        const nameInput = document.querySelector('[data-testid="profile-name"]');
        await act(async () => {
            const valueSetter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype,
                "value",
            ).set;
            valueSetter.call(nameInput, "Updated Guest");
            nameInput.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await click("btn-save-profile");

        expect(saveGuestProfile).toHaveBeenCalledWith(expect.objectContaining({
            name: "Updated Guest",
            device_id: "guest-device-id",
            bmi: expect.any(Number),
        }));
        expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({
            name: "Updated Guest",
        }));
        expect(saveProfile).not.toHaveBeenCalled();
    });
});
