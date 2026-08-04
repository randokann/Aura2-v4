import React from "react";
import { Sparkles } from "lucide-react";

const ClarificationModal = ({ open, clarification, onSelect, loading, selectedOption }) => {
    if (!open || !clarification) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-5">
            {/* Background blur */}
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

            {/* Modal */}
            <div className="relative w-full max-w-sm rounded-3xl bg-[color:var(--bg-elevated)] p-6 shadow-2xl border border-white/10 animate-in fade-in zoom-in duration-200">

                <div className="flex flex-col items-center text-center">

                    <div className="w-12 h-12 rounded-full bg-[color:var(--action-primary)]/20 flex items-center justify-center mb-4">
                        <Sparkles 
                            size={24}
                            className="text-[color:var(--action-primary)]"
                        />
                    </div>

                    <h2 className="font-display text-xl text-[color:var(--text-primary)]">
                        One more detail
                    </h2>

                    <p className="mt-3 text-sm text-[color:var(--text-secondary)] leading-relaxed">
                        {clarification.question}
                    </p>

                    <div className="w-full mt-6 space-y-3">
    {clarification.options.map((option, index) => {
        const isSelected = selectedOption === option;

        return (
            <button
                key={index}
                disabled={loading}
                onClick={() => onSelect(option)}
                className={`
                    w-full
                    rounded-full
                    py-3.5
                    px-5
                    text-sm
                    font-medium
                    border
                    transition-all
                    duration-200

                    ${
                        loading
                            ? isSelected
                                ? "bg-[color:var(--action-primary)] text-[color:var(--bg-default)] border-[color:var(--action-primary)]"
                                : "bg-[color:var(--bg-default)] text-[color:var(--text-secondary)] border-white/10 opacity-35"
                            : "bg-[color:var(--bg-default)] text-[color:var(--text-primary)] border-white/10 hover:border-[color:var(--action-primary)] active:scale-95"
                    }
                `}
            >
                {isSelected ? (
                    <span className="flex items-center justify-center gap-2">
                        <Sparkles
                            size={16}
                            className={loading ? "animate-pulse" : ""}
                        />
                        {option}
                    </span>
                ) : (
                    option
                )}
            </button>
        );
    })}

    {loading && (
        <div className="pt-5 text-center animate-in fade-in duration-300">
            <div className="flex items-center justify-center gap-2 text-[color:var(--action-primary)]">
                <Sparkles
                    size={18}
                    className="animate-pulse"
                />
                <span className="font-medium">
                    Sto migliorando l'accuratezza della stima...
                </span>
            </div>

            <p className="mt-2 text-sm text-[color:var(--text-secondary)]">
                Questo richiede solo pochi secondi.
            </p>
        </div>
    )}
</div>

                </div>

            </div>
        </div>
    );
};

export default ClarificationModal;
