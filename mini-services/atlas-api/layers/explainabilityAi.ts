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
import type { MarketPrediction } from "../brainos/decisionEngine.ts";
import { generateExplainability, generateStructuredFallback, type GroqExplainabilityOutput } from "../lib/groq.ts";
import { logger } from "../lib/logger.ts";

export interface ExplainabilityInput {
  layerOutputs: LayerOutput[];
  consensus: ConsensusResult;
  matchId: string;
  marketPredictions?: MarketPrediction[];
  // Context for LLM prompt
  matchContext?: {
    homeTeam: string;
    awayTeam: string;
    kickoff: string;
  };
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
  // Module 6: now calls Groq LLM if GROQ_API_KEY is set, falls back to structured reasoning
  async computeExplainability(input: ExplainabilityInput): Promise<LayerOutput> {
    const { layerOutputs, consensus, marketPredictions, matchContext } = input;

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

    // ============================================================
    // Module 6: Attempt Groq LLM call, fall back to structured reasoning
    // ============================================================
    let groqOutput: GroqExplainabilityOutput;
    let usedLlm = false;

    const groqInput = {
      matchId: input.matchId,
      homeTeam: matchContext?.homeTeam ?? "Home",
      awayTeam: matchContext?.awayTeam ?? "Away",
      kickoff: matchContext?.kickoff ?? "unknown",
      consensus: {
        score: consensus.score,
        confidence: consensus.confidence,
        homeWinProbability: consensus.homeWinProbability,
        drawProbability: consensus.drawProbability,
        awayWinProbability: consensus.awayWinProbability,
        layersContributing: consensus.layersContributing,
        layersExcluded: consensus.layersExcluded,
        agreementScore: consensus.agreementScore,
      },
      marketPredictions: (marketPredictions ?? []).map((mp) => ({
        marketType: mp.marketType,
        selection: mp.selection,
        probability: mp.probability,
        confidence: mp.confidence,
        recommendationProfile: mp.recommendationProfile,
      })),
      layerOutputs: layerOutputs.map((l) => ({
        layer_name: l.layer_name,
        status: l.status,
        score: l.score,
        confidence: l.confidence,
        reasoning: l.reasoning,
      })),
    };

    try {
      groqOutput = await generateExplainability(groqInput);
      usedLlm = true;
      logger.info("explainability: used Groq LLM", {
        matchId: input.matchId,
        tokensUsed: groqOutput.tokensUsed,
        durationMs: groqOutput.durationMs,
      });
    } catch (err) {
      logger.warn("explainability: Groq LLM failed, using structured fallback", {
        matchId: input.matchId,
        error: err instanceof Error ? err.message : String(err),
      });
      groqOutput = generateStructuredFallback(groqInput);
    }

    // Build reasoning: LLM output + structured context (Module 6)
    const reasoningParts: string[] = [
      `=== EXPLAINABILITY (${usedLlm ? "GROQ LLM — " + groqOutput.model : "STRUCTURED FALLBACK — no LLM"}) ===`,
      `Match: ${matchContext?.homeTeam ?? "Home"} vs ${matchContext?.awayTeam ?? "Away"}`,
      `Generated: ${new Date().toISOString()} (${groqOutput.durationMs}ms${usedLlm ? `, ${groqOutput.tokensUsed} tokens` : ""})`,
      ``,
      `--- LLM PLAIN-LANGUAGE SUMMARY (3-4 sentences, for daily report) ---`,
      groqOutput.plainLanguageSummary,
      ``,
      `--- WHY THIS PREDICTION ---`,
      groqOutput.whyThisPrediction,
      ``,
      `--- WHAT INCREASED CONFIDENCE ---`,
      groqOutput.whatIncreasedConfidence,
      ``,
      `--- WHAT REDUCED CONFIDENCE ---`,
      groqOutput.whatReducedConfidence,
      ``,
      `--- LAYERS AGREED ---`,
      groqOutput.layersAgreed,
      ``,
      `--- LAYERS DISAGREED ---`,
      groqOutput.layersDisagreed,
      ``,
      `--- STRUCTURED CONTEXT (always preserved) ---`,
      `PREDICTION: ${prediction}`,
      `Confidence: ${consensus.confidence?.toFixed(3) ?? "null"}`,
      ``,
      `MARKET PREDICTIONS (Module 5 — Decision Engine):`,
      ...(marketPredictions ?? []).map((mp) =>
        `  ${mp.marketType}: ${mp.selection} (${(mp.probability * 100).toFixed(1)}%) — ${mp.recommendationProfile ?? "N/A"} [conf: ${mp.confidence.toFixed(3)}]`,
      ),
      `  High Value tier: DISABLED (requires Market Intelligence — per spec Section 11)`,
      ``,
      `LAYERS AGREED: ${agreeingLayers.join(", ") || "none"}`,
      `LAYERS DISAGREED: ${disagreeingLayers.join(", ") || "none"}`,
      `LAYERS EXCLUDED: ${excludedLayers.map((l) => l.layer_name).join(", ") || "none"}`,
      ``,
      `FEATURE GAPS (per Vali directive — specific, not generic):`,
      ...missingFeatureNotes.length > 0
        ? missingFeatureNotes.map((note) => `  ${note}`)
        : ["  None — all expected features available"],
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
