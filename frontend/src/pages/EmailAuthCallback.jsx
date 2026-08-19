import { AlertTriangle, CheckCircle2, LoaderCircle, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "../auth/AuthProvider";
import { useGuestMigration } from "../guestMigration/GuestMigrationProvider";
import { getProfile, saveProfile } from "../lib/api";
import { API_ERROR_KIND, classifyApiError } from "../lib/apiErrors";
import {
    clearPendingOnboarding,
    readPendingOnboarding,
    synchronizeAuthenticatedOnboarding,
} from "../lib/pendingOnboarding";

const DEFAULT_AUTO_CONTINUE_DELAY_MS = 900;

function replaceWithApp() {
    window.location.replace("/");
}

function reloadCallback() {
    window.location.reload();
}

function closeCallbackTab() {
    window.close();
}

function profileFailureMessage(error) {
    if (classifyApiError(error).kind === API_ERROR_KIND.OFFLINE) {
        return "Your email is confirmed, but Flaro couldn't finish your profile while you're offline. Reconnect and try again.";
    }
    return "Your email is confirmed, but Flaro couldn't finish setting up your profile. Your onboarding details are safe; try again.";
}

function CallbackFrame({ icon, title, message, children }) {
    return (
        <main className="min-h-screen bg-[color:var(--bg-default)] px-6 py-12 text-[color:var(--text-primary)]">
            <div className="mx-auto flex min-h-[calc(100vh-6rem)] max-w-md items-center">
                <section className="glass w-full rounded-3xl p-7">
                    <div className="mb-8 flex items-center gap-2 text-[color:var(--action-primary)]">
                        <Sparkles size={18} />
                        <span className="text-xs font-semibold uppercase tracking-[0.2em]">Flaro</span>
                    </div>
                    <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-[color:var(--bg-elevated)] text-[color:var(--action-primary)]">
                        {icon}
                    </div>
                    <h1 className="font-display text-3xl font-semibold">{title}</h1>
                    <p className="mt-3 text-sm leading-relaxed text-[color:var(--text-secondary)]">
                        {message}
                    </p>
                    {children ? <div className="mt-7 space-y-3">{children}</div> : null}
                </section>
            </div>
        </main>
    );
}

export function EmailAuthCallback({
    onContinue = replaceWithApp,
    onReturnToSignIn = replaceWithApp,
    onRetryAuth = reloadCallback,
    onClose = closeCallbackTab,
    autoContinueDelay = DEFAULT_AUTO_CONTINUE_DELAY_MS,
}) {
    const {
        user,
        loading,
        authError,
        clearAuthError,
    } = useAuth();
    const guestMigration = useGuestMigration();
    const [attempt, setAttempt] = useState(0);
    const [view, setView] = useState({ status: "confirming", message: "" });
    const operationRef = useRef(null);

    const retryProfile = useCallback(() => {
        operationRef.current = null;
        setAttempt((value) => value + 1);
    }, []);

    useEffect(() => {
        if (loading) {
            setView({ status: "confirming", message: "" });
            return undefined;
        }

        if (authError) {
            const invalidOrExpired = /invalid|expired/i.test(authError);
            setView({
                status: invalidOrExpired ? "link_error" : "auth_error",
                message: authError,
            });
            return undefined;
        }

        if (!user) {
            setView({
                status: "link_error",
                message: "This sign-in link is invalid or has expired. Request a new link and try again.",
            });
            return undefined;
        }

        if (!guestMigration.settled) {
            setView({ status: "completing", message: "" });
            return undefined;
        }

        let active = true;
        const operationKey = `${user.id}:${attempt}`;
        let operation = operationRef.current;
        if (!operation || operation.key !== operationKey) {
            operation = {
                key: operationKey,
                promise: synchronizeAuthenticatedOnboarding({
                    userId: user.id,
                    readPending: () => readPendingOnboarding(),
                    loadExistingProfile: () => getProfile("authenticated"),
                    saveNewProfile: (pendingForm) => saveProfile({ ...pendingForm }),
                    clearPending: () => clearPendingOnboarding(),
                }),
            };
            operationRef.current = operation;
        }

        setView({ status: "completing", message: "" });
        operation.promise.then((result) => {
            if (!active) return;
            setView({
                status: result.status === "missing" ? "setup_required" : "success",
                message: "",
            });
        }).catch((error) => {
            if (!active) return;
            setView({ status: "profile_error", message: profileFailureMessage(error) });
        });

        return () => {
            active = false;
        };
    }, [attempt, authError, guestMigration.settled, loading, user]);

    useEffect(() => {
        if (
            view.status !== "success"
            || guestMigration.requiresDecision
            || autoContinueDelay == null
        ) return undefined;
        const timeoutId = window.setTimeout(onContinue, autoContinueDelay);
        return () => window.clearTimeout(timeoutId);
    }, [autoContinueDelay, guestMigration.requiresDecision, onContinue, view.status]);

    const returnToSignIn = () => {
        clearAuthError?.();
        onReturnToSignIn();
    };

    const retryAuthentication = () => {
        clearAuthError?.();
        onRetryAuth();
    };

    if (view.status === "confirming" || view.status === "completing") {
        return (
            <CallbackFrame
                icon={<LoaderCircle className="animate-spin" size={24} />}
                title="Confirming your email…"
                message={view.status === "completing"
                    ? "You're signed in. Flaro is safely finishing your profile setup."
                    : "Please keep this tab open while Flaro completes sign-in."}
            />
        );
    }

    if (view.status === "success") {
        return (
            <CallbackFrame
                icon={<CheckCircle2 size={24} />}
                title="Email confirmed"
                message="You're signed in to Flaro. You can continue here, or close this tab and return to the app."
            >
                <button
                    type="button"
                    data-testid="email-callback-continue"
                    onClick={onContinue}
                    className="btn-tactile w-full rounded-full bg-[color:var(--action-primary)] px-5 py-3.5 font-semibold text-[color:var(--bg-default)]"
                >
                    Continue to Flaro
                </button>
                <button
                    type="button"
                    data-testid="email-callback-close"
                    onClick={onClose}
                    className="btn-tactile flex w-full items-center justify-center gap-2 rounded-full bg-[color:var(--bg-elevated)] px-5 py-3.5 font-semibold"
                >
                    <X size={17} />
                    Close this tab
                </button>
            </CallbackFrame>
        );
    }

    if (view.status === "setup_required") {
        return (
            <CallbackFrame
                icon={<CheckCircle2 size={24} />}
                title="Email confirmed"
                message="You're signed in. Complete your Flaro profile once to continue—there's no need to verify your email again."
            >
                <button
                    type="button"
                    data-testid="email-callback-setup"
                    onClick={onContinue}
                    className="btn-tactile w-full rounded-full bg-[color:var(--action-primary)] px-5 py-3.5 font-semibold text-[color:var(--bg-default)]"
                >
                    Complete profile setup
                </button>
                <button
                    type="button"
                    onClick={onClose}
                    className="btn-tactile flex w-full items-center justify-center gap-2 rounded-full bg-[color:var(--bg-elevated)] px-5 py-3.5 font-semibold"
                >
                    <X size={17} />
                    Close this tab
                </button>
            </CallbackFrame>
        );
    }

    if (view.status === "profile_error") {
        return (
            <CallbackFrame
                icon={<AlertTriangle size={24} />}
                title="Email confirmed"
                message={view.message}
            >
                <button
                    type="button"
                    data-testid="email-callback-retry-profile"
                    onClick={retryProfile}
                    className="btn-tactile w-full rounded-full bg-[color:var(--action-primary)] px-5 py-3.5 font-semibold text-[color:var(--bg-default)]"
                >
                    Retry profile setup
                </button>
                <button
                    type="button"
                    onClick={onClose}
                    className="btn-tactile flex w-full items-center justify-center gap-2 rounded-full bg-[color:var(--bg-elevated)] px-5 py-3.5 font-semibold"
                >
                    <X size={17} />
                    Close this tab
                </button>
            </CallbackFrame>
        );
    }

    const canRetryAuthentication = view.status === "auth_error";
    return (
        <CallbackFrame
            icon={<AlertTriangle size={24} />}
            title="We couldn't confirm this link"
            message={view.message}
        >
            {canRetryAuthentication ? (
                <button
                    type="button"
                    data-testid="email-callback-retry-auth"
                    onClick={retryAuthentication}
                    className="btn-tactile w-full rounded-full bg-[color:var(--action-primary)] px-5 py-3.5 font-semibold text-[color:var(--bg-default)]"
                >
                    Try again
                </button>
            ) : null}
            <button
                type="button"
                data-testid="email-callback-return"
                onClick={returnToSignIn}
                className="btn-tactile w-full rounded-full bg-[color:var(--bg-elevated)] px-5 py-3.5 font-semibold"
            >
                Return to sign-in
            </button>
        </CallbackFrame>
    );
}

export default EmailAuthCallback;
