import type { Sport } from "@/server/predictions.functions";

const SPORTS: { id: Sport; label: string; icon: string }[] = [
  { id: "football", label: "Football", icon: "⚽" },
  { id: "basketball", label: "Basketball", icon: "🏀" },
  { id: "ice_hockey", label: "Ice Hockey", icon: "🏒" },
  { id: "tennis", label: "Tennis", icon: "🎾" },
];

export function SportPicker({
  value,
  onChange,
  disabled,
}: {
  value: Sport;
  onChange: (s: Sport) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {SPORTS.map((s) => {
        const active = s.id === value;
        return (
          <button
            key={s.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(s.id)}
            className={[
              "group relative flex flex-col items-center gap-2 rounded-xl border px-4 py-5 text-sm font-medium transition-all",
              "disabled:cursor-not-allowed disabled:opacity-50",
              active
                ? "border-primary bg-primary/10 text-foreground shadow-[var(--shadow-glow)]"
                : "border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground",
            ].join(" ")}
          >
            <span className="text-3xl" aria-hidden>{s.icon}</span>
            <span>{s.label}</span>
          </button>
        );
      })}
    </div>
  );
}
