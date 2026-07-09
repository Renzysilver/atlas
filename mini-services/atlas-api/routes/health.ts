// ATLAS API — routes/health.ts
// Health + readiness endpoint. Reports subsystem connectivity.

import { Router } from "express";
import { db } from "../lib/db.ts";
import { getQueue } from "../lib/queue.ts";
import { getQuotaStatus } from "../lib/apiFootball.ts";
import type { HealthResponse } from "@atlas/shared";

export const healthRouter = Router();

let startTime = Date.now();

healthRouter.get("/", async (_req, res) => {
  const checks: HealthResponse["checks"] = {
    database: "ok",
    queue: "ok",
    apiFootball: "ok",
    groq: "ok",
  };

  // Database check
  try {
    await db.$queryRaw`SELECT 1`;
  } catch {
    checks.database = "fail";
  }

  // Queue check (always ok — in-memory adapter never fails)
  try {
    getQueue();
  } catch {
    checks.queue = "fail";
  }

  // API-Football check
  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey || apiKey === "YOUR_API_FOOTBALL_KEY_HERE") {
    checks.apiFootball = "unconfigured";
  }

  // Groq check
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey || groqKey === "YOUR_GROQ_API_KEY_HERE") {
    checks.groq = "unconfigured";
  }

  const allOk = checks.database === "ok" && checks.queue === "ok";
  const status: HealthResponse["status"] = allOk
    ? "ok"
    : checks.database === "fail"
      ? "down"
      : "degraded";

  const response: HealthResponse = {
    status,
    service: "atlas-api",
    version: "0.1.0-phase1-module1",
    timestamp: new Date().toISOString(),
    checks,
    uptime: Date.now() - startTime,
  };

  res.status(status === "down" ? 503 : 200).json(response);
});

healthRouter.get("/quota", async (_req, res) => {
  try {
    const quota = await getQuotaStatus();
    res.json(quota);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
