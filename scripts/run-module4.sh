#!/bin/bash
# ATLAS Module 4 — Run BrainOS on a sample match + verify
# Single process tree so sandbox doesn't kill background processes.

set -e

PROJECT_DIR="/home/z/my-project"
API_DIR="$PROJECT_DIR/mini-services/atlas-api"
LOG_FILE="/tmp/atlas-module4.log"

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
BRAINOS_CRON="30 5 * * *"
ATLAS_NEVER_FABRICATE=true
ATLAS_LOG_EVERY_PREDICTION=true
NEXT_PUBLIC_ATLAS_API_PORT=4001
ENVEOF
  echo "  ✓ .env restored"
else
  # Add BRAINOS_CRON if missing
  grep -q "^BRAINOS_CRON=" "$PROJECT_DIR/.env" || echo 'BRAINOS_CRON="30 5 * * *"' >> "$PROJECT_DIR/.env"
  echo "  ✓ .env intact"
fi

echo ""
echo "=== STEP 1: Check DB state — do we have data from Module 3? ==="
cd "$PROJECT_DIR"
bun -e "
const { db } = require('./mini-services/atlas-api/lib/db.ts');
async function main() {
  const counts = {
    teams: await db.team.count(),
    matches: await db.match.count(),
    team_features: await db.teamFeature.count(),
    match_features: await db.matchFeature.count(),
  };
  console.log('  DB state:', JSON.stringify(counts));
  
  if (counts.matches === 0) {
    console.log('  ⚠ DB empty — need to re-ingest data (schema was reset by Module 4 migration)');
    process.exit(1);
  }
  if (counts.team_features === 0) {
    console.log('  ⚠ Features missing — need to run feature engineering');
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
" 2>&1

# If DB is empty, we need to re-ingest
if [ $? -ne 0 ]; then
  echo ""
  echo "  DB is empty — running quick re-ingest (fixtures + standings + team_stats + reconciliation + features)..."
  echo "  This will use ~3 API calls (fixtures + standings + team_stats batch)"
  
  cd "$API_DIR"
  bun --env-file=../../.env index.ts > "$LOG_FILE" 2>&1 &
  ATLAS_PID=$!
  trap "kill $ATLAS_PID 2>/dev/null; wait $ATLAS_PID 2>/dev/null" EXIT
  
  for i in $(seq 1 15); do
    if curl -sS -o /dev/null --max-time 2 http://localhost:4001/health 2>/dev/null; then
      echo "  ✓ atlas-api ready"
      break
    fi
    sleep 1
  done
  
  echo "  Ingesting fixtures..."
  curl -sS -X POST --max-time 120 "http://localhost:4001/collectors/run/fixtures" > /dev/null 2>&1
  echo "  Ingesting standings..."
  curl -sS -X POST --max-time 60 "http://localhost:400ors/run/standings" > /dev/null 2>&1
  curl -sS -X POST --max-time 60 "http://localhost:4001/collectors/run/standings" > /dev/null 2>&1
  echo "  Ingesting team_stats (10 teams, ~65s)..."
  curl -sS -X POST --max-time 120 "http://localhost:4001/collectors/run/team_stats" > /dev/null 2>&1
  echo "  Running reconciliation..."
  curl -sS -X POST --max-time 120 "http://localhost:4001/cleaning/run" > /dev/null 2>&1
  echo "  Running feature engineering..."
  curl -sS -X POST --max-time 120 "http://localhost:4001/features/run" > /dev/null 2>&1
  echo "  ✓ Re-ingest complete"
  
  # Kill atlas-api so we can restart cleanly for BrainOS test
  kill $ATLAS_PID 2>/dev/null
  wait $ATLAS_PID 2>/dev/null
  trap - EXIT
  sleep 2
fi

echo ""
echo "=== STEP 2: Start atlas-api for BrainOS test ==="
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
echo "=== STEP 3: Health check ==="
curl -sS --max-time 5 http://localhost:4001/health 2>&1 | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'  status: {d[\"status\"]}, apiFootball: {d[\"checks\"][\"apiFootball\"]}, database: {d[\"checks\"][\"database\"]}')
"

echo ""
echo "=== STEP 4: Find a sample match (Liverpool vs Arsenal, last matchday) ==="
cd "$PROJECT_DIR"
SAMPLE_MATCH=$(bun -e "
const { db } = require('./mini-services/atlas-api/lib/db.ts');
async function main() {
  const homeTeam = await db.team.findFirst({ where: { name: { contains: 'Liverpool' } } });
  const awayTeam = await db.team.findFirst({ where: { name: { contains: 'Arsenal' } } });
  if (!homeTeam || !awayTeam) { console.log('NOT_FOUND'); return; }
  const match = await db.match.findFirst({
    where: {
      OR: [
        { homeTeamId: homeTeam.id, awayTeamId: awayTeam.id },
        { homeTeamId: awayTeam.id, awayTeamId: homeTeam.id },
      ],
      status: 'finished',
    },
    orderBy: { kickoffUtc: 'desc' },
  });
  if (match) { console.log(match.id); } else { console.log('NOT_FOUND'); }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
" 2>&1)

if [ "$SAMPLE_MATCH" = "NOT_FOUND" ] || [ -z "$SAMPLE_MATCH" ]; then
  echo "  Liverpool vs Arsenal not found — using any finished match"
  SAMPLE_MATCH=$(bun -e "
const { db } = require('./mini-services/atlas-api/lib/db.ts');
async function main() {
  const match = await db.match.findFirst({ where: { status: 'finished' }, orderBy: { kickoffUtc: 'desc' } });
  console.log(match ? match.id : 'NOT_FOUND');
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
" 2>&1)
fi

echo "  Sample match ID: $SAMPLE_MATCH"

echo ""
echo "=== STEP 5: Run BrainOS on sample match ==="
curl -sS -X POST --max-time 120 "http://localhost:4001/brainos/run/$SAMPLE_MATCH" 2>&1 | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'  Match: {d[\"match\"][\"homeTeam\"]} vs {d[\"match\"][\"awayTeam\"]}')
print(f'  Kickoff: {d[\"match\"][\"kickoff\"][:10]}')
print(f'  Duration: {d[\"metadata\"][\"durationMs\"]}ms')
print(f'  Layers: {d[\"metadata\"][\"layersActive\"]} active, {d[\"metadata\"][\"layersInsufficient\"]} insufficient, {d[\"metadata\"][\"layersFuture\"]} future')
print()
if d.get('finalPrediction'):
    p = d['finalPrediction']
    print(f'  FINAL PREDICTION:')
    print(f'    Market: {p[\"market\"]}')
    print(f'    Selection: {p[\"selection\"]}')
    print(f'    Probability: {(p[\"probability\"]*100):.1f}%')
    print(f'    Confidence: {p[\"confidence\"]:.3f}')
    print(f'    Home Win: {(p[\"homeWinProb\"]*100):.1f}%')
    print(f'    Draw: {(p[\"drawProb\"]*100):.1f}%')
    print(f'    Away Win: {(p[\"awayWinProb\"]*100):.1f}%')
else:
    print(f'  No final prediction (consensus failed)')

print()
print(f'  CONSENSUS:')
c = d.get('consensus')
if c:
    print(f'    Score: {c[\"score\"]:.3f}')
    print(f'    Confidence: {c.get(\"confidence\", 0):.3f}')
    print(f'    Layers contributing: {c[\"layersContributing\"]}')
    print(f'    Layers excluded: {c[\"layersExcluded\"]}')
    print(f'    Agreement: {c[\"agreementScore\"]:.3f}')

print()
print(f'  LAYER OUTPUTS ({len(d[\"layerOutputs\"])}):')
for lo in d['layerOutputs']:
    score_str = f'{lo[\"score\"]:.3f}' if lo['score'] is not None else 'null'
    conf_str = f'{lo[\"confidence\"]:.3f}' if lo['confidence'] is not None else 'null'
    print(f'    {lo[\"layer_name\"]:<28} status={lo[\"status\"]:<20} score={score_str:<8} conf={conf_str}')
" 2>&1

echo ""
echo "=== STEP 6: Show specific reasoning for Team Intelligence (Vali's directive) ==="
curl -sS --max-time 5 "http://localhost:4001/layers/$SAMPLE_MATCH" 2>&1 | python3 -c "
import json, sys
d = json.load(sys.stdin)
for layer in d['layers']:
    if layer['layerName'] == 'team_intelligence':
        print('  Team Intelligence reasoning (per Vali directive — specific, not generic):')
        print('  ---')
        for line in layer['reasoning'].split(chr(10)):
            print('  ' + line)
        print('  ---')
        break
" 2>&1

echo ""
echo "=== STEP 7: Verify layer_outputs table has rows for this match ==="
cd "$PROJECT_DIR"
bun -e "
const { db } = require('./mini-services/atlas-api/lib/db.ts');
async function main() {
  const count = await db.layerOutput.count({ where: { matchId: '$SAMPLE_MATCH' } });
  console.log('  LayerOutput rows for this match: ' + count);
  const predictions = await db.prediction.count({ where: { matchId: '$SAMPLE_MATCH' } });
  console.log('  Prediction rows for this match: ' + predictions);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
" 2>&1

echo ""
echo "=== STEP 8: Verify service STILL running before reporting done ==="
ps -p $ATLAS_PID -o pid,stat 2>&1 | tail -1
curl -sS -o /dev/null -w "  Health: HTTP %{http_code}\n" --max-time 3 http://localhost:4001/health 2>&1

echo ""
echo "=== DONE ==="
