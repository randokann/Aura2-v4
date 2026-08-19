import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "../auth/AuthProvider";
import { GuestImportModal } from "../components/GuestImportModal";
import { migrateGuestData } from "../lib/guestMigration";

const EMPTY_COUNTS = Object.freeze({ meals: 0, workouts: 0, mealPlans: 0 });
const DEFAULT_CONTEXT = Object.freeze({
    status: "idle",
    settled: true,
    requiresDecision: false,
    hasGuestData: false,
    hasImportableData: false,
    profileNeedsReconciliation: false,
    counts: EMPTY_COUNTS,
    revision: 0,
    requestDeviceImport: () => {},
});

const GuestMigrationContext = createContext(DEFAULT_CONTEXT);

function remainingState(result) {
    const remaining = result?.remaining;
    const counts = remaining?.counts || EMPTY_COUNTS;
    const profileSkipped = result?.response?.profile?.outcome === "skipped_existing";
    const profilePresent = Boolean(remaining?.profilePresent);
    return {
        counts,
        hasGuestData: Boolean(remaining?.hasData),
        hasImportableData: counts.meals > 0
            || counts.workouts > 0
            || counts.mealPlans > 0
            || (profilePresent && !profileSkipped),
        profileNeedsReconciliation: profilePresent && profileSkipped,
    };
}

export function GuestMigrationProvider({ children }) {
    const { user, loading: authLoading } = useAuth();
    const [state, setState] = useState({
        userId: null,
        status: "idle",
        settled: true,
        modal: null,
        snapshot: null,
        counts: EMPTY_COUNTS,
        hasGuestData: false,
        hasImportableData: false,
        profileNeedsReconciliation: false,
        retryConfirm: false,
        revision: 0,
    });
    const stateRef = useRef(state);
    const generationRef = useRef(0);
    const autoStartedForRef = useRef(null);

    useEffect(() => {
        stateRef.current = state;
    }, [state]);

    const runMigration = useCallback(async ({
        confirmExistingAccount = false,
        snapshot = null,
        initial = false,
    } = {}) => {
        const userId = user?.id;
        if (!userId) return;

        const generation = ++generationRef.current;
        const wasSettled = stateRef.current.userId === userId
            ? stateRef.current.settled
            : false;
        setState((current) => ({
            ...current,
            userId,
            status: initial ? "checking" : "importing",
            settled: initial ? false : wasSettled,
            modal: initial ? null : "importing",
            snapshot: snapshot || current.snapshot,
            retryConfirm: confirmExistingAccount,
        }));

        try {
            const result = await migrateGuestData({
                userId,
                confirmExistingAccount,
                snapshot,
            });
            if (generationRef.current !== generation) return;

            if (result.status === "confirmation_required") {
                setState((current) => ({
                    ...current,
                    userId,
                    status: "confirmation_required",
                    settled: true,
                    modal: "confirmation_required",
                    snapshot: result.snapshot,
                    counts: {
                        meals: result.guest_meals,
                        workouts: result.guest_workouts,
                        mealPlans: result.guest_meal_plans,
                    },
                    hasGuestData: true,
                    hasImportableData: true,
                    profileNeedsReconciliation: false,
                    retryConfirm: true,
                }));
                return;
            }

            if (result.status === "no_data") {
                setState((current) => ({
                    ...current,
                    userId,
                    status: "no_data",
                    settled: true,
                    modal: null,
                    snapshot: null,
                    counts: EMPTY_COUNTS,
                    hasGuestData: false,
                    hasImportableData: false,
                    profileNeedsReconciliation: false,
                    retryConfirm: false,
                }));
                return;
            }

            const remaining = remainingState(result);
            setState((current) => ({
                ...current,
                userId,
                status: "imported",
                settled: true,
                modal: null,
                snapshot: null,
                retryConfirm: false,
                revision: current.revision + 1,
                ...remaining,
            }));
        } catch (error) {
            if (generationRef.current !== generation) return;
            const errorSnapshot = error?.snapshot?.transformed ? error.snapshot : null;
            setState((current) => ({
                ...current,
                userId,
                status: "failed",
                settled: initial ? false : wasSettled,
                modal: "failed",
                snapshot: errorSnapshot,
                hasGuestData: error?.hasGuestData !== false,
                hasImportableData: error?.hasGuestData !== false,
                retryConfirm: confirmExistingAccount,
            }));
        }
    }, [user?.id]);

    useEffect(() => {
        if (authLoading) return;
        if (!user) {
            autoStartedForRef.current = null;
            generationRef.current += 1;
            setState((current) => current.userId === null ? current : {
                ...current,
                userId: null,
                status: "idle",
                settled: true,
                modal: null,
                snapshot: null,
                counts: EMPTY_COUNTS,
                hasGuestData: false,
                hasImportableData: false,
                profileNeedsReconciliation: false,
                retryConfirm: false,
            });
            return;
        }
        if (autoStartedForRef.current === user.id) return;
        autoStartedForRef.current = user.id;
        runMigration({ initial: true });
    }, [authLoading, runMigration, user]);

    const confirmImport = useCallback(() => {
        const current = stateRef.current;
        runMigration({ confirmExistingAccount: true, snapshot: current.snapshot });
    }, [runMigration]);

    const retryImport = useCallback(() => {
        const current = stateRef.current;
        runMigration({
            confirmExistingAccount: current.retryConfirm,
            snapshot: current.snapshot?.transformed ? current.snapshot : null,
        });
    }, [runMigration]);

    const continueWithoutSync = useCallback(() => {
        setState((current) => ({
            ...current,
            status: "deferred",
            settled: true,
            modal: null,
            hasGuestData: true,
            hasImportableData: true,
        }));
    }, []);

    const requestDeviceImport = useCallback(() => {
        runMigration({ confirmExistingAccount: false, snapshot: null });
    }, [runMigration]);

    const effectiveSettled = !authLoading && user && state.userId !== user.id
        ? false
        : state.settled;
    const requiresDecision = state.modal !== null;
    const value = useMemo(() => ({
        status: state.status,
        settled: effectiveSettled,
        requiresDecision,
        hasGuestData: state.hasGuestData,
        hasImportableData: state.hasImportableData,
        profileNeedsReconciliation: state.profileNeedsReconciliation,
        counts: state.counts,
        revision: state.revision,
        requestDeviceImport,
    }), [
        effectiveSettled,
        requestDeviceImport,
        requiresDecision,
        state.counts,
        state.hasGuestData,
        state.hasImportableData,
        state.profileNeedsReconciliation,
        state.revision,
        state.status,
    ]);

    return (
        <GuestMigrationContext.Provider value={value}>
            {children}
            <GuestImportModal
                mode={state.modal}
                counts={state.counts}
                onImport={confirmImport}
                onRetry={retryImport}
                onContinue={continueWithoutSync}
            />
        </GuestMigrationContext.Provider>
    );
}

export function useGuestMigration() {
    return useContext(GuestMigrationContext);
}
