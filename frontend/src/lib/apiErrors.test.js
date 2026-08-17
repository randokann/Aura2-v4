import {
    API_ERROR_KIND,
    OFFLINE_MESSAGE,
    classifyApiError,
    getAiRequestErrorMessage,
    getApiErrorMessage,
} from "./apiErrors";

function responseError(status, detail) {
    return { isAxiosError: true, response: { status, data: { detail } } };
}

function networkError(overrides = {}) {
    return {
        isAxiosError: true,
        code: "ERR_NETWORK",
        message: "Network Error",
        request: { status: 0 },
        config: { auraOnlineAtRequest: true },
        ...overrides,
    };
}

describe("classifyApiError", () => {
    test.each([
        "GUEST_MEAL_PLAN_LIMIT_REACHED",
        "MEAL_PLAN_DAILY_LIMIT_REACHED",
        "GUEST_PANTRY_LIMIT_REACHED",
    ])("classifies quota code %s", (code) => {
        expect(classifyApiError(responseError(429, { code, message: "limit" }))).toMatchObject({
            kind: API_ERROR_KIND.QUOTA_LIMIT,
            code,
        });
    });

    test.each([
        "MEAL_PLAN_RATE_LIMITED",
        "GUEST_PANTRY_RATE_LIMITED",
    ])("classifies cooldown code %s", (code) => {
        expect(classifyApiError(responseError(429, { code, message: "wait" }))).toMatchObject({
            kind: API_ERROR_KIND.RATE_LIMIT,
            code,
        });
    });

    test("classifies a no-response Axios network error as offline", () => {
        expect(classifyApiError(networkError(), { online: true }).kind)
            .toBe(API_ERROR_KIND.OFFLINE);
    });

    test("uses navigator offline state only as a hint for an attempted request", () => {
        const error = { isAxiosError: true, request: {}, config: { auraOnlineAtRequest: false } };
        expect(classifyApiError(error).kind)
            .toBe(API_ERROR_KIND.OFFLINE);
    });

    test("does not use navigator offline state alone for an application error", () => {
        expect(classifyApiError(new Error("application failure"), { online: false }).kind)
            .toBe(API_ERROR_KIND.UNEXPECTED);
    });

    test("never labels an HTTP 429 response as offline", () => {
        const error = responseError(429, { code: "MEAL_PLAN_RATE_LIMITED", message: "wait" });
        expect(classifyApiError(error, { online: false }).kind)
            .toBe(API_ERROR_KIND.RATE_LIMIT);
    });

    test("never labels an HTTP 502 response as offline", () => {
        expect(classifyApiError(responseError(502, "Food analysis error"), { online: false }).kind)
            .toBe(API_ERROR_KIND.BACKEND);
    });

    test("classifies a generic HTTP 500 response as backend", () => {
        expect(classifyApiError(responseError(500, "Internal error")).kind)
            .toBe(API_ERROR_KIND.BACKEND);
    });

    test("does not treat a response-less Axios configuration error as offline", () => {
        const error = { isAxiosError: true, code: "ERR_BAD_OPTION_VALUE" };
        expect(classifyApiError(error, { online: true }).kind)
            .toBe(API_ERROR_KIND.UNEXPECTED);
    });

    test("keeps authentication failures distinct", () => {
        expect(classifyApiError(responseError(401, "Missing authorization header")).kind)
            .toBe(API_ERROR_KIND.AUTHENTICATION);
    });

    test("extracts string and structured backend details safely", () => {
        expect(getApiErrorMessage(responseError(502, "Food analysis error"))).toBe("Food analysis error");
        expect(getApiErrorMessage(responseError(429, { message: "Please wait" }))).toBe("Please wait");
    });

    test("Camera-style AI messaging uses offline copy only for transport failure", () => {
        expect(getAiRequestErrorMessage(networkError(), "Food analysis failed"))
            .toBe(OFFLINE_MESSAGE);
        expect(getAiRequestErrorMessage(responseError(502, "Food analysis error"), "fallback", { online: false }))
            .toBe("Food analysis error");
    });

    test("meal-plan 429 and 5xx errors remain non-offline", () => {
        const rateLimit = responseError(429, {
            code: "MEAL_PLAN_RATE_LIMITED",
            message: "Please wait",
        });
        expect(classifyApiError(rateLimit, { online: false }).kind)
            .toBe(API_ERROR_KIND.RATE_LIMIT);
        expect(classifyApiError(responseError(500, "Meal plan error"), { online: false }).kind)
            .toBe(API_ERROR_KIND.BACKEND);
    });
});
