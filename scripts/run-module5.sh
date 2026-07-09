#!/bin/bash
# ATLAS Module 5 — Run BrainOS + verify 3 market predictions
set -e

PROJECT_DIR="/home/z/my-project"
API_DIR="$PROJECT_DIR/mini-services/atlas-api"
LOG_FILE="/tmp/atlas-module5.log"

echo "=== STEP 0: Restore .env if truncated ==="
if ! grep -q "^API_FOOTBALL_KEY=0093" "$PROJECT_DIR/.env"; then
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
  echo "  .env restored"
else
  echo "  .env intact"
fi

echo ""
echo "=== STEP 1: Check DB has data ==="
cd "$PROJECT_DIR"
bun -e "
const { db } = require('./mini-services/atlas-api/lib/db.ts');
async function main() {
  const counts = { teams: await db.team.count(), matches: await db.match.count(), team_features: await db.teamFeature.count() };
  console.log('  DB:', JSON.stringify(counts));
  if (counts.matches === 0 || counts.team_features === 0) { process.exit(1); }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
" 2>&1 || {
  echo "  DB missing data — need re-ingest first"
  # Quick re-ingest if needed
  cd "$API_DIR"
  bun --env-file=../../.env index.ts > "$LOG_FILE" 2>&1 &
  ATLAS_PID=$!
  trap "kill $ATLAS_PID 2>/dev/null; wait $ATLAS_PID 2>/dev/null" EXIT
  for i in $(seq 1 15); do
    curl -sS -o /dev/null --max-time 2 http://localhost:4001/health 2>/dev/null && break
    sleep 1
  done
  echo "  Re-ingesting fixtures..."
  curl -sS -X POST --max-time 120 "http://localhost:4001/collectors/run/fixtures" > /dev/null 2>&1
  echo "  Re-ingesting standings..."
  curl -sS -X POST --max-time 60 "http://localhost:4001/collectors/run/standings" > /dev/null 2>&1
  echo "  Running team_stats (65s)..."
  curl -sS -X POST --max-time 120 "http://localhost:4001/collectors/run/team_stats" > /dev/null 2>&1
  echo "  Running reconciliation..."
  curl -sS -X POST --max-time 120 "http://localhost:4001/cleaning/run" > /dev/null 2>&1
  echo "  Running feature engineering..."
  curl -sS -X POST --max-time 120 "http://localhost:4001/features/run" > /dev/null 2>&1
  echo "  ✓ Re-ingest complete"
  kill $ATLAS_PID 2>/dev/null
  wait $ATLAS_PID 2>/dev/null
  trap - EXIT
  sleep 2
}

echo ""
echo "=== STEP 2: Start atlas-api ==="
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
print(f'  status: {d[\"status\"]}, apiFootball: {d[\"checks\"][\"apiFootball\"]}')
"

echo ""
echo "=== STEP 4: Find sample match (Liverpool vs Arsenal) ==="
cd "$PROJECT_DIR"
SAMPLE_MATCH=$(bun -e "
const { db } = require('./mini-services/atlas-api/lib/db.ts');
async function main() {
  const homeTeam = await db.team.findFirst({ where: { name: { contains: 'Liverpool' } } });
  const awayTeam = await db.team.findFirst({ where: { name: { contains: 'Arsenal' } } });
  if (!homeTeam || !awayTeam) { console.log('NOT_FOUND'); return; }
  const match = await db.match.findFirst({
    where: { homeTeamId: homeTeam.id, awayTeamId: awayTeam.id, status: 'finished' },
    orderBy: { kickoffUtc: 'desc' },
  });
  console.log(match ? match.id : 'NOT_FOUND');
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
" 2>&1)
echo "  Sample match ID: $SAMPLE_MATCH"

echo ""
echo "=== STEP 5: Run BrainOS (includes Module 5 Decision Engine) ==="
curl -sS -X POST --max-time 120 "http://localhost:4001/brainos/run/$SAMPLE_MATCH" 2>&1 | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'  Match: {d[\"match\"][\"homeTeam\"]} vs {d[\"match\"][\"awayTeam\"]}')
print(f'  Duration: {d[\"metadata\"][\"durationMs\"]}ms')
print(f'  BrainOS version: {d[\"metadata\"][\"brainosVersion\"]}')
print()

print(f'  === MARKET PREDICTIONS (Module 5 — Decision Engine) ===')
for mp in d.get('marketPredictions', []):
    print(f'  {mp[\"marketType\"]}:')
    print(f'    Selection: {mp[\"selection\"]}')
    print(f'    Probability: {(mp[\"probability\"]*100):.1f}%')
    print(f'    Confidence: {mp[\"confidence\"]:.3f}')
    print(f'    Recommendation: {mp[\"recommendationProfile\"]}')
    print(f'    Value Score: {mp[\"valueScore\"]} (null — needs Market Intelligence)')
    print()

print(f'  === CONSENSUS ===')
c = d.get('consensus')
if c:
    print(f'  Score: {c[\"score\"]:.3f}, Confidence: {c.get(\"confidence\",0):.3f}')
    print(f'  Home: {c[\"homeWinProbability\"]*100:.1f}%, Draw: {c[\"drawProbability\"]*100:.1f}%, Away: {c[\"awayWinProbability\"]*100:.1f}%')
    print(f'  Layers: {c[\"layersContributing\"]} contributing, {c[\"layersExcluded\"]} excluded, agreement {c[\"agreementScore\"]:.3f}')
" 2>&1

echo ""
echo "=== STEP 6: Verify 3 Prediction rows in DB ==="
cd "$PROJECT_DIR"
bun -e "
const { db } = require('./mini-services/atlas-api/lib/db.ts');
async function main() {
  const matchId = '$SAMPLE_MATCH';
  const predictions = await db.prediction.findMany({ where: { matchId }, orderBy: { marketType: 'asc' } });
  console.log('  Prediction rows for this match:', predictions.length);
  for (const p of predictions) {
    console.log('    ' + p.marketType + ': ' + p.selection + ' (' + (p.probability*100).toFixed(1) + '%) — ' + p.recommendationProfile + ' [conf: ' + p.confidence.toFixed(3) + ']');
  }
  
  // Total predictions across all matches
  const total = await db.prediction.count();
  console.log('  Total predictions in DB:', total);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
" 2>&1

echo ""
echo "=== STEP 7: Show Decision Engine reasoning for O/U 2.5 ==="
cd "$PROJECT_DIR"
bun -e "
const { db } = require('./mini-services/atlas-api/lib/db.ts');
async function main() {
  const matchId = '$SAMPLE_MATCH';
  const pred = await db.prediction.findFirst({ where: { matchId, marketType: 'O_U_2_5' } });
  if (pred && pred.consensusInputsJson) {
    const data = JSON.parse(pred.consensusInputsJson);
    console.log('  O/U 2.5 market reasoning:');
    console.log('  ---');
    for (const line of (data.marketReasoning || '').split('\n')) {
      console.log('  ' + line);
    }
    console.log('  ---');
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
" 2>&1

echo ""
echo "=== STEP 8: Lint check ==="
cd "$PROJECT_DIR"
bun run lint 2>&1 | tail -3

echo ""
echo "=== DONE ==="
