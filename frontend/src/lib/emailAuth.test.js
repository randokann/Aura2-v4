import { OFFLINE_MESSAGE } from "./apiErrors";
import {
    EmailValidationError,
    emailRedirectUrl,
    getEmailAuthErrorMessage,
    requestEmailMagicLink,
} from "./emailAuth";

describe("passwordless email authentication", () => {
    test("persists onboarding before requesting a magic link", async () => {
        const events = [];
        const auth = {
            signInWithOtp: jest.fn(async (payload) => {
                events.push(["request", payload]);
                return { error: null };
            }),
        };

        const email = await requestEmailMagicLink({
            email: "  USER@Example.com ",
            beforeRequest: async () => events.push(["persist"]),
            auth,
            redirectTo: "http://localhost:3000/auth/callback",
        });

        expect(email).toBe("user@example.com");
        expect(events).toEqual([
            ["persist"],
            ["request", {
                email: "user@example.com",
                options: {
                    shouldCreateUser: true,
                    emailRedirectTo: "http://localhost:3000/auth/callback",
                },
            }],
        ]);
    });

    test("rejects invalid email before calling Supabase", async () => {
        const auth = { signInWithOtp: jest.fn() };
        await expect(requestEmailMagicLink({ email: "not-an-email", auth }))
            .rejects.toBeInstanceOf(EmailValidationError);
        expect(auth.signInWithOtp).not.toHaveBeenCalled();
    });

    test("uses the running application origin for redirects", () => {
        expect(emailRedirectUrl({ origin: "http://localhost:4173" }))
            .toBe("http://localhost:4173/auth/callback");
    });

    test("shows no-internet copy for a true fetch transport failure", () => {
        expect(getEmailAuthErrorMessage(new TypeError("Failed to fetch"), { online: false }))
            .toBe(OFFLINE_MESSAGE);
    });

    test("does not label a valid Supabase HTTP auth error as offline", () => {
        const error = { status: 400, message: "Invalid login credentials" };
        expect(getEmailAuthErrorMessage(error, { online: false }))
            .toBe("We couldn't send the magic link. Please try again.");
    });
});
