'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'

const API = process.env.NEXT_PUBLIC_ATLAS_API_PORT || '4001'

async function apiFetch<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const url = `${path}?XTransformPort=${API}`
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface AdminStats {
  totalUsers: number
  activeSubscribers: number
  mrrNaira: number
  arrNaira: number
  byTier: Record<string, Record<string, number>>
}

interface UserRow {
  id: string
  email: string
  name: string | null
  role: string
  isActive: boolean
  createdAt: string
  tier: string
  subscriptionStatus: string
  priceNaira: number
  expiresAt: string | null
}

interface DailyReport {
  id: string
  reportDate: string
  sectionsIncluded: string
  sentViaEmail: boolean
  createdAt: string
}

interface HealthResponse {
  status: string
  checks: { database: string; queue: string; apiFootball: string; groq: string }
  uptime: number
  version: string
}

interface LearningReport {
  overallAccuracy: number | null
  totalPredictions: number
  correctPredictions: number
  bestPerformingLayer: string | null
  weakestPerformingLayer: string | null
  reportDate: string
  sampleSizeNote: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString('en-NG')
}

function tierColor(tier: string) {
  switch (tier) {
    case 'vip': return '#f59e0b'
    case 'pro': return '#8b5cf6'
    case 'starter': return '#3b82f6'
    default: return '#6b7280'
  }
}

function tierBg(tier: string) {
  switch (tier) {
    case 'vip': return 'rgba(245,158,11,0.12)'
    case 'pro': return 'rgba(139,92,246,0.12)'
    case 'starter': return 'rgba(59,130,246,0.12)'
    default: return 'rgba(107,114,128,0.12)'
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const router = useRouter()
  const [token, setToken] = useState<string | null>(null)
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [users, setUsers] = useState<UserRow[]>([null as any])
  const [reports, setReports] = useState<DailyReport[]>([])
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [accuracy, setAccuracy] = useState<LearningReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'reports' | 'system'>('overview')
  const [triggeringReport, setTriggeringReport] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null)

  const showToast = (msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4000)
  }

  useEffect(() => {
    const t = localStorage.getItem('atlas_token')
    const u = localStorage.getItem('atlas_user')
    if (!t) { router.push('/login'); return }
    if (u) {
      const user = JSON.parse(u)
      if (user.role !== 'admin') { router.push('/dashboard'); return }
    }
    setToken(t)
  }, [router])

  const refresh = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const [s, ul, rh, h, acc] = await Promise.all([
        apiFetch<AdminStats>('/auth/admin/stats', token),
        apiFetch<{ users: UserRow[] }>('/auth/admin/users', token),
        apiFetch<{ reports: DailyReport[] }>('/report/history', token),
        apiFetch<HealthResponse>('/health', token),
        apiFetch<LearningReport | null>('/learning/report', token).catch(() => null),
      ])
      setStats(s)
      setUsers(ul.users)
      setReports(rh.reports)
      setHealth(h)
      setAccuracy(acc)
    } catch (err) {
      showToast(`Failed to load: ${err instanceof Error ? err.message : String(err)}`, 'err')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    if (token) refresh()
    const id = setInterval(() => { if (token) refresh() }, 30_000)
    return () => clearInterval(id)
  }, [token, refresh])

  const triggerReport = async () => {
    if (!token) return
    setTriggeringReport(true)
    try {
      const result = await apiFetch<{ status: string; emailsSent: number }>('/report/generate', token, { method: 'POST' })
      showToast(`Report generated! ${result.emailsSent} email(s) sent.`)
      await refresh()
    } catch (err) {
      showToast(`Failed: ${err instanceof Error ? err.message : String(err)}`, 'err')
    } finally {
      setTriggeringReport(false)
    }
  }

  const toggleUser = async (userId: string, isActive: boolean) => {
    if (!token) return
    try {
      await apiFetch('/auth/admin/users/' + userId, token, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !isActive }),
      })
      showToast(`User ${isActive ? 'suspended' : 'reactivated'}.`)
      await refresh()
    } catch (err) {
      showToast('Failed to update user.', 'err')
    }
  }

  const logout = () => {
    localStorage.removeItem('atlas_token')
    localStorage.removeItem('atlas_user')
    router.push('/login')
  }

  if (!token) return null

  const TIER_ORDER = ['vip', 'pro', 'starter', 'free']

  return (
    <div style={page}>
      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 20, right: 20, zIndex: 9999,
          padding: '12px 20px', borderRadius: 10,
          background: toast.type === 'ok' ? '#064e3b' : '#7f1d1d',
          border: `1px solid ${toast.type === 'ok' ? '#065f46' : '#991b1b'}`,
          color: '#fff', fontSize: 14, fontWeight: 500,
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
        }}>
          {toast.msg}
        </div>
      )}

      {/* Sidebar */}
      <aside style={sidebar}>
        <div style={{ padding: '24px 20px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: 3, color: '#60a5fa' }}>⚡ ATLAS</div>
          <div style={{ fontSize: 10, color: '#4b5563', marginTop: 3, letterSpacing: 1 }}>ADMIN CONSOLE</div>
        </div>

        <nav style={{ padding: '16px 12px', flex: 1 }}>
          {([
            ['overview', '📊', 'Overview'],
            ['users', '👥', 'Subscribers'],
            ['reports', '📋', 'Daily Reports'],
            ['system', '⚙️', 'System Health'],
          ] as const).map(([tab, icon, label]) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 14px', marginBottom: 4, borderRadius: 8,
                background: activeTab === tab ? 'rgba(96,165,250,0.12)' : 'transparent',
                border: activeTab === tab ? '1px solid rgba(96,165,250,0.2)' : '1px solid transparent',
                color: activeTab === tab ? '#93c5fd' : '#6b7280',
                cursor: 'pointer', fontSize: 13, fontWeight: activeTab === tab ? 600 : 400, textAlign: 'left',
              }}
            >
              <span>{icon}</span> {label}
            </button>
          ))}
        </nav>

        <div style={{ padding: '16px 12px', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          <a href="/" style={{ display: 'block', padding: '8px 14px', color: '#6b7280', fontSize: 12, textDecoration: 'none', borderRadius: 6 }}>
            ← Engineering Console
          </a>
          <button onClick={logout} style={{ width: '100%', padding: '8px 14px', background: 'transparent', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 12, textAlign: 'left', borderRadius: 6 }}>
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, overflow: 'auto', padding: '32px 28px' }}>

        {/* ── OVERVIEW ────────────────────────────────────────────── */}
        {activeTab === 'overview' && (
          <div>
            <h1 style={heading}>Business Overview</h1>
            <p style={subhead}>Revenue, subscribers, prediction accuracy — at a glance.</p>

            {/* KPI row */}
            <div style={kpiRow}>
              <KpiCard label="Total Users" value={fmt(stats?.totalUsers ?? 0)} sub="registered accounts" color="#60a5fa" />
              <KpiCard label="Active Subscribers" value={fmt(stats?.activeSubscribers ?? 0)} sub="paying users" color="#34d399" />
              <KpiCard label="Monthly Revenue" value={`₦${fmt(stats?.mrrNaira ?? 0)}`} sub="MRR (Naira)" color="#f59e0b" />
              <KpiCard label="Annual Run Rate" value={`₦${fmt(stats?.arrNaira ?? 0)}`} sub="ARR (Naira)" color="#a78bfa" />
            </div>

            {/* Tier breakdown */}
            <div style={card}>
              <div style={cardTitle}>Subscriber Tier Breakdown</div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {TIER_ORDER.map(tier => {
                  const active = stats?.byTier[tier]?.active ?? 0
                  const total = Object.values(stats?.byTier[tier] ?? {}).reduce((a, b) => a + b, 0)
                  return (
                    <div key={tier} style={{
                      flex: '1 1 140px', padding: '16px 20px',
                      background: tierBg(tier),
                      border: `1px solid ${tierColor(tier)}40`,
                      borderRadius: 10,
                    }}>
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: tierColor(tier), marginBottom: 8 }}>
                        {tier.toUpperCase()}
                      </div>
                      <div style={{ fontSize: 28, fontWeight: 800, color: '#e5e7eb' }}>{active}</div>
                      <div style={{ fontSize: 11, color: '#6b7280' }}>active / {total} total</div>
                      {tier !== 'free' && (
                        <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>
                          {tier === 'starter' ? '₦3,000/mo' : tier === 'pro' ? '₦7,500/mo' : '₦15,000/mo'}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Accuracy */}
            {accuracy && (
              <div style={card}>
                <div style={cardTitle}>Prediction Accuracy</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                  <MiniStat label="Overall Accuracy" value={accuracy.overallAccuracy !== null ? `${(accuracy.overallAccuracy * 100).toFixed(1)}%` : 'N/A'} />
                  <MiniStat label="Total Predictions" value={fmt(accuracy.totalPredictions)} />
                  <MiniStat label="Correct" value={fmt(accuracy.correctPredictions)} />
                  <MiniStat label="Best Layer" value={accuracy.bestPerformingLayer ?? 'N/A'} />
                  <MiniStat label="Weakest Layer" value={accuracy.weakestPerformingLayer ?? 'N/A'} />
                </div>
                {accuracy.sampleSizeNote && (
                  <div style={{ marginTop: 12, fontSize: 12, color: '#6b7280' }}>{accuracy.sampleSizeNote}</div>
                )}
              </div>
            )}

            {/* Generate report button */}
            <div style={card}>
              <div style={cardTitle}>Daily Report</div>
              <p style={{ fontSize: 13, color: '#9ca3af', marginBottom: 16 }}>
                Manually trigger today's report generation and email delivery to all subscribers.
                Runs automatically at 6:00 AM Lagos time.
              </p>
              <button
                onClick={triggerReport}
                disabled={triggeringReport}
                style={btnPrimary}
              >
                {triggeringReport ? '⏳ Generating…' : '📨 Generate & Send Today\'s Report'}
              </button>
            </div>
          </div>
        )}

        {/* ── USERS ───────────────────────────────────────────────── */}
        {activeTab === 'users' && (
          <div>
            <h1 style={heading}>Subscribers</h1>
            <p style={subhead}>{users.length} users · click a row to manage.</p>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                    {['Name / Email', 'Tier', 'Status', 'Revenue', 'Joined', 'Expires', 'Actions'].map(h => (
                      <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: '#6b7280', fontWeight: 600, fontSize: 11, letterSpacing: 0.5, whiteSpace: 'nowrap' }}>
                        {h.toUpperCase()}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.filter(Boolean).map(u => (
                    <tr key={u.id} style={{
                      borderBottom: '1px solid rgba(255,255,255,0.04)',
                      opacity: u.isActive ? 1 : 0.5,
                      transition: 'background 0.15s',
                    }}>
                      <td style={{ padding: '12px', color: '#e5e7eb' }}>
                        <div style={{ fontWeight: 600 }}>{u.name || '—'}</div>
                        <div style={{ fontSize: 11, color: '#6b7280' }}>{u.email}</div>
                        {u.role === 'admin' && <span style={{ fontSize: 10, color: '#f59e0b', fontWeight: 700 }}>ADMIN</span>}
                      </td>
                      <td style={{ padding: '12px' }}>
                        <span style={{
                          padding: '3px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700,
                          background: tierBg(u.tier), color: tierColor(u.tier),
                        }}>
                          {u.tier.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ padding: '12px' }}>
                        <span style={{
                          fontSize: 11, fontWeight: 600,
                          color: u.subscriptionStatus === 'active' ? '#34d399' : '#f87171',
                        }}>
                          {u.subscriptionStatus}
                        </span>
                      </td>
                      <td style={{ padding: '12px', color: '#9ca3af' }}>
                        {u.priceNaira > 0 ? `₦${fmt(u.priceNaira)}` : 'Free'}
                      </td>
                      <td style={{ padding: '12px', color: '#6b7280', fontSize: 11, whiteSpace: 'nowrap' }}>
                        {new Date(u.createdAt).toLocaleDateString('en-NG')}
                      </td>
                      <td style={{ padding: '12px', color: '#6b7280', fontSize: 11, whiteSpace: 'nowrap' }}>
                        {u.expiresAt ? new Date(u.expiresAt).toLocaleDateString('en-NG') : '—'}
                      </td>
                      <td style={{ padding: '12px' }}>
                        <button
                          onClick={() => toggleUser(u.id, u.isActive)}
                          style={{
                            padding: '4px 10px', borderRadius: 5, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600,
                            background: u.isActive ? 'rgba(239,68,68,0.12)' : 'rgba(52,211,153,0.12)',
                            color: u.isActive ? '#f87171' : '#34d399',
                          }}
                        >
                          {u.isActive ? 'Suspend' : 'Reactivate'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {users.filter(Boolean).length === 0 && (
                <div style={{ textAlign: 'center', padding: '48px', color: '#4b5563', fontSize: 14 }}>
                  No subscribers yet. Share the platform link to get sign-ups.
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── REPORTS ─────────────────────────────────────────────── */}
        {activeTab === 'reports' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <div>
                <h1 style={heading}>Daily Reports</h1>
                <p style={subhead}>History of generated prediction reports.</p>
              </div>
              <button onClick={triggerReport} disabled={triggeringReport} style={btnPrimary}>
                {triggeringReport ? '⏳ Generating…' : '+ Generate Today'}
              </button>
            </div>

            {reports.length === 0 ? (
              <div style={{ ...card, textAlign: 'center', padding: '48px', color: '#4b5563' }}>
                No reports yet. Click "Generate Today" or wait for the 6 AM cron.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {reports.map(r => (
                  <div key={r.id} style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, padding: '16px 20px' }}>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: '#e5e7eb' }}>
                        {new Date(r.reportDate).toLocaleDateString('en-NG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                      </div>
                      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                        Generated {new Date(r.createdAt).toLocaleTimeString('en-NG')}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <span style={{
                        padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                        background: r.sentViaEmail ? 'rgba(52,211,153,0.12)' : 'rgba(107,114,128,0.12)',
                        color: r.sentViaEmail ? '#34d399' : '#6b7280',
                      }}>
                        {r.sentViaEmail ? '✓ Email sent' : '○ No email'}
                      </span>
                      {r.sectionsIncluded && (
                        <span style={{ fontSize: 11, color: '#6b7280' }}>{r.sectionsIncluded}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── SYSTEM ──────────────────────────────────────────────── */}
        {activeTab === 'system' && (
          <div>
            <h1 style={heading}>System Health</h1>
            <p style={subhead}>Infrastructure status, API quotas, module pipeline.</p>

            {health && (
              <div style={card}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                  <span style={{
                    padding: '6px 16px', borderRadius: 6, fontSize: 13, fontWeight: 700,
                    background: health.status === 'ok' ? 'rgba(52,211,153,0.12)' : 'rgba(239,68,68,0.12)',
                    color: health.status === 'ok' ? '#34d399' : '#f87171',
                  }}>
                    {health.status.toUpperCase()}
                  </span>
                  <span style={{ fontSize: 12, color: '#6b7280' }}>
                    {health.version} · up {Math.floor(health.uptime / 1000)}s
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                  {Object.entries(health.checks).map(([key, val]) => (
                    <div key={key} style={{
                      padding: '12px 16px', borderRadius: 8,
                      background: val === 'ok' ? 'rgba(52,211,153,0.06)' : val === 'unconfigured' ? 'rgba(251,191,36,0.06)' : 'rgba(239,68,68,0.06)',
                      border: `1px solid ${val === 'ok' ? 'rgba(52,211,153,0.2)' : val === 'unconfigured' ? 'rgba(251,191,36,0.2)' : 'rgba(239,68,68,0.2)'}`,
                    }}>
                      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>{key}</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: val === 'ok' ? '#34d399' : val === 'unconfigured' ? '#fbbf24' : '#f87171' }}>
                        {val}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Module pipeline */}
            <div style={card}>
              <div style={cardTitle}>Module Pipeline — All 9 Modules</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  [1, 'Data Collection', 'done'],
                  [2, 'Data Cleaning & Reconciliation', 'done'],
                  [3, 'Feature Engineering', 'done'],
                  [4, '17 Intelligence Layers + BrainOS', 'done'],
                  [5, 'Prediction Decision Engine', 'done'],
                  [6, 'Explainability AI', 'done'],
                  [7, 'Risk Management Engine', 'done'],
                  [8, 'Adaptive Learning', 'done'],
                  [9, 'Daily Report & Email Delivery', 'done'],
                ].map(([num, name, status]) => (
                  <div key={num as number} style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 8,
                    background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)',
                  }}>
                    <span style={{ fontSize: 11, color: '#4b5563', fontWeight: 700, width: 24, textAlign: 'center' }}>M{num}</span>
                    <span style={{ flex: 1, fontSize: 13, color: '#9ca3af' }}>{name}</span>
                    <span style={{
                      padding: '2px 10px', borderRadius: 4, fontSize: 11, fontWeight: 700,
                      background: 'rgba(52,211,153,0.12)', color: '#34d399',
                    }}>
                      {(status as string).toUpperCase()}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Env config checklist */}
            <div style={card}>
              <div style={cardTitle}>Production Env Checklist</div>
              <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 2 }}>
                {[
                  ['API_FOOTBALL_KEY', 'API-Football v3 key (100 req/day free)'],
                  ['GROQ_API_KEY', 'Groq LLM (llama-3.3-70b-versatile)'],
                  ['RESEND_API_KEY', 'Email delivery (get at resend.com)'],
                  ['ATLAS_ADMIN_EMAIL', 'Your admin email (tinnybolt@gmail.com)'],
                  ['ATLAS_TOKEN_SECRET', 'Strong random secret for JWT signing'],
                  ['DATABASE_URL', 'Postgres URL (swap from SQLite for prod)'],
                  ['REDIS_URL', 'Redis URL (swap from ioredis-mock for prod)'],
                  ['PAYSTACK_SECRET_KEY', 'Paystack (activate when subscription payments go live)'],
                  ['ATLAS_ACTIVE_LEAGUES', 'Comma-separated league IDs (default: 39 = EPL)'],
                ].map(([env, desc]) => (
                  <div key={env as string} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <code style={{ color: '#93c5fd', fontSize: 12, minWidth: 220, whiteSpace: 'nowrap' }}>{env}</code>
                    <span>{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div style={{
      flex: '1 1 180px', padding: '20px 24px',
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 12,
    }}>
      <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 700, letterSpacing: 1, marginBottom: 8 }}>
        {label.toUpperCase()}
      </div>
      <div style={{ fontSize: 30, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 12, color: '#4b5563', marginTop: 4 }}>{sub}</div>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: '12px 16px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)' }}>
      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#e5e7eb' }}>{value}</div>
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const page: React.CSSProperties = {
  display: 'flex', minHeight: '100vh',
  background: '#0d1117',
  fontFamily: "'Helvetica Neue', Arial, sans-serif",
  color: '#e5e7eb',
}

const sidebar: React.CSSProperties = {
  width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column',
  background: '#0a0d12',
  borderRight: '1px solid rgba(255,255,255,0.06)',
  minHeight: '100vh', position: 'sticky', top: 0, height: '100vh', overflowY: 'auto',
}

const heading: React.CSSProperties = {
  fontSize: 24, fontWeight: 800, color: '#f9fafb', marginBottom: 4, marginTop: 0,
}

const subhead: React.CSSProperties = {
  fontSize: 13, color: '#6b7280', marginBottom: 24, marginTop: 0,
}

const card: React.CSSProperties = {
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.07)',
  borderRadius: 12, padding: '20px 24px', marginBottom: 20,
}

const cardTitle: React.CSSProperties = {
  fontSize: 13, fontWeight: 700, color: '#9ca3af', letterSpacing: 0.5,
  textTransform: 'uppercase', marginBottom: 16,
}

const kpiRow: React.CSSProperties = {
  display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20,
}

const btnPrimary: React.CSSProperties = {
  padding: '10px 20px', background: 'linear-gradient(135deg, #1d4ed8, #1e40af)',
  color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer',
  fontSize: 14, fontWeight: 700,
}
