#!/bin/bash
# ATLAS Module 7 — Run BrainOS + verify risk fields
set -e

PROJECT_DIR="/home/z/my-project"
API_DIR="$PROJECT_DIR/mini-services/atlas-api"

# Restore .env if truncated
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
GROQ_API_KEY=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
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
fi

echo "=== Start atlas-api + run BrainOS with Module 7 ==="
cd "$API_DIR"
bun --env-file=../../.env index.ts > /tmp/atlas-module7.log 2>&1 &
ATLAS_PID=$!
trap "kill $ATLAS_PID 2>/dev/null; wait $ATLAS_PID 2>/dev/null" EXIT

for i in $(seq 1 15); do
  if curl -sS -o /dev/null --max-time 2 http://localhost:4001/health 2>/dev/null; then
    echo "  ✓ atlas-api ready"
    break
  fi
  sleep 1
done

echo ""
echo "=== Run BrainOS on Liverpool vs Arsenal ==="
curl -sS -X POST --max-time 120 "http://localhost:4001/brainos/run/cmrdjr5qm0143pu7ybo897tzu" 2>&1 | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'  Match: {d[\"match\"][\"homeTeam\"]} vs {d[\"match\"][\"awayTeam\"]}')
print(f'  Duration: {d[\"metadata\"][\"durationMs\"]}ms')
print(f'  BrainOS version: {d[\"metadata\"][\"brainosVersion\"]}')
print()

ra = d.get('riskAssessment')
if ra:
    print(f'  === RISK ASSESSMENT (Module 7) ===')
    print(f'  Confidence:    {ra[\"confidence\"]:.3f}')
    print(f'  Risk Score:    {ra[\"riskScore\"]:.3f}')
    print(f'  Volatility:    {ra[\"volatility\"]:.3f}')
    print(f'  Value Score:   {ra[\"valueScore\"]} (null — needs Market Intelligence)')
    print(f'  Recommendation: {ra[\"recommendationProfile\"]}')
    print()
    print(f'  Per-market risk:')
    for mr in ra['perMarketRisk']:
        print(f'    {mr[\"marketType\"]}: risk={mr[\"riskScore\"]:.3f}, vol={mr[\"volatility\"]:.3f}, profile={mr[\"recommendationProfile\"]}')
else:
    print('  ⚠ No risk assessment in FMI')
"

echo ""
echo "=== Verify risk fields persisted to DB ==="
cd "$PROJECT_DIR"
bun -e "
const { db } = require('./mini-services/atlas-api/lib/db.ts');
async function main() {
  const predictions = await db.prediction.findMany({
    where: { matchId: 'cmrdjr5qm0143pu7ybo897tzu' },
    orderBy: { marketType: 'asc' },
  });
  console.log('  Predictions with risk fields:');
  for (const p of predictions) {
    console.log('    ' + p.marketType + ':');
    console.log('      riskScore: ' + p.riskScore);
    console.log('      volatility: ' + p.volatility);
    console.log('      valueScore: ' + p.valueScore + ' (null — needs Market Intelligence)');
    console.log('      recommendationProfile: ' + p.recommendationProfile);
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
" 2>&1

echo ""
echo "=== /risk endpoint via Caddy ==="
curl -sS --max-time 5 "http://localhost:81/risk/cmrdjr5qm0143pu7ybo897tzu?XTransformPort=4001" 2>&1 | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'  Match: {d[\"match\"][\"homeTeam\"]} vs {d[\"match\"][\"awayTeam\"]}')
ra = d['riskAssessment']
print(f'  Value Score enabled: {ra[\"valueScoreEnabled\"]}')
print(f'  Value Score reason: {ra[\"valueScoreReason\"][:100]}...')
print(f'  Per-market risk ({len(ra[\"perMarketRisk\"])} markets):')
for mr in ra['perMarketRisk']:
    print(f'    {mr[\"marketType\"]}: risk={mr[\"riskScore\"]:.3f}, vol={mr[\"volatility\"]:.3f}, profile={mr[\"recommendationProfile\"]}')
" 2>&1

echo ""
echo "=== Lint check ==="
cd "$PROJECT_DIR"
bun run lint 2>&1 | tail -3
