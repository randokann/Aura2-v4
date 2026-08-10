import { useState, useRef, useEffect, useCallback } from "react";
import { toast } from "sonner";
import {
    Loader2, Video, Dumbbell, Battery, Sparkles, Upload, Activity,
    AlertTriangle, CheckCircle2, TrendingUp, Play
} from "lucide-react";
import {
    analyzeExerciseForm, generateProgram, estimateRecovery,
    logWorkout, listWorkouts, getDeviceId, todayISO,
} from "../lib/api";
import { useAuth } from "../auth/AuthProvider";
import { isGuestMode, addGuestWorkout, getGuestWorkouts, deleteGuestWorkout } from "../lib/guestStorage";
import { useLang } from "../i18n/LangContext";

export const CoachPage = () => {
    const { t } = useLang();
    const [section, setSection] = useState("form");

    const SECTIONS = [
        { id: "form", label: t("coach.tab_form"), icon: Video },
        { id: "program", label: t("coach.tab_program"), icon: Dumbbell },
        { id: "recovery", label: t("coach.tab_recovery"), icon: Battery },
        { id: "log", label: t("coach.tab_log"), icon: Activity },
    ];

    return (
        <div className="min-h-screen pb-32 px-5 pt-10">
            <header className="mb-6">
                <div className="flex items-center gap-2 text-xs tracking-overline uppercase text-[color:var(--text-secondary)]">
                    <Dumbbell size={14} /> {t("coach.eyebrow")}
                </div>
                <h1 className="font-display text-4xl font-semibold leading-none mt-2">{t("coach.title")}</h1>
                <p className="text-sm text-[color:var(--text-secondary)] mt-3">{t("coach.subtitle")}</p>
            </header>

            <div className="grid grid-cols-4 gap-2 mb-8">
                {SECTIONS.map(({ id, label, icon: Icon }) => (
                    <button
                        key={id}
                        data-testid={`coach-tab-${id}`}
                        onClick={() => setSection(id)}
                        className={`btn-tactile py-3 rounded-2xl flex flex-col items-center gap-1 text-[10px] font-medium ${
                            section === id ? "bg-[color:var(--action-primary)] text-[color:var(--bg-default)]" : "bg-[color:var(--bg-elevated)]"
                        }`}
                    >
                        <Icon size={16} />
                        {label}
                    </button>
                ))}
            </div>

            {section === "form" && <FormAnalysisSection />}
            {section === "program" && <ProgramSection />}
            {section === "recovery" && <RecoverySection />}
            {section === "log" && <WorkoutLogSection />}
        </div>
    );
};

async function extractVideoFrames(videoFile, count = 6, maxDim = 720) {
    return new Promise((resolve, reject) => {
        const video = document.createElement("video");
        video.preload = "metadata";
        video.muted = true;
        video.playsInline = true;
        video.src = URL.createObjectURL(videoFile);

        video.onloadedmetadata = async () => {
            const duration = video.duration;
            const frames = [];
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");
            let { videoWidth: w, videoHeight: h } = video;
            if (Math.max(w, h) > maxDim) {
                const scale = maxDim / Math.max(w, h);
                w = Math.round(w * scale); h = Math.round(h * scale);
            }
            canvas.width = w; canvas.height = h;

            for (let i = 0; i < count; i++) {
                const t = (duration / (count + 1)) * (i + 1);
                await new Promise((res) => {
                    video.currentTime = t;
                    video.onseeked = () => {
                        ctx.drawImage(video, 0, 0, w, h);
                        const b64 = canvas.toDataURL("image/jpeg", 0.7).split(",")[1];
                        frames.push(b64);
                        res();
                    };
                });
            }
            URL.revokeObjectURL(video.src);
            resolve(frames);
        };
        video.onerror = () => reject(new Error("Video error"));
    });
}

const FormAnalysisSection = () => {
    const { t } = useLang();
    const fileRef = useRef(null);
    const [exercise, setExercise] = useState("Squat");
    const [videoUrl, setVideoUrl] = useState(null);
    const [analyzing, setAnalyzing] = useState(false);
    const [result, setResult] = useState(null);

    const onFile = async (file) => {
        if (!file) return;
        if (!file.type.startsWith("video/")) { toast.error(t("coach.form.not_video")); return; }
        setResult(null);
        setVideoUrl(URL.createObjectURL(file));
        setAnalyzing(true);
        try {
            const frames = await extractVideoFrames(file, 6);
            const res = await analyzeExerciseForm({
                device_id: getDeviceId(),
                exercise_name: exercise,
                frames_base64: frames,
            });
            setResult(res);
            toast.success(t("coach.form.completed", { v: res.verdict }));
        } catch (e) { toast.error(e?.response?.data?.detail || t("coach.form.cant_read")); }
        finally { setAnalyzing(false); }
    };

    return (
        <div className="space-y-5">
            <div>
                <label className="text-[10px] tracking-overline uppercase text-[color:var(--text-secondary)] block mb-2">{t("coach.form.exercise")}</label>
                <input
                    data-testid="form-exercise"
                    value={exercise}
                    onChange={(e) => setExercise(e.target.value)}
                    placeholder={t("coach.form.exercise_ph")}
                    className="w-full bg-[color:var(--bg-elevated)] rounded-2xl px-4 py-3 outline-none focus:ring-2 focus:ring-[color:var(--action-primary)]"
                />
            </div>

            <input ref={fileRef} type="file" accept="video/*" capture="environment" hidden onChange={(e) => onFile(e.target.files?.[0])} />

            {!videoUrl && (
                <div className="relative aspect-[4/5] rounded-3xl border border-dashed border-white/10 bg-[color:var(--bg-surface)] flex flex-col items-center justify-center p-8 grain overflow-hidden">
                    <div className="w-16 h-16 rounded-full bg-[color:var(--action-primary)]/15 flex items-center justify-center mb-4">
                        <Video size={26} className="text-[color:var(--action-primary)]" />
                    </div>
                    <div className="font-display text-xl mb-1">{t("coach.form.empty_title")}</div>
                    <div className="text-sm text-[color:var(--text-secondary)] text-center max-w-[240px]">{t("coach.form.empty_hint")}</div>
                </div>
            )}

            {videoUrl && (
                <div className="relative aspect-[4/5] rounded-3xl overflow-hidden bg-black">
                    <video src={videoUrl} controls className="w-full h-full object-contain" />
                    {analyzing && (
                        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center">
                            <div className="glass rounded-2xl px-5 py-4 flex items-center gap-3 pulse-soft">
                                <Loader2 className="animate-spin text-[color:var(--action-primary)]" size={20} />
                                <div>
                                    <div className="font-medium text-sm">{t("coach.form.analyzing")}</div>
                                    <div className="text-xs text-[color:var(--text-secondary)]">{t("coach.form.analyzing_hint")}</div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            <button
                data-testid="btn-upload-video"
                onClick={() => fileRef.current?.click()}
                disabled={analyzing}
                className="btn-tactile w-full py-4 rounded-full bg-[color:var(--action-primary)] text-[color:var(--bg-default)] font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
            >
                <Upload size={18} /> {videoUrl ? t("coach.form.replace") : t("coach.form.upload")}
            </button>

            {result && (
                <div data-testid="form-result" className="space-y-4 mt-2">
                    <div className="glass rounded-3xl p-6">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <div className="text-[10px] tracking-overline uppercase text-[color:var(--action-primary)] flex items-center gap-1">
                                    <Sparkles size={10} /> {t("coach.form.verdict_label")}
                                </div>
                                <div className="font-display text-2xl mt-1">{result.verdict}</div>
                            </div>
                            <ScoreRing score={result.overall_score} />
                        </div>
                    </div>

                    {result.strengths?.length > 0 && <FeedbackCard icon={<CheckCircle2 size={16} className="text-[color:var(--macro-carbs)]" />} title={t("coach.form.strengths")} items={result.strengths} />}
                    {result.corrections?.length > 0 && <FeedbackCard icon={<TrendingUp size={16} className="text-[color:var(--macro-fats)]" />} title={t("coach.form.corrections")} items={result.corrections} />}
                    {result.risk_areas?.length > 0 && <FeedbackCard icon={<AlertTriangle size={16} className="text-[color:var(--macro-protein)]" />} title={t("coach.form.risks")} items={result.risk_areas} />}
                    {result.cues?.length > 0 && <FeedbackCard icon={<Play size={16} className="text-[color:var(--action-primary)]" />} title={t("coach.form.cues")} items={result.cues} />}
                </div>
            )}
        </div>
    );
};

const ScoreRing = ({ score }) => {
    const size = 72, stroke = 8, r = (size - stroke) / 2, c = 2 * Math.PI * r;
    const offset = c * (1 - score / 100);
    const color = score >= 80 ? "var(--macro-carbs)" : score >= 60 ? "var(--macro-fats)" : "var(--macro-protein)";
    return (
        <div className="relative" style={{ width: size, height: size }}>
            <svg width={size} height={size} className="rotate-[-90deg]">
                <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--ring-track)" strokeWidth={stroke} fill="none" />
                <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none"
                        strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset} className="ring-progress" />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center font-display text-lg">{score}</div>
        </div>
    );
};

const FeedbackCard = ({ icon, title, items }) => (
    <div className="glass rounded-3xl p-5">
        <div className="flex items-center gap-2 mb-3">
            {icon}
            <div className="text-[10px] tracking-overline uppercase text-[color:var(--text-secondary)]">{title}</div>
        </div>
        <ul className="space-y-2">
            {items.map((it, i) => (
                <li key={`${title}-${i}-${it.slice(0, 20)}`} className="text-sm text-[color:var(--text-primary)] flex gap-2 leading-relaxed">
                    <span className="text-[color:var(--action-primary)] shrink-0">·</span>
                    <span>{it}</span>
                </li>
            ))}
        </ul>
    </div>
);

const ProgramSection = () => {
    const { t } = useLang();
    const [goal, setGoal] = useState("ipertrofia");
    const [level, setLevel] = useState("intermedio");
    const [days, setDays] = useState(4);
    const [equipment, setEquipment] = useState("palestra_completa");
    const [plateau, setPlateau] = useState("");
    const [focus, setFocus] = useState("");
    const [loading, setLoading] = useState(false);
    const [program, setProgram] = useState(null);

    const submit = async () => {
        setLoading(true); setProgram(null);
        try {
            const p = await generateProgram({
                device_id: getDeviceId(), goal, level, days_per_week: days, equipment,
                plateau_info: plateau, focus_areas: focus,
            });
            setProgram(p);
            toast.success(t("coach.program.ready"));
        } catch (e) { toast.error(e?.response?.data?.detail || "Error"); }
        finally { setLoading(false); }
    };

    return (
        <div className="space-y-5">
            <PillGroup label={t("coach.program.goal")} value={goal} onChange={setGoal} testId="program-goal"
                options={[["forza","forza"],["ipertrofia","ipertrofia"],["dimagrimento","dimagrimento"],["resistenza","resistenza"],["mobilita","mobilita"]].map(([v]) => [v, t(`program_goals.${v}`)])} />
            <PillGroup label={t("coach.program.level")} value={level} onChange={setLevel} testId="program-level"
                options={["principiante", "intermedio", "avanzato"].map((v) => [v, t(`levels.${v}`)])} />
            <div>
                <label className="text-[10px] tracking-overline uppercase text-[color:var(--text-secondary)] block mb-2">{t("coach.program.days_week")}</label>
                <div className="grid grid-cols-6 gap-2">
                    {[2, 3, 4, 5, 6, 7].map((d) => (
                        <button
                            key={d}
                            data-testid={`program-days-${d}`}
                            onClick={() => setDays(d)}
                            className={`btn-tactile py-2.5 rounded-xl font-medium ${
                                days === d ? "bg-[color:var(--action-primary)] text-[color:var(--bg-default)]" : "bg-[color:var(--bg-elevated)]"
                            }`}
                        >{d}</button>
                    ))}
                </div>
            </div>
            <PillGroup label={t("coach.program.equipment")} value={equipment} onChange={setEquipment} testId="program-equip"
                options={["palestra_completa", "casa_manubri", "corpo_libero", "outdoor"].map((v) => [v, t(`equipment.${v}`)])} />
            <div>
                <label className="text-[10px] tracking-overline uppercase text-[color:var(--text-secondary)] block mb-2">{t("coach.program.focus")}</label>
                <input value={focus} onChange={(e) => setFocus(e.target.value)}
                    placeholder={t("coach.program.focus_ph")}
                    data-testid="program-focus"
                    className="w-full bg-[color:var(--bg-elevated)] rounded-2xl px-4 py-3 outline-none focus:ring-2 focus:ring-[color:var(--action-primary)]" />
            </div>
            <div>
                <label className="text-[10px] tracking-overline uppercase text-[color:var(--text-secondary)] block mb-2">{t("coach.program.plateau")}</label>
                <textarea value={plateau} onChange={(e) => setPlateau(e.target.value)} rows={3}
                    placeholder={t("coach.program.plateau_ph")}
                    data-testid="program-plateau"
                    className="w-full bg-[color:var(--bg-elevated)] rounded-2xl px-4 py-3 outline-none focus:ring-2 focus:ring-[color:var(--action-primary)] resize-none" />
            </div>

            <button
                data-testid="btn-generate-program"
                onClick={submit} disabled={loading}
                className="btn-tactile w-full py-4 rounded-full bg-[color:var(--action-primary)] text-[color:var(--bg-default)] font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
            >
                {loading ? <Loader2 className="animate-spin" size={18} /> : <Dumbbell size={18} />}
                {loading ? t("common.generating") : t("coach.program.generate")}
            </button>

            {program && (
                <div data-testid="generated-program" className="space-y-4 mt-2">
                    <div className="glass rounded-3xl p-5">
                        <div className="text-[10px] tracking-overline uppercase text-[color:var(--action-primary)] flex items-center gap-1">
                            <Sparkles size={10} /> {t("coach.program.weeks", { n: program.weeks })}
                        </div>
                        <h3 className="font-display text-2xl mt-1">{program.title}</h3>
                        {program.summary && <p className="text-sm text-[color:var(--text-secondary)] mt-2">{program.summary}</p>}
                    </div>

                    {program.days.map((d) => (
                        <div key={`program-day-${d.day}`} className="glass rounded-3xl p-5">
                            <div className="text-[10px] tracking-overline uppercase text-[color:var(--text-secondary)]">{t("coach.program.day_label")} {d.day}</div>
                            <div className="font-display text-lg mt-0.5">{d.label}</div>
                            <div className="text-xs text-[color:var(--action-primary)] mt-1">{d.focus}</div>
                            <div className="mt-4 space-y-3">
                                {d.exercises.map((ex, j) => (
                                    <div key={`${d.day}-${ex.name}-${j}`} className="flex items-center justify-between border-b border-white/5 last:border-0 pb-2 last:pb-0">
                                        <div className="flex-1 min-w-0">
                                            <div className="font-medium truncate">{ex.name}</div>
                                            {ex.notes && <div className="text-[10px] text-[color:var(--text-secondary)] truncate">{ex.notes}</div>}
                                        </div>
                                        <div className="text-right shrink-0">
                                            <div className="font-display">{ex.sets}×{ex.reps}</div>
                                            <div className="text-[10px] text-[color:var(--text-secondary)]">{t("coach.program.rest")} {ex.rest_sec}s</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}

                    {program.progression_tips?.length > 0 && (
                        <FeedbackCard icon={<TrendingUp size={16} className="text-[color:var(--macro-carbs)]" />} title={t("coach.program.progression")} items={program.progression_tips} />
                    )}
                </div>
            )}
        </div>
    );
};

const RecoverySection = () => {
    const { t } = useLang();
    const [form, setForm] = useState({
        sleep_hours: 7, sleep_quality: 7, soreness: 3, energy: 7, stress: 4,
        last_workout_intensity: "moderato",
    });
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null);
    const upd = (k, v) => setForm((s) => ({ ...s, [k]: v }));

    const submit = async () => {
        setLoading(true);
        try { setResult(await estimateRecovery({ device_id: getDeviceId(), ...form })); }
        catch (e) { toast.error(e?.response?.data?.detail || "Error"); }
        finally { setLoading(false); }
    };

    return (
        <div className="space-y-5">
            <Slider label={t("coach.recovery.sleep_hours")} value={form.sleep_hours} min={3} max={12} step={0.5} unit="h" onChange={(v) => upd("sleep_hours", v)} testId="rec-sleep-hours" />
            <Slider label={t("coach.recovery.sleep_quality")} value={form.sleep_quality} min={1} max={10} step={1} unit="/10" onChange={(v) => upd("sleep_quality", v)} testId="rec-sleep-quality" />
            <Slider label={t("coach.recovery.soreness")} value={form.soreness} min={0} max={10} step={1} unit="/10" onChange={(v) => upd("soreness", v)} testId="rec-soreness" />
            <Slider label={t("coach.recovery.energy")} value={form.energy} min={1} max={10} step={1} unit="/10" onChange={(v) => upd("energy", v)} testId="rec-energy" />
            <Slider label={t("coach.recovery.stress")} value={form.stress} min={0} max={10} step={1} unit="/10" onChange={(v) => upd("stress", v)} testId="rec-stress" />
            <PillGroup label={t("coach.recovery.last_workout")} value={form.last_workout_intensity} onChange={(v) => upd("last_workout_intensity", v)} testId="rec-intensity"
                options={["nessuno", "leggero", "moderato", "intenso"].map((v) => [v, t(`intensity.${v}`)])} />

            <button
                data-testid="btn-estimate-recovery"
                onClick={submit} disabled={loading}
                className="btn-tactile w-full py-4 rounded-full bg-[color:var(--action-primary)] text-[color:var(--bg-default)] font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
            >
                {loading ? <Loader2 className="animate-spin" size={18} /> : <Battery size={18} />}
                {t("coach.recovery.calculate")}
            </button>

            {result && (
                <div data-testid="recovery-result" className="glass rounded-3xl p-6 space-y-4">
                    <div className="flex items-center gap-5">
                        <ScoreRing score={result.readiness_score} />
                        <div>
                            <div className="text-[10px] tracking-overline uppercase text-[color:var(--text-secondary)]">{t("coach.recovery.status")}</div>
                            <div className="font-display text-xl">{result.status}</div>
                        </div>
                    </div>
                    <div className="pt-4 border-t border-white/5 space-y-3">
                        <div>
                            <div className="text-[10px] tracking-overline uppercase text-[color:var(--action-primary)] mb-1">{t("coach.recovery.recovery")}</div>
                            <p className="text-sm text-[color:var(--text-primary)] leading-relaxed">{result.recommendation}</p>
                        </div>
                        <div>
                            <div className="text-[10px] tracking-overline uppercase text-[color:var(--action-primary)] mb-1">{t("coach.recovery.advice")}</div>
                            <p className="text-sm text-[color:var(--text-primary)] leading-relaxed">{result.workout_advice}</p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const WorkoutLogSection = () => {
    const { t } = useLang();
    const { user } = useAuth();
    const guestMode = !user && isGuestMode();
    const [form, setForm] = useState({ exercise: "", sets: 3, reps: 10, weight_kg: 0, duration_min: 0, notes: "" });
    const [logs, setLogs] = useState([]);
    const [saving, setSaving] = useState(false);
    const upd = (k, v) => setForm((s) => ({ ...s, [k]: v }));

    const load = useCallback(() => {
        if (guestMode) {
            setLogs(getGuestWorkouts());
            return;
        }
        listWorkouts(getDeviceId())
            .then(setLogs)
            .catch((e) => console.error("List workouts failed:", e));
    }, [guestMode]);
    useEffect(() => { load(); }, [load]);

    const submit = async () => {
        if (!form.exercise.trim()) { toast.error(t("coach.log.need_name")); return; }
        setSaving(true);
        try {
            if (guestMode) {
                const workout = addGuestWorkout({ ...form, log_date: todayISO() });
                if (!workout) { toast.error("Error"); return; }
            } else {
                await logWorkout({ device_id: getDeviceId(), ...form, log_date: todayISO() });
            }
            toast.success(t("coach.log.logged"));
            setForm({ exercise: "", sets: 3, reps: 10, weight_kg: 0, duration_min: 0, notes: "" });
            load();
        } catch { toast.error("Error"); }
        finally { setSaving(false); }
    };

    const onDelete = (id) => {
        if (guestMode) {
            deleteGuestWorkout(id);
            load();
            return;
        }
        // Authenticated delete is not exposed in this section's UI currently;
        // kept as a no-op guard for future use.
    };

    const byExercise = {};
    logs.forEach((l) => { byExercise[l.exercise] = byExercise[l.exercise] || []; byExercise[l.exercise].push(l); });
    const plateaus = Object.entries(byExercise)
        .filter(([, arr]) => arr.length >= 3)
        .map(([ex, arr]) => {
            const w = arr.slice(0, 5).map((l) => l.weight_kg);
            return { exercise: ex, plateau: (Math.max(...w) - Math.min(...w)) < 2.5 };
        })
        .filter((p) => p.plateau);

    return (
        <div className="space-y-5">
            <div className="glass rounded-3xl p-5 space-y-4">
                <input value={form.exercise} onChange={(e) => upd("exercise", e.target.value)}
                    placeholder={t("coach.log.exercise_ph")}
                    data-testid="log-exercise"
                    className="w-full bg-[color:var(--bg-elevated)] rounded-2xl px-4 py-3 outline-none focus:ring-2 focus:ring-[color:var(--action-primary)]" />
                <div className="grid grid-cols-3 gap-2">
                    <NumField label={t("coach.log.sets")} value={form.sets} onChange={(v) => upd("sets", v)} testId="log-sets" />
                    <NumField label={t("coach.log.reps")} value={form.reps} onChange={(v) => upd("reps", v)} testId="log-reps" />
                    <NumField label={t("coach.log.weight")} value={form.weight_kg} step={2.5} onChange={(v) => upd("weight_kg", v)} testId="log-weight" />
                </div>
                <button
                    data-testid="btn-log-workout"
                    onClick={submit} disabled={saving}
                    className="btn-tactile w-full py-3 rounded-full bg-[color:var(--action-primary)] text-[color:var(--bg-default)] font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
                >
                    {saving ? <Loader2 className="animate-spin" size={16} /> : <Activity size={16} />}
                    {t("coach.log.record")}
                </button>
            </div>

            {plateaus.length > 0 && (
                <div data-testid="plateau-alert" className="glass rounded-3xl p-5 border border-[color:var(--macro-fats)]/30">
                    <div className="flex items-center gap-2 mb-2">
                        <AlertTriangle size={16} className="text-[color:var(--macro-fats)]" />
                        <div className="text-[10px] tracking-overline uppercase text-[color:var(--macro-fats)]">{t("coach.log.plateau_detected")}</div>
                    </div>
                    <p className="text-sm text-[color:var(--text-primary)]">
                        {t("coach.log.plateau_msg", { ex: plateaus.map((p) => p.exercise).join(", ") })}
                    </p>
                </div>
            )}

            {logs.length === 0 && <div className="text-sm text-[color:var(--text-secondary)] text-center py-8">{t("coach.log.empty")}</div>}

            <div className="space-y-2">
                {logs.slice(0, 20).map((l) => (
                    <div key={l.id} data-testid={`workout-${l.id}`} className="glass rounded-2xl p-4 flex items-center justify-between">
                        <div>
                            <div className="font-medium">{l.exercise}</div>
                            <div className="text-[10px] text-[color:var(--text-secondary)]">{l.log_date}</div>
                        </div>
                        <div className="text-right">
                            <div className="font-display">{l.sets}×{l.reps}</div>
                            {l.weight_kg > 0 && <div className="text-[10px] text-[color:var(--text-secondary)]">{l.weight_kg} kg</div>}
                        </div>
                        {guestMode && (
                            <button
                                data-testid={`delete-coach-workout-${l.id}`}
                                onClick={() => onDelete(l.id)}
                                className="btn-tactile p-2 rounded-full text-[color:var(--text-secondary)] hover:text-[color:var(--macro-protein)] ml-2"
                            >
                                <Dumbbell size={14} className="opacity-50" />
                            </button>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

const PillGroup = ({ label, value, onChange, options, testId }) => (
    <div>
        <label className="text-[10px] tracking-overline uppercase text-[color:var(--text-secondary)] block mb-2">{label}</label>
        <div className="flex flex-wrap gap-2">
            {options.map(([v, l]) => (
                <button
                    key={v}
                    data-testid={`${testId}-${v}`}
                    onClick={() => onChange(v)}
                    className={`btn-tactile px-4 py-2 rounded-full text-xs font-medium ${
                        value === v ? "bg-[color:var(--action-primary)] text-[color:var(--bg-default)]" : "bg-[color:var(--bg-elevated)]"
                    }`}
                >{l}</button>
            ))}
        </div>
    </div>
);

const Slider = ({ label, value, min, max, step, unit, onChange, testId }) => (
    <div>
        <div className="flex items-baseline justify-between mb-2">
            <label className="text-[10px] tracking-overline uppercase text-[color:var(--text-secondary)]">{label}</label>
            <span className="font-display text-lg">{value}<span className="text-xs text-[color:var(--text-secondary)] ml-1">{unit}</span></span>
        </div>
        <input
            type="range" min={min} max={max} step={step} value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            data-testid={testId}
            className="w-full accent-[color:var(--action-primary)]"
        />
    </div>
);

const NumField = ({ label, value, onChange, step = 1, testId }) => (
    <div>
        <label className="block text-[9px] tracking-overline uppercase text-[color:var(--text-secondary)] mb-1">{label}</label>
        <input
            type="number" value={value} step={step}
            onChange={(e) => onChange(Number(e.target.value))}
            data-testid={testId}
            className="w-full bg-[color:var(--bg-elevated)] rounded-xl px-3 py-2 text-center font-display outline-none focus:ring-2 focus:ring-[color:var(--action-primary)]"
        />
    </div>
);
