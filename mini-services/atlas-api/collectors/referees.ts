// ATLAS API — collectors/referees.ts
// 🟡 STUB — API-Football referee history endpoint availability unconfirmed.
// Per spec Section 15: "If a real data source's availability is unclear
// (e.g. does the current API-Football plan include referee history?), flag
// it back to Vali/Claude rather than assuming."

import type { CollectorDefinition } from "@atlas/shared";
import { StubCollector } from "./base.ts";

const DEFINITION: CollectorDefinition = {
  name: "referees",
  description: "Referee historical tendency (cards per game, fouls awarded)",
  status: "stub",
  feedsLayer: "referee_intelligence",
  stubReason:
    "API-Football referee history endpoint availability unconfirmed on free tier. " +
    "Per spec Section 3 Layer 6 + Section 15: do NOT assume — flag for Vali to " +
    "confirm plan coverage. When confirmed available, this collector swaps to " +
    "a real implementation querying /referees or /fixtures with referee filter. " +
    "Module 4 Layer 6 (Referee Intelligence) returns insufficient_data until then.",
};

export class RefereesCollector extends StubCollector {
  constructor() {
    super(DEFINITION);
  }
}
