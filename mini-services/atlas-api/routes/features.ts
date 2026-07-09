// ATLAS API — routes/features.ts
// Module 3 — Feature Engineering endpoints
//
//   POST /features/run              — trigger feature engineering job
//   GET  /features                  — list all features + status summary
//   GET  /features/team/:teamId     — all features for a team (season-level)
//   GET  /features/match/:matchId   — all features for a match (both teams)
//   GET  /features/registry         — feature definitions (active + stub)

import { Router } from "express";
import { db } from "../lib/db.ts";
import { logger } from "../lib/logger.ts";
import { runFeatureEngineering } from "../jobs/featureEngineering.ts";
import { FEATURE_REGISTRY, ACTIVE_FEATURES, STUB_FEATURES } from "../lib/features.ts";
import { EPL_SEASON } from "@atlas/shared";

const SEASON = parseInt(process.env.API_FOOTBALL_SEASON || String(EPL_SEASON), 10);

export const featuresRouter = Router();

featuresRouter.post("/run", async (_req, res) => {
  logger.info("manual feature engineering trigger", { triggeredBy: "http" });
  try {
    const result = await runFeatureEngineering();
    res.json(result);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

featuresRouter.get("/registry", (_req, res) => {
  res.json({
    active: ACTIVE_FEATURES.map((f) => ({
      name: f.name,
      description: f.description,
      level: f.level,
      status: f.status,
    })),
    stub: STUB_FEATURES.map((f) => ({
      name: f.name,
      description: f.description,
      level: f.level,
      status: f.status,
    })),
    total: FEATURE_REGISTRY.length,
  });
});

featuresRouter.get("/", async (_req, res) => {
  // Summary: count of each feature status
  const teamFeatures = await db.teamFeature.groupBy({
    by: ["status", "featureName"],
    _count: true,
    where: { season: SEASON },
  });

  const matchFeatures = await db.matchFeature.groupBy({
    by: ["status", "featureName"],
    _count: true,
  });

  res.json({
    season: SEASON,
    teamFeatures: teamFeatures.reduce(
      (acc, row) => {
        const key = `${row.featureName}:${row.status}`;
        acc[key] = row._count;
        return acc;
      },
      {} as Record<string, number>,
    ),
    matchFeatures: matchFeatures.reduce(
      (acc, row) => {
        const key = `${row.featureName}:${row.status}`;
        acc[key] = row._count;
        return acc;
      },
      {} as Record<string, number>,
    ),
    registry: {
      active: ACTIVE_FEATURES.length,
      stub: STUB_FEATURES.length,
      total: FEATURE_REGISTRY.length,
    },
  });
});

featuresRouter.get("/team/:teamId", async (req, res) => {
  const { teamId } = req.params;
  const team = await db.team.findUnique({ where: { id: teamId } });
  if (!team) {
    res.status(404).json({ error: "Team not found" });
    return;
  }

  const features = await db.teamFeature.findMany({
    where: { teamId, season: SEASON },
    orderBy: { featureName: "asc" },
  });

  res.json({
    team: { id: team.id, name: team.name },
    season: SEASON,
    features: features.map((f) => ({
      name: f.featureName,
      value: f.value,
      confidence: f.confidence,
      status: f.status,
      reason: f.reason,
      computedAt: f.computedAt,
    })),
  });
});

featuresRouter.get("/match/:matchId", async (req, res) => {
  const { matchId } = req.params;
  const match = await db.match.findUnique({
    where: { id: matchId },
    include: { homeTeam: true, awayTeam: true },
  });
  if (!match) {
    res.status(404).json({ error: "Match not found" });
    return;
  }

  const features = await db.matchFeature.findMany({
    where: { matchId },
    orderBy: [{ teamId: "asc" }, { featureName: "asc" }],
  });

  res.json({
    match: {
      id: match.id,
      homeTeam: match.homeTeam.name,
      awayTeam: match.awayTeam.name,
      kickoff: match.kickoffUtc,
      score: `${match.homeScore}-${match.awayScore}`,
    },
    features: features.map((f) => ({
      teamId: f.teamId,
      teamName: f.teamId === match.homeTeamId ? match.homeTeam.name : match.awayTeam.name,
      name: f.featureName,
      value: f.value,
      confidence: f.confidence,
      status: f.status,
      reason: f.reason,
      computedAt: f.computedAt,
    })),
  });
});
