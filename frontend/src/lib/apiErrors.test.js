import {
    API_ERROR_KIND,
    classifyApiError,
    getApiErrorMessage,
} from "./apiErrors";

function responseError(status, detail) {
    return { isAxiosError: true, response: { status, data: { detail } } };
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
        "GUEST_MEAL_PLAN_RATE_LIMITED",
        "MEAL_PLAN_RATE_LIMITED",
        "GUEST_PANTRY_RATE_LIMITED",
    ])("classifies cooldown code %s", (code) => {
        expect(classifyApiError(responseError(429, { code, message: "wait" }))).toMatchObject({
            kind: API_ERROR_KIND.RATE_LIMIT,
            code,
        });
    });

    test("classifies an Axios transport failure as offline", () => {
        expect(classifyApiError({ isAxiosError: true, message: "Network Error" }, { online: true }).kind)
            .toBe(API_ERROR_KIND.OFFLINE);
    });

    test("uses navigator offline state as a hint", () => {
        expect(classifyApiError(new Error("Failed to fetch"), { online: false }).kind)
            .toBe(API_ERROR_KIND.OFFLINE);
    });

    test("never labels a valid 502 response as offline", () => {
        expect(classifyApiError(responseError(502, "Food analysis error"), { online: false }).kind)
            .toBe(API_ERROR_KIND.BACKEND);
    });

    test("keeps authentication failures distinct", () => {
        expect(classifyApiError(responseError(401, "Missing authorization header")).kind)
            .toBe(API_ERROR_KIND.AUTHENTICATION);
    });

    test("extracts string and structured backend details safely", () => {
        expect(getApiErrorMessage(responseError(502, "Food analysis error"))).toBe("Food analysis error");
        expect(getApiErrorMessage(responseError(429, { message: "Please wait" }))).toBe("Please wait");
    });
});
