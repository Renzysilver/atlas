# ATLAS Local Deployment

This is the **production-equivalent** Docker Compose stack for running ATLAS
on your local machine. The sandbox dev environment uses SQLite + in-memory
queue (because Docker is unavailable there); this stack gives you the real
PostgreSQL + Redis backing per the original ATLAS spec (Section 2).

## Setup

```bash
cd infra/
cp .env.example .env
# Edit .env and fill in your API keys (API_FOOTBALL_KEY is the only critical one for Module 1)
docker compose up -d
```

Verify the services are up:

```bash
docker compose ps
# atlas-postgres   healthy
# atlas-redis      healthy
```

## Switch the codebase from sandbox (SQLite) → local Docker (Postgres)

Three changes, all in `.env`:

```diff
- DATABASE_URL=file:/home/z/my-project/db/custom.db
+ DATABASE_URL=postgresql://atlas:atlas_dev@localhost:5432/atlas

- REDIS_URL=
+ REDIS_URL=redis://localhost:6379
```

And one change in `prisma/schema.prisma`:

```diff
  datasource db {
-   provider = "sqlite"
+   provider = "postgresql"
    url      = env("DATABASE_URL")
  }
```

Then from project root:

```bash
bun run db:push          # creates all tables in Postgres
bun run dev              # dashboard on http://localhost:3000
cd mini-services/atlas-api && bun run dev   # API on http://localhost:4001
```

**That's the entire swap.** No code changes anywhere else. The `lib/queue.ts`
module auto-detects `REDIS_URL` and switches from in-memory fallback to real
BullMQ + ioredis. Same with `lib/db.ts` — Prisma handles the dialect swap.

## What you get with real Postgres + Redis

| Capability | SQLite (sandbox) | Postgres + Redis (local) |
|---|---|---|
| Concurrent writes | Single-writer lock | Full MVCC |
| BullMQ durable jobs | In-memory (lost on restart) | Redis-persisted |
| JSONB columns | TEXT-emulated | Native |
| Time-series (InfluxDB, future) | N/A | Add InfluxDB container when Market Intelligence activates |
| Backup | File copy | `pg_dump` |

## Data migration (sandbox → local Postgres)

If you've collected real EPL data in the sandbox SQLite and want to migrate
it to your local Postgres:

```bash
# In sandbox:
sqlite3 /home/z/my-project/db/custom.db .dump > /tmp/atlas-dump.sql

# Filter out SQLite-specific PRAGMA statements, then:
psql "postgresql://atlas:atlas_dev@localhost:5432/atlas" < /tmp/atlas-dump.sql
```

(The Prisma schema is identical between providers, so the table structures
match. You may need to strip `CREATE TABLE sqlite_sequence` and similar
SQLite artifacts.)

## Tear down

```bash
docker compose down           # stop containers, keep data
docker compose down -v        # stop containers, WIPE data volumes
```
