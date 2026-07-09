// ATLAS API — collectors/fixtures.ts
// 🟢 ACTIVE — EPL fixtures & results ingestion.
// Source: API-Football GET /fixtures?league=39&season=2025
// Writes: Match table (and ensures both Team rows exist)

import { db } from "../lib/db.ts";
import { apiFootball } from "../lib/apiFootball.ts";
import { logger } from "../lib/logger.ts";
import { EPL_LEAGUE_ID, EPL_SEASON, type ApiFootballFixture } from "@atlas/shared";
import type { CollectorDefinition, CollectorRunResult } from "@atlas/shared";
import { BaseCollector } from "./base.ts";
import { normalizeName, normalizeTimestampToUtc, validateSourceConfidence } from "../lib/cleaning.ts";

const LEAGUE_ID = parseInt(process.env.API_FOOTBALL_LEAGUE_ID || String(EPL_LEAGUE_ID), 10);
const SEASON = parseInt(process.env.API_FOOTBALL_SEASON || String(EPL_SEASON), 10);

export class FixturesCollector extends BaseCollector {
  readonly definition: CollectorDefinition = {
    name: "fixtures",
    description: "EPL fixtures & results for the active season",
    status: "active",
    feedsLayer: "historical_intelligence",
    schedule: process.env.COLLECTOR_FIXTURES_CRON || "0 */6 * * *",
  };

  protected async ingest(): Promise<
    Omit<CollectorRunResult, "collectorName" | "startedAt" | "finishedAt" | "durationMs" | "status">
  > {
    const res = await apiFootball<ApiFootballFixture[]>({
      endpoint: "fixtures",
      path: `/fixtures?league=${LEAGUE_ID}&season=${SEASON}`,
    });

    if (!res.ok || !res.data) {
      // If quota exhausted or endpoint unavailable, this is HONEST insufficient_data.
      // Per Constitution Rule 4: do NOT fabricate fixtures.
      throw new Error(`API-Football fixtures fetch failed: ${res.error}`);
    }

    let ingested = 0;
    let updated = 0;
    let skipped = 0;

    // First pass: ensure both teams exist (we get minimal team data here —
    // team_stats / standings collectors will enrich later).
    for (const fx of res.data) {
      try {
        // Upsert home team (minimal — full enrichment comes from team_stats)
        // Module 2: normalize name (decode HTML entities, trim whitespace)
        const homeTeamName = normalizeName(fx.teams.home.name);
        await db.team.upsert({
          where: { apiFootballId: fx.teams.home.id },
          create: {
            apiFootballId: fx.teams.home.id,
            name: homeTeamName || fx.teams.home.name,
            sourceConfidence: validateSourceConfidence(0.6),
          },
          update: { name: homeTeamName || fx.teams.home.name },
        });

        const awayTeamName = normalizeName(fx.teams.away.name);
        await db.team.upsert({
          where: { apiFootballId: fx.teams.away.id },
          create: {
            apiFootballId: fx.teams.away.id,
            name: awayTeamName || fx.teams.away.name,
            sourceConfidence: validateSourceConfidence(0.6),
          },
          update: { name: awayTeamName || fx.teams.away.name },
        });

        const homeTeam = await db.team.findUnique({ where: { apiFootballId: fx.teams.home.id } });
        const awayTeam = await db.team.findUnique({ where: { apiFootballId: fx.teams.away.id } });
        if (!homeTeam || !awayTeam) {
          skipped++;
          continue;
        }

        // Parse matchweek from "Regular Season - 17" → 17
        const matchweek = parseInt(fx.league.round?.split("-").pop()?.trim() || "0", 10) || null;

        // Map API-Football status short → ATLAS status
        const statusShort = fx.fixture.status.short;
        let matchStatus = "scheduled";
        if (["1H", "2H", "HT", "ET", "BT", "P", "LIVE"].includes(statusShort)) {
          matchStatus = "live";
        } else if (["FT", "AET", "PEN"].includes(statusShort)) {
          matchStatus = "finished";
        } else if (["PST", "CANC", "ABD", "AWD", "WO"].includes(statusShort)) {
          matchStatus = "postponed";
        }

        const existing = await db.match.findUnique({
          where: { apiFootballId: fx.fixture.id },
        });

        const result = await db.match.upsert({
          where: { apiFootballId: fx.fixture.id },
          create: {
            apiFootballId: fx.fixture.id,
            season: fx.league.season,
            matchweek,
            competition: "EPL",
            homeTeamId: homeTeam.id,
            awayTeamId: awayTeam.id,
            // Module 2: normalize timestamp to UTC
            kickoffUtc: normalizeTimestampToUtc(fx.fixture.date) || new Date(fx.fixture.date),
            status: matchStatus,
            homeScore: fx.goals.home,
            awayScore: fx.goals.away,
            venue: fx.fixture.venue?.name || null,
            sourceConfidence: validateSourceConfidence(0.9),
          },
          update: {
            status: matchStatus,
            homeScore: fx.goals.home,
            awayScore: fx.goals.away,
            venue: fx.fixture.venue?.name || null,
            matchweek: matchweek ?? undefined,
          },
        });

        if (existing) updated++;
        else ingested++;
      } catch (err) {
        logger.warn("fixture upsert failed", {
          apiFootballId: fx.fixture.id,
          error: err instanceof Error ? err.message : String(err),
        });
        skipped++;
      }
    }

    return {
      recordsIngested: ingested,
      recordsUpdated: updated,
      recordsSkipped: skipped,
    };
  }
}
