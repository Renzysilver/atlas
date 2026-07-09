// ATLAS API — routes/stats.ts
// DB stats + API quota usage for dashboard consumption.

import { Router } from "express";
import { db } from "../lib/db.ts";
import { getQuotaStatus } from "../lib/apiFootball.ts";
import type { DatabaseStatsResponse } from "@atlas/shared";

export const statsRouter = Router();

statsRouter.get("/", async (_req, res) => {
  const tables: DatabaseStatsResponse["tables"] = [];

  // Each entry: model name + the timestamp field to use for "last updated"
  // (not all Prisma models have updatedAt — CollectorRun uses startedAt, etc.)
  const tableQueries: Array<{ name: string; model: keyof typeof db; tsField: string }> = [
    { name: "teams", model: "team", tsField: "updatedAt" },
    { name: "players", model: "player", tsField: "updatedAt" },
    { name: "matches", model: "match", tsField: "updatedAt" },
    { name: "lineups", model: "lineup", tsField: "createdAt" },
    { name: "injuries", model: "injury", tsField: "updatedAt" },
    { name: "standings", model: "standing", tsField: "updatedAt" },
    { name: "team_stats", model: "teamStat", tsField: "updatedAt" },
    { name: "player_stats", model: "playerStat", tsField: "updatedAt" },
    { name: "head_to_head", model: "headToHead", tsField: "updatedAt" },
    { name: "layer_outputs", model: "layerOutput", tsField: "createdAt" },
    { name: "predictions", model: "prediction", tsField: "createdAt" },
    { name: "results", model: "result", tsField: "createdAt" },
    { name: "daily_reports", model: "dailyReport", tsField: "createdAt" },
    { name: "collector_runs", model: "collectorRun", tsField: "startedAt" },
  ];

  for (const { name, model, tsField } of tableQueries) {
    try {
      const rowCount = await (db[model] as any).count();
      const lastRecord = await (db[model] as any).findFirst({
        orderBy: { [tsField]: "desc" },
        select: { [tsField]: true },
      }).catch(() => null);
      const tsValue = lastRecord?.[tsField];
      tables.push({
        name,
        rowCount,
        lastUpdated: tsValue ? tsValue.toISOString() : null,
      });
    } catch {
      tables.push({ name, rowCount: 0, lastUpdated: null });
    }
  }

  // API quota
  let apiQuota: DatabaseStatsResponse["apiQuota"];
  try {
    const q = await getQuotaStatus();
    apiQuota = {
      apiFootball: {
        used: q.used,
        limit: q.limit,
        resetAt: q.resetsAt.toISOString(),
      },
      groq: { used: 0, limit: 10000 }, // Groq has generous free tier
    };
  } catch {
    apiQuota = {
      apiFootball: { used: 0, limit: 100, resetAt: null as any },
      groq: { used: 0, limit: 10000 },
    };
  }

  const response: DatabaseStatsResponse = { tables, apiQuota };
  res.json(response);
});

// Recent matches endpoint — dashboard shows next 7 days of fixtures
statsRouter.get("/fixtures", async (_req, res) => {
  const now = new Date();
  const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const matches = await db.match.findMany({
    where: {
      OR: [
        { kickoffUtc: { gte: now, lte: sevenDaysLater } },
        { status: "finished", kickoffUtc: { gte: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000) } },
      ],
    },
    take: 30,
    orderBy: { kickoffUtc: "asc" },
    include: {
      homeTeam: true,
      awayTeam: true,
      lineups: { select: { id: true, isStarter: true } },
    },
  });

  res.json(matches);
});
