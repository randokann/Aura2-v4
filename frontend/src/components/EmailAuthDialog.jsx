import { useRef, useState } from "react";
import { CheckCircle2, Loader2, Mail } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "./ui/dialog";
import {
    getEmailAuthErrorMessage,
    requestEmailMagicLink,
} from "../lib/emailAuth";
import { useLang } from "../i18n/LangContext";

export function EmailAuthDialog({
    open,
    onOpenChange,
    beforeRequest,
    title,
}) {
    const { t } = useLang();
    const [email, setEmail] = useState("");
    const [sending, setSending] = useState(false);
    const [sentTo, setSentTo] = useState("");
    const [errorMessage, setErrorMessage] = useState("");
    const requestInFlight = useRef(false);

    const sendMagicLink = async () => {
        if (requestInFlight.current) return;
        requestInFlight.current = true;
        setSending(true);
        setErrorMessage("");
        const onlineAtRequest = typeof navigator === "undefined" ? undefined : navigator.onLine;

        try {
            const normalizedEmail = await requestEmailMagicLink({
                email,
                beforeRequest,
            });
            setSentTo(normalizedEmail);
        } catch (error) {
            setErrorMessage(getEmailAuthErrorMessage(error, {
                online: onlineAtRequest,
                messages: {
                    invalidEmail: t("auth.invalid_email"),
                    offline: t("errors.offline"),
                    tooMany: t("auth.too_many"),
                    signupUnavailable: t("auth.signup_unavailable"),
                    sendFailed: t("auth.send_failed"),
                },
            }));
        } finally {
            requestInFlight.current = false;
            setSending(false);
        }
    };

    const changeEmail = () => {
        setSentTo("");
        setErrorMessage("");
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                data-testid="email-auth-dialog"
                className="glass-strong w-[calc(100%_-_2rem)] max-w-md rounded-3xl border-white/10 bg-[color:var(--bg-default)] p-6 text-[color:var(--text-primary)]"
            >
                <DialogHeader className="pr-7 text-left">
                    <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-[color:var(--action-primary)]/20">
                        {sentTo
                            ? <CheckCircle2 size={21} className="text-[color:var(--action-primary)]" />
                            : <Mail size={21} className="text-[color:var(--action-primary)]" />}
                    </div>
                    <DialogTitle className="font-display text-2xl leading-tight">
                        {sentTo ? t("auth.check_email") : title || t("auth.continue_email")}
                    </DialogTitle>
                    <DialogDescription className="pt-1 text-sm leading-relaxed text-[color:var(--text-secondary)]">
                        {sentTo
                            ? t("auth.sent_link", { email: sentTo })
                            : t("auth.enter_email")}
                    </DialogDescription>
                </DialogHeader>

                {sentTo ? (
                    <div className="space-y-3">
                        {errorMessage && (
                            <p data-testid="email-auth-error" role="alert" className="text-sm text-red-300">
                                {errorMessage}
                            </p>
                        )}
                        <button
                            data-testid="email-auth-resend"
                            type="button"
                            disabled={sending}
                            onClick={sendMagicLink}
                            className="btn-tactile flex w-full items-center justify-center gap-2 rounded-full bg-[color:var(--action-primary)] px-5 py-3.5 text-sm font-semibold text-[color:var(--bg-default)] disabled:opacity-60"
                        >
                            {sending && <Loader2 size={16} className="animate-spin" />}
                            {sending ? t("auth.sending") : t("auth.resend")}
                        </button>
                        <button
                            type="button"
                            onClick={changeEmail}
                            className="btn-tactile w-full rounded-full bg-[color:var(--bg-elevated)] px-5 py-3 text-sm text-[color:var(--text-secondary)]"
                        >
                            {t("auth.different_email")}
                        </button>
                    </div>
                ) : (
                    <form
                        className="space-y-3"
                        onSubmit={(event) => {
                            event.preventDefault();
                            sendMagicLink();
                        }}
                    >
                        <input
                            data-testid="email-auth-input"
                            type="email"
                            autoComplete="email"
                            inputMode="email"
                            value={email}
                            disabled={sending}
                            onChange={(event) => setEmail(event.target.value)}
                            placeholder="you@example.com"
                            className="w-full rounded-2xl bg-[color:var(--bg-elevated)] px-4 py-3 outline-none focus:ring-2 focus:ring-[color:var(--action-primary)] disabled:opacity-60"
                        />
                        {errorMessage && (
                            <p data-testid="email-auth-error" role="alert" className="text-sm text-red-300">
                                {errorMessage}
                            </p>
                        )}
                        <button
                            data-testid="email-auth-submit"
                            type="submit"
                            disabled={sending}
                            className="btn-tactile flex w-full items-center justify-center gap-2 rounded-full bg-[color:var(--action-primary)] px-5 py-3.5 text-sm font-semibold text-[color:var(--bg-default)] disabled:opacity-60"
                        >
                            {sending && <Loader2 size={16} className="animate-spin" />}
                            {sending ? t("auth.sending_link") : t("auth.send_link")}
                        </button>
                    </form>
                )}
            </DialogContent>
        </Dialog>
    );
}
