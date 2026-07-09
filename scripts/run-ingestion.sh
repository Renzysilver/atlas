#!/bin/bash
# ATLAS Module 1 — Ingestion runner script
# Starts atlas-api, runs collectors, fetches results, all in one process tree
# so the sandbox doesn't kill background processes.

set -e

PROJECT_DIR="/home/z/my-project"
API_DIR="$PROJECT_DIR/mini-services/atlas-api"
LOG_FILE="/tmp/atlas-api-ingest.log"

echo "=== STEP 1: Start atlas-api (foreground, will run for entire script) ==="
cd "$API_DIR"
bun --env-file=../../.env index.ts > "$LOG_FILE" 2>&1 &
ATLAS_PID=$!
echo "  atlas-api PID: $ATLAS_PID"

# Cleanup on exit — kill atlas-api when this script ends
trap "echo '  Stopping atlas-api...'; kill $ATLAS_PID 2>/dev/null; wait $ATLAS_PID 2>/dev/null" EXIT

# Wait for atlas-api to be ready
echo "  Waiting for atlas-api to be ready..."
for i in $(seq 1 20); do
  if curl -sS -o /dev/null --max-time 2 http://localhost:4001/health 2>/dev/null; then
    echo "  ✓ atlas-api ready after ${i}s"
    break
  fi
  if [ $i -eq 20 ]; then
    echo "  ✗ atlas-api failed to start"
    cat "$LOG_FILE" | tail -20
    exit 1
  fi
  sleep 1
done

echo ""
echo "=== STEP 2: Run fixtures collector (1 API call → 380 matches) ==="
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
echo "=== STEP 3: Run standings collector (1 API call → 20 teams) ==="
curl -sS -X POST --max-time 60 "http://localhost:4001/collectors/run/standings" 2>&1 | python3 -c "
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
echo "=== STEP 4: Run team_stats collector (10 API calls → 10 team stat records) ==="
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
echo "=== STEP 5: Run player_stats collector (3 API calls → many player records) ==="
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
echo "=== STEP 6: DB TABLES AFTER ACTIVE COLLECTOR RUNS ==="
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
echo "=== STEP 7: Run head_to_head collector (expects insufficient_data — no upcoming matches) ==="
curl -sS -X POST --max-time 30 "http://localhost:4001/collectors/run/head_to_head" 2>&1 | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'  status:          {d[\"status\"]}')
print(f'  recordsIngested: {d[\"recordsIngested\"]}')
print(f'  durationMs:      {d[\"durationMs\"]}')
if d.get('error'):
    print(f'  error: {d[\"error\"][:300]}')
"

echo ""
echo "=== STEP 8: Run injuries collector (TESTING — may 403 on free tier) ==="
curl -sS -X POST --max-time 30 "http://localhost:4001/collectors/run/injuries" 2>&1 | python3 -c "
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
echo "=== STEP 9: Run referees collector (STUB — should return insufficient_data) ==="
curl -sS -X POST --max-time 30 "http://localhost:4001/collectors/run/referees" 2>&1 | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'  status:          {d[\"status\"]}')
print(f'  durationMs:      {d[\"durationMs\"]}')
if d.get('error'):
    print(f'  error: {d[\"error\"][:400]}')
"

echo ""
echo "=== STEP 10: Final DB tables + quota ==="
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
echo "=== DONE — atlas-api will be cleaned up by trap ==="
