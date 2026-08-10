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

const PRESETS = ["bilanciato", "iperproteico", "ipocalorico", "ipercalorico", "keto", "mediterraneo", "vegetariano", "vegano", "custom", "ingredients"];

export const MealPlanPage = () => {
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
            toast.error(e?.response?.data?.detail || "Error");
        } finally {
            setScanningPantry(false);
        }
    };

    const generate = async () => {
        if (preset === "custom" && !customPrompt.trim()) { toast.error(t("plans.need_custom")); return; }
        if (preset === "ingredients" && ingredients.length === 0) { toast.error(t("plans.need_ingredients")); return; }
        if (guestMode) {
            toast.error("Meal plan generation currently requires an account.");
            return;
        }
        setGenerating(true);
        setPlan(null);
        try {
            const p = await generateMealPlan({
                device_id: getDeviceId(),
                preset,
                custom_prompt: customPrompt,
                days,
                target_calories: targetKcal ? Number(targetKcal) : null,
                allergies,
                ingredients: preset === "ingredients" ? ingredients : [],
            });
            setPlan(p);
            toast.success(t("plans.generated"));
        } catch (e) {
            toast.error(e?.response?.data?.detail || "Error");
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

            {/* The rest of the UI unchanged... */}
        </div>
    );
};
