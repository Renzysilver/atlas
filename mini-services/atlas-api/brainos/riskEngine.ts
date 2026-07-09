// ATLAS API — brainos/riskEngine.ts
// Module 7 — Risk Management Engine (spec Section 11)
//
// Per spec Section 11: "Confidence + Risk + Volatility computed from active
// layer variance (not market data, since Market Intelligence is 🟡 in Phase 1).
// Value Score is 🟡 STUB until odds data is active — do not fake a 'value bet'
// claim without real market odds to compare against; that's the one output
// that could cause real financial harm if faked.
//
// Recommendation profiles (Ultra Safe / Balanced / High Value / High Risk):
// 🟢 build the classification logic now using confidence+risk thresholds;
// High Value tier stays disabled until Market Intelligence is active."
//
// This engine runs AFTER the Decision Engine (Module 5) and updates the
// 3 market predictions with risk fields:
//   - riskScore: 0-1 (higher = riskier prediction)
//   - volatility: 0-1 (higher = more layer disagreement)
//   - valueScore: always null until Market Intelligence activates (S.11)
//   - recommendationProfile: updated based on risk-adjusted confidence

import { db } from "../lib/db.ts";
import { logger } from "../lib/logger.ts";
import type { LayerOutput } from "@atlas/shared";
import type { ConsensusResult } from "../layers/consensusEngine.ts";
import type { MarketPrediction } from "./decisionEngine.ts";

// ============================================================
// Types
// ============================================================

export interface RiskAssessment {
  matchId: string;
  confidence: number; // from consensus
  riskScore: number; // 0-1, higher = riskier
  volatility: number; // 0-1, higher = more layer disagreement
  valueScore: null; // ALWAYS null until Market Intelligence activates
  valueScoreReason: string; // why value score is null
  recommendationProfile: string; // ultra_safe | balanced | high_risk (high_value disabled)
  reasoning: string;
  perMarketRisk: Array<{
    marketType: string;
    selection: string;
    probability: number;
    confidence: number;
    riskScore: number;
    volatility: number;
    recommendationProfile: string;
  }>;
}

// ============================================================
// Risk computation
// ============================================================

export async function runRiskEngine(
  consensus: ConsensusResult,
  layerOutputs: LayerOutput[],
  marketPredictions: MarketPrediction[],
  matchId: string,
): Promise<RiskAssessment> {
  logger.info("risk engine: computing risk assessment", { matchId });

  // Get active layers that fed consensus (exclude engine-level + insufficient)
  const activeLayers = layerOutputs.filter(
    (l) =>
      l.status === "active" &&
      l.score !== null &&
      l.layer_name !== "consensus_engine" &&
      l.layer_name !== "explainability_ai" &&
      l.layer_name !== "learning_intelligence",
  );

  // ============================================================
  // 1. VOLATILITY — from layer score variance
  // ============================================================
  // Per spec: "computed from active layer variance"
  // High variance = layers disagree = volatile prediction
  const scores = activeLayers.map((l) => l.score!);
  const meanScore = scores.reduce((a, b) => a + b, 0) / (scores.length || 1);
  const variance =
    scores.length > 0
      ? scores.reduce((sum, s) => sum + Math.pow(s - meanScore, 2), 0) / scores.length
      : 0;
  // Normalize variance to 0-1 (typical range 0-0.25, cap at 0.25 → 1.0)
  const volatility = Math.min(1, variance * 4);

  // ============================================================
  // 2. RISK SCORE — composite of volatility + confidence inverse + layer count
  // ============================================================
  // Per spec: "Confidence + Risk + Volatility computed from active layer variance"
  // Risk = high when: volatility is high, confidence is low, few layers active
  const confidenceInverse = 1 - (consensus.confidence ?? 0.5);
  const layerCountRisk = activeLayers.length < 5 ? (5 - activeLayers.length) / 5 : 0;
  // Weighted: volatility 50%, confidence inverse 35%, layer count 15%
  const riskScore = Math.min(
    1,
    volatility * 0.5 + confidenceInverse * 0.35 + layerCountRisk * 0.15,
  );

  // ============================================================
  // 3. VALUE SCORE — ALWAYS null until Market Intelligence activates
  // ============================================================
  // Per spec Section 11: "do not fake a 'value bet' claim without real market
  // odds to compare against; that's the one output that could cause real
  // financial harm if faked."
  const valueScore = null;
  const valueScoreReason =
    "Value Score requires real market odds from Market Intelligence (Layer 8). " +
    "ODDS_API_KEY not configured. Per spec Section 11: NEVER fabricate a value " +
    "bet claim without real odds — that's the one output that could cause real " +
    "financial harm if faked.";

  // ============================================================
  // 4. RECOMMENDATION PROFILE — risk-adjusted
  // ============================================================
  // Per spec Section 11: "build classification logic now using confidence+risk thresholds"
  // High Value tier DISABLED until Market Intelligence is active
  const riskAdjustedConfidence = (consensus.confidence ?? 0.5) * (1 - riskScore * 0.5);

  let recommendationProfile: string;
  if (riskAdjustedConfidence >= 0.75 && riskScore <= 0.3) {
    recommendationProfile = "ultra_safe";
  } else if (riskAdjustedConfidence >= 0.55 && riskScore <= 0.5) {
    recommendationProfile = "balanced";
  } else {
    recommendationProfile = "high_risk";
  }
  // high_value tier would go here when Market Intelligence activates:
  // if (valueScore !== null && valueScore > 0.15) recommendationProfile = "high_value";

  // ============================================================
  // 5. PER-MARKET RISK — apply risk to each market prediction
  // ============================================================
  const perMarketRisk = marketPredictions.map((mp) => {
    // Each market's risk is based on the global risk + market-specific confidence
    const marketRiskAdjustedConfidence = mp.confidence * (1 - riskScore * 0.5);
    let marketProfile: string;
    if (marketRiskAdjustedConfidence >= 0.75 && riskScore <= 0.3) {
      marketProfile = "ultra_safe";
    } else if (marketRiskAdjustedConfidence >= 0.55 && riskScore <= 0.5) {
      marketProfile = "balanced";
    } else {
      marketProfile = "high_risk";
    }

    return {
      marketType: mp.marketType,
      selection: mp.selection,
      probability: mp.probability,
      confidence: mp.confidence,
      riskScore,
      volatility,
      recommendationProfile: marketProfile,
    };
  });

  // ============================================================
  // 6. BUILD REASONING
  // ============================================================
  const reasoningParts: string[] = [
    `=== RISK MANAGEMENT ENGINE (Module 7 — spec Section 11) ===`,
    ``,
    `CONFIDENCE: ${(consensus.confidence ?? 0).toFixed(3)} (from consensus)`,
    `RISK SCORE: ${riskScore.toFixed(3)} (0=low risk, 1=high risk)`,
    `VOLATILITY: ${volatility.toFixed(3)} (0=high agreement, 1=high disagreement)`,
    `VALUE SCORE: null — ${valueScoreReason}`,
    `RECOMMENDATION: ${recommendationProfile.toUpperCase()}`,
    ``,
    `RISK COMPUTATION:`,
    `  Active layers: ${activeLayers.length}`,
    `  Layer scores: ${scores.map((s) => s.toFixed(3)).join(", ")}`,
    `  Mean score: ${meanScore.toFixed(3)}`,
    `  Variance: ${variance.toFixed(4)}`,
    `  Volatility (variance × 4, capped 1.0): ${volatility.toFixed(3)}`,
    `  Confidence inverse: ${confidenceInverse.toFixed(3)}`,
    `  Layer count risk: ${layerCountRisk.toFixed(3)} (${activeLayers.length} active, need 5+ for zero risk)`,
    `  Risk = vol×0.5 + confInv×0.35 + layerCount×0.15 = ${riskScore.toFixed(3)}`,
    `  Risk-adjusted confidence: ${riskAdjustedConfidence.toFixed(3)}`,
    ``,
    `PER-MARKET RISK:`,
    ...perMarketRisk.map(
      (m) =>
        `  ${m.marketType}: ${m.selection} (${(m.probability * 100).toFixed(1)}%) — risk=${m.riskScore.toFixed(2)}, vol=${m.volatility.toFixed(2)}, profile=${m.recommendationProfile}`,
    ),
    ``,
    `VALUE SCORE DISABLED:`,
    `  Per spec Section 11: "do not fake a 'value bet' claim without real market odds"`,
    `  High Value tier will activate when ODDS_API_KEY is provided + Market Intelligence (Layer 8) is active`,
    `  Until then: valueScore = null for all predictions (Constitution Rule 4)`,
  ];

  logger.info("risk engine: complete", {
    matchId,
    riskScore,
    volatility,
    recommendationProfile,
  });

  return {
    matchId,
    confidence: consensus.confidence ?? 0,
    riskScore,
    volatility,
    valueScore,
    valueScoreReason,
    recommendationProfile,
    reasoning: reasoningParts.join("\n"),
    perMarketRisk,
  };
}

// ============================================================
// Persist risk fields to Prediction rows
// ============================================================

export async function persistRiskAssessment(
  matchId: string,
  riskAssessment: RiskAssessment,
): Promise<void> {
  for (const marketRisk of riskAssessment.perMarketRisk) {
    const existing = await db.prediction.findFirst({
      where: { matchId, marketType: marketRisk.marketType },
    });

    if (existing) {
      await db.prediction.update({
        where: { id: existing.id },
        data: {
          riskScore: marketRisk.riskScore,
          volatility: marketRisk.volatility,
          valueScore: null, // always null until Market Intelligence
          recommendationProfile: marketRisk.recommendationProfile,
        },
      });
    }
  }

  logger.info("risk engine: persisted to DB", {
    matchId,
    marketsUpdated: riskAssessment.perMarketRisk.length,
  });
}
