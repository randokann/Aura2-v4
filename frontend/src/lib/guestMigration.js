import { importGuestData } from "./api";
import { supabase } from "./supabase";

export const GUEST_MIGRATION_KEYS = Object.freeze({
    profile: "aura2_guest_profile",
    meals: "aura2_guest_meals",
    workouts: "aura2_guest_workouts",
    mealPlans: "aura2_guest_meal_plans",
    guestMode: "aura2_guest_mode",
    deviceId: "nutrisnap_device_id",
    lastSummary: "aura2_last_summary",
    lastAddedMeal: "aura2_last_added_meal",
});

const CLIENT_IMPORT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MEAL_TYPES = new Set(["colazione", "pranzo", "cena", "spuntino"]);
const SEX_VALUES = new Set(["maschio", "femmina"]);
const ACTIVITY_VALUES = new Set([
    "sedentario",
    "leggero",
    "moderato",
    "intenso",
    "molto_intenso",
]);
const GOAL_VALUES = new Set(["dimagrire", "mantenere", "aumentare"]);
const PRESET_VALUES = new Set([
    "ipercalorico",
    "iperproteico",
    "ipocalorico",
    "bilanciato",
    "keto",
    "vegetariano",
    "vegano",
    "mediterraneo",
    "custom",
    "ingredients",
]);
const SUCCESS_OUTCOMES = new Set(["imported", "already_imported"]);
let migrationOperation = null;

export class GuestMigrationError extends Error {
    constructor(code, message, options = {}) {
        super(message);
        this.name = "GuestMigrationError";
        this.code = code;
        this.recoverable = true;
        this.snapshot = options.snapshot || null;
        this.hasGuestData = options.hasGuestData ?? Boolean(options.snapshot?.hasData);
        if (options.cause) this.cause = options.cause;
    }
}

function availableStorage(storage) {
    if (storage) return storage;
    return typeof localStorage === "undefined" ? null : localStorage;
}

function readStorageValue(storage, key) {
    try {
        return storage.getItem(key);
    } catch (cause) {
        throw new GuestMigrationError(
            "STORAGE_UNAVAILABLE",
            "Guest data storage is unavailable.",
            { cause, hasGuestData: true },
        );
    }
}

function parseAuthoritativeValue(raw, key) {
    if (raw === null) return { state: "absent", value: null };
    try {
        const value = JSON.parse(raw);
        return { state: value === null ? "empty" : "present", value };
    } catch (cause) {
        throw new GuestMigrationError(
            "MALFORMED_GUEST_STORAGE",
            `Guest storage key ${key} contains malformed JSON.`,
            { cause, hasGuestData: true },
        );
    }
}

function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
}

function requireObject(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new GuestMigrationError(
            "INVALID_GUEST_DATA",
            `${label} must be an object.`,
            { hasGuestData: true },
        );
    }
    return value;
}

function requireArray(value, label, { min = 0, max } = {}) {
    if (!Array.isArray(value) || value.length < min || (max != null && value.length > max)) {
        throw new GuestMigrationError(
            "INVALID_GUEST_DATA",
            `${label} must contain between ${min} and ${max ?? "any number of"} items.`,
            { hasGuestData: true },
        );
    }
    return value;
}

function requireString(value, label, { min = 0, max } = {}) {
    if (typeof value !== "string") {
        throw new GuestMigrationError("INVALID_GUEST_DATA", `${label} must be text.`, {
            hasGuestData: true,
        });
    }
    const normalized = value.trim();
    if (normalized.length < min || (max != null && normalized.length > max)) {
        throw new GuestMigrationError("INVALID_GUEST_DATA", `${label} has an invalid length.`, {
            hasGuestData: true,
        });
    }
    return normalized;
}

function requireNumber(value, label, { min, max, integer = false } = {}) {
    const valid = typeof value === "number"
        && Number.isFinite(value)
        && (!integer || Number.isInteger(value))
        && (min == null || value >= min)
        && (max == null || value <= max);
    if (!valid) {
        throw new GuestMigrationError("INVALID_GUEST_DATA", `${label} is invalid.`, {
            hasGuestData: true,
        });
    }
    return value;
}

function requireEnum(value, allowed, label) {
    if (!allowed.has(value)) {
        throw new GuestMigrationError("INVALID_GUEST_DATA", `${label} is invalid.`, {
            hasGuestData: true,
        });
    }
    return value;
}

function requireClientImportId(value, label) {
    if (typeof value !== "string" || !CLIENT_IMPORT_ID_PATTERN.test(value)) {
        throw new GuestMigrationError("INVALID_GUEST_DATA", `${label} has an invalid local ID.`, {
            hasGuestData: true,
        });
    }
    return value;
}

function requireDate(value, label) {
    if (typeof value !== "string") {
        throw new GuestMigrationError("INVALID_GUEST_DATA", `${label} is invalid.`, {
            hasGuestData: true,
        });
    }
    const match = DATE_PATTERN.exec(value);
    if (!match) {
        throw new GuestMigrationError("INVALID_GUEST_DATA", `${label} is invalid.`, {
            hasGuestData: true,
        });
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
        parsed.getUTCFullYear() !== year
        || parsed.getUTCMonth() !== month - 1
        || parsed.getUTCDate() !== day
    ) {
        throw new GuestMigrationError("INVALID_GUEST_DATA", `${label} is invalid.`, {
            hasGuestData: true,
        });
    }
    return value;
}

function transformProfile(rawProfile) {
    const profile = requireObject(rawProfile, "Guest profile");
    return {
        name: requireString(profile.name, "Profile name", { max: 120 }),
        age: requireNumber(profile.age, "Profile age", { min: 12, max: 110, integer: true }),
        sex: requireEnum(profile.sex, SEX_VALUES, "Profile sex"),
        height_cm: requireNumber(profile.height_cm, "Profile height", { min: 100, max: 250 }),
        current_weight_kg: requireNumber(profile.current_weight_kg, "Current weight", { min: 20, max: 500 }),
        target_weight_kg: requireNumber(profile.target_weight_kg, "Target weight", { min: 20, max: 500 }),
        activity_level: requireEnum(profile.activity_level, ACTIVITY_VALUES, "Activity level"),
        goal: requireEnum(profile.goal, GOAL_VALUES, "Profile goal"),
    };
}

function transformFood(rawFood, mealIndex, foodIndex) {
    const food = requireObject(rawFood, `Meal ${mealIndex + 1} food ${foodIndex + 1}`);
    return {
        name: requireString(food.name, "Food name", { min: 1, max: 160 }),
        quantity: requireString(food.quantity, "Food quantity", { min: 1, max: 80 }),
        calories: requireNumber(food.calories, "Food calories", { min: 0, max: 20_000 }),
        protein: requireNumber(food.protein ?? 0, "Food protein", { min: 0, max: 5_000 }),
        carbs: requireNumber(food.carbs ?? 0, "Food carbs", { min: 0, max: 5_000 }),
        fat: requireNumber(food.fat ?? 0, "Food fat", { min: 0, max: 5_000 }),
        fiber: requireNumber(food.fiber ?? 0, "Food fiber", { min: 0, max: 1_000 }),
    };
}

function transformMeal(rawMeal, index) {
    const meal = requireObject(rawMeal, `Guest meal ${index + 1}`);
    return {
        client_import_id: requireClientImportId(meal.id, `Guest meal ${index + 1}`),
        dish_name: requireString(meal.dish_name, "Meal name", { min: 1, max: 200 }),
        foods: requireArray(meal.foods, "Meal foods", { min: 1, max: 50 })
            .map((food, foodIndex) => transformFood(food, index, foodIndex)),
        total_calories: requireNumber(meal.total_calories, "Meal calories", { min: 0, max: 20_000 }),
        total_protein: requireNumber(meal.total_protein, "Meal protein", { min: 0, max: 5_000 }),
        total_carbs: requireNumber(meal.total_carbs, "Meal carbs", { min: 0, max: 5_000 }),
        total_fat: requireNumber(meal.total_fat, "Meal fat", { min: 0, max: 5_000 }),
        total_fiber: requireNumber(meal.total_fiber, "Meal fiber", { min: 0, max: 1_000 }),
        meal_date: requireDate(meal.meal_date, "Meal date"),
        meal_type: requireEnum(meal.meal_type, MEAL_TYPES, "Meal type"),
        notes: requireString(meal.notes ?? "", "Meal notes", { max: 2_000 }),
    };
}

function transformWorkout(rawWorkout, index) {
    const workout = requireObject(rawWorkout, `Guest workout ${index + 1}`);
    const transformed = {
        client_import_id: requireClientImportId(workout.id, `Guest workout ${index + 1}`),
        exercise: requireString(workout.exercise, "Workout exercise", { min: 1, max: 200 }),
        sets: requireNumber(workout.sets, "Workout sets", { min: 0, max: 100, integer: true }),
        reps: requireNumber(workout.reps, "Workout repetitions", { min: 0, max: 10_000, integer: true }),
        weight_kg: requireNumber(workout.weight_kg ?? 0, "Workout weight", { min: 0, max: 2_000 }),
        duration_min: requireNumber(workout.duration_min ?? 0, "Workout duration", { min: 0, max: 1_440, integer: true }),
        notes: requireString(workout.notes ?? "", "Workout notes", { max: 2_000 }),
        log_date: requireDate(workout.log_date, "Workout date"),
    };
    if (transformed.duration_min === 0 && (transformed.sets === 0 || transformed.reps === 0)) {
        throw new GuestMigrationError(
            "INVALID_GUEST_DATA",
            "Workout must include repetitions or a positive duration.",
            { hasGuestData: true },
        );
    }
    return transformed;
}

function transformPlannedMeal(rawMeal, planIndex, dayIndex, mealIndex) {
    const meal = requireObject(
        rawMeal,
        `Plan ${planIndex + 1} day ${dayIndex + 1} meal ${mealIndex + 1}`,
    );
    return {
        meal_type: requireEnum(meal.meal_type, MEAL_TYPES, "Planned meal type"),
        name: requireString(meal.name, "Planned meal name", { min: 1, max: 200 }),
        description: requireString(meal.description ?? "", "Planned meal description", { max: 1_000 }),
        calories: requireNumber(meal.calories, "Planned meal calories", { min: 0, max: 20_000 }),
        protein: requireNumber(meal.protein, "Planned meal protein", { min: 0, max: 5_000 }),
        carbs: requireNumber(meal.carbs, "Planned meal carbs", { min: 0, max: 5_000 }),
        fat: requireNumber(meal.fat, "Planned meal fat", { min: 0, max: 5_000 }),
        ingredients: requireArray(meal.ingredients ?? [], "Planned meal ingredients", { max: 50 })
            .map((ingredient) => requireString(ingredient, "Plan ingredient", { min: 1, max: 120 })),
    };
}

function transformPlannedDay(rawDay, planIndex, dayIndex) {
    const day = requireObject(rawDay, `Plan ${planIndex + 1} day ${dayIndex + 1}`);
    return {
        day: requireNumber(day.day, "Plan day number", { min: 1, max: 7, integer: true }),
        label: requireString(day.label, "Plan day label", { min: 1, max: 120 }),
        meals: requireArray(day.meals, "Planned meals", { min: 1, max: 6 })
            .map((meal, mealIndex) => transformPlannedMeal(meal, planIndex, dayIndex, mealIndex)),
        total_calories: requireNumber(day.total_calories, "Plan calories", { min: 0, max: 50_000 }),
        total_protein: requireNumber(day.total_protein, "Plan protein", { min: 0, max: 10_000 }),
        total_carbs: requireNumber(day.total_carbs, "Plan carbs", { min: 0, max: 10_000 }),
        total_fat: requireNumber(day.total_fat, "Plan fat", { min: 0, max: 10_000 }),
    };
}

function transformMealPlan(rawPlan, index) {
    const plan = requireObject(rawPlan, `Guest meal plan ${index + 1}`);
    const days = requireArray(plan.days, "Meal-plan days", { min: 1, max: 7 })
        .map((day, dayIndex) => transformPlannedDay(day, index, dayIndex));
    if (new Set(days.map((day) => day.day)).size !== days.length) {
        throw new GuestMigrationError("INVALID_GUEST_DATA", "Meal-plan days must be unique.", {
            hasGuestData: true,
        });
    }
    return {
        client_import_id: requireClientImportId(plan.id, `Guest meal plan ${index + 1}`),
        title: requireString(plan.title, "Meal-plan title", { min: 1, max: 200 }),
        summary: requireString(plan.summary ?? "", "Meal-plan summary", { max: 4_000 }),
        preset: requireEnum(plan.preset, PRESET_VALUES, "Meal-plan preset"),
        days,
    };
}

function ensureUniqueIds(items, label) {
    const ids = items.map((item) => item.client_import_id);
    if (new Set(ids).size !== ids.length) {
        throw new GuestMigrationError("INVALID_GUEST_DATA", `Duplicate ${label} local IDs.`, {
            hasGuestData: true,
        });
    }
}

function transformSnapshot(raw) {
    const profile = raw.profile == null ? null : transformProfile(raw.profile);
    const meals = raw.meals.map(transformMeal);
    const workouts = raw.workouts.map(transformWorkout);
    const mealPlans = raw.mealPlans.map(transformMealPlan);
    ensureUniqueIds(meals, "meal");
    ensureUniqueIds(workouts, "workout");
    ensureUniqueIds(mealPlans, "meal-plan");
    return { profile, meals, workouts, mealPlans };
}

function snapshotCounts(raw) {
    return {
        meals: raw.meals.length,
        workouts: raw.workouts.length,
        mealPlans: raw.mealPlans.length,
    };
}

export function captureGuestMigrationSnapshot(options = {}) {
    const storage = availableStorage(options.storage);
    if (!storage) {
        throw new GuestMigrationError("STORAGE_UNAVAILABLE", "Guest data storage is unavailable.");
    }

    const profileEntry = parseAuthoritativeValue(
        readStorageValue(storage, GUEST_MIGRATION_KEYS.profile),
        GUEST_MIGRATION_KEYS.profile,
    );
    const mealsEntry = parseAuthoritativeValue(
        readStorageValue(storage, GUEST_MIGRATION_KEYS.meals),
        GUEST_MIGRATION_KEYS.meals,
    );
    const workoutsEntry = parseAuthoritativeValue(
        readStorageValue(storage, GUEST_MIGRATION_KEYS.workouts),
        GUEST_MIGRATION_KEYS.workouts,
    );
    const plansEntry = parseAuthoritativeValue(
        readStorageValue(storage, GUEST_MIGRATION_KEYS.mealPlans),
        GUEST_MIGRATION_KEYS.mealPlans,
    );

    if (profileEntry.value !== null) requireObject(profileEntry.value, "Guest profile");
    const raw = {
        profile: profileEntry.value,
        meals: mealsEntry.value === null ? [] : requireArray(mealsEntry.value, "Guest meals", { max: 500 }),
        workouts: workoutsEntry.value === null ? [] : requireArray(workoutsEntry.value, "Guest workouts", { max: 500 }),
        mealPlans: plansEntry.value === null ? [] : requireArray(plansEntry.value, "Guest meal plans", { max: 50 }),
    };
    const hasData = raw.profile !== null
        || raw.meals.length > 0
        || raw.workouts.length > 0
        || raw.mealPlans.length > 0;
    const baseSnapshot = {
        hasData,
        raw,
        presence: {
            profile: profileEntry.state,
            meals: mealsEntry.state,
            workouts: workoutsEntry.state,
            mealPlans: plansEntry.state,
        },
        counts: snapshotCounts(raw),
    };

    if (!hasData) return deepFreeze({ ...baseSnapshot, sourceGuestId: null, transformed: null });

    const sourceGuestId = readStorageValue(storage, GUEST_MIGRATION_KEYS.deviceId);
    if (typeof sourceGuestId !== "string" || !UUID_PATTERN.test(sourceGuestId)) {
        const snapshot = deepFreeze({ ...baseSnapshot, sourceGuestId: null, transformed: null });
        throw new GuestMigrationError(
            "INVALID_SOURCE_GUEST_ID",
            "Guest data has no valid device identity.",
            { snapshot, hasGuestData: true },
        );
    }

    let transformed;
    try {
        transformed = transformSnapshot(raw);
    } catch (error) {
        if (error instanceof GuestMigrationError) {
            error.snapshot = deepFreeze({ ...baseSnapshot, sourceGuestId, transformed: null });
        }
        throw error;
    }

    return deepFreeze({ ...baseSnapshot, sourceGuestId, transformed });
}

export function buildGuestImportPayload(snapshot, confirmExistingAccount = false) {
    if (!snapshot?.hasData || !snapshot.transformed || !snapshot.sourceGuestId) {
        throw new GuestMigrationError("INVALID_GUEST_SNAPSHOT", "Guest import snapshot is incomplete.", {
            snapshot,
        });
    }
    return {
        version: 1,
        source_guest_id: snapshot.sourceGuestId,
        confirm_existing_account: Boolean(confirmExistingAccount),
        profile: snapshot.transformed.profile,
        meals: snapshot.transformed.meals,
        workouts: snapshot.transformed.workouts,
        meal_plans: snapshot.transformed.mealPlans,
    };
}

function validateEntityResults(value, label) {
    if (!Array.isArray(value)) {
        throw new GuestMigrationError("INVALID_IMPORT_RESPONSE", `${label} result is invalid.`);
    }
    value.forEach((item) => {
        if (
            !item
            || typeof item !== "object"
            || !CLIENT_IMPORT_ID_PATTERN.test(item.client_import_id || "")
            || !SUCCESS_OUTCOMES.has(item.outcome)
            || typeof item.target_id !== "string"
            || !UUID_PATTERN.test(item.target_id)
        ) {
            throw new GuestMigrationError("INVALID_IMPORT_RESPONSE", `${label} result is invalid.`);
        }
    });
    return value;
}

export function validateGuestImportResponse(response) {
    if (!response || typeof response !== "object") {
        throw new GuestMigrationError("INVALID_IMPORT_RESPONSE", "Guest import response is invalid.");
    }
    if (response.status === "confirmation_required") {
        if (
            typeof response.existing_profile !== "boolean"
            || !Number.isInteger(response.guest_meals) || response.guest_meals < 0
            || !Number.isInteger(response.guest_workouts) || response.guest_workouts < 0
            || !Number.isInteger(response.guest_meal_plans) || response.guest_meal_plans < 0
        ) {
            throw new GuestMigrationError("INVALID_IMPORT_RESPONSE", "Guest import response is invalid.");
        }
        return response;
    }
    if (response.status !== "imported") {
        throw new GuestMigrationError("INVALID_IMPORT_RESPONSE", "Guest import response is invalid.");
    }
    if (
        response.profile != null
        && !["imported", "already_imported", "skipped_existing"].includes(response.profile?.outcome)
    ) {
        throw new GuestMigrationError("INVALID_IMPORT_RESPONSE", "Profile import result is invalid.");
    }
    validateEntityResults(response.meals, "Meal import");
    validateEntityResults(response.workouts, "Workout import");
    validateEntityResults(response.meal_plans, "Meal-plan import");
    return response;
}

function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === "object") {
        return Object.keys(value).sort().reduce((result, key) => {
            result[key] = stableValue(value[key]);
            return result;
        }, {});
    }
    return value;
}

function sameValue(left, right) {
    return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function readCurrentAuthoritativeData(storage) {
    const profile = parseAuthoritativeValue(
        readStorageValue(storage, GUEST_MIGRATION_KEYS.profile),
        GUEST_MIGRATION_KEYS.profile,
    );
    const meals = parseAuthoritativeValue(
        readStorageValue(storage, GUEST_MIGRATION_KEYS.meals),
        GUEST_MIGRATION_KEYS.meals,
    );
    const workouts = parseAuthoritativeValue(
        readStorageValue(storage, GUEST_MIGRATION_KEYS.workouts),
        GUEST_MIGRATION_KEYS.workouts,
    );
    const mealPlans = parseAuthoritativeValue(
        readStorageValue(storage, GUEST_MIGRATION_KEYS.mealPlans),
        GUEST_MIGRATION_KEYS.mealPlans,
    );
    if (profile.value !== null) requireObject(profile.value, "Guest profile");
    return {
        profile: profile.value,
        meals: meals.value === null ? [] : requireArray(meals.value, "Guest meals"),
        workouts: workouts.value === null ? [] : requireArray(workouts.value, "Guest workouts"),
        mealPlans: mealPlans.value === null ? [] : requireArray(mealPlans.value, "Guest meal plans"),
    };
}

function filterConfirmedRecords(currentItems, snapshotItems, results) {
    const confirmedIds = new Set(
        results.filter((item) => SUCCESS_OUTCOMES.has(item.outcome))
            .map((item) => item.client_import_id),
    );
    const snapshotById = new Map(snapshotItems.map((item) => [item.id, item]));
    return currentItems.filter((item) => {
        const id = item?.id;
        return !confirmedIds.has(id) || !snapshotById.has(id) || !sameValue(item, snapshotById.get(id));
    });
}

function restoreStorage(storage, originals) {
    originals.forEach((value, key) => {
        try {
            if (value === null) storage.removeItem(key);
            else storage.setItem(key, value);
        } catch {
            // Best-effort rollback; the authenticated import remains durable.
        }
    });
}

export function selectivelyCleanupGuestData(snapshot, response, options = {}) {
    const storage = availableStorage(options.storage);
    if (!storage) {
        throw new GuestMigrationError("CLEANUP_FAILED", "Guest storage is unavailable.", { snapshot });
    }
    const current = readCurrentAuthoritativeData(storage);
    const next = {
        profile: current.profile,
        meals: filterConfirmedRecords(current.meals, snapshot.raw.meals, response.meals),
        workouts: filterConfirmedRecords(current.workouts, snapshot.raw.workouts, response.workouts),
        mealPlans: filterConfirmedRecords(
            current.mealPlans,
            snapshot.raw.mealPlans,
            response.meal_plans,
        ),
    };
    if (
        SUCCESS_OUTCOMES.has(response.profile?.outcome)
        && sameValue(current.profile, snapshot.raw.profile)
    ) {
        next.profile = null;
    }

    const keysToProtect = [
        GUEST_MIGRATION_KEYS.profile,
        GUEST_MIGRATION_KEYS.meals,
        GUEST_MIGRATION_KEYS.workouts,
        GUEST_MIGRATION_KEYS.mealPlans,
        GUEST_MIGRATION_KEYS.lastSummary,
        GUEST_MIGRATION_KEYS.lastAddedMeal,
        GUEST_MIGRATION_KEYS.guestMode,
    ];
    const originals = new Map(keysToProtect.map((key) => [key, readStorageValue(storage, key)]));

    const writeCollection = (key, value, previous) => {
        if (value.length === 0) {
            if (previous !== null) storage.removeItem(key);
        } else {
            storage.setItem(key, JSON.stringify(value));
        }
    };

    try {
        if (next.profile === null) storage.removeItem(GUEST_MIGRATION_KEYS.profile);
        else if (!sameValue(next.profile, current.profile)) {
            storage.setItem(GUEST_MIGRATION_KEYS.profile, JSON.stringify(next.profile));
        }
        writeCollection(
            GUEST_MIGRATION_KEYS.meals,
            next.meals,
            originals.get(GUEST_MIGRATION_KEYS.meals),
        );
        writeCollection(
            GUEST_MIGRATION_KEYS.workouts,
            next.workouts,
            originals.get(GUEST_MIGRATION_KEYS.workouts),
        );
        writeCollection(
            GUEST_MIGRATION_KEYS.mealPlans,
            next.mealPlans,
            originals.get(GUEST_MIGRATION_KEYS.mealPlans),
        );
        storage.removeItem(GUEST_MIGRATION_KEYS.lastSummary);
        storage.removeItem(GUEST_MIGRATION_KEYS.lastAddedMeal);

        const hasData = next.profile !== null
            || next.meals.length > 0
            || next.workouts.length > 0
            || next.mealPlans.length > 0;
        if (!hasData) storage.removeItem(GUEST_MIGRATION_KEYS.guestMode);

        return {
            hasData,
            profilePresent: next.profile !== null,
            counts: snapshotCounts(next),
        };
    } catch (cause) {
        restoreStorage(storage, originals);
        throw new GuestMigrationError(
            "CLEANUP_FAILED",
            "Imported data is safe, but local cleanup could not finish.",
            { cause, snapshot },
        );
    }
}

async function currentAuthenticatedUserId() {
    const {
        data: { session },
    } = await supabase.auth.getSession();
    return session?.user?.id || null;
}

async function performGuestMigration({
    userId,
    confirmExistingAccount,
    snapshot,
    storage,
    importer,
    getAuthenticatedUserId,
}) {
    let immutableSnapshot = snapshot;
    try {
        immutableSnapshot = immutableSnapshot || captureGuestMigrationSnapshot({ storage });
        if (!immutableSnapshot.hasData) {
            return { status: "no_data", snapshot: immutableSnapshot, remaining: { hasData: false } };
        }

        if (await getAuthenticatedUserId() !== userId) {
            throw new GuestMigrationError(
                "AUTH_USER_CHANGED",
                "The authenticated user changed before guest import.",
                { snapshot: immutableSnapshot },
            );
        }

        const response = validateGuestImportResponse(await importer(
            buildGuestImportPayload(immutableSnapshot, confirmExistingAccount),
            { expectedUserId: userId },
        ));

        if (await getAuthenticatedUserId() !== userId) {
            throw new GuestMigrationError(
                "AUTH_USER_CHANGED",
                "The authenticated user changed during guest import.",
                { snapshot: immutableSnapshot },
            );
        }

        if (response.status === "confirmation_required") {
            return { ...response, snapshot: immutableSnapshot };
        }

        const remaining = selectivelyCleanupGuestData(immutableSnapshot, response, { storage });
        return { status: "imported", response, snapshot: immutableSnapshot, remaining };
    } catch (error) {
        if (error instanceof GuestMigrationError) {
            if (!error.snapshot) error.snapshot = immutableSnapshot || null;
            throw error;
        }
        throw new GuestMigrationError(
            error?.code === "AUTH_USER_CHANGED" ? "AUTH_USER_CHANGED" : "IMPORT_FAILED",
            "Guest data could not be imported.",
            { cause: error, snapshot: immutableSnapshot },
        );
    }
}

export function migrateGuestData(options) {
    const {
        userId,
        confirmExistingAccount = false,
        snapshot = null,
        storage = availableStorage(),
        importer = importGuestData,
        getAuthenticatedUserId = currentAuthenticatedUserId,
        lockManager = typeof navigator === "undefined" ? null : navigator.locks,
    } = options || {};
    if (!userId) {
        return Promise.reject(new GuestMigrationError(
            "AUTH_REQUIRED",
            "An authenticated user is required for guest import.",
        ));
    }

    if (migrationOperation) return migrationOperation;

    const execute = () => performGuestMigration({
        userId,
        confirmExistingAccount,
        snapshot,
        storage,
        importer,
        getAuthenticatedUserId,
    });
    const operation = Promise.resolve().then(() => (
        typeof lockManager?.request === "function"
            ? lockManager.request("flaro-guest-import", execute)
            : execute()
    ));

    migrationOperation = operation;
    operation.finally(() => {
        if (migrationOperation === operation) migrationOperation = null;
    }).catch(() => {
        // Callers handle the original rejection; suppress cleanup-chain warnings.
    });
    return operation;
}

export function resetGuestMigrationOperationsForTests() {
    migrationOperation = null;
}
