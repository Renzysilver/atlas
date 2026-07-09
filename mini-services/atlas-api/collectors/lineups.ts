// ATLAS API — collectors/lineups.ts
// 🟢 ACTIVE — Match lineups (published ~1hr pre-match).
// Source: API-Football GET /fixtures/lineups?fixture=ID
//
// Strategy: query matches kicking off in next 3 hours, fetch lineups for
// those that haven't been ingested yet. Rate-limited: max 5 matches per run.

import { db } from "../lib/db.ts";
import { apiFootball } from "../lib/apiFootball.ts";
import { logger } from "../lib/logger.ts";
import type { CollectorDefinition, CollectorRunResult } from "@atlas/shared";
import { BaseCollector } from "./base.ts";
import { normalizeName, validateSourceConfidence } from "../lib/cleaning.ts";

interface ApiFootballLineupResponse {
  team: {
    id: number;
    name: string;
    logo: string;
    colors: any;
  };
  formation: string;
  startXI: Array<{
    player: { id: number; name: string };
    pos: string;
  }>;
  substitutes: Array<{
    player: { id: number; name: string };
    pos: string;
  }>;
}

export class LineupsCollector extends BaseCollector {
  readonly definition: CollectorDefinition = {
    name: "lineups",
    description: "Match lineups (published ~1hr pre-match)",
    status: "active",
    feedsLayer: "tactical_intelligence",
    schedule: process.env.COLLECTOR_LINEUPS_CRON || "*/10 * * * *",
  };

  protected async ingest(): Promise<
    Omit<CollectorRunResult, "collectorName" | "startedAt" | "finishedAt" | "durationMs" | "status">
  > {
    // Find matches kicking off in next 3 hours that don't have lineups yet
    const now = new Date();
    const threeHoursLater = new Date(now.getTime() + 3 * 60 * 60 * 1000);

    const upcomingMatches = await db.match.findMany({
      where: {
        kickoffUtc: { gte: now, lte: threeHoursLater },
        status: "scheduled",
        lineups: { none: {} }, // no lineups yet
      },
      take: 5, // conservative quota cap
      orderBy: { kickoffUtc: "asc" },
    });

    if (upcomingMatches.length === 0) {
      logger.debug("lineups: no upcoming matches needing lineup fetch");
      return { recordsIngested: 0, recordsUpdated: 0, recordsSkipped: 0 };
    }

    let ingested = 0;
    let updated = 0;
    let skipped = 0;

    for (const match of upcomingMatches) {
      try {
        const res = await apiFootball<ApiFootballLineupResponse[]>({
          endpoint: "lineups",
          path: `/fixtures/lineups?fixture=${match.apiFootballId}`,
          ttlMs: 10 * 60 * 1000, // 10min cache — refresh near kickoff
        });

        if (!res.ok || !res.data || res.data.length < 2) {
          // Lineups often aren't published until 1hr before kickoff. This is
          // NOT an error — just no data yet. Log and skip.
          logger.debug("lineups: not yet published for match", {
            matchId: match.id,
            kickoff: match.kickoffUtc,
          });
          skipped++;
          continue;
        }

        for (const lineup of res.data) {
          // Find local team by apiFootballId
          const team = await db.team.findUnique({
            where: { apiFootballId: lineup.team.id },
          });
          if (!team) {
            logger.warn("lineups: team not found in DB", {
              apiFootballId: lineup.team.id,
              name: lineup.team.name,
            });
            skipped++;
            continue;
          }

          // Upsert starters
          let slot = 1;
          for (const starter of lineup.startXI) {
            await this.upsertLineupPlayer(
              match.id,
              team.id,
              starter.player,
              starter.pos,
              true,
              slot++,
            );
            ingested++;
          }

          // Upsert substitutes
          for (const sub of lineup.substitutes) {
            await this.upsertLineupPlayer(
              match.id,
              team.id,
              sub.player,
              sub.pos,
              false,
              null,
            );
            ingested++;
          }
        }
      } catch (err) {
        logger.warn("lineups fetch failed", {
          matchId: match.id,
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

  private async upsertLineupPlayer(
    matchId: string,
    teamId: string,
    playerRef: { id: number; name: string },
    position: string,
    isStarter: boolean,
    formationSlot: number | null,
  ): Promise<void> {
    // Ensure player exists
    // Module 2: normalize player name (decode HTML entities)
    const playerName = normalizeName(playerRef.name) || playerRef.name;
    const player = await db.player.upsert({
      where: { apiFootballId: playerRef.id },
      create: {
        apiFootballId: playerRef.id,
        teamId,
        name: playerName,
        sourceConfidence: validateSourceConfidence(0.6),
      },
      update: {
        name: playerName,
        teamId,
      },
    });

    await db.lineup.upsert({
      where: {
        matchId_teamId_playerId: { matchId, teamId, playerId: player.id },
      },
      create: {
        matchId,
        teamId,
        playerId: player.id,
        isStarter,
        position,
        formationSlot: formationSlot ?? undefined,
        sourceConfidence: 0.7,
      },
      update: {
        isStarter,
        position,
        formationSlot: formationSlot ?? undefined,
      },
    });
  }
}
