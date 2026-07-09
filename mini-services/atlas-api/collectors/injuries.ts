// ATLAS API — collectors/injuries.ts
// 🟢 ACTIVE — but degrades to 🟡 STUB behavior if API-Football returns 403
// on the /injuries endpoint (free tier may not include it).
//
// Source: API-Football GET /injuries?league=39&season=2024
// Per spec Section 3 Layer 4 + Section 15: if endpoint is unavailable, the
// Injury Intelligence layer returns insufficient_data — do NOT fake injury
// list. This collector honors that by surfacing the unavailability.
//
// IMPORTANT: The actual API-Football /injuries response structure is:
//   {
//     player: { id, name, photo, type: "Missing Fixture", reason: "Ankle Injury" },
//     team:   { id, name, logo },
//     fixture:{ id, timezone, date, timestamp },
//     league: { id, season, name, country, logo, flag }
//   }
//
// Note: `type` and `reason` are INSIDE the `player` object, NOT at the top
// level. There is no `status` or `expected_return` field. Each record
// represents a player being unavailable for a specific fixture, not an
// injury "event" with start/return dates.
//
// This is actually BETTER for the Injury Intelligence layer (Section 3
// Layer 4) — it tells us exactly which fixtures each player missed and why,
// which is the precise input the layer needs: "injury list × player
// importance weight" per fixture.

import { db } from "../lib/db.ts";
import { apiFootball, isEndpointAvailable } from "../lib/apiFootball.ts";
import { logger } from "../lib/logger.ts";
import { EPL_LEAGUE_ID, EPL_SEASON } from "@atlas/shared";
import type { CollectorDefinition, CollectorRunResult } from "@atlas/shared";
import { BaseCollector } from "./base.ts";
import { normalizeName, normalizeTimestampToUtc, validateSourceConfidence } from "../lib/cleaning.ts";

const LEAGUE_ID = parseInt(process.env.API_FOOTBALL_LEAGUE_ID || String(EPL_LEAGUE_ID), 10);
const SEASON = parseInt(process.env.API_FOOTBALL_SEASON || String(EPL_SEASON), 10);

// Actual API-Football /injuries response structure (verified via live API call)
interface ApiFootballInjuryResponse {
  player: {
    id: number;
    name: string;
    photo: string;
    type: string;   // e.g. "Missing Fixture", "Injury", "Suspension"
    reason: string; // e.g. "Ankle Injury", "Yellow Card Accumulation"
  };
  team: { id: number; name: string; logo: string };
  fixture: { id: number; timezone: string; date: string; timestamp: number } | null;
  league: { id: number; season: number; name: string; country: string; logo: string; flag: string };
}

export class InjuriesCollector extends BaseCollector {
  readonly definition: CollectorDefinition = {
    name: "injuries",
    description: "Player absences per fixture (injuries, suspensions, missing fixture)",
    status: "active",
    feedsLayer: "injury_intelligence",
    schedule: process.env.COLLECTOR_DAILY_CRON || "0 4 * * *",
  };

  protected async ingest(): Promise<
    Omit<CollectorRunResult, "collectorName" | "startedAt" | "finishedAt" | "durationMs" | "status">
  > {
    // Check if endpoint is known unavailable — short-circuit cleanly
    const available = await isEndpointAvailable("injuries");
    if (!available) {
      // This is the HONEST path per Constitution Rule 4 + Section 15.
      // Return zero records ingested with an explanatory error.
      throw new Error(
        "API-Football /injuries endpoint is unavailable on current plan (free tier). " +
        "Injury Intelligence layer returns insufficient_data. Flagged per Section 15: " +
        "do not fabricate injury lists."
      );
    }

    const res = await apiFootball<ApiFootballInjuryResponse[]>({
      endpoint: "injuries",
      path: `/injuries?league=${LEAGUE_ID}&season=${SEASON}`,
      ttlMs: 60 * 60 * 1000, // 1h cache
    });

    if (!res.ok || !res.data) {
      // If 403, the endpoint isn't on this plan. The apiFootball module already
      // marked it unavailable — the next run will short-circuit above.
      throw new Error(`API-Football injuries fetch failed: ${res.error}`);
    }

    let ingested = 0;
    let updated = 0;
    let skipped = 0;

    for (const inj of res.data) {
      try {
        // Ensure team exists
        // Module 2: normalize team name (decode HTML entities)
        const teamName = normalizeName(inj.team.name) || inj.team.name;
        const team = await db.team.upsert({
          where: { apiFootballId: inj.team.id },
          create: {
            apiFootballId: inj.team.id,
            name: teamName,
            logoUrl: inj.team.logo,
            sourceConfidence: validateSourceConfidence(0.6),
          },
          update: { name: teamName, logoUrl: inj.team.logo },
        });

        // Ensure player exists — note: type/reason are on the player object
        // Module 2: normalize player name (decode HTML entities like &apos;)
        const playerName = normalizeName(inj.player.name) || inj.player.name;
        const player = await db.player.upsert({
          where: { apiFootballId: inj.player.id },
          create: {
            apiFootballId: inj.player.id,
            teamId: team.id,
            name: playerName,
            photoUrl: inj.player.photo,
            sourceConfidence: validateSourceConfidence(0.6),
          },
          update: {
            teamId: team.id,
            name: playerName,
            photoUrl: inj.player.photo,
          },
        });

        // The API returns fixture-level absence records. Each record = "this
        // player missed this fixture for this reason." We store one Injury
        // row per (player, fixture, reason) combination.
        //
        // Map API fields to our schema:
        //   player.type  → type   ("Missing Fixture", "Injury", "Suspension")
        //   player.reason → reason ("Ankle Injury", "Yellow Cards", etc.)
        //   fixture.date  → startDate (the date of the fixture missed)
        //   status        → "active" (all records are historical absences)
        //   expectedReturn → null (not provided by this endpoint)

        const injuryType = normalizeName(inj.player.type) || "Unknown";
        const injuryReason = normalizeName(inj.player.reason) || "Unknown";
        // Module 2: normalize fixture date to UTC
        const fixtureDate = normalizeTimestampToUtc(inj.fixture?.date);

        // Dedup key: (player, fixture, reason) — if the same player missed
        // the same fixture for the same reason, it's a duplicate record.
        // We use (playerId, type, reason, startDate) as the lookup since
        // we don't store fixtureId on the Injury model yet.
        const existing = await db.injury.findFirst({
          where: {
            playerId: player.id,
            type: injuryType,
            reason: injuryReason,
            startDate: fixtureDate,
          },
        });

        if (existing) {
          // Already have this absence recorded — skip (not an error)
          skipped++;
        } else {
          await db.injury.create({
            data: {
              playerId: player.id,
              teamId: team.id,
              type: injuryType,
              reason: injuryReason,
              status: "active",
              startDate: fixtureDate,
              sourceConfidence: validateSourceConfidence(0.85),
            },
          });
          ingested++;
        }
      } catch (err) {
        logger.warn("injury upsert failed", {
          apiFootballId: inj.player.id,
          playerName: inj.player.name,
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
