// ATLAS API — layers/historicalIntelligence.ts
// Layer 9 of 17 — Historical Intelligence (🟢 ACTIVE, deterministic, reduced confidence)
//
// Per spec Section 3: "query past matches with similar feature vectors"
// Per Vali directive: confidence scales with input coverage. Uses H2H records
// + past match results. possession_rating and goal_threat missing on free tier
// reduces the feature vector for similarity matching.
//
// Simplified model for Phase 1:
//   - Look up HeadToHead record between the two teams
//   - Compute win probability based on historical H2H outcomes
//   - If no H2H data, fall back to overall season form comparison

import { db } from "../lib/db.ts";
import type { LayerOutput } from "@atlas/shared";
import { BaseLayer, type LayerContext, type LayerDefinition, checkFeatureAvailability, scaleConfidence, generateSpecificReasoning } from "./base.ts";

const EXPECTED_FEATURES = [
  "team_strength",
  "attack_rating",
  "defensive_stability",
  "possession_rating",  // often missing on free tier
  "goal_threat",        // often missing on free tier
] as const;

const BASE_CONFIDENCE = 0.85;

export class HistoricalIntelligenceLayer extends BaseLayer {
  readonly definition: LayerDefinition = {
    name: "historical_intelligence",
    layerNumber: 9,
    description: "Query past matches with similar feature vectors (H2H + form)",
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

    // Look up H2H record (canonical ordering: team1Id < team2Id)
    const [team1Id, team2Id] = ctx.homeTeamId < ctx.awayTeamId
      ? [ctx.homeTeamId, ctx.awayTeamId]
      : [ctx.awayTeamId, ctx.homeTeamId];
    const isHomeTeam1 = ctx.homeTeamId < ctx.awayTeamId;

    const h2h = await db.headToHead.findUnique({
      where: { team1Id_team2Id: { team1Id, team2Id } },
    });

    let score: number;
    let h2hNote: string;
    let confidenceFromH2H: number;

    if (h2h && h2h.matchesPlayed > 0) {
      // Use H2H record directly
      const team1WinRate = h2h.team1Wins / h2h.matchesPlayed;
      const drawRate = h2h.draws / h2h.matchesPlayed;
      // Convert to home win probability
      // If home is team1: home win = team1WinRate, plus half the draws
      // If home is team2: home win = (1 - team1WinRate - drawRate), plus half the draws
      const homeWinRate = isHomeTeam1
        ? team1WinRate + drawRate * 0.5
        : (1 - team1WinRate - drawRate) + drawRate * 0.5;

      score = homeWinRate;
      h2hNote = `H2H: ${h2h.matchesPlayed} matches, ${isHomeTeam1 ? homeName : awayName} (team1) won ${h2h.team1Wins}, ${h2h.draws} draws, ${isHomeTeam1 ? awayName : homeName} (team2) won ${h2h.team2Wins}. Last meeting: ${h2h.lastMeetingScore || "unknown"}`;
      // More H2H matches = higher confidence
      confidenceFromH2H = Math.min(1, h2h.matchesPlayed / 20);
    } else {
      // No H2H data — fall back to season form comparison
      const homeStrength = ctx.homeTeamFeatures["team_strength"];
      const awayStrength = ctx.awayTeamFeatures["team_strength"];

      if (homeStrength?.value === null || homeStrength?.value === undefined ||
          awayStrength?.value === null || awayStrength?.value === undefined) {
        return this.insufficientOutput(
          this.definition.name,
          `No H2H record between ${homeName} and ${awayName}, and no team_strength features available for form-based fallback. ` +
            `Run head_to_head collector (free-tier uses date-range query) and feature engineering.`,
        );
      }

      // Simple form comparison: 0.5 + (home - away) × 0.5
      score = 0.5 + (homeStrength.value - awayStrength.value) * 0.5;
      score = Math.max(0.1, Math.min(0.9, score));
      h2hNote = `No H2H record found — falling back to season form comparison (team_strength differential)`;
      confidenceFromH2H = 0.3; // lower confidence without H2H data
    }

    // Check feature coverage for similarity matching
    const homeAvail = checkFeatureAvailability(ctx.homeTeamFeatures, EXPECTED_FEATURES as unknown as string[]);
    const awayAvail = checkFeatureAvailability(ctx.awayTeamFeatures, EXPECTED_FEATURES as unknown as string[]);
    const avgCoverage = (homeAvail.coverageRatio + awayAvail.coverageRatio) / 2;

    // Combine H2H confidence with feature coverage confidence
    const scaledConfidence = scaleConfidence(BASE_CONFIDENCE, avgCoverage) * (0.6 + confidenceFromH2H * 0.4);

    const homeFeaturesUsed = homeAvail.available
      .map((name) => ({ name, value: ctx.homeTeamFeatures[name].value! }))
      .slice(0, 3); // top 3 for reasoning brevity
    const awayFeaturesUsed = awayAvail.available
      .map((name) => ({ name, value: ctx.awayTeamFeatures[name].value! }))
      .slice(0, 3);

    const interpretation = score > 0.55
      ? `${homeName} historically stronger`
      : score < 0.45
        ? `${awayName} historically stronger`
        : "Historically even";

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
      extraNotes: [h2hNote],
    });

    return this.activeOutput(this.definition.name, score, scaledConfidence, reasoning);
  }
}
