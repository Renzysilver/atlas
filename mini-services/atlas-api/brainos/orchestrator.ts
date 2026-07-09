// ATLAS API — brainos/orchestrator.ts
// Module 4 — BrainOS Orchestration Layer (spec Section 8)
//
// Per spec Section 8: BrainOS does not predict. It:
//   1. Calls all 17 layers in parallel
//   2. Filters out any layer returning insufficient_data from the weighted
//      consensus (does NOT treat missing data as zero or average)
//   3. Passes active layer outputs to the Consensus Engine
//   4. Passes consensus output + all raw layer outputs to the Explainability AI
//   5. Passes everything to the Risk Management Engine (Module 7)
//   6. Assembles the Final Match Intelligence object
//
// Per spec Section 0 Constitution Rule 3: "No module calls another module
// directly. No shortcut logic bypasses BrainOS. Every layer output flows
// through BrainOS to Consensus to Explainability to Risk to the Decision
// Engine, in that order, always."

import { db } from "../lib/db.ts";
import { logger } from "../lib/logger.ts";
import type { LayerOutput } from "@atlas/shared";
import type { LayerContext } from "../layers/base.ts";
import { ALL_LAYERS } from "../layers/registry.ts";
import { ConsensusEngineLayer } from "../layers/consensusEngine.ts";
import { ExplainabilityAiLayer } from "../layers/explainabilityAi.ts";
import { LearningIntelligenceLayer } from "../layers/learningIntelligence.ts";
import type { ConsensusResult } from "../layers/consensusEngine.ts";
import { runDecisionEngine, persistPredictions, type MarketPrediction } from "./decisionEngine.ts";

// ============================================================
// Final Match Intelligence object (spec Section 8.6)
// ============================================================

export interface FinalMatchIntelligence {
  matchId: string;
  match: {
    homeTeam: string;
    awayTeam: string;
    kickoff: string;
    venue: string | null;
    season: number;
  };
  layerOutputs: LayerOutput[];
  consensus: ConsensusResult | null;
  marketPredictions: MarketPrediction[];
  explainability: LayerOutput | null;
  learningLog: LayerOutput | null;
  finalPrediction: {
    market: string;
    selection: string;
    probability: number;
    confidence: number;
    homeWinProb: number;
    drawProb: number;
    awayWinProb: number;
  } | null;
  metadata: {
    computedAt: string;
    durationMs: number;
    layersActive: number;
    layersInsufficient: number;
    layersFuture: number;
    brainosVersion: string;
  };
}

// ============================================================
// BrainOS orchestrator
// ============================================================

const BRAINOS_VERSION = "1.0.0-module5";

export async function runBrainOS(matchId: string): Promise<FinalMatchIntelligence> {
  const startMs = Date.now();
  logger.info("brainos: starting orchestration", { matchId });

  // 1. Load match + teams
  const match = await db.match.findUnique({
    where: { id: matchId },
    include: { homeTeam: true, awayTeam: true },
  });
  if (!match) {
    throw new Error(`Match not found: ${matchId}`);
  }

  // 2. Load features for both teams (season-level + match-level)
  const [homeTeamFeatures, awayTeamFeatures, homeMatchFeatures, awayMatchFeatures] =
    await Promise.all([
      loadTeamFeatures(match.homeTeamId, match.season),
      loadTeamFeatures(match.awayTeamId, match.season),
      loadMatchFeatures(matchId, match.homeTeamId),
      loadMatchFeatures(matchId, match.awayTeamId),
    ]);

  const ctx: LayerContext = {
    matchId,
    homeTeamId: match.homeTeamId,
    awayTeamId: match.awayTeamId,
    season: match.season,
    homeTeamFeatures,
    awayTeamFeatures,
    homeMatchFeatures,
    awayMatchFeatures,
  };

  // 3. Call all 17 layers in parallel (spec Section 8.1)
  logger.info("brainos: calling all 17 layers in parallel");
  const layerResults = await Promise.all(
    ALL_LAYERS.map(async (layer) => {
      try {
        const output = await layer.compute(ctx);
        return { layer, output };
      } catch (err) {
        logger.error(`brainos: layer ${layer.definition.name} threw`, {
          error: err instanceof Error ? err.message : String(err),
        });
        return {
          layer,
          output: {
            layer_name: layer.definition.name,
            status: "insufficient_data" as const,
            score: null,
            confidence: null,
            reasoning: `Layer threw error: ${err instanceof Error ? err.message : String(err)}`,
          } as LayerOutput,
        };
      }
    }),
  );

  // Collect all layer outputs (excluding engine-level layers that are called separately)
  const statisticalLayerOutputs: LayerOutput[] = [];
  for (const { layer, output } of layerResults) {
    // Skip engine-level layers — they're called explicitly below
    if (
      layer.definition.name === "consensus_engine" ||
      layer.definition.name === "explainability_ai" ||
      layer.definition.name === "learning_intelligence"
    ) {
      continue;
    }
    statisticalLayerOutputs.push(output);
  }

  // 4. Pass active layer outputs to Consensus Engine (spec Section 8.3)
  logger.info("brainos: computing consensus", {
    activeLayers: statisticalLayerOutputs.filter((l) => l.status === "active").length,
    insufficientLayers: statisticalLayerOutputs.filter((l) => l.status === "insufficient_data").length,
  });

  const consensusEngine = new ConsensusEngineLayer();
  const consensus: ConsensusResult = await consensusEngine.computeConsensus({
    layerOutputs: statisticalLayerOutputs,
    matchId,
  }, ctx);

  // 4.5 Module 5: Run Decision Engine (spec Section 9)
  // Produces 3 market predictions: 1X2, O/U 2.5, BTTS
  logger.info("brainos: running prediction decision engine");
  const decisionResult = await runDecisionEngine(
    consensus,
    statisticalLayerOutputs,
    matchId,
  );

  // Persist the 3 market predictions to the Prediction table
  await persistPredictions(matchId, decisionResult.predictions, consensus, statisticalLayerOutputs);

  // 5. Pass consensus + raw outputs + decision predictions to Explainability AI (spec Section 8.4)
  logger.info("brainos: generating explainability");
  const explainabilityAi = new ExplainabilityAiLayer();
  const explainability = await explainabilityAi.computeExplainability({
    layerOutputs: [...statisticalLayerOutputs, consensus],
    consensus,
    matchId,
    marketPredictions: decisionResult.predictions,
  });

  // 6. Log prediction via Learning Intelligence (spec Section 8.6 + Module 8)
  // Module 5: now logs all 3 market predictions, not just 1X2
  logger.info("brainos: logging 3 market predictions for learning");
  const learningIntelligence = new LearningIntelligenceLayer();
  const learningLog = await learningIntelligence.logPrediction({
    matchId,
    consensus,
    layerOutputs: [...statisticalLayerOutputs, consensus, explainability],
    marketPredictions: decisionResult.predictions,
  });

  // 7. Persist all LayerOutput rows to DB (spec Section 14 — one row per layer per match)
  logger.info("brainos: persisting layer outputs to DB");
  for (const output of [...statisticalLayerOutputs, consensus, explainability, learningLog]) {
    await db.layerOutput.upsert({
      where: {
        matchId_layerName: { matchId, layerName: output.layer_name },
      },
      create: {
        matchId,
        layerName: output.layer_name,
        status: output.status,
        score: output.score,
        confidence: output.confidence,
        reasoning: output.reasoning,
        inputsHash: undefined, // could hash the input feature vector for reproducibility
      },
      update: {
        status: output.status,
        score: output.score,
        confidence: output.confidence,
        reasoning: output.reasoning,
        computedAt: new Date(),
      },
    });
  }

  // 8. Assemble Final Match Intelligence object (spec Section 8.6)
  const durationMs = Date.now() - startMs;
  const layersActive = statisticalLayerOutputs.filter((l) => l.status === "active").length;
  const layersInsufficient = statisticalLayerOutputs.filter((l) => l.status === "insufficient_data").length;
  const layersFuture = statisticalLayerOutputs.filter((l) => l.status === "future").length;

  const finalPrediction = consensus.status === "active"
    ? {
        market: "1X2",
        selection: consensus.homeWinProbability > consensus.awayWinProbability
          ? (consensus.homeWinProbability > consensus.drawProbability ? "HOME" : "DRAW")
          : (consensus.awayWinProbability > consensus.drawProbability ? "AWAY" : "DRAW"),
        probability: Math.max(
          consensus.homeWinProbability,
          consensus.drawProbability,
          consensus.awayWinProbability,
        ),
        confidence: consensus.confidence ?? 0,
        homeWinProb: consensus.homeWinProbability,
        drawProb: consensus.drawProbability,
        awayWinProb: consensus.awayWinProbability,
      }
    : null;

  const fmi: FinalMatchIntelligence = {
    matchId,
    match: {
      homeTeam: match.homeTeam.name,
      awayTeam: match.awayTeam.name,
      kickoff: match.kickoffUtc.toISOString(),
      venue: match.venue,
      season: match.season,
    },
    layerOutputs: [...statisticalLayerOutputs, consensus, explainability, learningLog],
    consensus,
    marketPredictions: decisionResult.predictions,
    explainability,
    learningLog,
    finalPrediction,
    metadata: {
      computedAt: new Date().toISOString(),
      durationMs,
      layersActive,
      layersInsufficient,
      layersFuture,
      brainosVersion: BRAINOS_VERSION,
    },
  };

  logger.info("brainos: orchestration complete", {
    matchId,
    durationMs,
    layersActive,
    layersInsufficient,
    layersFuture,
    consensusScore: consensus.score,
    consensusConfidence: consensus.confidence,
  });

  return fmi;
}

// ============================================================
// Feature loaders
// ============================================================

async function loadTeamFeatures(
  teamId: string,
  season: number,
): Promise<Record<string, { value: number | null; status: string; confidence: number }>> {
  const features = await db.teamFeature.findMany({
    where: { teamId, season },
  });
  const map: Record<string, { value: number | null; status: string; confidence: number }> = {};
  for (const f of features) {
    map[f.featureName] = {
      value: f.value,
      status: f.status,
      confidence: f.confidence,
    };
  }
  return map;
}

async function loadMatchFeatures(
  matchId: string,
  teamId: string,
): Promise<Record<string, { value: number | null; status: string; confidence: number }>> {
  const features = await db.matchFeature.findMany({
    where: { matchId, teamId },
  });
  const map: Record<string, { value: number | null; status: string; confidence: number }> = {};
  for (const f of features) {
    map[f.featureName] = {
      value: f.value,
      status: f.status,
      confidence: f.confidence,
    };
  }
  return map;
}
