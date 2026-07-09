// ATLAS API — layers/consensusEngine.ts
// Layer 13 of 17 — Consensus Engine (🟢 ACTIVE)
//
// Per spec Section 3: "agreement/variance across active model outputs —
// models marked insufficient_data are excluded from consensus math,
// not treated as zero"
//
// Per spec Section 8 (BrainOS): "Filters out any layer returning
// insufficient_data from the weighted consensus (does NOT treat missing
// data as zero or average)"
//
// Per spec Section 8: "Phase 1 uses fixed, documented weights that Vali
// and Claude set explicitly per layer — write these as a config file"
// → Already done in packages/shared/src/layers.ts (LAYER_WEIGHTS)

import type { LayerOutput } from "@atlas/shared";
import { LAYER_WEIGHTS } from "@atlas/shared";
import { BaseLayer, type LayerContext, type LayerDefinition } from "./base.ts";

export interface ConsensusInput {
  layerOutputs: LayerOutput[];
  matchId: string;
}

export interface ConsensusResult extends LayerOutput {
  homeWinProbability: number;
  drawProbability: number;
  awayWinProbability: number;
  layersContributing: number;
  layersExcluded: number;
  agreementScore: number; // 0-1, how much layers agree
}

const BASE_CONFIDENCE = 0.85;

export class ConsensusEngineLayer extends BaseLayer {
  readonly definition: LayerDefinition = {
    name: "consensus_engine",
    layerNumber: 13,
    description: "Weighted consensus of active layer outputs (excludes insufficient_data)",
    buildStatus: "active",
    feedsConsensus: false, // engine-level, not a contributing layer
  };

  // Note: this layer has a special compute signature — it takes layer outputs
  // rather than a match context. BrainOS calls it directly.
  async computeConsensus(input: ConsensusInput, ctx?: LayerContext): Promise<ConsensusResult> {
    // Filter to active layers that feed consensus
    const activeLayers = input.layerOutputs.filter(
      (lo) => lo.status === "active" && lo.score !== null && lo.confidence !== null,
    );
    const excludedLayers = input.layerOutputs.filter((lo) => lo.status !== "active");

    if (activeLayers.length === 0) {
      return {
        layer_name: "consensus_engine",
        status: "insufficient_data",
        score: null,
        confidence: null,
        reasoning: `No active layers to compute consensus. ${excludedLayers.length} layers returned insufficient_data/future.`,
        homeWinProbability: 0,
        drawProbability: 0,
        awayWinProbability: 0,
        layersContributing: 0,
        layersExcluded: excludedLayers.length,
        agreementScore: 0,
      };
    }

    // Weighted average: score × weight × confidence, summed ÷ (weight × confidence) summed
    let weightedScoreSum = 0;
    let weightConfidenceSum = 0;
    const contributingLayers: string[] = [];

    for (const layer of activeLayers) {
      const weight = LAYER_WEIGHTS[layer.layer_name as keyof typeof LAYER_WEIGHTS] ?? 0;
      if (weight === 0) continue; // engine-level layers have weight 0

      weightedScoreSum += layer.score! * weight * layer.confidence!;
      weightConfidenceSum += weight * layer.confidence!;
      contributingLayers.push(layer.layer_name);
    }

    if (weightConfidenceSum === 0) {
      return {
        layer_name: "consensus_engine",
        status: "insufficient_data",
        score: null,
        confidence: null,
        reasoning: `All active layers have weight 0 (engine-level only). No consensus-feeding layers active.`,
        homeWinProbability: 0,
        drawProbability: 0,
        awayWinProbability: 0,
        layersContributing: 0,
        layersExcluded: excludedLayers.length,
        agreementScore: 0,
      };
    }

    const consensusScore = weightedScoreSum / weightConfidenceSum;

    // Compute agreement score (inverse of variance)
    const scores = activeLayers
      .filter((l) => (LAYER_WEIGHTS[l.layer_name as keyof typeof LAYER_WEIGHTS] ?? 0) > 0)
      .map((l) => l.score!);
    const meanScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((sum, s) => sum + Math.pow(s - meanScore, 2), 0) / scores.length;
    const agreementScore = Math.max(0, 1 - variance * 4); // lower variance = higher agreement

    // Confidence: base × agreement × number-of-layers factor
    const layerCountFactor = Math.min(1, activeLayers.length / 7); // 7+ active layers = full confidence
    const scaledConfidence = BASE_CONFIDENCE * agreementScore * (0.5 + layerCountFactor * 0.5);

    // Derive 1X2 probabilities from consensus score
    // Score is home-win probability; split the rest between draw and away
    // Draw baseline ~25%, scales with how close to 0.5 the score is
    const homeWinProb = consensusScore;
    const drawProb = (1 - Math.abs(consensusScore - 0.5) * 2) * 0.3; // max 0.3 when even
    const awayProb = Math.max(0, 1 - homeWinProb - drawProb);

    // Normalize to sum to 1
    const total = homeWinProb + drawProb + awayProb;
    const normalizedHome = homeWinProb / total;
    const normalizedDraw = drawProb / total;
    const normalizedAway = awayProb / total;

    const reasoning = [
      `Consensus from ${contributingLayers.length} active layers (score: ${consensusScore.toFixed(3)} = home win probability)`,
      `Contributing layers:`,
      ...activeLayers
        .filter((l) => (LAYER_WEIGHTS[l.layer_name as keyof typeof LAYER_WEIGHTS] ?? 0) > 0)
        .map((l) => `  ${l.layer_name}: score ${l.score!.toFixed(3)}, confidence ${l.confidence!.toFixed(3)}, weight ${(LAYER_WEIGHTS[l.layer_name as keyof typeof LAYER_WEIGHTS] ?? 0).toFixed(2)}`),
      `Excluded layers (${excludedLayers.length}): ${excludedLayers.map((l) => l.layer_name).join(", ") || "none"}`,
      `Agreement score: ${agreementScore.toFixed(3)} (variance: ${variance.toFixed(4)})`,
      `1X2 probabilities: Home ${(normalizedHome * 100).toFixed(1)}%, Draw ${(normalizedDraw * 100).toFixed(1)}%, Away ${(normalizedAway * 100).toFixed(1)}%`,
      `Confidence: ${scaledConfidence.toFixed(3)} (base ${BASE_CONFIDENCE} × agreement ${agreementScore.toFixed(2)} × layer-count factor ${(0.5 + layerCountFactor * 0.5).toFixed(2)})`,
    ].join("\n");

    return {
      layer_name: "consensus_engine",
      status: "active",
      score: Math.round(consensusScore * 1000) / 1000,
      confidence: Math.round(scaledConfidence * 1000) / 1000,
      reasoning,
      homeWinProbability: Math.round(normalizedHome * 1000) / 1000,
      drawProbability: Math.round(normalizedDraw * 1000) / 1000,
      awayWinProbability: Math.round(normalizedAway * 1000) / 1000,
      layersContributing: contributingLayers.length,
      layersExcluded: excludedLayers.length,
      agreementScore: Math.round(agreementScore * 1000) / 1000,
    };
  }

  // Standard compute() — BrainOS calls computeConsensus() directly
  async compute(_ctx: LayerContext): Promise<LayerOutput> {
    return this.insufficientOutput(
      this.definition.name,
      "Consensus Engine is called directly by BrainOS with layer outputs, not via standard compute().",
    );
  }
}
