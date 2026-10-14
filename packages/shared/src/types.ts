// ATLAS — Shared Types
// Used across mini-services/atlas-api and the Next.js dashboard.

export type { LayerOutput, LayerStatus } from "./contract.ts";
export { INSUFFICIENT_DATA, FUTURE_LAYER } from "./contract.ts";
export {
  ALL_LAYER_NAMES,
  SEVENTEEN_LAYERS,
  LAYER_BUILD_STATUS,
  LAYER_WEIGHTS,
  type LayerName,
} from "./layers.ts";

// ============================================================
// COLLECTOR TYPES (Module 1)
// ============================================================

export type CollectorStatus = "active" | "stub" | "future";

export interface CollectorDefinition {
  name: string;
  description: string;
  status: CollectorStatus;
  /** Which intelligence layer this collector feeds (if any). */
  feedsLayer?: string;
  /** Cron schedule (node-cron format). */
  schedule?: string;
  /** Reason for stub/future status — surfaced in dashboard + reports. */
  stubReason?: string;
}

export interface CollectorRunResult {
  collectorName: string;
  status: "success" | "failed" | "insufficient_data";
  recordsIngested: number;
  recordsUpdated: number;
  recordsSkipped: number;
  error?: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

// ============================================================
// API RESPONSE TYPES
// ============================================================

export interface HealthResponse {
  status: "ok" | "degraded" | "down";
  service: string;
  version: string;
  timestamp: string;
  checks: {
    database: "ok" | "fail";
    queue: "ok" | "fail";
    apiFootball: "ok" | "unconfigured" | "fail";
    groq: "ok" | "unconfigured" | "fail";
  };
  uptime: number;
}

export interface CollectorStatusResponse {
  collectors: CollectorDefinition[];
  recentRuns: CollectorRunResult[];
}

export interface DatabaseStatsResponse {
  tables: Array<{
    name: string;
    rowCount: number;
    lastUpdated: string | null;
  }>;
  apiQuota: {
    apiFootball: { used: number; limit: number; resetAt: string | null };
    groq: { used: number; limit: number };
  };
}

// ============================================================
// INGESTION TYPES (raw API-Football → Prisma)
// ============================================================

export interface ApiFootballTeam {
  team: {
    id: number;
    name: string;
    code: string;
    logo: string;
  };
  venue: {
    name: string;
    city: string;
    capacity: number;
  };
}

export interface ApiFootballFixture {
  fixture: {
    id: number;
    date: string; // ISO 8601
    status: { short: string; long: string };
    venue: { id: number; name: string; city: string } | null;
    referee: string | null;
  };
  league: {
    id: number;
    season: number;
    round: string;
  };
  teams: {
    home: { id: number; name: string; winner: boolean | null };
    away: { id: number; name: string; winner: boolean | null };
  };
  goals: { home: number | null; away: number | null };
  score: {
    halftime: { home: number | null; away: number | null };
    fulltime: { home: number | null; away: number | null };
  };
}

export interface ApiFootballStandingRow {
  position: number;
  team: { id: number; name: string };
  points: number;
  played: number;
  win: number;
  draw: number;
  lose: number;
  goals: { for: number; against: number };
  form: string | null;
}

// ============================================================
// MULTI-LEAGUE CONFIG (Phase 1: EPL active, others activatable via env)
// ============================================================

export const EPL_LEAGUE_ID = 39;
export const EPL_SEASON = 2024; // 2025-26 season

// All supported leagues — API-Football league IDs
// Activation: add league ID to ATLAS_ACTIVE_LEAGUES env var (comma-separated)
// Default: EPL only. Example: ATLAS_ACTIVE_LEAGUES=39,2,140,135,78,61
export const SUPPORTED_LEAGUES: LeagueConfig[] = [
  { id: 39,  name: "Premier League",     shortName: "EPL",  country: "England",  season: 2024, active: true  },
  { id: 2,   name: "Champions League",   shortName: "UCL",  country: "Europe",   season: 2024, active: false },
  { id: 3,   name: "Europa League",      shortName: "UEL",  country: "Europe",   season: 2024, active: false },
  { id: 140, name: "La Liga",            shortName: "ESP",  country: "Spain",    season: 2024, active: false },
  { id: 135, name: "Serie A",            shortName: "ITA",  country: "Italy",    season: 2024, active: false },
  { id: 78,  name: "Bundesliga",         shortName: "GER",  country: "Germany",  season: 2024, active: false },
  { id: 61,  name: "Ligue 1",            shortName: "FRA",  country: "France",   season: 2024, active: false },
  { id: 94,  name: "Primeira Liga",      shortName: "POR",  country: "Portugal", season: 2024, active: false },
  { id: 203, name: "Nigerian Prem. League", shortName: "NPFL", country: "Nigeria", season: 2024, active: false },
];

export interface LeagueConfig {
  id: number;
  name: string;
  shortName: string;
  country: string;
  season: number;
  active: boolean;
}

/**
 * Returns active leagues based on ATLAS_ACTIVE_LEAGUES env var.
 * Falls back to EPL only if env var is not set.
 * Usage: getActiveLeagues() → [{ id: 39, name: "Premier League", ... }]
 */
export function getActiveLeagues(): LeagueConfig[] {
  const envLeagues = process.env.ATLAS_ACTIVE_LEAGUES;
  if (!envLeagues) {
    return SUPPORTED_LEAGUES.filter((l) => l.id === EPL_LEAGUE_ID);
  }
  const activeIds = envLeagues
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n));
  return SUPPORTED_LEAGUES.filter((l) => activeIds.includes(l.id));
}
