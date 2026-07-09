// ATLAS API — jobs/resultsComparison.ts
// Module 8 — Results Comparison (spec Section 12)

import { db } from "../lib/db.ts";
import { logger } from "../lib/logger.ts";

export interface ResultsComparisonResult {
  status: "success" | "partial" | "failed" | "insufficient_data";
  matchesProcessed: number;
  predictionsEvaluated: number;
  correctPredictions: number;
  layersEvaluated: number;
  durationMs: number;
  errors: string[];
}

function computeActualOutcome(marketType: string, homeScore: number, awayScore: number): string {
  switch (marketType) {
    case "1X2":
      if (homeScore > awayScore) return "HOME";
      if (homeScore < awayScore) return "AWAY";
      return "DRAW";
    case "O_U_2_5":
      return homeScore + awayScore > 2.5 ? "OVER_2_5" : "UNDER_2_5";
    case "BTTS":
      return homeScore > 0 && awayScore > 0 ? "BTTS_YES" : "BTTS_NO";
    default:
      return "UNKNOWN";
  }
}

function getLayerSignalDirection(score: number): string {
  if (score > 0.5) return "HOME";
  if (score < 0.5) return "AWAY";
  return "DRAW";
}

export async function runResultsComparison(): Promise<ResultsComparisonResult> {
  const startMs = Date.now();
  logger.info("results comparison job started");

  const result: ResultsComparisonResult = {
    status: "success", matchesProcessed: 0, predictionsEvaluated: 0,
    correctPredictions: 0, layersEvaluated: 0, durationMs: 0, errors: [],
  };

  try {
    const matchesNeedingResults = await db.match.findMany({
      where: {
        status: "finished", homeScore: { not: null }, awayScore: { not: null },
        predictions: { some: {} }, result: null,
      },
      include: { predictions: true, layerOutputs: { where: { status: "active", score: { not: null } } } },
    });

    if (matchesNeedingResults.length === 0) {
      result.status = "insufficient_data";
      result.durationMs = Date.now() - startMs;
      return result;
    }

    for (const match of matchesNeedingResults) {
      try {
        const homeScore = match.homeScore!;
        const awayScore = match.awayScore!;
        const actualScore = `${homeScore}-${awayScore}`;
        const actual1X2Outcome = computeActualOutcome("1X2", homeScore, awayScore);

        let correctCount = 0;
        for (const prediction of match.predictions) {
          const actualOutcome = computeActualOutcome(prediction.marketType, homeScore, awayScore);
          const isCorrect = prediction.selection === actualOutcome;
          if (isCorrect) correctCount++;

          if (prediction.marketType === "1X2") {
            await db.result.upsert({
              where: { matchId: match.id },
              create: { matchId: match.id, predictionId: prediction.id, actualOutcome, actualScore, isCorrect, scoredAt: new Date() },
              update: { predictionId: prediction.id, actualOutcome, actualScore, isCorrect, scoredAt: new Date() },
            });
          }
          result.predictionsEvaluated++;
        }
        result.correctPredictions += correctCount;

        for (const layerOutput of match.layerOutputs) {
          if (["consensus_engine", "explainability_ai", "learning_intelligence"].includes(layerOutput.layerName)) continue;
          const layerSignal = getLayerSignalDirection(layerOutput.score!);
          const agreedWithActual = layerSignal === actual1X2Outcome;

          for (const prediction of match.predictions) {
            await db.layerPerformance.upsert({
              where: { predictionId_layerName: { predictionId: prediction.id, layerName: layerOutput.layerName } },
              create: { predictionId: prediction.id, layerName: layerOutput.layerName, layerSignal,
                actualOutcome: computeActualOutcome(prediction.marketType, homeScore, awayScore), agreedWithActual },
              update: { layerSignal, actualOutcome: computeActualOutcome(prediction.marketType, homeScore, awayScore), agreedWithActual },
            });
            result.layersEvaluated++;
          }
        }
        result.matchesProcessed++;
      } catch (err) {
        result.errors.push(`Match ${match.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    result.durationMs = Date.now() - startMs;
    result.status = result.errors.length > 0 ? "partial" : "success";
    logger.info("results comparison completed", { ...result });
    return result;
  } catch (err) {
    result.status = "failed";
    result.durationMs = Date.now() - startMs;
    result.errors.push(err instanceof Error ? err.message : String(err));
    return result;
  }
}
