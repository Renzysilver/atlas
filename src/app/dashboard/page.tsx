'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'

const API = process.env.NEXT_PUBLIC_ATLAS_API_PORT || '4001'

async function apiFetch<T>(path: string, token: string): Promise<T> {
  const url = `${path}?XTransformPort=${API}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface User {
  id: string; email: string; name: string | null; role: string
  subscription: {
    tier: string; status: string; billingCycle: string; priceNaira: number; expiresAt: string | null
  } | null
}

interface MatchPick {
  matchId: string
  homeTeam: string
  awayTeam: string
  competition: string
  kickoffUtc: string
  market: string
  selection: string
  probability: number
  confidence: number
  riskScore: number
  recommendation: string
  explanation: string | null
  // extended (Pro/VIP)
  homeWinProb?: number
  drawProb?: number
  awayWinProb?: number
  layersContributing?: number
}

interface DailyReport {
  reportDate: string
  generatedAt: string
  totalMatchesToday: number
  ultraSafePicks: MatchPick[]
  balancedPicks: MatchPick[]
  highRiskPicks: MatchPick[]
  yesterdayAccuracy: {
    available: boolean
    overallAccuracy: number | null
    correctPredictions: number
    totalPredictions: number
  }
  dataSourceStatus: {
    apiFootball: boolean; groqLlm: boolean; oddsData: boolean; weatherData: boolean
  }
}

interface ReportWrapper {
  report: DailyReport
  sentViaEmail: boolean
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tierLevel(tier: string): number {
  return { free: 0, starter: 1, pro: 2, vip: 3 }[tier] ?? 0
}

function tierColor(tier: string) {
  switch (tier) {
    case 'vip': return '#f59e0b'
    case 'pro': return '#8b5cf6'
    case 'starter': return '#3b82f6'
    default: return '#6b7280'
  }
}

function confColor(c: number) {
  if (c >= 0.70) return '#34d399'
  if (c >= 0.55) return '#fbbf24'
  return '#f87171'
}

function riskLabel(r: number) {
  if (r < 0.25) return { label: 'LOW RISK', color: '#34d399', bg: 'rgba(52,211,153,0.1)' }
  if (r < 0.45) return { label: 'MEDIUM RISK', color: '#fbbf24', bg: 'rgba(251,191,36,0.1)' }
  return { label: 'HIGH RISK', color: '#f87171', bg: 'rgba(248,113,113,0.1)' }
}

function formatKickoff(utc: string) {
  return new Date(utc).toLocaleString('en-NG', {
    timeZone: 'Africa/Lagos',
    weekday: 'short', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  }) + ' (Lagos)'
}

function formatMarket(m: string) {
  if (m === 'O_U_2_5') return 'O/U 2.5'
  return m
}

function probBar(prob: number, color: string) {
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ fontSize: 10, color: '#6b7280' }}>Probability</span>
        <span style={{ fontSize: 11, fontWeight: 700, color }}>{Math.round(prob * 100)}%</span>
      </div>
      <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${prob * 100}%`, background: color, borderRadius: 2, transition: 'width 0.6s' }} />
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SubscriberDashboard() {
  const router = useRouter()
  const [token, setToken] = useState<string | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [report, setReport] = useState<DailyReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'tips' | 'analysis' | 'history' | 'account'>('tips')
  const [betSlip, setBetSlip] = useState<MatchPick[]>([])
  const [skipped, setSkipped] = useState<string[]>([])

  useEffect(() => {
    const t = localStorage.getItem('atlas_token')
    if (!t) { router.push('/login'); return }
    setToken(t)
  }, [router])

  const refresh = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const [profile, todayWrapper] = await Promise.all([
        apiFetch<User>('/auth/me', token),
        apiFetch<ReportWrapper | { error: string }>('/report/today', token),
      ])
      setUser(profile)
      if ('report' in todayWrapper) setReport(todayWrapper.report)
    } catch {
      // silently continue — empty state shown
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { if (token) refresh() }, [token, refresh])

  const logout = () => {
    localStorage.removeItem('atlas_token')
    localStorage.removeItem('atlas_user')
    router.push('/login')
  }

  const addToSlip = (pick: MatchPick) => {
    if (!betSlip.find(p => p.matchId === pick.matchId && p.market === pick.market)) {
      setBetSlip(prev => [...prev, pick])
    }
  }

  const removeFromSlip = (matchId: string, market: string) => {
    setBetSlip(prev => prev.filter(p => !(p.matchId === matchId && p.market === market)))
  }

  const skipPick = (matchId: string) => {
    setSkipped(prev => [...prev, matchId])
  }

  const tier = user?.subscription?.tier || 'free'
  const level = tierLevel(tier)

  // Filter picks by tier
  const ultraSafe = report?.ultraSafePicks ?? []
  const balanced = report?.balancedPicks ?? []
  const highRisk = report?.highRiskPicks ?? []

  let visiblePicks: { picks: MatchPick[]; label: string; color: string; lockAbove?: string }[] = []

  if (level === 0) {
    // Free: 1 ultra safe only
    visiblePicks = [{ picks: ultraSafe.slice(0, 1), label: 'Ultra Safe Pick', color: '#34d399' }]
  } else if (level === 1) {
    // Starter: all ultra safe + 3 balanced
    visiblePicks = [
      { picks: ultraSafe, label: 'Ultra Safe Picks', color: '#34d399' },
      { picks: balanced.slice(0, 3), label: 'Balanced Picks', color: '#fbbf24' },
    ]
  } else {
    // Pro/VIP: everything
    visiblePicks = [
      { picks: ultraSafe, label: '🔒 Ultra Safe Picks', color: '#34d399' },
      { picks: balanced, label: '⚖️ Balanced Picks', color: '#fbbf24' },
      { picks: highRisk, label: '🔥 High Risk Picks', color: '#f87171' },
    ]
  }

  if (!token) return null

  return (
    <div style={page}>
      {/* Header */}
      <header style={header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: 3, color: '#60a5fa' }}>⚡ ATLAS</div>
          {user && (
            <span style={{
              padding: '3px 10px', borderRadius: 4, fontSize: 11, fontWeight: 700,
              background: `${tierColor(tier)}20`, color: tierColor(tier), letterSpacing: 0.5,
            }}>
              {tier.toUpperCase()}
            </span>
          )}
          {user?.name && (
            <span style={{ fontSize: 13, color: '#6b7280' }}>Welcome back, {user.name.split(' ')[0]}</span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {report?.yesterdayAccuracy?.available && (
            <span style={{ fontSize: 12, color: '#34d399', background: 'rgba(52,211,153,0.08)', padding: '4px 10px', borderRadius: 6 }}>
              Yesterday: {Math.round((report.yesterdayAccuracy.overallAccuracy ?? 0) * 100)}% accuracy
            </span>
          )}
          <button onClick={logout} style={{ padding: '6px 14px', background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: '#6b7280', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
            Sign Out
          </button>
        </div>
      </header>

      {/* Nav */}
      <nav style={navBar}>
        {([
          ['tips', '🎯 Today\'s Tips'],
          ['analysis', level >= 2 ? '🔬 Full Analysis' : '🔬 Analysis (Pro+)'],
          ['history', '📈 Performance'],
          ['account', '💳 My Account'],
        ] as const).map(([tab, label]) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '10px 18px', background: 'transparent', border: 'none',
              borderBottom: activeTab === tab ? '2px solid #60a5fa' : '2px solid transparent',
              color: activeTab === tab ? '#93c5fd' : '#6b7280',
              cursor: 'pointer', fontSize: 13, fontWeight: activeTab === tab ? 700 : 400,
              whiteSpace: 'nowrap',
            }}
          >
            {label}
          </button>
        ))}
      </nav>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Main content */}
        <main style={{ flex: 1, padding: '24px', overflow: 'auto' }}>

          {/* ── TODAY'S TIPS ─────────────────────────────────────── */}
          {activeTab === 'tips' && (
            <div>
              {loading ? (
                <div style={{ textAlign: 'center', padding: '60px', color: '#4b5563' }}>
                  Loading today's predictions…
                </div>
              ) : !report ? (
                <EmptyReport />
              ) : (
                <>
                  {/* Summary strip */}
                  <div style={summaryStrip}>
                    <SumCard label="Matches Today" value={String(report.totalMatchesToday)} color="#60a5fa" />
                    <SumCard label="Ultra Safe" value={String(ultraSafe.length)} color="#34d399" />
                    {level >= 1 && <SumCard label="Balanced" value={String(balanced.length)} color="#fbbf24" />}
                    {level >= 2 && <SumCard label="High Risk" value={String(highRisk.length)} color="#f87171" />}
                  </div>

                  {/* Picks */}
                  {visiblePicks.map(({ picks, label, color }) => (
                    picks.length > 0 && (
                      <div key={label} style={{ marginBottom: 28 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 }}>
                          {label}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                          {picks.filter(p => !skipped.includes(p.matchId)).map(pick => (
                            <PickCard
                              key={`${pick.matchId}-${pick.market}`}
                              pick={pick}
                              tier={tier}
                              level={level}
                              inSlip={!!betSlip.find(p => p.matchId === pick.matchId && p.market === pick.market)}
                              onAddSlip={() => addToSlip(pick)}
                              onSkip={() => skipPick(pick.matchId)}
                            />
                          ))}
                        </div>
                      </div>
                    )
                  ))}

                  {/* Upgrade CTA for lower tiers */}
                  {level < 2 && (
                    <UpgradeCta tier={tier} lockedPicks={balanced.length + highRisk.length} />
                  )}
                </>
              )}
            </div>
          )}

          {/* ── ANALYSIS (Pro/VIP) ──────────────────────────────── */}
          {activeTab === 'analysis' && (
            <div>
              {level < 2 ? (
                <div style={{ ...lockCard, textAlign: 'center' }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>🔬</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#e5e7eb', marginBottom: 8 }}>
                    Full Analysis — Pro & VIP
                  </div>
                  <p style={{ color: '#6b7280', marginBottom: 20 }}>
                    Deep-dive into confidence meters, referee cards, H2H records, injury impact scores,
                    and AI reasoning from all 17 intelligence layers. Available from Pro (₦7,500/mo).
                  </p>
                  <a href="#" style={{ ...upgradeBtnStyle }}>Upgrade to Pro →</a>
                </div>
              ) : !report ? (
                <EmptyReport />
              ) : (
                <div>
                  <h2 style={{ color: '#e5e7eb', marginBottom: 20, fontSize: 20, fontWeight: 700 }}>
                    Full Match Analysis — {new Date(report.reportDate).toLocaleDateString('en-NG', { weekday: 'long', month: 'long', day: 'numeric' })}
                  </h2>

                  {[...ultraSafe, ...balanced, ...highRisk].map(pick => (
                    <AnalysisCard key={`${pick.matchId}-${pick.market}`} pick={pick} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── PERFORMANCE ─────────────────────────────────────── */}
          {activeTab === 'history' && (
            <div>
              <h2 style={{ color: '#e5e7eb', fontSize: 20, fontWeight: 700, marginBottom: 20 }}>Platform Performance</h2>

              {report?.yesterdayAccuracy?.available ? (
                <div style={card}>
                  <div style={cardTitle}>Yesterday's Accuracy</div>
                  <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                    <BigStat
                      label="Accuracy"
                      value={`${Math.round((report.yesterdayAccuracy.overallAccuracy ?? 0) * 100)}%`}
                      color={((report.yesterdayAccuracy.overallAccuracy ?? 0) >= 0.6) ? '#34d399' : '#fbbf24'}
                    />
                    <BigStat
                      label="Correct"
                      value={String(report.yesterdayAccuracy.correctPredictions)}
                      color="#60a5fa"
                    />
                    <BigStat
                      label="Total"
                      value={String(report.yesterdayAccuracy.totalPredictions)}
                      color="#9ca3af"
                    />
                  </div>
                  <div style={{ marginTop: 16, fontSize: 12, color: '#4b5563' }}>
                    Accuracy is measured by comparing predictions against real match results.
                    Only predictions with complete match data are included.
                  </div>
                </div>
              ) : (
                <div style={{ ...card, textAlign: 'center', padding: '48px', color: '#4b5563' }}>
                  <div style={{ fontSize: 28, marginBottom: 12 }}>📊</div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: '#6b7280' }}>
                    Accuracy data builds up over time
                  </div>
                  <p style={{ marginTop: 8, fontSize: 13 }}>
                    ATLAS started tracking — results from completed matches will show here.
                    Check back after your first full match day.
                  </p>
                </div>
              )}

              {/* Data sources */}
              {report && (
                <div style={card}>
                  <div style={cardTitle}>Data Sources</div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {Object.entries(report.dataSourceStatus).map(([src, active]) => (
                      <span key={src} style={{
                        padding: '4px 12px', borderRadius: 5, fontSize: 12, fontWeight: 600,
                        background: active ? 'rgba(52,211,153,0.08)' : 'rgba(107,114,128,0.08)',
                        color: active ? '#34d399' : '#4b5563',
                        border: `1px solid ${active ? 'rgba(52,211,153,0.15)' : 'rgba(107,114,128,0.15)'}`,
                      }}>
                        {active ? '●' : '○'} {src.replace(/([A-Z])/g, ' $1').trim()}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── ACCOUNT ─────────────────────────────────────────── */}
          {activeTab === 'account' && user && (
            <div>
              <h2 style={{ color: '#e5e7eb', fontSize: 20, fontWeight: 700, marginBottom: 20 }}>My Account</h2>

              <div style={card}>
                <div style={cardTitle}>Profile</div>
                <div style={{ fontSize: 14, color: '#9ca3af', lineHeight: 2.2 }}>
                  <div><span style={{ color: '#6b7280', width: 100, display: 'inline-block' }}>Name</span>{user.name || '—'}</div>
                  <div><span style={{ color: '#6b7280', width: 100, display: 'inline-block' }}>Email</span>{user.email}</div>
                </div>
              </div>

              <div style={card}>
                <div style={cardTitle}>Subscription</div>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
                  <div style={{ padding: '16px 24px', background: `${tierColor(tier)}12`, border: `1px solid ${tierColor(tier)}30`, borderRadius: 10, textAlign: 'center' }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: tierColor(tier) }}>{tier.toUpperCase()}</div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>Current Plan</div>
                  </div>
                  {user.subscription && user.subscription.priceNaira > 0 && (
                    <div style={{ padding: '16px 24px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10 }}>
                      <div style={{ fontSize: 22, fontWeight: 800, color: '#e5e7eb' }}>₦{user.subscription.priceNaira.toLocaleString()}</div>
                      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>per {user.subscription.billingCycle}</div>
                    </div>
                  )}
                  {user.subscription?.expiresAt && (
                    <div style={{ padding: '16px 24px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10 }}>
                      <div style={{ fontSize: 16, fontWeight: 700, color: '#e5e7eb' }}>
                        {new Date(user.subscription.expiresAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </div>
                      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>Renews / Expires</div>
                    </div>
                  )}
                </div>

                {/* Tier comparison */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                  {[
                    { t: 'free', price: 'Free', features: ['1 safe pick/day', 'Email delivery', 'Basic accuracy stats'] },
                    { t: 'starter', price: '₦3,000/mo', features: ['All ultra-safe picks', '3 balanced picks', 'Email delivery', 'Basic stats'] },
                    { t: 'pro', price: '₦7,500/mo', features: ['All picks, all leagues', 'Full AI analysis', 'Confidence meters', 'H2H insights', 'Injury impact'] },
                    { t: 'vip', price: '₦15,000/mo', features: ['Everything in Pro', 'Early 5:30 AM delivery', 'Bet slip builder', 'Weekly performance card', 'Priority support'] },
                  ].map(({ t, price, features }) => (
                    <div key={t} style={{
                      padding: '16px', borderRadius: 10,
                      background: tier === t ? `${tierColor(t)}12` : 'rgba(255,255,255,0.02)',
                      border: `1px solid ${tier === t ? tierColor(t) + '40' : 'rgba(255,255,255,0.06)'}`,
                    }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: tierColor(t), marginBottom: 6 }}>{t.toUpperCase()}</div>
                      <div style={{ fontSize: 15, fontWeight: 800, color: '#e5e7eb', marginBottom: 10 }}>{price}</div>
                      {features.map(f => (
                        <div key={f} style={{ fontSize: 11, color: '#6b7280', marginBottom: 3 }}>✓ {f}</div>
                      ))}
                      {tier !== t && (
                        <div style={{ marginTop: 10, fontSize: 11, color: '#6b7280', fontStyle: 'italic' }}>
                          Contact admin to upgrade
                        </div>
                      )}
                      {tier === t && (
                        <div style={{ marginTop: 10, fontSize: 11, color: tierColor(t), fontWeight: 600 }}>
                          ← Current plan
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </main>

        {/* Bet Slip Sidebar */}
        {betSlip.length > 0 && (
          <aside style={betSlipPanel}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#e5e7eb', marginBottom: 16, letterSpacing: 0.5 }}>
              🎫 BET SLIP ({betSlip.length})
            </div>
            {betSlip.map(pick => (
              <div key={`${pick.matchId}-${pick.market}`} style={{ marginBottom: 10, padding: '10px 12px', background: 'rgba(255,255,255,0.04)', borderRadius: 8, fontSize: 12 }}>
                <div style={{ fontWeight: 600, color: '#e5e7eb', marginBottom: 2 }}>
                  {pick.homeTeam} vs {pick.awayTeam}
                </div>
                <div style={{ color: '#6b7280', marginBottom: 4 }}>{pick.competition}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: '#60a5fa', fontWeight: 700 }}>{formatMarket(pick.market)}: {pick.selection}</span>
                  <button
                    onClick={() => removeFromSlip(pick.matchId, pick.market)}
                    style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 14, padding: '0 4px' }}
                  >
                    ×
                  </button>
                </div>
                <div style={{ fontSize: 10, color: '#4b5563', marginTop: 3 }}>
                  Conf: {Math.round(pick.confidence * 100)}%
                </div>
              </div>
            ))}
            <div style={{ marginTop: 12, padding: '10px', background: 'rgba(96,165,250,0.06)', borderRadius: 8, border: '1px solid rgba(96,165,250,0.15)', fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>
              Combined confidence:<br />
              <span style={{ color: '#60a5fa', fontSize: 16, fontWeight: 800 }}>
                {Math.round(betSlip.reduce((acc, p) => acc * p.probability, 1) * 100)}%
              </span>
            </div>
            <button
              onClick={() => setBetSlip([])}
              style={{ marginTop: 10, width: '100%', padding: '8px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}
            >
              Clear Slip
            </button>
          </aside>
        )}
      </div>
    </div>
  )
}

// ─── Pick Card ────────────────────────────────────────────────────────────────

function PickCard({
  pick, tier, level, inSlip, onAddSlip, onSkip
}: {
  pick: MatchPick; tier: string; level: number; inSlip: boolean
  onAddSlip: () => void; onSkip: () => void
}) {
  const risk = riskLabel(pick.riskScore)
  const color = confColor(pick.confidence)

  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 12, padding: '16px 20px',
    }}>
      {/* Match header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#f9fafb' }}>
            {pick.homeTeam} vs {pick.awayTeam}
          </div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
            {pick.competition} · {formatKickoff(pick.kickoffUtc)}
          </div>
        </div>
        <span style={{ padding: '3px 10px', borderRadius: 5, fontSize: 11, fontWeight: 700, background: risk.bg, color: risk.color }}>
          {risk.label}
        </span>
      </div>

      {/* Pick */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <span style={{ padding: '6px 14px', borderRadius: 6, background: 'rgba(96,165,250,0.12)', color: '#93c5fd', fontSize: 14, fontWeight: 800, letterSpacing: 0.5 }}>
          {formatMarket(pick.market)}: {pick.selection}
        </span>
        <span style={{ fontSize: 12, color: '#6b7280' }}>{pick.recommendation?.replace(/_/g, ' ')}</span>
      </div>

      {/* Confidence meter */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontSize: 11, color: '#6b7280' }}>Confidence</span>
          <span style={{ fontSize: 12, fontWeight: 700, color }}>{Math.round(pick.confidence * 100)}%</span>
        </div>
        <div style={{ height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pick.confidence * 100}%`, background: `linear-gradient(90deg, ${color}80, ${color})`, borderRadius: 3, transition: 'width 0.6s' }} />
        </div>
      </div>

      {probBar(pick.probability, '#60a5fa')}

      {/* Outcome probs (Pro/VIP) */}
      {level >= 2 && pick.homeWinProb !== undefined && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          {[
            { label: 'Home Win', p: pick.homeWinProb ?? 0 },
            { label: 'Draw', p: pick.drawProb ?? 0 },
            { label: 'Away Win', p: pick.awayWinProb ?? 0 },
          ].map(({ label, p }) => (
            <div key={label} style={{ flex: 1, textAlign: 'center', padding: '8px', background: 'rgba(255,255,255,0.02)', borderRadius: 6 }}>
              <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 2 }}>{label}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#e5e7eb' }}>{Math.round(p * 100)}%</div>
            </div>
          ))}
        </div>
      )}

      {/* AI Explanation (Pro/VIP) */}
      {level >= 2 && pick.explanation && (
        <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(96,165,250,0.04)', border: '1px solid rgba(96,165,250,0.1)', borderRadius: 8 }}>
          <div style={{ fontSize: 10, color: '#4b5563', marginBottom: 4, fontWeight: 700, letterSpacing: 0.5 }}>AI REASONING</div>
          <div style={{ fontSize: 12, color: '#9ca3af', lineHeight: 1.6 }}>{pick.explanation}</div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        {level >= 2 && (
          <button
            onClick={onAddSlip}
            disabled={inSlip}
            style={{
              padding: '7px 14px', borderRadius: 6, border: 'none', cursor: inSlip ? 'default' : 'pointer', fontSize: 12, fontWeight: 600,
              background: inSlip ? 'rgba(52,211,153,0.12)' : 'rgba(96,165,250,0.12)',
              color: inSlip ? '#34d399' : '#93c5fd',
            }}
          >
            {inSlip ? '✓ In Slip' : '+ Add to Slip'}
          </button>
        )}
        <button
          onClick={onSkip}
          style={{ padding: '7px 14px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.07)', background: 'transparent', color: '#6b7280', cursor: 'pointer', fontSize: 12 }}
        >
          Skip This One
        </button>
      </div>
    </div>
  )
}

// ─── Analysis Card (Pro/VIP deep dive) ───────────────────────────────────────

function AnalysisCard({ pick }: { pick: MatchPick }) {
  return (
    <div style={{ ...card, marginBottom: 16 }}>
      <div style={{ fontSize: 17, fontWeight: 700, color: '#f9fafb', marginBottom: 4 }}>
        {pick.homeTeam} <span style={{ color: '#4b5563' }}>vs</span> {pick.awayTeam}
      </div>
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 14 }}>
        {pick.competition} · {formatKickoff(pick.kickoffUtc)}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, marginBottom: 14 }}>
        <MetricBox label="Prediction" value={`${formatMarket(pick.market)}: ${pick.selection}`} color="#93c5fd" />
        <MetricBox label="Probability" value={`${Math.round(pick.probability * 100)}%`} color="#60a5fa" />
        <MetricBox label="Confidence" value={`${Math.round(pick.confidence * 100)}%`} color={confColor(pick.confidence)} />
        <MetricBox label="Risk Score" value={`${Math.round(pick.riskScore * 100)}%`} color={pick.riskScore > 0.45 ? '#f87171' : '#34d399'} />
        {pick.layersContributing && <MetricBox label="Layers Used" value={String(pick.layersContributing)} color="#9ca3af" />}
      </div>

      {/* Outcome distribution */}
      {pick.homeWinProb !== undefined && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: '#4b5563', marginBottom: 8, fontWeight: 700, letterSpacing: 0.5 }}>OUTCOME DISTRIBUTION</div>
          <div style={{ display: 'flex', gap: 1, height: 24, borderRadius: 6, overflow: 'hidden' }}>
            <div style={{ width: `${(pick.homeWinProb ?? 0) * 100}%`, background: '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#fff', fontWeight: 700, minWidth: 0 }}>
              {Math.round((pick.homeWinProb ?? 0) * 100) > 10 ? `H ${Math.round((pick.homeWinProb ?? 0) * 100)}%` : ''}
            </div>
            <div style={{ width: `${(pick.drawProb ?? 0) * 100}%`, background: '#6b7280', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#fff', fontWeight: 700, minWidth: 0 }}>
              {Math.round((pick.drawProb ?? 0) * 100) > 10 ? `D ${Math.round((pick.drawProb ?? 0) * 100)}%` : ''}
            </div>
            <div style={{ width: `${(pick.awayWinProb ?? 0) * 100}%`, background: '#8b5cf6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#fff', fontWeight: 700, minWidth: 0 }}>
              {Math.round((pick.awayWinProb ?? 0) * 100) > 10 ? `A ${Math.round((pick.awayWinProb ?? 0) * 100)}%` : ''}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: 10, color: '#6b7280' }}>
            <span><span style={{ color: '#3b82f6' }}>■</span> {pick.homeTeam}</span>
            <span><span style={{ color: '#6b7280' }}>■</span> Draw</span>
            <span><span style={{ color: '#8b5cf6' }}>■</span> {pick.awayTeam}</span>
          </div>
        </div>
      )}

      {/* AI reasoning */}
      {pick.explanation && (
        <div style={{ padding: '12px 16px', background: 'rgba(96,165,250,0.04)', border: '1px solid rgba(96,165,250,0.1)', borderRadius: 8 }}>
          <div style={{ fontSize: 10, color: '#4b5563', marginBottom: 6, fontWeight: 700, letterSpacing: 0.5 }}>
            ATLAS AI REASONING ({pick.layersContributing ?? '?'} intelligence layers)
          </div>
          <div style={{ fontSize: 13, color: '#9ca3af', lineHeight: 1.7 }}>{pick.explanation}</div>
        </div>
      )}
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function EmptyReport() {
  return (
    <div style={{ textAlign: 'center', padding: '60px', color: '#4b5563' }}>
      <div style={{ fontSize: 40, marginBottom: 16 }}>⏳</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: '#6b7280', marginBottom: 8 }}>No report yet for today</div>
      <p style={{ fontSize: 14 }}>
        ATLAS generates today's predictions at 6:00 AM Lagos time.<br />
        Check back later, or ask your admin to trigger a manual run.
      </p>
    </div>
  )
}

function SumCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '12px 20px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10 }}>
      <div style={{ fontSize: 24, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{label}</div>
    </div>
  )
}

function UpgradeCta({ tier, lockedPicks }: { tier: string; lockedPicks: number }) {
  const nextTier = tier === 'free' ? 'Starter' : 'Pro'
  const nextPrice = tier === 'free' ? '₦3,000/mo' : '₦7,500/mo'
  return (
    <div style={{ ...lockCard, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
      <div style={{ fontSize: 24, marginBottom: 8 }}>🔒</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#e5e7eb', marginBottom: 6 }}>
        {lockedPicks} more picks hidden
      </div>
      <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 16, maxWidth: 380 }}>
        Upgrade to {nextTier} ({nextPrice}) to unlock all picks,
        {tier === 'free' ? ' email delivery, and weekly summaries.' : ' full AI analysis, H2H insights, injury impact scores, and the bet slip builder.'}
      </p>
      <a href="/dashboard?tab=account" style={upgradeBtnStyle}>Upgrade to {nextTier} →</a>
    </div>
  )
}

function MetricBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ padding: '10px 12px', background: 'rgba(255,255,255,0.02)', borderRadius: 7, border: '1px solid rgba(255,255,255,0.05)' }}>
      <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color }}>{value}</div>
    </div>
  )
}

function BigStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 36, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>{label}</div>
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const page: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', minHeight: '100vh',
  background: '#0d1117',
  fontFamily: "'Helvetica Neue', Arial, sans-serif",
  color: '#e5e7eb',
}

const header: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '16px 24px',
  background: '#0a0d12',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
  flexWrap: 'wrap', gap: 12,
}

const navBar: React.CSSProperties = {
  display: 'flex', overflowX: 'auto',
  background: '#0a0d12',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
  padding: '0 24px',
}

const summaryStrip: React.CSSProperties = {
  display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 24,
}

const card: React.CSSProperties = {
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.07)',
  borderRadius: 12, padding: '20px 24px', marginBottom: 16,
}

const cardTitle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: '#6b7280', letterSpacing: 1,
  textTransform: 'uppercase', marginBottom: 14,
}

const lockCard: React.CSSProperties = {
  background: 'rgba(255,255,255,0.02)',
  border: '1px dashed rgba(255,255,255,0.1)',
  borderRadius: 12, padding: '32px 24px', marginBottom: 16,
}

const upgradeBtnStyle: React.CSSProperties = {
  padding: '10px 24px', borderRadius: 8,
  background: 'linear-gradient(135deg, #1d4ed8, #7c3aed)',
  color: '#fff', fontSize: 14, fontWeight: 700, textDecoration: 'none',
}

const betSlipPanel: React.CSSProperties = {
  width: 240, padding: '20px 16px', background: '#0a0d12',
  borderLeft: '1px solid rgba(255,255,255,0.06)',
  overflowY: 'auto', flexShrink: 0,
}
