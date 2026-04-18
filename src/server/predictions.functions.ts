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
  date: string; // ISO YYYY-MM-DD
  extra?: string; // e.g. surface for tennis, venue
};

const HOSTS: Record<Sport, string> = {
  football: "v3.football.api-sports.io",
  basketball: "v1.basketball.api-sports.io",
  ice_hockey: "v1.hockey.api-sports.io",
  tennis: "v1.tennis.api-sports.io",
};

// Top football leagues we care about (api-sports league IDs)
const FOOTBALL_LEAGUE_IDS = [
  39,  // Premier League (England)
  140, // La Liga (Spain)
  135, // Serie A (Italy)
  78,  // Bundesliga (Germany)
  61,  // Ligue 1 (France)
  2,   // UEFA Champions League
  3,   // UEFA Europa League
  848, // UEFA Conference League
  45,  // FA Cup
  143, // Copa del Rey
  137, // Coppa Italia
  81,  // DFB Pokal
  88,  // Eredivisie
  94,  // Primeira Liga
  203, // Süper Lig
];

// Major basketball leagues — NBA + EuroLeague
const BASKETBALL_LEAGUE_IDS = [12, 120]; // 12 = NBA, 120 = EuroLeague
const HOCKEY_LEAGUE_IDS = [57]; // 57 = NHL

const SPORT_LABEL: Record<Sport, string> = {
  football: "association football (soccer)",
  basketball: "basketball",
  ice_hockey: "ice hockey",
  tennis: "tennis",
};

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

async function apiSportsGet(host: string, path: string, apiKey: string) {
  const res = await fetch(`https://${host}${path}`, {
    headers: {
      "x-rapidapi-key": apiKey,
      "x-rapidapi-host": host,
    },
  });
  if (!res.ok) {
    throw new Error(`API-Sports ${host}${path} → ${res.status}`);
  }
  return res.json();
}

async function fetchFixtures(sport: Sport, apiKey: string): Promise<Fixture[]> {
  const host = HOSTS[sport];
  const dates = nextNDates(7);
  const fixtures: Fixture[] = [];

  if (sport === "football") {
    const tasks: Promise<void>[] = [];
    for (const date of dates) {
      for (const leagueId of FOOTBALL_LEAGUE_IDS) {
        tasks.push(
          (async () => {
            try {
              const season = new Date().getUTCFullYear();
              const json = await apiSportsGet(
                host,
                `/fixtures?date=${date}&league=${leagueId}&season=${season}`,
                apiKey,
              );
              for (const f of json.response ?? []) {
                fixtures.push({
                  match: `${f.teams?.home?.name} vs ${f.teams?.away?.name}`,
                  competition: `${f.league?.name}${f.league?.country ? ` (${f.league.country})` : ""}`,
                  date,
                });
              }
            } catch (e) {
              console.error("football fetch failed", date, leagueId, e);
            }
          })(),
        );
      }
    }
    await Promise.all(tasks);
  } else if (sport === "basketball" || sport === "ice_hockey") {
    const leagueIds = sport === "basketball" ? BASKETBALL_LEAGUE_IDS : HOCKEY_LEAGUE_IDS;
    const tasks: Promise<void>[] = [];
    for (const date of dates) {
      for (const leagueId of leagueIds) {
        tasks.push(
          (async () => {
            try {
              const y = new Date().getUTCFullYear();
              const season = `${y - 1}-${y}`;
              const json = await apiSportsGet(
                host,
                `/games?date=${date}&league=${leagueId}&season=${season}`,
                apiKey,
              );
              for (const g of json.response ?? []) {
                fixtures.push({
                  match: `${g.teams?.home?.name} vs ${g.teams?.away?.name}`,
                  competition: `${g.league?.name}${g.country?.name ? ` (${g.country.name})` : ""}`,
                  date,
                });
              }
            } catch (e) {
              console.error(`${sport} fetch failed`, date, leagueId, e);
            }
          })(),
        );
      }
    }
    await Promise.all(tasks);
  } else if (sport === "tennis") {
    for (const date of dates) {
      try {
        const json = await apiSportsGet(host, `/games?date=${date}`, apiKey);
        for (const g of json.response ?? []) {
          const home = g.teams?.home?.name ?? g.players?.home?.name;
          const away = g.teams?.away?.name ?? g.players?.away?.name;
          if (!home || !away) continue;
          fixtures.push({
            match: `${home} vs ${away}`,
            competition: `${g.league?.name ?? "ATP/WTA"}${g.league?.type ? ` · ${g.league.type}` : ""}`,
            date,
          });
        }
      } catch (e) {
        console.error("tennis fetch failed", date, e);
      }
    }
  }

  // Dedupe by match+date
  const seen = new Set<string>();
  const unique = fixtures.filter((f) => {
    const k = `${f.date}|${f.match}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

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
    const sportsKey = process.env.API_SPORTS_KEY;

    if (!aiKey) {
      return { ok: false as const, error: "AI gateway is not configured.", predictions: [] };
    }
    if (!sportsKey) {
      return { ok: false as const, error: "Sports data API key is not configured.", predictions: [] };
    }

    // 1. Fetch real fixtures
    let fixtures: Fixture[] = [];
    try {
      fixtures = await fetchFixtures(data.sport, sportsKey);
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
- Pick the 8-15 most interesting matches from the list (skip unknown lower-tier matches).
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
