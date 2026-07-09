#!/bin/bash
# ATLAS Module 2 — Full ingestion + reconciliation runner
# Re-ingests 2024 EPL data with Module 2 cleaning library applied,
# then runs reconciliation to verify cleaning works end-to-end.

set -e

PROJECT_DIR="/home/z/my-project"
API_DIR="$PROJECT_DIR/mini-services/atlas-api"
LOG_FILE="/tmp/atlas-module2.log"

echo "=== STEP 0: Verify clean DB ==="
cd "$PROJECT_DIR"
bun -e "
const { db } = require('./mini-services/atlas-api/lib/db.ts');
async function main() {
  const counts = {
    teams: await db.team.count(),
    matches: await db.match.count(),
    standings: await db.standing.count(),
    injuries: await db.injury.count(),
  };
  console.log('  Current DB state:', JSON.stringify(counts));
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
" 2>&1

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
echo "=== STEP 2: Run fixtures collector (380 matches) ==="
curl -sS -X POST --max-time 120 "http://localhost:4001/collectors/run/fixtures" 2>&1 | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'  status: {d[\"status\"]}, ingested: {d[\"recordsIngested\"]}, skipped: {d[\"recordsSkipped\"]}, duration: {d[\"durationMs\"]}ms')
"

echo ""
echo "=== STEP 3: Run standings collector (20 teams) ==="
curl -sS -X POST --max-time 60 "http://localhost:4001/collectors/run/standings" 2>&1 | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'  status: {d[\"status\"]}, ingested: {d[\"recordsIngested\"]}, duration: {d[\"durationMs\"]}ms')
"

echo ""
echo "=== STEP 4: Run team_stats collector (10 teams, ~65s with rate limiter) ==="
curl -sS -X POST --max-time 120 "http://localhost:4001/collectors/run/team_stats" 2>&1 | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'  status: {d[\"status\"]}, ingested: {d[\"recordsIngested\"]}, skipped: {d[\"recordsSkipped\"]}, duration: {d[\"durationMs\"]}ms')
"

echo ""
echo "=== STEP 5: Run player_stats collector (3 teams, ~20s) ==="
curl -sS -X POST --max-time 120 "http://localhost:4001/collectors/run/player_stats" 2>&1 | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'  status: {d[\"status\"]}, ingested: {d[\"recordsIngested\"]}, skipped: {d[\"recordsSkipped\"]}, duration: {d[\"durationMs\"]}ms')
"

echo ""
echo "=== STEP 6: Run injuries collector (1 API call, ~7s) ==="
curl -sS -X POST --max-time 120 "http://localhost:4001/collectors/run/injuries" 2>&1 | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'  status: {d[\"status\"]}, ingested: {d[\"recordsIngested\"]}, duration: {d[\"durationMs\"]}ms')
"

echo ""
echo "=== STEP 7: DB state after ingestion ==="
curl -sS --max-time 10 "http://localhost:4001/stats" 2>&1 | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'{\"table\":<20} {\"rows\":>8}')
print(f'{\"-\"*20} {\"-\"*8}')
for t in d['tables']:
    print(f'{t[\"name\"]:<20} {t[\"rowCount\"]:>8}')
print()
print(f'API-Football quota: {d[\"apiQuota\"][\"apiFootball\"][\"used\"]} / {d[\"apiQuota\"][\"apiFootball\"][\"limit\"]} used')
"

echo ""
echo "=== STEP 8: Run reconciliation job (Module 2 core) ==="
curl -sS -X POST --max-time 120 "http://localhost:4001/cleaning/run" 2>&1 | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'  status:               {d[\"status\"]}')
print(f'  durationMs:           {d[\"durationMs\"]}')
print(f'  totalRecordsAudited:  {d[\"totalRecordsAudited\"]}')
print(f'  duplicateFixtures:    {d[\"duplicateFixtures\"]}')
print(f'  htmlEntityNames:      {d[\"htmlEntityNames\"]}')
print(f'  zeroFilledStats:      {d[\"zeroFilledStats\"]}')
print(f'  orphanedForeignKeys:  {d[\"orphanedForeignKeys\"]}')
print(f'  missingSourceConf:    {d[\"missingSourceConfidence\"]}')
print(f'  invalidTimestamps:    {d[\"invalidTimestamps\"]}')
print(f'  --- Actions taken ---')
print(f'  namesDecoded:         {d[\"namesDecoded\"]}')
print(f'  zeroFilledToNull:     {d[\"zeroFilledToNull\"]}')
print(f'  cleanSheetsDerived:   {d[\"cleanSheetsDerived\"]}')
print(f'  sampleIssues count:   {len(d[\"sampleIssues\"])}')
if d['sampleIssues']:
    print(f'  --- First 5 sample issues ---')
    for issue in d['sampleIssues'][:5]:
        print(f'    [{issue[\"table\"]}] {issue[\"issue\"]}: {issue[\"message\"][:100]}')
"

echo ""
echo "=== STEP 9: Verify HTML entities are gone from player names ==="
cd "$PROJECT_DIR"
bun -e "
const { db } = require('./mini-services/atlas-api/lib/db.ts');
async function main() {
  // Check for any remaining HTML entities in player names
  const players = await db.player.findMany({ select: { name: true } });
  const htmlEntityRegex = /&[a-zA-Z]+;|&#\d+;|&#x[0-9a-fA-F]+;/;
  const withEntities = players.filter(p => htmlEntityRegex.test(p.name));
  console.log('  Players with HTML entities remaining: ' + withEntities.length);
  if (withEntities.length > 0) {
    console.log('  Examples:');
    for (const p of withEntities.slice(0, 5)) {
      console.log('    ' + p.name);
    }
  } else {
    console.log('  ✓ All player names are clean (no HTML entities)');
  }

  // Show some sample names to verify
  console.log('');
  console.log('  Sample player names (first 10):');
  const sample = await db.player.findMany({ take: 10, select: { name: true } });
  for (const p of sample) {
    console.log('    ' + p.name);
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
" 2>&1

echo ""
echo "=== STEP 10: Verify clean sheets were derived ==="
cd "$PROJECT_DIR"
bun -e "
const { db } = require('./mini-services/atlas-api/lib/db.ts');
async function main() {
  const stats = await db.teamStat.findMany({
    where: { cleanSheetsDerived: { not: null } },
    include: { team: true },
    take: 5,
  });
  console.log('  Team stats with derived clean sheets:');
  for (const s of stats) {
    console.log(
      '    ' + (s.team.name || '').padEnd(24) +
      'cleanSheets(API): ' + String(s.cleanSheets).padStart(3) +
      '  cleanSheets(derived): ' + String(s.cleanSheetsDerived).padStart(3)
    );
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
" 2>&1

echo ""
echo "=== STEP 11: Final DB tables ==="
curl -sS --max-time 10 "http://localhost:4001/stats" 2>&1 | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'{\"table\":<20} {\"rows\":>8}  {\"last_updated\":<25}')
print(f'{\"-\"*20} {\"-\"*8}  {\"-\"*25}')
for t in d['tables']:
    lu = t['lastUpdated'][:19] if t['lastUpdated'] else '—'
    print(f'{t[\"name\"]:<20} {t[\"rowCount\"]:>8}  {lu:<25}')
print()
print(f'API-Football quota: {d[\"apiQuota\"][\"apiFootball\"][\"used\"]} / {d[\"apiQuota\"][\"apiFootball\"][\"limit\"]} used')
"

echo ""
echo "=== DONE ==="
