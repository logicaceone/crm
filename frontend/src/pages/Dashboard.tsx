import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export function Dashboard() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div style={{ padding: 24 }}>
      <h1>Dashboard</h1>
      <p>Welcome, <strong>{user?.username}</strong></p>
      <p>Role: {user?.role}</p>
      <button onClick={handleLogout}>Logout</button>
    </div>
  )
}
