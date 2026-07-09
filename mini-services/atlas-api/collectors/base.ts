// ATLAS API — collectors/base.ts
// Base collector class. Every collector (active OR stub) inherits from this.
//
// Per Section 17, every collector — regardless of build status — must:
//   1. Be discoverable in the collector registry
//   2. Have a stable interface (run() method returning CollectorRunResult)
//   3. Write a CollectorRun row to the DB for audit
//   4. For stub collectors: return status="insufficient_data" with a reason
//      and persist a LayerOutput row with status="insufficient_data"

import { db } from "../lib/db.ts";
import { logger } from "../lib/logger.ts";
import type { CollectorDefinition, CollectorRunResult, CollectorStatus } from "@atlas/shared";

export abstract class BaseCollector {
  abstract readonly definition: CollectorDefinition;

  /** Active collectors implement this with real data ingestion logic. */
  protected async ingest(): Promise<Omit<CollectorRunResult, "collectorName" | "startedAt" | "finishedAt" | "durationMs" | "status">> {
    throw new Error(`ingest() not implemented for active collector ${this.definition.name}`);
  }

  /**
   * Run the collector. For active collectors, calls ingest().
   * For stub collectors, returns insufficient_data without calling ingest().
   */
  async run(): Promise<CollectorRunResult> {
    const startedAt = new Date();
    const startMs = Date.now();

    const run = await db.collectorRun.create({
      data: {
        collectorName: this.definition.name,
        status: "running",
        startedAt,
      },
    });

    let result: CollectorRunResult;
    try {
      if (this.definition.status === "stub") {
        // Honesty path (Constitution Rule 4 + Section 0.1):
        // Stub collectors do NOT fetch or fabricate. They return insufficient_data
        // with the documented reason.
        result = {
          collectorName: this.definition.name,
          status: "insufficient_data",
          recordsIngested: 0,
          recordsUpdated: 0,
          recordsSkipped: 0,
          error: this.definition.stubReason || "Stub collector — no data source configured.",
          startedAt: startedAt.toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - startMs,
        };
      } else if (this.definition.status === "future") {
        result = {
          collectorName: this.definition.name,
          status: "insufficient_data",
          recordsIngested: 0,
          recordsUpdated: 0,
          recordsSkipped: 0,
          error: "Future-phase collector — not implemented in Phase 1.",
          startedAt: startedAt.toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - startMs,
        };
      } else {
        const ingestResult = await this.ingest();
        result = {
          collectorName: this.definition.name,
          status: "success",
          ...ingestResult,
          startedAt: startedAt.toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - startMs,
        };
      }

      await db.collectorRun.update({
        where: { id: run.id },
        data: {
          status: result.status,
          recordsIngested: result.recordsIngested,
          recordsUpdated: result.recordsUpdated,
          recordsSkipped: result.recordsSkipped,
          error: result.error,
          finishedAt: new Date(),
        },
      });

      logger.collector(this.definition.name, {
        status: result.status,
        ingested: result.recordsIngested,
        updated: result.recordsUpdated,
        skipped: result.recordsSkipped,
        durationMs: result.durationMs,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      // Per spec Section 0.1 + Constitution Rule 4: when an ACTIVE collector
      // cannot fetch real data due to EXPECTED conditions (API key missing,
      // quota exhausted, endpoint unavailable on plan), the honest status is
      // "insufficient_data" — NOT "failed". "failed" is reserved for unexpected
      // bugs (e.g. code errors, schema mismatches).
      const isExpectedCondition =
        errorMessage.includes("not set") ||
        errorMessage.includes("unconfigured") ||
        errorMessage.includes("quota") ||
        errorMessage.includes("exhausted") ||
        errorMessage.includes("unavailable") ||
        errorMessage.includes("403") ||
        errorMessage.includes("429");

      const status: CollectorRunResult["status"] = isExpectedCondition
        ? "insufficient_data"
        : "failed";

      result = {
        collectorName: this.definition.name,
        status,
        recordsIngested: 0,
        recordsUpdated: 0,
        recordsSkipped: 0,
        error: errorMessage,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startMs,
      };

      await db.collectorRun.update({
        where: { id: run.id },
        data: {
          status,
          error: errorMessage,
          finishedAt: new Date(),
        },
      });

      if (status === "failed") {
        logger.error(`collector ${this.definition.name} failed`, { error: errorMessage });
      } else {
        logger.warn(`collector ${this.definition.name} insufficient_data`, { error: errorMessage });
      }
    }

    return result;
  }
}

/**
 * Stub collector — minimal class for collectors that exist as schema/integration
 * points only. The interface is preserved so Phase 2 activation is a swap of
 * the class from StubCollector → real collector implementation.
 */
export class StubCollector extends BaseCollector {
  constructor(definition: CollectorDefinition) {
    super();
    this.definition = definition;
  }
  readonly definition: CollectorDefinition;
}
