import { CSSProperties } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth, Role } from '../contexts/AuthContext'

interface MenuItem {
  to: string
  label: string
  roles: Role[]
}

const MENU: MenuItem[] = [
  { to: '/dashboard', label: 'Дашборд', roles: ['admin', 'manager', 'viewer'] },
  { to: '/channels', label: 'Каналы', roles: ['admin', 'manager'] },
  { to: '/purchases', label: 'Закупки', roles: ['admin', 'manager'] },
  { to: '/sales', label: 'Продажи', roles: ['admin', 'manager'] },
  { to: '/budget', label: 'Бюджет', roles: ['admin', 'manager'] },
  { to: '/users', label: 'Пользователи', roles: ['admin'] },
]

export function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  if (!user) return null

  const items = MENU.filter(item => item.roles.includes(user.role))

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div style={shellStyle}>
      <aside style={sidebarStyle}>
        <div style={brandStyle}>CRM</div>
        <nav style={navStyle}>
          {items.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              style={({ isActive }) => ({
                ...linkStyle,
                background: isActive ? '#1f2937' : 'transparent',
              })}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div style={mainStyle}>
        <header style={headerStyle}>
          <div>
            <strong>{user.username}</strong>
            <span style={{ marginLeft: 8, color: '#666' }}>({user.role})</span>
          </div>
          <button onClick={handleLogout}>Выйти</button>
        </header>
        <main style={contentStyle}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}

const shellStyle: CSSProperties = {
  display: 'flex',
  minHeight: '100vh',
}

const sidebarStyle: CSSProperties = {
  width: 220,
  background: '#111827',
  color: '#f9fafb',
  display: 'flex',
  flexDirection: 'column',
}

const brandStyle: CSSProperties = {
  padding: '20px 24px',
  fontSize: 20,
  fontWeight: 700,
  borderBottom: '1px solid #1f2937',
}

const navStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  padding: 12,
  gap: 4,
}

const linkStyle: CSSProperties = {
  color: '#f9fafb',
  textDecoration: 'none',
  padding: '8px 12px',
  borderRadius: 6,
  fontSize: 14,
}

const mainStyle: CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
}

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 24px',
  borderBottom: '1px solid #e5e7eb',
  background: '#fff',
}

const contentStyle: CSSProperties = {
  flex: 1,
  padding: 24,
  background: '#f9fafb',
}
