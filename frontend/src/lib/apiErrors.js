export const API_ERROR_KIND = Object.freeze({
    OFFLINE: "offline",
    QUOTA_LIMIT: "quota_limit",
    RATE_LIMIT: "rate_limit",
    AUTHENTICATION: "authentication",
    BACKEND: "backend",
    UNEXPECTED: "unexpected",
});

export const OFFLINE_MESSAGE = "No internet connection. Connect to Wi-Fi or mobile data and try again.";
export const RETRY_LATER_MESSAGE = "Please wait a few seconds before trying again.";
export const DAILY_MEAL_PLAN_LIMIT_MESSAGE = "You've used today's 2 AI meal plans. Your generation limit resets at 00:00 UTC.";

const QUOTA_CODES = new Set([
    "GUEST_MEAL_PLAN_LIMIT_REACHED",
    "MEAL_PLAN_DAILY_LIMIT_REACHED",
    "GUEST_PANTRY_LIMIT_REACHED",
]);

const RATE_LIMIT_CODES = new Set([
    "GUEST_MEAL_PLAN_RATE_LIMITED",
    "MEAL_PLAN_RATE_LIMITED",
    "GUEST_PANTRY_RATE_LIMITED",
]);

function responseDetail(error) {
    return error?.response?.data?.detail;
}

export function getApiErrorCode(error) {
    const detail = responseDetail(error);
    return detail && typeof detail === "object" ? detail.code || null : null;
}

export function getApiErrorMessage(error, fallback = "Something went wrong. Please try again.") {
    const detail = responseDetail(error);
    if (typeof detail === "string" && detail.trim()) return detail;
    if (detail && typeof detail.message === "string" && detail.message.trim()) {
        return detail.message;
    }
    return fallback;
}

function browserOnlineState() {
    return typeof navigator === "undefined" ? undefined : navigator.onLine;
}

export function classifyApiError(error, { online = browserOnlineState() } = {}) {
    const response = error?.response;
    const status = response?.status ?? null;
    const code = getApiErrorCode(error);

    // A real HTTP response is authoritative: 4xx/5xx responses are never labeled offline.
    if (response) {
        if (QUOTA_CODES.has(code)) {
            return { kind: API_ERROR_KIND.QUOTA_LIMIT, code, status };
        }
        if (RATE_LIMIT_CODES.has(code)) {
            return { kind: API_ERROR_KIND.RATE_LIMIT, code, status };
        }
        if (status === 401) {
            return { kind: API_ERROR_KIND.AUTHENTICATION, code, status };
        }
        return { kind: API_ERROR_KIND.BACKEND, code, status };
    }

    const looksLikeTransportFailure = Boolean(
        error?.isAxiosError
        || error?.request
        || error?.code === "ERR_NETWORK"
        || error?.message === "Network Error"
    );
    if (online === false || looksLikeTransportFailure) {
        return { kind: API_ERROR_KIND.OFFLINE, code: null, status: null };
    }

    return { kind: API_ERROR_KIND.UNEXPECTED, code: null, status: null };
}
