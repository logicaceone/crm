import { useState, useEffect, useRef, FormEvent, CSSProperties } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

const BLOCK_SECONDS = 15 * 60  // matches backend Retry-After

export function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [blockedUntil, setBlockedUntil] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const { login, user, loading } = useAuth()
  const navigate = useNavigate()

  // Tick once a second while a block is active so the countdown
  // re-renders. Stop ticking immediately after the block clears.
  useEffect(() => {
    if (blockedUntil == null) return
    setNow(Date.now())
    tickRef.current = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      if (tickRef.current) clearInterval(tickRef.current)
      tickRef.current = null
    }
  }, [blockedUntil])

  useEffect(() => {
    if (blockedUntil != null && now >= blockedUntil) setBlockedUntil(null)
  }, [now, blockedUntil])

  const isBlocked = blockedUntil != null && now < blockedUntil
  const remaining = isBlocked ? Math.ceil((blockedUntil! - now) / 1000) : 0

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await login(username, password)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      const e = err as Error & { status?: number; retryAfter?: number }
      if (e.status === 429) {
        const seconds = e.retryAfter && e.retryAfter > 0 ? e.retryAfter : BLOCK_SECONDS
        setBlockedUntil(Date.now() + seconds * 1000)
        setError(
          'Слишком много попыток входа. Попробуйте снова через 15 минут.'
        )
      } else {
        setError(e.message || 'Ошибка входа')
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return null
  if (user) return <Navigate to="/dashboard" replace />

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <div style={brandStyle}>CRM</div>
        <form onSubmit={handleSubmit} style={formStyle}>
          {error && <div style={errStyle}>{error}</div>}
          <label style={labelStyle}>
            Логин
            <input
              placeholder="username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
              autoFocus
              disabled={isBlocked}
            />
          </label>
          <label style={labelStyle}>
            Пароль
            <input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              disabled={isBlocked}
            />
          </label>
          <button
            type="submit"
            disabled={submitting || isBlocked}
            style={{ marginTop: 4 }}
          >
            {isBlocked
              ? 'Подождите 15 минут'
              : submitting
              ? 'Вход…'
              : 'Войти'}
          </button>
          {isBlocked && (
            <div style={countdownStyle}>
              Повторная попытка через {formatRemaining(remaining)}
            </div>
          )}
        </form>
      </div>
    </div>
  )
}

function formatRemaining(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

const pageStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  height: '100vh',
  background: '#F5F4F0',
}

const cardStyle: CSSProperties = {
  background: '#FEFEFE',
  border: '1px solid #E8DDD3',
  borderRadius: 10,
  padding: '36px 32px',
  width: 340,
  boxShadow: '0 4px 24px rgba(44,43,40,0.07)',
}

const brandStyle: CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  color: '#2C2B28',
  letterSpacing: '0.08em',
  marginBottom: 28,
  textAlign: 'center',
}

const formStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
}

const labelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 5,
  fontSize: 13,
  fontWeight: 500,
  color: '#2C2B28',
}

const errStyle: CSSProperties = {
  color: '#dc2626',
  fontSize: 13,
  background: '#fef2f2',
  border: '1px solid #fecaca',
  borderRadius: 6,
  padding: '8px 12px',
}

const countdownStyle: CSSProperties = {
  fontSize: 12,
  color: '#8C7B6E',
  textAlign: 'center',
  marginTop: 4,
}
