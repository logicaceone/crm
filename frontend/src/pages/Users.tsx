import { useState, useEffect, FormEvent, CSSProperties } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { apiFetch } from '../lib/api'

interface User {
  id: number
  username: string
  role: 'admin' | 'manager' | 'viewer'
  created_at: string
}

const ROLES = ['admin', 'manager', 'viewer'] as const

export function Users() {
  const { user: me } = useAuth()
  const [users, setUsers] = useState<User[]>([])
  const [fetchError, setFetchError] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newRole, setNewRole] = useState<'admin' | 'manager' | 'viewer'>('viewer')
  const [modalError, setModalError] = useState('')
  const [modalSubmitting, setModalSubmitting] = useState(false)

  useEffect(() => {
    loadUsers()
  }, [])

  async function loadUsers() {
    const res = await apiFetch('/api/users')
    if (res.ok) {
      setUsers(await res.json())
    } else {
      setFetchError('Failed to load users')
    }
  }

  async function handleRoleChange(userId: number, role: 'admin' | 'manager' | 'viewer') {
    const res = await apiFetch(`/api/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    })
    if (res.ok) {
      const updated: User = await res.json()
      setUsers(prev => prev.map(u => (u.id === userId ? updated : u)))
    }
  }

  async function handleDelete(userId: number, username: string) {
    if (!confirm(`Delete user "${username}"?`)) return
    const res = await apiFetch(`/api/users/${userId}`, { method: 'DELETE' })
    if (res.ok || res.status === 204) {
      setUsers(prev => prev.filter(u => u.id !== userId))
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setModalError('')
    setModalSubmitting(true)
    try {
      const res = await apiFetch('/api/users', {
        method: 'POST',
        body: JSON.stringify({ username: newUsername, password: newPassword, role: newRole }),
      })
      if (!res.ok) {
        const data = await res.json()
        setModalError(data.detail ?? 'Failed to create user')
        return
      }
      const created: User = await res.json()
      setUsers(prev => [...prev, created])
      setShowModal(false)
      setNewUsername('')
      setNewPassword('')
      setNewRole('viewer')
    } finally {
      setModalSubmitting(false)
    }
  }

  if (!me) return null

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Пользователи</h1>
        <button onClick={() => setShowModal(true)}>+ Add User</button>
      </div>

      {fetchError && <div style={{ color: 'red', marginBottom: 12 }}>{fetchError}</div>}

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={thStyle}>Username</th>
            <th style={thStyle}>Role</th>
            <th style={thStyle}>Created At</th>
            <th style={thStyle}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map(u => (
            <tr key={u.id}>
              <td style={tdStyle}>
                {u.username}
                {u.id === me.id && <span style={{ marginLeft: 8, color: '#888', fontSize: 12 }}>(you)</span>}
              </td>
              <td style={tdStyle}>
                <select
                  value={u.role}
                  onChange={e => handleRoleChange(u.id, e.target.value as 'admin' | 'manager' | 'viewer')}
                  disabled={u.id === me.id}
                >
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </td>
              <td style={tdStyle}>
                {new Date(u.created_at).toLocaleString()}
              </td>
              <td style={tdStyle}>
                <button
                  onClick={() => handleDelete(u.id, u.username)}
                  disabled={u.id === me.id}
                  style={{ color: u.id === me.id ? '#bbb' : '#d00', cursor: u.id === me.id ? 'not-allowed' : 'pointer' }}
                  title={u.id === me.id ? "Can't delete yourself" : `Delete ${u.username}`}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {showModal && (
        <div style={overlayStyle}>
          <div style={modalStyle}>
            <h2 style={{ margin: '0 0 16px' }}>Add User</h2>
            <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {modalError && <div style={{ color: 'red', fontSize: 14 }}>{modalError}</div>}
              <input
                placeholder="Username"
                value={newUsername}
                onChange={e => setNewUsername(e.target.value)}
                required
                autoFocus
              />
              <input
                type="password"
                placeholder="Password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                required
              />
              <select
                value={newRole}
                onChange={e => setNewRole(e.target.value as 'admin' | 'manager' | 'viewer')}
              >
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                <button type="button" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" disabled={modalSubmitting}>
                  {modalSubmitting ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

const thStyle: CSSProperties = {
  textAlign: 'left',
  padding: '8px 12px',
  borderBottom: '2px solid #ddd',
  fontWeight: 600,
}

const tdStyle: CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid #eee',
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 100,
}

const modalStyle: CSSProperties = {
  background: '#FEFEFE',
  borderRadius: 8,
  padding: 24,
  width: 360,
  boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
}
