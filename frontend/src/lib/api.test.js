jest.mock("axios", () => ({
    __esModule: true,
    default: (() => {
        const instance = {
            interceptors: { request: { use: jest.fn() } },
            post: jest.fn(),
        };
        return {
            create: jest.fn(() => instance),
            testInstance: instance,
        };
    })(),
}));

jest.mock("./supabase", () => ({
    supabase: { auth: { getSession: jest.fn() } },
}));

import axios from "axios";
import { api, importGuestData } from "./api";
import { supabase } from "./supabase";

const mockApi = axios.testInstance;
const mockRequestUse = mockApi.interceptors.request.use;

describe("API guest-import request handling", () => {
    let requestInterceptor;

    beforeAll(() => {
        requestInterceptor = mockRequestUse.mock.calls[0][0];
    });

    beforeEach(() => {
        localStorage.clear();
        localStorage.setItem("nutrisnap_lang", "it");
        supabase.auth.getSession.mockResolvedValue({
            data: {
                session: {
                    access_token: "secret-access-token",
                    user: { id: "user-1" },
                },
            },
        });
        mockApi.post.mockResolvedValue({ data: { status: "imported" } });
    });

    afterEach(() => {
        jest.clearAllMocks();
        localStorage.clear();
    });

    test("strict guest-import payload receives auth but no injected lang", async () => {
        const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
        const payload = { version: 1, source_guest_id: "source" };

        const config = await requestInterceptor({
            url: "/guest-import",
            data: payload,
            headers: {},
            expectedUserId: "user-1",
        });

        expect(config.data).toEqual(payload);
        expect(config.data).not.toHaveProperty("lang");
        expect(config.headers.Authorization).toBe("Bearer secret-access-token");
        expect(config.headers["X-Lang"]).toBe("it");
        expect(logSpy).not.toHaveBeenCalled();
        logSpy.mockRestore();
    });

    test("ordinary object payloads keep language injection", async () => {
        const config = await requestInterceptor({ url: "/meals", data: {}, headers: {} });

        expect(config.data.lang).toBe("it");
    });

    test.each([
        ["pt", "pt-BR"],
        ["pt_BR", "pt-BR"],
        ["ko-KR", "ko"],
    ])("normalizes %s through X-Lang and ordinary request bodies", async (stored, expected) => {
        localStorage.setItem("nutrisnap_lang", stored);
        const config = await requestInterceptor({ url: "/meals", data: {}, headers: {} });

        expect(config.headers["X-Lang"]).toBe(expected);
        expect(config.data.lang).toBe(expected);
    });

    test("legacy locale never reaches guest-import or its strict body", async () => {
        localStorage.setItem("nutrisnap_lang", "el");
        const config = await requestInterceptor({
            url: "/guest-import",
            data: { version: 1 },
            headers: {},
            expectedUserId: "user-1",
        });

        expect(config.headers["X-Lang"]).toBe("en");
        expect(config.data).toEqual({ version: 1 });
    });

    test("authenticated-user mismatch rejects before guest import can be sent", async () => {
        await expect(requestInterceptor({
            url: "/guest-import",
            data: {},
            headers: {},
            expectedUserId: "different-user",
        })).rejects.toMatchObject({ code: "AUTH_USER_CHANGED" });
    });

    test("importGuestData forwards the expected-user guard to the shared client", async () => {
        const payload = { version: 1 };

        await expect(importGuestData(payload, { expectedUserId: "user-1" }))
            .resolves.toEqual({ status: "imported" });

        expect(api.post).toHaveBeenCalledWith(
            "/guest-import",
            payload,
            { expectedUserId: "user-1" },
        );
    });
});
