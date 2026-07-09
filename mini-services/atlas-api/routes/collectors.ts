// ATLAS API — routes/collectors.ts
// Collector management endpoints.
//   GET  /collectors                — list all collectors + recent runs
//   POST /collectors/run/:name      — trigger a single collector by name
//   POST /collectors/run-all-active — trigger every active collector sequentially

import { Router } from "express";
import { db } from "../lib/db.ts";
import { logger } from "../lib/logger.ts";
import { collectorRegistry } from "../collectors/registry.ts";
import type { CollectorStatusResponse } from "@atlas/shared";

export const collectorsRouter = Router();

collectorsRouter.get("/", async (_req, res) => {
  const recentRuns = await db.collectorRun.findMany({
    take: 50,
    orderBy: { startedAt: "desc" },
  });

  const response: CollectorStatusResponse = {
    collectors: collectorRegistry.list(),
    recentRuns: recentRuns.map((r) => ({
      collectorName: r.collectorName,
      status: r.status as "success" | "failed" | "insufficient_data",
      recordsIngested: r.recordsIngested,
      recordsUpdated: r.recordsUpdated,
      recordsSkipped: r.recordsSkipped,
      error: r.error ?? undefined,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? new Date().toISOString(),
      durationMs: r.finishedAt
        ? r.finishedAt.getTime() - r.startedAt.getTime()
        : Date.now() - r.startedAt.getTime(),
    })),
  };

  res.json(response);
});

collectorsRouter.post("/run/:name", async (req, res) => {
  const name = req.params.name;
  const collector = collectorRegistry.get(name);
  if (!collector) {
    res.status(404).json({ error: `Unknown collector: ${name}` });
    return;
  }

  logger.info(`manual collector trigger`, { collector: name, triggeredBy: "http" });
  try {
    const result = await collector.run();
    res.json(result);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

collectorsRouter.post("/run-all-active", async (_req, res) => {
  const active = collectorRegistry.active();
  logger.info(`running all active collectors`, { count: active.length });

  const results = [];
  for (const def of active) {
    const collector = collectorRegistry.get(def.name);
    if (!collector) continue;
    try {
      const result = await collector.run();
      results.push(result);
    } catch (err) {
      logger.error(`active collector failed`, {
        collector: def.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  res.json({ triggered: active.length, results });
});
