export const ProgressRing = ({
    value = 0,
    goal = 100,
    size = 220,
    stroke = 14,
    color = "#81B29A",
    trackColor = "#2A3631",
    label = "kcal",
    caption = "Calorie",
    children,
}) => {
    const pct = Math.min(1, goal > 0 ? value / goal : 0);
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const offset = c * (1 - pct);

    return (
        <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
            <div
                className="absolute inset-0 rounded-full blur-3xl opacity-20"
                style={{ background: color }}
                aria-hidden
            />
            <svg width={size} height={size} className="rotate-[-90deg]">
                <circle cx={size / 2} cy={size / 2} r={r} stroke={trackColor} strokeWidth={stroke} fill="none" />
                <circle
                    className="ring-progress"
                    cx={size / 2}
                    cy={size / 2}
                    r={r}
                    stroke={color}
                    strokeWidth={stroke}
                    fill="none"
                    strokeLinecap="round"
                    strokeDasharray={c}
                    strokeDashoffset={offset}
                />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                {children ? (
                    children
                ) : (
                    <>
                        <div className="text-xs tracking-overline uppercase text-[color:var(--text-secondary)]">{caption}</div>
                        <div className="font-display text-4xl font-semibold text-[color:var(--text-primary)] mt-1">
                            {Math.round(value)}
                        </div>
                        <div className="text-xs text-[color:var(--text-secondary)] mt-1">
                            / {Math.round(goal)} {label}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export const MacroBar = ({ label, value, goal, color, testId }) => {
    const pct = Math.min(100, goal > 0 ? (value / goal) * 100 : 0);
    return (
        <div data-testid={testId} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between">
                <span className="text-[10px] tracking-overline uppercase text-[color:var(--text-secondary)]">
                    {label}
                </span>
                <span className="font-display text-sm text-[color:var(--text-primary)]">
                    {Math.round(value)}
                    <span className="text-[color:var(--text-secondary)]">/{Math.round(goal)}g</span>
                </span>
            </div>
            <div className="h-1.5 rounded-full bg-[color:var(--ring-track)] overflow-hidden">
                <div
                    className="h-full rounded-full transition-all duration-700 ease-out"
                    style={{ width: `${pct}%`, background: color }}
                />
            </div>
        </div>
    );
};
