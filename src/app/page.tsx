/**
 * ATLAS Dashboard — Module 1 (Data Collection) view.
 *
 * This is the only route per sandbox constraint. It calls the atlas-api
 * mini-service via the Caddy gateway using `?XTransformPort=4001`.
 *
 * Phase 1, Module 1 status: collector grid + DB stats + recent runs.
 * Future modules will extend this with layer outputs, predictions, learning reports.
 */

'use client'

import { useEffect, useState, useCallback } from 'react'
import { Plus, Activity, Database, RefreshCw, AlertTriangle, CheckCircle2, CircleDot, Clock, Ban } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'

const ATLAS_API_PORT = process.env.NEXT_PUBLIC_ATLAS_API_PORT || '4001'

// ============================================================
// Types (mirror @atlas/shared — duplicated here to avoid workspace
// import issues in the Next.js client bundle)
// ============================================================
interface CollectorDefinition {
  name: string
  description: string
  status: 'active' | 'stub' | 'future'
  feedsLayer?: string
  schedule?: string
  stubReason?: string
}

interface CollectorRunResult {
  collectorName: string
  status: 'success' | 'failed' | 'insufficient_data'
  recordsIngested: number
  recordsUpdated: number
  recordsSkipped: number
  error?: string
  startedAt: string
  finishedAt: string
  durationMs: number
}

interface CollectorStatusResponse {
  collectors: CollectorDefinition[]
  recentRuns: CollectorRunResult[]
}

interface HealthResponse {
  status: 'ok' | 'degraded' | 'down'
  service: string
  version: string
  timestamp: string
  checks: {
    database: 'ok' | 'fail'
    queue: 'ok' | 'fail'
    apiFootball: 'ok' | 'unconfigured' | 'fail'
    groq: 'ok' | 'unconfigured' | 'fail'
  }
  uptime: number
}

interface DatabaseStatsResponse {
  tables: Array<{ name: string; rowCount: number; lastUpdated: string | null }>
  apiQuota: {
    apiFootball: { used: number; limit: number; resetAt: string | null }
    groq: { used: number; limit: number }
  }
}

// Module 2 — Cleaning & Validation types
interface CleaningReport {
  id: string
  runAt: string
  status: 'success' | 'partial' | 'failed'
  durationMs: number
  totalRecordsAudited: number
  duplicateFixtures: number
  missingSourceConfidence: number
  nullStats: number
  zeroFilledStats: number
  htmlEntityNames: number
  orphanedForeignKeys: number
  invalidTimestamps: number
  tableReports: Record<string, { rows: number; issues: number }>
  sampleIssues: Array<{ table: string; field: string; issue: string; recordId: string; message: string }>
  namesDecoded: number
  namesNormalized: number
  zeroFilledToNull: number
  cleanSheetsDerived: number
}

// Module 3 — Feature Engineering types
interface FeatureDefinition {
  name: string
  description: string
  level: 'season' | 'match'
  status: 'active' | 'stub'
}
interface FeatureRegistry {
  active: FeatureDefinition[]
  stub: FeatureDefinition[]
  total: number
}
interface FeatureSummary {
  season: number
  teamFeatures: Record<string, number>
  matchFeatures: Record<string, number>
  registry: { active: number; stub: number; total: number }
}

// Module 4 — Intelligence Engine types
interface LayerDefinition {
  name: string
  layerNumber: number
  description: string
  buildStatus: 'active' | 'stub' | 'future'
  feedsConsensus: boolean
  weight: number
}
interface LayerStatusSummary {
  layers: LayerDefinition[]
  total: number
  active: number
  stub: number
  future: number
}
interface LayerOutput {
  layer_name: string
  status: 'active' | 'insufficient_data' | 'future'
  score: number | null
  confidence: number | null
  reasoning: string | null
}
interface FinalMatchIntelligence {
  matchId: string
  match: {
    homeTeam: string
    awayTeam: string
    kickoff: string
    venue: string | null
    season: number
  }
  layerOutputs: LayerOutput[]
  consensus: {
    score: number
    confidence: number | null
    homeWinProbability: number
    drawProbability: number
    awayWinProbability: number
    layersContributing: number
    layersExcluded: number
    agreementScore: number
  } | null
  marketPredictions: MarketPrediction[]
  riskAssessment: RiskAssessment | null
  finalPrediction: {
    market: string
    selection: string
    probability: number
    confidence: number
    homeWinProb: number
    drawProb: number
    awayWinProb: number
  } | null
  metadata: {
    computedAt: string
    durationMs: number
    layersActive: number
    layersInsufficient: number
    layersFuture: number
    brainosVersion: string
  }
}

// Module 5 — Decision Engine types
interface MarketPrediction {
  marketType: string
  selection: string
  probability: number
  confidence: number
  recommendationProfile: string | null
  reasoning: string
  valueScore: null
  riskScore: null
  volatility: null
}

// Module 7 — Risk Management types
interface RiskAssessment {
  matchId: string
  confidence: number
  riskScore: number
  volatility: number
  valueScore: null
  valueScoreReason: string
  recommendationProfile: string
  reasoning: string
  perMarketRisk: Array<{
    marketType: string
    selection: string
    probability: number
    confidence: number
    riskScore: number
    volatility: number
    recommendationProfile: string
  }>
}

// ============================================================
// API helpers — go through Caddy gateway via XTransformPort
// ============================================================
async function atlasFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${path}${path.includes('?') ? '&' : '?'}XTransformPort=${ATLAS_API_PORT}`
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}: ${body || res.statusText}`)
  }
  return res.json() as Promise<T>
}

// ============================================================
// Status pill helpers
// ============================================================
function StatusBadge({ status }: { status: CollectorDefinition['status'] }) {
  if (status === 'active') {
    return (
      <Badge variant="default" className="bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-100">
        <CheckCircle2 className="h-3 w-3 mr-1" /> ACTIVE
      </Badge>
    )
  }
  if (status === 'stub') {
    return (
      <Badge variant="secondary" className="bg-amber-100 text-amber-900 border-amber-200 hover:bg-amber-100">
        <CircleDot className="h-3 w-3 mr-1" /> STUB
      </Badge>
    )
  }
  return (
    <Badge variant="destructive">
      <Ban className="h-3 w-3 mr-1" /> FUTURE
    </Badge>
  )
}

function RunStatusBadge({ status }: { status: CollectorRunResult['status'] }) {
  if (status === 'success') {
    return <Badge className="bg-emerald-50 text-emerald-800 border-emerald-200">success</Badge>
  }
  if (status === 'insufficient_data') {
    return <Badge className="bg-amber-50 text-amber-800 border-amber-200">insufficient_data</Badge>
  }
  return <Badge variant="destructive">failed</Badge>
}

function CheckPill({ label, state }: { label: string; state: 'ok' | 'fail' | 'unconfigured' }) {
  const color =
    state === 'ok'
      ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
      : state === 'unconfigured'
        ? 'bg-amber-100 text-amber-900 border-amber-200'
        : 'bg-red-100 text-red-800 border-red-200'
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${color}`}>
      {state === 'ok' ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
      {label}: {state}
    </span>
  )
}

// ============================================================
// Main Page
// ============================================================
export default function Home() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [collectors, setCollectors] = useState<CollectorStatusResponse | null>(null)
  const [stats, setStats] = useState<DatabaseStatsResponse | null>(null)
  const [cleaningReport, setCleaningReport] = useState<CleaningReport | null>(null)
  const [featureRegistry, setFeatureRegistry] = useState<FeatureRegistry | null>(null)
  const [featureSummary, setFeatureSummary] = useState<FeatureSummary | null>(null)
  const [layerStatus, setLayerStatus] = useState<LayerStatusSummary | null>(null)
  const [latestFmi, setLatestFmi] = useState<FinalMatchIntelligence | null>(null)
  const [loading, setLoading] = useState(false)
  const [triggeringCollector, setTriggeringCollector] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [h, c, s, cr, fr, fs, ls] = await Promise.all([
        atlasFetch<HealthResponse>('/health'),
        atlasFetch<CollectorStatusResponse>('/collectors'),
        atlasFetch<DatabaseStatsResponse>('/stats'),
        atlasFetch<CleaningReport | null>('/cleaning/report').catch(() => null),
        atlasFetch<FeatureRegistry>('/features/registry').catch(() => null),
        atlasFetch<FeatureSummary>('/features').catch(() => null),
        atlasFetch<LayerStatusSummary>('/layers').catch(() => null),
      ])
      setHealth(h)
      setCollectors(c)
      setStats(s)
      setCleaningReport(cr)
      setFeatureRegistry(fr)
      setFeatureSummary(fs)
      setLayerStatus(ls)
      setLastRefresh(new Date())
    } catch (err) {
      toast.error('Failed to refresh ATLAS data', {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 15_000) // auto-refresh every 15s
    return () => clearInterval(id)
  }, [refresh])

  const triggerCollector = async (name: string) => {
    setTriggeringCollector(name)
    try {
      const result = await atlasFetch<CollectorRunResult>(`/collectors/run/${name}`, {
        method: 'POST',
      })
      if (result.status === 'success') {
        toast.success(`${name}: ${result.recordsIngested} ingested, ${result.recordsUpdated} updated`)
      } else if (result.status === 'insufficient_data') {
        toast.info(`${name}: insufficient_data`, {
          description: result.error,
        })
      } else {
        toast.error(`${name} failed`, { description: result.error })
      }
      await refresh()
    } catch (err) {
      toast.error(`Failed to trigger ${name}`, {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setTriggeringCollector(null)
    }
  }

  const triggerAllActive = async () => {
    setTriggeringCollector('__all__')
    try {
      const result = await atlasFetch<{ triggered: number; results: CollectorRunResult[] }>(
        '/collectors/run-all-active',
        { method: 'POST' },
      )
      const ok = result.results.filter((r) => r.status === 'success').length
      const insuf = result.results.filter((r) => r.status === 'insufficient_data').length
      const fail = result.results.filter((r) => r.status === 'failed').length
      toast.success(`Ran ${result.triggered} collectors`, {
        description: `${ok} success · ${insuf} insufficient_data · ${fail} failed`,
      })
      await refresh()
    } catch (err) {
      toast.error('Run-all failed', { description: err instanceof Error ? err.message : String(err) })
    } finally {
      setTriggeringCollector(null)
    }
  }

  const triggerReconciliation = async () => {
    setTriggeringCollector('__recon__')
    try {
      const result = await atlasFetch<CleaningReport>('/cleaning/run', { method: 'POST' })
      if (result.status === 'success') {
        toast.success('Reconciliation completed', {
          description: `${result.totalRecordsAudited} records audited · ${result.cleanSheetsDerived} clean sheets derived · ${result.namesDecoded} names decoded`,
        })
      } else if (result.status === 'partial') {
        toast.info('Reconciliation completed (partial)', {
          description: `${result.zeroFilledStats} zero-filled stats found · ${result.htmlEntityNames} HTML entity names fixed`,
        })
      } else {
        toast.error('Reconciliation failed')
      }
      await refresh()
    } catch (err) {
      toast.error('Reconciliation failed', { description: err instanceof Error ? err.message : String(err) })
    } finally {
      setTriggeringCollector(null)
    }
  }

  const triggerFeatureEngineering = async () => {
    setTriggeringCollector('__features__')
    try {
      const result = await atlasFetch<{
        status: string
        durationMs: number
        teamsProcessed: number
        matchesProcessed: number
        seasonFeaturesComputed: number
        matchFeaturesComputed: number
        stubFeaturesCreated: number
        insufficientDataCount: number
        errors: string[]
      }>('/features/run', { method: 'POST' })
      if (result.status === 'success') {
        toast.success('Feature engineering completed', {
          description: `${result.teamsProcessed} teams · ${result.matchesProcessed} matches · ${result.seasonFeaturesComputed} season features · ${result.matchFeaturesComputed} match features`,
        })
      } else if (result.status === 'partial') {
        toast.info('Feature engineering completed (partial)', {
          description: `${result.errors.length} errors · ${result.insufficientDataCount} insufficient_data`,
        })
      } else {
        toast.error('Feature engineering failed')
      }
      await refresh()
    } catch (err) {
      toast.error('Feature engineering failed', { description: err instanceof Error ? err.message : String(err) })
    } finally {
      setTriggeringCollector(null)
    }
  }

  const runBrainOS = async (matchId: string) => {
    setTriggeringCollector(`__brainos_${matchId}__`)
    try {
      const fmi = await atlasFetch<FinalMatchIntelligence>(`/brainos/run/${matchId}`, { method: 'POST' })
      setLatestFmi(fmi)
      if (fmi.finalPrediction) {
        toast.success('BrainOS prediction complete', {
          description: `${fmi.match.homeTeam} vs ${fmi.match.awayTeam}: ${fmi.finalPrediction.selection} (${(fmi.finalPrediction.probability * 100).toFixed(1)}%) — ${fmi.metadata.layersActive} active layers`,
        })
      } else {
        toast.info('BrainOS ran but no consensus', {
          description: `${fmi.metadata.layersActive} active, ${fmi.metadata.layersInsufficient} insufficient_data`,
        })
      }
      await refresh()
    } catch (err) {
      toast.error('BrainOS run failed', { description: err instanceof Error ? err.message : String(err) })
    } finally {
      setTriggeringCollector(null)
    }
  }

  // ============================================================
  // Render
  // ============================================================
  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <header className="border-b bg-white">
        <div className="container mx-auto px-4 py-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-bold tracking-tight text-stone-900">ATLAS</h1>
                <Badge variant="outline" className="text-xs">v1.0 · Phase 1</Badge>
                <Badge className="bg-stone-900 text-stone-50">Module 7 / 9 — Risk Management</Badge>
              </div>
              <p className="mt-1 text-sm text-stone-600">
                Institutional Football Intelligence Platform · English Premier League · Built per Master Build Prompt v1.0
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={refresh}
                disabled={loading}
              >
                <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              <Button
                size="sm"
                onClick={triggerAllActive}
                disabled={triggeringCollector === '__all__'}
              >
                {triggeringCollector === '__all__' ? (
                  <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4 mr-1" />
                )}
                Run all active
              </Button>
            </div>
          </div>
          {lastRefresh && (
            <p className="mt-2 text-xs text-stone-500">
              Last refreshed: {lastRefresh.toLocaleTimeString()} · auto-refresh every 15s
            </p>
          )}
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 space-y-6">
        {/* Health + Quota Strip */}
        <section className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Activity className="h-4 w-4" /> Service Health
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {health ? (
                <>
                  <div className="flex items-center gap-2">
                    <Badge
                      className={
                        health.status === 'ok'
                          ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                          : health.status === 'degraded'
                            ? 'bg-amber-100 text-amber-900 border-amber-200'
                            : 'bg-red-100 text-red-800 border-red-200'
                      }
                    >
                      {health.status.toUpperCase()}
                    </Badge>
                    <span className="text-xs text-stone-500">
                      up {Math.floor(health.uptime / 1000)}s · {health.version}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <CheckPill label="DB" state={health.checks.database} />
                    <CheckPill label="Queue" state={health.checks.queue} />
                    <CheckPill label="API-Football" state={health.checks.apiFootball} />
                    <CheckPill label="Groq" state={health.checks.groq} />
                  </div>
                </>
              ) : (
                <div className="text-xs text-stone-500">Loading…</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Database className="h-4 w-4" /> API-Football Quota
              </CardTitle>
              <CardDescription className="text-xs">
                Free tier — 100 requests/day hard cap
              </CardDescription>
            </CardHeader>
            <CardContent>
              {stats ? (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-stone-600">Used today</span>
                    <span className="font-mono">
                      {stats.apiQuota.apiFootball.used} / {stats.apiQuota.apiFootball.limit}
                    </span>
                  </div>
                  <Progress
                    value={(stats.apiQuota.apiFootball.used / stats.apiQuota.apiFootball.limit) * 100}
                    className="h-2"
                  />
                  <p className="text-xs text-stone-500">
                    Resets: {stats.apiQuota.apiFootball.resetAt
                      ? new Date(stats.apiQuota.apiFootball.resetAt).toLocaleString()
                      : 'unknown'}
                  </p>
                </div>
              ) : (
                <div className="text-xs text-stone-500">Loading…</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4" /> Build Status
              </CardTitle>
              <CardDescription className="text-xs">Per ATLAS spec Section 16</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1.5 text-xs">
              <div className="flex justify-between"><span className="text-stone-600">Module 1 — Data Collection</span><Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">done</Badge></div>
              <div className="flex justify-between"><span className="text-stone-600">Module 2 — Cleaning</span><Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">done</Badge></div>
              <div className="flex justify-between"><span className="text-stone-600">Module 3 — Features</span><Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">done</Badge></div>
              <div className="flex justify-between"><span className="text-stone-600">Module 4 — 17 Layers</span><Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">done</Badge></div>
              <div className="flex justify-between"><span className="text-stone-600">Module 5 — Decision Engine</span><Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">done</Badge></div>
              <div className="flex justify-between"><span className="text-stone-600">Module 6 — Explainability</span><Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">done</Badge></div>
              <div className="flex justify-between"><span className="text-stone-600">Module 7 — Risk Management</span><Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">current</Badge></div>
              <div className="flex justify-between"><span className="text-stone-600">Modules 8-9</span><Badge variant="outline">queued</Badge></div>
            </CardContent>
          </Card>
        </section>

        {/* Collectors Grid */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-lg font-semibold text-stone-900">Module 1 Collectors</h2>
              <p className="text-sm text-stone-600">
                {collectors?.collectors.length || 0} collectors total ·{' '}
                <span className="text-emerald-700 font-medium">
                  {collectors?.collectors.filter((c) => c.status === 'active').length || 0} active
                </span>{' '}
                ·{' '}
                <span className="text-amber-700 font-medium">
                  {collectors?.collectors.filter((c) => c.status === 'stub').length || 0} stub
                </span>{' '}
                ·{' '}
                <span className="text-red-700 font-medium">
                  {collectors?.collectors.filter((c) => c.status === 'future').length || 0} future
                </span>
              </p>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {collectors?.collectors.map((c) => (
              <Card key={c.name} className="flex flex-col">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base font-mono">{c.name}</CardTitle>
                    <StatusBadge status={c.status} />
                  </div>
                  <CardDescription className="text-xs leading-snug">{c.description}</CardDescription>
                </CardHeader>
                <CardContent className="flex-1 space-y-2 text-xs">
                  {c.feedsLayer && (
                    <div className="flex justify-between">
                      <span className="text-stone-500">Feeds layer</span>
                      <span className="font-mono text-stone-700">{c.feedsLayer}</span>
                    </div>
                  )}
                  {c.schedule && (
                    <div className="flex justify-between">
                      <span className="text-stone-500">Cron</span>
                      <span className="font-mono text-stone-700">{c.schedule}</span>
                    </div>
                  )}
                  {c.stubReason && (
                    <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-amber-900">
                      <p className="font-semibold">insufficient_data reason</p>
                      <p className="mt-0.5 leading-snug">{c.stubReason}</p>
                    </div>
                  )}
                </CardContent>
                <div className="px-6 pb-4 pt-1">
                  <Button
                    size="sm"
                    variant={c.status === 'active' ? 'default' : 'outline'}
                    className="w-full"
                    disabled={triggeringCollector === c.name}
                    onClick={() => triggerCollector(c.name)}
                  >
                    {triggeringCollector === c.name ? (
                      <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3 w-3 mr-1" />
                    )}
                    {c.status === 'active' ? 'Trigger run' : 'Trigger (returns insufficient_data)'}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </section>

        {/* Module 2 — Data Quality & Cleaning */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-lg font-semibold text-stone-900">Module 2 — Data Quality &amp; Cleaning</h2>
              <p className="text-sm text-stone-600">
                Spec Section 5 — dedup audit, HTML entity decoding, zero-fill → null, clean sheet derivation
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={triggerReconciliation}
              disabled={triggeringCollector === '__recon__'}
            >
              {triggeringCollector === '__recon__' ? (
                <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-1" />
              )}
              Run reconciliation
            </Button>
          </div>

          {cleaningReport ? (
            <div className="grid gap-3 md:grid-cols-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-stone-600">Status</CardTitle>
                </CardHeader>
                <CardContent>
                  <Badge
                    className={
                      cleaningReport.status === 'success'
                        ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                        : cleaningReport.status === 'partial'
                          ? 'bg-amber-100 text-amber-900 border-amber-200'
                          : 'bg-red-100 text-red-800 border-red-200'
                    }
                  >
                    {cleaningReport.status.toUpperCase()}
                  </Badge>
                  <p className="mt-2 text-xs text-stone-500">
                    {new Date(cleaningReport.runAt).toLocaleString()}
                  </p>
                  <p className="text-xs text-stone-500">{cleaningReport.durationMs}ms</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-stone-600">Records Audited</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-stone-900">
                    {cleaningReport.totalRecordsAudited.toLocaleString()}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-stone-600">Issues Found</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-stone-500">Duplicate fixtures</span>
                    <span className={cleaningReport.duplicateFixtures > 0 ? 'text-red-600 font-mono' : 'text-emerald-600 font-mono'}>
                      {cleaningReport.duplicateFixtures}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-stone-500">HTML entity names</span>
                    <span className={cleaningReport.htmlEntityNames > 0 ? 'text-amber-600 font-mono' : 'text-emerald-600 font-mono'}>
                      {cleaningReport.htmlEntityNames}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-stone-500">Zero-filled stats</span>
                    <span className={cleaningReport.zeroFilledStats > 0 ? 'text-amber-600 font-mono' : 'text-emerald-600 font-mono'}>
                      {cleaningReport.zeroFilledStats}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-stone-500">Orphaned FKs</span>
                    <span className={cleaningReport.orphanedForeignKeys > 0 ? 'text-red-600 font-mono' : 'text-emerald-600 font-mono'}>
                      {cleaningReport.orphanedForeignKeys}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-stone-500">Missing source confidence</span>
                    <span className={cleaningReport.missingSourceConfidence > 0 ? 'text-red-600 font-mono' : 'text-emerald-600 font-mono'}>
                      {cleaningReport.missingSourceConfidence}
                    </span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-stone-600">Actions Taken</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-stone-500">Names decoded</span>
                    <span className="font-mono text-stone-900">{cleaningReport.namesDecoded}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-stone-500">Zero → null</span>
                    <span className="font-mono text-stone-900">{cleaningReport.zeroFilledToNull}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-stone-500">Clean sheets derived</span>
                    <span className="font-mono text-stone-900">{cleaningReport.cleanSheetsDerived}</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-sm text-stone-500">
                No cleaning reports yet. Click "Run reconciliation" to audit the database,
                decode HTML entities, convert zero-fills to null, and derive clean sheets
                from match results.
              </CardContent>
            </Card>
          )}

          {cleaningReport && cleaningReport.sampleIssues.length > 0 && (
            <Card className="mt-3">
              <CardHeader>
                <CardTitle className="text-sm">Sample Issues (first {Math.min(cleaningReport.sampleIssues.length, 10)})</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[200px] pr-3">
                  <div className="space-y-1.5">
                    {cleaningReport.sampleIssues.slice(0, 10).map((issue, i) => (
                      <div key={i} className="rounded-md border border-stone-200 bg-white px-3 py-2 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-semibold text-stone-900">
                            {issue.table}.{issue.field}
                          </span>
                          <Badge variant="outline" className="text-xs">{issue.issue}</Badge>
                        </div>
                        <p className="mt-1 text-stone-600 leading-snug">{issue.message}</p>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}
        </section>

        {/* Module 3 — Feature Engineering */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-lg font-semibold text-stone-900">Module 3 — Feature Engineering</h2>
              <p className="text-sm text-stone-600">
                Spec Section 6 — 10 active features + 3 stub features computed from real data
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={triggerFeatureEngineering}
              disabled={triggeringCollector === '__features__'}
            >
              {triggeringCollector === '__features__' ? (
                <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-1" />
              )}
              Compute features
            </Button>
          </div>

          {/* Feature summary cards */}
          {featureSummary && (
            <div className="grid gap-3 md:grid-cols-4 mb-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-stone-600">Active Features</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-stone-900">{featureSummary.registry.active}</p>
                  <p className="text-xs text-stone-500">computed from real data</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-stone-600">Stub Features</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-amber-700">{featureSummary.registry.stub}</p>
                  <p className="text-xs text-stone-500">insufficient_data (honest)</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-stone-600">Season Features</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-stone-900">
                    {Object.values(featureSummary.teamFeatures).reduce((a, b) => a + b, 0)}
                  </p>
                  <p className="text-xs text-stone-500">TeamFeature rows</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-stone-600">Match Features</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-stone-900">
                    {Object.values(featureSummary.matchFeatures).reduce((a, b) => a + b, 0)}
                  </p>
                  <p className="text-xs text-stone-500">MatchFeature rows</p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Feature registry grid */}
          {featureRegistry && (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {featureRegistry.active.map((f) => {
                const activeCount = featureSummary?.teamFeatures[`${f.name}:active`] || 0
                const insufCount = featureSummary?.teamFeatures[`${f.name}:insufficient_data`] || 0
                const matchActive = featureSummary?.matchFeatures[`${f.name}:active`] || 0
                const matchInsuf = featureSummary?.matchFeatures[`${f.name}:insufficient_data`] || 0
                const total = activeCount + insufCount + matchActive + matchInsuf
                return (
                  <Card key={f.name} className="flex flex-col">
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-sm font-mono">{f.name}</CardTitle>
                        <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">ACTIVE</Badge>
                      </div>
                      <CardDescription className="text-xs leading-snug">{f.description}</CardDescription>
                    </CardHeader>
                    <CardContent className="flex-1 text-xs space-y-1">
                      <div className="flex justify-between">
                        <span className="text-stone-500">Level</span>
                        <span className="font-mono text-stone-700">{f.level}</span>
                      </div>
                      {f.level === 'season' && (
                        <div className="flex justify-between">
                          <span className="text-stone-500">Computed</span>
                          <span className="font-mono">
                            <span className="text-emerald-700">{activeCount} active</span>
                            {insufCount > 0 && <span className="text-amber-700"> · {insufCount} insufficient</span>}
                          </span>
                        </div>
                      )}
                      {f.level === 'match' && (
                        <div className="flex justify-between">
                          <span className="text-stone-500">Computed</span>
                          <span className="font-mono">
                            <span className="text-emerald-700">{matchActive} active</span>
                            {matchInsuf > 0 && <span className="text-amber-700"> · {matchInsuf} insufficient</span>}
                          </span>
                        </div>
                      )}
                      {total === 0 && (
                        <p className="text-stone-400 italic mt-1">Not yet computed — click "Compute features"</p>
                      )}
                    </CardContent>
                  </Card>
                )
              })}
              {featureRegistry.stub.map((f) => (
                <Card key={f.name} className="flex flex-col opacity-75">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-sm font-mono">{f.name}</CardTitle>
                      <Badge className="bg-amber-100 text-amber-900 border-amber-200">STUB</Badge>
                    </div>
                    <CardDescription className="text-xs leading-snug">{f.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex-1 text-xs">
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-amber-900">
                      <p className="leading-snug">Returns insufficient_data — needs data source not yet active</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* Module 4 — Football Intelligence Engine */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-lg font-semibold text-stone-900">Module 4 — Football Intelligence Engine</h2>
              <p className="text-sm text-stone-600">
                Spec Section 7 — 17 layers + BrainOS orchestration + Consensus Engine
              </p>
            </div>
          </div>

          {/* Layer status summary cards */}
          {layerStatus && (
            <div className="grid gap-3 md:grid-cols-4 mb-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-stone-600">Active Layers</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-emerald-700">{layerStatus.active}</p>
                  <p className="text-xs text-stone-500">compute real scores</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-stone-600">Stub Layers</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-amber-700">{layerStatus.stub}</p>
                  <p className="text-xs text-stone-500">insufficient_data (honest)</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-stone-600">Future Layers</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-red-700">{layerStatus.future}</p>
                  <p className="text-xs text-stone-500">architecturally reserved</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-stone-600">Total Layers</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-stone-900">{layerStatus.total}</p>
                  <p className="text-xs text-stone-500">all permanent (Rule 1)</p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* 17-layer grid */}
          {layerStatus && (
            <div className="grid gap-2 md:grid-cols-3 lg:grid-cols-4 mb-4">
              {layerStatus.layers.map((layer) => (
                <Card key={layer.name} className={`flex flex-col ${layer.buildStatus === 'stub' ? 'opacity-75' : layer.buildStatus === 'future' ? 'opacity-50' : ''}`}>
                  <CardHeader className="pb-1 px-3 pt-3">
                    <div className="flex items-start justify-between gap-1">
                      <Badge variant="outline" className="text-[10px] font-mono shrink-0">L{layer.layerNumber}</Badge>
                      {layer.buildStatus === 'active' && <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-[10px]">ACTIVE</Badge>}
                      {layer.buildStatus === 'stub' && <Badge className="bg-amber-100 text-amber-900 border-amber-200 text-[10px]">STUB</Badge>}
                      {layer.buildStatus === 'future' && <Badge variant="destructive" className="text-[10px]">FUTURE</Badge>}
                    </div>
                    <CardTitle className="text-xs font-mono mt-1">{layer.name}</CardTitle>
                  </CardHeader>
                  <CardContent className="px-3 pb-2 text-[10px] space-y-0.5">
                    <p className="text-stone-600 leading-snug">{layer.description}</p>
                    <div className="flex justify-between pt-1">
                      <span className="text-stone-500">Feeds consensus:</span>
                      <span className="font-mono">{layer.feedsConsensus ? 'yes' : 'no'}</span>
                    </div>
                    {layer.feedsConsensus && (
                      <div className="flex justify-between">
                        <span className="text-stone-500">Weight:</span>
                        <span className="font-mono">{layer.weight.toFixed(2)}</span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* BrainOS Final Match Intelligence viewer */}
          {latestFmi && (
            <Card className="mb-4 border-stone-400">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  BrainOS Final Match Intelligence
                  <Badge variant="outline" className="text-xs">{latestFmi.metadata.brainosVersion}</Badge>
                </CardTitle>
                <CardDescription className="text-xs">
                  {latestFmi.match.homeTeam} vs {latestFmi.match.awayTeam} · {new Date(latestFmi.match.kickoff).toLocaleString()} ·
                  computed in {latestFmi.metadata.durationMs}ms · {latestFmi.metadata.layersActive} active / {latestFmi.metadata.layersInsufficient} insufficient / {latestFmi.metadata.layersFuture} future
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Final prediction */}
                {latestFmi.finalPrediction && (
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-md border border-stone-200 bg-stone-50 p-2 text-center">
                      <p className="text-xs text-stone-500">Home Win</p>
                      <p className="text-lg font-bold text-stone-900">{(latestFmi.finalPrediction.homeWinProb * 100).toFixed(1)}%</p>
                    </div>
                    <div className="rounded-md border border-stone-200 bg-stone-50 p-2 text-center">
                      <p className="text-xs text-stone-500">Draw</p>
                      <p className="text-lg font-bold text-stone-900">{(latestFmi.finalPrediction.drawProb * 100).toFixed(1)}%</p>
                    </div>
                    <div className="rounded-md border border-stone-200 bg-stone-50 p-2 text-center">
                      <p className="text-xs text-stone-500">Away Win</p>
                      <p className="text-lg font-bold text-stone-900">{(latestFmi.finalPrediction.awayWinProb * 100).toFixed(1)}%</p>
                    </div>
                  </div>
                )}

                {/* Consensus */}
                {latestFmi.consensus && (
                  <div className="text-xs space-y-1">
                    <p className="font-semibold text-stone-700">Consensus: score {latestFmi.consensus.score.toFixed(3)}, confidence {latestFmi.consensus.confidence?.toFixed(3)}</p>
                    <p className="text-stone-500">
                      {latestFmi.consensus.layersContributing} layers contributing · {latestFmi.consensus.layersExcluded} excluded · agreement {latestFmi.consensus.agreementScore.toFixed(3)}
                    </p>
                  </div>
                )}

                {/* Layer outputs with specific reasoning */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-stone-700">Layer Outputs ({latestFmi.layerOutputs.length}):</p>
                  <ScrollArea className="h-[400px] pr-3">
                    <div className="space-y-1.5">
                      {latestFmi.layerOutputs.map((lo, i) => (
                        <div key={i} className="rounded-md border border-stone-200 bg-white px-2 py-1.5 text-xs">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-mono font-semibold text-stone-900">{lo.layer_name}</span>
                            <div className="flex items-center gap-2">
                              {lo.score !== null && <span className="font-mono text-stone-700">score: {lo.score.toFixed(3)}</span>}
                              {lo.confidence !== null && <span className="font-mono text-stone-500">conf: {lo.confidence.toFixed(3)}</span>}
                              {lo.status === 'active' && <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-[10px]">ACTIVE</Badge>}
                              {lo.status === 'insufficient_data' && <Badge className="bg-amber-100 text-amber-900 border-amber-200 text-[10px]">INSUF</Badge>}
                              {lo.status === 'future' && <Badge variant="destructive" className="text-[10px]">FUTURE</Badge>}
                            </div>
                          </div>
                          {lo.reasoning && (
                            <pre className="whitespace-pre-wrap text-[10px] text-stone-600 leading-snug font-mono">{lo.reasoning}</pre>
                          )}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              </CardContent>
            </Card>
          )}
        </section>

        {/* Module 5 — Prediction Decision Engine */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-lg font-semibold text-stone-900">Module 5 — Prediction Decision Engine</h2>
              <p className="text-sm text-stone-600">
                Spec Section 9 — 3 market predictions (1X2, O/U 2.5, BTTS) + recommendation profiles
              </p>
            </div>
          </div>

          {/* High Value tier disabled notice */}
          <Card className="mb-3 border-amber-300 bg-amber-50">
            <CardContent className="py-3 text-xs text-amber-900">
              <strong>High Value tier: DISABLED</strong> — requires Market Intelligence (Layer 8) for value score
              calculation. Per spec Section 11: "do not fake a 'value bet' claim without real market odds to compare
              against; that's the one output that could cause real financial harm if faked." Active when ODDS_API_KEY is provided.
            </CardContent>
          </Card>

          {/* Market predictions from latest BrainOS run */}
          {latestFmi && latestFmi.marketPredictions && latestFmi.marketPredictions.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-3">
              {latestFmi.marketPredictions.map((mp) => (
                <Card key={mp.marketType}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <CardTitle className="text-sm font-mono">{mp.marketType}</CardTitle>
                      {mp.recommendationProfile && (
                        <Badge
                          className={
                            mp.recommendationProfile === 'high_consensus'
                              ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                              : mp.recommendationProfile === 'moderate_consensus'
                                ? 'bg-blue-100 text-blue-800 border-blue-200'
                                : mp.recommendationProfile === 'high_value'
                                  ? 'bg-purple-100 text-purple-800 border-purple-200'
                                  : 'bg-red-100 text-red-800 border-red-200'
                          }
                        >
                          {mp.recommendationProfile.replace('_', ' ').toUpperCase()}
                        </Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div>
                      <p className="text-xs text-stone-500">Selection</p>
                      <p className="text-lg font-bold text-stone-900">{mp.selection.replace(/_/g, ' ')}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <p className="text-stone-500">Probability</p>
                        <p className="font-mono font-semibold">{(mp.probability * 100).toFixed(1)}%</p>
                      </div>
                      <div>
                        <p className="text-stone-500">Confidence</p>
                        <p className="font-mono font-semibold">{mp.confidence.toFixed(3)}</p>
                      </div>
                    </div>
                    <div className="pt-1 border-t border-stone-100">
                      <p className="text-[10px] text-stone-400">
                        Value Score: {mp.valueScore === null ? 'null (needs Market Intelligence)' : mp.valueScore}
                      </p>
                      <p className="text-[10px] text-stone-400">
                        Risk Score: {mp.riskScore === null ? 'null (Module 7)' : mp.riskScore}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="py-6 text-center text-sm text-stone-500">
                No market predictions yet. Run BrainOS on a match to generate 1X2, O/U 2.5, and BTTS predictions.
              </CardContent>
            </Card>
          )}

          {/* Recommendation profile legend */}
          <Card className="mt-3">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs">Recommendation Profile Tiers</CardTitle>
            </CardHeader>
            <CardContent className="text-xs space-y-1">
              <div className="flex items-center gap-2">
                <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">ULTRA SAFE</Badge>
                <span className="text-stone-600">confidence ≥ 0.75 AND probability ≥ 0.65</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge className="bg-blue-100 text-blue-800 border-blue-200">BALANCED</Badge>
                <span className="text-stone-600">confidence ≥ 0.55 AND probability ≥ 0.50</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge className="bg-red-100 text-red-800 border-red-200">HIGH RISK</Badge>
                <span className="text-stone-600">lower confidence or probability — proceed with caution</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge className="bg-purple-100 text-purple-800 border-purple-200">HIGH VALUE</Badge>
                <span className="text-stone-600">DISABLED — requires Market Intelligence (Layer 8) + Value Score</span>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Module 7 — Risk Management Engine */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-lg font-semibold text-stone-900">Module 7 — Risk Management Engine</h2>
              <p className="text-sm text-stone-600">
                Spec Section 11 — Confidence + Risk + Volatility from active layer variance
              </p>
            </div>
          </div>

          {/* Value Score disabled notice */}
          <Card className="mb-3 border-red-300 bg-red-50">
            <CardContent className="py-3 text-xs text-red-900">
              <strong>Value Score: DISABLED</strong> — Per spec Section 11: "do not fake a 'value bet' claim without
              real market odds to compare against; that's the one output that could cause real financial harm if faked."
              Value Score activates when Market Intelligence (Layer 8) is wired + ODDS_API_KEY is provided.
            </CardContent>
          </Card>

          {/* Consensus vs accuracy disclaimer */}
          <Card className="mb-3 border-stone-400 bg-stone-50">
            <CardContent className="py-3 text-xs text-stone-700">
              <strong>Important:</strong> Risk, volatility, and recommendation profiles measure <strong>layer consensus</strong>, not prediction accuracy.
              A "high consensus" prediction can still be wrong if all layers share the same blind spot. Accuracy is tracked separately
              by Module 8 (Learning Intelligence) after matches complete.
            </CardContent>
          </Card>

          {/* Risk assessment from latest BrainOS run */}
          {latestFmi && latestFmi.riskAssessment ? (
            <>
              {/* Overall risk metrics */}
              <div className="grid gap-3 md:grid-cols-4 mb-3">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs font-medium text-stone-600">Confidence</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold text-stone-900">{latestFmi.riskAssessment.confidence.toFixed(3)}</p>
                    <p className="text-xs text-stone-500">from consensus</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs font-medium text-stone-600">Risk Score</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className={`text-2xl font-bold ${latestFmi.riskAssessment.riskScore > 0.5 ? 'text-red-700' : latestFmi.riskAssessment.riskScore > 0.3 ? 'text-amber-700' : 'text-emerald-700'}`}>
                      {latestFmi.riskAssessment.riskScore.toFixed(3)}
                    </p>
                    <p className="text-xs text-stone-500">0=low, 1=high</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs font-medium text-stone-600">Volatility</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className={`text-2xl font-bold ${latestFmi.riskAssessment.volatility > 0.5 ? 'text-red-700' : latestFmi.riskAssessment.volatility > 0.3 ? 'text-amber-700' : 'text-emerald-700'}`}>
                      {latestFmi.riskAssessment.volatility.toFixed(3)}
                    </p>
                    <p className="text-xs text-stone-500">layer disagreement</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs font-medium text-stone-600">Recommendation</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Badge
                      className={
                        latestFmi.riskAssessment.recommendationProfile === 'high_consensus'
                          ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                          : latestFmi.riskAssessment.recommendationProfile === 'moderate_consensus'
                            ? 'bg-blue-100 text-blue-800 border-blue-200'
                            : 'bg-red-100 text-red-800 border-red-200'
                      }
                    >
                      {latestFmi.riskAssessment.recommendationProfile.replace('_', ' ').toUpperCase()}
                    </Badge>
                  </CardContent>
                </Card>
              </div>

              {/* Per-market risk table */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Per-Market Risk Assessment</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {latestFmi.riskAssessment.perMarketRisk.map((mr) => (
                      <div key={mr.marketType} className="rounded-md border border-stone-200 bg-white px-3 py-2">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-mono font-semibold text-sm">{mr.marketType}</span>
                          <Badge
                            className={
                              mr.recommendationProfile === 'high_consensus'
                                ? 'bg-emerald-100 text-emerald-800 border-emerald-200 text-xs'
                                : mr.recommendationProfile === 'moderate_consensus'
                                  ? 'bg-blue-100 text-blue-800 border-blue-200 text-xs'
                                  : 'bg-red-100 text-red-800 border-red-200 text-xs'
                            }
                          >
                            {mr.recommendationProfile.replace('_', ' ').toUpperCase()}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-4 gap-2 text-xs">
                          <div>
                            <span className="text-stone-500">Selection:</span>
                            <p className="font-mono font-semibold">{mr.selection.replace(/_/g, ' ')}</p>
                          </div>
                          <div>
                            <span className="text-stone-500">Probability:</span>
                            <p className="font-mono">{(mr.probability * 100).toFixed(1)}%</p>
                          </div>
                          <div>
                            <span className="text-stone-500">Risk:</span>
                            <p className={`font-mono ${mr.riskScore > 0.5 ? 'text-red-700' : mr.riskScore > 0.3 ? 'text-amber-700' : 'text-emerald-700'}`}>
                              {mr.riskScore.toFixed(3)}
                            </p>
                          </div>
                          <div>
                            <span className="text-stone-500">Volatility:</span>
                            <p className={`font-mono ${mr.volatility > 0.5 ? 'text-red-700' : mr.volatility > 0.3 ? 'text-amber-700' : 'text-emerald-700'}`}>
                              {mr.volatility.toFixed(3)}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </>
          ) : (
            <Card>
              <CardContent className="py-6 text-center text-sm text-stone-500">
                No risk assessment yet. Run BrainOS on a match to compute risk + volatility from active layer variance.
              </CardContent>
            </Card>
          )}
        </section>

        {/* DB Tables + Recent Runs */}
        <section className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Database className="h-4 w-4" /> Database Tables
              </CardTitle>
              <CardDescription className="text-xs">
                Per Section 14 — normalized schema with source_confidence on every record
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[360px] pr-3">
                <div className="space-y-1">
                  {stats?.tables.map((t) => (
                    <div
                      key={t.name}
                      className="flex items-center justify-between rounded-md border border-stone-200 bg-white px-3 py-1.5"
                    >
                      <span className="font-mono text-xs text-stone-700">{t.name}</span>
                      <div className="flex items-center gap-3 text-xs">
                        <span className="text-stone-500">
                          {t.lastUpdated
                            ? new Date(t.lastUpdated).toLocaleDateString() + ' ' + new Date(t.lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            : '—'}
                        </span>
                        <span className="font-mono font-semibold text-stone-900">
                          {t.rowCount.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="h-4 w-4" /> Recent Collector Runs
              </CardTitle>
              <CardDescription className="text-xs">
                Last 50 runs · audit trail per Section 14
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[360px] pr-3">
                {collectors && collectors.recentRuns.length > 0 ? (
                  <div className="space-y-1.5">
                    {collectors.recentRuns.map((r, i) => (
                      <div key={i} className="rounded-md border border-stone-200 bg-white px-3 py-2 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-semibold text-stone-900">{r.collectorName}</span>
                          <RunStatusBadge status={r.status} />
                        </div>
                        <div className="mt-1 flex items-center justify-between text-stone-500">
                          <span>{new Date(r.startedAt).toLocaleString()}</span>
                          <span>{r.durationMs}ms</span>
                        </div>
                        <div className="mt-1 text-stone-600">
                          {r.recordsIngested > 0 && <span className="mr-2">📥 {r.recordsIngested} new</span>}
                          {r.recordsUpdated > 0 && <span className="mr-2">✏️ {r.recordsUpdated} updated</span>}
                          {r.recordsSkipped > 0 && <span>⏭️ {r.recordsSkipped} skipped</span>}
                        </div>
                        {r.error && (
                          <p className="mt-1 text-amber-700 leading-snug">{r.error}</p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 text-stone-500">
                    <Clock className="mx-auto h-8 w-8 mb-2 opacity-40" />
                    <p className="text-sm">No runs yet.</p>
                    <p className="text-xs mt-1">Click "Run all active" above, or wait for the cron schedule to fire.</p>
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </section>

        {/* Constitution */}
        <Card className="border-stone-300">
          <CardHeader>
            <CardTitle className="text-base">ATLAS Constitution — Non-Negotiable Rules</CardTitle>
            <CardDescription className="text-xs">Spec Section 0 · These win over every other instruction</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 md:grid-cols-2 text-xs">
              {[
                ['Rule 1', 'Every module, layer, and AI model is permanent. Full 9 modules, 17 layers, 15 AI models — always.'],
                ['Rule 2', 'Data availability only changes status — never existence. Stubbed ≠ deleted.'],
                ['Rule 3', 'BrainOS is the permanent orchestration layer. No module calls another directly.'],
                ['Rule 4', 'Never fabricate data. If a number can\'t be computed, output is insufficient_data.'],
                ['Rule 5', 'Every prediction is explainable and traceable. No black-box outputs.'],
                ['Rule 6', 'Every completed match becomes training data. Logging runs from Phase 1 onward.'],
                ['Rule 7', 'Build one module at a time, then stop. Flag contradictions — never resolve quietly.'],
              ].map(([rule, text]) => (
                <div key={rule} className="flex gap-2 rounded-md border border-stone-200 bg-stone-50 px-3 py-2">
                  <Badge variant="outline" className="h-fit whitespace-nowrap">{rule}</Badge>
                  <span className="text-stone-700">{text}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </main>

      <footer className="border-t bg-white mt-8">
        <div className="container mx-auto px-4 py-4 flex flex-col md:flex-row items-center justify-between gap-2 text-xs text-stone-500">
          <span>ATLAS · Phase 1 Module 1 build · per Master Build Prompt v1.0</span>
          <span>
            Dev sandbox: SQLite + ioredis-mock · Production swap: Postgres + Redis via <code className="font-mono bg-stone-100 px-1 rounded">infra/docker-compose.yml</code>
          </span>
        </div>
      </footer>
    </div>
  )
}
