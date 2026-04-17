import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { toPng } from "html-to-image";
import { SportPicker } from "@/components/SportPicker";
import { PredictionsTable } from "@/components/PredictionsTable";
import { analyzeMatches, type Prediction, type Sport } from "@/server/predictions.functions";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "AI Sports Picks — Weekly Predictions" },
      {
        name: "description",
        content:
          "AI-powered betting selections with calibrated confidence ratings for football, basketball, ice hockey and tennis. Download picks as an image.",
      },
    ],
  }),
});

const SPORT_LABEL: Record<Sport, string> = {
  football: "Football",
  basketball: "Basketball",
  ice_hockey: "Ice Hockey",
  tennis: "Tennis",
};

function Index() {
  const [sport, setSport] = useState<Sport>("football");
  const [threshold, setThreshold] = useState(65);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [predictions, setPredictions] = useState<Prediction[] | null>(null);
  const [downloading, setDownloading] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);

  const filtered = (predictions ?? []).filter((p) => p.probability >= threshold);

  async function handleAnalyze() {
    setLoading(true);
    setError(null);
    setPredictions(null);
    try {
      const res = await analyzeMatches({ data: { sport } });
      if (!res.ok) {
        setError(res.error);
      } else {
        setPredictions(res.predictions);
        if (res.predictions.length === 0) {
          setError("The AI returned no matches. Try another sport.");
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to analyze");
    } finally {
      setLoading(false);
    }
  }

  async function handleDownload() {
    if (!tableRef.current) return;
    setDownloading(true);
    try {
      const dataUrl = await toPng(tableRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: "oklch(0.16 0.025 250)",
      });
      const link = document.createElement("a");
      link.download = `ai-picks-${sport}-${new Date().toISOString().slice(0, 10)}.png`;
      link.href = dataUrl;
      link.click();
    } catch (e) {
      console.error(e);
      setError("Could not generate image.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <main className="min-h-screen bg-background">
      <div
        className="border-b border-border"
        style={{ background: "var(--gradient-hero)" }}
      >
        <div className="mx-auto max-w-5xl px-6 py-12 sm:py-16">
          <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary">
            <span className="size-1.5 rounded-full bg-primary animate-pulse" />
            AI Sports Analyst
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-5xl">
            Weekly betting picks,{" "}
            <span className="bg-clip-text text-transparent" style={{ backgroundImage: "var(--gradient-primary)" }}>
              probability-rated
            </span>
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-muted-foreground sm:text-base">
            Select a sport and let the model surface its highest-confidence selections for the week.
            Download the table as an image to share or save.
          </p>
        </div>
      </div>

      <section className="mx-auto max-w-5xl px-6 py-8">
        <div className="rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-card)]">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            1. Pick a sport
          </h2>
          <SportPicker value={sport} onChange={setSport} disabled={loading} />

          <div className="mt-6 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <label className="mb-2 block text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                2. Min. confidence: <span className="text-primary">{threshold}%</span>
              </label>
              <input
                type="range"
                min={50}
                max={95}
                step={5}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                disabled={loading}
                className="w-full accent-[oklch(0.78_0.20_145)]"
              />
            </div>
            <button
              type="button"
              onClick={handleAnalyze}
              disabled={loading}
              className="inline-flex items-center justify-center rounded-xl px-6 py-3 text-sm font-bold text-primary-foreground shadow-[var(--shadow-glow)] transition-transform hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-60"
              style={{ backgroundImage: "var(--gradient-primary)" }}
            >
              {loading ? "Analyzing matches…" : "Analyze this week"}
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-6 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
            {error}
          </div>
        )}

        {loading && (
          <div className="mt-6 rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
            <div className="mx-auto mb-3 size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            Crunching form, H2H, and recent context…
          </div>
        )}

        {predictions && predictions.length > 0 && (
          <div className="mt-8 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {filtered.length} of {predictions.length} picks above {threshold}% confidence
              </p>
              <button
                type="button"
                onClick={handleDownload}
                disabled={downloading || filtered.length === 0}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-secondary px-4 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50"
              >
                {downloading ? "Generating…" : "↓ Download as PNG"}
              </button>
            </div>
            <PredictionsTable
              ref={tableRef}
              predictions={filtered}
              sportLabel={SPORT_LABEL[sport]}
              threshold={threshold}
            />
          </div>
        )}

        <p className="mt-8 text-center text-xs text-muted-foreground">
          Predictions are AI estimates from the model's training knowledge — not live data feeds.
          For entertainment only. 18+. Please gamble responsibly.
        </p>
      </section>
    </main>
  );
}
