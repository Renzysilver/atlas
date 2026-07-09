// ATLAS API — layers/playerIntelligence.ts
// Layer 2 of 17 — Player Intelligence (🟢 ACTIVE, deterministic stats)
//
// Per spec Section 3: "per-player ratings aggregated to squad rating"
// Uses PlayerStat.rating (0-10 scale) averaged across squad.
//
// Note: On free tier, player_stats is only available for 3 of 20 teams
// (rotating ingestion strategy). For matches where neither team has
// player_stats, this layer returns insufficient_data honestly.

import { db } from "../lib/db.ts";
import type { LayerOutput } from "@atlas/shared";
import { BaseLayer, type LayerContext, type LayerDefinition } from "./base.ts";

const BASE_CONFIDENCE = 0.80;

export class PlayerIntelligenceLayer extends BaseLayer {
  readonly definition: LayerDefinition = {
    name: "player_intelligence",
    layerNumber: 2,
    description: "Per-player ratings aggregated to squad rating",
    buildStatus: "active",
    feedsConsensus: true,
  };

  async compute(ctx: LayerContext): Promise<LayerOutput> {
    const [homeTeam, awayTeam] = await Promise.all([
      db.team.findUnique({ where: { id: ctx.homeTeamId } }),
      db.team.findUnique({ where: { id: ctx.awayTeamId } }),
    ]);
    const homeName = homeTeam?.name || "Home";
    const awayName = awayTeam?.name || "Away";

    // Get player stats for both teams
    const [homePlayers, awayPlayers] = await Promise.all([
      db.playerStat.findMany({
        where: { player: { teamId: ctx.homeTeamId }, season: ctx.season },
        include: { player: true },
      }),
      db.playerStat.findMany({
        where: { player: { teamId: ctx.awayTeamId }, season: ctx.season },
        include: { player: true },
      }),
    ]);

    // Filter to players with a rating
    const homeRated = homePlayers.filter((p) => p.rating !== null);
    const awayRated = awayPlayers.filter((p) => p.rating !== null);

    if (homeRated.length === 0 || awayRated.length === 0) {
      const missingTeam = homeRated.length === 0 ? homeName : awayName;
      return this.insufficientOutput(
        this.definition.name,
        `No player ratings available for ${missingTeam}. Player stats are ingested on a rotating basis (3 teams per run). ` +
        `Run player_stats collector more times to cover all 20 teams. ` +
        `Home: ${homeRated.length} rated players, Away: ${awayRated.length} rated players.`,
      );
    }

    // Compute average squad rating (normalize 0-10 to 0-1)
    const homeAvgRating = homeRated.reduce((sum, p) => sum + (p.rating || 0), 0) / homeRated.length;
    const awayAvgRating = awayRated.reduce((sum, p) => sum + (p.rating || 0), 0) / awayRated.length;

    // Score: probability home team has better squad
    // Normalize difference: 0.5 + (home - away) × 0.1 (ratings diff typically 0-2)
    const ratingDiff = homeAvgRating - awayAvgRating;
    const score = Math.max(0.1, Math.min(0.9, 0.5 + ratingDiff * 0.1));

    // Confidence scales with how many players we have ratings for
    // Full squad = ~20+ players; if we only have 5, confidence is lower
    const homeCoverage = Math.min(1, homeRated.length / 20);
    const awayCoverage = Math.min(1, awayRated.length / 20);
    const avgCoverage = (homeCoverage + awayCoverage) / 2;
    const scaledConfidence = Math.max(0.3, BASE_CONFIDENCE * avgCoverage);

    const interpretation = score > 0.55
      ? `${homeName} has stronger squad`
      : score < 0.45
        ? `${awayName} has stronger squad`
        : "Even squads";

    const reasoning = [
      `${interpretation} (score: ${score.toFixed(3)})`,
      `Features used:`,
      `  ${homeName} avg squad rating: ${homeAvgRating.toFixed(2)} (from ${homeRated.length} players)`,
      `  ${awayName} avg squad rating: ${awayAvgRating.toFixed(2)} (from ${awayRated.length} players)`,
      `Rating differential: ${ratingDiff > 0 ? "+" : ""}${ratingDiff.toFixed(2)}`,
      `Confidence: ${scaledConfidence.toFixed(3)} (base ${BASE_CONFIDENCE} × coverage ${Math.round(avgCoverage * 100)}%)`,
      homeRated.length < 11 ? `Note: only ${homeRated.length} home players rated (full squad = ~20)` : undefined,
      awayRated.length < 11 ? `Note: only ${awayRated.length} away players rated (full squad = ~20)` : undefined,
    ].filter((n): n is string => n !== undefined).join("\n");

    return this.activeOutput(this.definition.name, score, scaledConfidence, reasoning);
  }
}
