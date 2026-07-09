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
- Module 1 is now ready for its first push to GitHub repo `atlas`.
- Awaiting Vali's GitHub PAT + preferred git identity (name + email) to:
  (a) create the repo via GitHub API
  (b) configure remote
  (c) push the Module 1 commit to `main`

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
