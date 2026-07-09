// ATLAS API — jobs/featureEngineering.ts
// Module 3 — Feature Engineering job (spec Section 6)
//
// Computes all features for all teams and matches, writes to TeamFeature
// and MatchFeature tables. Runs after collectors + reconciliation so it
// has fresh data to work with.

import { db } from "../lib/db.ts";
import { logger } from "../lib/logger.ts";
import { EPL_SEASON } from "@atlas/shared";
import {
  FEATURE_REGISTRY,
  ACTIVE_FEATURES,
  STUB_FEATURES,
  type FeatureResult,
} from "../lib/features.ts";

const SEASON = parseInt(process.env.API_FOOTBALL_SEASON || String(EPL_SEASON), 10);

export interface FeatureEngineeringResult {
  status: "success" | "partial" | "failed";
  durationMs: number;
  teamsProcessed: number;
  matchesProcessed: number;
  seasonFeaturesComputed: number;
  matchFeaturesComputed: number;
  stubFeaturesCreated: number;
  insufficientDataCount: number;
  errors: string[];
}

export async function runFeatureEngineering(): Promise<FeatureEngineeringResult> {
  const startMs = Date.now();
  logger.info("feature engineering job started");

  const result: FeatureEngineeringResult = {
    status: "success",
    durationMs: 0,
    teamsProcessed: 0,
    matchesProcessed: 0,
    seasonFeaturesComputed: 0,
    matchFeaturesComputed: 0,
    stubFeaturesCreated: 0,
    insufficientDataCount: 0,
    errors: [],
  };

  try {
    // ============================================================
    // 1. SEASON-LEVEL FEATURES (TeamFeature)
    // ============================================================
    logger.info("feature engineering: computing season-level features");
    const teams = await db.team.findMany({
      where: {
        standings: { some: { season: SEASON } },
      },
    });

    logger.info("feature engineering: processing teams", { count: teams.length });

    for (const team of teams) {
      result.teamsProcessed++;

      for (const feature of FEATURE_REGISTRY.filter((f) => f.level === "season")) {
        try {
          const featureResult: FeatureResult = await feature.compute(team.id);

          await db.teamFeature.upsert({
            where: {
              teamId_season_featureName: {
                teamId: team.id,
                season: SEASON,
                featureName: feature.name,
              },
            },
            create: {
              teamId: team.id,
              season: SEASON,
              featureName: feature.name,
              value: featureResult.value,
              confidence: featureResult.confidence,
              status: featureResult.status,
              reason: featureResult.reason,
            },
            update: {
              value: featureResult.value,
              confidence: featureResult.confidence,
              status: featureResult.status,
              reason: featureResult.reason,
              computedAt: new Date(),
            },
          });

          if (featureResult.status === "active") {
            result.seasonFeaturesComputed++;
          } else if (featureResult.status === "stub") {
            result.stubFeaturesCreated++;
          } else {
            result.insufficientDataCount++;
          }
        } catch (err) {
          const errorMsg = `Team ${team.name} feature ${feature.name}: ${err instanceof Error ? err.message : String(err)}`;
          result.errors.push(errorMsg);
          logger.warn("feature computation failed", { error: errorMsg });
        }
      }
    }

    // ============================================================
    // 2. MATCH-SPECIFIC FEATURES (MatchFeature)
    // ============================================================
    logger.info("feature engineering: computing match-specific features");
    const matches = await db.match.findMany({
      where: { season: SEASON, status: "finished" },
    });

    logger.info("feature engineering: processing matches", { count: matches.length });

    for (const match of matches) {
      result.matchesProcessed++;

      // Compute match features for both home and away teams
      const teamIds = [match.homeTeamId, match.awayTeamId];

      for (const teamId of teamIds) {
        for (const feature of FEATURE_REGISTRY.filter((f) => f.level === "match")) {
          try {
            const featureResult: FeatureResult = await feature.compute(teamId, match.id);

            await db.matchFeature.upsert({
              where: {
                matchId_teamId_featureName: {
                  matchId: match.id,
                  teamId,
                  featureName: feature.name,
                },
              },
              create: {
                matchId: match.id,
                teamId,
                featureName: feature.name,
                value: featureResult.value,
                confidence: featureResult.confidence,
                status: featureResult.status,
                reason: featureResult.reason,
              },
              update: {
                value: featureResult.value,
                confidence: featureResult.confidence,
                status: featureResult.status,
                reason: featureResult.reason,
                computedAt: new Date(),
              },
            });

            if (featureResult.status === "active") {
              result.matchFeaturesComputed++;
            } else if (featureResult.status === "stub") {
              result.stubFeaturesCreated++;
            } else {
              result.insufficientDataCount++;
            }
          } catch (err) {
            const errorMsg = `Match ${match.id} team ${teamId} feature ${feature.name}: ${err instanceof Error ? err.message : String(err)}`;
            result.errors.push(errorMsg);
            logger.warn("match feature computation failed", { error: errorMsg });
          }
        }
      }
    }

    result.durationMs = Date.now() - startMs;
    result.status = result.errors.length > 0 ? "partial" : "success";

    logger.info("feature engineering job completed", {
      status: result.status,
      durationMs: result.durationMs,
      teamsProcessed: result.teamsProcessed,
      matchesProcessed: result.matchesProcessed,
      seasonFeatures: result.seasonFeaturesComputed,
      matchFeatures: result.matchFeaturesComputed,
      stubs: result.stubFeaturesCreated,
      insufficient: result.insufficientDataCount,
      errors: result.errors.length,
    });

    return result;
  } catch (err) {
    result.status = "failed";
    result.durationMs = Date.now() - startMs;
    result.errors.push(err instanceof Error ? err.message : String(err));
    logger.error("feature engineering job failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return result;
  }
}
