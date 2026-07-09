// ATLAS — The 17 Intelligence Layers (Section 3)
//
// All 17 layers are PERMANENT (Constitution Rule 1). Status flags below are
// the Phase 1 build status from the spec, NOT the runtime status. Runtime
// status is on LayerOutput.status — and may flip from insufficient_data →
// active when a data source activates, without breaking BrainOS.

export type LayerName =
  | "team_intelligence"           // 1
  | "player_intelligence"         // 2
  | "tactical_intelligence"       // 3
  | "injury_intelligence"         // 4
  | "psychology_intelligence"     // 5
  | "referee_intelligence"        // 6
  | "weather_intelligence"        // 7
  | "market_intelligence"         // 8
  | "historical_intelligence"     // 9
  | "fatigue_intelligence"        // 10
  | "live_match_intelligence"     // 11
  | "simulation_intelligence"     // 12
  | "consensus_engine"            // 13
  | "explainability_ai"           // 14
  | "learning_intelligence"       // 15
  // --- Engine-level modules (not in the 15-AI list but treated as layers for orchestration)
  | "brainos_orchestration"
  | "prediction_decision_engine"
  | "risk_management_engine";

export const ALL_LAYER_NAMES: LayerName[] = [
  "team_intelligence",
  "player_intelligence",
  "tactical_intelligence",
  "injury_intelligence",
  "psychology_intelligence",
  "referee_intelligence",
  "weather_intelligence",
  "market_intelligence",
  "historical_intelligence",
  "fatigue_intelligence",
  "live_match_intelligence",
  "simulation_intelligence",
  "consensus_engine",
  "explainability_ai",
  "learning_intelligence",
  "brainos_orchestration",
  "prediction_decision_engine",
  "risk_management_engine",
];

export const SEVENTEEN_LAYERS = ALL_LAYER_NAMES.slice(0, 17) as LayerName[];

/**
 * Phase 1 build status per Section 3 of the spec.
 * These are static; runtime status lives on each LayerOutput row.
 */
export const LAYER_BUILD_STATUS: Record<LayerName, "active" | "stub" | "future"> = {
  team_intelligence: "active",
  player_intelligence: "active",
  tactical_intelligence: "stub",
  injury_intelligence: "active",
  psychology_intelligence: "stub",
  referee_intelligence: "stub",
  weather_intelligence: "stub",
  market_intelligence: "stub",
  historical_intelligence: "active",
  fatigue_intelligence: "active",
  live_match_intelligence: "future",
  simulation_intelligence: "active",
  consensus_engine: "active",
  explainability_ai: "active",
  learning_intelligence: "active",
  brainos_orchestration: "active",
  prediction_decision_engine: "active",
  risk_management_engine: "active",
};

/**
 * Phase 1 fixed consensus weights (Section 8 spec — adaptive weighting is 🔴 FUTURE).
 * Written as config, not hardcoded magic numbers (Section 8 spec).
 *
 * Layers with status=stub/future get weight 0 — they're excluded from consensus
 * math entirely (Section 8.2: "does NOT treat missing data as zero or average").
 */
export const LAYER_WEIGHTS: Record<LayerName, number> = {
  team_intelligence: 0.18,
  player_intelligence: 0.12,
  tactical_intelligence: 0.0,        // stub
  injury_intelligence: 0.10,
  psychology_intelligence: 0.0,      // stub
  referee_intelligence: 0.0,         // stub
  weather_intelligence: 0.0,         // stub
  market_intelligence: 0.0,          // stub
  historical_intelligence: 0.15,
  fatigue_intelligence: 0.08,
  live_match_intelligence: 0.0,      // future
  simulation_intelligence: 0.20,     // Monte Carlo is the core deliverable
  consensus_engine: 0.0,             // engine, not a contributing layer
  explainability_ai: 0.0,            // engine
  learning_intelligence: 0.0,        // engine — runs in parallel, not contributing
  brainos_orchestration: 0.0,
  prediction_decision_engine: 0.0,
  risk_management_engine: 0.0,
};
