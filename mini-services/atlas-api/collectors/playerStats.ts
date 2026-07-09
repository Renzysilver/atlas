// ATLAS API — collectors/playerStats.ts
// 🟢 ACTIVE — Player season statistics.
// Source: API-Football GET /players?team=ID&season=2025
//
// NOTE: This endpoint is the most quota-expensive player endpoint (one call
// per team returns all players). We rotate through teams slowly — 3 teams
// per run (3 requests) to stay well within the 100/day budget.

import { db } from "../lib/db.ts";
import { apiFootball } from "../lib/apiFootball.ts";
import { logger } from "../lib/logger.ts";
import { EPL_SEASON } from "@atlas/shared";
import type { CollectorDefinition, CollectorRunResult } from "@atlas/shared";
import { BaseCollector } from "./base.ts";

const SEASON = parseInt(process.env.API_FOOTBALL_SEASON || String(EPL_SEASON), 10);

interface ApiFootballPlayersResponse {
  player: {
    id: number;
    name: string;
    firstname: string;
    lastname: string;
    age: number;
    nationality: string;
    height: string;
    weight: string;
    photo: string;
  };
  statistics: Array<{
    team: { id: number; name: string };
    league: { id: number; name: string; season: number };
    games: { appearences: number | null; minutes: number | null; rating: string | null };
    substitutes: { in: number | null; out: number | null };
    goals: { total: number | null; assists: number | null };
    cards: { yellow: number | null; red: number | null };
    dribbles: { attempts: number | null; success: number | null };
    passes: { total: number | null; accuracy: string | null };
    shots: { total: number | null; on: number | null };
  }>;
}

export class PlayerStatsCollector extends BaseCollector {
  readonly definition: CollectorDefinition = {
    name: "player_stats",
    description: "Player season statistics (appearances, goals, rating)",
    status: "active",
    feedsLayer: "player_intelligence",
    schedule: process.env.COLLECTOR_DAILY_CRON || "0 4 * * *",
  };

  protected async ingest(): Promise<
    Omit<CollectorRunResult, "collectorName" | "startedAt" | "finishedAt" | "durationMs" | "status">
  > {
    const LEAGUE_ID = parseInt(process.env.API_FOOTBALL_LEAGUE_ID || "39", 10);

    // Pick 3 teams with oldest player-stats update
    // Note: Team model has homeMatches/awayMatches relations, not a unified
    // `matches` relation. Query both via OR.
    const teamsNeedingPlayers = await db.team.findMany({
      where: {
        OR: [
          { homeMatches: { some: { competition: "EPL", season: SEASON } } },
          { awayMatches: { some: { competition: "EPL", season: SEASON } } },
        ],
      },
      orderBy: { updatedAt: "asc" },
      take: 3,
    });

    if (teamsNeedingPlayers.length === 0) {
      logger.info("player_stats: no teams to process");
      return { recordsIngested: 0, recordsUpdated: 0, recordsSkipped: 0 };
    }

    let ingested = 0;
    let updated = 0;
    let skipped = 0;

    for (const team of teamsNeedingPlayers) {
      try {
        const res = await apiFootball<ApiFootballPlayersResponse[]>({
          endpoint: "players",
          path: `/players?team=${team.apiFootballId}&season=${SEASON}`,
          ttlMs: 24 * 60 * 60 * 1000,
        });

        if (!res.ok || !res.data) {
          logger.warn("player_stats fetch failed for team", {
            team: team.name,
            error: res.error,
          });
          skipped++;
          continue;
        }

        for (const p of res.data) {
          // Find EPL-relevant stats only
          const eplStats = p.statistics.find((s) => s.league.id === LEAGUE_ID);
          if (!eplStats) {
            skipped++;
            continue;
          }

          try {
            const player = await db.player.upsert({
              where: { apiFootballId: p.player.id },
              create: {
                apiFootballId: p.player.id,
                teamId: team.id,
                name: p.player.name,
                firstName: p.player.firstname,
                lastName: p.player.lastname,
                nationality: p.player.nationality,
                height: p.player.height,
                weight: p.player.weight,
                photoUrl: p.player.photo,
                sourceConfidence: 0.85,
              },
              update: {
                teamId: team.id,
                name: p.player.name,
                firstName: p.player.firstname,
                lastName: p.player.lastname,
                nationality: p.player.nationality,
                height: p.player.height,
                weight: p.player.weight,
                photoUrl: p.player.photo,
              },
            });

            const rating = eplStats.games.rating ? parseFloat(eplStats.games.rating) : null;
            const passesAccuracy = eplStats.passes.accuracy
              ? parseFloat(eplStats.passes.accuracy)
              : null;

            const existingStat = await db.playerStat.findUnique({
              where: { playerId_season: { playerId: player.id, season: SEASON } },
            });

            await db.playerStat.upsert({
              where: { playerId_season: { playerId: player.id, season: SEASON } },
              create: {
                playerId: player.id,
                season: SEASON,
                appearances: eplStats.games.appearences ?? 0,
                minutesPlayed: eplStats.games.minutes ?? 0,
                rating,
                goals: eplStats.goals.total ?? 0,
                assists: eplStats.goals.assists ?? 0,
                yellowCards: eplStats.cards.yellow ?? 0,
                redCards: eplStats.cards.red ?? 0,
                shotsTotal: eplStats.shots.total,
                shotsOnTarget: eplStats.shots.on,
                passes: eplStats.passes.total,
                passesAccuracy,
                sourceConfidence: 0.85,
              },
              update: {
                appearances: eplStats.games.appearences ?? 0,
                minutesPlayed: eplStats.games.minutes ?? 0,
                rating,
                goals: eplStats.goals.total ?? 0,
                assists: eplStats.goals.assists ?? 0,
                yellowCards: eplStats.cards.yellow ?? 0,
                redCards: eplStats.cards.red ?? 0,
                shotsTotal: eplStats.shots.total,
                shotsOnTarget: eplStats.shots.on,
                passes: eplStats.passes.total,
                passesAccuracy,
              },
            });

            if (existingStat) updated++;
            else ingested++;
          } catch (err) {
            logger.warn("player upsert failed", {
              apiFootballId: p.player.id,
              name: p.player.name,
              error: err instanceof Error ? err.message : String(err),
            });
            skipped++;
          }
        }
      } catch (err) {
        logger.warn("player_stats team fetch failed", {
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
