// ATLAS API — collectors/fixtures.ts
// 🟢 ACTIVE — Multi-league fixtures & results ingestion.
// Source: API-Football GET /fixtures?league=ID&season=YEAR
// Writes: Match table (and ensures both Team rows exist)
//
// Multi-league: activated via ATLAS_ACTIVE_LEAGUES env var.
// Default: EPL only (league 39). Add comma-separated IDs to expand.
// Example: ATLAS_ACTIVE_LEAGUES=39,2,140,135,78,61
// Quota note: each league = 1 API call. With 100/day free limit, be careful.

import { db } from "../lib/db.ts";
import { apiFootball } from "../lib/apiFootball.ts";
import { logger } from "../lib/logger.ts";
import { getActiveLeagues, type ApiFootballFixture } from "@atlas/shared";
import type { CollectorDefinition, CollectorRunResult } from "@atlas/shared";
import { BaseCollector } from "./base.ts";
import { normalizeName, normalizeTimestampToUtc, validateSourceConfidence } from "../lib/cleaning.ts";

export class FixturesCollector extends BaseCollector {
  readonly definition: CollectorDefinition = {
    name: "fixtures",
    description: "Multi-league fixtures & results (EPL + configured leagues)",
    status: "active",
    feedsLayer: "historical_intelligence",
    schedule: process.env.COLLECTOR_FIXTURES_CRON || "0 */6 * * *",
  };

  protected async ingest(): Promise<
    Omit<CollectorRunResult, "collectorName" | "startedAt" | "finishedAt" | "durationMs" | "status">
  > {
    const activeLeagues = getActiveLeagues();
    logger.info("fixtures: running for leagues", {
      leagues: activeLeagues.map((l) => `${l.shortName}(${l.id})`).join(", "),
    });

    let totalIngested = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;

    for (const league of activeLeagues) {
      try {
        const { ingested, updated, skipped } = await this.ingestLeague(league.id, league.season, league.shortName);
        totalIngested += ingested;
        totalUpdated += updated;
        totalSkipped += skipped;
        logger.info("fixtures: league complete", {
          league: league.shortName,
          ingested,
          updated,
          skipped,
        });
      } catch (err) {
        logger.error("fixtures: league failed", {
          league: league.shortName,
          error: err instanceof Error ? err.message : String(err),
        });
        totalSkipped++;
      }
    }

    return {
      recordsIngested: totalIngested,
      recordsUpdated: totalUpdated,
      recordsSkipped: totalSkipped,
    };
  }

  private async ingestLeague(
    leagueId: number,
    season: number,
    competition: string
  ): Promise<{ ingested: number; updated: number; skipped: number }> {
    const res = await apiFootball<ApiFootballFixture[]>({
      endpoint: "fixtures",
      path: `/fixtures?league=${leagueId}&season=${season}`,
    });

    if (!res.ok || !res.data) {
      throw new Error(`API-Football fixtures fetch failed for ${competition}: ${res.error}`);
    }

    let ingested = 0;
    let updated = 0;
    let skipped = 0;

    for (const fx of res.data) {
      try {
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
        if (!homeTeam || !awayTeam) { skipped++; continue; }

        const matchweek = parseInt(fx.league.round?.split("-").pop()?.trim() || "0", 10) || null;

        const statusShort = fx.fixture.status.short;
        let matchStatus = "scheduled";
        if (["1H", "2H", "HT", "ET", "BT", "P", "LIVE"].includes(statusShort)) matchStatus = "live";
        else if (["FT", "AET", "PEN"].includes(statusShort)) matchStatus = "finished";
        else if (["PST", "CANC", "ABD", "AWD", "WO"].includes(statusShort)) matchStatus = "postponed";

        const existing = await db.match.findUnique({ where: { apiFootballId: fx.fixture.id } });

        await db.match.upsert({
          where: { apiFootballId: fx.fixture.id },
          create: {
            apiFootballId: fx.fixture.id,
            season: fx.league.season,
            matchweek,
            competition,
            homeTeamId: homeTeam.id,
            awayTeamId: awayTeam.id,
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

    return { ingested, updated, skipped };
  }
}
