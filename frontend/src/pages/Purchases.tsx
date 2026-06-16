import { useState, useEffect, FormEvent, CSSProperties } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { apiFetch } from '../lib/api'

// ── Types ────────────────────────────────────────────────────────────────────

interface ExternalChannel {
  id: number
  name: string
  tg_link: string | null
}

interface Purchase {
  id: number
  external_channel_id: number
  external_channel: ExternalChannel
  date: string
  price: number
  currency: string
  format: AdFormat
  status: PurchaseStatus
  comment: string | null
  created_by: number
  created_at: string
}

interface Summary {
  total: number
  currency: string
  count: number
}

type AdFormat = 'post' | 'repost' | 'integration' | 'other'
type PurchaseStatus = 'planned' | 'placed' | 'cancelled'

const FORMAT_LABELS: Record<AdFormat, string> = {
  post: 'Пост',
  repost: 'Репост',
  integration: 'Интеграция',
  other: 'Другое',
}

const STATUS_LABELS: Record<PurchaseStatus, string> = {
  planned: 'Запланировано',
  placed: 'Размещено',
  cancelled: 'Отменено',
}

const STATUS_COLORS: Record<PurchaseStatus, string> = {
  planned: '#C07D4A',
  placed: '#16a34a',
  cancelled: '#D4B896',
}

// ── Helpers ──────────────────────────────────────────────────────────────────

interface Filters {
  external_channel_id: string
  status: string
  from: string
  to: string
}

function buildQS(f: Filters): string {
  const p = new URLSearchParams()
  if (f.external_channel_id) p.set('external_channel_id', f.external_channel_id)
  if (f.status) p.set('status', f.status)
  if (f.from) p.set('from', f.from)
  if (f.to) p.set('to', f.to)
  const s = p.toString()
  return s ? `?${s}` : ''
}

const emptyForm = {
  external_channel_id: '',
  date: new Date().toISOString().slice(0, 10),
  price: '',
  currency: 'RUB',
  format: 'post' as AdFormat,
  status: 'planned' as PurchaseStatus,
  comment: '',
}

// ── Component ────────────────────────────────────────────────────────────────

export function Purchases() {
  const { user } = useAuth()
  const canWrite = user?.role === 'admin' || user?.role === 'manager'

  const [extChannels, setExtChannels] = useState<ExternalChannel[]>([])
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [filters, setFilters] = useState<Filters>({ external_channel_id: '', status: '', from: '', to: '' })
  const [pageError, setPageError] = useState('')

  // Create modal
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState(emptyForm)
  const [createError, setCreateError] = useState('')
  const [creating, setCreating] = useState(false)

  // New external channel inline
  const [showNewChannel, setShowNewChannel] = useState(false)
  const [newChName, setNewChName] = useState('')
  const [newChLink, setNewChLink] = useState('')
  const [addingCh, setAddingCh] = useState(false)

  // Edit modal
  const [editPurchase, setEditPurchase] = useState<Purchase | null>(null)
  const [editForm, setEditForm] = useState(emptyForm)
  const [editError, setEditError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadExtChannels()
  }, [])

  useEffect(() => {
    loadPurchases()
    loadSummary()
  }, [filters])

  async function loadExtChannels() {
    const res = await apiFetch('/api/external-channels')
    if (res.ok) setExtChannels(await res.json())
  }

  async function loadPurchases() {
    const res = await apiFetch(`/api/purchases${buildQS(filters)}`)
    if (res.ok) setPurchases(await res.json())
    else setPageError('Не удалось загрузить закупки')
  }

  async function loadSummary() {
    const res = await apiFetch(`/api/purchases/summary${buildQS(filters)}`)
    if (res.ok) setSummary(await res.json())
  }

  // ── Add external channel inline ──────────────────────────────────────────

  async function handleAddChannel(e: FormEvent) {
    e.preventDefault()
    setAddingCh(true)
    try {
      const res = await apiFetch('/api/external-channels', {
        method: 'POST',
        body: JSON.stringify({ name: newChName, tg_link: newChLink || null }),
      })
      if (!res.ok) return
      const created: ExternalChannel = await res.json()
      setExtChannels(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
      setCreateForm(p => ({ ...p, external_channel_id: String(created.id) }))
      setEditForm(p => ({ ...p, external_channel_id: String(created.id) }))
      setShowNewChannel(false)
      setNewChName('')
      setNewChLink('')
    } finally {
      setAddingCh(false)
    }
  }

  // ── Create purchase ──────────────────────────────────────────────────────

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setCreateError('')
    setCreating(true)
    try {
      const res = await apiFetch('/api/purchases', {
        method: 'POST',
        body: JSON.stringify({
          external_channel_id: Number(createForm.external_channel_id),
          date: createForm.date,
          price: Number(createForm.price),
          currency: createForm.currency,
          format: createForm.format,
          status: createForm.status,
          comment: createForm.comment || null,
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        setCreateError(d.detail ?? 'Ошибка создания')
        return
      }
      const created: Purchase = await res.json()
      setPurchases(prev => [created, ...prev])
      setSummary(prev =>
        prev
          ? { ...prev, total: prev.total + created.price, count: prev.count + 1 }
          : { total: created.price, currency: created.currency, count: 1 }
      )
      setShowCreate(false)
      setCreateForm(emptyForm)
    } finally {
      setCreating(false)
    }
  }

  // ── Edit purchase ────────────────────────────────────────────────────────

  function openEdit(p: Purchase) {
    setEditPurchase(p)
    setEditForm({
      external_channel_id: String(p.external_channel_id),
      date: p.date,
      price: String(p.price),
      currency: p.currency,
      format: p.format,
      status: p.status,
      comment: p.comment ?? '',
    })
    setEditError('')
  }

  async function handleEdit(e: FormEvent) {
    e.preventDefault()
    if (!editPurchase) return
    setEditError('')
    setSaving(true)
    try {
      const res = await apiFetch(`/api/purchases/${editPurchase.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          external_channel_id: Number(editForm.external_channel_id),
          date: editForm.date,
          price: Number(editForm.price),
          currency: editForm.currency,
          format: editForm.format,
          status: editForm.status,
          comment: editForm.comment || null,
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        setEditError(d.detail ?? 'Ошибка сохранения')
        return
      }
      const updated: Purchase = await res.json()
      setPurchases(prev => prev.map(p => (p.id === updated.id ? updated : p)))
      setEditPurchase(null)
      loadSummary()
    } finally {
      setSaving(false)
    }
  }

  // ── Delete purchase ──────────────────────────────────────────────────────

  async function handleDelete(p: Purchase) {
    if (!confirm(`Удалить закупку от ${p.date} (${p.external_channel.name})?`)) return
    const res = await apiFetch(`/api/purchases/${p.id}`, { method: 'DELETE' })
    if (res.ok || res.status === 204) {
      setPurchases(prev => prev.filter(x => x.id !== p.id))
      setSummary(prev =>
        prev ? { ...prev, total: prev.total - p.price, count: prev.count - 1 } : prev
      )
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  if (pageError) return <p style={{ color: 'red' }}>{pageError}</p>

  return (
    <div>
      {/* Header */}
      <div style={headerRowStyle}>
        <h1 style={{ margin: 0 }}>Закупки</h1>
        {canWrite && (
          <button onClick={() => { setShowCreate(true); setCreateForm(emptyForm); setCreateError(''); setShowNewChannel(false) }}>
            + Добавить закупку
          </button>
        )}
      </div>

      {/* Filters */}
      <div style={filtersRowStyle}>
        <select
          value={filters.external_channel_id}
          onChange={e => setFilters(p => ({ ...p, external_channel_id: e.target.value }))}
          style={filterSelectStyle}
        >
          <option value="">Все площадки</option>
          {extChannels.map(ch => (
            <option key={ch.id} value={ch.id}>{ch.name}</option>
          ))}
        </select>

        <select
          value={filters.status}
          onChange={e => setFilters(p => ({ ...p, status: e.target.value }))}
          style={filterSelectStyle}
        >
          <option value="">Все статусы</option>
          <option value="planned">Запланировано</option>
          <option value="placed">Размещено</option>
          <option value="cancelled">Отменено</option>
        </select>

        <input
          type="date"
          value={filters.from}
          onChange={e => setFilters(p => ({ ...p, from: e.target.value }))}
          style={filterSelectStyle}
        />
        <span style={{ alignSelf: 'center', color: '#D4B896', fontSize: 13 }}>—</span>
        <input
          type="date"
          value={filters.to}
          onChange={e => setFilters(p => ({ ...p, to: e.target.value }))}
          style={filterSelectStyle}
        />

        {(filters.external_channel_id || filters.status || filters.from || filters.to) && (
          <button
            onClick={() => setFilters({ external_channel_id: '', status: '', from: '', to: '' })}
            style={{ fontSize: 12, color: '#8C7B6E', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            Сбросить
          </button>
        )}
      </div>

      {/* Table */}
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>Дата</th>
            <th style={thStyle}>Площадка</th>
            <th style={thStyle}>Формат</th>
            <th style={thStyle}>Сумма</th>
            <th style={thStyle}>Статус</th>
            {canWrite && <th style={thStyle}>Действия</th>}
          </tr>
        </thead>
        <tbody>
          {purchases.length === 0 ? (
            <tr>
              <td colSpan={canWrite ? 6 : 5} style={{ ...tdStyle, textAlign: 'center', color: '#D4B896' }}>
                Нет закупок
              </td>
            </tr>
          ) : (
            purchases.map(p => (
              <tr key={p.id}>
                <td style={tdStyle}>{p.date}</td>
                <td style={tdStyle}>{p.external_channel.name}</td>
                <td style={tdStyle}>{FORMAT_LABELS[p.format]}</td>
                <td style={tdStyle}>
                  {p.price.toLocaleString('ru-RU', { minimumFractionDigits: 0 })} {p.currency}
                </td>
                <td style={tdStyle}>
                  <span style={{ color: STATUS_COLORS[p.status], fontWeight: 500, fontSize: 13 }}>
                    {STATUS_LABELS[p.status]}
                  </span>
                </td>
                {canWrite && (
                  <td style={tdStyle}>
                    <button onClick={() => openEdit(p)} style={{ marginRight: 8 }}>Редакт.</button>
                    <button onClick={() => handleDelete(p)} style={{ background: 'transparent', color: '#dc2626', borderColor: '#dc2626' }}>Удалить</button>
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
        {summary !== null && purchases.length > 0 && (
          <tfoot>
            <tr>
              <td colSpan={3} style={{ ...tdStyle, fontWeight: 600, background: '#F0E8DE', borderTop: '2px solid #E8DDD3' }}>
                Итого ({summary.count} закупок)
              </td>
              <td style={{ ...tdStyle, fontWeight: 600, background: '#F0E8DE', borderTop: '2px solid #E8DDD3' }}>
                {summary.total.toLocaleString('ru-RU', { minimumFractionDigits: 0 })} {summary.currency}
              </td>
              <td colSpan={canWrite ? 2 : 1} style={{ background: '#F0E8DE', borderTop: '2px solid #E8DDD3' }} />
            </tr>
          </tfoot>
        )}
      </table>

      {/* Create modal */}
      {showCreate && (
        <PurchaseModal
          title="Добавить закупку"
          form={createForm}
          setForm={setCreateForm}
          error={createError}
          submitting={creating}
          extChannels={extChannels}
          showNewChannel={showNewChannel}
          setShowNewChannel={setShowNewChannel}
          newChName={newChName}
          setNewChName={setNewChName}
          newChLink={newChLink}
          setNewChLink={setNewChLink}
          addingCh={addingCh}
          onAddChannel={handleAddChannel}
          onSubmit={handleCreate}
          onClose={() => setShowCreate(false)}
        />
      )}

      {/* Edit modal */}
      {editPurchase && (
        <PurchaseModal
          title="Редактировать закупку"
          form={editForm}
          setForm={setEditForm}
          error={editError}
          submitting={saving}
          extChannels={extChannels}
          showNewChannel={showNewChannel}
          setShowNewChannel={setShowNewChannel}
          newChName={newChName}
          setNewChName={setNewChName}
          newChLink={newChLink}
          setNewChLink={setNewChLink}
          addingCh={addingCh}
          onAddChannel={handleAddChannel}
          onSubmit={handleEdit}
          onClose={() => setEditPurchase(null)}
        />
      )}
    </div>
  )
}

// ── PurchaseModal ────────────────────────────────────────────────────────────

interface PurchaseModalProps {
  title: string
  form: typeof emptyForm
  setForm: React.Dispatch<React.SetStateAction<typeof emptyForm>>
  error: string
  submitting: boolean
  extChannels: ExternalChannel[]
  showNewChannel: boolean
  setShowNewChannel: (v: boolean) => void
  newChName: string
  setNewChName: (v: string) => void
  newChLink: string
  setNewChLink: (v: string) => void
  addingCh: boolean
  onAddChannel: (e: FormEvent) => void
  onSubmit: (e: FormEvent) => void
  onClose: () => void
}

function PurchaseModal({
  title, form, setForm, error, submitting,
  extChannels, showNewChannel, setShowNewChannel,
  newChName, setNewChName, newChLink, setNewChLink,
  addingCh, onAddChannel, onSubmit, onClose,
}: PurchaseModalProps) {
  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        <div style={modalHeaderStyle}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
          <button onClick={onClose} style={closeBtnStyle}>×</button>
        </div>

        <form onSubmit={onSubmit} style={formStyle}>
          {error && <div style={errStyle}>{error}</div>}

          {/* External channel */}
          <label style={labelStyle}>
            Площадка *
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select
                value={form.external_channel_id}
                onChange={e => setForm(p => ({ ...p, external_channel_id: e.target.value }))}
                required
                style={{ flex: 1 }}
              >
                <option value="">— выберите —</option>
                {extChannels.map(ch => (
                  <option key={ch.id} value={ch.id}>{ch.name}</option>
                ))}
              </select>
              {!showNewChannel && (
                <button type="button" onClick={() => setShowNewChannel(true)} style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                  + новая
                </button>
              )}
            </div>
          </label>

          {showNewChannel && (
            <div style={inlineChannelStyle}>
              <form onSubmit={onAddChannel} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input
                  placeholder="Название площадки *"
                  value={newChName}
                  onChange={e => setNewChName(e.target.value)}
                  required
                  autoFocus
                />
                <input
                  placeholder="Ссылка (необязательно)"
                  value={newChLink}
                  onChange={e => setNewChLink(e.target.value)}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="submit" disabled={addingCh} style={{ fontSize: 12 }}>
                    {addingCh ? 'Добавление…' : 'Добавить'}
                  </button>
                  <button type="button" onClick={() => setShowNewChannel(false)} style={{ fontSize: 12 }}>
                    Отмена
                  </button>
                </div>
              </form>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={labelStyle}>
              Дата *
              <input
                type="date"
                value={form.date}
                onChange={e => setForm(p => ({ ...p, date: e.target.value }))}
                required
              />
            </label>
            <label style={labelStyle}>
              Формат *
              <select
                value={form.format}
                onChange={e => setForm(p => ({ ...p, format: e.target.value as AdFormat }))}
              >
                <option value="post">Пост</option>
                <option value="repost">Репост</option>
                <option value="integration">Интеграция</option>
                <option value="other">Другое</option>
              </select>
            </label>
            <label style={labelStyle}>
              Сумма *
              <input
                type="number"
                min={0}
                step="0.01"
                placeholder="0"
                value={form.price}
                onChange={e => setForm(p => ({ ...p, price: e.target.value }))}
                required
              />
            </label>
            <label style={labelStyle}>
              Валюта
              <input
                value={form.currency}
                onChange={e => setForm(p => ({ ...p, currency: e.target.value }))}
                maxLength={10}
              />
            </label>
          </div>

          <label style={labelStyle}>
            Статус
            <select
              value={form.status}
              onChange={e => setForm(p => ({ ...p, status: e.target.value as PurchaseStatus }))}
            >
              <option value="planned">Запланировано</option>
              <option value="placed">Размещено</option>
              <option value="cancelled">Отменено</option>
            </select>
          </label>

          <label style={labelStyle}>
            Комментарий
            <textarea
              rows={2}
              value={form.comment}
              onChange={e => setForm(p => ({ ...p, comment: e.target.value }))}
              style={{ resize: 'vertical' }}
            />
          </label>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="button" onClick={onClose}>Отмена</button>
            <button type="submit" disabled={submitting}>
              {submitting ? 'Сохранение…' : 'Сохранить'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Styles ───────────────────────────────────────────────────────────────────

const headerRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 16,
}

const filtersRowStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  marginBottom: 16,
  flexWrap: 'wrap',
}

const filterSelectStyle: CSSProperties = {
  fontSize: 13,
  padding: '5px 8px',
}

const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  background: '#FEFEFE',
}

const thStyle: CSSProperties = {
  textAlign: 'left',
  padding: '10px 14px',
  borderBottom: '1px solid #E8DDD3',
  fontWeight: 600,
  fontSize: 13,
  background: '#F0E8DE',
  color: '#8C7B6E',
}

const tdStyle: CSSProperties = {
  padding: '9px 14px',
  borderBottom: '1px solid #E8DDD3',
  fontSize: 13,
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(44,43,40,0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 100,
}

const modalStyle: CSSProperties = {
  background: '#FEFEFE',
  borderRadius: 10,
  padding: 24,
  width: 480,
  maxHeight: '90vh',
  overflowY: 'auto',
  boxShadow: '0 8px 40px rgba(44,43,40,0.15)',
}

const modalHeaderStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 16,
}

const closeBtnStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  fontSize: 22,
  cursor: 'pointer',
  lineHeight: 1,
  padding: 0,
  color: '#8C7B6E',
}

const formStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
}

const errStyle: CSSProperties = {
  color: '#dc2626',
  fontSize: 13,
}

const labelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 13,
  fontWeight: 500,
  color: '#2C2B28',
}

const inlineChannelStyle: CSSProperties = {
  background: '#F0E8DE',
  border: '1px solid #E8DDD3',
  borderRadius: 6,
  padding: 12,
}
