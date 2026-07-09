// ATLAS API — collectors/h2h.ts
// 🟢 ACTIVE — Head-to-head history between upcoming fixture teams.
// Source: API-Football GET /fixtures/headtohead?h2h=ID1-ID2&last=10
//
// Strategy: find matches kicking off in next 7 days without H2H data, fetch
// last-10 historical meetings between the two teams. Rate-limited: 5 per run.

import { db } from "../lib/db.ts";
import { apiFootball } from "../lib/apiFootball.ts";
import { logger } from "../lib/logger.ts";
import type { CollectorDefinition, CollectorRunResult, ApiFootballFixture } from "@atlas/shared";
import { BaseCollector } from "./base.ts";

export class HeadToHeadCollector extends BaseCollector {
  readonly definition: CollectorDefinition = {
    name: "head_to_head",
    description: "Head-to-head history between upcoming fixture teams",
    status: "active",
    feedsLayer: "historical_intelligence",
    schedule: process.env.COLLECTOR_FIXTURES_CRON || "0 */6 * * *",
  };

  protected async ingest(): Promise<
    Omit<CollectorRunResult, "collectorName" | "startedAt" | "finishedAt" | "durationMs" | "status">
  > {
    // Find upcoming matches (next 7 days) where H2H hasn't been computed yet
    const now = new Date();
    const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const upcoming = await db.match.findMany({
      where: {
        kickoffUtc: { gte: now, lte: sevenDaysLater },
        status: "scheduled",
      },
      take: 5,
      orderBy: { kickoffUtc: "asc" },
      include: { homeTeam: true, awayTeam: true },
    });

    if (upcoming.length === 0) {
      logger.debug("h2h: no upcoming matches needing H2H fetch");
      return { recordsIngested: 0, recordsUpdated: 0, recordsSkipped: 0 };
    }

    let ingested = 0;
    let updated = 0;
    let skipped = 0;

    for (const match of upcoming) {
      try {
        const res = await apiFootball<ApiFootballFixture[]>({
          endpoint: "h2h",
          path: `/fixtures/headtohead?h2h=${match.homeTeam.apiFootballId}-${match.awayTeam.apiFootballId}&last=20`,
          ttlMs: 24 * 60 * 60 * 1000,
        });

        if (!res.ok || !res.data) {
          logger.warn("h2h fetch failed", {
            homeTeam: match.homeTeam.name,
            awayTeam: match.awayTeam.name,
            error: res.error,
          });
          skipped++;
          continue;
        }

        // Aggregate the historical fixtures
        const fixtures = res.data;
        let team1Wins = 0;
        let draws = 0;
        let team2Wins = 0;
        let lastMeetingKickoff: Date | null = null;
        let lastMeetingScore: string | null = null;

        for (const f of fixtures) {
          // Determine team1 = home (apiFootballId), team2 = away
          // But in H2H data, either team could be home in past meetings.
          const isTeam1Home = f.teams.home.id === match.homeTeam.apiFootballId;
          const team1Goals = isTeam1Home ? f.goals.home : f.goals.away;
          const team2Goals = isTeam1Home ? f.goals.away : f.goals.home;

          if (team1Goals === null || team2Goals === null) continue;

          if (team1Goals > team2Goals) team1Wins++;
          else if (team1Goals < team2Goals) team2Wins++;
          else draws++;

          const fixtureDate = new Date(f.fixture.date);
          if (!lastMeetingKickoff || fixtureDate > lastMeetingKickoff) {
            lastMeetingKickoff = fixtureDate;
            lastMeetingScore = `${team1Goals}-${team2Goals}`;
          }
        }

        // Ensure canonical ordering (team1Id < team2Id) for the unique constraint
        const [team1Id, team2Id] =
          match.homeTeam.id < match.awayTeam.id
            ? [match.homeTeam.id, match.awayTeam.id]
            : [match.awayTeam.id, match.homeTeam.id];
        // If we swapped, also swap win counts
        const canonicalTeam1Wins =
          match.homeTeam.id < match.awayTeam.id ? team1Wins : team2Wins;
        const canonicalTeam2Wins =
          match.homeTeam.id < match.awayTeam.id ? team2Wins : team1Wins;

        const existing = await db.headToHead.findUnique({
          where: { team1Id_team2Id: { team1Id, team2Id } },
        });

        await db.headToHead.upsert({
          where: { team1Id_team2Id: { team1Id, team2Id } },
          create: {
            team1Id,
            team2Id,
            season: match.season,
            matchesPlayed: fixtures.length,
            team1Wins: canonicalTeam1Wins,
            draws,
            team2Wins: canonicalTeam2Wins,
            lastMeetingKickoff: lastMeetingKickoff ?? undefined,
            lastMeetingScore: lastMeetingScore ?? undefined,
            sourceConfidence: 0.9,
          },
          update: {
            matchesPlayed: fixtures.length,
            team1Wins: canonicalTeam1Wins,
            draws,
            team2Wins: canonicalTeam2Wins,
            lastMeetingKickoff: lastMeetingKickoff ?? undefined,
            lastMeetingScore: lastMeetingScore ?? undefined,
            season: match.season,
          },
        });

        if (existing) updated++;
        else ingested++;
      } catch (err) {
        logger.warn("h2h upsert failed", {
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
}
