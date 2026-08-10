import { useState } from "react";
import { toast } from "sonner";
import { Save, Activity, Target, Ruler, Scale, Languages } from "lucide-react";
import { saveProfile, getDeviceId } from "../lib/api";
import { isGuestMode, getGuestProfile, saveGuestProfile } from "../lib/guestStorage";
import { useAuth } from "../auth/AuthProvider";
import { useLang } from "../i18n/LangContext";
import { LANGUAGES } from "../i18n/languages";

function computeBmi(weightKg, heightCm) {
    const heightM = heightCm / 100;
    const bmi = roundTo(weightKg / (heightM ** 2), 1);

    if (bmi < 18.5) {
        return { bmi, bmi_category: "underweight" };
    }
    if (bmi < 25) {
        return { bmi, bmi_category: "normal" };
    }
    if (bmi < 30) {
        return { bmi, bmi_category: "overweight" };
    }
    return { bmi, bmi_category: "obese" };
}

function computeProfileGoals(form) {
    const bmr = form.sex === "maschio"
        ? 10 * form.current_weight_kg + 6.25 * form.height_cm - 5 * form.age + 5
        : 10 * form.current_weight_kg + 6.25 * form.height_cm - 5 * form.age - 161;

    const factors = {
        sedentario: 1.2,
        leggero: 1.375,
        moderato: 1.55,
        intenso: 1.725,
        molto_intenso: 1.9,
    };

    const tdee = bmr * factors[form.activity_level];
    const diff = form.target_weight_kg - form.current_weight_kg;

    let calorieGoal;
    if (form.goal === "dimagrire" || diff < -0.5) {
        calorieGoal = tdee - 500;
    } else if (form.goal === "aumentare" || diff > 0.5) {
        calorieGoal = tdee + 400;
    } else {
        calorieGoal = tdee;
    }

    calorieGoal = Math.max(1200, Math.round(calorieGoal));

    const proteinMultiplier = form.goal === "dimagrire"
        ? 1.8
        : form.goal === "aumentare"
            ? 1.7
            : 1.6;

    const proteinGoal = Math.round(form.current_weight_kg * proteinMultiplier);
    const fatGoal = Math.round(form.current_weight_kg * 0.8);
    const remainingCalories = calorieGoal - (proteinGoal * 4) - (fatGoal * 9);
    const carbsGoal = remainingCalories < 0 ? 0 : Math.round(remainingCalories / 4);
    const fiberGoal = form.sex === "maschio" ? 30 : 25;

    return {
        daily_calorie_goal: calorieGoal,
        protein_goal: proteinGoal,
        carbs_goal: carbsGoal,
        fat_goal: fatGoal,
        fiber_goal: fiberGoal,
        ...computeBmi(form.current_weight_kg, form.height_cm),
    };
}

function roundTo(value, decimals) {
    return Number(value.toFixed(decimals));
}

export const ProfilePage = ({ profile, onUpdated }) => {
    const { t, lang, setLang } = useLang();
    const { user } = useAuth();
    const [form, setForm] = useState({
        name: profile?.name || "",
        age: profile?.age || 30,
        sex: profile?.sex || "maschio",
        height_cm: profile?.height_cm || 170,
        current_weight_kg: profile?.current_weight_kg || 70,
        target_weight_kg: profile?.target_weight_kg || 68,
        activity_level: profile?.activity_level || "moderato",
        goal: profile?.goal || "mantenere",
    });
    const [saving, setSaving] = useState(false);
    const upd = (k, v) => setForm((s) => ({ ...s, [k]: v }));

    const save = async () => {
        setSaving(true);
        try {
            const guestMode = !user && isGuestMode();

            if (guestMode) {
                const existingGuestProfile = getGuestProfile() || profile || {};
                const updatedGuestProfile = {
                    ...existingGuestProfile,
                    ...form,
                    ...computeProfileGoals(form),
                };

                const saved = saveGuestProfile(updatedGuestProfile);
                if (!saved) {
                    toast.error("Error");
                    return;
                }
                localStorage.setItem("aura2_guest_mode", "true");
                toast.success(t("profile.updated"));
                onUpdated?.(updatedGuestProfile);
                return;
            }

            const u = await saveProfile({ device_id: getDeviceId(), ...form });
            toast.success(t("profile.updated"));
            onUpdated?.(u);
        } catch { toast.error("Error"); }
        finally { setSaving(false); }
    };

    return (
        <div className="min-h-screen pb-32 px-5 pt-10">
            <header className="mb-8">
                <div className="text-xs tracking-overline uppercase text-[color:var(--text-secondary)]">{t("profile.eyebrow")}</div>
                <h1 className="font-display text-4xl font-semibold leading-none mt-2">{t("profile.title")}</h1>
                <p className="text-sm text-[color:var(--text-secondary)] mt-3">{t("profile.subtitle")}</p>
            </header>

            {/* Language selector */}
            <div className="glass rounded-3xl p-4 mb-6">
                <div className="flex items-center gap-2 mb-3">
                    <Languages size={16} className="text-[color:var(--action-primary)]" />
                    <div className="text-[10px] tracking-overline uppercase text-[color:var(--text-secondary)]">Language</div>
                </div>
                <div className="grid grid-cols-4 gap-2">
                    {LANGUAGES.map(({ code, flag, name }) => (
                        <button
                            key={code}
                            data-testid={`lang-${code}`}
                            onClick={() => setLang(code)}
                            className={`btn-tactile py-2.5 rounded-2xl flex flex-col items-center gap-0.5 ${
                                lang === code
                                    ? "bg-[color:var(--action-primary)] text-[color:var(--bg-default)]"
                                    : "bg-[color:var(--bg-elevated)] text-[color:var(--text-primary)]"
                            }`}
                        >
                            <span className="text-lg leading-none">{flag}</span>
                            <span className="text-[9px] tracking-overline uppercase font-medium">{name}</span>
                        </button>
                    ))}
                </div>
            </div>

            {profile && (
                <div data-testid="bmi-card" className="glass rounded-3xl p-6 mb-6">
                    <div className="grid grid-cols-3 gap-4">
                        <Stat icon={<Target size={16} />} label={t("profile.bmi")} value={profile.bmi} caption={profile.bmi_category} />
                        <Stat icon={<Activity size={16} />} label={t("profile.kcal_day")} value={Math.round(profile.daily_calorie_goal)} caption={t("profile.goal_word")} />
                        <Stat icon={<Scale size={16} />} label={t("profile.weight")} value={`${profile.current_weight_kg}kg`} caption={`→ ${profile.target_weight_kg}kg`} />
                    </div>
                    <div className="grid grid-cols-4 gap-3 mt-5 pt-5 border-t border-white/5">
                        <MacroStat label={t("profile.prot")} value={Math.round(profile.protein_goal)} color="var(--macro-protein)" />
                        <MacroStat label={t("profile.carb")} value={Math.round(profile.carbs_goal)} color="var(--macro-carbs)" />
                        <MacroStat label={t("profile.fat_short")} value={Math.round(profile.fat_goal)} color="var(--macro-fats)" />
                        <MacroStat label={t("profile.fiber_short")} value={Math.round(profile.fiber_goal)} color="var(--macro-fiber)" />
                    </div>
                </div>
            )}

            <div className="space-y-5">
                <Field label={t("profile.name")}>
                    <input
                        data-testid="profile-name"
                        value={form.name}
                        onChange={(e) => upd("name", e.target.value)}
                        className="w-full bg-[color:var(--bg-elevated)] rounded-2xl px-4 py-3 outline-none focus:ring-2 focus:ring-[color:var(--action-primary)]"
                    />
                </Field>

                <div className="grid grid-cols-2 gap-3">
                    <Field label={t("profile.age")}>
                        <NumInput testId="profile-age" value={form.age} onChange={(v) => upd("age", v)} suffix="" min={12} max={110} />
                    </Field>
                    <Field label={t("profile.sex")}>
                        <div className="grid grid-cols-2 gap-2">
                            {["maschio", "femmina"].map((s) => (
                                <button
                                    key={s}
                                    data-testid={`profile-sex-${s}`}
                                    onClick={() => upd("sex", s)}
                                    className={`btn-tactile py-3 rounded-2xl text-xs ${
                                        form.sex === s
                                            ? "bg-[color:var(--action-primary)] text-[color:var(--bg-default)]"
                                            : "bg-[color:var(--bg-elevated)]"
                                    }`}
                                >
                                    {t(`sex.${s}`)}
                                </button>
                            ))}
                        </div>
                    </Field>
                </div>

                <Field label={<><Ruler size={12} className="inline mr-1" />{t("profile.height")}</>}>
                    <NumInput testId="profile-height" value={form.height_cm} onChange={(v) => upd("height_cm", v)} suffix="cm" min={100} max={230} />
                </Field>

                <div className="grid grid-cols-2 gap-3">
                    <Field label={t("profile.cur_weight")}>
                        <NumInput testId="profile-weight" value={form.current_weight_kg} onChange={(v) => upd("current_weight_kg", v)} suffix="kg" min={30} max={250} step={0.5} />
                    </Field>
                    <Field label={t("profile.tgt_weight")}>
                        <NumInput testId="profile-target" value={form.target_weight_kg} onChange={(v) => upd("target_weight_kg", v)} suffix="kg" min={30} max={250} step={0.5} />
                    </Field>
                </div>

                <Field label={t("profile.activity")}>
                    <div className="flex flex-col gap-2">
                        {["sedentario", "leggero", "moderato", "intenso", "molto_intenso"].map((v) => (
                            <button
                                key={v}
                                data-testid={`profile-activity-${v}`}
                                onClick={() => upd("activity_level", v)}
                                className={`btn-tactile text-left px-4 py-3 rounded-2xl ${
                                    form.activity_level === v
                                        ? "bg-[color:var(--action-primary)] text-[color:var(--bg-default)]"
                                        : "bg-[color:var(--bg-elevated)]"
                                }`}
                            >
                                <div className="font-medium">{t(`activity.${v}`)}</div>
                                <div className={`text-xs ${form.activity_level === v ? "opacity-80" : "text-[color:var(--text-secondary)]"}`}>{t(`activity_desc.${v}`)}</div>
                            </button>
                        ))}
                    </div>
                </Field>

                <Field label={t("profile.goal")}>
                    <div className="grid grid-cols-3 gap-2">
                        {["dimagrire", "mantenere", "aumentare"].map((g) => (
                            <button
                                key={g}
                                data-testid={`profile-goal-${g}`}
                                onClick={() => upd("goal", g)}
                                className={`btn-tactile py-3 rounded-2xl text-sm ${
                                    form.goal === g
                                        ? "bg-[color:var(--action-primary)] text-[color:var(--bg-default)]"
                                        : "bg-[color:var(--bg-elevated)]"
                                }`}
                            >
                                {t(`goals.${g}`)}
                            </button>
                        ))}
                    </div>
                </Field>

                <button
                    data-testid="btn-save-profile"
                    onClick={save}
                    disabled={saving}
                    className="btn-tactile w-full py-4 rounded-full bg-[color:var(--action-primary)] text-[color:var(--bg-default)] font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
                >
                    <Save size={18} /> {saving ? t("common.saving") : t("profile.save_btn")}
                </button>
            </div>
        </div>
    );
};

const Field = ({ label, children }) => (
    <div>
        <label className="block text-[10px] tracking-overline uppercase text-[color:var(--text-secondary)] mb-2">{label}</label>
        {children}
    </div>
);

const NumInput = ({ value, onChange, suffix, min, max, step = 1, testId }) => (
    <div className="flex items-center bg-[color:var(--bg-elevated)] rounded-2xl overflow-hidden">
        <button className="px-3 py-3 text-xl text-[color:var(--text-secondary)]" onClick={() => onChange(Math.max(min, Number(value) - step))}>−</button>
        <input
            data-testid={testId}
            type="number"
            value={value}
            step={step}
            onChange={(e) => onChange(Number(e.target.value))}
            className="flex-1 min-w-0 bg-transparent text-center font-display text-xl outline-none py-3"
        />
        {suffix && <span className="pr-3 text-xs text-[color:var(--text-secondary)]">{suffix}</span>}
        <button className="px-3 py-3 text-xl text-[color:var(--text-secondary)]" onClick={() => onChange(Math.min(max, Number(value) + step))}>+</button>
    </div>
);

const Stat = ({ icon, label, value, caption }) => (
    <div>
        <div className="flex items-center gap-1.5 text-[color:var(--text-secondary)] text-[10px] tracking-overline uppercase">{icon} {label}</div>
        <div className="font-display text-2xl mt-1">{value}</div>
        <div className="text-[10px] text-[color:var(--text-secondary)]">{caption}</div>
    </div>
);

const MacroStat = ({ label, value, color }) => (
    <div>
        <div className="flex items-center gap-1 text-[9px] tracking-overline uppercase text-[color:var(--text-secondary)]">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} /> {label}
        </div>
        <div className="font-display text-lg mt-1">{value}<span className="text-[10px] text-[color:var(--text-secondary)] ml-1">g</span></div>
    </div>
);
