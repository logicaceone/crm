import { useState, useEffect, useRef, FormEvent, CSSProperties } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

const BLOCK_SECONDS = 15 * 60  // matches backend Retry-After

// Public site key — safe to ship in client bundle. Server-side
// assessment uses the project's API key, kept out of the frontend.
const RECAPTCHA_SITE_KEY = '6Lf4ny0tAAAAANKu_g9CJ42kxecqj-soO_FeafX0'

declare global {
  interface Window {
    grecaptcha?: {
      enterprise: {
        ready: (cb: () => void) => void
        getResponse: (widgetId?: number) => string
        reset: (widgetId?: number) => void
        render: (
          el: HTMLElement,
          opts: { sitekey: string; action?: string },
        ) => number
      }
    }
  }
}

export function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [blockedUntil, setBlockedUntil] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const captchaRef = useRef<HTMLDivElement | null>(null)
  const widgetIdRef = useRef<number | null>(null)
  const { login, user, loading } = useAuth()
  const navigate = useNavigate()

  // Render the reCAPTCHA widget once the enterprise.js script has
  // loaded. Explicit render (instead of auto-discovery via the
  // `g-recaptcha` class) is necessary because the script may load
  // after React has already mounted the form.
  useEffect(() => {
    let cancelled = false
    function tryRender() {
      if (cancelled) return
      const g = window.grecaptcha?.enterprise
      if (!g || !captchaRef.current || widgetIdRef.current != null) {
        if (!g) setTimeout(tryRender, 200)
        return
      }
      g.ready(() => {
        if (cancelled || !captchaRef.current || widgetIdRef.current != null) return
        widgetIdRef.current = g.render(captchaRef.current, {
          sitekey: RECAPTCHA_SITE_KEY,
          action: 'LOGIN',
        })
      })
    }
    tryRender()
    return () => { cancelled = true }
  }, [])

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

    const g = window.grecaptcha?.enterprise
    const captchaToken =
      g && widgetIdRef.current != null ? g.getResponse(widgetIdRef.current) : ''
    if (!captchaToken) {
      setError('Подтвердите, что вы не робот.')
      return
    }

    setSubmitting(true)
    try {
      await login(username, password, captchaToken)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      // Captcha tokens are single-use and expire in 2 minutes — reset
      // the widget after every attempt (success or failure) so the
      // user can retry without a stale token.
      if (g && widgetIdRef.current != null) g.reset(widgetIdRef.current)
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
          <div
            ref={captchaRef}
            style={{
              display: 'flex',
              justifyContent: 'center',
              minHeight: 78,
              marginTop: 2,
            }}
          />
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
