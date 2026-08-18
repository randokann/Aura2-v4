import {
    PENDING_ONBOARDING_KEY,
    PENDING_ONBOARDING_MAX_AGE_MS,
    clearPendingOnboarding,
    readPendingOnboarding,
    resolveAuthenticatedOnboarding,
    savePendingOnboarding,
} from "./pendingOnboarding";

const FORM = {
    name: "Aura User",
    age: 30,
    sex: "femmina",
    height_cm: 168,
    current_weight_kg: 65,
    target_weight_kg: 62,
    activity_level: "moderato",
    goal: "dimagrire",
};

function memoryStorage() {
    const values = new Map();
    return {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: (key) => values.delete(key),
    };
}

describe("pending onboarding", () => {
    test.each(["email", "google"])("persists a versioned %s onboarding record", (method) => {
        const storage = memoryStorage();
        const now = Date.UTC(2026, 7, 18, 10);

        const saved = savePendingOnboarding(
            { ...FORM, accountMethod: method, email: "not-persisted@example.com" },
            method,
            { storage, now },
        );

        expect(saved).toEqual({
            version: 1,
            created_at: new Date(now).toISOString(),
            auth_method: method,
            form: FORM,
        });
        expect(storage.getItem(PENDING_ONBOARDING_KEY)).not.toContain("not-persisted@example.com");
        expect(readPendingOnboarding({ storage, now })).toEqual(saved);
    });

    test("expires and clears stale onboarding after 24 hours", () => {
        const storage = memoryStorage();
        const created = Date.UTC(2026, 7, 18, 10);
        savePendingOnboarding(FORM, "email", { storage, now: created });

        expect(readPendingOnboarding({
            storage,
            now: created + PENDING_ONBOARDING_MAX_AGE_MS + 1,
        })).toBeNull();
        expect(storage.getItem(PENDING_ONBOARDING_KEY)).toBeNull();
    });

    test("creates a missing profile and clears pending data only after save", async () => {
        const events = [];
        const profile = { user_id: "user-1", ...FORM };

        const result = await resolveAuthenticatedOnboarding({
            pending: { form: FORM },
            loadExistingProfile: async () => null,
            saveNewProfile: async (form) => {
                events.push(["save", form]);
                return profile;
            },
            clearPending: () => events.push(["clear"]),
        });

        expect(result).toEqual({ status: "created", profile });
        expect(events).toEqual([["save", FORM], ["clear"]]);
    });

    test("keeps pending data when profile creation fails", async () => {
        const storage = memoryStorage();
        const pending = savePendingOnboarding(FORM, "email", { storage });

        await expect(resolveAuthenticatedOnboarding({
            pending,
            loadExistingProfile: async () => null,
            saveNewProfile: async () => {
                throw new Error("backend unavailable");
            },
            clearPending: () => clearPendingOnboarding(storage),
        })).rejects.toThrow("backend unavailable");

        expect(readPendingOnboarding({ storage })).toEqual(pending);
    });

    test("preserves an existing user profile and discards inapplicable pending data", async () => {
        const existing = { user_id: "existing-user", name: "Existing" };
        const saveNewProfile = jest.fn();
        const clearPending = jest.fn();

        const result = await resolveAuthenticatedOnboarding({
            pending: { form: FORM },
            loadExistingProfile: async () => existing,
            saveNewProfile,
            clearPending,
        });

        expect(result).toEqual({ status: "existing", profile: existing });
        expect(saveNewProfile).not.toHaveBeenCalled();
        expect(clearPending).toHaveBeenCalledTimes(1);
    });
});
