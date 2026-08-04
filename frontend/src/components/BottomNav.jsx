import { BookOpen, Camera, User, ChefHat, Dumbbell } from "lucide-react";
import { SECTION_COLORS } from "../lib/sectionColors";
import { useLang } from "../i18n/LangContext";

export const BottomNav = ({ active, onChange }) => {
    const { t } = useLang();
    const items = [
        { id: "diario", icon: BookOpen },
        { id: "piani", icon: ChefHat },
        { id: "fotocamera", icon: Camera },
        { id: "coach", icon: Dumbbell },
        { id: "profilo", icon: User },
    ];

    return (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[min(94%,28rem)]">
            <div
                data-testid="bottom-nav"
                className="glass-strong rounded-full px-2 py-2 flex items-center justify-between shadow-2xl"
            >
                {items.map(({ id, icon: Icon }) => {
                    const isActive = active === id;
                    const isCenter = id === "fotocamera";
                    const color = SECTION_COLORS[id].primary;
                    return (
                        <button
                            key={id}
                            data-testid={`nav-${id}`}
                            onClick={() => onChange(id)}
                            style={isActive ? { background: color, color: "#121A16" } : { color: isCenter ? color : undefined }}
                            className={`btn-tactile flex flex-col items-center justify-center rounded-full px-2.5 py-2 min-w-[52px] ${
                                isActive ? "" : "text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]"
                            }`}
                        >
                            <Icon size={isCenter ? 22 : 18} strokeWidth={isActive ? 2.4 : 1.8} />
                            <span className="text-[9px] mt-0.5 tracking-overline uppercase font-medium">
                                {t(`nav.${id}`)}
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};
