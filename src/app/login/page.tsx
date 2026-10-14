'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const ATLAS_API_PORT = process.env.NEXT_PUBLIC_ATLAS_API_PORT || '4001'

async function apiPost(path: string, body: object) {
  const res = await fetch(`${path}?XTransformPort=${ATLAS_API_PORT}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}

export default function LoginPage() {
  const router = useRouter()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const data = mode === 'login'
        ? await apiPost('/auth/login', { email, password })
        : await apiPost('/auth/register', { email, password, name })

      localStorage.setItem('atlas_token', data.token)
      localStorage.setItem('atlas_user', JSON.stringify(data.user))

      if (data.user.role === 'admin') {
        router.push('/admin')
      } else {
        router.push('/dashboard')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0a0a0f 0%, #0d1117 50%, #0a0a0f 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'Helvetica Neue', Arial, sans-serif",
    }}>
      <div style={{
        width: '100%',
        maxWidth: 400,
        padding: '40px 32px',
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 16,
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: 4, color: '#60a5fa' }}>⚡ ATLAS</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4, letterSpacing: 1 }}>
            INSTITUTIONAL FOOTBALL INTELLIGENCE
          </div>
        </div>

        {/* Tab toggle */}
        <div style={{ display: 'flex', background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: 4, marginBottom: 24 }}>
          {(['login', 'register'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                flex: 1,
                padding: '8px',
                background: mode === m ? '#1d4ed8' : 'transparent',
                color: mode === m ? '#fff' : '#9ca3af',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
                textTransform: 'capitalize',
                transition: 'all 0.2s',
              }}
            >
              {m === 'login' ? 'Sign In' : 'Sign Up'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit}>
          {mode === 'register' && (
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, color: '#9ca3af', marginBottom: 6, fontWeight: 600, letterSpacing: 0.5 }}>
                FULL NAME
              </label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Your name"
                style={inputStyle}
              />
            </div>
          )}

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, color: '#9ca3af', marginBottom: 6, fontWeight: 600, letterSpacing: 0.5 }}>
              EMAIL ADDRESS
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'block', fontSize: 12, color: '#9ca3af', marginBottom: 6, fontWeight: 600, letterSpacing: 0.5 }}>
              PASSWORD
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={mode === 'register' ? 'Minimum 8 characters' : '••••••••'}
              required
              style={inputStyle}
            />
          </div>

          {error && (
            <div style={{
              marginBottom: 16,
              padding: '10px 14px',
              background: 'rgba(239,68,68,0.1)',
              border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: 8,
              color: '#f87171',
              fontSize: 13,
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '12px',
              background: loading ? '#374151' : 'linear-gradient(135deg, #1d4ed8, #1e40af)',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: 0.5,
            }}
          >
            {loading ? 'Please wait…' : mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        {mode === 'register' && (
          <div style={{ marginTop: 20, padding: '12px 16px', background: 'rgba(96,165,250,0.08)', borderRadius: 8, fontSize: 12, color: '#6b7280' }}>
            <div style={{ fontWeight: 600, color: '#9ca3af', marginBottom: 4 }}>SUBSCRIPTION TIERS</div>
            <div>🆓 Free — 1 safe pick/day</div>
            <div>⚡ Starter — ₦3,000/mo · All safe + 3 balanced</div>
            <div>🎯 Pro — ₦7,500/mo · All picks, all leagues</div>
            <div>👑 VIP — ₦15,000/mo · Early delivery + all features</div>
          </div>
        )}
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 8,
  color: '#e5e7eb',
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box',
}
