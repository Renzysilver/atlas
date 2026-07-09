// ATLAS API — layers/injuryIntelligence.ts
// Layer 4 of 17 — Injury Intelligence (🟢 ACTIVE, deterministic)
//
// Per spec Section 3: "injury list × player importance weight"
// Uses the Injury table (Module 1 collector) to count absences per team.
// Since we don't have player importance weights yet (would need formation
// data to know who's a starter), we use a simplified model:
//   - Count absences per team in the 30 days before the match
//   - More absences = lower team strength contribution
//
// The API-Football /injuries endpoint provides fixture-level absence records
// (type="Missing Fixture", reason="Knee Injury" etc.). Each record = a player
// missed a specific fixture. We count how many absences each team had leading
// up to the match.

import { db } from "../lib/db.ts";
import type { LayerOutput } from "@atlas/shared";
import { BaseLayer, type LayerContext, type LayerDefinition } from "./base.ts";

const BASE_CONFIDENCE = 0.85;
const LOOKBACK_DAYS = 30;

export class InjuryIntelligenceLayer extends BaseLayer {
  readonly definition: LayerDefinition = {
    name: "injury_intelligence",
    layerNumber: 4,
    description: "Injury list × player importance weight",
    buildStatus: "active",
    feedsConsensus: true,
  };

  async compute(ctx: LayerContext): Promise<LayerOutput> {
    const match = await db.match.findUnique({ where: { id: ctx.matchId } });
    if (!match) {
      return this.insufficientOutput(this.definition.name, "Match not found");
    }

    const [homeTeam, awayTeam] = await Promise.all([
      db.team.findUnique({ where: { id: ctx.homeTeamId } }),
      db.team.findUnique({ where: { id: ctx.awayTeamId } }),
    ]);
    const homeName = homeTeam?.name || "Home";
    const awayName = awayTeam?.name || "Away";

    // Count absences in the LOOKBACK_DAYS before the match
    const matchDate = match.kickoffUtc;
    const lookbackStart = new Date(matchDate.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

    const [homeInjuries, awayInjuries] = await Promise.all([
      db.injury.count({
        where: {
          teamId: ctx.homeTeamId,
          startDate: { gte: lookbackStart, lte: matchDate },
        },
      }),
      db.injury.count({
        where: {
          teamId: ctx.awayTeamId,
          startDate: { gte: lookbackStart, lte: matchDate },
        },
      }),
    ]);

    if (homeInjuries === 0 && awayInjuries === 0) {
      return this.insufficientOutput(
        this.definition.name,
        `No injury/absence records for ${homeName} or ${awayName} in the ${LOOKBACK_DAYS} days before this match. ` +
          `This could mean (a) both squads are fully healthy, or (b) injury data hasn't been ingested for this period. ` +
          `Run the injuries collector if data is missing.`,
      );
    }

    // Score: team with fewer absences has advantage
    // Normalize: if home has fewer, score > 0.5; if away has fewer, score < 0.5
    // Typical range: 0-30 absences per team per 30 days
    const homeBurden = Math.min(1, homeInjuries / 30);
    const awayBurden = Math.min(1, awayInjuries / 30);
    const score = 0.5 + (awayBurden - homeBurden) * 0.4; // ±0.4 swing max

    // Confidence: higher when we have more data
    const totalAbsences = homeInjuries + awayInjuries;
    const coverageRatio = Math.min(1, totalAbsences / 20); // 20+ absences = full confidence
    const scaledConfidence = Math.max(0.5, BASE_CONFIDENCE * (0.7 + coverageRatio * 0.3));

    const interpretation = homeInjuries < awayInjuries
      ? `${homeName} has injury advantage`
      : homeInjuries > awayInjuries
        ? `${awayName} has injury advantage`
        : "Even injury burden";

    const reasoning = [
      `${interpretation} (score: ${score.toFixed(3)})`,
      `Features used:`,
      `  ${homeName} absences (last ${LOOKBACK_DAYS}d): ${homeInjuries}`,
      `  ${awayName} absences (last ${LOOKBACK_DAYS}d): ${awayInjuries}`,
      `Injury burden: ${homeName} ${homeBurden.toFixed(2)}, ${awayName} ${awayBurden.toFixed(2)}`,
      `Confidence: ${scaledConfidence.toFixed(3)} (base ${BASE_CONFIDENCE} × data volume adjustment)`,
      `Note: simplified model counts total absences; player-importance weighting requires formation data (Tactical Intelligence Layer 3, currently STUB)`,
    ].join("\n");

    return this.activeOutput(this.definition.name, score, scaledConfidence, reasoning);
  }
}
