import {
    clearAuthRedirectError,
    getAuthRedirectError,
    localizeAuthError,
} from "./authRedirect";

describe("auth redirect errors", () => {
    test("maps an expired magic link to recoverable copy and cleans the URL", () => {
        const location = {
            pathname: "/auth/callback",
            search: "?source=email",
            hash: "#error=access_denied&error_code=otp_expired&error_description=Expired",
        };
        const history = { replaceState: jest.fn() };

        expect(getAuthRedirectError(location)).toBe(
            "This sign-in link is invalid or has expired. Request a new link and try again."
        );
        expect(clearAuthRedirectError(location, history)).toBe(true);
        expect(history.replaceState).toHaveBeenCalledWith(
            {},
            expect.any(String),
            "/auth/callback?source=email",
        );
    });

    test("ignores URLs without an auth failure", () => {
        expect(getAuthRedirectError({ pathname: "/", search: "", hash: "" })).toBeNull();
    });

    test("maps internal auth copy to locale keys before display", () => {
        const t = jest.fn((key) => `translated:${key}`);

        expect(localizeAuthError("otp_expired", t)).toBe("translated:auth.invalid_link");
        expect(localizeAuthError("Authentication couldn't be restored", t))
            .toBe("translated:auth_errors.restore");
        expect(localizeAuthError("provider failure", t))
            .toBe("translated:auth_errors.signin");
    });
});
