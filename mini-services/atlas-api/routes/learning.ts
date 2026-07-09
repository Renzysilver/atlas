// ATLAS API — routes/learning.ts
// Module 8 — Adaptive Learning endpoints (spec Section 12)

import { Router } from "express";
import { db } from "../lib/db.ts";
import { logger } from "../lib/logger.ts";
import { runResultsComparison } from "../jobs/resultsComparison.ts";
import { runAccuracyMeasurement } from "../jobs/accuracyMeasurement.ts";

export const learningRouter = Router();

learningRouter.post("/run-comparison", async (_req, res) => {
  try { res.json(await runResultsComparison()); }
  catch (err) { res.status(500).json({ error: err instanceof Error ? err.message : String(err) }); }
});

learningRouter.post("/run-accuracy", async (req, res) => {
  const reportType = (req.query.type as "daily" | "weekly") || "daily";
  try { res.json(await runAccuracyMeasurement(reportType)); }
  catch (err) { res.status(500).json({ error: err instanceof Error ? err.message : String(err) }); }
});

learningRouter.get("/report", async (req, res) => {
  const reportType = (req.query.type as "daily" | "weekly") || "daily";
  const latest = await db.learningReport.findFirst({ where: { reportType }, orderBy: { reportDate: "desc" } });
  if (!latest) { res.status(404).json({ error: "No reports found." }); return; }
  res.json({ ...latest, perMarketAccuracy: JSON.parse(latest.perMarketAccuracyJson || "{}"),
    perTierAccuracy: JSON.parse(latest.perTierAccuracyJson || "{}"),
    perLayerPerformance: JSON.parse(latest.perLayerPerformanceJson || "{}") });
});

learningRouter.get("/reports", async (_req, res) => {
  res.json(await db.learningReport.findMany({ take: 10, orderBy: { reportDate: "desc" },
    select: { id: true, reportType: true, reportDate: true, status: true, totalPredictions: true,
      correctPredictions: true, overallAccuracy: true, bestPerformingLayer: true,
      weakestPerformingLayer: true, sampleSizeNote: true, durationMs: true } }));
});

learningRouter.get("/accuracy", async (_req, res) => {
  const latest = await db.learningReport.findFirst({ where: { reportType: "daily" }, orderBy: { reportDate: "desc" } });
  if (!latest) { res.status(404).json({ error: "No reports found." }); return; }
  const totalPredictions = await db.prediction.count();
  const totalEvaluated = await db.prediction.count({ where: { result: { isNot: null } } });
  res.json({ latestReport: { reportDate: latest.reportDate, overallAccuracy: latest.overallAccuracy,
    totalPredictions: latest.totalPredictions, correctPredictions: latest.correctPredictions, sampleSizeNote: latest.sampleSizeNote },
    perMarketAccuracy: JSON.parse(latest.perMarketAccuracyJson || "{}"),
    perTierAccuracy: JSON.parse(latest.perTierAccuracyJson || "{}"),
    perLayerPerformance: JSON.parse(latest.perLayerPerformanceJson || "{}"),
    bestPerformingLayer: latest.bestPerformingLayer, weakestPerformingLayer: latest.weakestPerformingLayer,
    allTimeStats: { totalPredictions, totalEvaluated, dynamicWeightingThreshold: 200, dynamicWeightingReady: totalEvaluated >= 200 } });
});
