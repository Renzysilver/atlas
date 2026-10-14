// ATLAS API — jobs/dailyReport.ts
// Module 9 — Daily Report Generation (spec Section 13)
//
// Runs at 5:30 AM daily (after BrainOS has processed upcoming matches).
// Generates a structured daily report, persists to DailyReport table,
// and queues email delivery to all active subscribers.
//
// Per Constitution Rule 4: never fabricate data. If a section has
// insufficient data, it is honest about it — it does not invent predictions.

import { db } from "../lib/db.ts";
import { logger } from "../lib/logger.ts";
import { sendDailyReportEmail } from "../lib/email.ts";

export interface DailyReportSection {
  title: string;
  content: string;
  available: boolean;
  reason?: string; // why unavailable
}

export interface DailyReportData {
  reportDate: string;
  generatedAt: string;
  // Summary
  totalMatchesToday: number;
  totalPredictionsGenerated: number;
  // Picks by confidence tier
  ultraSafePicks: MatchPick[];
  balancedPicks: MatchPick[];
  highRiskPicks: MatchPick[];
  // Learning summary (from Module 8)
  yesterdayAccuracy: {
    available: boolean;
    overallAccuracy: number | null;
    totalPredictions: number;
    correctPredictions: number;
    perMarket: Record<string, { total: number; correct: number; accuracy: number }>;
  };
  // System state
  activeLeagues: string[];
  dataSourceStatus: {
    apiFootball: boolean;
    groqLlm: boolean;
    oddsData: boolean;
    weatherData: boolean;
  };
}

export interface MatchPick {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  kickoffUtc: string;
  competition: string;
  market: string;
  selection: string;
  probability: number;
  confidence: number;
  riskScore: number | null;
  recommendationProfile: string | null;
  explanation: string | null;
  // Referee info (when available)
  refereeNote: string | null;
  // Injury impact (when available)
  injuryNote: string | null;
}

export interface DailyReportResult {
  status: "success" | "partial" | "failed" | "no_matches";
  reportDate: string;
  report: DailyReportData | null;
  emailsSent: number;
  emailErrors: string[];
  durationMs: number;
}

export async function runDailyReport(): Promise<DailyReportResult> {
  const startMs = Date.now();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const reportDateStr = today.toISOString().split("T")[0];

  logger.info("daily report: starting generation", { reportDate: reportDateStr });

  try {
    // ── 1. Fetch today's matches with predictions ────────────────────────────
    const todayMatches = await db.match.findMany({
      where: {
        kickoffUtc: { gte: today, lt: tomorrow },
        status: { in: ["scheduled", "live"] },
      },
      include: {
        homeTeam: { select: { name: true } },
        awayTeam: { select: { name: true } },
        predictions: {
          orderBy: { confidence: "desc" },
        },
      },
      orderBy: { kickoffUtc: "asc" },
    });

    if (todayMatches.length === 0) {
      logger.info("daily report: no matches today", { reportDate: reportDateStr });
      return {
        status: "no_matches",
        reportDate: reportDateStr,
        report: null,
        emailsSent: 0,
        emailErrors: [],
        durationMs: Date.now() - startMs,
      };
    }

    // ── 2. Build picks by confidence tier ────────────────────────────────────
    const ultraSafePicks: MatchPick[] = [];
    const balancedPicks: MatchPick[] = [];
    const highRiskPicks: MatchPick[] = [];

    for (const match of todayMatches) {
      if (!match.predictions || match.predictions.length === 0) continue;

      // Best prediction per match (highest confidence)
      const best = match.predictions[0];
      if (!best) continue;

      const pick: MatchPick = {
        matchId: match.id,
        homeTeam: match.homeTeam.name,
        awayTeam: match.awayTeam.name,
        kickoffUtc: match.kickoffUtc.toISOString(),
        competition: match.competition,
        market: best.marketType,
        selection: best.selection,
        probability: best.probability,
        confidence: best.confidence,
        riskScore: best.riskScore,
        recommendationProfile: best.recommendationProfile,
        explanation: best.explainabilityText
          ? extractPlainSummary(best.explainabilityText)
          : null,
        refereeNote: null, // activated when referee intelligence is live
        injuryNote: null,  // activated when injury intelligence has data
      };

      const profile = best.recommendationProfile;
      if (profile === "high_consensus" || (best.confidence >= 0.70 && (best.riskScore ?? 1) < 0.25)) {
        ultraSafePicks.push(pick);
      } else if (profile === "moderate_consensus" || best.confidence >= 0.55) {
        balancedPicks.push(pick);
      } else {
        highRiskPicks.push(pick);
      }
    }

    // ── 3. Yesterday's accuracy (Module 8 learning report) ───────────────────
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const learningReport = await db.learningReport.findFirst({
      where: {
        reportType: "daily",
        reportDate: { gte: yesterday, lt: today },
      },
      orderBy: { createdAt: "desc" },
    });

    const yesterdayAccuracy = learningReport
      ? {
          available: true,
          overallAccuracy: learningReport.overallAccuracy,
          totalPredictions: learningReport.totalPredictions,
          correctPredictions: learningReport.correctPredictions,
          perMarket: JSON.parse(learningReport.perMarketAccuracyJson || "{}"),
        }
      : {
          available: false,
          overallAccuracy: null,
          totalPredictions: 0,
          correctPredictions: 0,
          perMarket: {},
        };

    // ── 4. Active leagues ─────────────────────────────────────────────────────
    const activeLeagues = [
      ...new Set(todayMatches.map((m) => m.competition)),
    ].filter(Boolean);

    // ── 5. Data source status ─────────────────────────────────────────────────
    const quotas = await db.apiQuotaUsage.findMany({
      where: { service: { in: ["api-football", "groq", "odds", "weather"] } },
    });
    const quotaMap = Object.fromEntries(quotas.map((q) => [q.service, q]));

    const dataSourceStatus = {
      apiFootball: !!process.env.API_FOOTBALL_KEY,
      groqLlm: !!process.env.GROQ_API_KEY,
      oddsData: !!process.env.ODDS_API_KEY,
      weatherData: !!process.env.WEATHER_API_KEY,
    };

    // ── 6. Build report object ────────────────────────────────────────────────
    const report: DailyReportData = {
      reportDate: reportDateStr,
      generatedAt: new Date().toISOString(),
      totalMatchesToday: todayMatches.length,
      totalPredictionsGenerated:
        ultraSafePicks.length + balancedPicks.length + highRiskPicks.length,
      ultraSafePicks,
      balancedPicks,
      highRiskPicks,
      yesterdayAccuracy,
      activeLeagues,
      dataSourceStatus,
    };

    // ── 7. Persist to DailyReport table ──────────────────────────────────────
    await db.dailyReport.upsert({
      where: { reportDate: today },
      create: {
        reportDate: today,
        reportJson: JSON.stringify(report),
        sectionsIncluded: buildSectionsIncluded(report),
        learningSummaryJson: learningReport
          ? JSON.stringify({
              overallAccuracy: learningReport.overallAccuracy,
              totalPredictions: learningReport.totalPredictions,
            })
          : null,
        sentViaEmail: false,
      },
      update: {
        reportJson: JSON.stringify(report),
        sectionsIncluded: buildSectionsIncluded(report),
        learningSummaryJson: learningReport
          ? JSON.stringify({
              overallAccuracy: learningReport.overallAccuracy,
              totalPredictions: learningReport.totalPredictions,
            })
          : null,
      },
    });

    logger.info("daily report: persisted", {
      reportDate: reportDateStr,
      ultraSafe: ultraSafePicks.length,
      balanced: balancedPicks.length,
      highRisk: highRiskPicks.length,
    });

    // ── 8. Send emails to subscribers ────────────────────────────────────────
    let emailsSent = 0;
    const emailErrors: string[] = [];

    const emailResult = await sendDailyReportEmail(report);
    emailsSent = emailResult.sent;
    if (emailResult.error) emailErrors.push(emailResult.error);

    // Update sentViaEmail flag
    if (emailsSent > 0) {
      await db.dailyReport.update({
        where: { reportDate: today },
        data: {
          sentViaEmail: true,
          emailError: emailErrors.length > 0 ? emailErrors.join("; ") : null,
        },
      });
    }

    logger.info("daily report: complete", {
      reportDate: reportDateStr,
      emailsSent,
      durationMs: Date.now() - startMs,
    });

    return {
      status: "success",
      reportDate: reportDateStr,
      report,
      emailsSent,
      emailErrors,
      durationMs: Date.now() - startMs,
    };
  } catch (err) {
    logger.error("daily report: failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      status: "failed",
      reportDate: reportDateStr,
      report: null,
      emailsSent: 0,
      emailErrors: [err instanceof Error ? err.message : String(err)],
      durationMs: Date.now() - startMs,
    };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractPlainSummary(explainabilityText: string): string | null {
  // The explainability text is a JSON string from Module 6.
  // Try to extract plainLanguageSummary field.
  try {
    const parsed = JSON.parse(explainabilityText);
    return parsed.plainLanguageSummary || parsed.reasoning || null;
  } catch {
    // If it's plain text, return first 200 chars
    return explainabilityText.slice(0, 200);
  }
}

function buildSectionsIncluded(report: DailyReportData): string {
  const sections: string[] = ["header", "data_source_status"];
  if (report.ultraSafePicks.length > 0) sections.push("ultra_safe_picks");
  if (report.balancedPicks.length > 0) sections.push("balanced_picks");
  if (report.highRiskPicks.length > 0) sections.push("high_risk_picks");
  if (report.yesterdayAccuracy.available) sections.push("yesterday_accuracy");
  return sections.join(",");
}
