# ATLAS — Institutional Football Intelligence Platform

**Phase 1, Module 1: Data Collection** — built per the ATLAS Master Build Prompt v1.0
specification. Phase 1 scope is English Premier League only, with API-Football
as the primary data source.

## What's Built (Module 1 of 9)

Per Section 17 of the spec, ATLAS is built **one module at a time, with
architecture review between each**. This is Module 1 — Data Collection. Modules
2-9 are queued and will be built after Vali/Claude review this module.

| # | Module | Status |
|---|---|---|
| 1 | Data Collection | ✅ **current** — 7 ACTIVE collectors + 5 STUB collectors |
| 2 | Cleaning & Validation | queued |
| 3 | Feature Engineering | queued |
| 4 | Football Intelligence Engine (17 layers) | queued |
| 5 | Prediction Decision Engine | queued |
| 6 | Explainability Engine | queued |
| 7 | Risk Management Engine | queued |
| 8 | Adaptive Learning | queued |
| 9 | Delivery & Daily Report | queued |

## Architecture

```
atlas/
├── src/                              # Next.js 16 dashboard (port 3000)
│   └── app/page.tsx                  # ATLAS Module 1 dashboard
├── prisma/schema.prisma              # Full Section 14 schema (14 models)
├── packages/
│   └── shared/                       # @atlas/shared — types + uniform layer contract
│       └── src/{contract,layers,types,index}.ts
├── mini-services/
│   ├── atlas-api/                    # Node/Express API (port 4001)
│   │   ├── lib/{db,logger,queue,apiFootball}.ts
│   │   ├── collectors/               # 12 collectors (7 active, 5 stub)
│   │   ├── routes/{health,collectors,stats}.ts
│   │   ├── jobs/scheduler.ts         # node-cron for scheduled ingestion
│   │   └── index.ts                  # Express entry
│   └── simulation/                   # Python FastAPI (placeholder for Module 4 Layer 12)
├── infra/
│   ├── docker-compose.yml            # Real Postgres + Redis (user's local deploy)
│   ├── .env.example                  # All required env vars
│   └── README.md                     # Sandbox → Postgres migration path
├── worklog.md                        # Shared agent worklog (per Section 17 protocol)
└── .env                              # Active environment config
```

## The 12 Module 1 Collectors

### 🟢 ACTIVE (7) — write real data to Postgres/SQLite via Prisma

| Collector | API-Football endpoint | Feeds Layer | Cron |
|---|---|---|---|
| `fixtures` | `/fixtures?league=39&season=2025` | historical_intelligence | every 6h |
| `standings` | `/standings?league=39&season=2025` | team_intelligence | 4 AM daily |
| `team_stats` | `/teams/statistics` (rotated, 10/run) | team_intelligence | 4 AM daily |
| `player_stats` | `/players?team=ID&season=2025` (rotated, 3/run) | player_intelligence | 4 AM daily |
| `lineups` | `/fixtures/lineups?fixture=ID` (next 3h matches) | tactical_intelligence | every 10min |
| `injuries` | `/injuries?league=39&season=2025` (may 403 on free tier) | injury_intelligence | 4 AM daily |
| `head_to_head` | `/fixtures/headtohead?h2h=ID1-ID2&last=20` | historical_intelligence | every 6h |

### 🟡 STUB (5) — correct interface, return `insufficient_data` honestly

| Collector | Reason | When it activates |
|---|---|---|
| `weather` | No WEATHER_API_KEY | Set env var → swap StubCollector for real WeatherCollector |
| `odds` | No ODDS_API_KEY (CRITICAL — never fake Value Score) | Set env var → enables Module 7 High-Value tier |
| `news` | No news/sentiment source | Wire news API → enables Psychology Intelligence Layer 5 |
| `referees` | API-Football referee endpoint availability unconfirmed | Confirm plan coverage → swap to real collector |
| `stadium` | Granular venue API not yet wired | Phase 2 enhancement |

## ATLAS Constitution (spec Section 0 — non-negotiable)

1. Every module, layer, AI model is **permanent**. The full 9 modules, 17 layers, 15 AI models are the system — always.
2. Data availability only changes **implementation status** — never existence. Stubbed ≠ deleted.
3. **BrainOS** is the permanent orchestration layer. No module calls another directly.
4. **Never fabricate data.** If a real number can't be computed, the honest output is `insufficient_data`.
5. Every prediction is **explainable and traceable**. No black-box outputs.
6. Every completed match becomes **training data**. Logging runs from Phase 1 onward, always.
7. Build **one module at a time**, then stop. Flag contradictions — never resolve quietly.

## Running ATLAS

### Dev sandbox (this environment)

The sandbox auto-starts both services via `.zscripts/dev.sh`:

- **Dashboard**: `http://localhost:81/` (via Caddy gateway)
- **atlas-api**: `http://localhost:81/health?XTransformPort=4001` (via Caddy)
- **Direct atlas-api**: `http://localhost:4001/health`

To trigger a collector manually:
```bash
curl -X POST "http://localhost:81/collectors/run/standings?XTransformPort=4001"
```

### Your local machine (production-equivalent)

```bash
# 1. Start real Postgres + Redis via Docker Compose
cd infra/
cp .env.example .env  # fill in your API_FOOTBALL_KEY etc.
docker compose up -d

# 2. Swap the codebase from sandbox (SQLite) → Postgres
# Edit prisma/schema.prisma: provider = "postgresql"
# Edit .env: DATABASE_URL=postgresql://atlas:atlas_dev@localhost:5432/atlas
#           REDIS_URL=redis://localhost:6379

# 3. Push schema to Postgres
bun run db:push

# 4. Start dashboard + atlas-api
bun run dev              # dashboard on :3000
cd mini-services/atlas-api && bun run dev   # API on :4001
```

See `infra/README.md` for full migration details.

## Key Files

- `prisma/schema.prisma` — Section 14 normalized schema (14 models + 2 operational)
- `packages/shared/src/contract.ts` — Uniform LayerOutput contract (Section 7)
- `packages/shared/src/layers.ts` — All 17 layer names + Phase 1 build status + fixed consensus weights
- `mini-services/atlas-api/lib/apiFootball.ts` — API-Football client with free-tier rate limiting + caching
- `mini-services/atlas-api/collectors/base.ts` — BaseCollector with Constitution Rule 4 enforcement
- `worklog.md` — Shared agent worklog (per Section 17 protocol)
- `infra/docker-compose.yml` — Real Postgres + Redis for your local deployment

## Spec Compliance

This Module 1 build **strictly follows** the ATLAS Master Build Prompt v1.0:
- ✅ Section 0 Constitution — all 7 rules enforced (especially Rule 4: never fabricate)
- ✅ Section 2 Tech Stack — Node/Express + Prisma + (Postgres prod / SQLite dev) + (BullMQ prod / ioredis-mock dev) + node-cron
- ✅ Section 4 Module 1 — 7 active collectors + 5 stub collectors as specified
- ✅ Section 7 Uniform Layer Contract — `LayerOutput` shape matches spec exactly
- ✅ Section 14 Database Schema — all required tables present, source_confidence on every record, layer_outputs table ready for stubbed-layer rows
- ✅ Section 15 Do-Not List — no fabricated data, no deleted modules, no surface "value bet" without odds
- ✅ Section 17 Execution Protocol — one module built, stopping for review

**Two flagged-and-approved deviations** (both environment-specific, not data/contract):
1. SQLite instead of Postgres in sandbox (no Docker available) — user approved Path A
2. ioredis-mock instead of BullMQ+Redis in sandbox (same reason) — user approved Path A

Code is **production-ready**. Swapping to real Postgres + Redis is a one-line edit in `prisma/schema.prisma` + two env vars. See `infra/README.md`.
