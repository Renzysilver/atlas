// ATLAS API — routes/cleaning.ts
// Module 2 — Data Cleaning & Validation endpoints
//
//   POST /cleaning/run         — trigger reconciliation job
//   GET  /cleaning/report      — latest cleaning report
//   GET  /cleaning/reports     — last 10 reports (history)
//   GET  /validation/issues    — current validation issues (from latest report)

import { Router } from "express";
import { db } from "../lib/db.ts";
import { logger } from "../lib/logger.ts";
import { runReconciliation } from "../jobs/reconciliation.ts";

export const cleaningRouter = Router();

cleaningRouter.post("/run", async (_req, res) => {
  logger.info("manual reconciliation trigger", { triggeredBy: "http" });
  try {
    const result = await runReconciliation();
    res.json(result);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

cleaningRouter.get("/report", async (_req, res) => {
  const latest = await db.cleaningReport.findFirst({
    orderBy: { runAt: "desc" },
  });

  if (!latest) {
    res.status(404).json({ error: "No cleaning reports found. Run POST /cleaning/run first." });
    return;
  }

  res.json({
    ...latest,
    tableReports: JSON.parse(latest.tableReportsJson),
    sampleIssues: JSON.parse(latest.sampleIssuesJson),
  });
});

cleaningRouter.get("/reports", async (_req, res) => {
  const reports = await db.cleaningReport.findMany({
    take: 10,
    orderBy: { runAt: "desc" },
    select: {
      id: true,
      runAt: true,
      status: true,
      durationMs: true,
      totalRecordsAudited: true,
      duplicateFixtures: true,
      missingSourceConfidence: true,
      zeroFilledStats: true,
      htmlEntityNames: true,
      orphanedForeignKeys: true,
      namesDecoded: true,
      zeroFilledToNull: true,
      cleanSheetsDerived: true,
    },
  });

  res.json(reports);
});

cleaningRouter.get("/issues", async (_req, res) => {
  const latest = await db.cleaningReport.findFirst({
    orderBy: { runAt: "desc" },
  });

  if (!latest) {
    res.status(404).json({ error: "No cleaning reports found." });
    return;
  }

  const issues = JSON.parse(latest.sampleIssuesJson);
  res.json({
    reportId: latest.id,
    runAt: latest.runAt,
    totalIssues: issues.length,
    issues,
  });
});
