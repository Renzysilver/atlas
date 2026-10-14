// ATLAS API — lib/email.ts
// Email delivery via Resend (drop-in: set RESEND_API_KEY to activate).
// Falls back gracefully when key is not set — logs but does not crash.
//
// Per ATLAS spec Section 13: daily report sent to admin email + subscribers.
// Subscriber tier determines which picks they receive:
//   - Free: 1 ultra-safe pick only
//   - Starter: all ultra-safe + 3 balanced picks
//   - Pro: all picks, all leagues, full breakdown
//   - VIP: all picks + early delivery (VIP job runs 30 min earlier)

import { logger } from "./logger.ts";
import { db } from "./db.ts";
import type { DailyReportData, MatchPick } from "../jobs/dailyReport.ts";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.ATLAS_FROM_EMAIL || "ATLAS Predictions <predictions@atlasbets.com>";
const ADMIN_EMAIL = process.env.ATLAS_ADMIN_EMAIL || "tinnybolt@gmail.com";

export interface EmailResult {
  sent: number;
  error?: string;
}

// ── Main send function ────────────────────────────────────────────────────────

export async function sendDailyReportEmail(
  report: DailyReportData
): Promise<EmailResult> {
  if (!RESEND_API_KEY) {
    logger.warn("email: RESEND_API_KEY not set — skipping email delivery. Set RESEND_API_KEY to activate.");
    return { sent: 0, error: "RESEND_API_KEY not configured" };
  }

  let sent = 0;

  // Always send to admin
  try {
    await sendEmail({
      to: ADMIN_EMAIL,
      subject: buildSubject(report, "admin"),
      html: buildAdminHtml(report),
    });
    sent++;
    logger.info("email: admin report sent", { to: ADMIN_EMAIL });
  } catch (err) {
    logger.error("email: admin send failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { sent: 0, error: err instanceof Error ? err.message : String(err) };
  }

  // Send to active subscribers — tiered content delivery
  try {
    const activeSubscriptions = await db.subscription.findMany({
      where: {
        status: "active",
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      include: {
        user: { select: { email: true, name: true, isActive: true } },
      },
    });

    // Group by tier for efficiency — build each HTML template once
    const tierHtmlCache: Record<string, string> = {};
    const tierSubjectCache: Record<string, string> = {};

    for (const sub of activeSubscriptions) {
      if (!sub.user?.isActive || !sub.user?.email) continue;

      const tier = sub.tier as "free" | "starter" | "pro" | "vip";
      if (!tierHtmlCache[tier]) {
        tierHtmlCache[tier] = buildSubscriberHtml(report, tier);
        tierSubjectCache[tier] = buildSubject(report, tier);
      }

      // Personalize name if available
      const html = sub.user.name
        ? buildSubscriberHtml(report, tier, sub.user.name)
        : tierHtmlCache[tier];

      try {
        await sendEmail({
          to: sub.user.email,
          subject: tierSubjectCache[tier],
          html,
        });
        sent++;
        logger.debug("email: subscriber sent", {
          tier,
          email: sub.user.email.replace(/(.{2}).*@/, "$1***@"),
        });
      } catch (subErr) {
        logger.warn("email: subscriber send failed", {
          tier,
          error: subErr instanceof Error ? subErr.message : String(subErr),
        });
      }
    }

    logger.info("email: subscriber batch complete", {
      total: activeSubscriptions.length,
      sent: sent - 1, // exclude admin send
    });
  } catch (dbErr) {
    logger.warn("email: subscriber query failed, only admin received report", {
      error: dbErr instanceof Error ? dbErr.message : String(dbErr),
    });
  }

  return { sent };
}

// ── Email builder for admin (full report) ────────────────────────────────────

function buildAdminHtml(report: DailyReportData): string {
  const date = new Date(report.reportDate).toLocaleDateString("en-NG", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const accuracyBadge = report.yesterdayAccuracy.available
    ? `<span style="background:#16a34a;color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;">
        Yesterday: ${Math.round((report.yesterdayAccuracy.overallAccuracy ?? 0) * 100)}% accuracy
        (${report.yesterdayAccuracy.correctPredictions}/${report.yesterdayAccuracy.totalPredictions})
       </span>`
    : `<span style="background:#6b7280;color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;">
        No accuracy data yet
       </span>`;

  const picksHtml = [
    buildPicksSection("🔒 Ultra Safe Picks", report.ultraSafePicks, "#15803d", "#f0fdf4"),
    buildPicksSection("⚖️ Balanced Picks", report.balancedPicks, "#b45309", "#fffbeb"),
    buildPicksSection("🔥 High Risk Picks", report.highRiskPicks, "#b91c1c", "#fef2f2"),
  ]
    .filter(Boolean)
    .join("");

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:'Helvetica Neue',Arial,sans-serif;background:#0f0f0f;color:#e5e7eb;margin:0;padding:20px;">
  <div style="max-width:600px;margin:0 auto;background:#1a1a1a;border-radius:12px;overflow:hidden;border:1px solid #2d2d2d;">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#1e3a5f,#0f2034);padding:24px 28px;">
      <div style="font-size:22px;font-weight:700;letter-spacing:2px;color:#60a5fa;">⚡ ATLAS</div>
      <div style="font-size:13px;color:#93c5fd;margin-top:4px;">Institutional Football Intelligence</div>
      <div style="margin-top:12px;font-size:14px;color:#cbd5e1;">${date}</div>
      <div style="margin-top:8px;">${accuracyBadge}</div>
    </div>

    <!-- Summary bar -->
    <div style="background:#111827;padding:16px 28px;display:flex;gap:20px;border-bottom:1px solid #1f2937;">
      <div style="text-align:center;">
        <div style="font-size:22px;font-weight:700;color:#60a5fa;">${report.totalMatchesToday}</div>
        <div style="font-size:11px;color:#6b7280;">MATCHES</div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:22px;font-weight:700;color:#34d399;">${report.ultraSafePicks.length}</div>
        <div style="font-size:11px;color:#6b7280;">ULTRA SAFE</div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:22px;font-weight:700;color:#fbbf24;">${report.balancedPicks.length}</div>
        <div style="font-size:11px;color:#6b7280;">BALANCED</div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:22px;font-weight:700;color:#f87171;">${report.highRiskPicks.length}</div>
        <div style="font-size:11px;color:#6b7280;">HIGH RISK</div>
      </div>
    </div>

    <!-- Picks -->
    <div style="padding:20px 28px;">
      ${picksHtml || `<p style="color:#6b7280;text-align:center;">No predictions available for today.</p>`}
    </div>

    <!-- Data source status -->
    <div style="padding:0 28px 24px;">
      <div style="font-size:11px;color:#4b5563;border-top:1px solid #1f2937;padding-top:16px;">
        <strong style="color:#6b7280;">DATA SOURCES:</strong>
        ${buildSourceBadge("API-Football", report.dataSourceStatus.apiFootball)}
        ${buildSourceBadge("Groq LLM", report.dataSourceStatus.groqLlm)}
        ${buildSourceBadge("Odds", report.dataSourceStatus.oddsData)}
        ${buildSourceBadge("Weather", report.dataSourceStatus.weatherData)}
        &nbsp;·&nbsp; Generated ${new Date(report.generatedAt).toLocaleTimeString("en-NG")}
      </div>
    </div>

  </div>
</body>
</html>`;
}

function buildPicksSection(
  title: string,
  picks: MatchPick[],
  accentColor: string,
  bgColor: string
): string {
  if (picks.length === 0) return "";

  const pickRows = picks
    .map(
      (p) => `
    <div style="background:#111827;border-left:3px solid ${accentColor};padding:12px 16px;margin-bottom:8px;border-radius:0 8px 8px 0;">
      <div style="font-weight:600;font-size:14px;color:#e5e7eb;">${p.homeTeam} vs ${p.awayTeam}</div>
      <div style="font-size:11px;color:#6b7280;margin-top:2px;">
        ${p.competition} · ${formatKickoff(p.kickoffUtc)}
      </div>
      <div style="margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <span style="background:${accentColor};color:#fff;padding:3px 10px;border-radius:4px;font-size:12px;font-weight:600;">
          ${formatMarket(p.market)}: ${p.selection}
        </span>
        <span style="color:#9ca3af;font-size:12px;">${Math.round(p.probability * 100)}% prob</span>
        <span style="color:#9ca3af;font-size:12px;">${Math.round(p.confidence * 100)}% conf</span>
      </div>
      ${p.explanation ? `<div style="font-size:12px;color:#9ca3af;margin-top:8px;font-style:italic;">${p.explanation}</div>` : ""}
    </div>`
    )
    .join("");

  return `
    <div style="margin-bottom:20px;">
      <div style="font-size:13px;font-weight:700;color:${accentColor};margin-bottom:10px;text-transform:uppercase;letter-spacing:1px;">${title}</div>
      ${pickRows}
    </div>`;
}

function buildSourceBadge(name: string, active: boolean): string {
  const color = active ? "#16a34a" : "#6b7280";
  const icon = active ? "●" : "○";
  return `<span style="color:${color};margin-left:8px;">${icon} ${name}</span>`;
}

// ── Subscriber email (tiered) ─────────────────────────────────────────────────

export function buildSubscriberHtml(
  report: DailyReportData,
  tier: "free" | "starter" | "pro" | "vip",
  subscriberName?: string
): string {
  // Filter picks based on tier
  let picksToShow: MatchPick[] = [];
  let tierLabel = "";

  switch (tier) {
    case "free":
      picksToShow = report.ultraSafePicks.slice(0, 1);
      tierLabel = "Free";
      break;
    case "starter":
      picksToShow = [
        ...report.ultraSafePicks,
        ...report.balancedPicks.slice(0, 3),
      ];
      tierLabel = "Starter";
      break;
    case "pro":
    case "vip":
      picksToShow = [
        ...report.ultraSafePicks,
        ...report.balancedPicks,
        ...report.highRiskPicks,
      ];
      tierLabel = tier === "vip" ? "VIP" : "Pro";
      break;
  }

  // Reuse admin HTML structure but with filtered picks
  const filteredReport = {
    ...report,
    ultraSafePicks: tier === "free"
      ? report.ultraSafePicks.slice(0, 1)
      : report.ultraSafePicks,
    balancedPicks: tier === "free" || tier === "starter"
      ? report.balancedPicks.slice(0, tier === "starter" ? 3 : 0)
      : report.balancedPicks,
    highRiskPicks: tier === "free" || tier === "starter"
      ? []
      : report.highRiskPicks,
  };

  return buildAdminHtml(filteredReport)
    .replace("⚡ ATLAS", `⚡ ATLAS ${tierLabel}`)
    .replace(
      "Institutional Football Intelligence",
      subscriberName
        ? `Good morning, ${subscriberName}`
        : "Your daily predictions"
    );
}

// ── Core send function ────────────────────────────────────────────────────────

async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: params.to,
      subject: params.subject,
      html: params.html,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend API error ${response.status}: ${body}`);
  }
}

// ── Formatters ────────────────────────────────────────────────────────────────

function buildSubject(report: DailyReportData, _role: string): string {
  const total =
    report.ultraSafePicks.length +
    report.balancedPicks.length +
    report.highRiskPicks.length;
  const date = new Date(report.reportDate).toLocaleDateString("en-NG", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return `⚡ ATLAS Daily Report — ${total} predictions for ${date}`;
}

function formatKickoff(kickoffUtc: string): string {
  return new Date(kickoffUtc).toLocaleTimeString("en-NG", {
    timeZone: "Africa/Lagos",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }) + " (Lagos)";
}

function formatMarket(market: string): string {
  switch (market) {
    case "1X2": return "1X2";
    case "O_U_2_5": return "O/U 2.5";
    case "BTTS": return "BTTS";
    default: return market;
  }
}
