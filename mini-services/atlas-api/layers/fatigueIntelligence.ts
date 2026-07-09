// ATLAS API — layers/fatigueIntelligence.ts
// Layer 10 of 17 — Fatigue Intelligence (🟢 ACTIVE, deterministic)
//
// Per spec Section 3: "days rest, fixture count in trailing 14 days"
// Uses the fatigue feature (Module 3) which computes days rest since
// last match for each team.

import { db } from "../lib/db.ts";
import type { LayerOutput } from "@atlas/shared";
import { BaseLayer, type LayerContext, type LayerDefinition } from "./base.ts";

const BASE_CONFIDENCE = 0.90;

export class FatigueIntelligenceLayer extends BaseLayer {
  readonly definition: LayerDefinition = {
    name: "fatigue_intelligence",
    layerNumber: 10,
    description: "Days rest + fixture count in trailing 14 days",
    buildStatus: "active",
    feedsConsensus: true,
  };

  async compute(ctx: LayerContext): Promise<LayerOutput> {
    const [homeTeam, awayTeam] = await Promise.all([
      db.team.findUnique({ where: { id: ctx.homeTeamId } }),
      db.team.findUnique({ where: { id: ctx.awayTeamId } }),
    ]);
    const homeName = homeTeam?.name || "Home";
    const awayName = awayTeam?.name || "Away";

    // Get fatigue features (match-level)
    const homeFatigue = ctx.homeMatchFeatures["fatigue"];
    const awayFatigue = ctx.awayMatchFeatures["fatigue"];

    // Also count fixtures in trailing 14 days
    const match = await db.match.findUnique({ where: { id: ctx.matchId } });
    if (!match) {
      return this.insufficientOutput(this.definition.name, "Match not found");
    }

    const fourteenDaysAgo = new Date(match.kickoffUtc.getTime() - 14 * 24 * 60 * 60 * 1000);
    const [homeFixtures14d, awayFixtures14d] = await Promise.all([
      db.match.count({
        where: {
          OR: [{ homeTeamId: ctx.homeTeamId }, { awayTeamId: ctx.homeTeamId }],
          kickoffUtc: { gte: fourteenDaysAgo, lt: match.kickoffUtc },
          status: "finished",
        },
      }),
      db.match.count({
        where: {
          OR: [{ homeTeamId: ctx.awayTeamId }, { awayTeamId: ctx.awayTeamId }],
          kickoffUtc: { gte: fourteenDaysAgo, lt: match.kickoffUtc },
          status: "finished",
        },
      }),
    ]);

    // If we have fatigue features, use them; otherwise use fixture count
    let score: number;
    let usedFeatures: string[] = [];

    if (homeFatigue?.value !== null && homeFatigue?.value !== undefined &&
        awayFatigue?.value !== null && awayFatigue?.value !== undefined &&
        homeFatigue.status === "active" && awayFatigue.status === "active") {
      // Both fatigue features available — use them
      // Higher fatigue value = more rest = advantage
      // Score = 0.5 + (home - away) × 0.4
      score = 0.5 + (homeFatigue.value - awayFatigue.value) * 0.4;
      score = Math.max(0.1, Math.min(0.9, score));
      usedFeatures = ["fatigue (home)", "fatigue (away)"];
    } else if (homeFixtures14d > 0 || awayFixtures14d > 0) {
      // Fall back to fixture count (more fixtures = more fatigued = disadvantage)
      // Normalize: 0-6 fixtures in 14 days is typical
      const homeLoad = Math.min(1, homeFixtures14d / 6);
      const awayLoad = Math.min(1, awayFixtures14d / 6);
      score = 0.5 + (awayLoad - homeLoad) * 0.3;
      score = Math.max(0.2, Math.min(0.8, score));
      usedFeatures = ["fixture_count_14d (home)", "fixture_count_14d (away)"];
    } else {
      return this.insufficientOutput(
        this.definition.name,
        `No fatigue features and no fixture history for ${homeName} or ${awayName} in the 14 days before this match. ` +
          `This is likely the first match of the season. Run feature engineering to compute fatigue.`,
      );
    }

    // Confidence: high if we have fatigue features, medium if only fixture count
    const hasFatigueFeatures = usedFeatures.includes("fatigue (home)");
    const scaledConfidence = hasFatigueFeatures ? BASE_CONFIDENCE : BASE_CONFIDENCE * 0.7;

    const interpretation = score > 0.55
      ? `${homeName} better rested`
      : score < 0.45
        ? `${awayName} better rested`
        : "Even rest";

    const fatigueHomeStr = homeFatigue?.value !== null && homeFatigue?.value !== undefined
      ? homeFatigue.value.toFixed(3)
      : "null";
    const fatigueAwayStr = awayFatigue?.value !== null && awayFatigue?.value !== undefined
      ? awayFatigue.value.toFixed(3)
      : "null";

    const reasoning = [
      `${interpretation} (score: ${score.toFixed(3)})`,
      `Features used:`,
      `  ${homeName} fatigue: ${fatigueHomeStr} (${homeFixtures14d} fixtures in last 14d)`,
      `  ${awayName} fatigue: ${fatigueAwayStr} (${awayFixtures14d} fixtures in last 14d)`,
      hasFatigueFeatures
        ? `Feature coverage: full (fatigue features active)`
        : `Feature coverage: partial (fatigue features missing, fell back to fixture count)`,
      `Confidence: ${scaledConfidence.toFixed(3)} (base ${BASE_CONFIDENCE}${hasFatigueFeatures ? "" : " × 0.7 fallback"})`,
    ].join("\n");

    return this.activeOutput(this.definition.name, score, scaledConfidence, reasoning);
  }
}
