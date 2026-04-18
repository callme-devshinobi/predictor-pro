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

type Fixture = {
  match: string;
  competition: string;
  date: string;
};

const SPORT_LABEL: Record<Sport, string> = {
  football: "association football (soccer)",
  basketball: "basketball",
  ice_hockey: "ice hockey",
  tennis: "tennis",
};

// TheSportsDB league IDs we want to cover
const LEAGUE_IDS: Record<Sport, number[]> = {
  football: [
    4328, // English Premier League
    4335, // Spanish La Liga
    4332, // Italian Serie A
    4331, // German Bundesliga
    4334, // French Ligue 1
    4480, // UEFA Champions League
    4481, // UEFA Europa League
    5071, // UEFA Conference League
    4337, // Dutch Eredivisie
    4344, // Portuguese Primeira Liga
    4339, // Turkish Super Lig
    4346, // Major League Soccer
    4329, // English Championship
  ],
  basketball: [4387], // NBA
  ice_hockey: [4380], // NHL
  tennis: [], // tennis is per-tournament; handled separately
};

// TheSportsDB free public key — confirmed in their docs
const TSDB_KEY = "123";
const TSDB_BASE = `https://www.thesportsdb.com/api/v1/json/${TSDB_KEY}`;

function nextNDates(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    const x = new Date(d);
    x.setUTCDate(d.getUTCDate() + i);
    out.push(x.toISOString().slice(0, 10));
  }
  return out;
}

async function tsdbGet(path: string): Promise<any> {
  const res = await fetch(`${TSDB_BASE}${path}`);
  if (!res.ok) throw new Error(`TheSportsDB ${path} → ${res.status}`);
  return res.json();
}

async function fetchLeagueNextEvents(leagueId: number): Promise<Fixture[]> {
  try {
    const json = await tsdbGet(`/eventsnextleague.php?id=${leagueId}`);
    const events: any[] = json?.events ?? [];
    return events
      .filter((e) => e.dateEvent && e.strHomeTeam && e.strAwayTeam)
      .map((e) => ({
        match: `${e.strHomeTeam} vs ${e.strAwayTeam}`,
        competition: e.strLeague ?? "",
        date: e.dateEvent,
      }));
  } catch (e) {
    console.error("league fetch failed", leagueId, e);
    return [];
  }
}

async function fetchTennisFixtures(dates: string[]): Promise<Fixture[]> {
  // Tennis: query by day across the Tennis sport
  const tasks = dates.map(async (date) => {
    try {
      const json = await tsdbGet(`/eventsday.php?d=${date}&s=Tennis`);
      const events: any[] = json?.events ?? [];
      return events
        .filter((e) => e.strHomeTeam && e.strAwayTeam)
        .map((e) => ({
          match: `${e.strHomeTeam} vs ${e.strAwayTeam}`,
          competition: e.strLeague ?? "Tennis",
          date,
        }));
    } catch (e) {
      console.error("tennis fetch failed", date, e);
      return [];
    }
  });
  const results = await Promise.all(tasks);
  return results.flat();
}

async function fetchFixtures(sport: Sport): Promise<Fixture[]> {
  const fixtures: Fixture[] = [];
  const horizon = nextNDates(7); // today + next 6 days
  const horizonSet = new Set(horizon);

  if (sport === "tennis") {
    const tennisFx = await fetchTennisFixtures(horizon);
    fixtures.push(...tennisFx);
  } else {
    const leagueIds = LEAGUE_IDS[sport];
    const results = await Promise.all(leagueIds.map((id) => fetchLeagueNextEvents(id)));
    for (const arr of results) {
      for (const f of arr) {
        if (horizonSet.has(f.date)) fixtures.push(f);
      }
    }
  }

  // Dedupe by date+match
  const seen = new Set<string>();
  const unique = fixtures.filter((f) => {
    const k = `${f.date}|${f.match}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // Sort by date ascending
  unique.sort((a, b) => a.date.localeCompare(b.date));

  return unique.slice(0, 120);
}

export const analyzeMatches = createServerFn({ method: "POST" })
  .inputValidator((input: { sport: Sport }) => {
    const allowed: Sport[] = ["football", "basketball", "ice_hockey", "tennis"];
    if (!allowed.includes(input.sport)) throw new Error("Invalid sport");
    return input;
  })
  .handler(async ({ data }) => {
    const aiKey = process.env.LOVABLE_API_KEY;
    if (!aiKey) {
      return { ok: false as const, error: "AI gateway is not configured.", predictions: [] };
    }

    // 1. Fetch real fixtures from TheSportsDB
    let fixtures: Fixture[] = [];
    try {
      fixtures = await fetchFixtures(data.sport);
    } catch (e) {
      console.error("fetchFixtures failed", e);
      return {
        ok: false as const,
        error: "Could not load live fixtures from sports data API.",
        predictions: [],
      };
    }

    if (fixtures.length === 0) {
      return {
        ok: false as const,
        error: `No ${SPORT_LABEL[data.sport]} fixtures found for the next 7 days.`,
        predictions: [],
      };
    }

    // 2. Send fixtures to AI for analysis
    const today = new Date().toISOString().slice(0, 10);
    const sportLabel = SPORT_LABEL[data.sport];

    const fixturesText = fixtures
      .map((f, i) => `${i + 1}. [${f.date}] ${f.match} — ${f.competition}`)
      .join("\n");

    const systemPrompt = `You are a professional ${sportLabel} analyst producing probability-rated betting selections.
You will be given a LIST OF REAL UPCOMING MATCHES scheduled in the next 7 days starting ${today}.
For each match you analyze, you MUST use the exact team/player names and date as provided.
Reason from your knowledge of recent form, injuries, head-to-head, home advantage, surface (tennis), and rest days.
You DO NOT have live news access — be honest in reasoning if recent context is uncertain.

Rules:
- Analyze EVERY match in the list — do not skip any. If the list has 40 matches, return 40 predictions.
- Only skip a match if you genuinely have zero knowledge of either team/player.
- For each, give exactly ONE bet on a common market (Match Winner, Money Line, Over/Under, Handicap, BTTS, Set Winner).
- Probability is YOUR honest model-estimated probability the pick wins (0-100). Be calibrated — most edges are 50-70%; reserve 80%+ for genuinely lopsided matchups.
- Reasoning: 1-2 sentences citing specific factors.
- Return ONLY structured data via the provided tool.`;

    const userPrompt = `Real upcoming ${sportLabel} fixtures:\n\n${fixturesText}\n\nAnalyze the most notable ones and return your picks.`;

    try {
      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${aiKey}`,
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
                          match: { type: "string", description: "Exact match name from the input list" },
                          competition: { type: "string" },
                          date: { type: "string", description: "ISO YYYY-MM-DD from the input list" },
                          market: { type: "string" },
                          pick: { type: "string" },
                          probability: { type: "number", description: "0-100" },
                          reasoning: { type: "string" },
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
        return { ok: false as const, error: "Rate limit reached. Please wait and try again.", predictions: [] };
      }
      if (response.status === 402) {
        return { ok: false as const, error: "AI usage credits exhausted.", predictions: [] };
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
