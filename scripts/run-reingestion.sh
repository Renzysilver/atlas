#!/bin/bash
# ATLAS Module 1 — Re-ingestion after bug fixes
# Fixed:
#   1. Fixtures: venue object → venue.name string
#   2. team_stats + player_stats: relation filter matches → homeMatches/awayMatches OR
#   3. Injuries: type/reason are on player object, not top-level; no status/expected_return

set -e

PROJECT_DIR="/home/z/my-project"
API_DIR="$PROJECT_DIR/mini-services/atlas-api"
LOG_FILE="/tmp/atlas-api-reingest.log"

# Clear any stale response cache by deleting the SQLite DB and re-pushing schema
# (We're in dev sandbox — starting fresh is fine. Production would never do this.)
echo "=== STEP 0: Reset SQLite DB for clean re-ingestion ==="
cd "$PROJECT_DIR"
rm -f db/custom.db db/custom.db-journal
bun run db:push 2>&1 | tail -3
echo "  ✓ Fresh DB created"

echo ""
echo "=== STEP 1: Start atlas-api ==="
cd "$API_DIR"
bun --env-file=../../.env index.ts > "$LOG_FILE" 2>&1 &
ATLAS_PID=$!
echo "  atlas-api PID: $ATLAS_PID"
trap "echo '  Stopping atlas-api...'; kill $ATLAS_PID 2>/dev/null; wait $ATLAS_PID 2>/dev/null" EXIT

for i in $(seq 1 20); do
  if curl -sS -o /dev/null --max-time 2 http://localhost:4001/health 2>/dev/null; then
    echo "  ✓ atlas-api ready after ${i}s"
    break
  fi
  sleep 1
done

echo ""
echo "=== STEP 2: Run fixtures collector ==="
curl -sS -X POST --max-time 120 "http://localhost:4001/collectors/run/fixtures" 2>&1 | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'  status:          {d[\"status\"]}')
print(f'  recordsIngested: {d[\"recordsIngested\"]}')
print(f'  recordsUpdated:  {d[\"recordsUpdated\"]}')
print(f'  recordsSkipped:  {d[\"recordsSkipped\"]}')
print(f'  durationMs:      {d[\"durationMs\"]}')
if d.get('error'):
    print(f'  error: {d[\"error\"][:300]}')
"

echo ""
echo "=== STEP 3: Run standings collector ==="
curl -sS -X POST --max-time 60 "http://localhost:4001/collectors/run/standings" 2>&1 | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'  status:          {d[\"status\"]}')
print(f'  recordsIngested: {d[\"recordsIngested\"]}')
print(f'  recordsUpdated:  {d[\"recordsUpdated\"]}')
print(f'  recordsSkipped:  {d[\"recordsSkipped\"]}')
print(f'  durationMs:      {d[\"durationMs\"]}')
"

echo ""
echo "=== STEP 4: Run team_stats collector ==="
curl -sS -X POST --max-time 120 "http://localhost:4001/collectors/run/team_stats" 2>&1 | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'  status:          {d[\"status\"]}')
print(f'  recordsIngested: {d[\"recordsIngested\"]}')
print(f'  recordsUpdated:  {d[\"recordsUpdated\"]}')
print(f'  recordsSkipped:  {d[\"recordsSkipped\"]}')
print(f'  durationMs:      {d[\"durationMs\"]}')
if d.get('error'):
    print(f'  error: {d[\"error\"][:300]}')
"

echo ""
echo "=== STEP 5: Run player_stats collector ==="
curl -sS -X POST --max-time 120 "http://localhost:4001/collectors/run/player_stats" 2>&1 | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'  status:          {d[\"status\"]}')
print(f'  recordsIngested: {d[\"recordsIngested\"]}')
print(f'  recordsUpdated:  {d[\"recordsUpdated\"]}')
print(f'  recordsSkipped:  {d[\"recordsSkipped\"]}')
print(f'  durationMs:      {d[\"durationMs\"]}')
if d.get('error'):
    print(f'  error: {d[\"error\"][:300]}')
"

echo ""
echo "=== STEP 6: Run injuries collector (TESTING — may 403 on free tier) ==="
curl -sS -X POST --max-time 60 "http://localhost:4001/collectors/run/injuries" 2>&1 | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'  status:          {d[\"status\"]}')
print(f'  recordsIngested: {d[\"recordsIngested\"]}')
print(f'  recordsUpdated:  {d[\"recordsUpdated\"]}')
print(f'  recordsSkipped:  {d[\"recordsSkipped\"]}')
print(f'  durationMs:      {d[\"durationMs\"]}')
if d.get('error'):
    print(f'  error: {d[\"error\"][:400]}')
"

echo ""
echo "=== STEP 7: Run referees collector (STUB — should return insufficient_data) ==="
curl -sS -X POST --max-time 30 "http://localhost:4001/collectors/run/referees" 2>&1 | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'  status:          {d[\"status\"]}')
print(f'  durationMs:      {d[\"durationMs\"]}')
if d.get('error'):
    print(f'  error: {d[\"error\"][:200]}')
"

echo ""
echo "=== STEP 8: FINAL DB TABLES ==="
curl -sS --max-time 10 "http://localhost:4001/stats" 2>&1 | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'{\"table\":<20} {\"rows\":>8}  {\"last_updated\":<25}')
print(f'{\"-\"*20} {\"-\"*8}  {\"-\"*25}')
for t in d['tables']:
    lu = t['lastUpdated'][:19] if t['lastUpdated'] else '—'
    print(f'{t[\"name\"]:<20} {t[\"rowCount\"]:>8}  {lu:<25}')
print()
print(f'API-Football quota (tracked by atlas-api): {d[\"apiQuota\"][\"apiFootball\"][\"used\"]} / {d[\"apiQuota\"][\"apiFootball\"][\"limit\"]} used')
"

echo ""
echo "=== STEP 9: Sample data verification ==="
# Show a few sample matches to prove real data landed
curl -sS --max-time 10 "http://localhost:4001/stats/fixtures" 2>&1 | python3 -c "
import json, sys
matches = json.load(sys.stdin)
print(f'  Sample matches from DB (first 5):')
for m in matches[:5]:
    home = m.get('homeTeam', {}).get('name', '?')
    away = m.get('awayTeam', {}).get('name', '?')
    hs = m.get('homeScore', '?')
    as_ = m.get('awayScore', '?')
    date = m.get('kickoffUtc', '')[:10]
    status = m.get('status', '?')
    print(f'    {date}  {home:20s}  {hs}-{as_}  {away:20s}  [{status}]')
print(f'  ... and {len(matches)-5} more' if len(matches) > 5 else '')
"

echo ""
echo "=== DONE ==="
