// ATLAS API — collectors/weather.ts
// 🟡 STUB — No WEATHER_API_KEY configured.
// Interface preserved so Phase 2 activation swaps this class file for a
// real implementation; nothing else in the codebase changes.

import type { CollectorDefinition } from "@atlas/shared";
import { StubCollector } from "./base.ts";

const DEFINITION: CollectorDefinition = {
  name: "weather",
  description: "Match-day weather forecast at the venue",
  status: "stub",
  feedsLayer: "weather_intelligence",
  stubReason:
    "No WEATHER_API_KEY configured. Module 4 Layer 7 (Weather Intelligence) " +
    "returns insufficient_data. Per Constitution Rule 4: do not fabricate " +
    "weather conditions. When key is provided, this collector swaps to " +
    "StubCollector → WeatherCollector (real impl) with zero orchestration changes.",
};

export class WeatherCollector extends StubCollector {
  constructor() {
    super(DEFINITION);
  }
}
