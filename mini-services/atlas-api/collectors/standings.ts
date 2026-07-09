// ATLAS API — collectors/standings.ts
// 🟢 ACTIVE — EPL league standings ingestion.
// Source: API-Football GET /standings?league=39&season=2025

import { db } from "../lib/db.ts";
import { apiFootball } from "../lib/apiFootball.ts";
import { logger } from "../lib/logger.ts";
import { EPL_LEAGUE_ID, EPL_SEASON } from "@atlas/shared";
import type { CollectorDefinition, CollectorRunResult } from "@atlas/shared";
import { BaseCollector } from "./base.ts";

const LEAGUE_ID = parseInt(process.env.API_FOOTBALL_LEAGUE_ID || String(EPL_LEAGUE_ID), 10);
const SEASON = parseInt(process.env.API_FOOTBALL_SEASON || String(EPL_SEASON), 10);

interface ApiFootballStandingsResponse {
  league: {
    id: number;
    season: number;
    standings: ApiFootballStandingRow[][];
  };
}

interface ApiFootballStandingRow {
  rank: number;
  team: { id: number; name: string; logo: string };
  points: number;
  all: {
    played: number;
    win: number;
    draw: number;
    lose: number;
    goals: { for: number; against: number };
  };
  home: {
    played: number;
    win: number;
    draw: number;
    lose: number;
    goals: { for: number; against: number };
  };
  away: {
    played: number;
    win: number;
    draw: number;
    lose: number;
    goals: { for: number; against: number };
  };
  form: string | null;
  status: string;
  description: string | null;
}

export class StandingsCollector extends BaseCollector {
  readonly definition: CollectorDefinition = {
    name: "standings",
    description: "EPL league standings (position, points, form)",
    status: "active",
    feedsLayer: "team_intelligence",
    schedule: process.env.COLLECTOR_DAILY_CRON || "0 4 * * *",
  };

  protected async ingest(): Promise<
    Omit<CollectorRunResult, "collectorName" | "startedAt" | "finishedAt" | "durationMs" | "status">
  > {
    const res = await apiFootball<ApiFootballStandingsResponse[]>({
      endpoint: "standings",
      path: `/standings?league=${LEAGUE_ID}&season=${SEASON}`,
    });

    if (!res.ok || !res.data || res.data.length === 0) {
      throw new Error(`API-Football standings fetch failed: ${res.error}`);
    }

    const standings = res.data[0].league.standings[0] || [];
    let ingested = 0;
    let updated = 0;
    let skipped = 0;

    for (const row of standings) {
      try {
        // Ensure team exists; bump sourceConfidence since standings confirms identity
        await db.team.upsert({
          where: { apiFootballId: row.team.id },
          create: {
            apiFootballId: row.team.id,
            name: row.team.name,
            logoUrl: row.team.logo,
            sourceConfidence: 0.8,
          },
          update: {
            name: row.team.name,
            logoUrl: row.team.logo,
            sourceConfidence: 0.85, // standings data confirms team identity
          },
        });

        const team = await db.team.findUnique({ where: { apiFootballId: row.team.id } });
        if (!team) {
          skipped++;
          continue;
        }

        const homeRecord = `${row.home.win}-${row.home.draw}-${row.home.lose}`;
        const awayRecord = `${row.away.win}-${row.away.draw}-${row.away.lose}`;

        const existing = await db.standing.findUnique({
          where: { season_teamId: { season: SEASON, teamId: team.id } },
        });

        await db.standing.upsert({
          where: { season_teamId: { season: SEASON, teamId: team.id } },
          create: {
            season: SEASON,
            teamId: team.id,
            position: row.rank,
            played: row.all.played,
            won: row.all.win,
            drawn: row.all.draw,
            lost: row.all.lose,
            goalsFor: row.all.goals.for,
            goalsAgainst: row.all.goals.against,
            points: row.points,
            form: row.form,
            homeRecord,
            awayRecord,
            sourceConfidence: 0.95,
          },
          update: {
            position: row.rank,
            played: row.all.played,
            won: row.all.win,
            drawn: row.all.draw,
            lost: row.all.lose,
            goalsFor: row.all.goals.for,
            goalsAgainst: row.all.goals.against,
            points: row.points,
            form: row.form,
            homeRecord,
            awayRecord,
          },
        });

        if (existing) updated++;
        else ingested++;
      } catch (err) {
        logger.warn("standing upsert failed", {
          apiFootballId: row.team.id,
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
