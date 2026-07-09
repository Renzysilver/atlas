// ATLAS API — layers/learningIntelligence.ts
// Layer 15 of 17 — Learning Intelligence (🟢 ACTIVE partial)
//
// Per spec Section 12 (Module 8): "learning is never optional scope. Build
// all of the following now, for every prediction ATLAS makes, starting with
// the first real EPL fixture:
//   - Prediction logging
//   - Results comparison
//   - Accuracy measurement
//   - Per-layer performance evaluation
//   - Internal learning reports
// 🔴 FUTURE (Phase 2 only): automatic dynamic weight re-adjustment"
//
// In Module 4, this layer's job is to LOG the prediction at prediction time.
// The results comparison + accuracy measurement happen AFTER matches complete
// (handled by a separate job in Module 8).

import { db } from "../lib/db.ts";
import type { LayerOutput } from "@atlas/shared";
import { BaseLayer, type LayerContext, type LayerDefinition } from "./base.ts";
import type { ConsensusResult } from "./consensusEngine.ts";

export interface LearningInput {
  matchId: string;
  consensus: ConsensusResult;
  layerOutputs: LayerOutput[];
}

export class LearningIntelligenceLayer extends BaseLayer {
  readonly definition: LayerDefinition = {
    name: "learning_intelligence",
    layerNumber: 15,
    description: "Prediction logging + per-layer accuracy tracking (dynamic re-weighting is FUTURE)",
    buildStatus: "active",
    feedsConsensus: false, // engine-level
  };

  // Special compute method — logs the prediction
  async logPrediction(input: LearningInput): Promise<LayerOutput> {
    const { matchId, consensus, layerOutputs } = input;

    // Log the prediction to the Prediction table
    const prediction = await db.prediction.create({
      data: {
        matchId,
        marketType: "1X2",
        selection: consensus.homeWinProbability > consensus.awayWinProbability
          ? (consensus.homeWinProbability > consensus.drawProbability ? "HOME" : "DRAW")
          : (consensus.awayWinProbability > consensus.drawProbability ? "AWAY" : "DRAW"),
        probability: Math.max(
          consensus.homeWinProbability,
          consensus.drawProbability,
          consensus.awayWinProbability,
        ),
        confidence: consensus.confidence ?? 0,
        riskScore: null, // computed by Risk Management Engine (Module 7)
        volatility: null,
        valueScore: null, // null until Market Intelligence activates
        recommendationProfile: null, // set by Module 7
        consensusInputsJson: JSON.stringify({
          layers: layerOutputs.map((l) => ({
            layer: l.layer_name,
            status: l.status,
            score: l.score,
            confidence: l.confidence,
          })),
          consensus: {
            score: consensus.score,
            confidence: consensus.confidence,
            homeWinProb: consensus.homeWinProbability,
            drawProb: consensus.drawProbability,
            awayWinProb: consensus.awayWinProbability,
            agreement: consensus.agreementScore,
          },
        }),
      },
    });

    const reasoningParts: string[] = [
      `Prediction logged for learning (per Constitution Rule 6 + Module 8 spec).`,
      `Prediction ID: ${prediction.id}`,
      `Market: 1X2`,
      `Selection: ${prediction.selection}`,
      `Probability: ${(prediction.probability * 100).toFixed(1)}%`,
      `Confidence: ${prediction.confidence.toFixed(3)}`,
      `Layers logged: ${layerOutputs.length} (${layerOutputs.filter((l) => l.status === "active").length} active, ${layerOutputs.filter((l) => l.status === "insufficient_data").length} insufficient_data)`,
      ``,
      `After match completes, results comparison job will:`,
      `  - Pull actual match result`,
      `  - Compare prediction vs actual`,
      `  - Compute per-layer accuracy (did each layer's signal agree with actual?)`,
      `  - Roll up daily/weekly accuracy by market type + confidence tier`,
      ``,
      `🔴 FUTURE (Phase 2): dynamic weight re-adjustment based on per-layer accuracy history.`,
      `Requires 200+ logged predictions to be statistically meaningful.`,
      `Current logged predictions: ${await db.prediction.count()}`,
    ];

    return {
      layer_name: "learning_intelligence",
      status: "active",
      score: consensus.score, // mirrors consensus for uniformity
      confidence: consensus.confidence,
      reasoning: reasoningParts.join("\n"),
    };
  }

  async compute(_ctx: LayerContext): Promise<LayerOutput> {
    return this.insufficientOutput(
      this.definition.name,
      "Learning Intelligence is called directly by BrainOS after consensus, not via standard compute().",
    );
  }
}
