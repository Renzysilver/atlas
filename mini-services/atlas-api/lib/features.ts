// ATLAS API — lib/features.ts
// Module 3 — Feature Engineering (spec Section 6)
//
// This module computes the 10 ACTIVE features from real data, and defines
// the 3 STUB features with honest insufficient_data status.
//
// Per spec Section 6, features are inputs to the Module 4 intelligence layers.
// They are computed from:
//   - Standings (position, points, goal difference)
//   - TeamStat (goals for/against, form, cards)
//   - PlayerStat (minutes played, appearances)
//   - Match (results, dates for fatigue computation)
//   - Derived data from Module 2 (cleanSheetsDerived)
//
// Iron rule (Constitution Rule 4): if a feature can't be computed from real
// data, the status is "insufficient_data" with value=null. NEVER fabricate.

import { db } from "./db.ts";
import { logger } from "./logger.ts";
import { EPL_SEASON } from "@atlas/shared";

const SEASON = parseInt(process.env.API_FOOTBALL_SEASON || String(EPL_SEASON), 10);

// ============================================================
// Feature status helpers (mirror the LayerOutput contract from Section 7)
// ============================================================

export interface FeatureResult {
  value: number | null;
  confidence: number;
  status: "active" | "insufficient_data" | "stub";
  reason: string | null;
}

export function ACTIVE_FEATURE(value: number, confidence: number = 0.8): FeatureResult {
  return { value, confidence, status: "active", reason: null };
}

export function INSUFFICIENT_FEATURE(reason: string, confidence: number = 0.0): FeatureResult {
  return { value: null, confidence, status: "insufficient_data", reason };
}

export function STUB_FEATURE(reason: string): FeatureResult {
  return { value: null, confidence: 0.0, status: "stub", reason };
}

// ============================================================
// SEASON-LEVEL FEATURES (stored in TeamFeature)
// ============================================================

// 1. Team Strength — composite rating from standings position, points, goal difference
// Formula: normalize points (0-1) × 0.5 + normalize goal diff (0-1) × 0.3 +
//          inverse position (0-1) × 0.2
// Range: 0-1 (higher = stronger team)
export async function computeTeamStrength(teamId: string): Promise<FeatureResult> {
  const standing = await db.standing.findUnique({
    where: { season_teamId: { season: SEASON, teamId } },
  });
  if (!standing) {
    return INSUFFICIENT_FEATURE("No standings data for this team/season");
  }

  // Normalize points: max possible = 38 games × 3 points = 114
  const pointsScore = standing.points / 114;
  // Normalize goal difference: typical range -60 to +80
  const goalDiff = standing.goalsFor - standing.goalsAgainst;
  const goalDiffScore = Math.max(0, Math.min(1, (goalDiff + 60) / 140));
  // Inverse position: 1st = 1.0, 20th = 0.0
  const positionScore = Math.max(0, (21 - standing.position) / 20);

  const value = pointsScore * 0.5 + goalDiffScore * 0.3 + positionScore * 0.2;
  return ACTIVE_FEATURE(Math.round(value * 1000) / 1000, 0.9);
}

// 2. Attack Rating — goals per game, normalized to 0-1
// Formula: goalsFor / played, then normalize (typical range 0.5-3.0)
export async function computeAttackRating(teamId: string): Promise<FeatureResult> {
  const standing = await db.standing.findUnique({
    where: { season_teamId: { season: SEASON, teamId } },
  });
  if (!standing || standing.played === 0) {
    return INSUFFICIENT_FEATURE("No standings data or zero games played");
  }

  const goalsPerGame = standing.goalsFor / standing.played;
  // Normalize: 0 goals/game = 0, 3+ goals/game = 1.0
  const value = Math.min(1, goalsPerGame / 3);
  return ACTIVE_FEATURE(Math.round(value * 1000) / 1000, 0.85);
}

// 3. Defensive Stability — inverse of goals conceded per game + clean sheet bonus
// Formula: 1 - (goalsAgainst/played normalized) + cleanSheetRate × 0.2
// Range: 0-1 (higher = more stable defense)
export async function computeDefensiveStability(teamId: string): Promise<FeatureResult> {
  const standing = await db.standing.findUnique({
    where: { season_teamId: { season: SEASON, teamId } },
  });
  const teamStat = await db.teamStat.findUnique({
    where: { teamId_season: { teamId, season: SEASON } },
  });
  if (!standing || standing.played === 0) {
    return INSUFFICIENT_FEATURE("No standings data or zero games played");
  }

  const goalsConcededPerGame = standing.goalsAgainst / standing.played;
  // Normalize: 0 conceded = 1.0, 3+ conceded = 0.0
  const defensiveBase = Math.max(0, 1 - goalsConcededPerGame / 3);

  // Add clean sheet bonus if we have derived data
  let cleanSheetBonus = 0;
  if (teamStat?.cleanSheetsDerived !== null && teamStat?.cleanSheetsDerived !== undefined) {
    const cleanSheetRate = teamStat.cleanSheetsDerived / standing.played;
    cleanSheetBonus = cleanSheetRate * 0.2;
  }

  const value = Math.min(1, defensiveBase + cleanSheetBonus);
  return ACTIVE_FEATURE(Math.round(value * 1000) / 1000, 0.85);
}

// 4. Home Record Strength — home performance rating
// Formula: parse homeRecord "W-D-L", compute (3W + D) / (3 × games)
export async function computeHomeRecordStrength(teamId: string): Promise<FeatureResult> {
  const standing = await db.standing.findUnique({
    where: { season_teamId: { season: SEASON, teamId } },
  });
  if (!standing || !standing.homeRecord) {
    return INSUFFICIENT_FEATURE("No home record data");
  }

  // homeRecord format: "W-D-L" (e.g. "12-3-4")
  const parts = standing.homeRecord.split("-").map((n) => parseInt(n, 10));
  if (parts.length !== 3 || parts.some(isNaN)) {
    return INSUFFICIENT_FEATURE(`Invalid homeRecord format: ${standing.homeRecord}`);
  }

  const [wins, draws, losses] = parts;
  const totalGames = wins + draws + losses;
  if (totalGames === 0) {
    return INSUFFICIENT_FEATURE("Zero home games played");
  }

  const points = wins * 3 + draws;
  const maxPoints = totalGames * 3;
  const value = points / maxPoints;
  return ACTIVE_FEATURE(Math.round(value * 1000) / 1000, 0.85);
}

// 5. Away Record Strength — away performance rating (same formula as home)
export async function computeAwayRecordStrength(teamId: string): Promise<FeatureResult> {
  const standing = await db.standing.findUnique({
    where: { season_teamId: { season: SEASON, teamId } },
  });
  if (!standing || !standing.awayRecord) {
    return INSUFFICIENT_FEATURE("No away record data");
  }

  const parts = standing.awayRecord.split("-").map((n) => parseInt(n, 10));
  if (parts.length !== 3 || parts.some(isNaN)) {
    return INSUFFICIENT_FEATURE(`Invalid awayRecord format: ${standing.awayRecord}`);
  }

  const [wins, draws, losses] = parts;
  const totalGames = wins + draws + losses;
  if (totalGames === 0) {
    return INSUFFICIENT_FEATURE("Zero away games played");
  }

  const points = wins * 3 + draws;
  const maxPoints = totalGames * 3;
  const value = points / maxPoints;
  return ACTIVE_FEATURE(Math.round(value * 1000) / 1000, 0.85);
}

// 6. Possession Rating — from team_stats.possessionAvg
// Free tier doesn't provide this → insufficient_data
export async function computePossessionRating(teamId: string): Promise<FeatureResult> {
  const teamStat = await db.teamStat.findUnique({
    where: { teamId_season: { teamId, season: SEASON } },
  });
  if (!teamStat) {
    return INSUFFICIENT_FEATURE("No team_stats data");
  }

  // possessionAvg is null on the free tier (API doesn't provide it)
  if (teamStat.possessionAvg === null) {
    return INSUFFICIENT_FEATURE(
      "Possession data not available on free tier — team_stats.possessionAvg is null",
    );
  }

  // Normalize: 0-100 → 0-1
  const value = teamStat.possessionAvg / 100;
  return ACTIVE_FEATURE(Math.round(value * 1000) / 1000, 0.8);
}

// 7. Goal Threat — shots per game + shots on target per game
// Free tier may not provide shots data → insufficient_data
export async function computeGoalThreat(teamId: string): Promise<FeatureResult> {
  const teamStat = await db.teamStat.findUnique({
    where: { teamId_season: { teamId, season: SEASON } },
  });
  if (!teamStat) {
    return INSUFFICIENT_FEATURE("No team_stats data");
  }

  // shotsAvg and shotsOnTargetAvg are null on free tier
  if (teamStat.shotsAvg === null || teamStat.shotsOnTargetAvg === null) {
    return INSUFFICIENT_FEATURE(
      "Shots data not available on free tier — team_stats.shotsAvg/shotsOnTargetAvg are null",
    );
  }

  // Formula: shotsOnTarget per game × 0.6 + total shots per game × 0.4, normalized
  // Typical: 5-15 shots, 2-7 on target
  const value = Math.min(1, (teamStat.shotsOnTargetAvg * 0.6 + teamStat.shotsAvg * 0.4) / 15);
  return ACTIVE_FEATURE(Math.round(value * 1000) / 1000, 0.8);
}

// 8. Clean Sheet Rate — from Module 2 derived clean sheets
export async function computeCleanSheetRate(teamId: string): Promise<FeatureResult> {
  const standing = await db.standing.findUnique({
    where: { season_teamId: { season: SEASON, teamId } },
  });
  const teamStat = await db.teamStat.findUnique({
    where: { teamId_season: { teamId, season: SEASON } },
  });
  if (!standing || standing.played === 0) {
    return INSUFFICIENT_FEATURE("No standings data or zero games played");
  }

  // Use derived clean sheets (Module 2 workaround for free tier)
  if (teamStat?.cleanSheetsDerived === null || teamStat?.cleanSheetsDerived === undefined) {
    return INSUFFICIENT_FEATURE(
      "Clean sheets not yet derived — run Module 2 reconciliation job first",
    );
  }

  const value = teamStat.cleanSheetsDerived / standing.played;
  return ACTIVE_FEATURE(Math.round(value * 1000) / 1000, 0.85);
}

// 9. Squad Depth — from player_stats (total minutes played by squad)
// Formula: sum of minutes played / (38 games × 11 starters × 90 min) = utilization
// Higher utilization = more rotation = deeper squad
export async function computeSquadDepth(teamId: string): Promise<FeatureResult> {
  // Get all players for this team
  const players = await db.player.findMany({
    where: { teamId },
    include: {
      playerStats: { where: { season: SEASON } },
    },
  });

  if (players.length === 0) {
    return INSUFFICIENT_FEATURE("No player data for this team");
  }

  // Sum total minutes played across the squad
  let totalMinutes = 0;
  let playersWithMinutes = 0;
  for (const player of players) {
    const stat = player.playerStats[0];
    if (stat && stat.minutesPlayed > 0) {
      totalMinutes += stat.minutesPlayed;
      playersWithMinutes++;
    }
  }

  if (totalMinutes === 0) {
    return INSUFFICIENT_FEATURE("No player minutes data available");
  }

  // Theoretical max: 38 games × 11 starters × 90 min = 37,620 min
  // If a team uses only 14 players all season, utilization is lower
  // If a team rotates heavily (25+ players), utilization is higher
  // We measure "effective squad size" = total minutes / (38 × 90)
  // Then normalize: 11 players = 1.0 (no rotation), 25+ players = spread thin
  const effectiveStarters = totalMinutes / (38 * 90);
  // More players contributing = deeper squad
  // Normalize: 11-14 players = 0.3-0.5, 15-20 = 0.5-0.8, 20+ = 0.8-1.0
  const value = Math.min(1, Math.max(0, (playersWithMinutes - 11) / 14));
  return ACTIVE_FEATURE(
    Math.round(value * 1000) / 1000,
    0.75,
  );
}

// ============================================================
// MATCH-SPECIFIC FEATURES (stored in MatchFeature)
// ============================================================

// 10. Form Score — last-5 results before this match
// Formula: look at the 5 matches before this one for this team,
// compute (3W + D) / 15, range 0-1
export async function computeFormScore(
  matchId: string,
  teamId: string,
): Promise<FeatureResult> {
  const match = await db.match.findUnique({ where: { id: matchId } });
  if (!match) {
    return INSUFFICIENT_FEATURE("Match not found");
  }

  // Find the 5 matches this team played BEFORE this match
  const previousMatches = await db.match.findMany({
    where: {
      OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
      kickoffUtc: { lt: match.kickoffUtc },
      status: "finished",
      season: match.season,
    },
    orderBy: { kickoffUtc: "desc" },
    take: 5,
  });

  if (previousMatches.length === 0) {
    return INSUFFICIENT_FEATURE("No previous matches for this team (season start)");
  }

  let points = 0;
  for (const prevMatch of previousMatches) {
    const isHome = prevMatch.homeTeamId === teamId;
    const teamGoals = isHome ? prevMatch.homeScore : prevMatch.awayScore;
    const oppGoals = isHome ? prevMatch.awayScore : prevMatch.homeScore;
    if (teamGoals === null || oppGoals === null) continue;

    if (teamGoals > oppGoals) points += 3;
    else if (teamGoals === oppGoals) points += 1;
  }

  // Normalize: max possible = 5 wins × 3 = 15 points
  const value = points / 15;
  return ACTIVE_FEATURE(Math.round(value * 1000) / 1000, 0.8);
}

// 11. Fatigue — days rest since last match
// Formula: days between this match and the team's previous match
// Lower = more fatigued. Normalize: 0-7 days = 0-0.5, 7+ days = 0.5-1.0
export async function computeFatigue(
  matchId: string,
  teamId: string,
): Promise<FeatureResult> {
  const match = await db.match.findUnique({ where: { id: matchId } });
  if (!match) {
    return INSUFFICIENT_FEATURE("Match not found");
  }

  // Find the team's previous match
  const previousMatch = await db.match.findFirst({
    where: {
      OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
      kickoffUtc: { lt: match.kickoffUtc },
      status: "finished",
      season: match.season,
    },
    orderBy: { kickoffUtc: "desc" },
  });

  if (!previousMatch) {
    return INSUFFICIENT_FEATURE("No previous match (season start) — cannot compute rest days");
  }

  const restDays = Math.floor(
    (match.kickoffUtc.getTime() - previousMatch.kickoffUtc.getTime()) / (1000 * 60 * 60 * 24),
  );

  // Normalize: 0-3 days rest = 0-0.3 (fatigued), 4-7 days = 0.3-0.7 (normal),
  // 7+ days = 0.7-1.0 (well-rested)
  let value: number;
  if (restDays <= 3) {
    value = restDays / 10; // 0-0.3
  } else if (restDays <= 7) {
    value = 0.3 + ((restDays - 3) / 4) * 0.4; // 0.3-0.7
  } else {
    value = Math.min(1, 0.7 + ((restDays - 7) / 14) * 0.3); // 0.7-1.0
  }

  return ACTIVE_FEATURE(Math.round(value * 1000) / 1000, 0.9);
}

// ============================================================
// STUB FEATURES (3) — interface only, needs data not yet active
// ============================================================

export function computeTacticalFlexibility(): FeatureResult {
  return STUB_FEATURE(
    "Needs formation data from API-Football. Tactical Intelligence layer (Module 4 Layer 3) " +
      "is also stubbed for the same reason. Activate when formation data source is confirmed.",
  );
}

export function computeMomentumScore(): FeatureResult {
  return STUB_FEATURE(
    "Needs live/in-match data to compute real-time momentum. Spec Section 6 marks this as " +
      "STUB — needs live data feed. Phase 2 activation when live data subscription is available.",
  );
}

export function computeSetPieceRating(): FeatureResult {
  return STUB_FEATURE(
    "Needs granular event data (corner kicks, free kicks, penalties). API-Football free tier " +
      "does not include event-level data. Activate when event data source is confirmed.",
  );
}

// ============================================================
// Feature registry — all 13 features (10 active + 3 stub)
// ============================================================

export interface FeatureDefinition {
  name: string;
  description: string;
  status: "active" | "stub";
  level: "season" | "match";
  compute: (teamId: string, matchId?: string) => Promise<FeatureResult>;
}

export const FEATURE_REGISTRY: FeatureDefinition[] = [
  {
    name: "team_strength",
    description: "Composite rating from standings position, points, goal difference",
    status: "active",
    level: "season",
    compute: (teamId) => computeTeamStrength(teamId),
  },
  {
    name: "attack_rating",
    description: "Goals per game, normalized to 0-1",
    status: "active",
    level: "season",
    compute: (teamId) => computeAttackRating(teamId),
  },
  {
    name: "defensive_stability",
    description: "Inverse of goals conceded per game + clean sheet bonus",
    status: "active",
    level: "season",
    compute: (teamId) => computeDefensiveStability(teamId),
  },
  {
    name: "form_score",
    description: "Last-5 results before this match (match-specific)",
    status: "active",
    level: "match",
    compute: (teamId, matchId) => computeFormScore(matchId!, teamId),
  },
  {
    name: "home_record_strength",
    description: "Home performance rating from home record W-D-L",
    status: "active",
    level: "season",
    compute: (teamId) => computeHomeRecordStrength(teamId),
  },
  {
    name: "away_record_strength",
    description: "Away performance rating from away record W-D-L",
    status: "active",
    level: "season",
    compute: (teamId) => computeAwayRecordStrength(teamId),
  },
  {
    name: "possession_rating",
    description: "Average possession from team_stats (null on free tier → insufficient_data)",
    status: "active",
    level: "season",
    compute: (teamId) => computePossessionRating(teamId),
  },
  {
    name: "goal_threat",
    description: "Shots per game + shots on target (null on free tier → insufficient_data)",
    status: "active",
    level: "season",
    compute: (teamId) => computeGoalThreat(teamId),
  },
  {
    name: "clean_sheet_rate",
    description: "Derived clean sheets / games played (Module 2 derivation)",
    status: "active",
    level: "season",
    compute: (teamId) => computeCleanSheetRate(teamId),
  },
  {
    name: "squad_depth",
    description: "Squad rotation depth from player_stats minutes played",
    status: "active",
    level: "season",
    compute: (teamId) => computeSquadDepth(teamId),
  },
  {
    name: "fatigue",
    description: "Days rest since last match (match-specific)",
    status: "active",
    level: "match",
    compute: (teamId, matchId) => computeFatigue(matchId!, teamId),
  },
  {
    name: "tactical_flexibility",
    description: "Formation flexibility (STUB — needs formation data)",
    status: "stub",
    level: "season",
    compute: () => Promise.resolve(computeTacticalFlexibility()),
  },
  {
    name: "momentum_score",
    description: "In-match momentum (STUB — needs live data)",
    status: "stub",
    level: "match",
    compute: () => Promise.resolve(computeMomentumScore()),
  },
  {
    name: "set_piece_rating",
    description: "Set piece effectiveness (STUB — needs event data)",
    status: "stub",
    level: "season",
    compute: () => Promise.resolve(computeSetPieceRating()),
  },
];

export const ALL_FEATURE_NAMES = FEATURE_REGISTRY.map((f) => f.name);
export const ACTIVE_FEATURES = FEATURE_REGISTRY.filter((f) => f.status === "active");
export const STUB_FEATURES = FEATURE_REGISTRY.filter((f) => f.status === "stub");
