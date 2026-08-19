import { AlertTriangle, Cloud, Loader2 } from "lucide-react";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "./ui/dialog";
import { useLang } from "../i18n/LangContext";

export function GuestImportModal({
    mode,
    counts = { meals: 0, workouts: 0, mealPlans: 0 },
    onImport,
    onRetry,
    onContinue,
}) {
    const { t } = useLang();
    const open = ["confirmation_required", "importing", "failed"].includes(mode);
    const importing = mode === "importing";
    const failed = mode === "failed";

    const closeWithoutSync = (nextOpen) => {
        if (!nextOpen && !importing) onContinue?.();
    };

    return (
        <Dialog open={open} onOpenChange={closeWithoutSync}>
            <DialogContent
                data-testid="guest-import-modal"
                className="glass-strong w-[calc(100%_-_2rem)] max-w-md rounded-3xl border-white/10 bg-[color:var(--bg-default)] p-6 text-[color:var(--text-primary)]"
                onEscapeKeyDown={(event) => importing && event.preventDefault()}
                onInteractOutside={(event) => importing && event.preventDefault()}
            >
                <DialogHeader className="pr-7 text-left">
                    <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-[color:var(--action-primary)]/20 text-[color:var(--action-primary)]">
                        {importing ? <Loader2 className="animate-spin" size={21} /> : failed ? <AlertTriangle size={21} /> : <Cloud size={21} />}
                    </div>
                    <DialogTitle className="font-display text-2xl leading-tight">
                        {importing
                            ? t("migration.importing_title")
                            : failed
                                ? t("migration.failed_title")
                                : t("migration.confirm_title")}
                    </DialogTitle>
                    <DialogDescription className="pt-1 text-sm leading-relaxed text-[color:var(--text-secondary)]">
                        {importing
                            ? t("migration.importing_copy")
                            : failed
                                ? t("migration.failed_copy")
                                : t("migration.confirm_copy")}
                    </DialogDescription>
                </DialogHeader>

                {mode === "confirmation_required" ? (
                    <div className="grid grid-cols-3 gap-2" data-testid="guest-import-counts">
                        {[
                            [t("migration.meals"), counts.meals],
                            [t("migration.workouts"), counts.workouts],
                            [t("migration.saved_plans"), counts.mealPlans],
                        ].map(([label, value]) => (
                            <div key={label} className="rounded-2xl bg-[color:var(--bg-elevated)] p-3 text-center">
                                <div className="font-display text-xl font-semibold">{value}</div>
                                <div className="mt-1 text-[10px] uppercase tracking-wider text-[color:var(--text-secondary)]">{label}</div>
                            </div>
                        ))}
                    </div>
                ) : null}

                {!importing ? (
                    <div className="space-y-2 pt-2">
                        <button
                            type="button"
                            data-testid={failed ? "guest-import-retry" : "guest-import-confirm"}
                            onClick={failed ? onRetry : onImport}
                            className="btn-tactile w-full rounded-full bg-[color:var(--action-primary)] px-5 py-3.5 font-semibold text-[color:var(--bg-default)]"
                        >
                            {failed ? t("common.retry") : t("migration.import")}
                        </button>
                        <button
                            type="button"
                            data-testid="guest-import-continue"
                            onClick={onContinue}
                            className="btn-tactile w-full rounded-full bg-[color:var(--bg-elevated)] px-5 py-3.5 font-semibold text-[color:var(--text-primary)]"
                        >
                            {failed ? t("migration.continue_without") : t("common.not_now")}
                        </button>
                    </div>
                ) : null}
            </DialogContent>
        </Dialog>
    );
}

export default GuestImportModal;
