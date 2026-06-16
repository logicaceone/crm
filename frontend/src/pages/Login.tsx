import { useState, FormEvent, CSSProperties } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const { login, user, loading } = useAuth()
  const navigate = useNavigate()

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await login(username, password)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка входа')
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
            />
          </label>
          <button type="submit" disabled={submitting} style={{ marginTop: 4 }}>
            {submitting ? 'Вход…' : 'Войти'}
          </button>
        </form>
      </div>
    </div>
  )
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
