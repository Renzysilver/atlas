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
    venue: string;
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
// PHASE 1 LEAGUE CONFIG
// ============================================================

export const EPL_LEAGUE_ID = 39;
export const EPL_SEASON = 2025; // 2025-26 season
