export const API_ERROR_KIND = Object.freeze({
    OFFLINE: "offline",
    AI_UPSTREAM_UNREACHABLE: "ai_upstream_unreachable",
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
    "MEAL_PLAN_RATE_LIMITED",
    "GUEST_PANTRY_RATE_LIMITED",
]);

const AI_UPSTREAM_UNREACHABLE_CODE = "AI_UPSTREAM_UNREACHABLE";

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

const TRANSPORT_ERROR_CODES = new Set([
    "ERR_NETWORK",
    "ECONNABORTED",
    "ETIMEDOUT",
    "ECONNREFUSED",
    "ENETUNREACH",
    "ENOTFOUND",
]);

const TRANSPORT_ERROR_MESSAGES = new Set([
    "Network Error",
    "Failed to fetch",
    "Load failed",
    "Network request failed",
]);

function hasValidHttpResponse(error) {
    const status = error?.response?.status;
    return Number.isInteger(status) && status >= 100 && status <= 599;
}

function isTransportFailure(error, onlineAtRequest) {
    const request = error?.request;
    const requestStatus = request?.status;
    const code = error?.code || error?.cause?.code;
    const message = error?.message || error?.cause?.message;
    const explicitNetworkSignal = TRANSPORT_ERROR_CODES.has(code)
        || TRANSPORT_ERROR_MESSAGES.has(message)
        || (request && requestStatus === 0);

    if (explicitNetworkSignal) return true;

    // navigator.onLine is only a supporting hint for a request that was actually attempted.
    return onlineAtRequest === false && Boolean(error?.isAxiosError && request);
}

export function classifyApiError(error, options = {}) {
    const onlineAtRequest = options.online
        ?? error?.config?.auraOnlineAtRequest
        ?? browserOnlineState();
    const response = error?.response;
    const status = response?.status ?? null;
    const code = getApiErrorCode(error);

    // A real HTTP response is authoritative: 4xx/5xx responses are never labeled offline.
    if (hasValidHttpResponse(error)) {
        if (code === AI_UPSTREAM_UNREACHABLE_CODE) {
            return { kind: API_ERROR_KIND.AI_UPSTREAM_UNREACHABLE, code, status };
        }
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

    if (isTransportFailure(error, onlineAtRequest)) {
        return { kind: API_ERROR_KIND.OFFLINE, code: null, status: null };
    }

    return { kind: API_ERROR_KIND.UNEXPECTED, code: null, status: null };
}

export function isNoInternetError(error, options) {
    const kind = classifyApiError(error, options).kind;
    return kind === API_ERROR_KIND.OFFLINE
        || kind === API_ERROR_KIND.AI_UPSTREAM_UNREACHABLE;
}

export function getAiRequestErrorMessage(error, fallback, options) {
    return isNoInternetError(error, options)
        ? options?.offlineMessage || OFFLINE_MESSAGE
        : getApiErrorMessage(error, fallback);
}
