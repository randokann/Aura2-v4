import { supabase } from "./lib/supabase";
import { useAuth } from "./auth/AuthProvider";
import { useEffect, useState, useCallback } from "react";
import { Toaster } from "sonner";
import "@/App.css";
import { BottomNav } from "@/components/BottomNav";
import { OnboardingDialog } from "@/components/OnboardingDialog";
import { CameraPage } from "@/pages/CameraPage";
import { DiaryPage } from "@/pages/DiaryPage";
import { ProfilePage } from "@/pages/ProfilePage";
import { MealPlanPage } from "@/pages/MealPlanPage";
import { CoachPage } from "@/pages/CoachPage";
import { LangProvider, useLang } from "@/i18n/LangContext";
import { sectionStyle } from "@/lib/sectionColors";
import { getDeviceId, getProfile, saveProfile, associateDevice } from "@/lib/api";

function Shell() {
    const { t } = useLang();
    const { user, loading: authLoading } = useAuth();
    console.log("AUTH USER:", user);
    const [tab, setTab] = useState("diario");
    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(true);
    const [refreshKey, setRefreshKey] = useState(0);
    const [showOnboarding, setShowOnboarding] = useState(false);

    const loadProfile = useCallback(async () => {
        try {
            const p = await getProfile(getDeviceId());
            setProfile(p);
            if (!p) setShowOnboarding(true);
        } catch (e) {
            console.error("Failed to load profile:", e);
            // If the backend requires authentication (401), we should show onboarding
            // so the user can sign in and complete the flow.
            // Axios errors expose response.status; otherwise fallback to showing onboarding
            const status = e?.response?.status;
            if (status === 401) {
                setShowOnboarding(true);
            } else {
                // For other errors (network), be conservative and show onboarding as well
                // so users can attempt to continue. This mirrors previous UX where missing
                // profile led to onboarding flow.
                setShowOnboarding(true);
            }
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadProfile(); }, [loadProfile]);

    useEffect(() => {
    async function migrateDeviceData() {
        if (!user) return;

        try {
            await associateDevice(getDeviceId());
            console.log("Device data associated successfully");
        } catch (e) {
            console.error("Device association failed:", e);
        }
    }

    migrateDeviceData();
}, [user]);
    
    // Key used to persist onboarding form across OAuth redirect
    const PENDING_ONBOARDING_KEY = "pending_onboarding_form_v1";

    // When finishing onboarding: if already authenticated, save immediately.
    // Otherwise persist the form and start OAuth sign-in; the pending form will be
    // completed after the auth listener detects a session.
    const finishOnboarding = async (form) => {
        try {
            // Guest local-only mode: create a local profile and mark guest mode
            if (form?.accountMethod === "guest") {
                try {
                    const guestProfile = { ...form };
                    // Remove accountMethod before storing
                    delete guestProfile.accountMethod;

                    try {
                        localStorage.setItem("aura2_guest_profile", JSON.stringify(guestProfile));
                        localStorage.setItem("aura2_guest_mode", "true");
                    } catch (e) {
                        console.warn("Failed to persist guest profile to localStorage:", e);
                    }

                    // Update React state to reflect completed onboarding
                    setProfile(guestProfile);
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
                const p = await saveProfile({ ...form });
                setProfile(p);
                setShowOnboarding(false);
                setTab("fotocamera");
            } else {
                try {
                    localStorage.setItem(PENDING_ONBOARDING_KEY, JSON.stringify(form));
                } catch (e) {
                    console.warn("Failed to persist pending onboarding form:", e);
                }

                // Trigger OAuth sign-in (redirect). After redirect back the AuthProvider
                // will update `user` and the effect below will complete the onboarding.
                await supabase.auth.signInWithOAuth({ provider: "google" });
            }
        } catch (e) {
            console.error(e);
        }
    };

    // Complete pending onboarding after sign-in
    useEffect(() => {
        async function completePendingOnboarding() {
            if (!user) return;

            let raw = null;
            try {
                raw = localStorage.getItem(PENDING_ONBOARDING_KEY);
            } catch (e) {
                console.warn("Failed to read pending onboarding form:", e);
                raw = null;
            }
            if (!raw) return;

            try {
                const pendingForm = JSON.parse(raw);
                // Remove early to avoid double-submit
                localStorage.removeItem(PENDING_ONBOARDING_KEY);

                const p = await saveProfile({ ...pendingForm });
                setProfile(p);
                setShowOnboarding(false);
                setTab("fotocamera");
            } catch (e) {
                console.error("Failed to complete pending onboarding after sign-in:", e);
            }
        }

        completePendingOnboarding();
    }, [user]);

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-[color:var(--text-secondary)] text-sm tracking-overline uppercase">
                    {t("common.loading")}
                </div>
            </div>
        );
    }

    return (
        <div className="App" style={sectionStyle(tab)}>

<button
    onClick={() =>
        supabase.auth.signInWithOAuth({
            provider: "google",
        })
    }
>
    Login Google Test
</button>

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

            {showOnboarding && <OnboardingDialog onSubmit={finishOnboarding} />}

            <div className="max-w-md mx-auto relative">
                {tab === "diario" && <DiaryPage profile={profile} refreshKey={refreshKey} />}
                {tab === "piani" && <MealPlanPage />}
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

function App() {

console.log("Supabase:", supabase);

useEffect(() => {
    async function loadUser() {

        const {
            data: { session },
        } = await supabase.auth.getSession();


        if (!session) {
            console.log("NO SESSION");
            return;
        }


        const response = await fetch(
            "http://127.0.0.1:8000/api/me",
            {
                headers: {
                    Authorization: `Bearer ${session.access_token}`,
                },
            }
        );


        console.log("STATUS:", response.status);

        const user = await response.json();

        console.log("AURA USER:", user);
    }


    loadUser();

}, []);
       

return (
    <LangProvider>
        <Shell />
    </LangProvider>
);

}

export default App;
