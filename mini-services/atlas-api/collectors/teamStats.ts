// ATLAS API — collectors/teamStats.ts
// 🟢 ACTIVE — Team season statistics + last-5 form.
// Source: API-Football GET /teams/statistics?league=39&season=2025&team=ID

import { db } from "../lib/db.ts";
import { apiFootball } from "../lib/apiFootball.ts";
import { logger } from "../lib/logger.ts";
import { EPL_LEAGUE_ID, EPL_SEASON } from "@atlas/shared";
import type { CollectorDefinition, CollectorRunResult } from "@atlas/shared";
import { BaseCollector } from "./base.ts";

const LEAGUE_ID = parseInt(process.env.API_FOOTBALL_LEAGUE_ID || String(EPL_LEAGUE_ID), 10);
const SEASON = parseInt(process.env.API_FOOTBALL_SEASON || String(EPL_SEASON), 10);

interface ApiFootballTeamStatsResponse {
  team: { id: number; name: string; logo: string };
  league: { id: number; season: number };
  fixtures: {
    played: { home: number; away: number; total: number };
    wins: { home: number; away: number; total: number };
    draws: { home: number; away: number; total: number };
    loses: { home: number; away: number; total: number };
  };
  goals: {
    for: { total: { home: number | null; away: number | null; total: number | null } };
    against: { total: { home: number | null; away: number | null; total: number | null } };
  };
  clean: { home: number; away: number; total: number };
  failed_to_score: { home: number; away: number; total: number };
  cards: { yellow: { total: number | null }; red: { total: number | null } };
  form: string | null;
}

export class TeamStatsCollector extends BaseCollector {
  readonly definition: CollectorDefinition = {
    name: "team_stats",
    description: "Team season statistics (form, goals, possession, cards)",
    status: "active",
    feedsLayer: "team_intelligence",
    schedule: process.env.COLLECTOR_DAILY_CRON || "0 4 * * *",
  };

  protected async ingest(): Promise<
    Omit<CollectorRunResult, "collectorName" | "startedAt" | "finishedAt" | "durationMs" | "status">
  > {
    // Get all EPL teams we know about (from standings or fixtures).
    // On free tier, we CANNOT fetch all 20 teams in one cron run — that's 20
    // of our 100 daily requests. Strategy: fetch up to 10 per run, rotating
    // through teams. This stays within quota.
    //
    // Note: Team model has homeMatches/awayMatches relations, not a unified
    // `matches` relation. Query both via OR.
    const teamsNeedingStats = await db.team.findMany({
      where: {
        OR: [
          { homeMatches: { some: { competition: "EPL", season: SEASON } } },
          { awayMatches: { some: { competition: "EPL", season: SEASON } } },
        ],
      },
      orderBy: { updatedAt: "asc" }, // oldest-updated first
      take: 10, // conservative cap per run
    });

    if (teamsNeedingStats.length === 0) {
      logger.info("team_stats: no teams found needing update yet — run fixtures collector first");
      return { recordsIngested: 0, recordsUpdated: 0, recordsSkipped: 0 };
    }

    let ingested = 0;
    let updated = 0;
    let skipped = 0;

    for (const team of teamsNeedingStats) {
      try {
        const res = await apiFootball<ApiFootballTeamStatsResponse>({
          endpoint: "teams", // reuse teams TTL (7d) since these stats are stable
          path: `/teams/statistics?league=${LEAGUE_ID}&season=${SEASON}&team=${team.apiFootballId}`,
          ttlMs: 24 * 60 * 60 * 1000, // 24h cache
        });

        if (!res.ok || !res.data) {
          logger.warn("team_stats fetch failed for team", {
            team: team.name,
            error: res.error,
          });
          skipped++;
          continue;
        }

        const s = res.data;
        const existing = await db.teamStat.findUnique({
          where: { teamId_season: { teamId: team.id, season: SEASON } },
        });

        // Parse last-5 form string like "WWDLW" → points + goals
        // API-Football's form field is e.g. "WDLWW" — each char is last-5 result
        const formChars = (s.form || "").split("");
        let last5Points = 0;
        for (const c of formChars) {
          if (c === "W") last5Points += 3;
          else if (c === "D") last5Points += 1;
        }
        // Defensive access — free-tier response may omit some nested fields.
        // Use optional chaining + nullish coalescing for every field.
        const last5GoalsFor = s.goals?.for?.total?.total ?? 0;
        const last5GoalsAgainst = s.goals?.against?.total?.total ?? 0;

        await db.teamStat.upsert({
          where: { teamId_season: { teamId: team.id, season: SEASON } },
          create: {
            teamId: team.id,
            season: SEASON,
            fixturesPlayed: s.fixtures?.played?.total ?? 0,
            wins: s.fixtures?.wins?.total ?? 0,
            draws: s.fixtures?.draws?.total ?? 0,
            losses: s.fixtures?.loses?.total ?? 0,
            goalsFor: s.goals?.for?.total?.total ?? 0,
            goalsAgainst: s.goals?.against?.total?.total ?? 0,
            cleanSheets: s.clean?.total ?? 0,
            failedToScore: s.failed_to_score?.total ?? 0,
            yellowCards: s.cards?.yellow?.total ?? 0,
            redCards: s.cards?.red?.total ?? 0,
            last5Points,
            last5GoalsFor,
            last5GoalsAgainst,
            sourceConfidence: 0.9,
          },
          update: {
            fixturesPlayed: s.fixtures?.played?.total ?? 0,
            wins: s.fixtures?.wins?.total ?? 0,
            draws: s.fixtures?.draws?.total ?? 0,
            losses: s.fixtures?.loses?.total ?? 0,
            goalsFor: s.goals?.for?.total?.total ?? 0,
            goalsAgainst: s.goals?.against?.total?.total ?? 0,
            cleanSheets: s.clean?.total ?? 0,
            failedToScore: s.failed_to_score?.total ?? 0,
            yellowCards: s.cards?.yellow?.total ?? 0,
            redCards: s.cards?.red?.total ?? 0,
            last5Points,
            last5GoalsFor,
            last5GoalsAgainst,
          },
        });

        // Bump team.sourceConfidence — we now have detailed stats for this team
        await db.team.update({
          where: { id: team.id },
          data: {
            sourceConfidence: 0.95,
            logoUrl: s.team.logo ?? team.logoUrl,
          },
        });

        if (existing) updated++;
        else ingested++;
      } catch (err) {
        logger.warn("team_stats upsert failed", {
          team: team.name,
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
