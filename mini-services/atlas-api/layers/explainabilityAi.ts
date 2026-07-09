// ATLAS API — layers/explainabilityAi.ts
// Layer 14 of 17 — Explainability AI (🟢 ACTIVE structure, LLM call in Module 6)
//
// Per spec Section 3: "This is a real LLM call. Groq call that takes the
// structured output of all active engines and converts it to plain-language
// reasoning. This is the correct, high-value use of an LLM in this system."
//
// Per spec Section 10 (Module 6): "Groq call, structured prompt, takes the
// full Final Match Intelligence object as input, outputs:
//   - Why this prediction
//   - What increased confidence
//   - What reduced confidence
//   - Which layers agreed / disagreed
//   - Plain-language 3-4 sentence summary for the daily report"
//
// MODULE 4 SCOPE: Build the structure + generate structured reasoning text
// WITHOUT the LLM call. Module 6 will swap in the real Groq call.
//
// PER VALI DIRECTIVE: The reasoning MUST be specific per-match per-layer —
// listing exactly which features were missing, not a generic "confidence
// reduced" note. This layer aggregates the per-layer reasoning into a
// human-readable explanation.

import type { LayerOutput } from "@atlas/shared";
import { BaseLayer, type LayerContext, type LayerDefinition } from "./base.ts";
import type { ConsensusResult } from "./consensusEngine.ts";

export interface ExplainabilityInput {
  layerOutputs: LayerOutput[];
  consensus: ConsensusResult;
  matchId: string;
}

export class ExplainabilityAiLayer extends BaseLayer {
  readonly definition: LayerDefinition = {
    name: "explainability_ai",
    layerNumber: 14,
    description: "Plain-language reasoning from structured layer outputs (LLM call in Module 6)",
    buildStatus: "active",
    feedsConsensus: false, // engine-level
  };

  // Special compute method — takes layer outputs + consensus
  async computeExplainability(input: ExplainabilityInput): Promise<LayerOutput> {
    const { layerOutputs, consensus } = input;

    // Extract active layers that fed consensus
    const activeLayers = layerOutputs.filter(
      (lo) => lo.status === "active" && lo.score !== null,
    );
    const excludedLayers = layerOutputs.filter((lo) => lo.status !== "active");

    // Identify which layers agreed vs disagreed with consensus
    const agreeingLayers: string[] = [];
    const disagreeingLayers: string[] = [];
    for (const layer of activeLayers) {
      if (layer.layer_name === "consensus_engine") continue;
      const diff = Math.abs(layer.score! - consensus.score);
      if (diff < 0.1) {
        agreeingLayers.push(layer.layer_name);
      } else {
        disagreeingLayers.push(layer.layer_name);
      }
    }

    // Extract missing-feature mentions from each layer's reasoning
    const missingFeatureNotes: string[] = [];
    for (const layer of activeLayers) {
      if (layer.reasoning && layer.reasoning.includes("missing") || layer.reasoning?.includes("insufficient")) {
        // Extract the missing features line
        const lines = layer.reasoning.split("\n");
        const missingLines = lines.filter(
          (l) => l.includes("missing") || l.includes("Missing") || l.includes("insufficient"),
        );
        for (const line of missingLines.slice(0, 2)) {
          missingFeatureNotes.push(`${layer.layer_name}: ${line.trim()}`);
        }
      }
    }

    // Determine prediction direction
    let prediction: string;
    if (consensus.score > 0.5) {
      prediction = `Home team favored (${(consensus.homeWinProbability * 100).toFixed(1)}% win probability)`;
    } else if (consensus.score < 0.5) {
      prediction = `Away team favored (${(consensus.awayWinProbability * 100).toFixed(1)}% win probability)`;
    } else {
      prediction = `Even match (Draw most likely at ${(consensus.drawProbability * 100).toFixed(1)}%)`;
    }

    // Build structured reasoning (Module 6 will replace this with LLM output)
    const reasoningParts: string[] = [
      `=== EXPLAINABILITY (structured — LLM call in Module 6) ===`,
      ``,
      `PREDICTION: ${prediction}`,
      `Confidence: ${consensus.confidence?.toFixed(3) ?? "null"}`,
      ``,
      `WHY THIS PREDICTION:`,
      `  Consensus score ${consensus.score.toFixed(3)} computed from ${consensus.layersContributing} active layers.`,
      `  ${agreeingLayers.length} layers agreed (within 0.10 of consensus): ${agreeingLayers.join(", ") || "none"}`,
      `  ${disagreeingLayers.length} layers disagreed: ${disagreeingLayers.join(", ") || "none"}`,
      ``,
      `WHAT INCREASED CONFIDENCE:`,
      `  Agreement score: ${consensus.agreementScore.toFixed(3)} (higher = more layer consensus)`,
      `  Active layer count: ${activeLayers.length} (more layers = higher confidence)`,
      ...activeLayers
        .filter((l) => l.confidence !== null && l.confidence > 0.7)
        .map((l) => `  ${l.layer_name} confidence: ${l.confidence!.toFixed(3)}`),
      ``,
      `WHAT REDUCED CONFIDENCE:`,
      ...missingFeatureNotes.slice(0, 10).map((note) => `  ${note}`),
      ...excludedLayers
        .filter((l) => l.status === "insufficient_data")
        .slice(0, 5)
        .map((l) => `  ${l.layer_name}: insufficient_data (excluded from consensus)`),
      ...activeLayers
        .filter((l) => l.confidence !== null && l.confidence < 0.6)
        .map((l) => `  ${l.layer_name} low confidence: ${l.confidence!.toFixed(3)}`),
      ``,
      `LAYERS AGREED: ${agreeingLayers.join(", ") || "none"}`,
      `LAYERS DISAGREED: ${disagreeingLayers.join(", ") || "none"}`,
      `LAYERS EXCLUDED: ${excludedLayers.map((l) => l.layer_name).join(", ") || "none"}`,
      ``,
      `FEATURE GAPS (per Vali directive — specific, not generic):`,
      ...missingFeatureNotes.length > 0
        ? missingFeatureNotes.map((note) => `  ${note}`)
        : ["  None — all expected features available"],
      ``,
      `MODULE 6 NOTE: This structured reasoning will be converted to 3-4 sentence`,
      `plain-language summary by the Groq LLM call (llama-3.3-70b-versatile).`,
      `The LLM will receive this structured text + the full Final Match Intelligence`,
      `object and produce human-readable reasoning for the daily report.`,
    ];

    return {
      layer_name: "explainability_ai",
      status: "active",
      score: consensus.score, // mirrors consensus score
      confidence: consensus.confidence,
      reasoning: reasoningParts.join("\n"),
    };
  }

  async compute(_ctx: LayerContext): Promise<LayerOutput> {
    return this.insufficientOutput(
      this.definition.name,
      "Explainability AI is called directly by BrainOS with layer outputs + consensus, not via standard compute().",
    );
  }
}
