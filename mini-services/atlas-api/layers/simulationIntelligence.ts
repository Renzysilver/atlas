// ATLAS API — layers/simulationIntelligence.ts
// Layer 12 of 17 — Simulation Intelligence (🟢 ACTIVE, Monte Carlo)
//
// Per spec Section 3: "Python Monte Carlo engine — this is the core deliverable"
// Per spec Section 2: "Simulation engine: Python microservice (FastAPI)"
//
// SANDBOX NOTE: The spec calls for a Python FastAPI microservice. In the
// sandbox, we implement the Monte Carlo in TypeScript for simplicity. The
// interface (inputs → probability distribution) is identical, so swapping
// to a Python sidecar in production is a drop-in replacement.
//
// Per Vali directive: confidence scales with input coverage. Uses
// attack_rating × defensive_stability to simulate goals. possession_rating
// and goal_threat missing on free tier reduces simulation nuance but the
// core Monte Carlo still produces real probabilities.

import { db } from "../lib/db.ts";
import type { LayerOutput } from "@atlas/shared";
import { BaseLayer, type LayerContext, type LayerDefinition, checkFeatureAvailability, scaleConfidence } from "./base.ts";

const BASE_CONFIDENCE = 0.90;
const SIMULATION_RUNS = 1000;

// Features used for simulation
const EXPECTED_FEATURES = [
  "attack_rating",
  "defensive_stability",
  "home_record_strength",
  "away_record_strength",
  "possession_rating",  // often missing on free tier
  "goal_threat",        // often missing on free tier
] as const;

export class SimulationIntelligenceLayer extends BaseLayer {
  readonly definition: LayerDefinition = {
    name: "simulation_intelligence",
    layerNumber: 12,
    description: "Monte Carlo simulation of match outcomes (1000 runs)",
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

    // Check feature availability
    const homeAvail = checkFeatureAvailability(ctx.homeTeamFeatures, EXPECTED_FEATURES as unknown as string[]);
    const awayAvail = checkFeatureAvailability(ctx.awayTeamFeatures, EXPECTED_FEATURES as unknown as string[]);

    // Need at minimum attack_rating and defensive_stability for both teams
    const requiredFeatures = ["attack_rating", "defensive_stability"];
    const homeHasRequired = requiredFeatures.every(
      (f) => ctx.homeTeamFeatures[f]?.value !== null && ctx.homeTeamFeatures[f]?.status === "active",
    );
    const awayHasRequired = requiredFeatures.every(
      (f) => ctx.awayTeamFeatures[f]?.value !== null && ctx.awayTeamFeatures[f]?.status === "active",
    );

    if (!homeHasRequired || !awayHasRequired) {
      const missingTeam = !homeHasRequired ? homeName : awayName;
      return this.insufficientOutput(
        this.definition.name,
        `Missing required features (attack_rating, defensive_stability) for ${missingTeam}. ` +
          `Cannot run Monte Carlo simulation without goal-scoring baseline. ` +
          `Run feature engineering first.`,
      );
    }

    // Get feature values
    const homeAttack = ctx.homeTeamFeatures["attack_rating"].value!;
    const homeDefense = ctx.homeTeamFeatures["defensive_stability"].value!;
    const awayAttack = ctx.awayTeamFeatures["attack_rating"].value!;
    const awayDefense = ctx.awayTeamFeatures["defensive_stability"].value!;

    // Home advantage bonus (typically 0.1-0.15)
    const homeAdvantage = 0.1;
    const homeRecord = ctx.homeTeamFeatures["home_record_strength"];
    const awayRecord = ctx.homeTeamFeatures["away_record_strength"];
    const homeRecordBonus = homeRecord?.status === "active" ? (homeRecord.value! - 0.5) * 0.1 : 0;
    const awayRecordBonus = awayRecord?.status === "active" ? (awayRecord.value! - 0.5) * 0.1 : 0;

    // Expected goals: attack × (1 - opponent defense) × home advantage
    // attack_rating is 0-1, defensive_stability is 0-1 (higher = better defense)
    // Expected goals range: 0-3 typically
    const homeExpectedGoals = Math.max(0.1, homeAttack * (1 - awayDefense) * 2.5 + homeAdvantage + homeRecordBonus);
    const awayExpectedGoals = Math.max(0.1, awayAttack * (1 - homeDefense) * 2.5 + awayRecordBonus);

    // Monte Carlo simulation
    let homeWins = 0;
    let draws = 0;
    let awayWins = 0;
    let totalHomeGoals = 0;
    let totalAwayGoals = 0;

    for (let i = 0; i < SIMULATION_RUNS; i++) {
      // Poisson-distributed goals (simplified — use Math.random for sandbox)
      const homeGoals = this.poissonRandom(homeExpectedGoals);
      const awayGoals = this.poissonRandom(awayExpectedGoals);

      totalHomeGoals += homeGoals;
      totalAwayGoals += awayGoals;

      if (homeGoals > awayGoals) homeWins++;
      else if (homeGoals < awayGoals) awayWins++;
      else draws++;
    }

    // Score = home win probability (from 1X2 market perspective)
    const score = homeWins / SIMULATION_RUNS;
    const drawProb = draws / SIMULATION_RUNS;
    const awayProb = awayWins / SIMULATION_RUNS;

    // Confidence scales with feature coverage
    const avgCoverage = (homeAvail.coverageRatio + awayAvail.coverageRatio) / 2;
    const scaledConfidence = scaleConfidence(BASE_CONFIDENCE, avgCoverage);

    const interpretation = score > 0.45
      ? `${homeName} favored by simulation`
      : score < 0.30
        ? `${awayName} favored by simulation`
        : "Simulation suggests close match";

    const missingFeatures = [...new Set([...homeAvail.missing, ...awayAvail.missing])];

    const reasoning = [
      `${interpretation} (score: ${score.toFixed(3)} = home win probability)`,
      `Simulation: ${SIMULATION_RUNS} runs`,
      `Outcome distribution:`,
      `  ${homeName} win: ${(score * 100).toFixed(1)}% (${homeWins}/${SIMULATION_RUNS})`,
      `  Draw: ${(drawProb * 100).toFixed(1)}% (${draws}/${SIMULATION_RUNS})`,
      `  ${awayName} win: ${(awayProb * 100).toFixed(1)}% (${awayWins}/${SIMULATION_RUNS})`,
      `Expected goals: ${homeName} ${homeExpectedGoals.toFixed(2)}, ${awayName} ${awayExpectedGoals.toFixed(2)}`,
      `Avg simulated goals: ${homeName} ${(totalHomeGoals / SIMULATION_RUNS).toFixed(2)}, ${awayName} ${(totalAwayGoals / SIMULATION_RUNS).toFixed(2)}`,
      `Features used:`,
      `  ${homeName} attack_rating: ${homeAttack.toFixed(3)}, defensive_stability: ${homeDefense.toFixed(3)}`,
      `  ${awayName} attack_rating: ${awayAttack.toFixed(3)}, defensive_stability: ${awayDefense.toFixed(3)}`,
      homeRecord?.status === "active" ? `  ${homeName} home_record_strength: ${homeRecord.value!.toFixed(3)}` : undefined,
      awayRecord?.status === "active" ? `  ${awayName} away_record_strength: ${awayRecord.value!.toFixed(3)}` : undefined,
      missingFeatures.length > 0
        ? `Features missing (insufficient_data): ${missingFeatures.join(", ")}`
        : undefined,
      `Confidence: ${scaledConfidence.toFixed(3)} (base ${BASE_CONFIDENCE} × coverage ${Math.round(avgCoverage * 100)}%)`,
      missingFeatures.length > 0
        ? `Note: simulation runs on goals-based model only; missing features reduce xG nuance`
        : undefined,
    ].filter((n): n is string => n !== undefined).join("\n");

    return this.activeOutput(this.definition.name, score, scaledConfidence, reasoning);
  }

  /**
   * Poisson random number generator (Knuth's algorithm).
   * Returns a non-negative integer representing goals scored.
   */
  private poissonRandom(lambda: number): number {
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= Math.random();
    } while (p > L);
    return k - 1;
  }
}
