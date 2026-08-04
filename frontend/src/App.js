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
    
    const finishOnboarding = async (form) => {
        try {
            const p = await saveProfile({ device_id: getDeviceId(), ...form });
            setProfile(p);
            setShowOnboarding(false);
            setTab("fotocamera");
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
