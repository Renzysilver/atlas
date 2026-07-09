// ATLAS API — brainos/decisionEngine.ts
// Module 5 — Prediction Decision Engine (spec Section 9)
//
// Per spec Section 9: "Combines active layers → Final Probability
// (Home/Draw/Away, Over/Under, BTTS) → Final Recommendation with explicit
// confidence tier (see Module 7)."
//
// This engine takes the Consensus Engine output (1X2 probabilities) +
// Simulation Intelligence output (expected goals) and derives:
//   1. 1X2 market prediction (from consensus)
//   2. Over/Under 2.5 goals prediction (from simulation expected goals)
//   3. BTTS (Both Teams To Score) prediction (from simulation expected goals)
//
// Each prediction gets a recommendation profile:
//   - Ultra Safe: confidence ≥ 0.75 AND probability ≥ 0.65
//   - Balanced: confidence ≥ 0.55 AND probability ≥ 0.50
//   - High Risk: everything else with a real prediction
//   - High Value: DISABLED until Market Intelligence activates (per spec S.11)
//
// Per spec Section 11: "do not fake a 'value bet' claim without real market
// odds to compare against; that's the one output that could cause real
// financial harm if faked."

import { db } from "../lib/db.ts";
import { logger } from "../lib/logger.ts";
import type { LayerOutput } from "@atlas/shared";
import type { ConsensusResult } from "../layers/consensusEngine.ts";

// ============================================================
// Types
// ============================================================

export type MarketType = "1X2" | "O_U_2_5" | "BTTS";
export type RecommendationProfile = "high_consensus" | "moderate_consensus" | "low_consensus" | "high_value";

export interface MarketPrediction {
  marketType: MarketType;
  selection: string;
  probability: number;
  confidence: number;
  recommendationProfile: RecommendationProfile | null;
  reasoning: string;
  valueScore: null; // always null until Market Intelligence activates
  riskScore: null; // computed by Module 7
  volatility: null; // computed by Module 7
}

export interface DecisionEngineResult {
  predictions: MarketPrediction[];
  summary: string;
}

// ============================================================
// Recommendation profile classification
// ============================================================
// Per spec Section 11 + Module 7: build classification logic now.
// High Value tier stays DISABLED until Market Intelligence is active.

export function classifyRecommendationProfile(
  probability: number,
  confidence: number,
): RecommendationProfile {
  // IMPORTANT (per Vali directive): these labels measure LAYER CONSENSUS,
  // not prediction accuracy. A "high_consensus" prediction can still be wrong
  // if all layers share the same blind spot. Accuracy is tracked separately
  // by Module 8 (Learning Intelligence) after matches complete.
  //
  // High Value tier is DISABLED — would need Value Score from Market Intelligence.
  // When high_value activates, its disclaimer must clarify it measures
  // AI-vs-market disagreement, not accuracy (same category of distinction).

  if (confidence >= 0.75 && probability >= 0.65) {
    return "high_consensus";
  }
  if (confidence >= 0.55 && probability >= 0.50) {
    return "moderate_consensus";
  }
  return "low_consensus";
}

// ============================================================
// Poisson helpers (for O/U and BTTS derivation)
// ============================================================

function poissonPmf(k: number, lambda: number): number {
  // P(X = k) = e^(-λ) × λ^k / k!
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
}

function factorial(n: number): number {
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

function poissonCdf(k: number, lambda: number): number {
  // P(X ≤ k) = Σ(i=0 to k) e^(-λ) × λ^i / i!
  let sum = 0;
  for (let i = 0; i <= k; i++) {
    sum += poissonPmf(i, lambda);
  }
  return sum;
}

// ============================================================
// Market prediction computations
// ============================================================

function compute1X2Prediction(consensus: ConsensusResult): MarketPrediction {
  const { homeWinProbability, drawProbability, awayWinProbability, confidence } = consensus;

  // Selection = highest probability outcome
  let selection: string;
  let probability: number;
  if (homeWinProbability >= drawProbability && homeWinProbability >= awayWinProbability) {
    selection = "HOME";
    probability = homeWinProbability;
  } else if (awayWinProbability >= drawProbability) {
    selection = "AWAY";
    probability = awayWinProbability;
  } else {
    selection = "DRAW";
    probability = drawProbability;
  }

  const profile = classifyRecommendationProfile(probability, confidence ?? 0);

  const reasoning = [
    `1X2 market prediction (from consensus)`,
    `Home: ${(homeWinProbability * 100).toFixed(1)}% | Draw: ${(drawProbability * 100).toFixed(1)}% | Away: ${(awayWinProbability * 100).toFixed(1)}%`,
    `Selection: ${selection} (${(probability * 100).toFixed(1)}%)`,
    `Confidence: ${confidence?.toFixed(3) ?? "null"}`,
    `Recommendation: ${profile}`,
    profile === "high_consensus"
      ? "High consensus: layers strongly agreed + high confidence (NOT a guarantee of correctness)"
      : profile === "moderate_consensus"
        ? "Moderate consensus: moderate agreement + moderate confidence"
        : "Low consensus: layers disagreed OR low confidence — proceed with caution",
  ].join("\n");

  return {
    marketType: "1X2",
    selection,
    probability,
    confidence: confidence ?? 0,
    recommendationProfile: profile,
    reasoning,
    valueScore: null,
    riskScore: null,
    volatility: null,
  };
}

function computeOverUnderPrediction(
  simulationOutput: LayerOutput | undefined,
  consensusConfidence: number | null,
): MarketPrediction {
  // Need the simulation layer's expected goals
  // The simulation reasoning contains "Expected goals: Home X.XX, Away Y.YY"
  // Parse it from the reasoning text (the simulation layer stores it there)

  if (!simulationOutput || simulationOutput.status !== "active" || !simulationOutput.reasoning) {
    return {
      marketType: "O_U_2_5",
      selection: "OVER_2_5",
      probability: 0,
      confidence: 0,
      recommendationProfile: null,
      reasoning:
        "Over/Under 2.5 prediction requires Simulation Intelligence output. " +
        "Simulation layer returned insufficient_data — cannot compute expected goals. " +
        "Per Constitution Rule 4: do not fabricate goal expectations.",
      valueScore: null,
      riskScore: null,
      volatility: null,
    };
  }

  // Parse expected goals from simulation reasoning
  // Format: "Expected goals: Liverpool 0.56, Arsenal 0.45"
  const goalsMatch = simulationOutput.reasoning.match(
    /Expected goals:.*?([\d.]+).*?([\d.]+)/,
  );
  if (!goalsMatch) {
    return {
      marketType: "O_U_2_5",
      selection: "OVER_2_5",
      probability: 0,
      confidence: 0,
      recommendationProfile: null,
      reasoning: "Could not parse expected goals from simulation output.",
      valueScore: null,
      riskScore: null,
      volatility: null,
    };
  }

  const homeExpectedGoals = parseFloat(goalsMatch[1]);
  const awayExpectedGoals = parseFloat(goalsMatch[2]);
  const totalExpectedGoals = homeExpectedGoals + awayExpectedGoals;

  // P(over 2.5) = 1 - P(X ≤ 2) where X ~ Poisson(totalExpectedGoals)
  const pUnder25 = poissonCdf(2, totalExpectedGoals);
  const pOver25 = 1 - pUnder25;

  const selection = pOver25 >= 0.5 ? "OVER_2_5" : "UNDER_2_5";
  const probability = Math.max(pOver25, 1 - pOver25);
  const confidence = (consensusConfidence ?? 0.5) * (simulationOutput.confidence ?? 0.8);
  const profile = classifyRecommendationProfile(probability, confidence);

  const reasoning = [
    `Over/Under 2.5 goals prediction (from simulation expected goals)`,
    `Expected goals: Home ${homeExpectedGoals.toFixed(2)}, Away ${awayExpectedGoals.toFixed(2)}, Total ${totalExpectedGoals.toFixed(2)}`,
    `P(Under 2.5) = ${(pUnder25 * 100).toFixed(1)}% | P(Over 2.5) = ${(pOver25 * 100).toFixed(1)}%`,
    `Selection: ${selection} (${(probability * 100).toFixed(1)}%)`,
    `Confidence: ${confidence.toFixed(3)} (consensus × simulation)`,
    `Recommendation: ${profile}`,
  ].join("\n");

  return {
    marketType: "O_U_2_5",
    selection,
    probability,
    confidence,
    recommendationProfile: profile,
    reasoning,
    valueScore: null,
    riskScore: null,
    volatility: null,
  };
}

function computeBttsPrediction(
  simulationOutput: LayerOutput | undefined,
  consensusConfidence: number | null,
): MarketPrediction {
  if (!simulationOutput || simulationOutput.status !== "active" || !simulationOutput.reasoning) {
    return {
      marketType: "BTTS",
      selection: "BTTS_YES",
      probability: 0,
      confidence: 0,
      recommendationProfile: null,
      reasoning:
        "BTTS prediction requires Simulation Intelligence output. " +
        "Simulation layer returned insufficient_data — cannot compute expected goals.",
      valueScore: null,
      riskScore: null,
      volatility: null,
    };
  }

  // Parse expected goals from simulation reasoning
  const goalsMatch = simulationOutput.reasoning.match(
    /Expected goals:.*?([\d.]+).*?([\d.]+)/,
  );
  if (!goalsMatch) {
    return {
      marketType: "BTTS",
      selection: "BTTS_YES",
      probability: 0,
      confidence: 0,
      recommendationProfile: null,
      reasoning: "Could not parse expected goals from simulation output.",
      valueScore: null,
      riskScore: null,
      volatility: null,
    };
  }

  const homeExpectedGoals = parseFloat(goalsMatch[1]);
  const awayExpectedGoals = parseFloat(goalsMatch[2]);

  // P(home scores ≥1) = 1 - P(home scores 0) = 1 - e^(-homeExpectedGoals)
  const pHomeScores = 1 - Math.exp(-homeExpectedGoals);
  const pAwayScores = 1 - Math.exp(-awayExpectedGoals);

  // P(BTTS yes) = P(home scores) × P(away scores) — assuming independence
  const pBttsYes = pHomeScores * pAwayScores;
  const pBttsNo = 1 - pBttsYes;

  const selection = pBttsYes >= 0.5 ? "BTTS_YES" : "BTTS_NO";
  const probability = Math.max(pBttsYes, pBttsNo);
  const confidence = (consensusConfidence ?? 0.5) * (simulationOutput.confidence ?? 0.8);
  const profile = classifyRecommendationProfile(probability, confidence);

  const reasoning = [
    `BTTS (Both Teams To Score) prediction (from simulation expected goals)`,
    `Expected goals: Home ${homeExpectedGoals.toFixed(2)}, Away ${awayExpectedGoals.toFixed(2)}`,
    `P(home scores) = ${(pHomeScores * 100).toFixed(1)}% | P(away scores) = ${(pAwayScores * 100).toFixed(1)}%`,
    `P(BTTS Yes) = ${(pBttsYes * 100).toFixed(1)}% | P(BTTS No) = ${(pBttsNo * 100).toFixed(1)}%`,
    `Selection: ${selection} (${(probability * 100).toFixed(1)}%)`,
    `Confidence: ${confidence.toFixed(3)} (consensus × simulation)`,
    `Recommendation: ${profile}`,
  ].join("\n");

  return {
    marketType: "BTTS",
    selection,
    probability,
    confidence,
    recommendationProfile: profile,
    reasoning,
    valueScore: null,
    riskScore: null,
    volatility: null,
  };
}

// ============================================================
// Main decision engine function
// ============================================================

export async function runDecisionEngine(
  consensus: ConsensusResult,
  layerOutputs: LayerOutput[],
  matchId: string,
): Promise<DecisionEngineResult> {
  logger.info("decision engine: computing 3 market predictions", { matchId });

  // Find the simulation layer output (for O/U and BTTS)
  const simulationOutput = layerOutputs.find((l) => l.layer_name === "simulation_intelligence");

  // Compute all 3 market predictions
  const prediction1X2 = compute1X2Prediction(consensus);
  const predictionOU = computeOverUnderPrediction(simulationOutput, consensus.confidence);
  const predictionBtts = computeBttsPrediction(simulationOutput, consensus.confidence);

  const predictions = [prediction1X2, predictionOU, predictionBtts];

  // Build summary
  const summary = [
    `Decision Engine produced 3 market predictions:`,
    `  1X2: ${prediction1X2.selection} (${(prediction1X2.probability * 100).toFixed(1)}%) — ${prediction1X2.recommendationProfile}`,
    `  O/U 2.5: ${predictionOU.selection} (${(predictionOU.probability * 100).toFixed(1)}%) — ${predictionOU.recommendationProfile ?? "N/A"}`,
    `  BTTS: ${predictionBtts.selection} (${(predictionBtts.probability * 100).toFixed(1)}%) — ${predictionBtts.recommendationProfile ?? "N/A"}`,
    `High Value tier: DISABLED (requires Market Intelligence for value score — per spec Section 11)`,
  ].join("\n");

  logger.info("decision engine: complete", {
    matchId,
    "1X2": `${prediction1X2.selection} ${(prediction1X2.probability * 100).toFixed(1)}%`,
    "O/U": `${predictionOU.selection} ${(predictionOU.probability * 100).toFixed(1)}%`,
    "BTTS": `${predictionBtts.selection} ${(predictionBtts.probability * 100).toFixed(1)}%`,
  });

  return { predictions, summary };
}

// ============================================================
// Persist predictions to DB
// ============================================================

export async function persistPredictions(
  matchId: string,
  predictions: MarketPrediction[],
  consensus: ConsensusResult,
  layerOutputs: LayerOutput[],
): Promise<void> {
  for (const pred of predictions) {
    // Find existing prediction for this match + market (or create)
    const existing = await db.prediction.findFirst({
      where: { matchId, marketType: pred.marketType },
    });

    const consensusInputsJson = JSON.stringify({
      consensus: {
        score: consensus.score,
        confidence: consensus.confidence,
        homeWinProb: consensus.homeWinProbability,
        drawProb: consensus.drawProbability,
        awayWinProb: consensus.awayWinProbability,
        agreement: consensus.agreementScore,
      },
      layers: layerOutputs.map((l) => ({
        layer: l.layer_name,
        status: l.status,
        score: l.score,
        confidence: l.confidence,
      })),
      marketReasoning: pred.reasoning,
    });

    if (existing) {
      await db.prediction.update({
        where: { id: existing.id },
        data: {
          selection: pred.selection,
          probability: pred.probability,
          confidence: pred.confidence,
          recommendationProfile: pred.recommendationProfile,
          valueScore: pred.valueScore,
          riskScore: pred.riskScore,
          volatility: pred.volatility,
          consensusInputsJson,
        },
      });
    } else {
      await db.prediction.create({
        data: {
          matchId,
          marketType: pred.marketType,
          selection: pred.selection,
          probability: pred.probability,
          confidence: pred.confidence,
          recommendationProfile: pred.recommendationProfile,
          valueScore: pred.valueScore,
          riskScore: pred.riskScore,
          volatility: pred.volatility,
          consensusInputsJson,
        },
      });
    }
  }
}
