// ATLAS API — layers/registry.ts
// The single source of truth for all 17 intelligence layers.
//
// Per Constitution Rule 1: all 17 layers are PERMANENT. Even when stubbed
// or future, they exist here so BrainOS can discover and call them all.
// Per spec Section 7: every layer implements the same output contract.

import type { BaseLayer } from "./base.ts";
import { TeamIntelligenceLayer } from "./teamIntelligence.ts";
import { PlayerIntelligenceLayer } from "./playerIntelligence.ts";
import { InjuryIntelligenceLayer } from "./injuryIntelligence.ts";
import { HistoricalIntelligenceLayer } from "./historicalIntelligence.ts";
import { FatigueIntelligenceLayer } from "./fatigueIntelligence.ts";
import { SimulationIntelligenceLayer } from "./simulationIntelligence.ts";
import { ConsensusEngineLayer } from "./consensusEngine.ts";
import { ExplainabilityAiLayer } from "./explainabilityAi.ts";
import { LearningIntelligenceLayer } from "./learningIntelligence.ts";
import {
  tacticalIntelligenceLayer,
  psychologyIntelligenceLayer,
  refereeIntelligenceLayer,
  weatherIntelligenceLayer,
  marketIntelligenceLayer,
  liveMatchIntelligenceLayer,
} from "./stubLayers.ts";

// Instantiate all layers
const teamIntelligence = new TeamIntelligenceLayer();
const playerIntelligence = new PlayerIntelligenceLayer();
const injuryIntelligence = new InjuryIntelligenceLayer();
const historicalIntelligence = new HistoricalIntelligenceLayer();
const fatigueIntelligence = new FatigueIntelligenceLayer();
const simulationIntelligence = new SimulationIntelligenceLayer();
const consensusEngine = new ConsensusEngineLayer();
const explainabilityAi = new ExplainabilityAiLayer();
const learningIntelligence = new LearningIntelligenceLayer();

// All 17 layers in spec order (1-17)
export const ALL_LAYERS: BaseLayer[] = [
  teamIntelligence,           // 1
  playerIntelligence,         // 2
  tacticalIntelligenceLayer,  // 3 (stub)
  injuryIntelligence,         // 4
  psychologyIntelligenceLayer,// 5 (stub)
  refereeIntelligenceLayer,   // 6 (stub)
  weatherIntelligenceLayer,   // 7 (stub)
  marketIntelligenceLayer,    // 8 (stub)
  historicalIntelligence,     // 9
  fatigueIntelligence,        // 10
  liveMatchIntelligenceLayer, // 11 (future)
  simulationIntelligence,     // 12
  consensusEngine,            // 13
  explainabilityAi,           // 14
  learningIntelligence,       // 15
];

// Layer lookup by name
const LAYER_MAP = new Map(ALL_LAYERS.map((l) => [l.definition.name, l]));

export function getLayer(name: string): BaseLayer | null {
  return LAYER_MAP.get(name as any) ?? null;
}

// Consensus-feeding layers only (excludes engine-level: consensus, explainability, learning, live)
export const CONSENSUS_FEEDING_LAYERS: BaseLayer[] = ALL_LAYERS.filter(
  (l) => l.definition.feedsConsensus,
);

// Status summary for dashboard
export function getLayerStatusSummary() {
  return ALL_LAYERS.map((l) => ({
    name: l.definition.name,
    layerNumber: l.definition.layerNumber,
    description: l.definition.description,
    buildStatus: l.definition.buildStatus,
    feedsConsensus: l.definition.feedsConsensus,
    weight: l.weight,
  }));
}
