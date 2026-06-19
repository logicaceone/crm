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
  tg_chat_id: number | null
  description: string | null
  max_chat_id: number | null
  max_chat_link: string | null
  max_bot_token_set: boolean
  created_at: string
  last_subscriber_stat: ChannelStat | null
  last_views_stat: ChannelStat | null
  stat_30d_ago: ChannelStat | null
}

interface SyncEvent {
  index: number
  total: number
  channel_id: number
  name: string
  status: 'ok' | 'error'
  subscribers?: number
  avg_views?: number | null
  error?: string
}

interface ChannelForm {
  name: string
  platform: 'telegram' | 'max'
  tg_link: string
  tg_chat_id: string
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

const emptyForm: ChannelForm = { name: '', platform: 'telegram', tg_link: '', tg_chat_id: '', description: '', max_chat_id: '', max_chat_link: '', max_bot_token: '' }

function statAge(dateStr: string | null | undefined): { label: string; stale: boolean } {
  if (!dateStr) return { label: 'нет данных', stale: true }
  // date string is YYYY-MM-DD; midnight local time.
  const d = new Date(dateStr + 'T00:00:00')
  if (isNaN(d.getTime())) return { label: dateStr, stale: true }
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days = Math.floor((today.getTime() - d.getTime()) / 86400000)
  if (days <= 0) return { label: 'сегодня', stale: false }
  if (days === 1) return { label: 'вчера', stale: false }
  // 48h stale threshold ≈ 2 days
  return { label: `${days} дн назад`, stale: days >= 2 }
}

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
  const [clearToken, setClearToken] = useState(false)
  const [clearChatLink, setClearChatLink] = useState(false)

  const [syncingId, setSyncingId] = useState<number | null>(null)
  const [syncingAll, setSyncingAll] = useState(false)
  const [syncProgress, setSyncProgress] = useState<{ current: number; total: number } | null>(null)
  const [syncResults, setSyncResults] = useState<SyncEvent[]>([])
  const syncTimeoutRef = useRef<number | null>(null)
  const syncEventRef = useRef<EventSource | null>(null)

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
        body.tg_chat_id = createForm.tg_chat_id ? Number(createForm.tg_chat_id) : null
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
      tg_chat_id: ch.tg_chat_id != null ? String(ch.tg_chat_id) : '',
      description: ch.description ?? '',
      max_chat_id: ch.max_chat_id != null ? String(ch.max_chat_id) : '',
      max_chat_link: ch.max_chat_link ?? '',
      max_bot_token: '',
    })
    setClearToken(false)
    setClearChatLink(false)
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
        body.tg_chat_id = editForm.tg_chat_id ? Number(editForm.tg_chat_id) : null
      } else {
        body.max_chat_id = editForm.max_chat_id ? Number(editForm.max_chat_id) : null
        body.max_chat_link = clearChatLink ? null : (editForm.max_chat_link || null)
        if (clearToken) {
          body.max_bot_token = null
        } else if (editForm.max_bot_token) {
          body.max_bot_token = editForm.max_bot_token
        }
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

  function cleanupSyncStream() {
    if (syncTimeoutRef.current != null) {
      window.clearTimeout(syncTimeoutRef.current)
      syncTimeoutRef.current = null
    }
    if (syncEventRef.current) {
      syncEventRef.current.close()
      syncEventRef.current = null
    }
  }

  function handleSyncAll() {
    setSyncingAll(true)
    setSyncProgress(null)
    setSyncResults([])

    const es = new EventSource('/api/channels/sync-all/stream', { withCredentials: true })
    syncEventRef.current = es
    let finishedCleanly = false

    syncTimeoutRef.current = window.setTimeout(() => {
      if (finishedCleanly) return
      cleanupSyncStream()
      setSyncingAll(false)
      toast.error('Синхронизация заняла слишком долго')
    }, 120_000)

    es.onmessage = (event) => {
      let data: SyncEvent & { done?: boolean; synced?: number; failed?: number }
      try {
        data = JSON.parse(event.data)
      } catch {
        return
      }
      if (data.done) {
        finishedCleanly = true
        cleanupSyncStream()
        setSyncingAll(false)
        const synced = data.synced ?? 0
        const failed = data.failed ?? 0
        const total = data.total ?? synced + failed
        if (failed === 0) {
          toast.success(`Обновлено ${synced} из ${total} каналов`)
        } else if (synced > 0) {
          toast.error(`Обновлено ${synced} из ${total}. Ошибок: ${failed}`)
        } else {
          toast.error('Не удалось обновить каналы')
        }
        load()
        // Keep the progress visible for a moment, then hide.
        window.setTimeout(() => setSyncProgress(null), 5000)
        return
      }
      setSyncProgress({ current: data.index, total: data.total })
      setSyncResults(prev => [...prev, data])
    }

    es.onerror = () => {
      if (finishedCleanly) return
      cleanupSyncStream()
      setSyncingAll(false)
      toast.error('Соединение прервано')
    }
  }

  useEffect(() => {
    return () => cleanupSyncStream()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (loading) return (
    <div>
      <h1 style={{ margin: '0 0 20px', fontSize: 22, fontWeight: 700 }}>Каналы</h1>
      <SkeletonTable rows={7} cols={5} />
    </div>
  )
  if (error) return <p style={{ color: 'red' }}>{error}</p>

  const colCount = canWrite ? 7 : 6

  return (
    <div>
      <div style={headerRowStyle}>
        <h1 style={{ margin: 0 }}>Каналы</h1>
        {canWrite && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={handleSyncAll}
              disabled={syncingAll}
              style={{
                background: 'transparent',
                color: '#2C2B28',
                border: '1.5px solid #C07D4A',
                boxShadow: 'none',
              }}
            >
              {syncingAll
                ? (syncProgress ? `⏳ Обновляем… (${syncProgress.current}/${syncProgress.total})` : '⏳ Обновляем…')
                : '🔄 Обновить статистику'}
            </button>
            <button onClick={() => { setShowCreate(true); setCreateForm(emptyForm); setCreateError('') }}>
              + Добавить канал
            </button>
          </div>
        )}
      </div>

      {syncProgress && (
        <div style={syncBlockStyle}>
          <div style={progressBarStyle}>
            <div style={{
              ...progressFillStyle,
              width: `${Math.min(100, (syncProgress.current / syncProgress.total) * 100)}%`,
            }} />
          </div>
          <div style={{ fontSize: 12, color: '#8C7B6E', marginTop: 6 }}>
            {syncProgress.current} из {syncProgress.total} каналов
          </div>
          {syncResults.length > 0 && (
            <div style={syncLogStyle}>
              {syncResults.map(r => (
                <div
                  key={r.channel_id}
                  style={{
                    ...syncLogItemStyle,
                    color: r.status === 'ok' ? '#16a34a' : '#dc2626',
                  }}
                >
                  {r.status === 'ok'
                    ? `✓ ${r.name} — ${(r.subscribers ?? 0).toLocaleString('ru-RU')} подп.`
                    : `✗ ${r.name} — ${r.error ?? 'unknown error'}`}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div ref={tableRef} className="table-scroll"><table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>Платформа</th>
            <th style={thStyle}>Название</th>
            <th style={thStyle}>Ссылка</th>
            <th style={thStyle}>Подписчики</th>
            <th style={thStyle}>Ср. просмотры</th>
            <th style={thStyle}>Обновлено</th>
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
              <td style={tdStyle}>
                {(() => {
                  const age = statAge(ch.last_subscriber_stat?.date)
                  return (
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: age.stale ? 600 : 400,
                        color: age.stale ? '#dc2626' : '#8C7B6E',
                      }}
                      title={ch.last_subscriber_stat?.date ?? undefined}
                    >
                      {age.label}
                    </span>
                  )
                })()}
              </td>
              {canWrite && (
                <td style={{ ...tdStyle, width: 48, textAlign: 'center' }}>
                  <KebabMenu actions={[
                    { label: 'Редактировать', onClick: () => openEdit(ch) },
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
            existingTokenSet={editChannel.max_bot_token_set && !clearToken}
            existingChatLink={!!editChannel.max_chat_link && !clearChatLink}
            clearToken={clearToken}
            onClearToken={() => setClearToken(true)}
            onUndoClearToken={() => setClearToken(false)}
            clearChatLink={clearChatLink}
            onClearChatLink={() => { setClearChatLink(true); setEditForm(f => ({ ...f, max_chat_link: '' })) }}
            onUndoClearChatLink={() => setClearChatLink(false)}
            onSync={editChannel.platform === 'max' && editChannel.max_bot_token_set && !clearToken
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
  existingChatLink?: boolean
  clearToken?: boolean
  onClearToken?: () => void
  onUndoClearToken?: () => void
  clearChatLink?: boolean
  onClearChatLink?: () => void
  onUndoClearChatLink?: () => void
  onSync?: () => void
  syncing?: boolean
}

function ChannelForm({
  form, onChange, onSubmit, error, submitting, onCancel, submitLabel,
  isEdit, existingTokenSet, existingChatLink,
  clearToken, onClearToken, onUndoClearToken,
  clearChatLink, onClearChatLink, onUndoClearChatLink,
  onSync, syncing,
}: ChannelFormProps) {
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
        <>
          <input
            placeholder="Ссылка Telegram (https://t.me/... или @channel)"
            value={form.tg_link}
            onChange={e => set({ tg_link: e.target.value })}
          />
          <label style={labelStyle}>
            Chat ID (опционально)
            <span style={{ fontWeight: 400, color: '#8C7B6E', fontSize: 12 }}>
              Числовой ID канала. Нужен для приватных каналов и CPA-ссылок.
              Получить можно через @userinfobot — переслать пост в бот.
            </span>
            <input
              placeholder="-1001234567890"
              value={form.tg_chat_id}
              onChange={e => set({ tg_chat_id: e.target.value })}
            />
          </label>
        </>
      )}

      {isMax && (
        <>
          {clearChatLink ? (
            <div style={clearedRowStyle}>
              <span>Ссылка Max.ru будет очищена</span>
              {onUndoClearChatLink && (
                <button type="button" onClick={onUndoClearChatLink} style={linkBtnStyle}>Отмена</button>
              )}
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                <input
                  placeholder="@channel или https://max.ru/channel"
                  value={form.max_chat_link}
                  onChange={e => set({ max_chat_link: e.target.value })}
                  style={{ flex: 1 }}
                />
                {isEdit && existingChatLink && onClearChatLink && (
                  <button
                    type="button"
                    onClick={onClearChatLink}
                    style={dangerLinkBtnStyle}
                    title="Очистить ссылку"
                  >
                    Очистить
                  </button>
                )}
              </div>
              <div style={{ fontSize: 12, color: '#8C7B6E', marginTop: 4 }}>
                Принимаются любые форматы: @name, max.ru/name, полная ссылка
              </div>
            </div>
          )}
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
            {clearToken ? (
              <div style={clearedRowStyle}>
                <span>Токен будет очищен</span>
                {onUndoClearToken && (
                  <button type="button" onClick={onUndoClearToken} style={linkBtnStyle}>Отмена</button>
                )}
              </div>
            ) : (
              <>
                {isEdit && existingTokenSet && (
                  <div style={tokenSetRowStyle}>
                    <span style={{ color: '#16a34a', fontSize: 12, fontWeight: 600 }}>Токен задан ✓</span>
                    {onClearToken && (
                      <button type="button" onClick={onClearToken} style={dangerLinkBtnStyle}>
                        Очистить токен
                      </button>
                    )}
                  </div>
                )}
                <input
                  placeholder={isEdit && existingTokenSet ? '••••••••' : 'Bearer токен бота Max.ru'}
                  value={form.max_bot_token}
                  onChange={e => set({ max_bot_token: e.target.value })}
                  type="password"
                  autoComplete="off"
                />
              </>
            )}
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

const syncBlockStyle: CSSProperties = {
  background: '#FEFEFE',
  border: '1px solid #E8DDD3',
  borderRadius: 8,
  padding: '12px 16px',
  marginBottom: 16,
}

const progressBarStyle: CSSProperties = {
  width: '100%',
  height: 6,
  background: '#F0E8DE',
  borderRadius: 3,
  overflow: 'hidden',
}

const progressFillStyle: CSSProperties = {
  height: '100%',
  background: '#C07D4A',
  transition: 'width 0.25s ease',
}

const syncLogStyle: CSSProperties = {
  marginTop: 10,
  maxHeight: 160,
  overflowY: 'auto',
  fontSize: 12,
  fontFamily: 'monospace',
}

const syncLogItemStyle: CSSProperties = {
  padding: '2px 0',
}
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

const tokenSetRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,
}

const clearedRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,
  padding: '8px 12px',
  background: '#FEF3E2',
  border: '1px dashed #C07D4A',
  borderRadius: 8,
  fontSize: 13,
  color: '#C07D4A',
}

const linkBtnStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  fontSize: 12,
  color: '#8C7B6E',
  cursor: 'pointer',
  boxShadow: 'none',
  textDecoration: 'underline',
}

const dangerLinkBtnStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  fontSize: 12,
  color: '#dc2626',
  cursor: 'pointer',
  boxShadow: 'none',
  textDecoration: 'underline',
}
