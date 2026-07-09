// ATLAS API — jobs/scheduler.ts
// node-cron scheduled jobs for collector runs + (future) daily report.
// Per spec Section 2: daily report cron window is 5-6 AM.

import cron from "node-cron";
import { logger } from "../lib/logger.ts";
import { collectorRegistry } from "../collectors/registry.ts";

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

  // Daily report cron — per spec Section 2: 5-6 AM window.
  // For Module 1, this is registered but no-op (DailyReport generation is
  // Module 9). The schedule is reserved here so the cron slot is visible.
  const dailyReportCron = process.env.DAILY_REPORT_CRON || "0 5 * * *";
  if (cron.validate(dailyReportCron)) {
    const dailyTask = cron.schedule(dailyReportCron, async () => {
      logger.info("daily report cron triggered — no-op in Module 1 (Module 9 implements report generation)");
    });
    scheduledJobs.push(dailyTask);
    logger.info("daily report cron scheduled (no-op until Module 9)", {
      schedule: dailyReportCron,
    });
  }
}

export function stopScheduler(): void {
  for (const task of scheduledJobs) task.stop();
  scheduledJobs = [];
}
