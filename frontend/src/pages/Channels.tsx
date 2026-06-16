import { useState, useEffect, FormEvent, CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { apiFetch } from '../lib/api'

interface ChannelStat {
  id: number
  channel_id: number
  date: string
  subscribers_count: number
  avg_views_per_post: number
}

interface Channel {
  id: number
  name: string
  tg_link: string | null
  description: string | null
  created_at: string
  last_stat: ChannelStat | null
  stat_30d_ago: ChannelStat | null
}

function growth(ch: Channel): string {
  if (!ch.last_stat || !ch.stat_30d_ago) return '—'
  const diff = ch.last_stat.subscribers_count - ch.stat_30d_ago.subscribers_count
  return diff >= 0 ? `+${diff.toLocaleString()}` : diff.toLocaleString()
}

const emptyForm = { name: '', tg_link: '', description: '' }

export function Channels() {
  const { user } = useAuth()
  const canWrite = user?.role === 'admin' || user?.role === 'manager'

  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState(emptyForm)
  const [createError, setCreateError] = useState('')
  const [createSubmitting, setCreateSubmitting] = useState(false)

  const [editChannel, setEditChannel] = useState<Channel | null>(null)
  const [editForm, setEditForm] = useState(emptyForm)
  const [editError, setEditError] = useState('')
  const [editSubmitting, setEditSubmitting] = useState(false)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    const res = await apiFetch('/api/channels')
    if (res.ok) {
      setChannels(await res.json())
    } else {
      setError('Не удалось загрузить каналы')
    }
    setLoading(false)
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setCreateError('')
    setCreateSubmitting(true)
    try {
      const res = await apiFetch('/api/channels', {
        method: 'POST',
        body: JSON.stringify({
          name: createForm.name,
          tg_link: createForm.tg_link || null,
          description: createForm.description || null,
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        setCreateError(d.detail ?? 'Ошибка создания')
        return
      }
      const created: Channel = { ...(await res.json()), last_stat: null, stat_30d_ago: null }
      setChannels(prev => [...prev, created])
      setShowCreate(false)
      setCreateForm(emptyForm)
    } finally {
      setCreateSubmitting(false)
    }
  }

  function openEdit(ch: Channel) {
    setEditChannel(ch)
    setEditForm({ name: ch.name, tg_link: ch.tg_link ?? '', description: ch.description ?? '' })
    setEditError('')
  }

  async function handleEdit(e: FormEvent) {
    e.preventDefault()
    if (!editChannel) return
    setEditError('')
    setEditSubmitting(true)
    try {
      const res = await apiFetch(`/api/channels/${editChannel.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: editForm.name || undefined,
          tg_link: editForm.tg_link || null,
          description: editForm.description || null,
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        setEditError(d.detail ?? 'Ошибка сохранения')
        return
      }
      const updated: Channel = await res.json()
      setChannels(prev =>
        prev.map(ch =>
          ch.id === updated.id
            ? { ...updated, last_stat: ch.last_stat, stat_30d_ago: ch.stat_30d_ago }
            : ch
        )
      )
      setEditChannel(null)
    } finally {
      setEditSubmitting(false)
    }
  }

  async function handleDelete(ch: Channel) {
    if (!confirm(`Удалить канал "${ch.name}"?`)) return
    const res = await apiFetch(`/api/channels/${ch.id}`, { method: 'DELETE' })
    if (res.ok || res.status === 204) {
      setChannels(prev => prev.filter(c => c.id !== ch.id))
    }
  }

  if (loading) return <p>Загрузка…</p>
  if (error) return <p style={{ color: 'red' }}>{error}</p>

  return (
    <div>
      <div style={headerRowStyle}>
        <h1 style={{ margin: 0 }}>Каналы</h1>
        {canWrite && (
          <button onClick={() => { setShowCreate(true); setCreateForm(emptyForm); setCreateError('') }}>
            + Добавить канал
          </button>
        )}
      </div>

      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>Название</th>
            <th style={thStyle}>Ссылка</th>
            <th style={thStyle}>Подписчики</th>
            <th style={thStyle}>Прирост 30д</th>
            <th style={thStyle}>Ср. просмотры</th>
            {canWrite && <th style={thStyle}>Действия</th>}
          </tr>
        </thead>
        <tbody>
          {channels.length === 0 && (
            <tr>
              <td colSpan={canWrite ? 6 : 5} style={{ ...tdStyle, color: '#888', textAlign: 'center' }}>
                Нет каналов
              </td>
            </tr>
          )}
          {channels.map(ch => (
            <tr key={ch.id}>
              <td style={tdStyle}>
                <Link to={`/channels/${ch.id}`}>{ch.name}</Link>
              </td>
              <td style={tdStyle}>
                {ch.tg_link
                  ? <a href={ch.tg_link} target="_blank" rel="noopener noreferrer">{ch.tg_link}</a>
                  : '—'}
              </td>
              <td style={tdStyle}>
                {ch.last_stat ? ch.last_stat.subscribers_count.toLocaleString() : '—'}
              </td>
              <td style={{ ...tdStyle, color: growthColor(ch) }}>
                {growth(ch)}
              </td>
              <td style={tdStyle}>
                {ch.last_stat ? ch.last_stat.avg_views_per_post.toLocaleString() : '—'}
              </td>
              {canWrite && (
                <td style={tdStyle}>
                  <button onClick={() => openEdit(ch)} style={{ marginRight: 8 }}>Редакт.</button>
                  <button onClick={() => handleDelete(ch)} style={{ color: '#d00' }}>Удалить</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {showCreate && (
        <Modal title="Добавить канал" onClose={() => setShowCreate(false)}>
          <form onSubmit={handleCreate} style={formStyle}>
            {createError && <div style={errStyle}>{createError}</div>}
            <input
              placeholder="Название *"
              value={createForm.name}
              onChange={e => setCreateForm(p => ({ ...p, name: e.target.value }))}
              required
              autoFocus
            />
            <input
              placeholder="Ссылка (https://t.me/...)"
              value={createForm.tg_link}
              onChange={e => setCreateForm(p => ({ ...p, tg_link: e.target.value }))}
            />
            <textarea
              placeholder="Описание"
              rows={3}
              value={createForm.description}
              onChange={e => setCreateForm(p => ({ ...p, description: e.target.value }))}
              style={{ resize: 'vertical' }}
            />
            <div style={actionsStyle}>
              <button type="button" onClick={() => setShowCreate(false)}>Отмена</button>
              <button type="submit" disabled={createSubmitting}>
                {createSubmitting ? 'Создание…' : 'Создать'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {editChannel && (
        <Modal title="Редактировать канал" onClose={() => setEditChannel(null)}>
          <form onSubmit={handleEdit} style={formStyle}>
            {editError && <div style={errStyle}>{editError}</div>}
            <input
              placeholder="Название *"
              value={editForm.name}
              onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))}
              required
              autoFocus
            />
            <input
              placeholder="Ссылка (https://t.me/...)"
              value={editForm.tg_link}
              onChange={e => setEditForm(p => ({ ...p, tg_link: e.target.value }))}
            />
            <textarea
              placeholder="Описание"
              rows={3}
              value={editForm.description}
              onChange={e => setEditForm(p => ({ ...p, description: e.target.value }))}
              style={{ resize: 'vertical' }}
            />
            <div style={actionsStyle}>
              <button type="button" onClick={() => setEditChannel(null)}>Отмена</button>
              <button type="submit" disabled={editSubmitting}>
                {editSubmitting ? 'Сохранение…' : 'Сохранить'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

function growthColor(ch: Channel): string {
  if (!ch.last_stat || !ch.stat_30d_ago) return 'inherit'
  const diff = ch.last_stat.subscribers_count - ch.stat_30d_ago.subscribers_count
  if (diff > 0) return '#16a34a'
  if (diff < 0) return '#dc2626'
  return 'inherit'
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

const headerRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 16,
}

const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
}

const thStyle: CSSProperties = {
  textAlign: 'left',
  padding: '8px 12px',
  borderBottom: '2px solid #e5e7eb',
  fontWeight: 600,
  fontSize: 14,
}

const tdStyle: CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid #f3f4f6',
  fontSize: 14,
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
  background: 'white',
  borderRadius: 8,
  padding: 24,
  width: 400,
  boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
}

const formStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
}

const errStyle: CSSProperties = {
  color: '#dc2626',
  fontSize: 14,
}

const actionsStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  justifyContent: 'flex-end',
  marginTop: 4,
}
