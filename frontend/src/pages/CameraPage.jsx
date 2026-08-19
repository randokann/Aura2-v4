import { useRef, useState } from "react";
import { Camera, Upload, X, Check, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { analyzeFood, clarifyFoodAnalysis, createMeal, getDeviceId, todayISO } from "../lib/api";
import { isGuestMode, addGuestMeal } from "../lib/guestStorage";
import { useAuth } from "../auth/AuthProvider";
import { useLang } from "../i18n/LangContext";
import ClarificationModal from "../components/ClarificationModal";
import { getAiRequestErrorMessage } from "../lib/apiErrors";

function guessMealType() {
    const h = new Date().getHours();
    if (h < 10) return "colazione";
    if (h < 15) return "pranzo";
    if (h < 18) return "spuntino";
    return "cena";
}

async function fileToBase64(file) {
    const bitmap = await createImageBitmap(file);
    const maxDim = 1024;
    let { width, height } = bitmap;
    if (Math.max(width, height) > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
    }
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    return dataUrl.split(",")[1];
}

export const CameraPage = ({ onSaved }) => {
    const { t } = useLang();
    const { user } = useAuth();
    const fileRef = useRef(null);
    const galleryRef = useRef(null);
    const [preview, setPreview] = useState(null);
    const [base64, setBase64] = useState(null);
    const [analyzing, setAnalyzing] = useState(false);
    const [result, setResult] = useState(null);
    const [clarification, setClarification] = useState(null);
    const [clarifying, setClarifying] = useState(false);   
    const [mealType, setMealType] = useState(guessMealType());
    const [saving, setSaving] = useState(false);
    const [selectedOption, setSelectedOption] = useState(null);
    const guestMode = !user && isGuestMode();

    const reset = () => { setPreview(null); setBase64(null); setResult(null); setAnalyzing(false); };

    const onFile = async (file) => {
        if (!file) return;
        try {
            const b64 = await fileToBase64(file);
            setBase64(b64);
            setPreview(`data:image/jpeg;base64,${b64}`);
            setResult(null);
            await runAnalysis(b64);
        } catch { toast.error(t("errors.image_read")); }
    };

const runAnalysis = async (b64) => {
    setAnalyzing(true);
    try {
        const res = await analyzeFood(b64, "image/jpeg");
        setResult(res);

        if (res.needs_clarification) {
            setClarification(res.clarification);
        } else if (!res.foods || res.foods.length === 0) {
            toast.warning(t("camera.no_food"));
        } else {
            toast.success(t("camera.detect_success", { name: res.dish_name }));
        }

    } catch (e) {
        toast.error(getAiRequestErrorMessage(e, t("errors.food_analysis"), {
            offlineMessage: t("errors.offline"),
        }));
    } finally {
        setAnalyzing(false);
    }
};

const handleClarification = async (option) => {
    if (clarifying) return;

    setSelectedOption(option);
    setClarifying(true);

    try {
        const res = await clarifyFoodAnalysis({
            device_id: getDeviceId(),
            image_base64: base64,
            original_question: clarification.question,
            user_answer: option,
            clarification_type: clarification.clarification_type,
        });

        setResult(res);
        setClarification(null);

        toast.success(t("camera.detect_success", { name: res.dish_name }));

    } catch (e) {
        toast.error(getAiRequestErrorMessage(e, t("errors.clarification"), {
            offlineMessage: t("errors.offline"),
        }));
    } finally {
        setClarifying(false);
        setSelectedOption(null);
    }
};
    const saveMeal = async () => {
        if (!result) return;
        setSaving(true);
        try {
            const mealData = {
                device_id: getDeviceId(),
                dish_name: result.dish_name,
                foods: result.foods,
                total_calories: result.total_calories,
                total_protein: result.total_protein,
                total_carbs: result.total_carbs,
                total_fat: result.total_fat,
                total_fiber: result.total_fiber,
                image_base64: "",
                meal_date: todayISO(),
                meal_type: mealType,
                notes: result.notes || "",
            };

            const createdMeal = guestMode
                ? addGuestMeal(mealData)
                : await createMeal(mealData);

            // Only cache for authenticated users — DiaryPage reads guest meals
            // directly from aura2_guest_meals so the cache is not needed there.
            if (!guestMode && createdMeal) {
                localStorage.setItem(
                    "aura2_last_added_meal",
                    JSON.stringify(createdMeal)
                );
            }

            toast.success(t("camera.saved"));
            reset();
            onSaved?.();
        } catch { toast.error(t("errors.save_meal")); }
        finally { setSaving(false); }
    };

const scanAnimation = `
@keyframes camera-scan-sweep {
    0%, 100% {
        top: 0%;
    }

    50% {
        top: 100%;
    }
}
`;

    return (
        <div className="min-h-screen pb-32 px-5 pt-10">
            <style>{scanAnimation}</style>
            <header className="mb-6">
                <div className="text-xs tracking-overline uppercase text-[color:var(--text-secondary)] flex items-center gap-2">
                    <Sparkles size={12} /> {t("camera.eyebrow")}
                </div>
                <h1 className="font-display text-4xl font-semibold leading-none mt-2">{t("camera.title")}</h1>
                <p className="text-sm text-[color:var(--text-secondary)] mt-3 leading-relaxed">{t("camera.subtitle")}</p>
            </header>

            {!preview && (
                <div className="mt-8">
                    <div className="relative aspect-[4/5] rounded-3xl border border-dashed border-white/10 bg-[color:var(--bg-surface)] flex flex-col items-center justify-center p-8 overflow-hidden">
                        <div className="absolute inset-0 opacity-40 pointer-events-none"
                            style={{ background: "radial-gradient(circle at 50% 30%, rgba(224,122,95,0.18), transparent 60%)" }} />
                        <div className="w-20 h-20 rounded-full bg-[color:var(--action-primary)]/15 flex items-center justify-center mb-6">
                            <Camera size={32} className="text-[color:var(--action-primary)]" />
                        </div>
                        <div className="font-display text-xl mb-1">{t("camera.empty_title")}</div>
                        <div className="text-sm text-[color:var(--text-secondary)] text-center max-w-[240px]">{t("camera.empty_hint")}</div>
                    </div>

                    <div className="flex gap-3 mt-6">
                        <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => onFile(e.target.files?.[0])} />
                        <input ref={galleryRef} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />
                        <button
                            data-testid="btn-take-photo"
                            onClick={() => fileRef.current?.click()}
                            className="btn-tactile flex-1 shutter-btn rounded-full py-4 text-[color:var(--bg-default)] font-semibold flex items-center justify-center gap-2"
                        >
                            <Camera size={20} /> {t("camera.snap")}
                        </button>
                        <button
                            data-testid="btn-upload-photo"
                            onClick={() => galleryRef.current?.click()}
                            className="btn-tactile px-5 rounded-full bg-[color:var(--bg-elevated)] text-[color:var(--text-primary)] flex items-center justify-center gap-2"
                        >
                            <Upload size={18} /> {t("camera.gallery")}
                        </button>
                    </div>
                </div>
            )}

            {preview && (
                <div className="mt-2">
                    <div className="relative aspect-[4/5] rounded-3xl overflow-hidden">
                        <img src={preview} alt="preview" className="w-full h-full object-cover" />
                        {analyzing && (
    <div className="absolute inset-0 bg-[color:var(--bg-default)]/40 backdrop-blur-sm flex flex-col items-center justify-center overflow-hidden">

        <div className="absolute inset-0 z-20 pointer-events-none overflow-hidden">
            <div
                className="absolute left-0 right-0 h-[3px] rounded-full bg-[color:var(--action-primary)] shadow-[0_0_24px_4px_rgba(224,122,95,.85)]"
                style={{
                    animation: "camera-scan-sweep 3.9s ease-in-out infinite"
                }}
            >
                <div className="absolute inset-0 rounded-full bg-[color:var(--action-primary)] blur-[10px] opacity-80" />

                <div className="absolute inset-x-0 -top-8 h-8 bg-gradient-to-b from-transparent to-[color:var(--action-primary)]/20 blur-lg" />

                <div className="absolute inset-x-0 -bottom-8 h-8 bg-gradient-to-t from-transparent to-[color:var(--action-primary)]/20 blur-lg" />

                
            </div>
        </div>


        <div className="glass rounded-2xl px-6 py-5 text-center relative z-30">
            <div className="font-medium text-sm">
                {t("camera.analyzing")}
            </div>

            <div className="mt-1 text-xs text-[color:var(--text-secondary)]">
                {t("camera.analyzing_hint")}
            </div>
        </div>

    </div>
)}
                        <button data-testid="btn-reset" onClick={reset} className="absolute top-4 right-4 glass-strong rounded-full p-2">
                            <X size={18} />
                        </button>
                    </div>

                    {result && !analyzing && (
                        <div data-testid="analysis-result" className="mt-6 space-y-5">
                            <div className="glass rounded-3xl p-5">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex-1">
                                        <div className="text-[10px] tracking-overline uppercase text-[color:var(--text-secondary)]">{t("camera.detected")}</div>
                                        <h2 className="font-display text-2xl mt-1 leading-tight">{result.dish_name}</h2>
                                    </div>
                                    <span className={`text-xs px-3 py-1 rounded-full ${
                                        result.confidence?.score >= 85 ? "bg-[color:var(--macro-carbs)]/20 text-[color:var(--macro-carbs)]" :
                                        result.confidence?.score >= 65 ? "bg-[color:var(--macro-fats)]/20 text-[color:var(--macro-fats)]" :
                                        "bg-[color:var(--macro-protein)]/20 text-[color:var(--macro-protein)]"
                                    }`}>
                                        {t("camera.confidence")} {result.confidence?.score || 0}%
                                    </span>
                                </div>

                                <div className="grid grid-cols-2 gap-3 mt-5">
                                    <MetricPill label={t("camera.calories")} value={Math.round(result.total_calories)} unit="kcal" color="var(--action-primary)" />
                                    <MetricPill label={t("camera.protein")} value={Math.round(result.total_protein)} unit="g" color="var(--macro-protein)" />
                                    <MetricPill label={t("camera.carbs")} value={Math.round(result.total_carbs)} unit="g" color="var(--macro-carbs)" />
                                    <MetricPill label={t("camera.fat")} value={Math.round(result.total_fat)} unit="g" color="var(--macro-fats)" />
                                </div>

                                {result.notes && (
                                    <p className="mt-4 text-xs text-[color:var(--text-secondary)] leading-relaxed border-t border-white/5 pt-3">
                                        {result.notes}
                                    </p>
                                )}
                            </div>

                            {result.foods && result.foods.length > 0 && (
                                <div className="glass rounded-3xl p-5">
                                    <div className="text-[10px] tracking-overline uppercase text-[color:var(--text-secondary)] mb-3">
                                        {t("camera.ingredients")}
                                    </div>
                                    <div className="space-y-3">
                                        {result.foods.map((f, i) => (
                                            <div key={`${f.name}-${i}`} className="flex items-center justify-between border-b border-white/5 last:border-0 pb-3 last:pb-0">
                                                <div>
                                                    <div className="font-medium">{f.name}</div>
                                                    <div className="text-xs text-[color:var(--text-secondary)] mt-0.5">{f.quantity}</div>
                                                </div>
                                                <div className="text-right">
                                                    <div className="font-display text-lg">{Math.round(f.calories)} <span className="text-xs text-[color:var(--text-secondary)]">kcal</span></div>
                                                    <div className="text-[10px] text-[color:var(--text-secondary)]">
                                                       {Math.round(f.calories)} kcal
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="glass rounded-3xl p-5">
                                <div className="text-[10px] tracking-overline uppercase text-[color:var(--text-secondary)] mb-3">
                                    {t("camera.meal_type")}
                                </div>
                                <div className="grid grid-cols-4 gap-2">
                                    {["colazione", "pranzo", "cena", "spuntino"].map((m) => (
                                        <button
                                            key={m}
                                            data-testid={`meal-type-${m}`}
                                            onClick={() => setMealType(m)}
                                            className={`btn-tactile py-2.5 rounded-2xl text-xs font-medium ${
                                                mealType === m
                                                    ? "bg-[color:var(--action-primary)] text-[color:var(--bg-default)]"
                                                    : "bg-[color:var(--bg-elevated)] text-[color:var(--text-primary)]"
                                            }`}
                                        >
                                            {t(`meal_types.${m}`)}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <button
                                data-testid="btn-save-meal"
                                disabled={saving || !result.foods?.length}
                                onClick={saveMeal}
                                className="btn-tactile w-full py-4 rounded-full bg-[color:var(--action-primary)] text-[color:var(--bg-default)] font-semibold flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                                {saving ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
                                {t("camera.add_to_diary")}
                            </button>
                        </div>
                    )}
                </div>
            )}

           
            <ClarificationModal
                open={!!clarification}
                clarification={clarification}
                onSelect={handleClarification}
                loading={clarifying}
                selectedOption={selectedOption}
            />

        </div>
    );
};


const MetricPill = ({ label, value, unit, color }) => (
    <div className="rounded-2xl p-3 bg-[color:var(--bg-elevated)]/60 border border-white/5">
        <div className="flex items-center gap-1.5 text-[10px] tracking-overline uppercase text-[color:var(--text-secondary)]">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
            {label}
        </div>
        <div className="font-display text-2xl mt-1">
            {value}<span className="text-xs text-[color:var(--text-secondary)] ml-1">{unit}</span>
        </div>
    </div>
);
