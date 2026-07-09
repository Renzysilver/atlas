// ATLAS — Uniform Layer Output Contract (Section 7)
//
// Every one of the 17 intelligence layers, regardless of build status,
// MUST implement this contract. BrainOS and the Consensus Engine treat
// all 17 layers identically — this is what lets Phase 2 activate a stub
// without touching orchestration code (Section 7, last paragraph).

export type LayerStatus = "active" | "insufficient_data" | "future";

export interface LayerOutput {
  /** Stable identifier matching Section 3 layer names exactly. */
  layer_name: string;
  /** active = real score computed; insufficient_data = stubbed honestly; future = architecturally reserved. */
  status: LayerStatus;
  /** Real number in [0,1] when active. ALWAYS null when status != active. */
  score: number | null;
  /** Confidence in the score, [0,1]. Always null when status != active. */
  confidence: number | null;
  /** Plain-language reason the score is what it is, OR why data is insufficient. */
  reasoning: string | null;
}

/**
 * Iron rule (Constitution Rule 4 + Section 0.1): if a layer cannot produce
 * a real, data-derived score, this is the ONLY acceptable output. Never
 * fabricate a number to "complete" the layer.
 */
export const INSUFFICIENT_DATA = (
  layerName: string,
  reason: string,
): LayerOutput => ({
  layer_name: layerName,
  status: "insufficient_data",
  score: null,
  confidence: null,
  reasoning: reason,
});

/**
 * Reserved-for-future output. Used for layers that require infrastructure
 * not available in Phase 1 (e.g. Live Match Intelligence needs a live feed
 * subscription). The layer interface exists; the implementation does not.
 */
export const FUTURE_LAYER = (layerName: string, reason: string): LayerOutput => ({
  layer_name: layerName,
  status: "future",
  score: null,
  confidence: null,
  reasoning: reason,
});
