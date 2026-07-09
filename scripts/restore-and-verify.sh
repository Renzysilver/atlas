#!/bin/bash
# ATLAS — Restore + re-ingest + verify (single process tree)
# Starts atlas-api, runs all collectors + reconciliation, verifies, all in
# one bash invocation so the sandbox doesn't kill background processes.

set -e

PROJECT_DIR="/home/z/my-project"
API_DIR="$PROJECT_DIR/mini-services/atlas-api"
LOG_FILE="/tmp/atlas-restore.log"

echo "=== STEP 1: Verify .env has API key ==="
grep -q "^API_FOOTBALL_KEY=0093" "$PROJECT_DIR/.env" && echo "  ✓ API key present" || { echo "  ✗ .env missing key — aborting"; exit 1; }

echo ""
echo "=== STEP 2: Start atlas-api (foreground, trap cleanup) ==="
cd "$API_DIR"
bun --env-file=../../.env index.ts > "$LOG_FILE" 2>&1 &
ATLAS_PID=$!
echo "  atlas-api PID: $ATLAS_PID"
trap "echo '  Stopping atlas-api...'; kill $ATLAS_PID 2>/dev/null; wait $ATLAS_PID 2>/dev/null" EXIT

for i in $(seq 1 15); do
  if curl -sS -o /dev/null --max-time 2 http://localhost:4001/health 2>/dev/null; then
    echo "  ✓ atlas-api ready after ${i}s"
    break
  fi
  sleep 1
done

echo ""
echo "=== STEP 3: Health check (must show apiFootball: ok) ==="
curl -sS --max-time 5 http://localhost:4001/health 2>&1 | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'  status:       {d[\"status\"]}')
print(f'  apiFootball:  {d[\"checks\"][\"apiFootball\"]}')
print(f'  database:     {d[\"checks\"][\"database\"]}')
assert d['checks']['apiFootball'] == 'ok', 'API key not loaded!'
print('  ✓ API-Football key is loaded')
"

echo ""
echo "=== STEP 4: Re-ingest fixtures (380 matches) ==="
curl -sS -X POST --max-time 120 "http://localhost:4001/collectors/run/fixtures" 2>&1 | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'  status: {d[\"status\"]}, ingested: {d[\"recordsIngested\"]}, duration: {d[\"durationMs\"]}ms')
"

echo ""
echo "=== STEP 5: Re-ingest standings (20 teams) ==="
curl -sS -X POST --max-time 60 "http://localhost:4001/collectors/run/standings" 2>&1 | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'  status: {d[\"status\"]}, ingested: {d[\"recordsIngested\"]}, duration: {d[\"durationMs\"]}ms')
"

echo ""
echo "=== STEP 6: Re-ingest team_stats (10 teams, ~65s with rate limiter) ==="
curl -sS -X POST --max-time 120 "http://localhost:4001/collectors/run/team_stats" 2>&1 | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'  status: {d[\"status\"]}, ingested: {d[\"recordsIngested\"]}, duration: {d[\"durationMs\"]}ms')
"

echo ""
echo "=== STEP 7: Re-ingest player_stats (3 teams, ~20s) ==="
curl -sS -X POST --max-time 120 "http://localhost:4001/collectors/run/player_stats" 2>&1 | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'  status: {d[\"status\"]}, ingested: {d[\"recordsIngested\"]}, duration: {d[\"durationMs\"]}ms')
"

echo ""
echo "=== STEP 8: Re-ingest injuries (3168 records, 1 API call) ==="
curl -sS -X POST --max-time 120 "http://localhost:4001/collectors/run/injuries" 2>&1 | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'  status: {d[\"status\"]}, ingested: {d[\"recordsIngested\"]}, duration: {d[\"durationMs\"]}ms')
"

echo ""
echo "=== STEP 9: Run reconciliation (derive clean sheets + audit) ==="
curl -sS -X POST --max-time 120 "http://localhost:4001/cleaning/run" 2>&1 | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'  status:               {d[\"status\"]}')
print(f'  totalRecordsAudited:  {d[\"totalRecordsAudited\"]}')
print(f'  duplicateFixtures:    {d[\"duplicateFixtures\"]}')
print(f'  htmlEntityNames:      {d[\"htmlEntityNames\"]}')
print(f'  zeroFilledStats:      {d[\"zeroFilledStats\"]}')
print(f'  orphanedForeignKeys:  {d[\"orphanedForeignKeys\"]}')
print(f'  cleanSheetsDerived:   {d[\"cleanSheetsDerived\"]}')
"

echo ""
echo "=== STEP 10: Final DB verification (the numbers the user asked about) ==="
cd "$PROJECT_DIR"
bun -e "
const { db } = require('./mini-services/atlas-api/lib/db.ts');
async function main() {
  const counts = {
    teams: await db.team.count(),
    players: await db.player.count(),
    matches: await db.match.count(),
    standings: await db.standing.count(),
    team_stats: await db.teamStat.count(),
    player_stats: await db.playerStat.count(),
    injuries: await db.injury.count(),
    cleaning_reports: await db.cleaningReport.count(),
  };
  console.log('  DB counts:');
  for (const [k, v] of Object.entries(counts)) {
    console.log('    ' + k.padEnd(20) + v);
  }
  console.log('');
  console.log('  User verification targets:');
  console.log('    matches: ' + counts.matches + ' (expected 380) ' + (counts.matches === 380 ? '✓' : '✗'));
  console.log('    injuries: ' + counts.injuries + ' (expected 3168) ' + (counts.injuries === 3168 ? '✓' : '✗'));
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
" 2>&1

echo ""
echo "=== STEP 11: Verify clean sheets derived ==="
bun -e "
const { db } = require('./mini-services/atlas-api/lib/db.ts');
async function main() {
  const stats = await db.teamStat.findMany({
    include: { team: true },
    orderBy: { cleanSheetsDerived: 'desc' },
    take: 5,
  });
  console.log('  Top 5 by derived clean sheets:');
  for (const s of stats) {
    console.log('    ' + (s.team.name || '').padEnd(24) + 'cleanSheets(derived): ' + s.cleanSheetsDerived);
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
" 2>&1

echo ""
echo "=== STEP 12: API quota used ==="
curl -sS --max-time 5 http://localhost:4001/health/quota 2>&1 | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'  Used today: {d[\"used\"]} / {d[\"limit\"]} (remaining: {d[\"remaining\"]})')
"

echo ""
echo "=== DONE — atlas-api will be cleaned up by trap ==="
echo "  NOTE: atlas-api will stop when this script exits (sandbox process management)."
echo "  To keep it running for the dashboard, the sandbox's dev.sh must manage it."
