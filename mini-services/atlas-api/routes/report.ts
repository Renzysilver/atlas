// ATLAS API — routes/report.ts
// Module 9 — Daily Report endpoints

import { Router } from "express";
import { db } from "../lib/db.ts";
import { logger } from "../lib/logger.ts";
import { runDailyReport } from "../jobs/dailyReport.ts";

export const reportRouter = Router();

// POST /report/generate — manually trigger report generation
reportRouter.post("/generate", async (_req, res) => {
  try {
    logger.info("manual daily report generation triggered");
    const result = await runDailyReport();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// GET /report/today — get today's report
reportRouter.get("/today", async (_req, res) => {
  try {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const report = await db.dailyReport.findFirst({
      where: { reportDate: { gte: today } },
      orderBy: { createdAt: "desc" },
    });
    if (!report) {
      res.status(404).json({ error: "No report for today yet. Trigger POST /report/generate." });
      return;
    }
    res.json({
      ...report,
      report: JSON.parse(report.reportJson),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// GET /report/history — list recent reports
reportRouter.get("/history", async (req, res) => {
  try {
    const limit = parseInt(String(req.query.limit || "7"), 10);
    const reports = await db.dailyReport.findMany({
      orderBy: { reportDate: "desc" },
      take: limit,
      select: {
        id: true,
        reportDate: true,
        sectionsIncluded: true,
        sentViaEmail: true,
        createdAt: true,
      },
    });
    res.json({ reports, count: reports.length });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// GET /report/:date — get report for a specific date (YYYY-MM-DD)
reportRouter.get("/:date", async (req, res) => {
  try {
    const dateStr = req.params.date;
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD." });
      return;
    }
    date.setUTCHours(0, 0, 0, 0);
    const nextDay = new Date(date.getTime() + 24 * 60 * 60 * 1000);

    const report = await db.dailyReport.findFirst({
      where: { reportDate: { gte: date, lt: nextDay } },
    });
    if (!report) {
      res.status(404).json({ error: `No report found for ${dateStr}.` });
      return;
    }
    res.json({
      ...report,
      report: JSON.parse(report.reportJson),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
