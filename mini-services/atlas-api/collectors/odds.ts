// ATLAS API — collectors/odds.ts
// 🟡 STUB — No ODDS_API_KEY configured.
// This is the HIGHEST-RISK stub in ATLAS per spec Section 11:
//   "Value Score is 🟡 STUB until odds data is active — do not fake a
//    'value bet' claim without real market odds to compare against;
//    that's the one output that could cause real financial harm if faked."

import type { CollectorDefinition } from "@atlas/shared";
import { StubCollector } from "./base.ts";

const DEFINITION: CollectorDefinition = {
  name: "odds",
  description: "Betting market odds (pre-match + closing lines)",
  status: "stub",
  feedsLayer: "market_intelligence",
  stubReason:
    "No ODDS_API_KEY configured. Module 4 Layer 8 (Market Intelligence) AND " +
    "Module 7 Value Score return insufficient_data. Per ATLAS Constitution " +
    "Rule 4 + Section 11 explicit warning: NEVER fabricate odds or value-bet " +
    "claims. High-Value recommendation tier is disabled until this collector " +
    "is activated.",
};

export class OddsCollector extends StubCollector {
  constructor() {
    super(DEFINITION);
  }
}
