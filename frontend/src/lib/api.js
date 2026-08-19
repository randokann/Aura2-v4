import axios from "axios";
import { supabase } from "./supabase";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

// Non-sensitive local prefs only: anonymous UUID device_id and language preference.
// No auth tokens, no PII — safe for localStorage.
const DEVICE_KEY = "nutrisnap_device_id";

export function getDeviceId() {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
}

export async function deleteWorkout(workoutId, deviceId) {
    const params = {};
    if (deviceId) params.device_id = deviceId;

    const { data } = await api.delete(`/workouts/${workoutId}`, {
        params,
    });

    return data;
}

export async function associateDevice(deviceId) {
    const { data } = await api.post("/auth/associate", {
        device_id: deviceId,
    });

    return data;
}

export const api = axios.create({ baseURL: API });

// Send current language via header (set by LangProvider)
api.interceptors.request.use(async (config) => {
    config.auraOnlineAtRequest = typeof navigator === "undefined" ? undefined : navigator.onLine;
    const lang = localStorage.getItem("nutrisnap_lang") || "en";
    const isGuestImportRequest = config.url?.includes("/guest-import");
    config.headers = config.headers || {};
    config.headers["X-Lang"] = lang;

    try {
        const {
            data: { session },
        } = await supabase.auth.getSession();

        const token = session?.access_token;

        if (config.expectedUserId && session?.user?.id !== config.expectedUserId) {
            const error = new Error("The authenticated user changed before guest import.");
            error.code = "AUTH_USER_CHANGED";
            throw error;
        }

        if (token) {
            config.headers["Authorization"] = `Bearer ${token}`;

            const isAssociateRequest = config.url?.includes("/auth/associate");

            if (!isAssociateRequest) {
                if (config.params && typeof config.params === "object") {
                    delete config.params.device_id;
                }

                if (
                    config.data &&
                    typeof config.data === "object" &&
                    !(config.data instanceof FormData)
                ) {
                    delete config.data.device_id;
                }
            }
        }
    } catch (e) {
        if (e?.code === "AUTH_USER_CHANGED") throw e;
        // Ordinary session lookup failures are handled by the backend authentication check.
    }

    if (
        !isGuestImportRequest &&
        config.data &&
        typeof config.data === "object" &&
        !(config.data instanceof FormData)
    ) {
        if (!("lang" in config.data)) {
            config.data.lang = lang;
        }
    }

    return config;
});

export function todayISO() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

export async function analyzeFood(imageBase64, mimeType = "image/jpeg") {
    const { data } = await api.post("/analyze-food", {
        image_base64: imageBase64,
        mime_type: mimeType,
    });
    return data;
}

export async function clarifyFoodAnalysis(payload) {
    const { data } = await api.post("/clarify-food", payload);
    return data;
}

export async function saveProfile(payload) {
    const { data } = await api.post("/profile", payload);
    return data;
}

export async function importGuestData(payload, { expectedUserId } = {}) {
    const { data } = await api.post("/guest-import", payload, { expectedUserId });
    return data;
}

export async function getProfile(deviceId) {
    // For authenticated users the backend will resolve profile by JWT. We still accept deviceId for guests.
    const { data } = await api.get(`/profile/${deviceId}`);
    return data;
}

export async function createMeal(payload) {
    const { data } = await api.post("/meals", payload);
    return data;
}

export async function listMeals(deviceId, mealDate) {
    const params = {};
    if (deviceId) params.device_id = deviceId;
    if (mealDate) params.meal_date = mealDate;
    const { data } = await api.get("/meals", { params });
    return data;
}

export async function deleteMeal(mealId, deviceId) {
    const params = {};
    if (deviceId) params.device_id = deviceId;
    const { data } = await api.delete(`/meals/${mealId}`, {
        params,
    });
    return data;
}

export async function dailySummary(deviceId, mealDate) {
    const params = {};
    if (deviceId) params.device_id = deviceId;
    if (mealDate) params.meal_date = mealDate;
    const { data } = await api.get("/daily-summary", {
        params,
    });
    return data;
}

// ============ MEAL PLANNING ============
export async function generateMealPlan(payload) {
    const { data } = await api.post("/meal-plan/generate", payload);
    return data;
}

export async function saveMealPlan(payload) {
    const { data } = await api.post("/meal-plans", payload);
    return data;
}

export async function listMealPlans(deviceId) {
    const params = {};
    if (deviceId) params.device_id = deviceId;
    const { data } = await api.get("/meal-plans", { params });
    return data;
}

export async function deleteMealPlan(planId, deviceId) {
    const params = {};
    if (deviceId) params.device_id = deviceId;
    const { data } = await api.delete(`/meal-plans/${planId}`, { params });
    return data;
}

// ============ COACH ============
export async function analyzeExerciseForm(payload) {
    const { data } = await api.post("/coach/form-analysis", payload);
    return data;
}

export async function generateProgram(payload) {
    const { data } = await api.post("/coach/program", payload);
    return data;
}

export async function estimateRecovery(payload) {
    const { data } = await api.post("/coach/recovery", payload);
    return data;
}

export async function logWorkout(payload) {
    const { data } = await api.post("/workouts", payload);
    return data;
}

export async function listWorkouts(deviceId, logDate) {
    const params = {};
    if (deviceId) params.device_id = deviceId;
    if (logDate) params.log_date = logDate;
    const { data } = await api.get("/workouts", { params });
    return data;
}

export async function extractPantry(imageBase64) {
    // Only send device_id for guest flows — do not generate a new one here for association
    const {
        data: { session },
    } = await supabase.auth.getSession();

    const payload = session && session.access_token
        ? { image_base64: imageBase64 }
        : { device_id: getDeviceId(), image_base64: imageBase64 };

    const { data } = await api.post("/pantry/extract", payload);
    return data;
}
