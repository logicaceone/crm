import { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export function PrivateRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()

  if (loading) return <div>Loading…</div>
  if (!user) return <Navigate to="/login" replace />

  return <>{children}</>
}
