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
import { supabase } from "../lib/supabase";
import {
    API_ERROR_KIND,
    OFFLINE_MESSAGE,
    classifyApiError,
    getApiErrorMessage,
} from "../lib/apiErrors";

const GUEST_FEATURES = [
    "3 lifetime AI meal-plan generations",
    "1 pantry or fridge scan",
    "Data stored locally on this device",
    "No cross-device sync",
];

const ACCOUNT_FEATURES = [
    "Sync your profile and data across devices",
    "Save meal plans to your account",
    "Account-based usage limits",
    "Sign in securely with Google",
    "Email sign-in planned for the future",
];

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
    const [signingIn, setSigningIn] = useState(false);
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
                    ? OFFLINE_MESSAGE
                    : getApiErrorMessage(error, "Google sign-in couldn't start. Please try again.")
            );
            setSigningIn(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                data-testid="upgrade-plan-modal"
                className="glass-strong w-[calc(100%_-_2rem)] max-w-md max-h-[90vh] overflow-y-auto rounded-3xl border-white/10 bg-[color:var(--bg-default)] p-5 text-[color:var(--text-primary)]"
            >
                <DialogHeader className="pr-7 text-left">
                    <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-[color:var(--action-primary)]/20">
                        <Sparkles size={21} className="text-[color:var(--action-primary)]" />
                    </div>
                    <DialogTitle className="font-display text-2xl leading-tight">
                        {pantryContext
                            ? "You've used your free pantry scan"
                            : "You've used your 3 free AI meal plans"}
                    </DialogTitle>
                    <DialogDescription className="pt-1 text-sm leading-relaxed text-[color:var(--text-secondary)]">
                        {pantryContext
                            ? "Your guest pantry scan has been used. Create an account to move to account-based access and keep your Aura2 data in sync."
                            : "Your free guest AI generations have been used. Create an account to move to account-based access and sync your Aura2 data."}
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-3">
                    <section className="rounded-2xl border border-white/5 bg-[color:var(--bg-elevated)]/70 p-4">
                        <div className="flex items-center gap-2 text-sm font-medium">
                            <LockKeyhole size={16} className="text-[color:var(--text-secondary)]" />
                            Guest access
                        </div>
                        <FeatureList items={GUEST_FEATURES} />
                    </section>

                    <section className="rounded-2xl border border-[color:var(--action-primary)]/30 bg-[color:var(--action-primary)]/10 p-4">
                        <div className="flex items-center gap-2 text-sm font-medium">
                            <Cloud size={16} className="text-[color:var(--action-primary)]" />
                            Aura2 account
                        </div>
                        <FeatureList items={ACCOUNT_FEATURES} />
                    </section>

                    <section className="rounded-2xl border border-dashed border-white/15 p-4">
                        <div className="text-sm font-medium">Paid plan comparison</div>
                        <p className="mt-1 text-xs leading-relaxed text-[color:var(--text-secondary)]">
                            Reserved for future pricing and expanded feature comparisons. No paid plan is selected here.
                        </p>
                    </section>
                </div>

                <div className="space-y-2 pt-1">
                    <button
                        data-testid="upgrade-google-cta"
                        type="button"
                        disabled={signingIn}
                        onClick={startGoogleSignIn}
                        className="btn-tactile w-full rounded-full bg-[color:var(--action-primary)] px-5 py-3.5 text-sm font-semibold text-[color:var(--bg-default)] disabled:opacity-60"
                    >
                        {signingIn ? "Opening Google sign-in…" : "Continue with Google"}
                    </button>
                    <button
                        data-testid="upgrade-email-cta"
                        type="button"
                        disabled
                        className="w-full rounded-full bg-[color:var(--bg-elevated)] px-5 py-3 text-sm text-[color:var(--text-secondary)] opacity-70"
                    >
                        Email sign-in — coming soon
                    </button>
                    <DialogClose asChild>
                        <button
                            type="button"
                            className="btn-tactile w-full rounded-full px-5 py-2.5 text-sm text-[color:var(--text-secondary)]"
                        >
                            Maybe later
                        </button>
                    </DialogClose>
                </div>
            </DialogContent>
        </Dialog>
    );
}
