// ATLAS API — collectors/h2h.ts
// 🟢 ACTIVE — Head-to-head history between teams.
// Source: API-Football GET /fixtures/headtohead?h2h=ID1-ID2&from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Module 2 rewrite: The free-tier API blocks the `last=N` parameter.
// Per Section 17 Rule 2, I flagged this and the resolution is to use
// date-range parameters (from=/to=) instead. This fetches all H2H meetings
// in a 5-year window, which is the free-tier-compatible equivalent.
//
// Strategy: find all unique team-pairs from the season's fixtures, fetch
// their H2H history in a 5-year window. Rate-limited: 5 pairs per run
// (each pair = 1 API call).

import { db } from "../lib/db.ts";
import { apiFootball } from "../lib/apiFootball.ts";
import { logger } from "../lib/logger.ts";
import type { CollectorDefinition, CollectorRunResult, ApiFootballFixture } from "@atlas/shared";
import { BaseCollector } from "./base.ts";
import { normalizeName, normalizeTimestampToUtc, validateSourceConfidence } from "../lib/cleaning.ts";

const H2H_WINDOW_YEARS = 5; // look back 5 years for head-to-head history

export class HeadToHeadCollector extends BaseCollector {
  readonly definition: CollectorDefinition = {
    name: "head_to_head",
    description: "Head-to-head history between teams (5-year window via date range)",
    status: "active",
    feedsLayer: "historical_intelligence",
    schedule: process.env.COLLECTOR_FIXTURES_CRON || "0 */6 * * *",
  };

  protected async ingest(): Promise<
    Omit<CollectorRunResult, "collectorName" | "startedAt" | "finishedAt" | "durationMs" | "status">
  > {
    // Find all unique team-pairs from this season's matches.
    // We compute pairs from the Match table rather than fetching upcoming
    // matches (the old approach) — this works for both live and historical
    // seasons.
    const matches = await db.match.findMany({
      where: { competition: "EPL" },
      select: { homeTeamId: true, awayTeamId: true, season: true },
    });

    // Deduplicate pairs (A vs B is the same as B vs A)
    const pairSet = new Set<string>();
    const pairs: Array<{ team1Id: string; team2Id: string; season: number }> = [];
    for (const m of matches) {
      const [id1, id2] = m.homeTeamId < m.awayTeamId
        ? [m.homeTeamId, m.awayTeamId]
        : [m.awayTeamId, m.homeTeamId];
      const key = `${id1}|${id2}`;
      if (!pairSet.has(key)) {
        pairSet.add(key);
        pairs.push({ team1Id: id1, team2Id: id2, season: m.season });
      }
    }

    if (pairs.length === 0) {
      logger.debug("h2h: no team pairs found — run fixtures collector first");
      return { recordsIngested: 0, recordsUpdated: 0, recordsSkipped: 0 };
    }

    // Limit to 5 pairs per run (conservative quota usage)
    // Sort by whether H2H record already exists (prioritize missing pairs)
    const pairsNeedingH2H: typeof pairs = [];
    for (const pair of pairs) {
      const existing = await db.headToHead.findUnique({
        where: { team1Id_team2Id: { team1Id: pair.team1Id, team2Id: pair.team2Id } },
      });
      if (!existing) {
        pairsNeedingH2H.push(pair);
      }
      if (pairsNeedingH2H.length >= 5) break;
    }

    if (pairsNeedingH2H.length === 0) {
      logger.debug("h2h: all team pairs already have H2H records");
      return { recordsIngested: 0, recordsUpdated: 0, recordsSkipped: 0 };
    }

    // Date range: last 5 years
    const toDate = new Date();
    const fromDate = new Date(toDate.getFullYear() - H2H_WINDOW_YEARS, 0, 1);
    const fromStr = fromDate.toISOString().slice(0, 10); // YYYY-MM-DD
    const toStr = toDate.toISOString().slice(0, 10);

    let ingested = 0;
    let updated = 0;
    let skipped = 0;

    for (const pair of pairsNeedingH2H) {
      try {
        // Get both teams to build the h2h query parameter
        const team1 = await db.team.findUnique({ where: { id: pair.team1Id } });
        const team2 = await db.team.findUnique({ where: { id: pair.team2Id } });
        if (!team1 || !team2) {
          skipped++;
          continue;
        }

        const res = await apiFootball<ApiFootballFixture[]>({
          endpoint: "h2h",
          // Module 2: use from=/to= date range instead of blocked last=N
          path: `/fixtures/headtohead?h2h=${team1.apiFootballId}-${team2.apiFootballId}&from=${fromStr}&to=${toStr}`,
          ttlMs: 24 * 60 * 60 * 1000,
        });

        if (!res.ok || !res.data) {
          logger.warn("h2h fetch failed", {
            team1: team1.name,
            team2: team2.name,
            error: res.error,
          });
          skipped++;
          continue;
        }

        const fixtures = res.data;
        let team1Wins = 0;
        let draws = 0;
        let team2Wins = 0;
        let lastMeetingKickoff: Date | null = null;
        let lastMeetingScore: string | null = null;

        for (const f of fixtures) {
          // Determine which team is home in this historical fixture
          // team1 is always the lower-id team in our canonical ordering
          const isTeam1Home = f.teams.home.id === team1.apiFootballId;
          const team1Goals = isTeam1Home ? f.goals.home : f.goals.away;
          const team2Goals = isTeam1Home ? f.goals.away : f.goals.home;

          if (team1Goals === null || team2Goals === null) continue;

          if (team1Goals > team2Goals) team1Wins++;
          else if (team1Goals < team2Goals) team2Wins++;
          else draws++;

          const fixtureDate = normalizeTimestampToUtc(f.fixture.date);
          if (fixtureDate && (!lastMeetingKickoff || fixtureDate > lastMeetingKickoff)) {
            lastMeetingKickoff = fixtureDate;
            lastMeetingScore = `${team1Goals}-${team2Goals}`;
          }
        }

        await db.headToHead.upsert({
          where: { team1Id_team2Id: { team1Id: pair.team1Id, team2Id: pair.team2Id } },
          create: {
            team1Id: pair.team1Id,
            team2Id: pair.team2Id,
            season: pair.season,
            matchesPlayed: fixtures.length,
            team1Wins,
            draws,
            team2Wins,
            lastMeetingKickoff: lastMeetingKickoff ?? undefined,
            lastMeetingScore: lastMeetingScore ?? undefined,
            sourceConfidence: validateSourceConfidence(0.9),
          },
          update: {
            matchesPlayed: fixtures.length,
            team1Wins,
            draws,
            team2Wins,
            lastMeetingKickoff: lastMeetingKickoff ?? undefined,
            lastMeetingScore: lastMeetingScore ?? undefined,
            season: pair.season,
          },
        });

        ingested++;
      } catch (err) {
        logger.warn("h2h upsert failed", {
          team1Id: pair.team1Id,
          team2Id: pair.team2Id,
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
