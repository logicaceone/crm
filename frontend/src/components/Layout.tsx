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
                background: isActive ? '#3D3A35' : 'transparent',
                borderLeft: isActive ? '3px solid #C07D4A' : '3px solid transparent',
              })}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div style={sidebarFooterStyle}>
          <div style={{ fontSize: 12, color: '#D4B896', marginBottom: 4 }}>{user.role}</div>
          <div style={{ fontWeight: 600, color: '#F0E8DE', fontSize: 13, marginBottom: 10 }}>{user.username}</div>
          <button onClick={handleLogout} style={logoutBtnStyle}>Выйти</button>
        </div>
      </aside>
      <div style={mainStyle}>
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
  background: '#2C2B28',
  display: 'flex',
  flexDirection: 'column',
  flexShrink: 0,
}

const brandStyle: CSSProperties = {
  padding: '22px 24px 18px',
  fontSize: 18,
  fontWeight: 700,
  letterSpacing: '0.08em',
  color: '#F0E8DE',
  borderBottom: '1px solid #3D3A35',
}

const navStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  padding: '12px 10px',
  gap: 2,
  flex: 1,
}

const linkStyle: CSSProperties = {
  color: '#D4B896',
  textDecoration: 'none',
  padding: '8px 12px',
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 500,
  transition: 'background 0.15s, color 0.15s',
}

const sidebarFooterStyle: CSSProperties = {
  padding: '14px 20px 20px',
  borderTop: '1px solid #3D3A35',
}

const logoutBtnStyle: CSSProperties = {
  width: '100%',
  background: 'transparent',
  border: '1px solid #3D3A35',
  color: '#D4B896',
  borderRadius: 6,
  padding: '6px 0',
  fontSize: 12,
  cursor: 'pointer',
}

const mainStyle: CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
}

const contentStyle: CSSProperties = {
  flex: 1,
  padding: 28,
  background: '#F5F4F0',
}
