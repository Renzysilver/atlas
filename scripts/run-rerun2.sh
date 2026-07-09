#!/bin/bash
# ATLAS Module 1 — Focused re-run of team_stats + player_stats + injuries
# (fixtures + standings already ingested successfully in previous run)
# Rate limiter now enforces 3s between API calls to avoid HTTP 429.

set -e

PROJECT_DIR="/home/z/my-project"
API_DIR="$PROJECT_DIR/mini-services/atlas-api"
LOG_FILE="/tmp/atlas-api-rerun2.log"

echo "=== Waiting 30s for API-Football rate limit to reset ==="
sleep 30

echo ""
echo "=== Start atlas-api ==="
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
echo "=== STEP 1: Run team_stats collector (10 API calls, ~30s with rate limiter) ==="
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
echo "=== STEP 2: Run player_stats collector (3 API calls, ~9s with rate limiter) ==="
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
echo "=== STEP 3: Run injuries collector (1 API call, ~3s with rate limiter) ==="
curl -sS -X POST --max-time 120 "http://localhost:4001/collectors/run/injuries" 2>&1 | python3 -c "
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
echo "=== STEP 4: Run referees collector (STUB) ==="
curl -sS -X POST --max-time 30 "http://localhost:4001/collectors/run/referees" 2>&1 | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'  status:          {d[\"status\"]}')
if d.get('error'):
    print(f'  error: {d[\"error\"][:200]}')
"

echo ""
echo "=== STEP 5: FINAL DB TABLES ==="
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
echo "=== STEP 6: Sample data — top 5 teams by standings position ==="
# Query the DB directly for standings + team names
cd "$PROJECT_DIR"
bun -e "
const { db } = require('./mini-services/atlas-api/lib/db.ts');
async function main() {
  const standings = await db.standing.findMany({
    where: { season: 2024 },
    include: { team: true },
    orderBy: { position: 'asc' },
    take: 5,
  });
  console.log('  Pos  Team                    P   W   D   L   GF  GA  Pts  Form');
  console.log('  ---  ----                    -   -   -   -   --  --  ---  ----');
  for (const s of standings) {
    console.log(
      '  ' + String(s.position).padStart(2) +
      '   ' + (s.team.name || '').padEnd(24) +
      String(s.played).padStart(2) + '  ' +
      String(s.won).padStart(2) + '  ' +
      String(s.drawn).padStart(2) + '  ' +
      String(s.lost).padStart(2) + '  ' +
      String(s.goalsFor).padStart(2) + '  ' +
      String(s.goalsAgainst).padStart(2) + '  ' +
      String(s.points).padStart(3) + '  ' +
      (s.form || '—')
    );
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
" 2>&1

echo ""
echo "=== STEP 7: Sample data — last 5 finished matches ==="
bun -e "
const { db } = require('./mini-services/atlas-api/lib/db.ts');
async function main() {
  const matches = await db.match.findMany({
    where: { status: 'finished' },
    include: { homeTeam: true, awayTeam: true },
    orderBy: { kickoffUtc: 'desc' },
    take: 5,
  });
  console.log('  Date           Home                  Score  Away');
  console.log('  ----           ----                  -----  ----');
  for (const m of matches) {
    const date = m.kickoffUtc.toISOString().slice(0,10);
    console.log(
      '  ' + date + '  ' +
      (m.homeTeam.name || '').padEnd(20) + '  ' +
      m.homeScore + '-' + m.awayScore + '  ' +
      (m.awayTeam.name || '').padEnd(20)
    );
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
" 2>&1

echo ""
echo "=== STEP 8: Sample data — injury summary ==="
bun -e "
const { db } = require('./mini-services/atlas-api/lib/db.ts');
async function main() {
  const total = await db.injury.count();
  console.log('  Total injury records: ' + total);
  if (total > 0) {
    const byType = await db.injury.groupBy({
      by: ['type'],
      _count: true,
      orderBy: { _count: { type: 'desc' } },
    });
    console.log('  By type:');
    for (const t of byType) {
      console.log('    ' + (t.type || 'Unknown').padEnd(25) + t._count.type);
    }
    const byReason = await db.injury.groupBy({
      by: ['reason'],
      _count: true,
      orderBy: { _count: { reason: 'desc' } },
      take: 5,
    });
    console.log('  Top 5 reasons:');
    for (const r of byReason) {
      console.log('    ' + (r.reason || 'Unknown').padEnd(35) + r._count.reason);
    }
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
" 2>&1

echo ""
echo "=== DONE ==="
