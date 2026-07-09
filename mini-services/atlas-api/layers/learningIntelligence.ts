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
import type { MarketPrediction } from "../brainos/decisionEngine.ts";

export interface LearningInput {
  matchId: string;
  consensus: ConsensusResult;
  layerOutputs: LayerOutput[];
  marketPredictions?: MarketPrediction[];
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
    const { matchId, consensus, layerOutputs, marketPredictions } = input;

    // Module 5: predictions are now persisted by the Decision Engine (3 markets)
    // Learning Intelligence just logs the audit trail.
    // The Prediction rows were already created by persistPredictions() in the decision engine.
    const predictionCount = await db.prediction.count({ where: { matchId } });

    const reasoningParts: string[] = [
      `Prediction logged for learning (per Constitution Rule 6 + Module 8 spec).`,
      ``,
      `MARKET PREDICTIONS LOGGED: ${predictionCount}`,
      ...(marketPredictions ?? []).map((mp) =>
        `  ${mp.marketType}: ${mp.selection} (${(mp.probability * 100).toFixed(1)}%) — ${mp.recommendationProfile ?? "N/A"}`,
      ),
      ``,
      `CONSENSUS CONTEXT:`,
      `  Score: ${consensus.score.toFixed(3)}`,
      `  Confidence: ${consensus.confidence?.toFixed(3) ?? "null"}`,
      `  Agreement: ${consensus.agreementScore.toFixed(3)}`,
      `  Layers contributing: ${consensus.layersContributing}`,
      `  Layers excluded: ${consensus.layersExcluded}`,
      ``,
      `LAYERS LOGGED: ${layerOutputs.length} (${layerOutputs.filter((l) => l.status === "active").length} active, ${layerOutputs.filter((l) => l.status === "insufficient_data").length} insufficient_data)`,
      ``,
      `After match completes, results comparison job will:`,
      `  - Pull actual match result`,
      `  - Compare each market prediction vs actual (1X2, O/U, BTTS)`,
      `  - Compute per-layer accuracy (did each layer's signal agree with actual?)`,
      `  - Roll up daily/weekly accuracy by market type + confidence tier`,
      ``,
      `🔴 FUTURE (Phase 2): dynamic weight re-adjustment based on per-layer accuracy history.`,
      `Requires 200+ logged predictions to be statistically meaningful.`,
      `Current total logged predictions: ${await db.prediction.count()}`,
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
