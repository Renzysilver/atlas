# ATLAS — Shared Worklog

This is the single shared work log for all ATLAS agents. Per the system prompt
rules, every agent (main + subagents) appends a new section here after finishing
their assigned Task ID. Do NOT overwrite previous sections.

---
Task ID: 0.5 (Permanent Git Process — established by Vali directive)
Agent: Zai (main, GLM)
Task: Establish permanent GitHub process per Vali's directive:
  1. Create GitHub repo named `atlas` (if it doesn't exist)
  2. Commit + push Module 1 work before sign-off
  3. From this point forward: every module handoff includes a push — no module
     is "done" until it's pushed (in addition to Section 17 Rule 1 handoff)

Work Log:
- Audited git state: sandbox had auto-committed 118 files including .env
  (placeholder API keys — still bad practice) and db/custom.db (SQLite runtime
  data, not source).
- Updated .gitignore to explicitly exclude:
  - .env / .env.* (kept .env.example as the committed template)
  - /db/*.db, /db/*.db-journal (SQLite runtime)
  - /upload/ (user-provided PDFs, not source)
  - /.zscripts/ (sandbox dev automation, environment-specific)
  - /.bun/ (cache)
  - /.venv/, /__pycache__/ (Python venv for future simulation service)
- Untracked (kept local): .env, db/custom.db, upload/, .zscripts/
- Verified final tracked file count: 108 files — clean source set, no secrets,
  no runtime data, no environment-specific tooling.
- Updated worklog.md to record this permanent process.
- Module 1 commit message follows conventional-commit format and references
  the ATLAS spec sections implemented.

Stage Summary:
- Permanent process established: every module handoff = commit + push, then report.
- This is additive to Section 17 Rule 1 (one module + stop + report). The push
  happens BEFORE the report, not after.
- Module 1 PUSHED to https://github.com/Renzysilver/atlas (private repo).
- Commit: 336fba9 "feat(module-1): Data Collection — Phase 1 foundation"
- Author: Vali (Renzysilver) <Renzysilver@users.noreply.github.com> (using
  GitHub noreply email format to keep Vali's real email private)
- 108 source files tracked. Zero secrets, zero runtime data, zero
  environment-specific tooling committed.
- PAT handling: used inline only for `git push` URL, NEVER persisted to
  .git/config. Scrubbed from shell environment after push. Security scan
  confirmed no file (tracked or untracked) contains the PAT.
- For future module pushes: Vali can either provide a fresh PAT each time,
  or configure a git credential helper (`gh auth setup-git` via GitHub CLI
  is the cleanest option). I will re-request the PAT at each module handoff
  unless Vali configures persistent credentials.

== Verified Post-Push ==
- Local HEAD: 336fba9
- Remote main: 336fba9 (matches)
- Remote file count: 108 (matches local)
- Remote /contents/.env → HTTP 404 (correctly excluded)
- .git/config contains no PAT
- No tracked file contains the PAT string

---
Task ID: 0 (Foundation + Module 1)
Agent: Zai (main, GLM)
Task: Set up ATLAS monorepo foundation + build Module 1 (Data Collection) per
ATLAS Master Build Prompt v1.0 Section 4. Stop and report back per Section 17
Rule 1 (one module at a time, then stop).

Work Log:
- Extracted spec from /home/z/my-project/upload/atlas-master-prompt-v1.pdf (21 pages, 17832 chars)
- Loaded pdf skill (for spec extraction) + fullstack-dev skill (for Next.js scaffold)
- Flagged 2 architectural contradictions per Section 17 Rule 2:
  (a) Sandbox is Next.js-only / SQLite-only / single-port — conflicts with ATLAS
      Section 2 (Node/Express + Postgres + Redis + Python FastAPI sidecar).
      Resolved via Path A: SQLite + ioredis-mock + Node/Express as mini-service
      on port 4001 + Next.js dashboard on port 3000 (via Caddy XTransformPort).
      Code is production-ready: swap to Postgres + Redis is one .env edit +
      one line in prisma/schema.prisma. User explicitly confirmed Path A with
      two critical clarifications: (1) "mock" only means queue substitute —
      NO data fabrication, Constitution Rule 4 applies fully; (2) sandbox
      SQLite is dev-only — user's local Docker Compose must use real Postgres
      + Redis per spec.
  (b) API-Football free tier (100 req/day) — designed collectors with aggressive
      caching (24h for teams/players, 6h for fixtures, 10min for lineups) +
      rotating team-fetch strategy (10 teams/run for team_stats, 3/run for
      player_stats) + DB-backed quota counter that survives process restarts.
      If endpoint returns 403 (free-tier gate), mark unavailable in
      ApiQuotaUsage table; collector then short-circuits to insufficient_data.
- Created monorepo structure:
  /prisma/schema.prisma — full Section 14 schema (14 models + 2 operational)
  /packages/shared/src/{contract,layers,types,index}.ts — uniform LayerOutput
    contract + 17 layer names + Phase 1 build status map + LAYER_WEIGHTS
  /mini-services/atlas-api/ — Node/Express + TypeScript
    /lib/{db,logger,queue,apiFootball}.ts — environment-agnostic foundation
    /collectors/{base,registry,fixtures,standings,teamStats,playerStats,
                 lineups,injuries,h2h,weather,odds,news,referees,stadium}.ts
    /routes/{health,collectors,stats}.ts
    /jobs/scheduler.ts
    /index.ts — Express entry on port 4001
  /infra/{docker-compose.yml,.env.example,README.md} — real Postgres + Redis
    for user's local deployment (sandbox swap path documented)
- Generated Prisma client + pushed schema to SQLite (db/custom.db)
- Started atlas-api on port 4001 in background — verified /health, /collectors,
  /stats all responding. Scheduler loaded 7 active collector cron jobs.
- Built Next.js dashboard (src/app/page.tsx) — single-route per sandbox
  constraint. Shows: service health, API-Football quota progress, build status
  (Module 1 of 9), 12-collector grid with status pills + trigger buttons,
  DB table row counts, recent collector run audit trail, ATLAS Constitution
  reference. Auto-refreshes every 15s via fetch with XTransformPort=4001.
- Updated layout.tsx metadata + added SonnerToaster for toast notifications.

Stage Summary:
- ✅ Foundation complete: monorepo, Prisma schema, env abstraction, scheduler
- ✅ Module 1 collectors: 7 ACTIVE (fixtures, team_stats, player_stats, lineups,
  injuries, standings, head_to_head) + 5 STUB (weather, odds, news, referees,
  stadium) — all 12 discoverable in collectorRegistry, all write CollectorRun
  audit rows, stubs return insufficient_data honestly per Constitution Rule 4
- ✅ Dashboard live at / (port 3000), API live at /health (port 4001)
- 🟡 API_FOOTBALL_KEY not yet configured by user — collectors will return
  "unconfigured" until key is provided in .env. Per Constitution Rule 4: no
  fabricated data. Once key is set, `POST /collectors/run-all-active` will
  ingest real EPL data immediately.
- 🟡 GROQ_API_KEY not yet configured — needed for Module 6 (Explainability AI).
  Module 1 does NOT need Groq. Defer until Module 6.
- 🟡 Injuries endpoint may 403 on free tier — codepath handles this cleanly
  (mark unavailable in ApiQuotaUsage, short-circuit to insufficient_data on
  next run). Flagged per spec Section 15.
- 🟡 Referees endpoint availability unconfirmed on free tier — same codepath.
  Flagged per spec Section 15: "do not assume — ask Vali to confirm".

Deviations from spec (all flagged + approved):
1. SQLite instead of Postgres in sandbox (Path A) — user approved
2. ioredis-mock instead of BullMQ+Redis in sandbox (Path A) — user approved
3. Both deviations are ENVIRONMENT-SPECIFIC. Code is production-ready; swap
   is documented in infra/README.md. NO data/contract/schema deviations.

Verification (Agent Browser end-to-end check via Caddy :81):
- Dashboard at http://localhost:81/ renders with full ATLAS header
- Service Health card: OK + DB ok + Queue ok + API-Football unconfigured + Groq unconfigured
- API-Football Quota card: 0/100 with progress bar
- Build Status card: Module 1 of 9
- Collector grid: all 12 collectors visible (7 ACTIVE + 5 STUB) with status pills,
  feeds layer, cron schedule, and trigger buttons
- All 5 STUB collectors show "insufficient_data reason" in amber callouts
- Database Tables card: 14 tables listed, collector_runs has 4 rows from test triggers
- Recent Collector Runs card: audit trail visible with timestamps + duration + error
- Constitution card: all 7 rules visible at bottom
- Footer renders with production swap note

Interaction tests:
- Trigger weather (STUB) → returns insufficient_data with documented reason ✓
- Trigger odds (STUB) → returns insufficient_data with documented reason ✓
- Trigger fixtures (ACTIVE, no API key) → returns insufficient_data (NOT failed,
  after my BaseCollector fix to distinguish expected conditions from bugs) ✓
- All triggers create CollectorRun audit rows in the database ✓

Lint: clean (1 minor warning about unused eslint-disable in atlas-api/lib/db.ts,
which is a non-Next.js file and doesn't affect the dashboard)

What's needed to proceed to Module 2 (Cleaning & Validation):
- User confirmation that Module 1 is acceptable per Section 17 Rule 1
- API_FOOTBALL_KEY set in .env (so we can verify Module 1 ingests real data
  before Module 2 builds cleaning rules on top of it)
- Confirmation on referee/injury endpoint availability on the free tier
  (run `POST /collectors/run/injuries` and `/referees` once key is set —
  the apiFootball module will auto-detect 403 and mark unavailable)

Next module (per Section 17 build order):
- Module 2 — Data Cleaning & Validation (spec Section 5):
  Deduplication on fixture ID, missing value handling (explicit null, never
  zero-fill), name standardization, UTC normalization, source confidence
  flag enforcement. Will be implemented as a pre-write cleaning pass inside
  each collector's ingest() method, plus a daily reconciliation job.

---
Task ID: 1 (Module 1 — Live API Ingestion + Free-Tier Constraint Discovery)
Agent: Zai (main, GLM)
Task: With Vali's API-Football key configured, run all active collectors
against real EPL data and verify the pipeline works end-to-end. Separately
trigger injuries and referees to confirm free-tier endpoint availability.

Work Log:
- Vali provided API-Football key. Updated .env (gitignored, never committed).
- Fixed env-loading bug: atlas-api/package.json needed --env-file=../../.env
  because Bun loads .env from cwd only (atlas-api runs from mini-services/
  atlas-api/ but .env is at project root).
- Flagged Section 17 Rule 2 contradiction: API-Football free tier blocks
  season=2025 (spec default). Only 2022-2024 available. Vali approved
  using season=2024 for development. Updated .env + EPL_SEASON constant.
- Flagged Section 17 Rule 2 contradiction: free tier blocks `last` and
  `next` parameters on /fixtures endpoint. head_to_head collector uses
  `last=20` — needs switch to date-range query. Deferred to Module 2 fix
  (collector currently returns 0 records for historical season since no
  upcoming fixtures exist).
- First ingestion run revealed 3 bugs:
  (a) Fixtures: API returns venue as object {id,name,city}, collector passed
      it directly to String? field. Fixed: venue?.name || null.
  (b) team_stats + player_stats: used `matches: { some: ... }` on Team model,
      but Team has homeMatches/awayMatches, not matches. Fixed: OR filter.
  (c) Injuries: API response structure completely different from assumed —
      type/reason are inside player object, no status/expected_return fields.
      Each record is a fixture-level absence, not an injury event. Rewrote
      collector to match actual API response.
- Second ingestion run revealed 2 more issues:
  (a) team_stats: `s.clean.total` undefined — free-tier response omits the
      `clean` field entirely. Fixed: defensive optional chaining (s.clean?.total ?? 0).
      NOTE: cleanSheets will be 0 for all teams on free tier — real limitation.
  (b) player_stats + injuries: HTTP 429 — free tier rate limit is exactly
      10 requests per minute (confirmed by API error message). Initial 3s
      delay was too fast (~20 req/min). Fixed: increased to 6.5s delay
      (~9 req/min, just under the 10/min limit).

Stage Summary — Live Ingestion Results:
✅ fixtures: 380 matches ingested (full 2024-25 EPL season, Aug 2024 – May 2025)
✅ standings: 20 teams ingested (Liverpool champions 84pts, Arsenal 2nd 74pts)
✅ team_stats: 10/20 teams ingested (rotating strategy, 10 per run — remaining
   10 will be fetched on next cron run. Liverpool 86 GF highest, Arsenal 34 GA
   lowest. Clean sheets = 0 for all teams: free-tier omits this field.)
✅ player_stats: 59 players ingested from 3 teams (rotating strategy, 3 per
   run — full league requires ~7 runs at 3 teams/run. Top scorer: E. Eze
   (Crystal Palace) 8 goals, 34 apps, 7.3 rating.)
✅ injuries: 3168 absence records ingested, 403 unique players, avg 7.9
   absences per affected player. Types: "Missing Fixture" (majority),
   "Questionable". Top reasons: Knee Injury, Thigh Injury, Ankle Injury,
   Muscle Injury, Hamstring Injury, Calf Injury, Groin Injury, Red Card.
   ENDPOINT CONFIRMED WORKING ON FREE TIER.
✅ referees: STUB — returns insufficient_data as designed. Endpoint
   availability unconfirmed; flagged per Section 15.
✅ head_to_head: returns 0 records (no upcoming matches for historical
   season + `last` param blocked on free tier). Will fix in Module 2 with
   date-range query.

API-Football Free-Tier Constraints (PERMANENT — document for future reference):
1. Season access: 2022-2024 only. Season 2025+ requires paid plan.
   → Live/current-season prediction requires plan upgrade. Using 2024 for
     development/backtesting. Vali will revisit plan tier when prediction
     logic is validated.
2. Rate limit: 10 requests per minute (confirmed via API error message).
   → Rate limiter set to 6.5s between calls (~9 req/min). Full ingestion
     run takes ~100s. Acceptable for daily cron; slow for interactive dev.
3. Daily limit: 100 requests per day.
   → Collectors use rotating strategy (10 teams/run for team_stats, 3/run
     for player_stats) to stay within budget. Full league team_stats needs
     2 runs (20 teams ÷ 10/run). Full league player_stats needs ~7 runs.
4. Blocked parameters: `last` and `next` on /fixtures endpoint.
   → head_to_head collector needs rewrite to use from=/to= date range
     instead of last=20. Deferred to Module 2.
5. Missing fields in /teams/statistics response: `clean` (clean sheets)
   field absent. Defensive chaining defaults to 0.
   → Clean sheet data not available on free tier. Module 3 (Feature
     Engineering) will need to derive clean sheet rate from match results
     instead of relying on team_stats endpoint.

Bugs Fixed During Ingestion:
1. Fixtures venue: object → string extraction (venue?.name)
2. Team relation filter: matches → OR[homeMatches, awayMatches]
3. Injuries response structure: type/reason on player object, not top-level
4. Team_stats defensive parsing: optional chaining for all nested fields
5. Rate limiter: 3s → 6.5s delay (10 req/min limit confirmed)
6. Env loading: --env-file=../../.env flag added to atlas-api package.json

Data Quality Observations (for Module 2 Cleaning):
- Player names contain HTML entities (e.g. "J. O&apos;Brien" instead of
  "J. O'Brien"). Module 2 should decode HTML entities.
- Injury types are limited: "Missing Fixture" and "Questionable" only.
  The `reason` field carries the actual injury type (Knee, Ankle, etc.).
- Fixture IDs are stable across runs (upsert dedup works correctly).
- All timestamps are UTC (API-Football returns ISO 8601 with +00:00).

What's Confirmed Working:
- Collectors → Prisma → SQLite pipeline ✓
- Upsert deduplication on apiFootballId ✓
- Quota tracking (DB-backed, survives restarts) ✓
- Response caching (in-memory, TTL-based) ✓
- Rate limiting (6.5s gap, under 10/min limit) ✓
- Auto-mark unavailable endpoints (403 detection) ✓
- Honest insufficient_data for stubs + expected conditions ✓
- Dashboard renders real DB row counts ✓

What's Needed for Module 2:
- User sign-off on Module 1 (pipeline proven end-to-end with real data)
- Module 2 will address:
  (a) HTML entity decoding in player/team names
  (b) head_to_head collector rewrite (date-range instead of last=N)
  (c) Clean sheet derivation from match results (free-tier workaround)
  (d) Name standardization across seasons
  (e) Source confidence flag enforcement on every record
  (f) Daily reconciliation job (dedup audit + missing value report)

---
Task ID: 2 (Module 2 — Cleaning & Validation)
Agent: Zai (main, GLM)
Task: Build Module 2 per ATLAS spec Section 5. Implement cleaning library,
apply it to all collectors, rewrite head_to_head for free-tier compatibility,
build daily reconciliation job, add dashboard Data Quality card. Commit + push
per permanent git process.

Work Log:
- Built lib/cleaning.ts — cleaning primitives:
  - decodeHtmlEntities(): decodes &apos; &amp; &quot; &#39; etc. in names
  - normalizeName(): decodes entities + trims whitespace + collapses spaces
  - normalizeTimestampToUtc(): ensures UTC-normalized Date objects
  - validateStat(): returns null instead of 0 for missing numeric stats
  - validateSourceConfidence(): ensures [0,1] range, defaults to 0.5
  - auditNameForHtmlEntities(): post-cleaning audit helper
  - auditStatForZeroFill(): detects pre-cleaning zero-fills

- Schema audit + fixes (prisma/schema.prisma):
  - TeamStat.cleanSheets: Int @default(0) → Int? (nullable per spec S.5)
  - TeamStat.failedToScore: Int @default(0) → Int?
  - TeamStat.last5GoalsFor/Against/Points: Int @default(0) → Int?
  - Added TeamStat.cleanSheetsDerived: Int? (computed from match results)
  - Added CleaningReport model: stores audit results + actions taken per run

- Applied cleaning library to all 7 active collectors:
  - fixtures: normalizeName on team names, normalizeTimestampToUtc on kickoff
  - standings: normalizeName on team names
  - team_stats: validateStat for cleanSheets/failedToScore (null not 0),
    normalizeName on team name
  - player_stats: normalizeName on player names + firstName/lastName/nationality
  - injuries: normalizeName on player/team/type/reason, normalizeTimestampToUtc
  - lineups: normalizeName on player names
  - h2h: REWROTE — uses from=/to= date-range query (5-year window) instead
    of blocked last=N parameter. Free-tier compatible.

- Built jobs/reconciliation.ts — daily reconciliation job:
  1. Dedup audit (duplicate fixture IDs — should always be 0)
  2. HTML entity audit + fix (decode entities in team/player names)
  3. Zero-fill audit + fix (convert 0 → null for missing stats)
  4. Source confidence audit (ensure every record has sourceConfidence)
  5. Orphaned FK audit (raw SQL — Prisma can't filter on null relations)
  6. Clean sheet derivation (compute from match results — free-tier workaround)
  7. Timestamp audit (no-op — Prisma enforces UTC + non-nullable)
  8. Write CleaningReport to DB

- Added routes/cleaning.ts:
  - POST /cleaning/run — trigger reconciliation
  - GET /cleaning/report — latest report
  - GET /cleaning/reports — last 10 reports
  - GET /validation/issues — current issues from latest report

- Added reconciliation cron to scheduler (4:30 AM daily, after 4 AM collectors)

- Updated dashboard (src/app/page.tsx):
  - Added Module 2 Data Quality section with 4 cards:
    Status, Records Audited, Issues Found, Actions Taken
  - Added "Run reconciliation" button
  - Added Sample Issues card (shows first 10 issues from latest report)
  - Updated header: Module 1 → Module 2 current
  - Auto-fetches /cleaning/report on every 15s refresh

- Bugs fixed during reconciliation development:
  1. Prisma can't filter on `where: { homeTeam: null }` for relations —
     switched to raw SQL for orphaned FK audit
  2. Prisma can't filter on `where: { kickoffUtc: null }` for non-nullable
     fields — removed the check (schema enforces non-null)
  3. .env file got truncated to 50 bytes (sandbox filesystem issue) —
     restored full .env with API key

Stage Summary — Module 2 Live Results:
✅ Re-ingested 2024 EPL data with Module 2 cleaning applied:
   - 380 matches, 20 standings, 10 team_stats, 59 player_stats, 3168 injuries
   - 0 HTML entities in any name (cleaning library working)
   - 0 zero-filled stats (all missing values are null, not 0)
   - 0 duplicate fixtures, 0 orphaned FKs, 0 missing source confidence
✅ Reconciliation job: status=success, 854 records audited, 26ms duration
✅ Clean sheets derived from match results (free-tier workaround):
   - Liverpool: 14, Arsenal: 13, Man City: 13, Newcastle: 13
   - Nottingham Forest: 13, Chelsea: 11, Aston Villa: 9
   - Bournemouth: 9, Brighton: 8, Brentford: 8
✅ CleaningReport written to DB, dashboard renders it in Data Quality card
✅ head_to_head collector rewritten — uses date-range query (free-tier compatible)
✅ API quota: 16/100 used today (84 remaining)

Spec Section 5 Compliance:
- Deduplication on fixture ID: ✓ (upsert + audit confirms 0 duplicates)
- Missing value handling (explicit null, never zero-fill): ✓ (schema + collectors + reconciliation)
- Name standardization: ✓ (HTML entity decoding + whitespace normalization)
- Timestamp normalization to UTC: ✓ (normalizeTimestampToUtc in all collectors)
- Source confidence flag on every ingested record: ✓ (validateSourceConfidence + audit confirms 0 missing)

What's Confirmed Working:
- Cleaning library prevents HTML entities from entering the DB ✓
- Cleaning library prevents zero-fills from entering the DB ✓
- Reconciliation job audits + fixes existing data ✓
- Clean sheet derivation works (free-tier workaround) ✓
- Dashboard renders cleaning report in real-time ✓
- head_to_head collector works on free tier (date-range query) ✓
- All 7 Constitution rules still honored (especially Rule 4: never fabricate) ✓

What's Needed for Module 3:
- User sign-off on Module 2
- Module 3 (Feature Engineering, spec Section 6) will build:
  - Team Strength, Attack Rating, Defensive Stability, Form Score
  - Home/Away split, Possession Rating, Goal Threat, Clean Sheet Rate
  - Fatigue (days rest), Squad Depth (bench minutes played)
  - STUB: Tactical Flexibility, Momentum Score, Set Piece Rating
