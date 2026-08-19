import { supabase } from "./lib/supabase";
import { useAuth } from "./auth/AuthProvider";
import { useEffect, useState, useCallback, useRef } from "react";
import { Toaster, toast } from "sonner";
import "@/App.css";
import { BottomNav } from "@/components/BottomNav";
import { OnboardingDialog } from "@/components/OnboardingDialog";
import { CameraPage } from "@/pages/CameraPage";
import { DiaryPage } from "@/pages/DiaryPage";
import { ProfilePage } from "@/pages/ProfilePage";
import { MealPlanPage } from "@/pages/MealPlanPage";
import { CoachPage } from "@/pages/CoachPage";
import { EmailAuthCallback } from "@/pages/EmailAuthCallback";
import { LangProvider, useLang } from "@/i18n/LangContext";
import { useGuestMigration } from "@/guestMigration/GuestMigrationProvider";
import { sectionStyle } from "@/lib/sectionColors";
import { getDeviceId, getProfile, saveProfile } from "@/lib/api";
import { getGuestProfile, saveGuestProfile } from "@/lib/guestStorage";
import {
    clearPendingOnboarding,
    readPendingOnboarding,
    savePendingOnboarding,
    synchronizeAuthenticatedOnboarding,
} from "@/lib/pendingOnboarding";

// Compute derived nutrition/BMI fields from raw profile inputs.
// Mirrors the logic in ProfilePage.computeProfileGoals so guests always
// have valid numeric values after onboarding or on restore.
function ensureGuestProfileGoals(p) {
    if (
        p.daily_calorie_goal > 0 &&
        p.protein_goal > 0 &&
        p.carbs_goal >= 0 &&
        p.fat_goal > 0 &&
        p.bmi > 0
    ) {
        return p; // already complete
    }
    try {
        const w = Number(p.current_weight_kg) || 70;
        const h = Number(p.height_cm) || 170;
        const age = Number(p.age) || 30;
        const sex = p.sex || "maschio";
        const activityFactors = {
            sedentario: 1.2, leggero: 1.375, moderato: 1.55,
            intenso: 1.725, molto_intenso: 1.9,
        };
        const factor = activityFactors[p.activity_level] ?? 1.55;
        const bmr = sex === "maschio"
            ? 10 * w + 6.25 * h - 5 * age + 5
            : 10 * w + 6.25 * h - 5 * age - 161;
        const tdee = bmr * factor;
        const diff = (Number(p.target_weight_kg) || w) - w;
        let cal = p.goal === "dimagrire" || diff < -0.5
            ? tdee - 500
            : p.goal === "aumentare" || diff > 0.5
                ? tdee + 400
                : tdee;
        cal = Math.max(1200, Math.round(cal));
        const protMult = p.goal === "dimagrire" ? 1.8 : p.goal === "aumentare" ? 1.7 : 1.6;
        const prot = Math.round(w * protMult);
        const fat = Math.round(w * 0.8);
        const carbs = Math.max(0, Math.round((cal - prot * 4 - fat * 9) / 4));
        const fiber = sex === "maschio" ? 30 : 25;
        const hm = h / 100;
        const bmi = Math.round((w / (hm * hm)) * 10) / 10;
        const bmi_category = bmi < 18.5 ? "underweight" : bmi < 25 ? "normal" : bmi < 30 ? "overweight" : "obese";
        return {
            ...p,
            daily_calorie_goal: cal,
            protein_goal: prot,
            carbs_goal: carbs,
            fat_goal: fat,
            fiber_goal: fiber,
            bmi,
            bmi_category,
        };
    } catch (e) {
        console.warn("ensureGuestProfileGoals failed:", e);
        return p;
    }
}

function Shell() {
    const { t } = useLang();
    const { user, loading: authLoading, authError, clearAuthError } = useAuth();
    const guestMigration = useGuestMigration();
    const [tab, setTab] = useState("diario");
    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(true);
    const [refreshKey, setRefreshKey] = useState(0);
    const [showOnboarding, setShowOnboarding] = useState(false);
    const [profileSyncError, setProfileSyncError] = useState("");
    const [profileSyncAttempt, setProfileSyncAttempt] = useState(0);
    const profileSyncInFlightRef = useRef(null);

    const restoreGuestProfile = useCallback(() => {
        if (user) return false;

        try {
            if (localStorage.getItem("aura2_guest_mode") !== "true") {
                return false;
            }

            const raw = getGuestProfile();
            if (!raw || typeof raw !== "object") {
                return false;
            }
            const guestProfile = ensureGuestProfileGoals(raw);
            // Persist back if we had to fill in missing derived fields
            if (guestProfile !== raw) {
                saveGuestProfile(guestProfile);
            }
            setProfile(guestProfile);
            setShowOnboarding(false);
            setLoading(false);
            return true;
        } catch (e) {
            console.warn("Failed to restore guest profile:", e);
            return false;
        }
    }, [user]);

    useEffect(() => {
        if (authLoading) return;
        let active = true;

        async function synchronizeProfile() {
            setProfileSyncError("");

            if (!user) {
                if (!restoreGuestProfile() && active) {
                    setProfile(null);
                    setShowOnboarding(true);
                    setLoading(false);
                }
                return;
            }

            if (!guestMigration.settled) {
                setLoading(true);
                return;
            }

            setLoading(true);
            const userId = user.id;
            let operation = profileSyncInFlightRef.current;

            if (
                !operation
                || operation.userId !== userId
                || operation.migrationRevision !== guestMigration.revision
            ) {
                const pending = readPendingOnboarding();
                const promise = synchronizeAuthenticatedOnboarding({
                    userId,
                    readPending: () => readPendingOnboarding(),
                    loadExistingProfile: () => getProfile("authenticated"),
                    saveNewProfile: (pendingForm) => saveProfile({ ...pendingForm }),
                    clearPending: () => clearPendingOnboarding(),
                });
                operation = {
                    userId,
                    promise,
                    hasPending: Boolean(pending),
                    migrationRevision: guestMigration.revision,
                };
                profileSyncInFlightRef.current = operation;
            }

            try {
                const result = await operation.promise;
                if (!active) return;

                setProfile(result.profile);
                setShowOnboarding(result.status === "missing");
                if (result.status === "created") setTab("fotocamera");
            } catch (error) {
                console.error("Failed to synchronize authenticated profile:", error);
                if (active) {
                    setProfileSyncError(
                        operation.hasPending
                            ? "We couldn't finish setting up your profile. Your onboarding data is safe; try again."
                            : "We couldn't load your profile. Please try again."
                    );
                }
            } finally {
                if (profileSyncInFlightRef.current === operation) {
                    profileSyncInFlightRef.current = null;
                }
                if (active) setLoading(false);
            }
        }

        synchronizeProfile();
        return () => {
            active = false;
        };
    }, [
        authLoading,
        guestMigration.revision,
        guestMigration.settled,
        profileSyncAttempt,
        restoreGuestProfile,
        user,
    ]);

    useEffect(() => {
        if (!authError) return;
        toast.error(authError);
        clearAuthError();
    }, [authError, clearAuthError]);

    // When finishing onboarding: if already authenticated, save immediately.
    // Otherwise persist the form and start OAuth sign-in; the pending form will be
    // completed after the auth listener detects a session.
    const finishOnboarding = async (form) => {
        try {
            // Guest local-only mode: create a local profile and mark guest mode
            if (!user && form?.accountMethod === "guest") {
                try {
                    const guestProfile = { ...form };
                    // Remove accountMethod before storing
                    delete guestProfile.accountMethod;

                    // Reuse existing local device id as stable anonymous guest identity
                    // and ensure derived nutrition/BMI fields are always populated.
                    const guestProfileWithIdentity = ensureGuestProfileGoals({
                        ...guestProfile,
                        device_id: getDeviceId(),
                    });

                    try {
                        const saved = saveGuestProfile(guestProfileWithIdentity);
                        if (!saved) {
                            console.warn("Failed to persist guest profile to localStorage.");
                            return;
                        }
                        localStorage.setItem("aura2_guest_mode", "true");
                    } catch (e) {
                        console.warn("Failed to persist guest profile to localStorage:", e);
                        return;
                    }
                    // Update React state to reflect completed onboarding
                    setProfile(guestProfileWithIdentity);
                    setShowOnboarding(false);
                    setTab("fotocamera");
                    return;
                } catch (e) {
                    console.error("Failed to finish onboarding in guest mode:", e);
                    // Fall through to normal flow if something unexpected happens
                }
            }

            if (user) {
                // Authenticated: call saveProfile directly. Do not include device_id —
                // interceptor will attach Authorization header and backend expects JWT.
                const profileForm = { ...form };
                delete profileForm.accountMethod;
                const p = await saveProfile(profileForm);
                setProfile(p);
                setShowOnboarding(false);
                setTab("fotocamera");
            } else {
                savePendingOnboarding(form, "google");

                // Trigger OAuth sign-in (redirect). After redirect back the AuthProvider
                // will update `user` and profile synchronization will complete onboarding.
                const { error } = await supabase.auth.signInWithOAuth({ provider: "google" });
                if (error) throw error;
            }
        } catch (e) {
            console.error(e);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-[color:var(--text-secondary)] text-sm tracking-overline uppercase">
                    {t("common.loading")}
                </div>
            </div>
        );
    }

    if (profileSyncError && user) {
        return (
            <div className="min-h-screen flex items-center justify-center px-6">
                <div className="glass max-w-md rounded-3xl p-6 text-center">
                    <h1 className="font-display text-2xl font-semibold">Profile setup paused</h1>
                    <p className="mt-3 text-sm text-[color:var(--text-secondary)]">
                        {profileSyncError}
                    </p>
                    <button
                        type="button"
                        onClick={() => setProfileSyncAttempt((attempt) => attempt + 1)}
                        className="btn-tactile mt-5 w-full rounded-full bg-[color:var(--action-primary)] px-5 py-3.5 font-semibold text-[color:var(--bg-default)]"
                    >
                        Try again
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="App" style={sectionStyle(tab)}>
            <Toaster
                position="top-center"
                theme="dark"
                toastOptions={{
                    style: {
                        background: "rgba(26,36,33,0.9)",
                        color: "#F5F5F0",
                        border: "1px solid rgba(255,255,255,0.08)",
                        backdropFilter: "blur(20px)",
                    },
                }}
            />

            {showOnboarding && (
                <OnboardingDialog
                    authenticated={Boolean(user)}
                    onSubmit={finishOnboarding}
                />
            )}

            <div className="max-w-md mx-auto relative">
                {tab === "diario" && <DiaryPage profile={profile} refreshKey={refreshKey} />}
                {tab === "piani" && <MealPlanPage profile={profile} />}
                {tab === "fotocamera" && (
                    <CameraPage
                        onSaved={() => {
                            setRefreshKey((k) => k + 1);
                            setTab("diario");
                        }}

                    />
                )}
                {tab === "coach" && <CoachPage />}
                {tab === "profilo" && <ProfilePage profile={profile} onUpdated={setProfile} />}
            </div>

            <BottomNav active={tab} onChange={setTab} />
        </div>
    );
}

export function isEmailAuthCallbackPath(pathname) {
    const currentPath = pathname
        ?? (typeof window === "undefined" ? "" : window.location.pathname);
    return currentPath === "/auth/callback" || currentPath === "/auth/callback/";
}

function App() {
    return (
        <LangProvider>
            {isEmailAuthCallbackPath() ? <EmailAuthCallback /> : <Shell />}
        </LangProvider>
    );
}

export default App;
