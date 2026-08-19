import { useState } from "react";
import { Check, Cloud, LockKeyhole, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "./ui/dialog";
import { EmailAuthDialog } from "./EmailAuthDialog";
import { supabase } from "../lib/supabase";
import {
    API_ERROR_KIND,
    classifyApiError,
    getApiErrorMessage,
} from "../lib/apiErrors";
import { useLang } from "../i18n/LangContext";

function FeatureList({ items }) {
    return (
        <ul className="mt-3 space-y-2">
            {items.map((item) => (
                <li key={item} className="flex items-start gap-2 text-xs text-[color:var(--text-secondary)]">
                    <Check size={14} className="mt-0.5 shrink-0 text-[color:var(--action-primary)]" />
                    <span>{item}</span>
                </li>
            ))}
        </ul>
    );
}

export function UpgradePlanModal({ open, onOpenChange, context = "meal-plan" }) {
    const { t } = useLang();
    const [signingIn, setSigningIn] = useState(false);
    const [emailOpen, setEmailOpen] = useState(false);
    const pantryContext = context === "pantry";

    const startGoogleSignIn = async () => {
        if (signingIn) return;
        setSigningIn(true);
        try {
            const { error } = await supabase.auth.signInWithOAuth({ provider: "google" });
            if (error) throw error;
        } catch (error) {
            const classified = classifyApiError(error);
            toast.error(
                classified.kind === API_ERROR_KIND.OFFLINE
                    ? t("errors.offline")
                    : getApiErrorMessage(error, t("profile.google_error"))
            );
            setSigningIn(false);
        }
    };

    return (
        <>
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                data-testid="upgrade-plan-modal"
                className="glass-strong w-[calc(100%_-_2rem)] max-w-lg max-h-[90vh] overflow-y-auto rounded-3xl border-white/10 bg-[color:var(--bg-default)] p-5 text-[color:var(--text-primary)]"
            >
                <DialogHeader className="pr-7 text-left">
                    <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-[color:var(--action-primary)]/20">
                        <Sparkles size={21} className="text-[color:var(--action-primary)]" />
                    </div>
                    <DialogTitle className="font-display text-2xl leading-tight">
                        {pantryContext
                            ? t("upgrade.pantry_limit_title")
                            : t("upgrade.meal_limit_title")}
                    </DialogTitle>
                    <DialogDescription className="pt-1 text-sm leading-relaxed text-[color:var(--text-secondary)]">
                        {pantryContext
                            ? t("upgrade.pantry_limit_copy")
                            : t("upgrade.meal_limit_copy")}
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-3 sm:grid-cols-2">
                    <section
                        data-testid="free-plan-card"
                        className="rounded-2xl border border-[color:var(--action-primary)]/35 bg-[color:var(--bg-elevated)]/70 p-4"
                    >
                        <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2 text-sm font-semibold">
                                <LockKeyhole size={16} className="text-[color:var(--action-primary)]" />
                                {t("upgrade.free_plan")}
                            </div>
                            <span className="rounded-full bg-[color:var(--action-primary)]/15 px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-[color:var(--action-primary)]">
                                {t("upgrade.current_plan")}
                            </span>
                        </div>
                        <FeatureList items={[
                            t("upgrade.free_meal_plans"),
                            t("upgrade.free_pantry"),
                            t("upgrade.local_data"),
                            t("upgrade.no_sync"),
                        ]} />
                    </section>

                    <section
                        data-testid="pro-plan-card"
                        className="rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-4"
                    >
                        <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2 text-sm font-semibold">
                                <Cloud size={16} className="text-[color:var(--text-secondary)]" />
                                {t("upgrade.pro_plan")}
                            </div>
                            <span className="rounded-full border border-white/10 px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-[color:var(--text-secondary)]">
                                {t("upgrade.future")}
                            </span>
                        </div>
                        <FeatureList items={[
                            t("upgrade.pro_future"),
                            t("upgrade.pro_unannounced"),
                            t("upgrade.no_paid"),
                        ]} />
                    </section>
                </div>

                <div className="space-y-2 pt-2 text-center">
                    <p className="text-xs text-[color:var(--text-secondary)]">
                        {t("upgrade.no_paid")}
                    </p>
                    <button
                        data-testid="upgrade-google-cta"
                        type="button"
                        disabled={signingIn}
                        onClick={startGoogleSignIn}
                        className="btn-tactile w-full rounded-full bg-[color:var(--action-primary)] px-5 py-3.5 text-sm font-semibold text-[color:var(--bg-default)] disabled:opacity-60"
                    >
                        {signingIn ? t("profile.opening_google") : t("upgrade.google")}
                    </button>
                    <button
                        data-testid="upgrade-email-cta"
                        type="button"
                        disabled={signingIn}
                        onClick={() => {
                            onOpenChange(false);
                            setEmailOpen(true);
                        }}
                        className="btn-tactile w-full rounded-full bg-[color:var(--bg-elevated)] px-5 py-3 text-sm text-[color:var(--text-primary)] disabled:opacity-60"
                    >
                        {t("auth.continue_email")}
                    </button>
                    <DialogClose asChild>
                        <button
                            type="button"
                            className="btn-tactile w-full rounded-full px-5 py-2.5 text-sm text-[color:var(--text-secondary)]"
                        >
                            {t("common.not_now")}
                        </button>
                    </DialogClose>
                </div>
            </DialogContent>
        </Dialog>
        <EmailAuthDialog
            open={emailOpen}
            onOpenChange={setEmailOpen}
            title={t("auth.continue_email")}
        />
        </>
    );
}
