import { useState, useEffect, useRef, FormEvent, CSSProperties } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { useConfirm } from '../contexts/ConfirmContext'
import { apiFetch } from '../lib/api'
import { KebabMenu } from '../components/KebabMenu'
import { Modal } from '../components/Modal'
import { Pagination } from '../components/Pagination'

const PER_PAGE = 15

type Role = 'root' | 'admin' | 'manager' | 'viewer'

interface UserItem {
  id: number
  username: string
  role: Role
  created_at: string
}

const ROLE_LABEL: Record<Role, string> = {
  root: 'Root',
  admin: 'Admin',
  manager: 'Manager',
  viewer: 'Viewer',
}

const ROLE_COLOR: Record<Role, string> = {
  root:    '#7c3aed',
  admin:   '#C07D4A',
  manager: '#16a34a',
  viewer:  '#8C7B6E',
}

function availableRolesToAssign(myRole: Role): Role[] {
  if (myRole === 'root') return ['admin', 'manager', 'viewer']
  return ['manager', 'viewer']
}

function canEditUser(me: UserItem, target: UserItem): boolean {
  if (target.role === 'root') return me.role === 'root' && me.id === target.id
  if (target.role === 'admin') return me.role === 'root' || me.id === target.id
  return true
}

function canDeleteUser(me: UserItem, target: UserItem): boolean {
  if (me.id === target.id) return false
  if (target.role === 'root') return false
  if (target.role === 'admin') return me.role === 'root'
  return true
}

export function Users() {
  const { user: me } = useAuth()
  const toast = useToast()
  const confirm = useConfirm()
  const [users, setUsers] = useState<UserItem[]>([])
  const [fetchError, setFetchError] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const tableRef = useRef<HTMLDivElement>(null)

  const [showModal, setShowModal] = useState(false)
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newRole, setNewRole] = useState<Role>('viewer')
  const [modalError, setModalError] = useState('')
  const [modalSubmitting, setModalSubmitting] = useState(false)

  const [editUser, setEditUser] = useState<UserItem | null>(null)
  const [editPassword, setEditPassword] = useState('')
  const [editRole, setEditRole] = useState<Role>('viewer')
  const [editError, setEditError] = useState('')
  const [editSubmitting, setEditSubmitting] = useState(false)

  useEffect(() => { loadUsers() }, [page])

  async function loadUsers() {
    const res = await apiFetch(`/api/users?page=${page}&per_page=${PER_PAGE}`)
    if (res.ok) {
      const data = await res.json()
      setUsers(data.items)
      setTotal(data.pagination.total)
      setTotalPages(data.pagination.total_pages)
    } else {
      setFetchError('Не удалось загрузить пользователей')
    }
  }

  function changePage(p: number) {
    setPage(p)
    tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
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
        const msg = (await res.json()).detail ?? 'Ошибка'
        setModalError(msg)
        toast.error(msg)
        return
      }
      const created: UserItem = await res.json()
      await loadUsers()
      setShowModal(false)
      setNewUsername(''); setNewPassword(''); setNewRole('viewer')
      toast.success(`Пользователь ${created.username} создан`)
    } finally { setModalSubmitting(false) }
  }

  function openEdit(u: UserItem) {
    setEditUser(u)
    setEditRole(u.role === 'root' ? 'root' : u.role)
    setEditPassword('')
    setEditError('')
  }

  async function handleEdit(e: FormEvent) {
    e.preventDefault()
    if (!editUser) return
    setEditError('')
    setEditSubmitting(true)
    const body: Record<string, string> = {}
    if (editRole !== editUser.role) body.role = editRole
    if (editPassword) body.password = editPassword
    if (!Object.keys(body).length) { setEditUser(null); setEditSubmitting(false); return }
    try {
      const res = await apiFetch(`/api/users/${editUser.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const msg = (await res.json()).detail ?? 'Ошибка'
        setEditError(msg)
        toast.error(msg)
        return
      }
      const updated: UserItem = await res.json()
      setUsers(prev => prev.map(u => u.id === updated.id ? updated : u))
      setEditUser(null)
      toast.success('Пользователь сохранён')
    } finally { setEditSubmitting(false) }
  }

  async function handleDelete(u: UserItem) {
    if (!await confirm(`Удалить пользователя "${u.username}"?`)) return
    const res = await apiFetch(`/api/users/${u.id}`, { method: 'DELETE' })
    if (res.ok || res.status === 204) {
      await loadUsers()
      toast.success(`Пользователь ${u.username} удалён`)
    } else {
      toast.error('Не удалось удалить пользователя')
    }
  }

  if (!me) return null
  const myRole = me.role as Role

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Пользователи</h1>
        <button onClick={() => { setShowModal(true); setModalError('') }}>+ Добавить</button>
      </div>

      {fetchError && <div style={{ color: '#dc2626', marginBottom: 12 }}>{fetchError}</div>}

      <div ref={tableRef} className="table-scroll"><table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={thStyle}>Пользователь</th>
            <th style={thStyle}>Роль</th>
            <th style={thStyle}>Создан</th>
            <th style={thStyle}>Действия</th>
          </tr>
        </thead>
        <tbody>
          {users.map(u => (
            <tr key={u.id}>
              <td style={tdStyle}>
                {u.username}
                {u.id === me.id && <span style={{ marginLeft: 8, color: '#D4B896', fontSize: 12 }}>(вы)</span>}
              </td>
              <td style={tdStyle}>
                <span style={{
                  display: 'inline-block',
                  padding: '2px 10px',
                  borderRadius: 20,
                  fontSize: 12,
                  fontWeight: 600,
                  background: ROLE_COLOR[u.role] + '18',
                  color: ROLE_COLOR[u.role],
                  border: `1px solid ${ROLE_COLOR[u.role]}44`,
                }}>
                  {ROLE_LABEL[u.role]}
                </span>
              </td>
              <td style={tdStyle}>{new Date(u.created_at).toLocaleDateString('ru-RU')}</td>
              <td style={{ ...tdStyle, width: 48, textAlign: 'center' }}>
                <KebabMenu actions={[
                  ...(canEditUser(me as UserItem, u) ? [{ label: 'Редактировать', onClick: () => openEdit(u) }] : []),
                  ...(canDeleteUser(me as UserItem, u) ? [{ label: 'Удалить', onClick: () => handleDelete(u), danger: true as const }] : []),
                ]} />
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>

      <Pagination
        page={page}
        total_pages={totalPages}
        total={total}
        per_page={PER_PAGE}
        onChange={changePage}
      />

      {/* Create modal */}
      {showModal && (
        <Modal title="Добавить пользователя" onClose={() => setShowModal(false)}>
          <form onSubmit={handleCreate} style={formStyle}>
            {modalError && <div style={errStyle}>{modalError}</div>}
            <label style={labelStyle}>
              Имя пользователя
              <input value={newUsername} onChange={e => setNewUsername(e.target.value)} required autoFocus />
            </label>
            <label style={labelStyle}>
              Пароль
              <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required />
            </label>
            <label style={labelStyle}>
              Роль
              <select value={newRole} onChange={e => setNewRole(e.target.value as Role)}>
                {availableRolesToAssign(myRole).map(r => (
                  <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                ))}
              </select>
            </label>
            <div className="modal-footer">
              <button type="button" onClick={() => setShowModal(false)}>Отмена</button>
              <button type="submit" disabled={modalSubmitting}>{modalSubmitting ? 'Создание…' : 'Создать'}</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Edit modal */}
      {editUser && (
        <Modal title={`Редактировать: ${editUser.username}`} onClose={() => setEditUser(null)}>
          <form onSubmit={handleEdit} style={formStyle}>
            {editError && <div style={errStyle}>{editError}</div>}
            {editUser.role !== 'root' && (
              <label style={labelStyle}>
                Роль
                <select value={editRole} onChange={e => setEditRole(e.target.value as Role)}>
                  {availableRolesToAssign(myRole).map(r => (
                    <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                  ))}
                </select>
              </label>
            )}
            <label style={labelStyle}>
              Новый пароль <span style={{ fontWeight: 400, color: '#8C7B6E' }}>(оставьте пустым если не менять)</span>
              <input type="password" value={editPassword} onChange={e => setEditPassword(e.target.value)} autoFocus />
            </label>
            <div className="modal-footer">
              <button type="button" onClick={() => setEditUser(null)}>Отмена</button>
              <button type="submit" disabled={editSubmitting}>{editSubmitting ? 'Сохранение…' : 'Сохранить'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

const thStyle: CSSProperties = {
  textAlign: 'left',
  padding: '10px 14px',
  borderBottom: '1.5px solid #E8DDD3',
  fontWeight: 700,
  fontSize: 11,
  background: '#F0E8DE',
  color: '#8C7B6E',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  whiteSpace: 'nowrap',
}

const tdStyle: CSSProperties = {
  padding: '9px 14px',
  borderBottom: '1px solid #E8DDD3',
  fontSize: 14,
}

const formStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
}

const labelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 13,
  fontWeight: 500,
  color: '#2C2B28',
}

const errStyle: CSSProperties = {
  color: '#dc2626',
  fontSize: 14,
}

