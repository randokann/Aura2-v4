import { useEffect, useRef, useState, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, Sparkles, ChefHat, Trash2, Save, Wand2, Plus, X, Camera } from "lucide-react";
import {
    generateMealPlan, saveMealPlan, listMealPlans, deleteMealPlan, getDeviceId, extractPantry,
} from "../lib/api";
import { useAuth } from "../auth/AuthProvider";
import { useLang } from "../i18n/LangContext";
import { COMMON_INGREDIENTS } from "../i18n/translations";
import { isGuestMode, getGuestMealPlans, addGuestMealPlan, deleteGuestMealPlan } from "../lib/guestStorage";
import { UpgradePlanModal } from "../components/UpgradePlanModal";
import {
    API_ERROR_KIND,
    DAILY_MEAL_PLAN_LIMIT_MESSAGE,
    OFFLINE_MESSAGE,
    RETRY_LATER_MESSAGE,
    classifyApiError,
    getApiErrorMessage,
    isNoInternetError,
} from "../lib/apiErrors";

const PRESETS = ["bilanciato", "iperproteico", "ipocalorico", "ipercalorico", "keto", "mediterraneo", "vegetariano", "vegano", "custom", "ingredients"];

function planningTargetsFromProfile(profile) {
    if (!profile) return null;
    const weightDiff = Number(profile.target_weight_kg) - Number(profile.current_weight_kg);
    const weightDirection = profile.goal === "dimagrire" || weightDiff < -0.5
        ? "dimagrire"
        : profile.goal === "aumentare" || weightDiff > 0.5
            ? "aumentare"
            : "mantenere";
    const targets = {
        calories: Number(profile.daily_calorie_goal),
        protein: Number(profile.protein_goal),
        carbs: Number(profile.carbs_goal),
        fat: Number(profile.fat_goal),
        fiber: Number(profile.fiber_goal),
        bmi: Number(profile.bmi),
        goal: weightDirection,
        activity_level: profile.activity_level,
    };
    const numeric = ["calories", "protein", "carbs", "fat", "fiber", "bmi"];
    return numeric.every((key) => Number.isFinite(targets[key])) ? targets : null;
}

export const MealPlanPage = ({ profile }) => {
    const { t, lang } = useLang();
    const { user } = useAuth();
    const guestMode = !user && isGuestMode();
    const [preset, setPreset] = useState("bilanciato");
    const [days, setDays] = useState(3);
    const [customPrompt, setCustomPrompt] = useState("");
    const [allergies, setAllergies] = useState("");
    const [targetKcal, setTargetKcal] = useState("");
    const [ingredients, setIngredients] = useState([]);
    const [ingredientInput, setIngredientInput] = useState("");
    const [scanningPantry, setScanningPantry] = useState(false);
    const pantryFileRef = useRef(null);
    const [generating, setGenerating] = useState(false);
    const [plan, setPlan] = useState(null);
    const [saved, setSaved] = useState([]);
    const [tab, setTab] = useState("nuovo");
    const [upgradeContext, setUpgradeContext] = useState(null);

    const loadSaved = useCallback(async () => {
        try {
            if (guestMode) {
                setSaved(getGuestMealPlans() || []);
            } else {
                setSaved(await listMealPlans(getDeviceId()));
            }
        } catch (e) { console.error("List meal plans failed:", e); }
    }, [guestMode]);
    useEffect(() => { loadSaved(); }, [loadSaved]);

    const addIngredient = (name) => {
        const clean = name.trim();
        if (!clean) return;
        if (ingredients.length >= 30) { toast.error("Max 30"); return; }
        if (ingredients.some((i) => i.toLowerCase() === clean.toLowerCase())) return;
        setIngredients([...ingredients, clean]);
        setIngredientInput("");
    };

    const removeIngredient = (name) => setIngredients(ingredients.filter((i) => i !== name));

    const onPantryFile = async (file) => {
        if (!file) return;
        setScanningPantry(true);
        try {
            // Downscale
            const bitmap = await createImageBitmap(file);
            const maxDim = 1280;
            let w = bitmap.width, h = bitmap.height;
            if (Math.max(w, h) > maxDim) {
                const scale = maxDim / Math.max(w, h);
                w = Math.round(w * scale); h = Math.round(h * scale);
            }
            const canvas = document.createElement("canvas");
            canvas.width = w; canvas.height = h;
            canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
            const b64 = canvas.toDataURL("image/jpeg", 0.82).split(",")[1];

            const res = await extractPantry(b64);
            const detected = res.ingredients || [];
            const existingLower = new Set(ingredients.map((i) => i.toLowerCase()));
            const toAdd = detected.filter((i) => !existingLower.has(i.toLowerCase()));
            const combined = [...ingredients, ...toAdd].slice(0, 30);
            setIngredients(combined);
            if (toAdd.length > 0) toast.success(t("plans.added_n", { n: toAdd.length }));
            else toast.info(t("plans.no_saved") /* no new items */);
        } catch (e) {
            const error = classifyApiError(e);
            if (isNoInternetError(e)) {
                toast.error(OFFLINE_MESSAGE);
            } else if (error.code === "GUEST_PANTRY_LIMIT_REACHED") {
                setUpgradeContext("pantry");
            } else if (error.kind === API_ERROR_KIND.RATE_LIMIT) {
                toast.error(RETRY_LATER_MESSAGE);
            } else {
                toast.error(getApiErrorMessage(e, "Pantry scan failed. Please try again."));
            }
        } finally {
            setScanningPantry(false);
        }
    };

    const generate = async () => {
        if (preset === "custom" && !customPrompt.trim()) { toast.error(t("plans.need_custom")); return; }
        if (preset === "ingredients" && ingredients.length === 0) { toast.error(t("plans.need_ingredients")); return; }
        setGenerating(true);
        try {
            const p = await generateMealPlan({
                device_id: getDeviceId(),
                preset,
                custom_prompt: customPrompt,
                days,
                target_calories: targetKcal ? Number(targetKcal) : null,
                allergies,
                ingredients: preset === "ingredients" ? ingredients : [],
                planning_targets: guestMode ? planningTargetsFromProfile(profile) : null,
            });
            setPlan(p);
            toast.success(t("plans.generated"));
        } catch (e) {
            const error = classifyApiError(e);
            if (isNoInternetError(e)) {
                toast.error(OFFLINE_MESSAGE);
            } else if (error.code === "GUEST_MEAL_PLAN_LIMIT_REACHED") {
                setUpgradeContext("meal-plan");
            } else if (error.code === "MEAL_PLAN_DAILY_LIMIT_REACHED") {
                toast.error(DAILY_MEAL_PLAN_LIMIT_MESSAGE);
            } else if (error.kind === API_ERROR_KIND.RATE_LIMIT) {
                toast.error(RETRY_LATER_MESSAGE);
            } else {
                toast.error(getApiErrorMessage(e, "Meal-plan generation failed. Please try again."));
            }
        } finally { setGenerating(false); }
    };

    const savePlan = async () => {
        if (!plan) return;
        try {
            if (guestMode) {
                const savedPlan = addGuestMealPlan({ ...plan, preset });
                if (!savedPlan) {
                    toast.error("Error");
                    return;
                }
                toast.success(t("common.save"));
                await loadSaved();
            } else {
                await saveMealPlan({ device_id: getDeviceId(), ...plan, preset });
                toast.success(t("common.save"));
                await loadSaved();
            }
        } catch { toast.error("Error"); }
    };

    const onDelete = async (id) => {
        try {
            if (guestMode) {
                const deleted = deleteGuestMealPlan(id);
                if (!deleted) {
                    toast.error("Error");
                    return;
                }
                toast.success(t("plans.deleted"));
                await loadSaved();
            } else {
                await deleteMealPlan(id, getDeviceId());
                toast.success(t("plans.deleted"));
                await loadSaved();
            }
        }
        catch { toast.error("Error"); }
    };

    const commonList = COMMON_INGREDIENTS[lang] || COMMON_INGREDIENTS.en;

    return (
        <div className="min-h-screen pb-32 px-5 pt-10">
            <UpgradePlanModal
                open={upgradeContext !== null}
                context={upgradeContext || "meal-plan"}
                onOpenChange={(open) => {
                    if (!open) setUpgradeContext(null);
                }}
            />
            <header className="mb-6">
                <div className="flex items-center gap-2 text-xs tracking-overline uppercase text-[color:var(--text-secondary)]">
                    <ChefHat size={14} /> {t("plans.eyebrow")}
                </div>
                <h1 className="font-display text-4xl font-semibold leading-none mt-2">{t("plans.title")}</h1>
                <p className="text-sm text-[color:var(--text-secondary)] mt-3">{t("plans.subtitle")}</p>
            </header>

            <div className="flex gap-2 mb-6">
                {["nuovo", "salvati"].map((id) => (
                    <button
                        key={id}
                        data-testid={`plan-tab-${id}`}
                        onClick={() => setTab(id)}
                        className={`btn-tactile px-4 py-2 rounded-full text-sm ${
                            tab === id ? "bg-[color:var(--action-primary)] text-[color:var(--bg-default)]" : "bg-[color:var(--bg-elevated)] text-[color:var(--text-primary)]"
                        }`}
                    >{id === "nuovo" ? t("plans.new") : `${t("plans.saved")} (${saved.length})`}</button>
                ))}
            </div>

            {tab === "nuovo" && (
                <>
                    <div className="space-y-5">
                        <div>
                            <label className="text-[10px] tracking-overline uppercase text-[color:var(--text-secondary)] block mb-2">
                                {t("plans.type")}
                            </label>
                            <div className="grid grid-cols-3 gap-2">
                                {PRESETS.map((p) => (
                                    <button
                                        key={p}
                                        data-testid={`preset-${p}`}
                                        onClick={() => setPreset(p)}
                                        className={`btn-tactile px-3 py-2.5 rounded-2xl text-xs font-medium ${
                                            preset === p
                                                ? "bg-[color:var(--action-primary)] text-[color:var(--bg-default)]"
                                                : "bg-[color:var(--bg-elevated)]"
                                        }`}
                                    >
                                        {t(`presets.${p}`)}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {preset === "custom" && (
                            <div>
                                <label className="text-[10px] tracking-overline uppercase text-[color:var(--text-secondary)] block mb-2">{t("plans.describe")}</label>
                                <textarea
                                    data-testid="plan-custom"
                                    value={customPrompt}
                                    onChange={(e) => setCustomPrompt(e.target.value)}
                                    placeholder={t("plans.describe_ph")}
                                    rows={4}
                                    className="w-full bg-[color:var(--bg-elevated)] rounded-2xl px-4 py-3 outline-none focus:ring-2 focus:ring-[color:var(--action-primary)] resize-none"
                                />
                            </div>
                        )}

                        {preset === "ingredients" && (
                            <div className="glass rounded-3xl p-5 space-y-4">
                                <div>
                                    <div className="text-[10px] tracking-overline uppercase text-[color:var(--action-primary)] flex items-center gap-1 mb-1">
                                        <Sparkles size={10} /> {t("plans.ingredients_title")}
                                    </div>
                                    <p className="text-xs text-[color:var(--text-secondary)] leading-relaxed">{t("plans.ingredients_hint")}</p>
                                </div>

                                <div className="flex gap-2">
                                    <input
                                        data-testid="ingredient-input"
                                        value={ingredientInput}
                                        onChange={(e) => setIngredientInput(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addIngredient(ingredientInput); } }}
                                        placeholder={t("plans.ingredient_ph")}
                                        className="flex-1 bg-[color:var(--bg-elevated)] rounded-2xl px-4 py-3 outline-none focus:ring-2 focus:ring-[color:var(--action-primary)] text-sm"
                                    />
                                    <button
                                        data-testid="btn-add-ingredient"
                                        onClick={() => addIngredient(ingredientInput)}
                                        className="btn-tactile px-4 rounded-2xl bg-[color:var(--action-primary)] text-[color:var(--bg-default)] flex items-center gap-1"
                                    >
                                        <Plus size={16} />
                                    </button>
                                </div>

                                <input
                                    ref={pantryFileRef}
                                    type="file"
                                    accept="image/*"
                                    capture="environment"
                                    hidden
                                    onChange={(e) => onPantryFile(e.target.files?.[0])}
                                />
                                <button
                                    data-testid="btn-scan-pantry"
                                    onClick={() => pantryFileRef.current?.click()}
                                    disabled={scanningPantry}
                                    className="btn-tactile w-full py-3 rounded-2xl border border-dashed border-[color:var(--action-primary)]/50 bg-[color:var(--action-primary)]/10 text-[color:var(--action-primary)] flex items-center justify-center gap-2 disabled:opacity-60"
                                >
                                    {scanningPantry ? <Loader2 className="animate-spin" size={16} /> : <Camera size={16} />}
                                    <span className="text-sm font-medium">
                                        {scanningPantry ? t("plans.scanning_pantry") : t("plans.scan_pantry")}
                                    </span>
                                </button>

                                {ingredients.length > 0 && (
                                    <div data-testid="ingredients-chips" className="flex flex-wrap gap-2">
                                        {ingredients.map((ing) => (
                                            <span
                                                key={ing}
                                                className="inline-flex items-center gap-1.5 pl-3 pr-2 py-1.5 rounded-full bg-[color:var(--action-primary)]/20 text-[color:var(--action-primary)] text-xs font-medium"
                                            >
                                                {ing}
                                                <button
                                                    data-testid={`remove-ing-${ing}`}
                                                    onClick={() => removeIngredient(ing)}
                                                    className="hover:text-[color:var(--text-primary)]"
                                                >
                                                    <X size={12} />
                                                </button>
                                            </span>
                                        ))}
                                    </div>
                                )}

                                <div>
                                    <div className="text-[10px] tracking-overline uppercase text-[color:var(--text-secondary)] mb-2">{t("plans.common")}</div>
                                    <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto no-scrollbar">
                                        {commonList.map((ing) => {
                                            const selected = ingredients.some((i) => i.toLowerCase() === ing.toLowerCase());
                                            return (
                                                <button
                                                    key={ing}
                                                    data-testid={`common-${ing}`}
                                                    onClick={() => selected ? removeIngredient(ingredients.find((i) => i.toLowerCase() === ing.toLowerCase())) : addIngredient(ing)}
                                                    className={`btn-tactile px-3 py-1.5 rounded-full text-xs border ${
                                                        selected
                                                            ? "bg-[color:var(--action-primary)] text-[color:var(--bg-default)] border-transparent"
                                                            : "bg-[color:var(--bg-elevated)] border-white/5 text-[color:var(--text-secondary)]"
                                                    }`}
                                                >
                                                    {ing}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-[10px] tracking-overline uppercase text-[color:var(--text-secondary)] block mb-2">{t("plans.days")}</label>
                                <div className="grid grid-cols-4 gap-1">
                                    {[1, 3, 5, 7].map((d) => (
                                        <button
                                            key={d}
                                            data-testid={`plan-days-${d}`}
                                            onClick={() => setDays(d)}
                                            className={`btn-tactile py-2.5 rounded-xl text-sm font-medium ${
                                                days === d ? "bg-[color:var(--action-primary)] text-[color:var(--bg-default)]" : "bg-[color:var(--bg-elevated)]"
                                            }`}
                                        >{d}</button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] tracking-overline uppercase text-[color:var(--text-secondary)] block mb-2">{t("plans.kcal_opt")}</label>
                                <input
                                    data-testid="plan-kcal"
                                    value={targetKcal}
                                    onChange={(e) => setTargetKcal(e.target.value)}
                                    placeholder={t("plans.auto")}
                                    inputMode="numeric"
                                    className="w-full bg-[color:var(--bg-elevated)] rounded-2xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-[color:var(--action-primary)] text-center"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="text-[10px] tracking-overline uppercase text-[color:var(--text-secondary)] block mb-2">{t("plans.allergies")}</label>
                            <input
                                data-testid="plan-allergies"
                                value={allergies}
                                onChange={(e) => setAllergies(e.target.value)}
                                placeholder={t("plans.allergies_ph")}
                                className="w-full bg-[color:var(--bg-elevated)] rounded-2xl px-4 py-3 outline-none focus:ring-2 focus:ring-[color:var(--action-primary)]"
                            />
                        </div>

                        <button
                            data-testid="btn-generate-plan"
                            disabled={generating}
                            onClick={generate}
                            className="btn-tactile w-full py-4 rounded-full bg-[color:var(--action-primary)] text-[color:var(--bg-default)] font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                            {generating ? <Loader2 className="animate-spin" size={18} /> : <Wand2 size={18} />}
                            {generating ? t("common.generating") : t("plans.generate")}
                        </button>
                    </div>

                    {plan && (
                        <div data-testid="generated-plan" className="mt-8 space-y-4">
                            <div className="glass rounded-3xl p-5">
                                <div className="flex items-start justify-between gap-3 mb-3">
                                    <div>
                                        <div className="text-[10px] tracking-overline uppercase text-[color:var(--action-primary)] flex items-center gap-1">
                                            <Sparkles size={10} /> {t("plans.ai_gen")}
                                        </div>
                                        <h2 className="font-display text-2xl mt-1 leading-tight">{plan.title}</h2>
                                    </div>
                                    <button
                                        data-testid="btn-save-plan"
                                        onClick={savePlan}
                                        className="btn-tactile px-3 py-2 rounded-full bg-[color:var(--bg-elevated)] text-xs flex items-center gap-1"
                                    >
                                        <Save size={12} /> {t("common.save")}
                                    </button>
                                </div>
                                {plan.summary && <p className="text-sm text-[color:var(--text-secondary)] leading-relaxed">{plan.summary}</p>}
                            </div>

                            {plan.days.map((d) => <DayCard key={`day-${d.day}`} day={d} t={t} />)}
                        </div>
                    )}
                </>
            )}

            {tab === "salvati" && (
                <div className="space-y-4">
                    {saved.length === 0 && (
                        <div className="glass rounded-3xl p-8 text-center">
                            <ChefHat size={28} className="mx-auto text-[color:var(--action-primary)] mb-3" />
                            <div className="font-display text-lg">{t("plans.no_saved")}</div>
                            <div className="text-sm text-[color:var(--text-secondary)] mt-1">{t("plans.no_saved_hint")}</div>
                        </div>
                    )}
                    {saved.map((s) => (
                        <div key={s.id} data-testid={`saved-plan-${s.id}`} className="glass rounded-3xl p-5">
                            <div className="flex items-start justify-between">
                                <div className="flex-1">
                                    <div className="text-[10px] tracking-overline uppercase text-[color:var(--text-secondary)]">
                                        {t(`presets.${s.preset}`)} · {s.days.length} {t("plans.days").toLowerCase()}
                                    </div>
                                    <div className="font-display text-lg mt-1">{s.title}</div>
                                    <div className="text-xs text-[color:var(--text-secondary)] mt-1 line-clamp-2">{s.summary}</div>
                                </div>
                                <button onClick={() => onDelete(s.id)} className="btn-tactile p-2 rounded-full text-[color:var(--text-secondary)]">
                                    <Trash2 size={16} />
                                </button>
                            </div>
                            <details className="mt-3">
                                <summary className="cursor-pointer text-xs text-[color:var(--action-primary)]">{t("plans.show_meals")}</summary>
                                <div className="mt-3 space-y-3">
                                    {s.days.map((d) => <DayCard key={`saved-${s.id}-day-${d.day}`} day={d} compact t={t} />)}
                                </div>
                            </details>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

const DayCard = ({ day, compact = false, t }) => (
    <div className={`glass rounded-3xl p-5 ${compact ? "border border-white/5" : ""}`}>
        <div className="flex items-baseline justify-between mb-3">
            <h3 className="font-display text-lg">{day.label}</h3>
            <div className="text-xs text-[color:var(--text-secondary)]">
                {Math.round(day.total_calories)} kcal · P{Math.round(day.total_protein)} C{Math.round(day.total_carbs)} F{Math.round(day.total_fat)}
            </div>
        </div>
        <div className="space-y-3">
            {day.meals.map((m, i) => (
                <div key={`${m.meal_type}-${m.name}-${i}`} className="pb-3 border-b border-white/5 last:border-0 last:pb-0">
                    <div className="flex items-baseline justify-between">
                        <div>
                            <div className="text-[10px] tracking-overline uppercase text-[color:var(--text-secondary)]">
                                {t(`meal_types.${m.meal_type}`)}
                            </div>
                            <div className="font-medium">{m.name}</div>
                        </div>
                        <div className="text-right">
                            <div className="font-display">{Math.round(m.calories)}<span className="text-[10px] text-[color:var(--text-secondary)] ml-1">kcal</span></div>
                            <div className="text-[10px] text-[color:var(--text-secondary)]">P{Math.round(m.protein)} C{Math.round(m.carbs)} F{Math.round(m.fat)}</div>
                        </div>
                    </div>
                    {m.description && <p className="text-xs text-[color:var(--text-secondary)] mt-1">{m.description}</p>}
                    {m.ingredients?.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                            {m.ingredients.map((ing, k) => (
                                <span key={`${ing}-${k}`} className="text-[10px] px-2 py-0.5 rounded-full bg-[color:var(--bg-elevated)] text-[color:var(--text-secondary)]">
                                    {ing}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            ))}
        </div>
    </div>
);
