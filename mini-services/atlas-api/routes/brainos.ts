// ATLAS API — routes/brainos.ts
// Module 4 + 5 — BrainOS + Layer + Prediction endpoints
//
//   POST /brainos/run/:matchId   — run BrainOS for a specific match
//   GET  /brainos/fmi/:matchId    — get Final Match Intelligence for a match
//   GET  /layers                  — list all 17 layers + status
//   GET  /layers/registry         — layer definitions
//   GET  /layers/:matchId         — all layer outputs for a match
//   GET  /predictions/:matchId    — all market predictions for a match (Module 5)

import { Router } from "express";
import { db } from "../lib/db.ts";
import { logger } from "../lib/logger.ts";
import { runBrainOS } from "../brainos/orchestrator.ts";
import { getLayerStatusSummary, ALL_LAYERS } from "../layers/registry.ts";

export const brainosRouter = Router();

brainosRouter.post("/run/:matchId", async (req, res) => {
  const { matchId } = req.params;
  logger.info("manual brainos trigger", { matchId, triggeredBy: "http" });

  try {
    const fmi = await runBrainOS(matchId);
    res.json(fmi);
  } catch (err) {
    logger.error("brainos run failed", {
      matchId,
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

brainosRouter.get("/fmi/:matchId", async (req, res) => {
  const { matchId } = req.params;

  // Load all LayerOutput rows for this match
  const layerOutputs = await db.layerOutput.findMany({
    where: { matchId },
    orderBy: { layerName: "asc" },
  });

  if (layerOutputs.length === 0) {
    res.status(404).json({
      error: "No layer outputs found for this match. Run POST /brainos/run/:matchId first.",
    });
    return;
  }

  // Load match + teams
  const match = await db.match.findUnique({
    where: { id: matchId },
    include: { homeTeam: true, awayTeam: true },
  });

  // Load prediction (if logged)
  const prediction = await db.prediction.findFirst({
    where: { matchId },
    orderBy: { createdAt: "desc" },
  });

  res.json({
    matchId,
    match: match
      ? {
          homeTeam: match.homeTeam.name,
          awayTeam: match.awayTeam.name,
          kickoff: match.kickoffUtc.toISOString(),
          venue: match.venue,
          season: match.season,
        }
      : null,
    layerOutputs,
    prediction: prediction
      ? {
          market: prediction.marketType,
          selection: prediction.selection,
          probability: prediction.probability,
          confidence: prediction.confidence,
        }
      : null,
  });
});

brainosRouter.get("/layers", (_req, res) => {
  res.json({
    layers: getLayerStatusSummary(),
    total: ALL_LAYERS.length,
    active: ALL_LAYERS.filter((l) => l.definition.buildStatus === "active").length,
    stub: ALL_LAYERS.filter((l) => l.definition.buildStatus === "stub").length,
    future: ALL_LAYERS.filter((l) => l.definition.buildStatus === "future").length,
  });
});

brainosRouter.get("/layers/registry", (_req, res) => {
  res.json(
    ALL_LAYERS.map((l) => ({
      name: l.definition.name,
      layerNumber: l.definition.layerNumber,
      description: l.definition.description,
      buildStatus: l.definition.buildStatus,
      feedsConsensus: l.definition.feedsConsensus,
      weight: l.weight,
    })),
  );
});

brainosRouter.get("/layers/:matchId", async (req, res) => {
  const { matchId } = req.params;
  const layerOutputs = await db.layerOutput.findMany({
    where: { matchId },
    orderBy: { layerName: "asc" },
  });

  const match = await db.match.findUnique({
    where: { id: matchId },
    include: { homeTeam: true, awayTeam: true },
  });

  res.json({
    matchId,
    match: match
      ? {
          homeTeam: match.homeTeam.name,
          awayTeam: match.awayTeam.name,
          kickoff: match.kickoffUtc.toISOString(),
        }
      : null,
    layers: layerOutputs,
  });
});

// Module 5 — Prediction Decision Engine endpoints
brainosRouter.get("/predictions/:matchId", async (req, res) => {
  const { matchId } = req.params;

  const match = await db.match.findUnique({
    where: { id: matchId },
    include: { homeTeam: true, awayTeam: true },
  });

  if (!match) {
    res.status(404).json({ error: "Match not found" });
    return;
  }

  const predictions = await db.prediction.findMany({
    where: { matchId },
    orderBy: { marketType: "asc" },
  });

  res.json({
    matchId,
    match: {
      homeTeam: match.homeTeam.name,
      awayTeam: match.awayTeam.name,
      kickoff: match.kickoffUtc.toISOString(),
      score: match.homeScore !== null ? `${match.homeScore}-${match.awayScore}` : null,
    },
    predictions: predictions.map((p) => ({
      marketType: p.marketType,
      selection: p.selection,
      probability: p.probability,
      confidence: p.confidence,
      recommendationProfile: p.recommendationProfile,
      valueScore: p.valueScore,
      riskScore: p.riskScore,
      volatility: p.volatility,
      createdAt: p.createdAt.toISOString(),
    })),
    highValueTierEnabled: false, // always false until Market Intelligence activates
  });
});

// Module 6 — Explainability endpoint
brainosRouter.get("/explainability/:matchId", async (req, res) => {
  const { matchId } = req.params;

  const match = await db.match.findUnique({
    where: { id: matchId },
    include: { homeTeam: true, awayTeam: true },
  });

  if (!match) {
    res.status(404).json({ error: "Match not found" });
    return;
  }

  // Get the explainability_ai layer output
  const explainability = await db.layerOutput.findUnique({
    where: { matchId_layerName: { matchId, layerName: "explainability_ai" } },
  });

  if (!explainability) {
    res.status(404).json({
      error: "No explainability output found. Run POST /brainos/run/:matchId first.",
    });
    return;
  }

  res.json({
    matchId,
    match: {
      homeTeam: match.homeTeam.name,
      awayTeam: match.awayTeam.name,
      kickoff: match.kickoffUtc.toISOString(),
      score: match.homeScore !== null ? `${match.homeScore}-${match.awayScore}` : null,
    },
    explainability: {
      status: explainability.status,
      score: explainability.score,
      confidence: explainability.confidence,
      reasoning: explainability.reasoning,
      computedAt: explainability.computedAt.toISOString(),
    },
    groqConfigured: !!(process.env.GROQ_API_KEY && process.env.GROQ_API_KEY !== "YOUR_GROQ_API_KEY_HERE"),
  });
});

// Module 7 — Risk Management endpoint
brainosRouter.get("/risk/:matchId", async (req, res) => {
  const { matchId } = req.params;

  const match = await db.match.findUnique({
    where: { id: matchId },
    include: { homeTeam: true, awayTeam: true },
  });

  if (!match) {
    res.status(404).json({ error: "Match not found" });
    return;
  }

  const predictions = await db.prediction.findMany({
    where: { matchId },
    orderBy: { marketType: "asc" },
  });

  if (predictions.length === 0) {
    res.status(404).json({
      error: "No predictions found. Run POST /brainos/run/:matchId first.",
    });
    return;
  }

  res.json({
    matchId,
    match: {
      homeTeam: match.homeTeam.name,
      awayTeam: match.awayTeam.name,
      kickoff: match.kickoffUtc.toISOString(),
      score: match.homeScore !== null ? `${match.homeScore}-${match.awayScore}` : null,
    },
    riskAssessment: {
      perMarketRisk: predictions.map((p) => ({
        marketType: p.marketType,
        selection: p.selection,
        probability: p.probability,
        confidence: p.confidence,
        riskScore: p.riskScore,
        volatility: p.volatility,
        valueScore: p.valueScore,
        recommendationProfile: p.recommendationProfile,
      })),
      valueScoreEnabled: false, // always false until Market Intelligence activates
      valueScoreReason:
        "Value Score requires real market odds from Market Intelligence (Layer 8). " +
        "ODDS_API_KEY not configured. Per spec Section 11: NEVER fabricate a value bet claim.",
    },
  });
});

