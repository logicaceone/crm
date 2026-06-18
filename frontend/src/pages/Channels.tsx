import { useState, useEffect, FormEvent, CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { useConfirm } from '../contexts/ConfirmContext'
import { apiFetch } from '../lib/api'
import { useRef } from 'react'
import { KebabMenu } from '../components/KebabMenu'
import { SkeletonTable } from '../components/PageSkeleton'
import { Modal } from '../components/Modal'
import { Pagination } from '../components/Pagination'

const PER_PAGE = 15

interface ChannelStat {
  id: number
  channel_id: number
  date: string
  subscribers_count: number | null
  avg_views_per_post: number | null
}

interface Channel {
  id: number
  name: string
  platform: 'telegram' | 'max'
  tg_link: string | null
  description: string | null
  max_chat_id: number | null
  max_chat_link: string | null
  max_bot_token_set: boolean
  created_at: string
  last_subscriber_stat: ChannelStat | null
  last_views_stat: ChannelStat | null
  stat_30d_ago: ChannelStat | null
}

interface ChannelForm {
  name: string
  platform: 'telegram' | 'max'
  tg_link: string
  description: string
  max_chat_id: string
  max_chat_link: string
  max_bot_token: string
}

function growth(ch: Channel): string {
  if (!ch.last_subscriber_stat || !ch.stat_30d_ago) return '—'
  const diff = (ch.last_subscriber_stat.subscribers_count ?? 0) - (ch.stat_30d_ago.subscribers_count ?? 0)
  return diff >= 0 ? `+${diff.toLocaleString()}` : diff.toLocaleString()
}

function growthColor(ch: Channel): string {
  if (!ch.last_subscriber_stat || !ch.stat_30d_ago) return 'inherit'
  const diff = (ch.last_subscriber_stat.subscribers_count ?? 0) - (ch.stat_30d_ago.subscribers_count ?? 0)
  if (diff > 0) return '#16a34a'
  if (diff < 0) return '#dc2626'
  return 'inherit'
}

const emptyForm: ChannelForm = { name: '', platform: 'telegram', tg_link: '', description: '', max_chat_id: '', max_chat_link: '', max_bot_token: '' }

function PlatformBadge({ platform }: { platform: 'telegram' | 'max' }) {
  const isTG = platform === 'telegram'
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 12,
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: '0.03em',
      background: isTG ? '#0088cc18' : '#ff000018',
      color: isTG ? '#0088cc' : '#c0392b',
      border: `1px solid ${isTG ? '#0088cc44' : '#c0392b44'}`,
    }}>
      {isTG ? 'TG' : 'MAX'}
    </span>
  )
}

export function Channels() {
  const { user } = useAuth()
  const toast = useToast()
  const confirm = useConfirm()
  const canWrite = user?.role === 'root' || user?.role === 'admin' || user?.role === 'manager'

  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const tableRef = useRef<HTMLDivElement>(null)

  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState<ChannelForm>(emptyForm)
  const [createError, setCreateError] = useState('')
  const [createSubmitting, setCreateSubmitting] = useState(false)

  const [editChannel, setEditChannel] = useState<Channel | null>(null)
  const [editForm, setEditForm] = useState<ChannelForm>(emptyForm)
  const [editError, setEditError] = useState('')
  const [editSubmitting, setEditSubmitting] = useState(false)

  const [syncingId, setSyncingId] = useState<number | null>(null)

  useEffect(() => { load() }, [page])

  async function load() {
    setLoading(true)
    const res = await apiFetch(`/api/channels?page=${page}&per_page=${PER_PAGE}`)
    if (res.ok) {
      const data = await res.json()
      setChannels(data.items)
      setTotal(data.pagination.total)
      setTotalPages(data.pagination.total_pages)
    } else {
      setError('Не удалось загрузить каналы')
    }
    setLoading(false)
  }

  function changePage(p: number) {
    setPage(p)
    tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setCreateError('')
    setCreateSubmitting(true)
    try {
      const body: Record<string, unknown> = {
        name: createForm.name,
        platform: createForm.platform,
        description: createForm.description || null,
      }
      if (createForm.platform === 'telegram') {
        body.tg_link = createForm.tg_link || null
      } else {
        body.max_chat_id = createForm.max_chat_id ? Number(createForm.max_chat_id) : null
        body.max_chat_link = createForm.max_chat_link || null
        if (createForm.max_bot_token) body.max_bot_token = createForm.max_bot_token
      }
      const res = await apiFetch('/api/channels', { method: 'POST', body: JSON.stringify(body) })
      if (!res.ok) {
        const d = await res.json()
        const msg = d.detail ?? 'Ошибка создания'
        setCreateError(msg)
        toast.error(msg)
        return
      }
      await res.json()
      await load()
      setShowCreate(false)
      setCreateForm(emptyForm)
      toast.success('Канал добавлен')
    } finally {
      setCreateSubmitting(false)
    }
  }

  function openEdit(ch: Channel) {
    setEditChannel(ch)
    setEditForm({
      name: ch.name,
      platform: ch.platform,
      tg_link: ch.tg_link ?? '',
      description: ch.description ?? '',
      max_chat_id: ch.max_chat_id != null ? String(ch.max_chat_id) : '',
      max_chat_link: ch.max_chat_link ?? '',
      max_bot_token: '',
    })
    setEditError('')
  }

  async function handleEdit(e: FormEvent) {
    e.preventDefault()
    if (!editChannel) return
    setEditError('')
    setEditSubmitting(true)
    try {
      const body: Record<string, unknown> = {
        name: editForm.name || undefined,
        platform: editForm.platform,
        description: editForm.description || null,
      }
      if (editForm.platform === 'telegram') {
        body.tg_link = editForm.tg_link || null
      } else {
        body.max_chat_id = editForm.max_chat_id ? Number(editForm.max_chat_id) : null
        body.max_chat_link = editForm.max_chat_link || null
        if (editForm.max_bot_token) body.max_bot_token = editForm.max_bot_token
      }
      const res = await apiFetch(`/api/channels/${editChannel.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const d = await res.json()
        const msg = d.detail ?? 'Ошибка сохранения'
        setEditError(msg)
        toast.error(msg)
        return
      }
      const updated: Channel = await res.json()
      setChannels(prev =>
        prev.map(ch =>
          ch.id === updated.id
            ? { ...updated, last_subscriber_stat: ch.last_subscriber_stat, last_views_stat: ch.last_views_stat, stat_30d_ago: ch.stat_30d_ago }
            : ch
        )
      )
      setEditChannel(null)
      toast.success('Канал сохранён')
    } finally {
      setEditSubmitting(false)
    }
  }

  async function handleDelete(ch: Channel) {
    if (!await confirm(`Удалить канал "${ch.name}"?`)) return
    const res = await apiFetch(`/api/channels/${ch.id}`, { method: 'DELETE' })
    if (res.ok || res.status === 204) {
      await load()
      toast.success('Канал удалён')
    } else {
      toast.error('Не удалось удалить канал')
    }
  }

  async function handleSync(ch: Channel) {
    setSyncingId(ch.id)
    try {
      const res = await apiFetch(`/api/channels/${ch.id}/sync`, { method: 'POST' })
      if (!res.ok) {
        const d = await res.json()
        toast.error(d.detail ?? 'Ошибка синхронизации')
        return
      }
      const result = await res.json()
      const subs = result.subscribers != null ? result.subscribers.toLocaleString() : '?'
      toast.success(`Синхронизировано: ${subs} подписчиков`)
      // reload to pick up new stat
      await load()
    } finally {
      setSyncingId(null)
    }
  }

  if (loading) return (
    <div>
      <h1 style={{ margin: '0 0 20px', fontSize: 22, fontWeight: 700 }}>Каналы</h1>
      <SkeletonTable rows={7} cols={5} />
    </div>
  )
  if (error) return <p style={{ color: 'red' }}>{error}</p>

  const colCount = canWrite ? 6 : 5

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

      <div ref={tableRef} className="table-scroll"><table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>Платформа</th>
            <th style={thStyle}>Название</th>
            <th style={thStyle}>Ссылка</th>
            <th style={thStyle}>Подписчики</th>
            <th style={thStyle}>Ср. просмотры</th>
            {canWrite && <th style={thStyle}>Действия</th>}
          </tr>
        </thead>
        <tbody>
          {channels.length === 0 && (
            <tr>
              <td colSpan={colCount} style={{ ...tdStyle, color: '#D4B896', textAlign: 'center' }}>
                Нет каналов
              </td>
            </tr>
          )}
          {channels.map(ch => (
            <tr key={ch.id}>
              <td style={tdStyle}>
                <PlatformBadge platform={ch.platform} />
              </td>
              <td style={tdStyle}>
                <Link to={`/channels/${ch.id}`}>{ch.name}</Link>
              </td>
              <td style={tdStyle}>
                {ch.platform === 'telegram' && ch.tg_link && (
                  <a href={ch.tg_link} target="_blank" rel="noopener noreferrer" style={{ color: '#C07D4A' }}>
                    {ch.tg_link}
                  </a>
                )}
                {ch.platform === 'max' && ch.max_chat_link && (
                  <a href={ch.max_chat_link} target="_blank" rel="noopener noreferrer" style={{ color: '#C07D4A' }}>
                    {ch.max_chat_link}
                  </a>
                )}
                {!ch.tg_link && !ch.max_chat_link && '—'}
              </td>
              <td style={tdStyle}>
                {ch.last_subscriber_stat?.subscribers_count?.toLocaleString() ?? '—'}
              </td>
              <td style={tdStyle}>
                {ch.last_views_stat?.avg_views_per_post?.toLocaleString() ?? '—'}
              </td>
              {canWrite && (
                <td style={{ ...tdStyle, width: 48, textAlign: 'center' }}>
                  <KebabMenu actions={[
                    { label: 'Редактировать', onClick: () => openEdit(ch) },
                    ...(ch.platform === 'max' && ch.max_bot_token_set
                      ? [{ label: syncingId === ch.id ? 'Синхронизация…' : 'Синхронизировать', onClick: () => handleSync(ch), disabled: syncingId === ch.id }]
                      : []),
                    { label: 'Удалить', onClick: () => handleDelete(ch), danger: true },
                  ]} />
                </td>
              )}
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

      {showCreate && (
        <Modal title="Добавить канал" onClose={() => setShowCreate(false)}>
          <ChannelForm
            form={createForm}
            onChange={setCreateForm}
            onSubmit={handleCreate}
            error={createError}
            submitting={createSubmitting}
            onCancel={() => setShowCreate(false)}
            submitLabel="Создать"
          />
        </Modal>
      )}

      {editChannel && (
        <Modal title="Редактировать канал" onClose={() => setEditChannel(null)}>
          <ChannelForm
            form={editForm}
            onChange={setEditForm}
            onSubmit={handleEdit}
            error={editError}
            submitting={editSubmitting}
            onCancel={() => setEditChannel(null)}
            submitLabel="Сохранить"
            isEdit
            existingTokenSet={editChannel.max_bot_token_set}
            onSync={editChannel.platform === 'max' && editChannel.max_bot_token_set
              ? () => handleSync(editChannel)
              : undefined}
            syncing={syncingId === editChannel.id}
          />
        </Modal>
      )}
    </div>
  )
}

interface ChannelFormProps {
  form: ChannelForm
  onChange: (f: ChannelForm) => void
  onSubmit: (e: FormEvent) => void
  error: string
  submitting: boolean
  onCancel: () => void
  submitLabel: string
  isEdit?: boolean
  existingTokenSet?: boolean
  onSync?: () => void
  syncing?: boolean
}

function ChannelForm({ form, onChange, onSubmit, error, submitting, onCancel, submitLabel, isEdit, existingTokenSet, onSync, syncing }: ChannelFormProps) {
  const set = (patch: Partial<ChannelForm>) => onChange({ ...form, ...patch })
  const isMax = form.platform === 'max'

  return (
    <form onSubmit={onSubmit} style={formStyle}>
      {error && <div style={errStyle}>{error}</div>}
      <input
        placeholder="Название *"
        value={form.name}
        onChange={e => set({ name: e.target.value })}
        required
        autoFocus
      />
      <label style={labelStyle}>
        Платформа
        <select value={form.platform} onChange={e => set({ platform: e.target.value as 'telegram' | 'max' })}>
          <option value="telegram">Telegram</option>
          <option value="max">Max.ru</option>
        </select>
      </label>

      {!isMax && (
        <input
          placeholder="Ссылка Telegram (https://t.me/...)"
          value={form.tg_link}
          onChange={e => set({ tg_link: e.target.value })}
        />
      )}

      {isMax && (
        <>
          <input
            placeholder="Ссылка Max.ru (https://max.ru/...)"
            value={form.max_chat_link}
            onChange={e => set({ max_chat_link: e.target.value })}
          />
          <label style={labelStyle}>
            Chat ID
            <span style={{ fontWeight: 400, color: '#8C7B6E', fontSize: 12 }}>
              Числовой ID чата (например: -73583400620057). Найти можно в Max.ru Admin или через бота.
            </span>
            <input
              placeholder="-73583400620057"
              value={form.max_chat_id}
              onChange={e => set({ max_chat_id: e.target.value })}
            />
          </label>
          <label style={labelStyle}>
            Bot Token
            {isEdit && existingTokenSet && (
              <span style={{ fontWeight: 400, color: '#8C7B6E', marginLeft: 4 }}>(оставьте пустым чтобы не менять)</span>
            )}
            <input
              placeholder={isEdit && existingTokenSet ? '••••••••' : 'Bearer токен бота Max.ru'}
              value={form.max_bot_token}
              onChange={e => set({ max_bot_token: e.target.value })}
              type="password"
              autoComplete="off"
            />
          </label>
        </>
      )}

      <textarea
        placeholder="Описание"
        rows={3}
        value={form.description}
        onChange={e => set({ description: e.target.value })}
        style={{ resize: 'vertical' }}
      />

      <div className="modal-footer" style={{ flexWrap: 'wrap' }}>
        {onSync && (
          <button
            type="button"
            onClick={onSync}
            disabled={syncing}
            style={{ flex: 'none', marginRight: 'auto', background: 'transparent', color: '#0088cc', borderColor: '#0088cc44', fontSize: 13 }}
          >
            {syncing ? 'Синхронизация…' : 'Синхронизировать'}
          </button>
        )}
        <button type="button" onClick={onCancel}>Отмена</button>
        <button type="submit" disabled={submitting}>
          {submitting ? `${submitLabel}…` : submitLabel}
        </button>
      </div>
    </form>
  )
}

const headerRowStyle: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }
const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse' }

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
  fontSize: 13,
}

const formStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 }
const errStyle: CSSProperties = { color: '#dc2626', fontSize: 14 }

const labelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 13,
  fontWeight: 500,
  color: '#2C2B28',
}
