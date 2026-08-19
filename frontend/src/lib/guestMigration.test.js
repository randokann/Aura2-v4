import {
    GUEST_MIGRATION_KEYS,
    GuestMigrationError,
    captureGuestMigrationSnapshot,
    migrateGuestData,
    resetGuestMigrationOperationsForTests,
} from "./guestMigration";

jest.mock("./api", () => ({ importGuestData: jest.fn() }));
jest.mock("./supabase", () => ({
    supabase: { auth: { getSession: jest.fn() } },
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE_ID = "22222222-2222-4222-8222-222222222222";
const TARGET_ID = "33333333-3333-4333-8333-333333333333";

const profile = {
    name: "Guest User",
    age: 31,
    sex: "femmina",
    height_cm: 168,
    current_weight_kg: 64,
    target_weight_kg: 60,
    activity_level: "moderato",
    goal: "dimagrire",
    daily_calorie_goal: 1800,
    protein_goal: 115,
    carbs_goal: 200,
    fat_goal: 51,
    fiber_goal: 25,
    bmi: 22.7,
    bmi_category: "normal",
    device_id: SOURCE_ID,
    user_id: "untrusted-user",
};

const meal = {
    id: "meal-1",
    device_id: SOURCE_ID,
    user_id: "untrusted-user",
    dish_name: "Pasta",
    foods: [{
        name: "Pasta",
        quantity: "100 g",
        calories: 350,
        protein: 12,
        carbs: 70,
        fat: 2,
        fiber: 4,
        ignored: "drop me",
    }],
    total_calories: 350,
    total_protein: 12,
    total_carbs: 70,
    total_fat: 2,
    total_fiber: 4,
    image_base64: "secret-image",
    meal_date: "2026-08-19",
    meal_type: "pranzo",
    notes: "",
    created_at: "2026-08-19T10:00:00Z",
};

const workout = {
    id: "workout-1",
    exercise: "Squat",
    sets: 3,
    reps: 8,
    weight_kg: 60,
    duration_min: 0,
    notes: "",
    log_date: "2026-08-18",
    device_id: SOURCE_ID,
};

const plan = {
    id: "plan-1",
    title: "Balanced week",
    summary: "Simple plan",
    preset: "bilanciato",
    days: [{
        day: 1,
        label: "Monday",
        meals: [{
            meal_type: "colazione",
            name: "Oats",
            description: "Oats and fruit",
            calories: 400,
            protein: 20,
            carbs: 60,
            fat: 10,
            ingredients: ["oats", "fruit"],
        }],
        total_calories: 400,
        total_protein: 20,
        total_carbs: 60,
        total_fat: 10,
    }],
    device_id: SOURCE_ID,
};

function seedGuestData(overrides = {}) {
    const values = {
        [GUEST_MIGRATION_KEYS.profile]: JSON.stringify(profile),
        [GUEST_MIGRATION_KEYS.meals]: JSON.stringify([meal]),
        [GUEST_MIGRATION_KEYS.workouts]: JSON.stringify([workout]),
        [GUEST_MIGRATION_KEYS.mealPlans]: JSON.stringify([plan]),
        [GUEST_MIGRATION_KEYS.guestMode]: "true",
        [GUEST_MIGRATION_KEYS.deviceId]: SOURCE_ID,
        nutrisnap_lang: "en",
        aura2_guest_meal_plan_generation_count: "3",
        [GUEST_MIGRATION_KEYS.lastSummary]: "cached",
        [GUEST_MIGRATION_KEYS.lastAddedMeal]: "cached",
        ...overrides,
    };
    Object.entries(values).forEach(([key, value]) => {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
    });
}

function importedResponse(overrides = {}) {
    return {
        status: "imported",
        profile: { outcome: "imported" },
        meals: [{ client_import_id: "meal-1", outcome: "imported", target_id: TARGET_ID }],
        workouts: [{ client_import_id: "workout-1", outcome: "imported", target_id: TARGET_ID }],
        meal_plans: [{ client_import_id: "plan-1", outcome: "imported", target_id: TARGET_ID }],
        ...overrides,
    };
}

function run(importer, options = {}) {
    return migrateGuestData({
        userId: USER_ID,
        importer,
        getAuthenticatedUserId: options.getAuthenticatedUserId || (() => Promise.resolve(USER_ID)),
        lockManager: null,
        ...options,
    });
}

describe("guest migration orchestration", () => {
    beforeEach(() => {
        localStorage.clear();
        resetGuestMigrationOperationsForTests();
    });

    afterEach(() => {
        localStorage.clear();
        resetGuestMigrationOperationsForTests();
        jest.clearAllMocks();
    });

    test("captures an immutable exact-contract snapshot and drops derived and ownership fields", () => {
        seedGuestData();

        const snapshot = captureGuestMigrationSnapshot();

        expect(snapshot.hasData).toBe(true);
        expect(snapshot.sourceGuestId).toBe(SOURCE_ID);
        expect(snapshot.transformed.profile).toEqual({
            name: "Guest User",
            age: 31,
            sex: "femmina",
            height_cm: 168,
            current_weight_kg: 64,
            target_weight_kg: 60,
            activity_level: "moderato",
            goal: "dimagrire",
        });
        expect(snapshot.transformed.meals[0]).toEqual(expect.objectContaining({
            client_import_id: "meal-1",
            dish_name: "Pasta",
        }));
        expect(snapshot.transformed.meals[0]).not.toEqual(expect.objectContaining({
            device_id: expect.anything(),
            image_base64: expect.anything(),
            user_id: expect.anything(),
        }));
        expect(snapshot.transformed.meals[0].foods[0]).not.toHaveProperty("ignored");
        expect(snapshot.transformed.workouts[0].client_import_id).toBe("workout-1");
        expect(snapshot.transformed.mealPlans[0].client_import_id).toBe("plan-1");
        expect(Object.isFrozen(snapshot)).toBe(true);
        expect(Object.isFrozen(snapshot.raw.meals)).toBe(true);
    });

    test("malformed authoritative JSON blocks the request and preserves every key", async () => {
        seedGuestData({ [GUEST_MIGRATION_KEYS.meals]: "{broken" });
        const before = { ...localStorage };
        const importer = jest.fn();

        await expect(run(importer)).rejects.toMatchObject({
            code: "MALFORMED_GUEST_STORAGE",
            recoverable: true,
        });

        expect(importer).not.toHaveBeenCalled();
        Object.entries(before).forEach(([key, value]) => {
            expect(localStorage.getItem(key)).toBe(value);
        });
    });

    test.each([null, "not-a-uuid"])(
        "missing or invalid source guest ID %p blocks import without cleanup",
        async (sourceId) => {
            seedGuestData({ [GUEST_MIGRATION_KEYS.deviceId]: sourceId });
            const importer = jest.fn();

            await expect(run(importer)).rejects.toMatchObject({ code: "INVALID_SOURCE_GUEST_ID" });

            expect(importer).not.toHaveBeenCalled();
            expect(localStorage.getItem(GUEST_MIGRATION_KEYS.profile)).not.toBeNull();
            expect(localStorage.getItem(GUEST_MIGRATION_KEYS.meals)).not.toBeNull();
        },
    );

    test("no authoritative guest data is a no-op and never generates a device ID", async () => {
        const importer = jest.fn();

        await expect(run(importer)).resolves.toMatchObject({ status: "no_data" });

        expect(importer).not.toHaveBeenCalled();
        expect(localStorage.getItem(GUEST_MIGRATION_KEYS.deviceId)).toBeNull();
    });

    test("new-account success cleans only confirmed data and keeps identity, language, and quotas", async () => {
        seedGuestData();
        const importer = jest.fn().mockResolvedValue(importedResponse());

        const result = await run(importer);

        expect(result.status).toBe("imported");
        expect(importer).toHaveBeenCalledWith(expect.objectContaining({
            version: 1,
            source_guest_id: SOURCE_ID,
            confirm_existing_account: false,
            profile: expect.not.objectContaining({ daily_calorie_goal: expect.anything() }),
        }), { expectedUserId: USER_ID });
        expect(localStorage.getItem(GUEST_MIGRATION_KEYS.profile)).toBeNull();
        expect(localStorage.getItem(GUEST_MIGRATION_KEYS.meals)).toBeNull();
        expect(localStorage.getItem(GUEST_MIGRATION_KEYS.workouts)).toBeNull();
        expect(localStorage.getItem(GUEST_MIGRATION_KEYS.mealPlans)).toBeNull();
        expect(localStorage.getItem(GUEST_MIGRATION_KEYS.guestMode)).toBeNull();
        expect(localStorage.getItem(GUEST_MIGRATION_KEYS.lastSummary)).toBeNull();
        expect(localStorage.getItem(GUEST_MIGRATION_KEYS.lastAddedMeal)).toBeNull();
        expect(localStorage.getItem(GUEST_MIGRATION_KEYS.deviceId)).toBe(SOURCE_ID);
        expect(localStorage.getItem("nutrisnap_lang")).toBe("en");
        expect(localStorage.getItem("aura2_guest_meal_plan_generation_count")).toBe("3");
    });

    test("records added or changed while the request is in flight survive selective cleanup", async () => {
        seedGuestData();
        const newMeal = { ...meal, id: "meal-2", dish_name: "New meal" };
        const changedOriginal = { ...meal, notes: "edited while syncing" };
        const importer = jest.fn().mockImplementation(async () => {
            localStorage.setItem(
                GUEST_MIGRATION_KEYS.meals,
                JSON.stringify([changedOriginal, newMeal]),
            );
            return importedResponse({
                profile: { outcome: "skipped_existing" },
                workouts: [],
                meal_plans: [],
            });
        });

        await run(importer);

        expect(JSON.parse(localStorage.getItem(GUEST_MIGRATION_KEYS.meals))).toEqual([
            changedOriginal,
            newMeal,
        ]);
        expect(localStorage.getItem(GUEST_MIGRATION_KEYS.profile)).toBe(JSON.stringify(profile));
        expect(localStorage.getItem(GUEST_MIGRATION_KEYS.guestMode)).toBe("true");
    });

    test("already_imported results perform lost-response cleanup without duplicates", async () => {
        seedGuestData();
        const importer = jest.fn().mockResolvedValue(importedResponse({
            profile: { outcome: "already_imported" },
            meals: [{ client_import_id: "meal-1", outcome: "already_imported", target_id: TARGET_ID }],
            workouts: [{ client_import_id: "workout-1", outcome: "already_imported", target_id: TARGET_ID }],
            meal_plans: [{ client_import_id: "plan-1", outcome: "already_imported", target_id: TARGET_ID }],
        }));

        await run(importer);

        expect(importer).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem(GUEST_MIGRATION_KEYS.meals)).toBeNull();
        expect(localStorage.getItem(GUEST_MIGRATION_KEYS.workouts)).toBeNull();
        expect(localStorage.getItem(GUEST_MIGRATION_KEYS.mealPlans)).toBeNull();
    });

    test("confirmation resubmits the same immutable snapshot only after explicit approval", async () => {
        seedGuestData();
        const importer = jest.fn()
            .mockResolvedValueOnce({
                status: "confirmation_required",
                existing_profile: true,
                guest_meals: 1,
                guest_workouts: 1,
                guest_meal_plans: 1,
            })
            .mockResolvedValueOnce(importedResponse({ profile: { outcome: "skipped_existing" } }));

        const first = await run(importer);
        expect(first.status).toBe("confirmation_required");
        expect(localStorage.getItem(GUEST_MIGRATION_KEYS.meals)).not.toBeNull();

        await run(importer, { snapshot: first.snapshot, confirmExistingAccount: true });

        expect(importer.mock.calls[1][0]).toEqual({
            ...importer.mock.calls[0][0],
            confirm_existing_account: true,
        });
        expect(localStorage.getItem(GUEST_MIGRATION_KEYS.profile)).toBe(JSON.stringify(profile));
        expect(localStorage.getItem(GUEST_MIGRATION_KEYS.meals)).toBeNull();
    });

    test("network, malformed response, and authenticated-user changes never clean local data", async () => {
        seedGuestData();
        const networkImporter = jest.fn().mockRejectedValue(new Error("offline"));
        await expect(run(networkImporter)).rejects.toBeInstanceOf(GuestMigrationError);
        expect(localStorage.getItem(GUEST_MIGRATION_KEYS.meals)).not.toBeNull();

        resetGuestMigrationOperationsForTests();
        const malformedImporter = jest.fn().mockResolvedValue({ status: "surprise" });
        await expect(run(malformedImporter)).rejects.toMatchObject({ code: "INVALID_IMPORT_RESPONSE" });
        expect(localStorage.getItem(GUEST_MIGRATION_KEYS.meals)).not.toBeNull();

        resetGuestMigrationOperationsForTests();
        const getAuthenticatedUserId = jest.fn()
            .mockResolvedValueOnce(USER_ID)
            .mockResolvedValueOnce("44444444-4444-4444-8444-444444444444");
        await expect(run(
            jest.fn().mockResolvedValue(importedResponse()),
            { getAuthenticatedUserId },
        )).rejects.toMatchObject({ code: "AUTH_USER_CHANGED" });
        expect(localStorage.getItem(GUEST_MIGRATION_KEYS.meals)).not.toBeNull();
        expect(localStorage.getItem(GUEST_MIGRATION_KEYS.profile)).not.toBeNull();
    });

    test("concurrent migration calls coalesce while backend idempotency remains authoritative", async () => {
        seedGuestData();
        let resolveImport;
        const importer = jest.fn().mockReturnValue(new Promise((resolve) => {
            resolveImport = resolve;
        }));

        const first = run(importer);
        const second = run(importer);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(importer).toHaveBeenCalledTimes(1);

        resolveImport(importedResponse());
        const [firstResult, secondResult] = await Promise.all([first, second]);

        expect(firstResult).toBe(secondResult);
        expect(importer).toHaveBeenCalledTimes(1);
    });

    test("an account switch cannot start a second overlapping import or clean device data", async () => {
        seedGuestData();
        let currentUserId = USER_ID;
        let resolveImport;
        const importer = jest.fn().mockReturnValue(new Promise((resolve) => {
            resolveImport = resolve;
        }));
        const getAuthenticatedUserId = jest.fn(() => Promise.resolve(currentUserId));

        const first = run(importer, { getAuthenticatedUserId });
        await new Promise((resolve) => setTimeout(resolve, 0));
        currentUserId = "44444444-4444-4444-8444-444444444444";
        const second = run(importer, {
            userId: currentUserId,
            getAuthenticatedUserId,
        });
        resolveImport(importedResponse());

        await Promise.all([
            expect(first).rejects.toMatchObject({ code: "AUTH_USER_CHANGED" }),
            expect(second).rejects.toMatchObject({ code: "AUTH_USER_CHANGED" }),
        ]);
        expect(importer).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem(GUEST_MIGRATION_KEYS.profile)).not.toBeNull();
        expect(localStorage.getItem(GUEST_MIGRATION_KEYS.meals)).not.toBeNull();
    });
});
