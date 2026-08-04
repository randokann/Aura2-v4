import { useState } from "react";
import { Sparkles, ArrowRight, Languages } from "lucide-react";
import { useLang } from "../i18n/LangContext";
import { LANGUAGES } from "../i18n/languages";
import { sectionStyle } from "../lib/sectionColors";

export const OnboardingDialog = ({ onSubmit }) => {
    const { t, lang, setLang } = useLang();
    const [step, setStep] = useState(0);
    const [form, setForm] = useState({
        name: "",
        age: 30,
        sex: "maschio",
        height_cm: 170,
        current_weight_kg: 70,
        target_weight_kg: 68,
        activity_level: "moderato",
        goal: "mantenere",
    });

    const update = (k, v) => setForm((s) => ({ ...s, [k]: v }));
    const next = () => setStep((s) => s + 1);
    const back = () => setStep((s) => Math.max(0, s - 1));

    const steps = [
        {
            title: t("onboarding.lang_title"),
            subtitle: t("onboarding.lang_subtitle"),
            colorSection: "profilo",
            body: (
                <div className="grid grid-cols-2 gap-3 mt-2">
                    {LANGUAGES.map(({ code, name, flag }) => (
                        <button
                            key={code}
                            data-testid={`onb-lang-${code}`}
                            onClick={() => setLang(code)}
                            className={`btn-tactile p-4 rounded-2xl border-2 flex flex-col items-center gap-1.5 ${
                                lang === code
                                    ? "bg-[color:var(--action-primary)] text-[color:var(--bg-default)] border-transparent"
                                    : "bg-[color:var(--bg-elevated)] border-white/5 text-[color:var(--text-primary)]"
                            }`}
                        >
                            <span className="text-2xl">{flag}</span>
                            <span className="font-display text-sm">{name}</span>
                        </button>
                    ))}
                </div>
            ),
        },
        {
            title: t("onboarding.welcome_title"),
            subtitle: t("onboarding.welcome_subtitle"),
            colorSection: "diario",
            body: (
                <div className="space-y-4">
                    <Field label={t("onboarding.name_label")}>
                        <input
                            data-testid="onb-name"
                            value={form.name}
                            onChange={(e) => update("name", e.target.value)}
                            placeholder={t("onboarding.name_ph")}
                            className="w-full bg-[color:var(--bg-elevated)] rounded-2xl px-4 py-3 outline-none focus:ring-2 focus:ring-[color:var(--action-primary)]"
                        />
                    </Field>
                    <Field label={t("onboarding.sex_label")}>
                        <div className="grid grid-cols-2 gap-2">
                            {["maschio", "femmina"].map((s) => (
                                <button
                                    key={s}
                                    data-testid={`onb-sex-${s}`}
                                    onClick={() => update("sex", s)}
                                    className={`btn-tactile py-3 rounded-2xl border ${
                                        form.sex === s
                                            ? "bg-[color:var(--action-primary)] text-[color:var(--bg-default)] border-transparent"
                                            : "bg-[color:var(--bg-elevated)] border-white/5 text-[color:var(--text-primary)]"
                                    }`}
                                >
                                    {t(`sex.${s}`)}
                                </button>
                            ))}
                        </div>
                    </Field>
                    <Field label={t("onboarding.age_label")}>
                        <NumberInput testId="onb-age" value={form.age} onChange={(v) => update("age", v)} suffix={t("onboarding.age_suffix")} min={12} max={110} />
                    </Field>
                </div>
            ),
        },
        {
            title: t("onboarding.body_title"),
            subtitle: t("onboarding.body_subtitle"),
            colorSection: "coach",
            body: (
                <div className="space-y-4">
                    <Field label={t("onboarding.height")}>
                        <NumberInput testId="onb-height" value={form.height_cm} onChange={(v) => update("height_cm", v)} suffix="cm" min={100} max={230} />
                    </Field>
                    <Field label={t("onboarding.cur_weight")}>
                        <NumberInput testId="onb-weight" value={form.current_weight_kg} onChange={(v) => update("current_weight_kg", v)} suffix="kg" min={30} max={250} step={0.5} />
                    </Field>
                    <Field label={t("onboarding.tgt_weight")}>
                        <NumberInput testId="onb-target" value={form.target_weight_kg} onChange={(v) => update("target_weight_kg", v)} suffix="kg" min={30} max={250} step={0.5} />
                    </Field>
                </div>
            ),
        },
        {
            title: t("onboarding.lifestyle_title"),
            subtitle: t("onboarding.lifestyle_subtitle"),
            colorSection: "piani",
            body: (
                <div className="space-y-4">
                    <Field label={t("onboarding.activity_label")}>
                        <div className="flex flex-col gap-2">
                            {["sedentario", "leggero", "moderato", "intenso", "molto_intenso"].map((v) => (
                                <button
                                    key={v}
                                    data-testid={`onb-activity-${v}`}
                                    onClick={() => update("activity_level", v)}
                                    className={`btn-tactile text-left px-4 py-3 rounded-2xl border ${
                                        form.activity_level === v
                                            ? "bg-[color:var(--action-primary)] text-[color:var(--bg-default)] border-transparent"
                                            : "bg-[color:var(--bg-elevated)] border-white/5 text-[color:var(--text-primary)]"
                                    }`}
                                >
                                    <div className="font-medium">{t(`activity.${v}`)}</div>
                                    <div className={`text-xs ${form.activity_level === v ? "opacity-80" : "text-[color:var(--text-secondary)]"}`}>
                                        {t(`activity_desc.${v}`)}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </Field>
                    <Field label={t("onboarding.goal_label")}>
                        <div className="grid grid-cols-3 gap-2">
                            {["dimagrire", "mantenere", "aumentare"].map((g) => (
                                <button
                                    key={g}
                                    data-testid={`onb-goal-${g}`}
                                    onClick={() => update("goal", g)}
                                    className={`btn-tactile py-3 rounded-2xl border text-sm ${
                                        form.goal === g
                                            ? "bg-[color:var(--action-primary)] text-[color:var(--bg-default)] border-transparent"
                                            : "bg-[color:var(--bg-elevated)] border-white/5 text-[color:var(--text-primary)]"
                                    }`}
                                >
                                    {t(`goals.${g}`)}
                                </button>
                            ))}
                        </div>
                    </Field>
                </div>
            ),
        },
    ];

    const current = steps[step];
    const isLast = step === steps.length - 1;

    return (
        <div className="fixed inset-0 z-50 bg-[color:var(--bg-default)] overflow-y-auto" style={sectionStyle(current.colorSection)}>
            <div className="max-w-md mx-auto min-h-screen flex flex-col px-6 pt-10 pb-8">
                <div className="flex items-center gap-2 mb-8">
                    {step === 0 ? (
                        <Languages size={18} className="text-[color:var(--action-primary)]" />
                    ) : (
                        <Sparkles size={18} className="text-[color:var(--action-primary)]" />
                    )}
                </div>

                <h1 className="font-display text-4xl font-semibold leading-none mb-3">{current.title}</h1>
                <p className="text-sm text-[color:var(--text-secondary)] mb-8 leading-relaxed">{current.subtitle}</p>

                <div className="flex-1">{current.body}</div>

                {/* Progress indicator moved to bottom of the step, immediately above action buttons */}
                <ProgressIndicator steps={steps} step={step} />

                <div className="flex gap-3 mt-8">
                    {step > 0 && (
                        <button
                            data-testid="onb-back"
                            onClick={back}
                            className="btn-tactile flex-1 py-4 rounded-full bg-[color:var(--bg-elevated)] text-[color:var(--text-primary)]"
                        >
                            {t("common.back")}
                        </button>
                    )}
                    <button
                        data-testid={isLast ? "onb-finish" : "onb-next"}
                        onClick={() => (isLast ? onSubmit(form) : next())}
                        className="btn-tactile flex-1 py-4 rounded-full bg-[color:var(--action-primary)] text-[color:var(--bg-default)] font-semibold flex items-center justify-center gap-2"
                    >
                        {isLast ? t("common.finish") : t("common.continue")}
                        <ArrowRight size={18} />
                    </button>
                </div>
            </div>
        </div>
    );
};

const ProgressIndicator = ({ steps, step }) => (
    <div className="flex gap-1 mb-8">
        {steps.map((s, i) => (
            <div
                key={s.title}
                className={`h-1 flex-1 rounded-full transition-colors ${
                    i <= step ? "bg-[color:var(--action-primary)]" : "bg-[color:var(--ring-track)]"
                }`}
            />
        ))}
    </div>
);

const Field = ({ label, children }) => (
    <div>
        <label className="block text-[10px] tracking-overline uppercase text-[color:var(--text-secondary)] mb-2">
            {label}
        </label>
        {children}
    </div>
);

const NumberInput = ({ value, onChange, suffix, min, max, step = 1, testId }) => (
    <div className="flex items-center bg-[color:var(--bg-elevated)] rounded-2xl overflow-hidden">
        <button className="px-4 py-3 text-xl text-[color:var(--text-secondary)]" onClick={() => onChange(Math.max(min, Number(value) - step))}>−</button>
        <input
            data-testid={testId}
            type="number"
            value={value}
            step={step}
            min={min}
            max={max}
            onChange={(e) => onChange(Number(e.target.value))}
            className="flex-1 bg-transparent text-center font-display text-2xl outline-none py-3"
        />
        <span className="pr-4 text-sm text-[color:var(--text-secondary)]">{suffix}</span>
        <button className="px-4 py-3 text-xl text-[color:var(--text-secondary)]" onClick={() => onChange(Math.min(max, Number(value) + step))}>+</button>
    </div>
);
