import { ReactNode } from 'react'
import { useAuth, Role } from '../contexts/AuthContext'
import { Forbidden } from '../pages/Forbidden'

interface Props {
  allowedRoles: Role[]
  children: ReactNode
}

export function RoleRoute({ allowedRoles, children }: Props) {
  const { user } = useAuth()
  if (!user) return null
  if (!allowedRoles.includes(user.role)) return <Forbidden />
  return <>{children}</>
}
