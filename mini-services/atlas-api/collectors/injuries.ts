// ATLAS API — collectors/injuries.ts
// 🟢 ACTIVE — but degrades to 🟡 STUB behavior if API-Football returns 403
// on the /injuries endpoint (free tier may not include it).
//
// Source: API-Football GET /injuries?league=39&season=2025
// Per spec Section 3 Layer 4 + Section 15: if endpoint is unavailable, the
// Injury Intelligence layer returns insufficient_data — do NOT fake injury
// list. This collector honors that by surfacing the unavailability.

import { db } from "../lib/db.ts";
import { apiFootball, isEndpointAvailable } from "../lib/apiFootball.ts";
import { logger } from "../lib/logger.ts";
import { EPL_LEAGUE_ID, EPL_SEASON } from "@atlas/shared";
import type { CollectorDefinition, CollectorRunResult } from "@atlas/shared";
import { BaseCollector } from "./base.ts";

const LEAGUE_ID = parseInt(process.env.API_FOOTBALL_LEAGUE_ID || String(EPL_LEAGUE_ID), 10);
const SEASON = parseInt(process.env.API_FOOTBALL_SEASON || String(EPL_SEASON), 10);

interface ApiFootballInjuryResponse {
  player: { id: number; name: string; photo: string };
  team: { id: number; name: string; logo: string };
  league: { id: number; name: string; season: number };
  fixture: { id: number | null };
  type: string;       // "injury" | "suspension" | "absent"
  date: string;       // ISO
  status: string;     // "active" | "recovered" | "returning"
  reason: string;     // e.g. "Hamstring strain"
  expected_return: string | null; // ISO date or null
}

export class InjuriesCollector extends BaseCollector {
  readonly definition: CollectorDefinition = {
    name: "injuries",
    description: "Active injuries & suspensions per team",
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
        const team = await db.team.upsert({
          where: { apiFootballId: inj.team.id },
          create: {
            apiFootballId: inj.team.id,
            name: inj.team.name,
            logoUrl: inj.team.logo,
            sourceConfidence: 0.6,
          },
          update: { name: inj.team.name, logoUrl: inj.team.logo },
        });

        // Ensure player exists
        const player = await db.player.upsert({
          where: { apiFootballId: inj.player.id },
          create: {
            apiFootballId: inj.player.id,
            teamId: team.id,
            name: inj.player.name,
            photoUrl: inj.player.photo,
            sourceConfidence: 0.6,
          },
          update: {
            teamId: team.id,
            name: inj.player.name,
            photoUrl: inj.player.photo,
          },
        });

        // Status mapping (API-Football: "active" | "recovered" | "returning")
        const status = ["active", "recovered", "returning"].includes(inj.status)
          ? inj.status
          : "active";

        const expectedReturn = inj.expected_return ? new Date(inj.expected_return) : null;

        const existing = await db.injury.findFirst({
          where: {
            playerId: player.id,
            type: inj.type,
            reason: inj.reason,
            startDate: new Date(inj.date),
          },
        });

        if (existing) {
          await db.injury.update({
            where: { id: existing.id },
            data: {
              status,
              expectedReturn: expectedReturn ?? undefined,
            },
          });
          updated++;
        } else {
          await db.injury.create({
            data: {
              playerId: player.id,
              teamId: team.id,
              type: inj.type,
              reason: inj.reason,
              status,
              startDate: new Date(inj.date),
              expectedReturn: expectedReturn ?? undefined,
              sourceConfidence: 0.85,
            },
          });
          ingested++;
        }
      } catch (err) {
        logger.warn("injury upsert failed", {
          apiFootballId: inj.player.id,
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
