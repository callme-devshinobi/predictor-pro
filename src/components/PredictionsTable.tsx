import { forwardRef } from "react";
import type { Prediction } from "@/server/predictions.functions";

function confidenceColor(p: number) {
  if (p >= 80) return "text-primary";
  if (p >= 70) return "text-[oklch(0.82_0.18_120)]";
  return "text-warning";
}

export const PredictionsTable = forwardRef<
  HTMLDivElement,
  { predictions: Prediction[]; sportLabel: string; threshold: number }
>(function PredictionsTable({ predictions, sportLabel, threshold }, ref) {
  const generatedAt = new Date().toLocaleString();
  return (
    <div ref={ref} className="rounded-2xl border border-border bg-[var(--gradient-card)] p-6 shadow-[var(--shadow-card)]">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-2 border-b border-border pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">
            {sportLabel} — Weekly Picks
          </h2>
          <p className="text-xs text-muted-foreground">
            Showing model-estimated picks at ≥ {threshold}% confidence · Generated {generatedAt}
          </p>
        </div>
        <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
          {predictions.length} {predictions.length === 1 ? "pick" : "picks"}
        </span>
      </header>

      {predictions.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No picks meet the current confidence threshold. Try lowering it.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Match</th>
                <th className="py-2 pr-3 font-medium">Competition</th>
                <th className="py-2 pr-3 font-medium">Date</th>
                <th className="py-2 pr-3 font-medium">Pick</th>
                <th className="py-2 pr-3 font-medium">Market</th>
                <th className="py-2 pr-3 text-right font-medium">Confidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {predictions.map((p, i) => (
                <tr key={i} className="align-top">
                  <td className="py-3 pr-3 font-medium text-foreground">
                    {p.match}
                    <div className="mt-1 max-w-md text-xs font-normal text-muted-foreground">
                      {p.reasoning}
                    </div>
                  </td>
                  <td className="py-3 pr-3 text-muted-foreground">{p.competition}</td>
                  <td className="py-3 pr-3 text-muted-foreground">{p.date}</td>
                  <td className="py-3 pr-3 font-semibold text-foreground">{p.pick}</td>
                  <td className="py-3 pr-3 text-muted-foreground">{p.market}</td>
                  <td className={`py-3 pr-3 text-right font-bold tabular-nums ${confidenceColor(p.probability)}`}>
                    {p.probability}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <footer className="mt-5 border-t border-border pt-3 text-[10px] leading-snug text-muted-foreground">
        <strong className="text-foreground">Disclaimer:</strong> Predictions are AI-generated estimates based on the model's general knowledge —
        not live data — and are for entertainment only. They are not financial or betting advice.
        Outcomes are uncertain. Never wager more than you can afford to lose. 18+.
      </footer>
    </div>
  );
});
