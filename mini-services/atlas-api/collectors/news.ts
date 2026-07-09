// ATLAS API — collectors/news.ts
// 🟡 STUB — No news/sentiment data source configured.
// Per spec Section 3 Layer 5: this is the ONE place an LLM could help
// (Psychology Intelligence), but only once News data is collected.
// Until then, insufficient_data — no LLM improvisation.

import type { CollectorDefinition } from "@atlas/shared";
import { StubCollector } from "./base.ts";

const DEFINITION: CollectorDefinition = {
  name: "news",
  description: "Press conferences, social sentiment, team news",
  status: "stub",
  feedsLayer: "psychology_intelligence",
  stubReason:
    "No news/sentiment data source configured. Module 4 Layer 5 (Psychology " +
    "Intelligence) returns insufficient_data. Per spec Section 3: even though " +
    "this is the one layer where an LLM could help with news reasoning, we " +
    "do NOT activate the LLM call until News collection is wired. An LLM " +
    "guessing a 'Mental Edge Score' from vibes is not intelligence — it's " +
    "noise with a confident tone.",
};

export class NewsCollector extends StubCollector {
  constructor() {
    super(DEFINITION);
  }
}
