// ATLAS API — layers/teamIntelligence.ts
// Layer 1 of 17 — Team Intelligence (🟢 ACTIVE, deterministic stats)
//
// Per spec Section 3: "weighted formula over form/goals/possession"
// Per Vali directive: confidence scales with input coverage. possession_rating
// and goal_threat are insufficient_data on free tier, so confidence is reduced
// but the layer STAYS 🟢 ACTIVE.
//
// Score interpretation: probability that home team wins based on team strength
// differential. 0.5 = even match, >0.5 = home advantage, <0.5 = away advantage.

import { db } from "../lib/db.ts";
import type { LayerOutput } from "@atlas/shared";
import { BaseLayer, type LayerContext, type LayerDefinition, checkFeatureAvailability, scaleConfidence, generateSpecificReasoning } from "./base.ts";

const EXPECTED_FEATURES = [
  "team_strength",
  "attack_rating",
  "defensive_stability",
  "home_record_strength", // home team uses this
  "away_record_strength", // away team uses this
  "possession_rating",    // often missing on free tier
  "goal_threat",          // often missing on free tier
] as const;

const BASE_CONFIDENCE = 0.85;

export class TeamIntelligenceLayer extends BaseLayer {
  readonly definition: LayerDefinition = {
    name: "team_intelligence",
    layerNumber: 1,
    description: "Weighted formula over team strength, attack, defense, form, possession",
    buildStatus: "active",
    feedsConsensus: true,
  };

  async compute(ctx: LayerContext): Promise<LayerOutput> {
    // Load team names for reasoning
    const [homeTeam, awayTeam] = await Promise.all([
      db.team.findUnique({ where: { id: ctx.homeTeamId } }),
      db.team.findUnique({ where: { id: ctx.awayTeamId } }),
    ]);
    const homeName = homeTeam?.name || "Home";
    const awayName = awayTeam?.name || "Away";

    // Check feature availability for both teams
    const homeAvail = checkFeatureAvailability(ctx.homeTeamFeatures, EXPECTED_FEATURES as unknown as string[]);
    const awayAvail = checkFeatureAvailability(ctx.awayTeamFeatures, EXPECTED_FEATURES as unknown as string[]);

    // If NO features are available for either team, return insufficient_data
    if (homeAvail.available.length === 0 && awayAvail.available.length === 0) {
      return this.insufficientOutput(
        this.definition.name,
        `No team features available for ${homeName} or ${awayName}. Run feature engineering first.`,
      );
    }

    // Compute score from available features
    // Score = weighted average of (home_feature - away_feature) normalized to 0-1
    // Where 0.5 = even, >0.5 = home advantage
    let scoreSum = 0;
    let weightSum = 0;
    const homeFeaturesUsed: Array<{ name: string; value: number }> = [];
    const awayFeaturesUsed: Array<{ name: string; value: number }> = [];

    // Use home_record_strength for home team, away_record_strength for away team
    const homeFeatureWeights: Record<string, number> = {
      team_strength: 0.25,
      attack_rating: 0.20,
      defensive_stability: 0.20,
      home_record_strength: 0.20,
      possession_rating: 0.10,
      goal_threat: 0.05,
    };
    const awayFeatureWeights: Record<string, number> = {
      team_strength: 0.25,
      attack_rating: 0.20,
      defensive_stability: 0.20,
      away_record_strength: 0.20,
      possession_rating: 0.10,
      goal_threat: 0.05,
    };

    for (const featName of Object.keys(homeFeatureWeights)) {
      const homeFeat = ctx.homeTeamFeatures[featName];
      const awayFeat = ctx.awayTeamFeatures[featName];
      if (homeFeat?.value !== null && homeFeat?.value !== undefined &&
          awayFeat?.value !== null && awayFeat?.value !== undefined &&
          homeFeat.status === "active" && awayFeat.status === "active") {
        const weight = homeFeatureWeights[featName];
        // Normalize difference to 0-1 range (0.5 = even)
        const diff = homeFeat.value - awayFeat.value;
        const normalized = 0.5 + diff * 0.5; // shift so 0.5 is even
        scoreSum += normalized * weight;
        weightSum += weight;
        homeFeaturesUsed.push({ name: featName, value: homeFeat.value });
        awayFeaturesUsed.push({ name: featName, value: awayFeat.value });
      }
    }

    if (weightSum === 0) {
      return this.insufficientOutput(
        this.definition.name,
        `No matching active features between ${homeName} and ${awayName}. Both teams need feature engineering.`,
      );
    }

    const score = scoreSum / weightSum;

    // Scale confidence based on coverage
    const avgCoverage = (homeAvail.coverageRatio + awayAvail.coverageRatio) / 2;
    const scaledConfidence = scaleConfidence(BASE_CONFIDENCE, avgCoverage);

    const interpretation = score > 0.55
      ? `${homeName} favored`
      : score < 0.45
        ? `${awayName} favored`
        : "Even match";

    const reasoning = generateSpecificReasoning({
      layerName: this.definition.name,
      homeTeamName: homeName,
      awayTeamName: awayName,
      homeFeaturesUsed,
      awayFeaturesUsed,
      homeFeaturesMissing: homeAvail.missing,
      awayFeaturesMissing: awayAvail.missing,
      homeCoverage: homeAvail.coverageRatio,
      awayCoverage: awayAvail.coverageRatio,
      baseConfidence: BASE_CONFIDENCE,
      scaledConfidence,
      score,
      scoreInterpretation: interpretation,
      extraNotes: [
        `Weighted formula: ${weightSum.toFixed(2)} of expected ${(0.25+0.20+0.20+0.20+0.10+0.05).toFixed(2)} weight applied`,
        homeAvail.missing.length > 0 ? `Missing features reduce confidence — free-tier limitation` : undefined,
      ].filter((n): n is string => n !== undefined),
    });

    return this.activeOutput(this.definition.name, score, scaledConfidence, reasoning);
  }
}
