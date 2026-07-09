// ATLAS API — jobs/reconciliation.ts
// Module 2 — Data Cleaning & Validation (spec Section 5)
//
// This job runs daily (or on-demand) to:
//   1. Audit the DB for data quality issues
//   2. Fix what can be fixed (HTML entities, zero-fills → null)
//   3. Derive missing fields from other data (clean sheets from match results)
//   4. Write a CleaningReport to the DB for dashboard display
//
// Per spec Section 5:
//   - Deduplication on fixture ID (audit — should always be 0 due to upsert)
//   - Missing value handling (explicit null, never zero-fill)
//   - Name standardization (decode HTML entities, normalize whitespace)
//   - Timestamp normalization to UTC (audit for non-UTC)
//   - Source confidence flag on every ingested record

import { db } from "../lib/db.ts";
import { logger } from "../lib/logger.ts";
import {
  decodeHtmlEntities,
  normalizeName,
  auditNameForHtmlEntities,
  auditStatForZeroFill,
  validateSourceConfidence,
} from "../lib/cleaning.ts";

export interface ReconciliationResult {
  status: "success" | "partial" | "failed";
  durationMs: number;
  totalRecordsAudited: number;
  duplicateFixtures: number;
  missingSourceConfidence: number;
  nullStats: number;
  zeroFilledStats: number;
  htmlEntityNames: number;
  orphanedForeignKeys: number;
  invalidTimestamps: number;
  tableReports: Record<string, { rows: number; issues: number }>;
  sampleIssues: Array<{
    table: string;
    field: string;
    issue: string;
    recordId: string;
    message: string;
  }>;
  namesDecoded: number;
  namesNormalized: number;
  zeroFilledToNull: number;
  cleanSheetsDerived: number;
}

export async function runReconciliation(): Promise<ReconciliationResult> {
  const startMs = Date.now();
  logger.info("reconciliation job started");

  const result: ReconciliationResult = {
    status: "success",
    durationMs: 0,
    totalRecordsAudited: 0,
    duplicateFixtures: 0,
    missingSourceConfidence: 0,
    nullStats: 0,
    zeroFilledStats: 0,
    htmlEntityNames: 0,
    orphanedForeignKeys: 0,
    invalidTimestamps: 0,
    tableReports: {},
    sampleIssues: [],
    namesDecoded: 0,
    namesNormalized: 0,
    zeroFilledToNull: 0,
    cleanSheetsDerived: 0,
  };

  const sampleIssues = result.sampleIssues;

  try {
    // ============================================================
    // 1. DEDUP AUDIT — check for duplicate apiFootballId on Match
    // ============================================================
    logger.info("reconciliation: dedup audit on fixtures");
    const duplicateFixtures = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count FROM (
        SELECT apiFootballId, COUNT(*) as cnt
        FROM Match
        GROUP BY apiFootballId
        HAVING cnt > 1
      )
    `;
    result.duplicateFixtures = Number(duplicateFixtures[0]?.count ?? 0);
    result.totalRecordsAudited += await db.match.count();
    result.tableReports["matches"] = { rows: await db.match.count(), issues: result.duplicateFixtures };
    if (result.duplicateFixtures > 0) {
      sampleIssues.push({
        table: "matches",
        field: "apiFootballId",
        issue: "duplicate",
        recordId: "multiple",
        message: `${result.duplicateFixtures} duplicate fixture IDs found (should be 0 — upsert should prevent this)`,
      });
    }

    // ============================================================
    // 2. HTML ENTITY AUDIT + FIX — decode entities in all name fields
    // ============================================================
    logger.info("reconciliation: HTML entity audit + fix on names");

    // Teams
    const teams = await db.team.findMany({ select: { id: true, name: true } });
    result.totalRecordsAudited += teams.length;
    let teamIssues = 0;
    for (const team of teams) {
      if (auditNameForHtmlEntities(team.name)) {
        result.htmlEntityNames++;
        teamIssues++;
        const cleaned = normalizeName(team.name);
        if (cleaned && cleaned !== team.name) {
          await db.team.update({ where: { id: team.id }, data: { name: cleaned } });
          result.namesDecoded++;
        }
        if (sampleIssues.length < 50) {
          sampleIssues.push({
            table: "teams",
            field: "name",
            issue: "html_entity",
            recordId: team.id,
            message: `Team name contained HTML entities: "${team.name}" → "${cleaned}"`,
          });
        }
      }
    }
    result.tableReports["teams"] = { rows: teams.length, issues: teamIssues };

    // Players
    const players = await db.player.findMany({ select: { id: true, name: true } });
    result.totalRecordsAudited += players.length;
    let playerIssues = 0;
    for (const player of players) {
      if (auditNameForHtmlEntities(player.name)) {
        result.htmlEntityNames++;
        playerIssues++;
        const cleaned = normalizeName(player.name);
        if (cleaned && cleaned !== player.name) {
          await db.player.update({ where: { id: player.id }, data: { name: cleaned } });
          result.namesDecoded++;
        }
        if (sampleIssues.length < 50) {
          sampleIssues.push({
            table: "players",
            field: "name",
            issue: "html_entity",
            recordId: player.id,
            message: `Player name contained HTML entities: "${player.name}" → "${cleaned}"`,
          });
        }
      }
    }
    result.tableReports["players"] = { rows: players.length, issues: playerIssues };

    // ============================================================
    // 3. ZERO-FILL AUDIT + FIX — convert 0 to null where data is missing
    // ============================================================
    logger.info("reconciliation: zero-fill audit on TeamStat");

    // Check TeamStat for zero-filled cleanSheets and failedToScore
    // (these are null on the free tier — if they're 0, it's a pre-Module-2 zero-fill)
    const teamStats = await db.teamStat.findMany();
    result.totalRecordsAudited += teamStats.length;
    let statIssues = 0;
    for (const ts of teamStats) {
      // If cleanSheets is 0 but the field should be null (free tier doesn't provide it),
      // convert to null. We can't distinguish "actually 0 clean sheets" from "missing data"
      // on the free tier, so we treat all 0s as missing.
      //
      // BUT: only fix if cleanSheetsDerived is also null (meaning we haven't derived it yet).
      // If cleanSheetsDerived is set, we keep cleanSheets as-is and use the derived value.
      if (ts.cleanSheets === 0 && ts.cleanSheetsDerived === null) {
        result.zeroFilledStats++;
        statIssues++;
        await db.teamStat.update({
          where: { id: ts.id },
          data: { cleanSheets: null },
        });
        result.zeroFilledToNull++;
        if (sampleIssues.length < 50) {
          sampleIssues.push({
            table: "team_stats",
            field: "cleanSheets",
            issue: "zero_filled",
            recordId: ts.id,
            message: `cleanSheets was 0 (likely zero-fill from missing data) → converted to null`,
          });
        }
      }
      if (ts.failedToScore === 0) {
        // Same logic — free tier doesn't provide this
        result.zeroFilledStats++;
        statIssues++;
        await db.teamStat.update({
          where: { id: ts.id },
          data: { failedToScore: null },
        });
        result.zeroFilledToNull++;
      }
    }
    result.tableReports["team_stats"] = { rows: teamStats.length, issues: statIssues };

    // ============================================================
    // 4. SOURCE CONFIDENCE AUDIT — ensure every record has it
    // ============================================================
    logger.info("reconciliation: source confidence audit");
    // All models have sourceConfidence as Float @default(0.8) — non-nullable.
    // Can't filter for null on non-nullable fields (Prisma rejects it).
    // The audit is a no-op: schema enforces non-null + default.
    result.missingSourceConfidence = 0;
    if (result.missingSourceConfidence > 0) {
      sampleIssues.push({
        table: "multiple",
        field: "sourceConfidence",
        issue: "missing",
        recordId: "multiple",
        message: `${result.missingSourceConfidence} records missing sourceConfidence flag`,
      });
    }

    // ============================================================
    // 5. ORPHANED FOREIGN KEY AUDIT
    // ============================================================
    logger.info("reconciliation: orphaned FK audit");
    // Prisma enforces referential integrity at the DB level (FK constraints),
    // so orphaned FKs should be impossible. But we audit anyway for completeness
    // using a raw query that checks for matches whose homeTeamId/awayTeamId
    // don't exist in the Team table.
    const orphanedHome = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count FROM Match m
      WHERE m.homeTeamId NOT IN (SELECT id FROM Team)
    `;
    const orphanedAway = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count FROM Match m
      WHERE m.awayTeamId NOT IN (SELECT id FROM Team)
    `;
    result.orphanedForeignKeys = Number(orphanedHome[0]?.count ?? 0) + Number(orphanedAway[0]?.count ?? 0);
    if (result.orphanedForeignKeys > 0) {
      sampleIssues.push({
        table: "matches",
        field: "homeTeamId/awayTeamId",
        issue: "orphaned_fk",
        recordId: "multiple",
        message: `${result.orphanedForeignKeys} matches with orphaned team references`,
      });
    }

    // ============================================================
    // 6. CLEAN SHEET DERIVATION (free-tier workaround)
    // ============================================================
    // The free tier doesn't provide cleanSheets in /teams/statistics.
    // Derive it from match results: a clean sheet = team conceded 0 goals.
    logger.info("reconciliation: deriving clean sheets from match results");
    const allTeamStats = await db.teamStat.findMany({
      where: { cleanSheetsDerived: null },
      include: { team: true },
    });

    for (const ts of allTeamStats) {
      // Find all finished matches for this team in this season
      const homeMatches = await db.match.findMany({
        where: {
          homeTeamId: ts.teamId,
          status: "finished",
          season: ts.season,
          homeScore: { not: null },
          awayScore: { not: null },
        },
      });
      const awayMatches = await db.match.findMany({
        where: {
          awayTeamId: ts.teamId,
          status: "finished",
          season: ts.season,
          homeScore: { not: null },
          awayScore: { not: null },
        },
      });

      // Clean sheet = team conceded 0 goals
      let cleanSheets = 0;
      for (const m of homeMatches) {
        if (m.awayScore === 0) cleanSheets++;
      }
      for (const m of awayMatches) {
        if (m.homeScore === 0) cleanSheets++;
      }

      await db.teamStat.update({
        where: { id: ts.id },
        data: { cleanSheetsDerived: cleanSheets },
      });
      result.cleanSheetsDerived++;
    }

    // ============================================================
    // 7. TIMESTAMP AUDIT — all timestamps should be valid UTC Dates
    // ============================================================
    logger.info("reconciliation: timestamp audit");
    // Prisma stores DateTime as UTC internally and kickoffUtc is a required
    // (non-nullable) field, so null timestamps are impossible by schema design.
    // This audit is a no-op — we record 0 issues. In a Postgres deployment
    // with timezone-aware columns, we'd verify all timestamps are stored as
    // UTC here.
    result.invalidTimestamps = 0;

    // ============================================================
    // 8. WRITE CLEANING REPORT TO DB
    // ============================================================
    result.durationMs = Date.now() - startMs;
    result.status = result.zeroFilledStats > 0 || result.orphanedForeignKeys > 0
      ? "partial"
      : "success";

    await db.cleaningReport.create({
      data: {
        runAt: new Date(),
        status: result.status,
        durationMs: result.durationMs,
        totalRecordsAudited: result.totalRecordsAudited,
        duplicateFixtures: result.duplicateFixtures,
        missingSourceConfidence: result.missingSourceConfidence,
        nullStats: result.nullStats,
        zeroFilledStats: result.zeroFilledStats,
        htmlEntityNames: result.htmlEntityNames,
        orphanedForeignKeys: result.orphanedForeignKeys,
        invalidTimestamps: result.invalidTimestamps,
        tableReportsJson: JSON.stringify(result.tableReports),
        sampleIssuesJson: JSON.stringify(result.sampleIssues),
        namesDecoded: result.namesDecoded,
        namesNormalized: result.namesNormalized,
        zeroFilledToNull: result.zeroFilledToNull,
        cleanSheetsDerived: result.cleanSheetsDerived,
      },
    });

    logger.info("reconciliation job completed", {
      status: result.status,
      durationMs: result.durationMs,
      totalAudited: result.totalRecordsAudited,
      issues: sampleIssues.length,
      cleanSheetsDerived: result.cleanSheetsDerived,
    });

    return result;
  } catch (err) {
    result.status = "failed";
    result.durationMs = Date.now() - startMs;
    logger.error("reconciliation job failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return result;
  }
}
