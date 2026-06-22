import { useState, useEffect, useRef, CSSProperties } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useAuth, Role } from '../contexts/AuthContext'

interface MenuItem {
  to: string
  label: string
  roles: Role[]
}

const MENU: MenuItem[] = [
  { to: '/dashboard', label: 'Дашборд', roles: ['root', 'admin', 'manager', 'viewer'] },
  { to: '/subscribers', label: 'Подписчики', roles: ['root', 'admin', 'manager', 'viewer'] },
  { to: '/channels', label: 'Каналы', roles: ['root', 'admin', 'manager'] },
  { to: '/expenses', label: 'Расходы', roles: ['root', 'admin', 'manager'] },
  { to: '/sales', label: 'Продажи', roles: ['root', 'admin', 'manager'] },
  { to: '/budget', label: 'Бюджет', roles: ['root', 'admin', 'manager'] },
  { to: '/cpf', label: 'Аналитика CPF', roles: ['root', 'admin', 'manager'] },
  { to: '/users', label: 'Пользователи', roles: ['root', 'admin'] },
  { to: '/activity', label: 'Действия', roles: ['root', 'admin'] },
  { to: '/settings', label: 'Настройки', roles: ['root'] },
]

export function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [navState, setNavState] = useState<'idle' | 'active' | 'done'>('idle')
  const prevPath = useRef(location.pathname)
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (prevPath.current === location.pathname) return
    prevPath.current = location.pathname
    if (doneTimer.current) clearTimeout(doneTimer.current)
    setNavState('active')
    doneTimer.current = setTimeout(() => {
      setNavState('done')
      setTimeout(() => setNavState('idle'), 220)
    }, 700)
    return () => { if (doneTimer.current) clearTimeout(doneTimer.current) }
  }, [location.pathname])

  if (!user) return null

  const items = MENU.filter(item => item.roles.includes(user.role))

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  function closeDrawer() {
    setDrawerOpen(false)
  }

  return (
    <div style={shellStyle}>
      {/* Sidebar drawer backdrop */}
      <div
        className={`sidebar-overlay${drawerOpen ? ' open' : ''}`}
        onClick={closeDrawer}
      />

      {/* Sidebar */}
      <aside style={sidebarStyle} className={`sidebar-drawer${drawerOpen ? ' open' : ''}`}>
        <div style={brandStyle}>CRM TG</div>
        <nav style={navStyle}>
          {items.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={closeDrawer}
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

      {/* Main area */}
      <div style={mainStyle} className="layout-main">
        {/* Mobile top bar */}
        <div className="mobile-header">
          <button className="burger-btn" onClick={() => setDrawerOpen(o => !o)} aria-label="Меню">
            ☰
          </button>
          <span className="mobile-header-title">CRM TG</span>
        </div>

        <main style={contentStyle} className="layout-content">
          <div className={`nav-progress${navState === 'active' ? ' active' : navState === 'done' ? ' done' : ''}`} />
          <div key={location.pathname} className="page-enter">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}

const shellStyle: CSSProperties = {
  display: 'flex',
  minHeight: '100vh',
  flex: 1,
}

const sidebarStyle: CSSProperties = {
  width: 220,
  background: '#2C2B28',
  display: 'flex',
  flexDirection: 'column',
  flexShrink: 0,
  position: 'sticky',
  top: 0,
  height: '100vh',
  overflowY: 'auto',
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
  padding: '9px 14px',
  borderRadius: 8,
  fontSize: 14,
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
  borderRadius: 8,
  padding: '7px 0',
  fontSize: 13,
  cursor: 'pointer',
  boxShadow: 'none',
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
  position: 'relative',
}
