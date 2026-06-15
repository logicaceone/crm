import { useState, FormEvent } from 'react'
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
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return null
  if (user) return <Navigate to="/dashboard" replace />

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      <form
        onSubmit={handleSubmit}
        style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 300 }}
      >
        <h2 style={{ margin: 0 }}>CRM Login</h2>
        {error && <div style={{ color: 'red', fontSize: 14 }}>{error}</div>}
        <input
          placeholder="Username"
          value={username}
          onChange={e => setUsername(e.target.value)}
          required
          autoFocus
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
        />
        <button type="submit" disabled={submitting}>
          {submitting ? 'Logging in…' : 'Login'}
        </button>
      </form>
    </div>
  )
}
