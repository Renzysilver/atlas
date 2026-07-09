// ATLAS API — jobs/accuracyMeasurement.ts
// Module 8 — Accuracy Measurement + Learning Reports (spec Section 12)

import { db } from "../lib/db.ts";
import { logger } from "../lib/logger.ts";

export interface AccuracyResult {
  status: "success" | "partial" | "failed" | "insufficient_data";
  reportType: "daily" | "weekly";
  reportDate: string;
  totalPredictions: number;
  correctPredictions: number;
  overallAccuracy: number | null;
  perMarketAccuracy: Record<string, { total: number; correct: number; accuracy: number }>;
  perTierAccuracy: Record<string, { total: number; correct: number; accuracy: number }>;
  perLayerPerformance: Record<string, { evaluated: number; agreed: number; accuracy: number }>;
  bestPerformingLayer: string | null;
  weakestPerformingLayer: string | null;
  sampleSizeNote: string;
  durationMs: number;
}

export async function runAccuracyMeasurement(reportType: "daily" | "weekly" = "daily"): Promise<AccuracyResult> {
  const startMs = Date.now();
  const now = new Date();
  const reportDate = new Date(now);
  reportDate.setUTCHours(0, 0, 0, 0);
  const lookbackDays = reportType === "weekly" ? 7 : 1;
  const startDate = new Date(reportDate.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

  const result: AccuracyResult = {
    status: "success", reportType, reportDate: reportDate.toISOString(),
    totalPredictions: 0, correctPredictions: 0, overallAccuracy: null,
    perMarketAccuracy: {}, perTierAccuracy: {}, perLayerPerformance: {},
    bestPerformingLayer: null, weakestPerformingLayer: null, sampleSizeNote: "", durationMs: 0,
  };

  try {
    // Query ALL predictions for matches that have Result rows
    const evaluatedMatches = await db.match.findMany({
      where: { result: { isNot: null }, predictions: { some: {} } },
      include: { result: true, predictions: { include: { layerPerformance: true } } },
    });

    const evaluatedPredictions: Array<any> = [];
    for (const match of evaluatedMatches) {
      for (const pred of match.predictions) {
        const homeScore = match.homeScore!;
        const awayScore = match.awayScore!;
        let actualOutcome: string;
        switch (pred.marketType) {
          case "1X2": actualOutcome = homeScore > awayScore ? "HOME" : homeScore < awayScore ? "AWAY" : "DRAW"; break;
          case "O_U_2_5": actualOutcome = homeScore + awayScore > 2.5 ? "OVER_2_5" : "UNDER_2_5"; break;
          case "BTTS": actualOutcome = homeScore > 0 && awayScore > 0 ? "BTTS_YES" : "BTTS_NO"; break;
          default: actualOutcome = "UNKNOWN";
        }
        evaluatedPredictions.push({ ...pred, computedIsCorrect: pred.selection === actualOutcome });
      }
    }

    if (evaluatedPredictions.length === 0) {
      result.status = "insufficient_data";
      result.sampleSizeNote = "No evaluated predictions. Run results comparison job first.";
      result.durationMs = Date.now() - startMs;
      return result;
    }

    result.totalPredictions = evaluatedPredictions.length;
    result.correctPredictions = evaluatedPredictions.filter((p) => p.computedIsCorrect).length;
    result.overallAccuracy = result.correctPredictions / result.totalPredictions;

    // Per-market
    const marketStats: Record<string, { total: number; correct: number }> = {};
    for (const pred of evaluatedPredictions) {
      if (!marketStats[pred.marketType]) marketStats[pred.marketType] = { total: 0, correct: 0 };
      marketStats[pred.marketType].total++;
      if (pred.computedIsCorrect) marketStats[pred.marketType].correct++;
    }
    for (const [market, stats] of Object.entries(marketStats))
      result.perMarketAccuracy[market] = { ...stats, accuracy: stats.total > 0 ? stats.correct / stats.total : 0 };

    // Per-tier
    const tierStats: Record<string, { total: number; correct: number }> = {};
    for (const pred of evaluatedPredictions) {
      const tier = pred.recommendationProfile || "unknown";
      if (!tierStats[tier]) tierStats[tier] = { total: 0, correct: 0 };
      tierStats[tier].total++;
      if (pred.computedIsCorrect) tierStats[tier].correct++;
    }
    for (const [tier, stats] of Object.entries(tierStats))
      result.perTierAccuracy[tier] = { ...stats, accuracy: stats.total > 0 ? stats.correct / stats.total : 0 };

    // Per-layer
    const layerStats: Record<string, { evaluated: number; agreed: number }> = {};
    for (const pred of evaluatedPredictions) {
      for (const lp of pred.layerPerformance) {
        if (!layerStats[lp.layerName]) layerStats[lp.layerName] = { evaluated: 0, agreed: 0 };
        layerStats[lp.layerName].evaluated++;
        if (lp.agreedWithActual) layerStats[lp.layerName].agreed++;
      }
    }
    for (const [layer, stats] of Object.entries(layerStats))
      result.perLayerPerformance[layer] = { ...stats, accuracy: stats.evaluated > 0 ? stats.agreed / stats.evaluated : 0 };

    const layerAccuracies = Object.entries(result.perLayerPerformance)
      .filter(([_, s]) => s.evaluated > 0).map(([name, s]) => ({ name, accuracy: s.accuracy }));
    if (layerAccuracies.length > 0) {
      layerAccuracies.sort((a, b) => b.accuracy - a.accuracy);
      result.bestPerformingLayer = layerAccuracies[0].name;
      result.weakestPerformingLayer = layerAccuracies[layerAccuracies.length - 1].name;
    }

    const THRESHOLD = 200;
    result.sampleSizeNote = result.totalPredictions < THRESHOLD
      ? `${result.totalPredictions} predictions — below ${THRESHOLD} threshold for dynamic weight re-adjustment (Phase 2 FUTURE).`
      : `${result.totalPredictions} predictions — above ${THRESHOLD} threshold. Dynamic weighting ready.`;

    result.durationMs = Date.now() - startMs;

    await db.learningReport.upsert({
      where: { reportType_reportDate: { reportType, reportDate } },
      create: { reportType, reportDate, status: result.status, totalPredictions: result.totalPredictions,
        correctPredictions: result.correctPredictions, overallAccuracy: result.overallAccuracy,
        perMarketAccuracyJson: JSON.stringify(result.perMarketAccuracy),
        perTierAccuracyJson: JSON.stringify(result.perTierAccuracy),
        perLayerPerformanceJson: JSON.stringify(result.perLayerPerformance),
        bestPerformingLayer: result.bestPerformingLayer, weakestPerformingLayer: result.weakestPerformingLayer,
        sampleSizeNote: result.sampleSizeNote, durationMs: result.durationMs },
      update: { status: result.status, totalPredictions: result.totalPredictions,
        correctPredictions: result.correctPredictions, overallAccuracy: result.overallAccuracy,
        perMarketAccuracyJson: JSON.stringify(result.perMarketAccuracy),
        perTierAccuracyJson: JSON.stringify(result.perTierAccuracy),
        perLayerPerformanceJson: JSON.stringify(result.perLayerPerformance),
        bestPerformingLayer: result.bestPerformingLayer, weakestPerformingLayer: result.weakestPerformingLayer,
        sampleSizeNote: result.sampleSizeNote, durationMs: result.durationMs },
    });

    logger.info("accuracy measurement completed", { reportType, ...result });
    return result;
  } catch (err) {
    result.status = "failed";
    result.durationMs = Date.now() - startMs;
    return result;
  }
}
