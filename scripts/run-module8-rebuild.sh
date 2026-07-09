#!/bin/bash
# ATLAS Module 8 — Full rebuild + ingest + BrainOS + learning (single process tree)
set -e

PROJECT_DIR="/home/z/my-project"
API_DIR="$PROJECT_DIR/mini-services/atlas-api"
LOG_FILE="/tmp/atlas-module8-rebuild.log"

echo "=== Start atlas-api ==="
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

echo ""
echo "=== Ingest fixtures (380 matches) ==="
curl -sS -X POST --max-time 120 "http://localhost:4001/collectors/run/fixtures" 2>&1 | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'  {d[\"status\"]}: {d[\"recordsIngested\"]} ingested')"

echo "=== Ingest standings (20 teams) ==="
curl -sS -X POST --max-time 60 "http://localhost:4001/collectors/run/standings" 2>&1 | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'  {d[\"status\"]}: {d[\"recordsIngested\"]} ingested')"

echo "=== Ingest team_stats (10 teams, ~65s) ==="
curl -sS -X POST --max-time 120 "http://localhost:4001/collectors/run/team_stats" 2>&1 | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'  {d[\"status\"]}: {d[\"recordsIngested\"]} ingested')"

echo "=== Run reconciliation (derive clean sheets) ==="
curl -sS -X POST --max-time 60 "http://localhost:4001/cleaning/run" 2>&1 | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'  {d[\"status\"]}: {d[\"cleanSheetsDerived\"]} clean sheets derived')"

echo "=== Run feature engineering ==="
curl -sS -X POST --max-time 120 "http://localhost:4001/features/run" 2>&1 | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'  {d[\"status\"]}: {d[\"seasonFeaturesComputed\"]} season + {d[\"matchFeaturesComputed\"]} match features')"

echo ""
echo "=== Find Liverpool vs Arsenal match ==="
cd "$PROJECT_DIR"
SAMPLE_MATCH=$(bun -e "
const { db } = require('./mini-services/atlas-api/lib/db.ts');
async function main() {
  const home = await db.team.findFirst({ where: { name: { contains: 'Liverpool' } } });
  const away = await db.team.findFirst({ where: { name: { contains: 'Arsenal' } } });
  if (!home || !away) { console.log('NOT_FOUND'); return; }
  const m = await db.match.findFirst({ where: { homeTeamId: home.id, awayTeamId: away.id, status: 'finished' }, orderBy: { kickoffUtc: 'desc' } });
  console.log(m ? m.id : 'NOT_FOUND');
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
" 2>&1)
echo "  Match ID: $SAMPLE_MATCH"

echo ""
echo "=== Run BrainOS (Module 4-7: layers + consensus + decisions + risk + explainability) ==="
curl -sS -X POST --max-time 120 "http://localhost:4001/brainos/run/$SAMPLE_MATCH" 2>&1 | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'  Match: {d[\"match\"][\"homeTeam\"]} vs {d[\"match\"][\"awayTeam\"]}')
print(f'  Duration: {d[\"metadata\"][\"durationMs\"]}ms, version: {d[\"metadata\"][\"brainosVersion\"]}')
print(f'  Predictions: {len(d.get(\"marketPredictions\", []))} markets')
if d.get('riskAssessment'):
    ra = d['riskAssessment']
    print(f'  Risk: {ra[\"riskScore\"]:.3f}, Volatility: {ra[\"volatility\"]:.3f}, Profile: {ra[\"recommendationProfile\"]}')
"

echo ""
echo "=== Run results comparison (Module 8) ==="
curl -sS -X POST --max-time 60 "http://localhost:4001/learning/run-comparison" 2>&1 | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'  status: {d[\"status\"]}')
print(f'  matches: {d[\"matchesProcessed\"]}, predictions: {d[\"predictionsEvaluated\"]}, correct: {d[\"correctPredictions\"]}')
print(f'  layers evaluated: {d[\"layersEvaluated\"]}')
"

echo ""
echo "=== Run accuracy measurement (Module 8) ==="
curl -sS -X POST --max-time 60 "http://localhost:4001/learning/run-accuracy" 2>&1 | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'  status: {d[\"status\"]}')
print(f'  total: {d[\"totalPredictions\"]}, correct: {d[\"correctPredictions\"]}, accuracy: {d[\"overallAccuracy\"]}')
print(f'  best layer: {d[\"bestPerformingLayer\"]}')
print(f'  weakest layer: {d[\"weakestPerformingLayer\"]}')
print(f'  sample note: {d[\"sampleSizeNote\"]}')
print()
print('  Per-market:')
for m, s in d.get('perMarketAccuracy', {}).items():
    print(f'    {m}: {s[\"correct\"]}/{s[\"total\"]} = {s[\"accuracy\"]*100:.1f}%')
print('  Per-tier:')
for t, s in d.get('perTierAccuracy', {}).items():
    print(f'    {t}: {s[\"correct\"]}/{s[\"total\"]} = {s[\"accuracy\"]*100:.1f}%')
print('  Per-layer:')
for l, s in sorted(d.get('perLayerPerformance', {}).items(), key=lambda x: -x[1]['accuracy']):
    print(f'    {l}: {s[\"agreed\"]}/{s[\"evaluated\"]} = {s[\"accuracy\"]*100:.1f}%')
"

echo ""
echo "=== Lint check ==="
cd "$PROJECT_DIR"
bun run lint 2>&1 | tail -3

echo ""
echo "=== DONE ==="
