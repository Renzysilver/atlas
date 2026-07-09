#!/bin/bash
# ATLAS Module 3 — Full pipeline: re-ingest + reconcile + feature engineering
# Single process tree so sandbox doesn't kill background processes.

set -e

PROJECT_DIR="/home/z/my-project"
API_DIR="$PROJECT_DIR/mini-services/atlas-api"
LOG_FILE="/tmp/atlas-module3.log"

echo "=== STEP 0: Restore .env if truncated ==="
if ! grep -q "^API_FOOTBALL_KEY=0093" "$PROJECT_DIR/.env"; then
  echo "  .env truncated — restoring..."
  cat > "$PROJECT_DIR/.env" << 'ENVEOF'
DATABASE_URL=file:/home/z/my-project/db/custom.db
REDIS_URL=
QUEUE_CONCURRENCY=4
ATLAS_API_PORT=4001
ATLAS_API_LOG_LEVEL=info
API_FOOTBALL_KEY=0093e5a248342df2c8de97237edcf3a3
API_FOOTBALL_HOST=v3.football.api-sports.io
API_FOOTBALL_BASE_URL=https://v3.football.api-sports.io
API_FOOTBALL_DAILY_LIMIT=100
API_FOOTBALL_SEASON=2024
API_FOOTBALL_LEAGUE_ID=39
GROQ_API_KEY=YOUR_GROQ_API_KEY_HERE
GROQ_MODEL=llama-3.3-70b-versatile
RESEND_API_KEY=
DAILY_REPORT_RECIPIENT=vali@example.com
DAILY_REPORT_SENDER=atlas@yourdomain.com
WEATHER_API_KEY=
ODDS_API_KEY=
DAILY_REPORT_CRON="0 5 * * *"
COLLECTOR_FIXTURES_CRON="0 */6 * * *"
COLLECTOR_DAILY_CRON="0 4 * * *"
COLLECTOR_LINEUPS_CRON="*/10 * * * *"
RECONCILIATION_CRON="30 4 * * *"
FEATURE_ENGINEERING_CRON="0 5 * * *"
ATLAS_NEVER_FABRICATE=true
ATLAS_LOG_EVERY_PREDICTION=true
NEXT_PUBLIC_ATLAS_API_PORT=4001
ENVEOF
  echo "  ✓ .env restored"
else
  echo "  ✓ .env intact"
fi

echo ""
echo "=== STEP 1: Start atlas-api ==="
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
echo "=== STEP 2: Health check (verify API key loaded) ==="
curl -sS --max-time 5 http://localhost:4001/health 2>&1 | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'  status: {d[\"status\"]}, apiFootball: {d[\"checks\"][\"apiFootball\"]}, database: {d[\"checks\"][\"database\"]}')
"

echo ""
echo "=== STEP 3: Ingest fixtures (380 matches) ==="
curl -sS -X POST --max-time 120 "http://localhost:4001/collectors/run/fixtures" 2>&1 | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'  status: {d[\"status\"]}, ingested: {d[\"recordsIngested\"]}')
"

echo ""
echo "=== STEP 4: Ingest standings (20 teams) ==="
curl -sS -X POST --max-time 60 "http://localhost:4001/collectors/run/standings" 2>&1 | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'  status: {d[\"status\"]}, ingested: {d[\"recordsIngested\"]}')
"

echo ""
echo "=== STEP 5: Ingest team_stats (10 teams, ~65s) ==="
curl -sS -X POST --max-time 120 "http://localhost:4001/collectors/run/team_stats" 2>&1 | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'  status: {d[\"status\"]}, ingested: {d[\"recordsIngested\"]}')
"

echo ""
echo "=== STEP 6: Ingest player_stats (3 teams, ~20s) ==="
curl -sS -X POST --max-time 120 "http://localhost:4001/collectors/run/player_stats" 2>&1 | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'  status: {d[\"status\"]}, ingested: {d[\"recordsIngested\"]}')
"

echo ""
echo "=== STEP 7: Ingest injuries (3168 records) ==="
curl -sS -X POST --max-time 120 "http://localhost:4001/collectors/run/injuries" 2>&1 | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'  status: {d[\"status\"]}, ingested: {d[\"recordsIngested\"]}')
"

echo ""
echo "=== STEP 8: Run reconciliation (Module 2 — derive clean sheets) ==="
curl -sS -X POST --max-time 120 "http://localhost:4001/cleaning/run" 2>&1 | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'  status: {d[\"status\"]}, cleanSheetsDerived: {d[\"cleanSheetsDerived\"]}, audited: {d[\"totalRecordsAudited\"]}')
"

echo ""
echo "=== STEP 9: Run feature engineering (Module 3 core) ==="
curl -sS -X POST --max-time 300 "http://localhost:4001/features/run" 2>&1 | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'  status:                   {d[\"status\"]}')
print(f'  durationMs:               {d[\"durationMs\"]}')
print(f'  teamsProcessed:           {d[\"teamsProcessed\"]}')
print(f'  matchesProcessed:         {d[\"matchesProcessed\"]}')
print(f'  seasonFeaturesComputed:   {d[\"seasonFeaturesComputed\"]}')
print(f'  matchFeaturesComputed:    {d[\"matchFeaturesComputed\"]}')
print(f'  stubFeaturesCreated:      {d[\"stubFeaturesCreated\"]}')
print(f'  insufficientDataCount:    {d[\"insufficientDataCount\"]}')
print(f'  errors:                   {len(d[\"errors\"])}')
if d['errors']:
    print(f'  first 3 errors:')
    for e in d['errors'][:3]:
        print(f'    {e[:120]}')
"

echo ""
echo "=== STEP 10: Feature summary ==="
curl -sS --max-time 5 "http://localhost:4001/features" 2>&1 | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'  Season: {d[\"season\"]}')
print(f'  Registry: {d[\"registry\"][\"active\"]} active + {d[\"registry\"][\"stub\"]} stub = {d[\"registry\"][\"total\"]} total')
print(f'  TeamFeature breakdown:')
for key, count in sorted(d['teamFeatures'].items()):
    print(f'    {key}: {count}')
print(f'  MatchFeature breakdown:')
for key, count in sorted(d['matchFeatures'].items()):
    print(f'    {key}: {count}')
"

echo ""
echo "=== STEP 11: Sample team features (Liverpool — top of table) ==="
cd "$PROJECT_DIR"
bun -e "
const { db } = require('./mini-services/atlas-api/lib/db.ts');
async function main() {
  const liverpool = await db.team.findFirst({ where: { name: { contains: 'Liverpool' } } });
  if (!liverpool) { console.log('  Liverpool not found'); return; }
  const features = await db.teamFeature.findMany({
    where: { teamId: liverpool.id, season: 2024 },
    orderBy: { featureName: 'asc' },
  });
  console.log('  Liverpool season features:');
  for (const f of features) {
    const val = f.value !== null ? f.value.toFixed(3) : 'null';
    console.log('    ' + f.featureName.padEnd(25) + ' = ' + val.padStart(8) + '  [' + f.status + ']');
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
" 2>&1

echo ""
echo "=== STEP 12: DB tables final state ==="
curl -sS --max-time 5 "http://localhost:4001/stats" 2>&1 | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'{\"table\":<20} {\"rows\":>8}')
print(f'{\"-\"*20} {\"-\"*8}')
for t in d['tables']:
    print(f'{t[\"name\"]:<20} {t[\"rowCount\"]:>8}')
print()
print(f'API quota: {d[\"apiQuota\"][\"apiFootball\"][\"used\"]} / {d[\"apiQuota\"][\"apiFootball\"][\"limit\"]}')
"

echo ""
echo "=== STEP 13: Verify service STILL running before reporting done ==="
ps -p $ATLAS_PID -o pid,stat 2>&1 | tail -1
curl -sS -o /dev/null -w "  Health: HTTP %{http_code}\n" --max-time 3 http://localhost:4001/health 2>&1

echo ""
echo "=== DONE ==="
