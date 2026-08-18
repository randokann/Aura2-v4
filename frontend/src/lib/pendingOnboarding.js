export const PENDING_ONBOARDING_KEY = "pending_onboarding_form_v1";
export const PENDING_ONBOARDING_VERSION = 1;
export const PENDING_ONBOARDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const LEGACY_PENDING_EMAIL_KEY = "pending_onboarding_email_v1";

const AUTH_METHODS = new Set(["email", "google"]);
const AUTHENTICATED_ONBOARDING_LOCK = "flaro-authenticated-onboarding";
const authenticatedOnboardingOperations = new Map();
const PROFILE_FIELDS = [
    "name",
    "age",
    "sex",
    "height_cm",
    "current_weight_kg",
    "target_weight_kg",
    "activity_level",
    "goal",
];

function availableStorage(storage) {
    if (storage) return storage;
    return typeof localStorage === "undefined" ? null : localStorage;
}

function profileFormOnly(form) {
    return PROFILE_FIELDS.reduce((result, key) => {
        if (form && Object.prototype.hasOwnProperty.call(form, key)) {
            result[key] = form[key];
        }
        return result;
    }, {});
}

function clearLegacyPendingEmail(storage) {
    try {
        storage?.removeItem(LEGACY_PENDING_EMAIL_KEY);
    } catch {
        // Legacy cleanup must not block authentication.
    }
}

export function clearPendingOnboarding(storage) {
    try {
        availableStorage(storage)?.removeItem(PENDING_ONBOARDING_KEY);
        return true;
    } catch {
        return false;
    }
}

export function savePendingOnboarding(form, authMethod, options = {}) {
    if (!AUTH_METHODS.has(authMethod)) {
        throw new Error("Unsupported onboarding authentication method");
    }

    const storage = availableStorage(options.storage);
    if (!storage) throw new Error("Onboarding storage is unavailable");
    clearLegacyPendingEmail(storage);

    const now = options.now ?? Date.now();
    const record = {
        version: PENDING_ONBOARDING_VERSION,
        created_at: new Date(now).toISOString(),
        auth_method: authMethod,
        form: profileFormOnly(form),
    };

    storage.setItem(PENDING_ONBOARDING_KEY, JSON.stringify(record));
    return record;
}

export function readPendingOnboarding(options = {}) {
    const storage = availableStorage(options.storage);
    if (!storage) return null;
    clearLegacyPendingEmail(storage);

    let record;
    try {
        const raw = storage.getItem(PENDING_ONBOARDING_KEY);
        if (!raw) return null;
        record = JSON.parse(raw);
    } catch {
        clearPendingOnboarding(storage);
        return null;
    }

    const createdAt = Date.parse(record?.created_at);
    const now = options.now ?? Date.now();
    const hasCompleteForm = PROFILE_FIELDS.every((key) => (
        Object.prototype.hasOwnProperty.call(record?.form || {}, key)
    ));
    const valid = record?.version === PENDING_ONBOARDING_VERSION
        && AUTH_METHODS.has(record?.auth_method)
        && record?.form
        && typeof record.form === "object"
        && hasCompleteForm
        && Number.isFinite(createdAt)
        && createdAt <= now
        && now - createdAt <= PENDING_ONBOARDING_MAX_AGE_MS;

    if (!valid) {
        clearPendingOnboarding(storage);
        return null;
    }

    return record;
}

export async function resolveAuthenticatedOnboarding({
    pending,
    loadExistingProfile,
    saveNewProfile,
    clearPending,
}) {
    const existingProfile = await loadExistingProfile();
    if (existingProfile) {
        if (pending) clearPending();
        return { status: "existing", profile: existingProfile };
    }

    if (!pending) {
        return { status: "missing", profile: null };
    }

    const profile = await saveNewProfile(pending.form);
    clearPending();
    return { status: "created", profile };
}

/**
 * Run the existing profile-resolution flow once per authenticated user in this
 * tab. Web Locks also serialize the same operation across callback/original
 * tabs when the browser supports them, so the second tab observes the profile
 * created by the first instead of submitting it again.
 */
export function synchronizeAuthenticatedOnboarding({
    userId,
    readPending = readPendingOnboarding,
    loadExistingProfile,
    saveNewProfile,
    clearPending = clearPendingOnboarding,
    lockManager = typeof navigator === "undefined" ? null : navigator.locks,
}) {
    if (!userId) {
        return Promise.reject(new Error("An authenticated user is required"));
    }

    const currentOperation = authenticatedOnboardingOperations.get(userId);
    if (currentOperation) return currentOperation;

    const resolveProfile = () => resolveAuthenticatedOnboarding({
        pending: readPending(),
        loadExistingProfile,
        saveNewProfile,
        clearPending,
    });

    const operation = Promise.resolve().then(() => (
        typeof lockManager?.request === "function"
            ? lockManager.request(AUTHENTICATED_ONBOARDING_LOCK, resolveProfile)
            : resolveProfile()
    ));

    authenticatedOnboardingOperations.set(userId, operation);
    operation.finally(() => {
        if (authenticatedOnboardingOperations.get(userId) === operation) {
            authenticatedOnboardingOperations.delete(userId);
        }
    }).catch(() => {
        // The caller owns the original rejection; avoid an unhandled rejection
        // from the cleanup-only promise returned by finally().
    });

    return operation;
}
