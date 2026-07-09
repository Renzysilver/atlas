// ATLAS API — collectors/stadium.ts
// 🟡 STUB — Stadium detail fields partially covered by teams table.
// Granular venue API (pitch dimensions, surface type, altitude) not yet wired.

import type { CollectorDefinition } from "@atlas/shared";
import { StubCollector } from "./base.ts";

const DEFINITION: CollectorDefinition = {
  name: "stadium",
  description: "Venue details (pitch dimensions, surface, capacity, altitude)",
  status: "stub",
  feedsLayer: "tactical_intelligence",
  stubReason:
    "Basic stadium name + capacity are already ingested via the teams table " +
    "(from /teams endpoint). Granular venue data (pitch dimensions, surface " +
    "type, altitude) not yet wired. Phase 2: enrich via dedicated venue API " +
    "or a one-time CSV import. Module 4 Layer 3 (Tactical Intelligence) " +
    "remains 🟡 until formation data is also confirmed.",
};

export class StadiumCollector extends StubCollector {
  constructor() {
    super(DEFINITION);
  }
}
