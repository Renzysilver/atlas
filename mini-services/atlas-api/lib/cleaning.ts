// ATLAS API — lib/cleaning.ts
// Module 2 — Data Cleaning & Validation (spec Section 5)
//
// This module provides the cleaning primitives that every collector runs
// BEFORE writing to the DB. Per spec:
//   - Deduplication on fixture ID (handled via upsert in collectors)
//   - Missing value handling: explicit null, NEVER silently zero-fill a stat
//   - Name standardization (team/player name variants across seasons)
//   - Timestamp normalization to UTC
//   - Source confidence flag on every ingested record
//
// Iron rule (Constitution Rule 4 + Section 5): if a real value can't be
// obtained, the honest output is `null` — never `0`, never an empty string,
// never a fabricated placeholder.

// ============================================================
// HTML entity decoder
// ============================================================
// API-Football returns player/team names with HTML entities like
// "J. O&apos;Brien" instead of "J. O'Brien". This decodes them.

const HTML_ENTITY_MAP: Record<string, string> = {
  "&apos;": "'",
  "&quot;": '"',
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&#39;": "'",
  "&#34;": '"',
  "&#x27;": "'",
  "&#x22;": '"',
  "&nbsp;": " ",
  "&copy;": "©",
  "&reg;": "®",
  "&trade;": "™",
  "&mdash;": "—",
  "&ndash;": "–",
  "&hellip;": "…",
};

const HTML_ENTITY_REGEX = /&[a-zA-Z]+;|&#\d+;|&#x[0-9a-fA-F]+;/g;

export function decodeHtmlEntities(input: string | null | undefined): string | null {
  if (input == null) return null;
  return input.replace(HTML_ENTITY_REGEX, (match) => {
    if (HTML_ENTITY_MAP[match]) return HTML_ENTITY_MAP[match];
    // Numeric entity: &#39; or &#x27;
    const numericMatch = match.match(/^&#(\d+);$/);
    if (numericMatch) {
      return String.fromCharCode(parseInt(numericMatch[1], 10));
    }
    const hexMatch = match.match(/^&#x([0-9a-fA-F]+);$/);
    if (hexMatch) {
      return String.fromCharCode(parseInt(hexMatch[1], 16));
    }
    return match; // unknown entity, leave as-is
  });
}

// ============================================================
// Name normalizer
// ============================================================
// Standardizes team/player names:
//   - Decode HTML entities first
//   - Trim leading/trailing whitespace
//   - Collapse multiple internal spaces to single
//   - Normalize unicode whitespace (non-breaking space → regular space)
//
// Does NOT change case — API-Football returns proper case (e.g. "Manchester
// United", "Mohamed Salah") and we preserve it.

const UNICODE_WHITESPACE_REGEX = /[\u00A0\u2000-\u200A\u202F\u205F\u3000\uFEFF]/g;
const MULTIPLE_SPACE_REGEX = /\s+/g;

export function normalizeName(input: string | null | undefined): string | null {
  if (input == null) return null;
  let result = decodeHtmlEntities(input);
  if (result == null) return null;
  // Normalize unicode whitespace to regular space
  result = result.replace(UNICODE_WHITESPACE_REGEX, " ");
  // Collapse multiple spaces
  result = result.replace(MULTIPLE_SPACE_REGEX, " ");
  // Trim
  result = result.trim();
  return result.length > 0 ? result : null;
}

// ============================================================
// Timestamp normalization to UTC
// ============================================================
// API-Football returns ISO 8601 strings with timezone offset (usually +00:00
// for UTC, but some endpoints return local time). This ensures we always
// store a UTC-normalized Date object.
//
// Per spec Section 5: "Timestamp normalization to UTC"

export function normalizeTimestampToUtc(input: string | Date | null | undefined): Date | null {
  if (input == null) return null;
  if (input instanceof Date) {
    // Already a Date — convert to UTC if it has timezone info, otherwise
    // assume it's already UTC (JS Date objects are always UTC internally,
    // but the input might have been parsed as local time)
    return new Date(input.getTime());
  }
  // String input — parse and verify
  const parsed = new Date(input);
  if (isNaN(parsed.getTime())) {
    return null; // invalid timestamp — return null, NEVER fabricate
  }
  return parsed;
}

// ============================================================
// Stat value validator — null instead of zero-fill
// ============================================================
// Per spec Section 5: "Missing value handling (explicit null, never silently
// zero-fill a stat)"
//
// This helper takes a value that might be missing/undefined/null and returns
// either the real number or null. NEVER returns 0 for a missing value.
//
// Use case: `cleanSheets: validateStat(s.clean?.total)` — if the API omits
// the `clean` field (as it does on the free tier), this returns null, which
// Prisma writes as NULL to the DB. The schema field must be `Int?` (nullable)
// for this to work.

export function validateStat<T extends number>(
  value: T | null | undefined,
): T | null {
  if (value == null) return null;
  if (isNaN(value)) return null;
  return value;
}

// String stat validator — returns null for empty/missing strings
export function validateStringStat(
  value: string | null | undefined,
): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// ============================================================
// Source confidence validator
// ============================================================
// Per spec Section 5: "Source confidence flag on every ingested record"
// Every record written to the DB MUST have a sourceConfidence value in [0,1].
// This helper validates and defaults to a conservative 0.5 if somehow missing.

export function validateSourceConfidence(
  value: number | null | undefined,
  fallback: number = 0.5,
): number {
  if (value == null || isNaN(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

// ============================================================
// Batch cleaning utilities
// ============================================================

export interface CleaningResult {
  original: string | null;
  cleaned: string | null;
  changed: boolean;
}

export function cleanNameWithAudit(input: string | null | undefined): CleaningResult {
  const cleaned = normalizeName(input);
  return {
    original: input ?? null,
    cleaned,
    changed: input !== cleaned,
  };
}

// ============================================================
// Reconciliation helpers (used by the daily reconciliation job)
// ============================================================

export interface FieldValidationResult {
  field: string;
  value: unknown;
  issue: "missing" | "invalid" | "zero_filled" | "html_entity" | "ok";
  message?: string;
}

// Check a name field for HTML entities (post-cleaning audit)
export function auditNameForHtmlEntities(
  name: string | null | undefined,
): boolean {
  if (name == null) return false;
  return HTML_ENTITY_REGEX.test(name);
}

// Check if a numeric stat is suspiciously zero when it shouldn't be
// (used to detect pre-cleaning zero-fills)
export function auditStatForZeroFill(
  value: number | null,
  fieldName: string,
  isNormallyPositive: boolean = true,
): FieldValidationResult {
  if (value === null) {
    return { field: fieldName, value, issue: "ok", message: "explicit null (correct)" };
  }
  if (value === 0 && isNormallyPositive) {
    return {
      field: fieldName,
      value,
      issue: "zero_filled",
      message: `Field '${fieldName}' is 0 — may be a zero-fill from missing data. Should be null if data unavailable.`,
    };
  }
  return { field: fieldName, value, issue: "ok" };
}
