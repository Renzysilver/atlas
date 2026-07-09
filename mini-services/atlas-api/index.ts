// ATLAS API — entry point (Express + Prisma + scheduler)
//
// Per ATLAS spec Section 2: "Backend: Node.js / Express (match project
// conventions already used across Vali's stack — VERA, NEXUS)"
//
// This mini-service runs on port 4001. The Next.js dashboard (port 3000)
// calls it via the Caddy gateway using `?XTransformPort=4001`.
//
// PRODUCTION SWAP: no code changes. Set ATLAS_API_PORT + DATABASE_URL +
// REDIS_URL in .env pointed at the Docker Compose stack from infra/.

import express from "express";
import cors from "cors";
import { logger } from "./lib/logger.ts";
import { startScheduler } from "./jobs/scheduler.ts";
import { healthRouter } from "./routes/health.ts";
import { collectorsRouter } from "./routes/collectors.ts";
import { statsRouter } from "./routes/stats.ts";
import { cleaningRouter } from "./routes/cleaning.ts";
import { featuresRouter } from "./routes/features.ts";
import { brainosRouter } from "./routes/brainos.ts";

const PORT = parseInt(process.env.ATLAS_API_PORT || "4001", 10);

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Request log middleware
app.use((req, _res, next) => {
  logger.debug("http request", {
    method: req.method,
    path: req.path,
    userAgent: req.get("user-agent"),
  });
  next();
});

// Routes
app.get("/", (_req, res) => {
  res.json({
    service: "atlas-api",
    version: "0.1.0-phase1-module5",
    phase: 1,
    currentModule: "module_5_decision_engine",
    specVersion: "ATLAS Master Build Prompt v1.0",
    endpoints: [
      "GET  /health",
      "GET  /health/quota",
      "GET  /collectors",
      "POST /collectors/run/:name",
      "POST /collectors/run-all-active",
      "GET  /stats",
      "GET  /stats/fixtures",
      "POST /cleaning/run",
      "GET  /cleaning/report",
      "GET  /cleaning/reports",
      "GET  /validation/issues",
      "POST /features/run",
      "GET  /features",
      "GET  /features/registry",
      "GET  /features/team/:teamId",
      "GET  /features/match/:matchId",
      "POST /brainos/run/:matchId",
      "GET  /brainos/fmi/:matchId",
      "GET  /layers",
      "GET  /layers/registry",
      "GET  /layers/:matchId",
      "GET  /predictions/:matchId",
    ],
  });
});

app.use("/health", healthRouter);
app.use("/collectors", collectorsRouter);
app.use("/stats", statsRouter);
app.use("/cleaning", cleaningRouter);
app.use("/validation", cleaningRouter); // /validation/issues maps to cleaning router
app.use("/features", featuresRouter);
app.use("/brainos", brainosRouter);
app.use("/layers", brainosRouter); // /layers maps to brainos router

// 404
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Error handler
app.use((err: any, _req: any, res: any, _next: any) => {
  logger.error("unhandled express error", {
    error: err?.message,
    stack: err?.stack,
  });
  res.status(500).json({ error: err?.message || "Internal server error" });
});

const server = app.listen(PORT, () => {
  logger.info("atlas-api started", {
    port: PORT,
    pid: process.pid,
    node: process.version,
    constitutionRule4NeverFabricate: process.env.ATLAS_NEVER_FABRICATE !== "false",
  });
  startScheduler();
  logger.info("atlas-api scheduler started — Module 1 collectors will run on their cron schedules");
});

// Graceful shutdown
const shutdown = (signal: string) => {
  logger.info(`received ${signal}, shutting down gracefully`);
  server.close(() => {
    logger.info("atlas-api server closed");
    process.exit(0);
  });
  // Force exit after 5s if graceful close stalls
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
