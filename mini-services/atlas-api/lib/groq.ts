// ATLAS API — lib/groq.ts
// Module 6 — Groq LLM client for Explainability AI (spec Section 10)
//
// Per spec Section 3: "This is a real LLM call. Groq call that takes the
// structured output of all active engines and converts it to plain-language
// reasoning. This is the correct, high-value use of an LLM in this system."
//
// Per spec Section 10: "Groq call, structured prompt, takes the full Final
// Match Intelligence object as input, outputs:
//   - Why this prediction
//   - What increased confidence
//   - What reduced confidence
//   - Which layers agreed / disagreed
//   - Plain-language 3-4 sentence summary for the daily report"
//
// Per spec Section 2: "LLM calls: Groq (llama-3.3-70b-versatile)"
//
// IRON RULE (Constitution Rule 4): the LLM NEVER generates probabilities,
// scores, or fabricated data. It only converts structured data into
// plain-language text. If the structured input says possession_rating is
// insufficient_data, the LLM must say "possession data not available" —
// never invent a possession statistic.

import { logger } from "./logger.ts";
import { db } from "./db.ts";

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

// ============================================================
// Types
// ============================================================

export interface GroqExplainabilityInput {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  kickoff: string;
  // Consensus
  consensus: {
    score: number;
    confidence: number | null;
    homeWinProbability: number;
    drawProbability: number;
    awayWinProbability: number;
    layersContributing: number;
    layersExcluded: number;
    agreementScore: number;
  };
  // 3 market predictions from Decision Engine
  marketPredictions: Array<{
    marketType: string;
    selection: string;
    probability: number;
    confidence: number;
    recommendationProfile: string | null;
  }>;
  // All layer outputs (active + insufficient_data + future)
  layerOutputs: Array<{
    layer_name: string;
    status: string;
    score: number | null;
    confidence: number | null;
    reasoning: string | null;
  }>;
}

export interface GroqExplainabilityOutput {
  whyThisPrediction: string;
  whatIncreasedConfidence: string;
  whatReducedConfidence: string;
  layersAgreed: string;
  layersDisagreed: string;
  plainLanguageSummary: string; // 3-4 sentences for daily report
  rawResponse?: string; // full LLM response for debugging
  model: string;
  tokensUsed: number;
  durationMs: number;
}

// ============================================================
// Quota tracking
// ============================================================

async function incrementGroqQuota(tokensUsed: number): Promise<void> {
  try {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    await db.apiQuotaUsage.upsert({
      where: { service_endpoint: { service: "groq", endpoint: "_global" } },
      create: {
        service: "groq",
        endpoint: "_global",
        dailyCount: tokensUsed,
        quotaLimit: 10000, // Groq free tier: generous token limit
        lastResetAt: today,
      },
      update: {
        dailyCount: { increment: tokensUsed },
      },
    });
  } catch (err) {
    logger.warn("failed to track groq quota", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ============================================================
// Prompt builder
// ============================================================

function buildExplainabilityPrompt(input: GroqExplainabilityInput): string {
  const activeLayers = input.layerOutputs.filter((l) => l.status === "active");
  const excludedLayers = input.layerOutputs.filter((l) => l.status === "insufficient_data");
  const futureLayers = input.layerOutputs.filter((l) => l.status === "future");

  // Identify agreeing vs disagreeing layers (within 0.10 of consensus)
  const consensusFeedingLayers = activeLayers.filter(
    (l) => l.layer_name !== "consensus_engine" && l.layer_name !== "explainability_ai" && l.layer_name !== "learning_intelligence" && l.score !== null,
  );
  const agreeing = consensusFeedingLayers.filter((l) => Math.abs(l.score! - input.consensus.score) < 0.10);
  const disagreeing = consensusFeedingLayers.filter((l) => Math.abs(l.score! - input.consensus.score) >= 0.10);

  return `You are ATLAS's Explainability AI. Your job is to convert structured football prediction data into clear, honest, plain-language reasoning.

CRITICAL RULES (Constitution Rule 4 — never violate):
1. NEVER fabricate statistics, probabilities, or data points not present in the input
2. If a feature is "insufficient_data", say "data not available" — never invent a value
3. Only describe what the structured data actually says
4. Be specific: name the actual layers, features, and values — not generic phrases
5. If confidence is low, say so honestly — don't hedge with false certainty

MATCH: ${input.homeTeam} vs ${input.awayTeam}
Kickoff: ${input.kickoff}

CONSENSUS:
- Score: ${input.consensus.score.toFixed(3)} (home win probability)
- Confidence: ${input.consensus.confidence?.toFixed(3) ?? "null"}
- Probabilities: Home ${(input.consensus.homeWinProbability * 100).toFixed(1)}%, Draw ${(input.consensus.drawProbability * 100).toFixed(1)}%, Away ${(input.consensus.awayWinProbability * 100).toFixed(1)}%
- ${input.consensus.layersContributing} layers contributed to consensus
- ${input.consensus.layersExcluded} layers excluded (insufficient_data)
- Agreement score: ${input.consensus.agreementScore.toFixed(3)} (higher = more layer consensus)

MARKET PREDICTIONS (Decision Engine):
${input.marketPredictions.map((mp) => `- ${mp.marketType}: ${mp.selection} (${(mp.probability * 100).toFixed(1)}%) — ${mp.recommendationProfile ?? "N/A"} [confidence: ${mp.confidence.toFixed(3)}]`).join("\n")}

ACTIVE LAYERS (${activeLayers.length}):
${activeLayers.map((l) => `- ${l.layer_name}: score=${l.score?.toFixed(3) ?? "null"}, confidence=${l.confidence?.toFixed(3) ?? "null"}
  Reasoning: ${(l.reasoning || "").slice(0, 200)}...`).join("\n")}

AGREEING LAYERS (within 0.10 of consensus): ${agreeing.map((l) => l.layer_name).join(", ") || "none"}
DISAGREEING LAYERS: ${disagreeing.map((l) => l.layer_name).join(", ") || "none"}

EXCLUDED LAYERS (insufficient_data — NOT treated as zero):
${excludedLayers.map((l) => `- ${l.layer_name}: ${l.reasoning?.slice(0, 100) ?? "no reason"}`).join("\n")}

FUTURE LAYERS: ${futureLayers.map((l) => l.layer_name).join(", ") || "none"}

Based on this structured data, produce your response as a JSON object with these exact fields:
{
  "whyThisPrediction": "1-2 sentences explaining why this specific prediction was made, referencing actual layer scores and consensus",
  "whatIncreasedConfidence": "1-2 sentences on what factors increased confidence (layer agreement, high-confidence layers, etc.)",
  "whatReducedConfidence": "1-2 sentences on what reduced confidence (missing features, low-confidence layers, layer disagreement). BE SPECIFIC about which features were missing — do not say 'some data missing'",
  "layersAgreed": "Comma-separated list of layer names that agreed with consensus",
  "layersDisagreed": "Comma-separated list of layer names that disagreed",
  "plainLanguageSummary": "3-4 sentences in plain language suitable for a daily report. Should read naturally, not like a data dump. Must be honest about any data limitations."
}

Respond with ONLY the JSON object, no markdown, no explanation.`;
}

// ============================================================
// Main Groq call
// ============================================================

export async function generateExplainability(
  input: GroqExplainabilityInput,
): Promise<GroqExplainabilityOutput> {
  const startMs = Date.now();

  if (!GROQ_API_KEY || GROQ_API_KEY === "YOUR_GROQ_API_KEY_HERE") {
    throw new Error(
      "GROQ_API_KEY not configured. Per spec Section 10, the Explainability AI requires a real Groq LLM call. " +
        "Falling back to structured reasoning (no LLM). Set GROQ_API_KEY in .env to enable the LLM call.",
    );
  }

  const prompt = buildExplainabilityPrompt(input);

  logger.info("groq: calling LLM for explainability", {
    matchId: input.matchId,
    model: GROQ_MODEL,
    promptLength: prompt.length,
  });

  try {
    const response = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          {
            role: "system",
            content: "You are ATLAS's Explainability AI. You convert structured football prediction data into clear, honest plain-language reasoning. You NEVER fabricate data. You respond only with JSON.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.3, // low temperature for factual, consistent output
        max_tokens: 1000,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Groq API HTTP ${response.status}: ${errorBody.slice(0, 300)}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("Groq returned empty response content");
    }

    // Parse the JSON response
    let parsed: GroqExplainabilityOutput;
    try {
      const jsonContent = JSON.parse(content);
      parsed = {
        whyThisPrediction: jsonContent.whyThisPrediction || "",
        whatIncreasedConfidence: jsonContent.whatIncreasedConfidence || "",
        whatReducedConfidence: jsonContent.whatReducedConfidence || "",
        layersAgreed: jsonContent.layersAgreed || "",
        layersDisagreed: jsonContent.layersDisagreed || "",
        plainLanguageSummary: jsonContent.plainLanguageSummary || "",
        rawResponse: content,
        model: data.model || GROQ_MODEL,
        tokensUsed: data.usage?.total_tokens || 0,
        durationMs: Date.now() - startMs,
      };
    } catch (parseErr) {
      throw new Error(`Failed to parse Groq JSON response: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`);
    }

    // Track quota
    await incrementGroqQuota(parsed.tokensUsed);

    logger.info("groq: LLM call complete", {
      matchId: input.matchId,
      tokensUsed: parsed.tokensUsed,
      durationMs: parsed.durationMs,
      summaryLength: parsed.plainLanguageSummary.length,
    });

    return parsed;
  } catch (err) {
    logger.error("groq: LLM call failed", {
      matchId: input.matchId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

// ============================================================
// Fallback: structured reasoning (when no Groq key)
// ============================================================

export function generateStructuredFallback(input: GroqExplainabilityInput): GroqExplainabilityOutput {
  const activeLayers = input.layerOutputs.filter((l) => l.status === "active");
  const excludedLayers = input.layerOutputs.filter((l) => l.status === "insufficient_data");

  const consensusFeedingLayers = activeLayers.filter(
    (l) => l.layer_name !== "consensus_engine" && l.layer_name !== "explainability_ai" && l.layer_name !== "learning_intelligence" && l.score !== null,
  );
  const agreeing = consensusFeedingLayers.filter((l) => Math.abs(l.score! - input.consensus.score) < 0.10);
  const disagreeing = consensusFeedingLayers.filter((l) => Math.abs(l.score! - input.consensus.score) >= 0.10);

  // Extract missing feature notes from layer reasoning
  const missingFeatureNotes: string[] = [];
  for (const layer of activeLayers) {
    if (layer.reasoning && (layer.reasoning.includes("missing") || layer.reasoning.includes("insufficient"))) {
      const lines = layer.reasoning.split("\n");
      const missingLines = lines.filter((l) => l.includes("missing") || l.includes("Missing"));
      for (const line of missingLines.slice(0, 1)) {
        missingFeatureNotes.push(`${layer.layer_name}: ${line.trim()}`);
      }
    }
  }

  return {
    whyThisPrediction: `Consensus score ${input.consensus.score.toFixed(3)} computed from ${input.consensus.layersContributing} active layers. Market predictions: ${input.marketPredictions.map((mp) => `${mp.marketType}=${mp.selection} (${(mp.probability * 100).toFixed(1)}%)`).join(", ")}.`,
    whatIncreasedConfidence: `Agreement score ${input.consensus.agreementScore.toFixed(3)} across ${input.consensus.layersContributing} contributing layers. ${activeLayers.filter((l) => l.confidence !== null && l.confidence > 0.7).length} layers had confidence > 0.7.`,
    whatReducedConfidence: missingFeatureNotes.length > 0
      ? `Missing features: ${missingFeatureNotes.slice(0, 3).join("; ")}`
      : `${excludedLayers.length} layers returned insufficient_data and were excluded from consensus.`,
    layersAgreed: agreeing.map((l) => l.layer_name).join(", ") || "none",
    layersDisagreed: disagreeing.map((l) => l.layer_name).join(", ") || "none",
    plainLanguageSummary: `Structured fallback (no LLM): ${input.homeTeam} vs ${input.awayTeam} prediction is ${input.marketPredictions[0]?.selection || "unknown"} with ${(input.marketPredictions[0]?.probability * 100 || 0).toFixed(1)}% probability. Confidence is ${input.consensus.confidence?.toFixed(2) ?? "unknown"}. ${input.consensus.layersExcluded} layers excluded due to insufficient data. Set GROQ_API_KEY to enable LLM-generated summary.`,
    model: "structured-fallback",
    tokensUsed: 0,
    durationMs: 0,
  };
}
