import { createServerFn } from "@tanstack/react-start";

export type Sport = "football" | "basketball" | "ice_hockey" | "tennis";

export type Prediction = {
  match: string;
  competition: string;
  date: string;
  pick: string;
  market: string;
  probability: number;
  reasoning: string;
};

const SPORT_LABEL: Record<Sport, string> = {
  football: "association football (soccer)",
  basketball: "basketball (NBA / EuroLeague)",
  ice_hockey: "ice hockey (NHL)",
  tennis: "tennis (ATP / WTA)",
};

export const analyzeMatches = createServerFn({ method: "POST" })
  .inputValidator((input: { sport: Sport }) => {
    const allowed: Sport[] = ["football", "basketball", "ice_hockey", "tennis"];
    if (!allowed.includes(input.sport)) throw new Error("Invalid sport");
    return input;
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      return {
        ok: false as const,
        error: "AI gateway is not configured. Please contact the developer.",
        predictions: [],
      };
    }

    const today = new Date().toISOString().slice(0, 10);
    const sportLabel = SPORT_LABEL[data.sport];

    const systemPrompt = `You are a professional sports analyst that produces probability-rated betting selections.
You reason from general knowledge of teams, players, recent form, head-to-head trends, and typical scheduling.
You DO NOT have live internet access — be transparent about this in your reasoning when relevant.
You return ONLY structured data via the provided tool.

Rules:
- Cover the upcoming week (next 7 days) starting from ${today}.
- Provide between 5 and 12 of the most notable upcoming matches you are aware of for the sport.
- For each, give exactly ONE betting pick on a common market (Match Winner, Over/Under, Handicap, Both Teams To Score, Set Winner for tennis, Money Line for hockey/basketball, etc.).
- Probability is YOUR honest model-estimated probability that the pick wins, expressed 0-100.
- Be calibrated — most edges are 50-70%. Reserve 80%+ for genuinely lopsided matchups.
- Reasoning: 1-2 sentences citing the specific factors (form, injuries, H2H, home advantage).
- If you are not confident any matches are happening this week, return an empty array.`;

    const userPrompt = `Analyze the most likely upcoming ${sportLabel} matches for the week starting ${today} and return your top picks.`;

    try {
      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "submit_predictions",
                description: "Submit a list of match predictions",
                parameters: {
                  type: "object",
                  properties: {
                    predictions: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          match: { type: "string", description: "Team A vs Team B (or Player A vs Player B)" },
                          competition: { type: "string", description: "League / tournament name" },
                          date: { type: "string", description: "Approximate match date, ISO YYYY-MM-DD" },
                          market: { type: "string", description: "Betting market e.g. Match Winner, Over 2.5, Money Line" },
                          pick: { type: "string", description: "The selection itself e.g. 'Manchester City', 'Over 2.5', 'Djokovic -1.5 sets'" },
                          probability: {
                            type: "number",
                            description: "Estimated probability the pick wins, 0-100",
                          },
                          reasoning: { type: "string", description: "1-2 sentence justification" },
                        },
                        required: ["match", "competition", "date", "market", "pick", "probability", "reasoning"],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ["predictions"],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: { type: "function", function: { name: "submit_predictions" } },
        }),
      });

      if (response.status === 429) {
        return { ok: false as const, error: "Rate limit reached. Please wait a moment and try again.", predictions: [] };
      }
      if (response.status === 402) {
        return { ok: false as const, error: "AI usage credits exhausted. Add credits in Settings → Workspace → Usage.", predictions: [] };
      }
      if (!response.ok) {
        const text = await response.text();
        console.error("AI gateway error", response.status, text);
        return { ok: false as const, error: `AI gateway error (${response.status}).`, predictions: [] };
      }

      const json = await response.json();
      const toolCall = json?.choices?.[0]?.message?.tool_calls?.[0];
      if (!toolCall?.function?.arguments) {
        return { ok: false as const, error: "AI returned no structured data.", predictions: [] };
      }

      const parsed = JSON.parse(toolCall.function.arguments) as { predictions: Prediction[] };
      const cleaned = (parsed.predictions ?? [])
        .filter((p) => typeof p.probability === "number")
        .map((p) => ({ ...p, probability: Math.max(0, Math.min(100, Math.round(p.probability))) }));

      return { ok: true as const, error: null, predictions: cleaned };
    } catch (e) {
      console.error("analyzeMatches failed", e);
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : "Unknown error",
        predictions: [],
      };
    }
  });
