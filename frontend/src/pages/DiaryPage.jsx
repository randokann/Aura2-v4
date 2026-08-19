import { useEffect, useState, useCallback } from "react";
import { Trash2, Utensils, Flame, Dumbbell } from "lucide-react";
import { toast } from "sonner";
import { ProgressRing, MacroBar } from "../components/ProgressRing";
import { dailySummary, deleteMeal, deleteWorkout, getDeviceId, listMeals, listWorkouts, todayISO } from "../lib/api";
import { isGuestMode, getGuestMeals, deleteGuestMeal, getGuestWorkouts, deleteGuestWorkout } from "../lib/guestStorage";
import { useAuth } from "../auth/AuthProvider";
import { useLang } from "../i18n/LangContext";

function buildDiaryGoals(profile) {
    return {
        calories: profile?.daily_calorie_goal || 2000,
        protein: profile?.protein_goal || 120,
        carbs: profile?.carbs_goal || 250,
        fat: profile?.fat_goal || 65,
        fiber: profile?.fiber_goal || 30,
    };
}

function buildGuestSummary(meals, mealDate, profile) {
    return {
        totals: {
            calories: meals.reduce((sum, meal) => sum + (meal?.total_calories || 0), 0),
            protein: meals.reduce((sum, meal) => sum + (meal?.total_protein || 0), 0),
            carbs: meals.reduce((sum, meal) => sum + (meal?.total_carbs || 0), 0),
            fat: meals.reduce((sum, meal) => sum + (meal?.total_fat || 0), 0),
            fiber: meals.reduce((sum, meal) => sum + (meal?.total_fiber || 0), 0),
            meal_count: meals.length,
        },
        goals: buildDiaryGoals(profile),
        meal_date: mealDate,
    };
}

export const DiaryPage = ({ profile, refreshKey }) => {
    const { t, lang } = useLang();
    const { user } = useAuth();
const [summary, setSummary] = useState(() => {
    const saved = localStorage.getItem("aura2_last_summary");
    return saved ? JSON.parse(saved) : null;
});
    const [hasLoadedSummary, setHasLoadedSummary] = useState(false);
    const [meals, setMeals] = useState([]);
    const [workouts, setWorkouts] = useState([]);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        console.log("DIARY LOAD", Date.now());
        setLoading(true);

    try {
            const start = performance.now();
            const today = todayISO();
            const guestMode = !user && isGuestMode();

            if (guestMode) {
                const guestMeals = getGuestMeals()
                    .filter((meal) => meal?.meal_date === today)
                    .reverse();
                const guestWorkouts = getGuestWorkouts()
                    .filter((w) => w?.log_date === today);
                const guestSummary = buildGuestSummary(guestMeals, today, profile);

                setSummary(guestSummary);
                localStorage.setItem("aura2_last_summary", JSON.stringify(guestSummary));
                setHasLoadedSummary(true);
                setMeals(guestMeals);
                setWorkouts(guestWorkouts);
                localStorage.removeItem("aura2_last_added_meal");
                console.log("Total load:", performance.now() - start);
                return;
            }

            const deviceId = getDeviceId();
            const cachedMeal = localStorage.getItem("aura2_last_added_meal");

if (cachedMeal) {
    const meal = JSON.parse(cachedMeal);

    if (meal.meal_date === today) {
        setMeals((prev) => [meal, ...prev]);
    }
}

            console.time("Diary fetch");

            const [s, m, w] = await Promise.all([
                dailySummary(deviceId, today),
                listMeals(deviceId, today),
                listWorkouts(deviceId, today),
            ]);
            setSummary(s);
            localStorage.setItem("aura2_last_summary", JSON.stringify(s));
            setHasLoadedSummary(true);
            setMeals(m);
            setWorkouts(w);
localStorage.removeItem("aura2_last_added_meal");
console.timeEnd("Diary fetch");
console.log("Total load:", performance.now() - start);
        } catch (e) {
            console.error("Diary load failed:", e);
            toast.error(t("common.error"));
        } finally {
            setLoading(false);
        }
    }, [profile, t, user]);

    useEffect(() => { load(); }, [load, refreshKey]);

    const onDelete = async (id) => {
        try {
            if (!user && isGuestMode()) {
                const deleted = deleteGuestMeal(id);
                if (!deleted) {
                    return;
                }

                const today = todayISO();
                const guestMeals = getGuestMeals()
                    .filter((meal) => meal?.meal_date === today)
                    .reverse();
                const guestSummary = buildGuestSummary(guestMeals, today, profile);

                setMeals(guestMeals);
                setSummary(guestSummary);
                localStorage.setItem("aura2_last_summary", JSON.stringify(guestSummary));
                return;
            }

            await deleteMeal(id, getDeviceId());
            load();
        } catch (e) {
            console.error("Delete meal failed:", e);
        }
    };

    const onDeleteWorkout = async (id) => {
        try {
            if (!user && isGuestMode()) {
                deleteGuestWorkout(id);
                const today = todayISO();
                setWorkouts(getGuestWorkouts().filter((w) => w?.log_date === today));
                return;
            }
            await deleteWorkout(id, getDeviceId());
            load();
        } catch (e) {
            console.error("Delete workout failed:", e);
        }
    };

    const totals = summary?.totals || {
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    fiber: 0,
};
    const goals = summary?.goals || buildDiaryGoals(profile);

    const remaining = Math.max(0, goals.calories - totals.calories);

    const dateLabel = new Date().toLocaleDateString(lang, {
        weekday: "long", day: "numeric", month: "long",
    });

    return (
        <div className="min-h-screen pb-32 px-5 pt-10">
            <header className="mb-8">
                <div className="text-xs tracking-overline uppercase text-[color:var(--text-secondary)]">
                    {dateLabel}
                </div>
                <h1 className="font-display text-4xl font-semibold leading-none mt-2">
                    {t("diary.greet")}{profile?.name ? `, ${profile.name}` : ""}
                </h1>
                <p className="text-sm text-[color:var(--text-secondary)] mt-3">
                    {remaining > 0 ? t("diary.remaining", { n: Math.round(remaining) }) : t("diary.reached")}
                </p>
            </header>

            <div data-testid="daily-summary" className="glass rounded-3xl p-6 flex flex-col items-center">
                <ProgressRing
                    value={totals.calories}
                    goal={goals.calories}
                    color="var(--action-primary)"
                    trackColor="var(--ring-track)"
                    caption={t("diary.calories_today")}
                />
                <div className="grid grid-cols-2 gap-x-6 gap-y-4 w-full mt-6">
                    <MacroBar testId="macro-protein" label={t("diary.protein")} value={totals.protein} goal={goals.protein} color="var(--macro-protein)" />
                    <MacroBar testId="macro-carbs" label={t("diary.carbs")} value={totals.carbs} goal={goals.carbs} color="var(--macro-carbs)" />
                    <MacroBar testId="macro-fat" label={t("diary.fat")} value={totals.fat} goal={goals.fat} color="var(--macro-fats)" />
                    <MacroBar testId="macro-fiber" label={t("diary.fiber")} value={totals.fiber} goal={goals.fiber} color="var(--macro-fiber)" />
                </div>
            </div>

            <div className="mt-8 flex items-baseline justify-between">
                <h2 className="font-display text-xl">{t("diary.meals_today")}</h2>
                <span className="text-xs text-[color:var(--text-secondary)]">{meals.length} {t("diary.total_suffix")}</span>
            </div>

            {loading && <div className="mt-6 text-center text-sm text-[color:var(--text-secondary)]">{t("common.loading")}</div>}

            {!loading && meals.length === 0 && (
                <div className="mt-6 glass rounded-3xl p-8 text-center">
                    <Utensils size={28} className="mx-auto text-[color:var(--action-primary)] mb-3" />
                    <div className="font-display text-lg">{t("diary.empty")}</div>
                    <div className="text-sm text-[color:var(--text-secondary)] mt-1">{t("diary.empty_hint")}</div>
                </div>
            )}

            <div className="mt-4 space-y-3">
                {meals.map((m) => (
                    <div key={m.id} data-testid={`meal-${m.id}`} className="glass rounded-2xl p-4 flex items-center gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-[color:var(--action-primary)]/15 flex items-center justify-center shrink-0">
                            <Flame size={20} className="text-[color:var(--action-primary)]" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="text-[10px] tracking-overline uppercase text-[color:var(--text-secondary)]">
                                {t(`meal_types.${m.meal_type}`)}
                            </div>
                            <div className="font-medium truncate">{m.dish_name}</div>
                            <div className="text-[11px] text-[color:var(--text-secondary)] mt-0.5">
                                P {Math.round(m.total_protein)}g · C {Math.round(m.total_carbs)}g · F {Math.round(m.total_fat)}g
                            </div>
                        </div>
                        <div className="text-right">
                            <div className="font-display text-lg">{Math.round(m.total_calories)}</div>
                            <div className="text-[10px] text-[color:var(--text-secondary)]">kcal</div>
                        </div>
                        <button
                            data-testid={`delete-meal-${m.id}`}
                            onClick={() => onDelete(m.id)}
                            className="btn-tactile p-2 rounded-full text-[color:var(--text-secondary)] hover:text-[color:var(--macro-protein)]"
                        >
                            <Trash2 size={16} />
                        </button>
                    </div>
                ))}
            </div>

            {/* Today's workouts */}
            <div className="mt-10 flex items-baseline justify-between">
                <h2 className="font-display text-xl">{t("diary.workouts_today")}</h2>
                <span className="text-xs text-[color:var(--text-secondary)]">{workouts.length} {t("diary.total_suffix")}</span>
            </div>

            {!loading && workouts.length === 0 && (
                <div data-testid="workouts-empty" className="mt-6 glass rounded-3xl p-8 text-center">
                    <Dumbbell size={28} className="mx-auto text-[color:#6EA8C7] mb-3" />
                    <div className="font-display text-lg">{t("diary.workouts_empty")}</div>
                    <div className="text-sm text-[color:var(--text-secondary)] mt-1">{t("diary.workouts_empty_hint")}</div>
                </div>
            )}

            <div className="mt-4 space-y-3">
                {workouts.map((w) => (
                    <div key={w.id} data-testid={`diary-workout-${w.id}`} className="glass rounded-2xl p-4 flex items-center gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-[#6EA8C7]/15 flex items-center justify-center shrink-0">
                            <Dumbbell size={20} className="text-[#6EA8C7]" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{w.exercise}</div>
                            <div className="text-[11px] text-[color:var(--text-secondary)] mt-0.5">
                                {w.sets}×{w.reps}{w.weight_kg > 0 ? ` · ${w.weight_kg} kg` : ""}
                            </div>
                        </div>
                        {w.weight_kg > 0 && (
                            <div className="text-right">
                                <div className="font-display text-lg">{w.weight_kg}</div>
                                <div className="text-[10px] text-[color:var(--text-secondary)]">kg</div>
                            </div>
                        )}

                        <button
                            data-testid={`delete-workout-${w.id}`}
                            onClick={() => onDeleteWorkout(w.id)}
                            className="btn-tactile p-2 rounded-full text-[color:var(--text-secondary)] hover:text-[color:var(--macro-protein)]"
>
    <Trash2 size={16} />
</button>

                    </div>
                ))}
            </div>
        </div>
    );
};
