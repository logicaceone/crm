import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from 'react'
import { useNavigate } from 'react-router-dom'
import { setHandle401 } from '../lib/api'

export type Role = 'root' | 'admin' | 'manager' | 'viewer'

interface User {
  id: number
  username: string
  role: Role
}

interface AuthContextValue {
  user: User | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  const handleUnauthorized = useCallback(() => {
    setUser(null)
    navigate('/login', { replace: true })
  }, [navigate])

  useEffect(() => {
    setHandle401(handleUnauthorized)
  }, [handleUnauthorized])

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(res => (res.ok ? res.json() : null))
      .then(data => setUser(data))
      .finally(() => setLoading(false))
  }, [])

  const login = async (username: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (!res.ok) {
      let detail = 'Login failed'
      try {
        const data = await res.json()
        detail = data.detail ?? detail
      } catch {
        // Non-JSON body (proxy 429, network blob) — keep the default.
      }
      const err = new Error(detail) as Error & { status?: number; retryAfter?: number }
      err.status = res.status
      const retry = res.headers.get('Retry-After')
      if (retry) err.retryAfter = Number(retry)
      throw err
    }
    setUser(await res.json())
  }

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    } catch {
      // Even if the network call fails, drop the local user state and
      // redirect — the cookie may or may not be cleared, but the SPA
      // should not continue showing authenticated content.
    }
    setUser(null)
    navigate('/login', { replace: true })
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
