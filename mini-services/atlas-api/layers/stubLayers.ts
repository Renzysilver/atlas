// ATLAS API — layers/stubLayers.ts
// 5 STUB layers + 1 FUTURE layer (spec Section 3)
//
// Each returns insufficient_data (stub) or future (future) with specific
// reasons. The interface is preserved so Phase 2 activation is a swap of
// the class implementation, not an orchestration change.

import type { LayerName } from "@atlas/shared";
import { StubLayer, FutureLayer, type LayerDefinition } from "./base.ts";

// Layer 3 — Tactical Intelligence (🟡 STUB)
export const tacticalIntelligenceLayer = new StubLayer(
  {
    name: "tactical_intelligence" as LayerName,
    layerNumber: 3,
    description: "Formation-based tactical analysis",
    buildStatus: "stub",
    feedsConsensus: true,
  },
  `Tactical Intelligence requires formation data from API-Football. The /fixtures/lineups endpoint
  provides formations, but reliable pre-match formation data may not be available on the free tier.
  Per spec Section 15: do NOT assume — flag for Vali to confirm plan coverage.
  When formation data is confirmed, this layer swaps from StubLayer → real implementation
  computing formation flexibility, pressing intensity, and structural advantages.`,
);

// Layer 5 — Psychology Intelligence (🟡 STUB)
export const psychologyIntelligenceLayer = new StubLayer(
  {
    name: "psychology_intelligence" as LayerName,
    layerNumber: 5,
    description: "Mental edge from news, press conferences, social sentiment",
    buildStatus: "stub",
    feedsConsensus: true,
  },
  `Psychology Intelligence requires news/sentiment data collection (Module 1 collector 'news' is STUB).
  Per spec Section 3: this is the ONE place an LLM could help (news/context reasoning), but only
  once News/Press data collection is active. Until then: insufficient_data.
  Per spec: "An LLM guessing a 'Mental Edge Score' from vibes is not intelligence — it's noise
  with a confident tone." Do NOT activate the LLM call until news data is wired.`,
);

// Layer 6 — Referee Intelligence (🟡 STUB)
export const refereeIntelligenceLayer = new StubLayer(
  {
    name: "referee_intelligence" as LayerName,
    layerNumber: 6,
    description: "Referee historical tendency (cards, fouls awarded)",
    buildStatus: "stub",
    feedsConsensus: true,
  },
  `Referee Intelligence requires referee historical data from API-Football.
  Per spec Section 15: "does the current API-Football plan include referee history?" — flag for Vali.
  When confirmed available, this layer swaps to a real implementation querying /referees or
  /fixtures with referee filter, computing cards-per-game, fouls-awarded tendencies.`,
);

// Layer 7 — Weather Intelligence (🟡 STUB)
export const weatherIntelligenceLayer = new StubLayer(
  {
    name: "weather_intelligence" as LayerName,
    layerNumber: 7,
    description: "Match-day weather forecast at the venue",
    buildStatus: "stub",
    feedsConsensus: true,
  },
  `Weather Intelligence requires a weather API key (WEATHER_API_KEY not configured).
  Per Constitution Rule 4: do NOT fabricate weather conditions.
  When key is provided (e.g. OpenWeatherMap), this layer swaps to a real implementation
  fetching forecast for the match venue, computing impact on play style and scoring.`,
);

// Layer 8 — Market Intelligence (🟡 STUB)
export const marketIntelligenceLayer = new StubLayer(
  {
    name: "market_intelligence" as LayerName,
    layerNumber: 8,
    description: "Betting market odds (pre-match + closing lines)",
    buildStatus: "stub",
    feedsConsensus: true,
  },
  `Market Intelligence requires an odds API key (ODDS_API_KEY not configured).
  CRITICAL per spec Section 11: "do not fake a 'value bet' claim without real market odds
  to compare against; that's the one output that could cause real financial harm if faked."
  When key is provided (e.g. The Odds API), this layer swaps to a real implementation
  fetching pre-match + closing odds, computing implied probabilities and market efficiency.
  Also enables Module 7 Value Score (currently insufficient_data).`,
);

// Layer 11 — Live Match Intelligence (🔴 FUTURE)
export const liveMatchIntelligenceLayer = new FutureLayer(
  {
    name: "live_match_intelligence" as LayerName,
    layerNumber: 11,
    description: "Real-time in-match intelligence (live data feed)",
    buildStatus: "future",
    feedsConsensus: false, // future layers don't feed consensus in Phase 1
  },
  `Live Match Intelligence requires a live data feed subscription (not Phase 1).
  Per spec Section 3: 🔴 FUTURE — requires live data feed subscription.
  This layer is architecturally reserved. When a live feed is available (Phase 2+),
  this layer swaps from FutureLayer → real implementation consuming live events
  (goals, cards, substitutions, momentum shifts) and updating predictions in real-time.`,
);
