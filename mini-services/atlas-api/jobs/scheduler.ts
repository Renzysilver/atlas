// ATLAS API — jobs/scheduler.ts
// node-cron scheduled jobs for collector runs + (future) daily report.
// Per spec Section 2: daily report cron window is 5-6 AM.

import cron from "node-cron";
import { logger } from "../lib/logger.ts";
import { collectorRegistry } from "../collectors/registry.ts";
import { runReconciliation } from "./reconciliation.ts";
import { runFeatureEngineering } from "./featureEngineering.ts";
import { runBrainOS } from "../brainos/orchestrator.ts";
import { runResultsComparison } from "./resultsComparison.ts";
import { runAccuracyMeasurement } from "./accuracyMeasurement.ts";
import { runDailyReport } from "./dailyReport.ts";
import { db } from "../lib/db.ts";

let scheduledJobs: cron.ScheduledTask[] = [];

export function startScheduler(): void {
  // Validate ATLAS_NEVER_FABRICATE flag is on (Constitution Rule 4)
  const neverFabricate = process.env.ATLAS_NEVER_FABRICATE !== "false";
  if (!neverFabricate) {
    logger.constitution("4", "ATLAS_NEVER_FABRICATE is set to false — this is forbidden in production. Predictions may fabricate data.");
  }

  // Schedule each active collector according to its definition.
  // Stub collectors have no schedule (they short-circuit immediately anyway).
  for (const def of collectorRegistry.list()) {
    if (def.status !== "active" || !def.schedule) continue;

    if (!cron.validate(def.schedule)) {
      logger.warn(`invalid cron schedule for collector`, {
        collector: def.name,
        schedule: def.schedule,
      });
      continue;
    }

    const task = cron.schedule(def.schedule, async () => {
      logger.info(`scheduled collector trigger`, {
        collector: def.name,
        schedule: def.schedule,
      });
      const collector = collectorRegistry.get(def.name);
      if (!collector) return;
      try {
        await collector.run();
      } catch (err) {
        logger.error(`scheduled collector failed`, {
          collector: def.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    scheduledJobs.push(task);
    logger.info(`scheduled collector`, {
      collector: def.name,
      schedule: def.schedule,
    });
  }

  // Module 9: Daily report — runs at 6:00 AM (after BrainOS at 5:30 AM)
  // Per spec Section 13: generate report + send to admin + subscribers.
  const dailyReportCron = process.env.DAILY_REPORT_CRON || "0 6 * * *";
  if (cron.validate(dailyReportCron)) {
    const dailyTask = cron.schedule(dailyReportCron, async () => {
      logger.info("daily report cron triggered", { schedule: dailyReportCron });
      try {
        const result = await runDailyReport();
        logger.info("daily report completed", {
          status: result.status,
          ultraSafe: result.report?.ultraSafePicks.length ?? 0,
          balanced: result.report?.balancedPicks.length ?? 0,
          emailsSent: result.emailsSent,
          durationMs: result.durationMs,
        });
      } catch (err) {
        logger.error("daily report failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
    scheduledJobs.push(dailyTask);
    logger.info("daily report cron scheduled (Module 9 ACTIVE)", {
      schedule: dailyReportCron,
    });
  }

  // Module 2: Daily reconciliation job — runs AFTER the daily collector cron
  // (4 AM collectors → 4:30 AM reconciliation) so it audits freshly-ingested data.
  // Per spec Section 5: dedup audit, missing value report, source confidence audit.
  const reconciliationCron = process.env.RECONCILIATION_CRON || "30 4 * * *";
  if (cron.validate(reconciliationCron)) {
    const reconciliationTask = cron.schedule(reconciliationCron, async () => {
      logger.info("daily reconciliation cron triggered", { schedule: reconciliationCron });
      try {
        const result = await runReconciliation();
        logger.info("daily reconciliation completed", {
          status: result.status,
          durationMs: result.durationMs,
          issues: result.sampleIssues.length,
          cleanSheetsDerived: result.cleanSheetsDerived,
        });
      } catch (err) {
        logger.error("daily reconciliation failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
    scheduledJobs.push(reconciliationTask);
    logger.info("daily reconciliation cron scheduled", {
      schedule: reconciliationCron,
    });
  }

  // Module 3: Daily feature engineering job — runs AFTER reconciliation
  // (4 AM collectors → 4:30 AM reconciliation → 5:00 AM features) so it
  // computes features from freshly-cleaned data.
  // Per spec Section 6: compute 10 active features + 3 stub features.
  const featureCron = process.env.FEATURE_ENGINEERING_CRON || "0 5 * * *";
  if (cron.validate(featureCron)) {
    const featureTask = cron.schedule(featureCron, async () => {
      logger.info("daily feature engineering cron triggered", { schedule: featureCron });
      try {
        const result = await runFeatureEngineering();
        logger.info("daily feature engineering completed", {
          status: result.status,
          durationMs: result.durationMs,
          teamsProcessed: result.teamsProcessed,
          matchesProcessed: result.matchesProcessed,
          seasonFeatures: result.seasonFeaturesComputed,
          matchFeatures: result.matchFeaturesComputed,
        });
      } catch (err) {
        logger.error("daily feature engineering failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
    scheduledJobs.push(featureTask);
    logger.info("daily feature engineering cron scheduled", {
      schedule: featureCron,
    });
  }

  // Module 4: Daily BrainOS prediction job — runs AFTER feature engineering
  // (4 AM collectors → 4:30 AM reconciliation → 5:00 AM features → 5:30 AM BrainOS)
  // Runs BrainOS for all upcoming matches in the next 7 days.
  const brainosCron = process.env.BRAINOS_CRON || "30 5 * * *";
  if (cron.validate(brainosCron)) {
    const brainosTask = cron.schedule(brainosCron, async () => {
      logger.info("daily brainos cron triggered", { schedule: brainosCron });
      try {
        const now = new Date();
        const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        const upcomingMatches = await db.match.findMany({
          where: {
            kickoffUtc: { gte: now, lte: sevenDaysLater },
            status: "scheduled",
          },
          select: { id: true },
        });
        logger.info("brainos cron: processing upcoming matches", {
          count: upcomingMatches.length,
        });
        let success = 0;
        let failed = 0;
        for (const match of upcomingMatches) {
          try {
            await runBrainOS(match.id);
            success++;
          } catch (err) {
            logger.error("brainos cron: match failed", {
              matchId: match.id,
              error: err instanceof Error ? err.message : String(err),
            });
            failed++;
          }
        }
        logger.info("daily brainos completed", { success, failed });
      } catch (err) {
        logger.error("daily brainos failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
    scheduledJobs.push(brainosTask);
    logger.info("daily brainos cron scheduled", { schedule: brainosCron });
  }

  // Module 8: Results comparison (6 AM daily)
  const resultsCron = process.env.RESULTS_COMPARISON_CRON || "0 6 * * *";
  if (cron.validate(resultsCron)) {
    scheduledJobs.push(cron.schedule(resultsCron, async () => {
      logger.info("results comparison cron triggered");
      try { await runResultsComparison(); } catch (err) { logger.error("results comparison failed", { error: err instanceof Error ? err.message : String(err) }); }
    }));
    logger.info("results comparison cron scheduled", { schedule: resultsCron });
  }

  // Module 8: Accuracy measurement (6:30 AM daily)
  const accuracyCron = process.env.ACCURACY_MEASUREMENT_CRON || "30 6 * * *";
  if (cron.validate(accuracyCron)) {
    scheduledJobs.push(cron.schedule(accuracyCron, async () => {
      logger.info("accuracy measurement cron triggered");
      try { await runAccuracyMeasurement("daily"); } catch (err) { logger.error("accuracy measurement failed", { error: err instanceof Error ? err.message : String(err) }); }
    }));
    logger.info("accuracy measurement cron scheduled", { schedule: accuracyCron });
  }

  // Module 8: Weekly report (7 AM Monday)
  const weeklyCron = process.env.WEEKLY_LEARNING_CRON || "0 7 * * 1";
  if (cron.validate(weeklyCron)) {
    scheduledJobs.push(cron.schedule(weeklyCron, async () => {
      logger.info("weekly learning report cron triggered");
      try { await runAccuracyMeasurement("weekly"); } catch (err) { logger.error("weekly report failed", { error: err instanceof Error ? err.message : String(err) }); }
    }));
    logger.info("weekly learning report cron scheduled", { schedule: weeklyCron });
  }
}

export function stopScheduler(): void {
  for (const task of scheduledJobs) task.stop();
  scheduledJobs = [];
}
