// ATLAS API — collectors/registry.ts
// The single source of truth for "which collectors exist in ATLAS".
// Per Constitution Rule 1: all 12 collectors are PERMANENT. Even when
// stubbed, they exist here so the dashboard can show them.

import type { CollectorDefinition } from "@atlas/shared";

import { FixturesCollector } from "./fixtures.ts";
import { TeamStatsCollector } from "./teamStats.ts";
import { PlayerStatsCollector } from "./playerStats.ts";
import { LineupsCollector } from "./lineups.ts";
import { InjuriesCollector } from "./injuries.ts";
import { StandingsCollector } from "./standings.ts";
import { HeadToHeadCollector } from "./h2h.ts";
import { WeatherCollector } from "./weather.ts";
import { OddsCollector } from "./odds.ts";
import { NewsCollector } from "./news.ts";
import { RefereesCollector } from "./referees.ts";
import { StadiumCollector } from "./stadium.ts";
import type { BaseCollector } from "./base.ts";

interface RegistryEntry {
  definition: CollectorDefinition;
  factory: () => BaseCollector;
}

// Definitions — kept here so they're discoverable in one place.
// Definitions match the ATLAS spec page 10 (Module 1 source list).
const DEFS: CollectorDefinition[] = [
  // --- 🟢 ACTIVE collectors (API-Football EPL coverage) ---
  {
    name: "fixtures",
    description: "EPL fixtures & results for the active season",
    status: "active",
    feedsLayer: "historical_intelligence",
    schedule: process.env.COLLECTOR_FIXTURES_CRON || "0 */6 * * *",
  },
  {
    name: "team_stats",
    description: "Team season statistics (form, goals, possession, cards)",
    status: "active",
    feedsLayer: "team_intelligence",
    schedule: process.env.COLLECTOR_DAILY_CRON || "0 4 * * *",
  },
  {
    name: "player_stats",
    description: "Player season statistics (appearances, goals, rating)",
    status: "active",
    feedsLayer: "player_intelligence",
    schedule: process.env.COLLECTOR_DAILY_CRON || "0 4 * * *",
  },
  {
    name: "lineups",
    description: "Match lineups (published ~1hr pre-match)",
    status: "active",
    feedsLayer: "tactical_intelligence",
    schedule: process.env.COLLECTOR_LINEUPS_CRON || "*/10 * * * *",
  },
  {
    name: "injuries",
    description: "Active injuries & suspensions per team",
    status: "active",
    feedsLayer: "injury_intelligence",
    schedule: process.env.COLLECTOR_DAILY_CRON || "0 4 * * *",
  },
  {
    name: "standings",
    description: "EPL league standings (position, points, form)",
    status: "active",
    feedsLayer: "team_intelligence",
    schedule: process.env.COLLECTOR_DAILY_CRON || "0 4 * * *",
  },
  {
    name: "head_to_head",
    description: "Head-to-head history between upcoming fixture teams",
    status: "active",
    feedsLayer: "historical_intelligence",
    schedule: process.env.COLLECTOR_FIXTURES_CRON || "0 */6 * * *",
  },
  // --- 🟡 STUB collectors (interface only — no data source configured) ---
  {
    name: "weather",
    description: "Match-day weather forecast at the venue",
    status: "stub",
    feedsLayer: "weather_intelligence",
    stubReason: "No WEATHER_API_KEY configured. Module 4 Layer 7 returns insufficient_data.",
  },
  {
    name: "odds",
    description: "Betting market odds (pre-match + closing lines)",
    status: "stub",
    feedsLayer: "market_intelligence",
    stubReason: "No ODDS_API_KEY configured. Module 4 Layer 8 + Module 7 Value Score return insufficient_data.",
  },
  {
    name: "news",
    description: "Press conferences, social sentiment, team news",
    status: "stub",
    feedsLayer: "psychology_intelligence",
    stubReason: "No news/sentiment data source configured. Module 4 Layer 5 (Psychology) returns insufficient_data until News collection is activated.",
  },
  {
    name: "referees",
    description: "Referee historical tendency (cards per game, fouls awarded)",
    status: "stub",
    feedsLayer: "referee_intelligence",
    stubReason: "API-Football referee history endpoint availability unconfirmed on free tier. Flagged per Section 15: do not assume — ask Vali to confirm plan coverage.",
  },
  {
    name: "stadium",
    description: "Venue details (pitch dimensions, surface, capacity, altitude)",
    status: "stub",
    feedsLayer: "tactical_intelligence",
    stubReason: "Stadium detail fields partially covered by teams table. Granular venue API not yet wired.",
  },
];

const FACTORY_MAP: Record<string, () => BaseCollector> = {
  fixtures: () => new FixturesCollector(),
  team_stats: () => new TeamStatsCollector(),
  player_stats: () => new PlayerStatsCollector(),
  lineups: () => new LineupsCollector(),
  injuries: () => new InjuriesCollector(),
  standings: () => new StandingsCollector(),
  head_to_head: () => new HeadToHeadCollector(),
  weather: () => new WeatherCollector(),
  odds: () => new OddsCollector(),
  news: () => new NewsCollector(),
  referees: () => new RefereesCollector(),
  stadium: () => new StadiumCollector(),
};

import { StubCollector } from "./base.ts";

class Registry {
  private entries: RegistryEntry[];

  constructor() {
    this.entries = DEFS.map((def) => ({
      definition: def,
      factory: FACTORY_MAP[def.name] ?? (() => new StubCollector(def)),
    }));
  }

  list(): CollectorDefinition[] {
    return this.entries.map((e) => e.definition);
  }

  get(name: string): BaseCollector | null {
    const entry = this.entries.find((e) => e.definition.name === name);
    if (!entry) return null;
    return entry.factory();
  }

  getDefinition(name: string): CollectorDefinition | null {
    return this.entries.find((e) => e.definition.name === name)?.definition ?? null;
  }

  /** Returns active collectors only (status === "active"). */
  active(): CollectorDefinition[] {
    return this.entries.filter((e) => e.definition.status === "active").map((e) => e.definition);
  }

  /** Returns stub collectors only. */
  stubs(): CollectorDefinition[] {
    return this.entries.filter((e) => e.definition.status === "stub").map((e) => e.definition);
  }
}

export const collectorRegistry = new Registry();
