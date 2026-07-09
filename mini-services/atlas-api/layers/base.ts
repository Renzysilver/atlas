// ATLAS API — layers/base.ts
// Module 4 — Football Intelligence Engine (spec Section 7)
//
// Base layer class. Every one of the 17 intelligence layers, regardless of
// build status, implements this interface. Per spec Section 7, the uniform
// LayerOutput contract is what lets BrainOS and the Consensus Engine treat
// all 17 layers identically.
//
// CRITICAL DESIGN (per Vali directive + Section 17 Rule 2 flag resolution):
// Confidence scales with input coverage. If a layer expects 5 features but
// only 3 are active (rest are insufficient_data), confidence is reduced
// proportionally — but the layer STAYS 🟢 ACTIVE and computes a real score
// from the available inputs. Per Constitution Rule 4: never fabricate the
// missing inputs.
//
// REASONING SPECIFICITY (per Vali directive):
// The reasoning field MUST list, per-match, exactly which features were used,
// which were missing, and the resulting confidence. Not a generic "confidence
// reduced" note — the actual feature names and values.

import type { LayerOutput, LayerName } from "@atlas/shared";
import { LAYER_WEIGHTS } from "@atlas/shared";

// ============================================================
// Layer context — what each layer receives as input
// ============================================================

export interface LayerContext {
  matchId: string;
  homeTeamId: string;
  awayTeamId: string;
  season: number;
  // Features are pre-loaded by BrainOS and passed to each layer
  homeTeamFeatures: Record<string, { value: number | null; status: string; confidence: number }>;
  awayTeamFeatures: Record<string, { value: number | null; status: string; confidence: number }>;
  homeMatchFeatures: Record<string, { value: number | null; status: string; confidence: number }>;
  awayMatchFeatures: Record<string, { value: number | null; status: string; confidence: number }>;
}

// ============================================================
// Feature availability helper — for confidence scaling
// ============================================================

export interface FeatureAvailabilityResult {
  available: string[];
  missing: string[];
  coverageRatio: number; // available.length / total expected
}

export function checkFeatureAvailability(
  features: Record<string, { value: number | null; status: string }>,
  expectedFeatures: string[],
): FeatureAvailabilityResult {
  const available: string[] = [];
  const missing: string[] = [];
  for (const name of expectedFeatures) {
    const feat = features[name];
    if (feat && feat.value !== null && feat.status === "active") {
      available.push(name);
    } else {
      missing.push(name);
    }
  }
  const coverageRatio = expectedFeatures.length > 0 ? available.length / expectedFeatures.length : 0;
  return { available, missing, coverageRatio };
}

// ============================================================
// Confidence scaling — the core of the reduced-confidence approach
// ============================================================

export function scaleConfidence(
  baseConfidence: number,
  coverageRatio: number,
  minConfidence: number = 0.3,
): number {
  // Confidence = baseConfidence × coverageRatio, floored at minConfidence
  // If coverage is 100%, confidence = baseConfidence
  // If coverage is 60%, confidence = baseConfidence × 0.6
  // If coverage is 0%, the layer should return insufficient_data instead
  return Math.max(minConfidence, baseConfidence * coverageRatio);
}

// ============================================================
// Specific reasoning generator — per Vali's directive
// ============================================================

export interface ReasoningInput {
  layerName: string;
  homeTeamName: string;
  awayTeamName: string;
  homeFeaturesUsed: Array<{ name: string; value: number }>;
  awayFeaturesUsed: Array<{ name: string; value: number }>;
  homeFeaturesMissing: string[];
  awayFeaturesMissing: string[];
  homeCoverage: number;
  awayCoverage: number;
  baseConfidence: number;
  scaledConfidence: number;
  score: number;
  scoreInterpretation: string;
  extraNotes?: string[];
}

export function generateSpecificReasoning(input: ReasoningInput): string {
  const parts: string[] = [];

  // Score interpretation
  parts.push(`${input.scoreInterpretation} (score: ${input.score.toFixed(3)})`);

  // Features used — with values
  if (input.homeFeaturesUsed.length > 0 || input.awayFeaturesUsed.length > 0) {
    parts.push(`Features used:`);
    for (const f of input.homeFeaturesUsed) {
      parts.push(`  ${input.homeTeamName} ${f.name}: ${f.value.toFixed(3)}`);
    }
    for (const f of input.awayFeaturesUsed) {
      parts.push(`  ${input.awayTeamName} ${f.name}: ${f.value.toFixed(3)}`);
    }
  }

  // Features missing — specific names
  if (input.homeFeaturesMissing.length > 0 || input.awayFeaturesMissing.length > 0) {
    parts.push(`Features missing (insufficient_data):`);
    for (const name of input.homeFeaturesMissing) {
      parts.push(`  ${input.homeTeamName} ${name}`);
    }
    for (const name of input.awayFeaturesMissing) {
      parts.push(`  ${input.awayTeamName} ${name}`);
    }
  }

  // Confidence explanation
  parts.push(
    `Confidence: ${input.scaledConfidence.toFixed(3)} (base ${input.baseConfidence.toFixed(2)} × coverage ${(input.homeCoverage + input.awayCoverage) / 2 * 100 | 0}%)`,
  );

  // Extra notes (layer-specific)
  if (input.extraNotes && input.extraNotes.length > 0) {
    parts.push(...input.extraNotes);
  }

  return parts.join("\n");
}

// ============================================================
// Base layer abstract class
// ============================================================

export interface LayerDefinition {
  name: LayerName;
  layerNumber: number; // 1-17 per spec Section 3
  description: string;
  buildStatus: "active" | "stub" | "future";
  feedsConsensus: boolean; // true = output feeds weighted consensus; false = engine-level
}

export abstract class BaseLayer {
  abstract readonly definition: LayerDefinition;

  /**
   * Compute the layer output for a given match.
   * Active layers implement real logic. Stub layers return insufficient_data.
   * Future layers return future status.
   */
  abstract compute(ctx: LayerContext): Promise<LayerOutput>;

  /**
   * Helper: create an active LayerOutput with specific reasoning.
   */
  protected activeOutput(
    layerName: LayerName,
    score: number,
    confidence: number,
    reasoning: string,
  ): LayerOutput {
    return {
      layer_name: layerName,
      status: "active",
      score: Math.round(score * 1000) / 1000,
      confidence: Math.round(confidence * 1000) / 1000,
      reasoning,
    };
  }

  /**
   * Helper: create an insufficient_data LayerOutput with specific reason.
   */
  protected insufficientOutput(layerName: LayerName, reason: string): LayerOutput {
    return {
      layer_name: layerName,
      status: "insufficient_data",
      score: null,
      confidence: null,
      reasoning: reason,
    };
  }

  /**
   * Helper: create a future LayerOutput.
   */
  protected futureOutput(layerName: LayerName, reason: string): LayerOutput {
    return {
      layer_name: layerName,
      status: "future",
      score: null,
      confidence: null,
      reasoning: reason,
    };
  }

  /**
   * Get the consensus weight for this layer (from shared package).
   */
  get weight(): number {
    return LAYER_WEIGHTS[this.definition.name] ?? 0;
  }
}

// ============================================================
// Stub layer — for layers that exist as interface points only
// ============================================================

export class StubLayer extends BaseLayer {
  constructor(def: LayerDefinition, private stubReason: string) {
    super();
    this.definition = def;
  }
  readonly definition: LayerDefinition;

  async compute(_ctx: LayerContext): Promise<LayerOutput> {
    return this.insufficientOutput(this.definition.name, this.stubReason);
  }
}

// ============================================================
// Future layer — for layers architecturally reserved
// ============================================================

export class FutureLayer extends BaseLayer {
  constructor(def: LayerDefinition, private futureReason: string) {
    super();
    this.definition = def;
  }
  readonly definition: LayerDefinition;

  async compute(_ctx: LayerContext): Promise<LayerOutput> {
    return this.futureOutput(this.definition.name, this.futureReason);
  }
}
