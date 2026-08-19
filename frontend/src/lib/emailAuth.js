import { supabase } from "./supabase";
import {
    API_ERROR_KIND,
    OFFLINE_MESSAGE,
    classifyApiError,
} from "./apiErrors";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class EmailValidationError extends Error {}

export function emailRedirectUrl(locationObject) {
    const location = locationObject
        ?? (typeof window === "undefined" ? null : window.location);
    return location?.origin ? `${location.origin}/auth/callback` : undefined;
}

export async function requestEmailMagicLink({
    email,
    beforeRequest,
    auth = supabase.auth,
    redirectTo = emailRedirectUrl(),
}) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
        throw new EmailValidationError("Invalid email address");
    }

    await beforeRequest?.();

    const options = { shouldCreateUser: true };
    if (redirectTo) options.emailRedirectTo = redirectTo;

    const { error } = await auth.signInWithOtp({
        email: normalizedEmail,
        options,
    });
    if (error) throw error;

    return normalizedEmail;
}

export function getEmailAuthErrorMessage(error, options = {}) {
    const messages = {
        invalidEmail: "Enter a valid email address.",
        offline: OFFLINE_MESSAGE,
        tooMany: "Too many email requests. Please wait a moment and try again.",
        signupUnavailable: "Email sign-up is currently unavailable.",
        sendFailed: "We couldn't send the magic link. Please try again.",
        ...options.messages,
    };
    if (error instanceof EmailValidationError) {
        return messages.invalidEmail;
    }

    const hasAuthHttpStatus = Number.isInteger(error?.status)
        && error.status >= 400
        && error.status <= 599;
    const classified = hasAuthHttpStatus
        ? { kind: API_ERROR_KIND.AUTHENTICATION }
        : classifyApiError(error, { online: options.online });
    const retryableFetchFailure = !hasAuthHttpStatus
        && error?.name === "AuthRetryableFetchError";

    if (classified.kind === API_ERROR_KIND.OFFLINE || retryableFetchFailure) {
        return messages.offline;
    }

    const message = String(error?.message || "").toLowerCase();
    if (message.includes("invalid") && message.includes("email")) {
        return messages.invalidEmail;
    }
    if (message.includes("rate limit") || message.includes("too many")) {
        return messages.tooMany;
    }
    if (message.includes("signup") && message.includes("disabled")) {
        return messages.signupUnavailable;
    }

    return messages.sendFailed;
}
