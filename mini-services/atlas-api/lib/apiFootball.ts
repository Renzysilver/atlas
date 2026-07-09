// ATLAS API — lib/apiFootball.ts
// API-Football v3 client with free-tier rate limiting + caching.
//
// FREE TIER CONSTRAINT (per user's selection):
//   - 100 requests/day hard limit
//   - Some endpoints (injuries, referee history, lineups pre-match) may be
//     restricted. We probe availability at first call; if endpoint returns
//     403, we mark it unavailable and persist that in ApiQuotaUsage.
//
// ARCHITECTURE:
//   - All HTTP goes through this single module (so quota tracking is central)
//   - In-process response cache keyed by URL (24h TTL for static endpoints,
//     10min for lineups, 6h for fixtures/standings)
//   - Daily quota counter persisted in ApiQuotaUsage table (DB-tracked so a
//     process restart does not lose count)
//   - On quota exhaustion, future requests short-circuit to { status:
//     insufficient_data } via the collector — no exceptions, no fabrications.

import { logger } from "./logger.ts";
import { db } from "./db.ts";

const BASE_URL = process.env.API_FOOTBALL_BASE_URL || "https://v3.football.api-sports.io";
const API_HOST = process.env.API_FOOTBALL_HOST || "v3.football.api-sports.io";
const API_KEY = process.env.API_FOOTBALL_KEY;
const DAILY_LIMIT = parseInt(process.env.API_FOOTBALL_DAILY_LIMIT || "100", 10);

// In-process response cache (dev sandbox: no Redis-backed cache needed
// for this volume; production can swap to Redis cache later).
interface CacheEntry {
  data: unknown;
  expiresAt: number;
}
const responseCache = new Map<string, CacheEntry>();

const TTL_PRESETS = {
  fixtures: 6 * 60 * 60 * 1000,         // 6h
  standings: 12 * 60 * 60 * 1000,        // 12h
  teams: 7 * 24 * 60 * 60 * 1000,        // 7d (stable)
  players: 24 * 60 * 60 * 1000,          // 24h
  lineups: 10 * 60 * 1000,               // 10min (refresh near kickoff)
  injuries: 60 * 60 * 1000,              // 1h
  h2h: 24 * 60 * 60 * 1000,              // 24h
  referee: 7 * 24 * 60 * 60 * 1000,      // 7d
} as const;

export type ApiFootballEndpoint = keyof typeof TTL_PRESETS;

// Persist which endpoints are unavailable on this plan (free tier may
// gate injuries, referee history, etc.). Cached in DB.
const unavailableEndpoints = new Set<string>();
let unavailableEndpointsLoaded = false;

async function loadUnavailableEndpoints(): Promise<void> {
  if (unavailableEndpointsLoaded) return;
  try {
    const rows = await db.apiQuotaUsage.findMany({
      where: { service: "api-football", quotaLimit: -1 }, // -1 = marked unavailable
    });
    rows.forEach((r) => {
      if (r.endpoint) unavailableEndpoints.add(r.endpoint);
    });
    unavailableEndpointsLoaded = true;
  } catch (err) {
    logger.warn("failed to load unavailable endpoints list", {
      error: err instanceof Error ? err.message : String(err),
    });
    unavailableEndpointsLoaded = true; // don't keep retrying
  }
}

async function markEndpointUnavailable(endpoint: string, reason: string): Promise<void> {
  unavailableEndpoints.add(endpoint);
  try {
    await db.apiQuotaUsage.upsert({
      where: { service_endpoint: { service: "api-football", endpoint } },
      create: {
        service: "api-football",
        endpoint,
        quotaLimit: -1, // sentinel: endpoint unavailable on this plan
        lastResetAt: new Date(),
      },
      update: {
        quotaLimit: -1,
        lastResetAt: new Date(),
      },
    });
    logger.warn("API-Football endpoint marked unavailable on current plan", {
      endpoint,
      reason,
    });
  } catch (err) {
    logger.error("failed to persist endpoint unavailability", {
      endpoint,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function isEndpointAvailable(endpoint: string): Promise<boolean> {
  await loadUnavailableEndpoints();
  return !unavailableEndpoints.has(endpoint);
}

// ============================================================
// Quota tracking
// ============================================================

async function getQuotaCounter(): Promise<{ count: number; lastResetAt: Date }> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0); // midnight UTC = daily reset boundary

  const row = await db.apiQuotaUsage.upsert({
    where: { service_endpoint: { service: "api-football", endpoint: "_global" } },
    create: {
      service: "api-football",
      endpoint: "_global",
      dailyCount: 0,
      quotaLimit: DAILY_LIMIT,
      lastResetAt: today,
    },
    update: {},
  });

  // If last reset was before today, reset the counter
  if (row.lastResetAt < today) {
    const updated = await db.apiQuotaUsage.update({
      where: { id: row.id },
      data: { dailyCount: 0, lastResetAt: today },
    });
    return { count: 0, lastResetAt: updated.lastResetAt };
  }
  return { count: row.dailyCount, lastResetAt: row.lastResetAt };
}

async function incrementQuota(): Promise<number> {
  const { count } = await getQuotaCounter();
  const newCount = count + 1;
  await db.apiQuotaUsage.update({
    where: { service_endpoint: { service: "api-football", endpoint: "_global" } },
    data: { dailyCount: newCount },
  });
  return newCount;
}

export async function getQuotaStatus(): Promise<{
  used: number;
  limit: number;
  remaining: number;
  resetsAt: Date;
}> {
  const { count, lastResetAt } = await getQuotaCounter();
  const resetsAt = new Date(lastResetAt.getTime() + 24 * 60 * 60 * 1000);
  return {
    used: count,
    limit: DAILY_LIMIT,
    remaining: Math.max(0, DAILY_LIMIT - count),
    resetsAt,
  };
}

// ============================================================
// HTTP fetch with quota enforcement + caching
// ============================================================

export interface ApiFootballRequest {
  endpoint: ApiFootballEndpoint; // for TTL preset + unavailability tracking
  path: string;                  // e.g. "/fixtures?league=39&season=2025"
  /** Override cache TTL (ms). Defaults to preset for `endpoint`. */
  ttlMs?: number;
  /** Bypass cache (force fresh fetch — still counts against quota). */
  bypassCache?: boolean;
}

export interface ApiFootballResponse<T = unknown> {
  ok: boolean;
  status: "success" | "quota_exhausted" | "endpoint_unavailable" | "http_error" | "unconfigured";
  data: T | null;
  error?: string;
  /** How many requests have been used today after this call (null if no call made). */
  quotaUsedAfter?: number;
}

export async function apiFootball<T = unknown>(
  req: ApiFootballRequest,
): Promise<ApiFootballResponse<T>> {
  if (!API_KEY || API_KEY === "YOUR_API_FOOTBALL_KEY_HERE") {
    return {
      ok: false,
      status: "unconfigured",
      data: null,
      error: "API_FOOTBALL_KEY not set. Per ATLAS Constitution Rule 4, returning insufficient_data — no fabricated data.",
    };
  }

  const available = await isEndpointAvailable(req.endpoint);
  if (!available) {
    return {
      ok: false,
      status: "endpoint_unavailable",
      data: null,
      error: `Endpoint '${req.endpoint}' marked unavailable on current API-Football plan.`,
    };
  }

  const quota = await getQuotaCounter();
  if (quota.count >= DAILY_LIMIT) {
    logger.warn("API-Football daily quota exhausted", {
      used: quota.count,
      limit: DAILY_LIMIT,
    });
    return {
      ok: false,
      status: "quota_exhausted",
      data: null,
      error: `Daily quota (${DAILY_LIMIT} requests) exhausted. Resets at ${quota.lastResetAt.toISOString()}`,
    };
  }

  const cacheKey = `${req.endpoint}|${req.path}`;
  const ttl = req.ttlMs ?? TTL_PRESETS[req.endpoint];

  if (!req.bypassCache) {
    const cached = responseCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      logger.debug("api-football cache hit", { endpoint: req.endpoint, path: req.path });
      return { ok: true, status: "success", data: cached.data as T };
    }
  }

  const url = `${BASE_URL}${req.path}`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "x-apisports-key": API_KEY,
        "x-rapidapi-host": API_HOST,
        Accept: "application/json",
      },
    });

    const quotaUsedAfter = await incrementQuota();

    if (res.status === 403) {
      // Endpoint restricted on current plan — mark unavailable.
      await markEndpointUnavailable(req.endpoint, "HTTP 403 Forbidden");
      return {
        ok: false,
        status: "endpoint_unavailable",
        data: null,
        error: `Endpoint '${req.endpoint}' returned 403. Marked unavailable for this plan.`,
        quotaUsedAfter,
      };
    }

    if (res.status === 429) {
      return {
        ok: false,
        status: "quota_exhausted",
        data: null,
        error: "HTTP 429 — rate limit hit.",
        quotaUsedAfter,
      };
    }

    if (!res.ok) {
      return {
        ok: false,
        status: "http_error",
        data: null,
        error: `HTTP ${res.status} ${res.statusText}`,
        quotaUsedAfter,
      };
    }

    const json = (await res.json()) as { response?: T; errors?: unknown };
    if (json.errors && Object.keys(json.errors as object).length > 0) {
      return {
        ok: false,
        status: "http_error",
        data: null,
        error: `API-Football errors: ${JSON.stringify(json.errors)}`,
        quotaUsedAfter,
      };
    }

    const data = (json.response ?? null) as T;
    if (data !== null) {
      responseCache.set(cacheKey, { data, expiresAt: Date.now() + ttl });
    }

    logger.debug("api-football fetch", {
      endpoint: req.endpoint,
      path: req.path,
      quotaUsedAfter,
    });

    return { ok: true, status: "success", data, quotaUsedAfter };
  } catch (err) {
    return {
      ok: false,
      status: "http_error",
      data: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
