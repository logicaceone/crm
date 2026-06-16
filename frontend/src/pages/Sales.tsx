import { useState, useEffect, FormEvent, CSSProperties } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { apiFetch } from '../lib/api'

// ── Types ────────────────────────────────────────────────────────────────────

interface Channel {
  id: number
  name: string
}

interface Sale {
  id: number
  client_name: string
  channel_id: number
  channel: Channel
  date: string
  price: number
  currency: string
  format: AdFormat
  status: SaleStatus
  comment: string | null
  created_by: number
  creator: { id: number; username: string }
  created_at: string
}

interface Summary {
  total: number
  currency: string
  count: number
}

type AdFormat = 'post' | 'repost' | 'integration' | 'other'
type SaleStatus = 'agreed' | 'placed' | 'paid' | 'cancelled'

const FORMAT_LABELS: Record<AdFormat, string> = {
  post: 'Пост',
  repost: 'Репост',
  integration: 'Интеграция',
  other: 'Другое',
}

const STATUS_LABELS: Record<SaleStatus, string> = {
  agreed: 'Согласовано',
  placed: 'Размещено',
  paid: 'Оплачено',
  cancelled: 'Отменено',
}

const STATUS_COLORS: Record<SaleStatus, string> = {
  agreed: '#D4B896',
  placed: '#C07D4A',
  paid: '#16a34a',
  cancelled: '#dc2626',
}

// ── Helpers ──────────────────────────────────────────────────────────────────

interface Filters {
  channel_id: string
  status: string
  client_name: string
  from: string
  to: string
}

function buildQS(f: Filters): string {
  const p = new URLSearchParams()
  if (f.channel_id) p.set('channel_id', f.channel_id)
  if (f.status) p.set('status', f.status)
  if (f.client_name) p.set('client_name', f.client_name)
  if (f.from) p.set('from', f.from)
  if (f.to) p.set('to', f.to)
  const s = p.toString()
  return s ? `?${s}` : ''
}

const emptyFilters: Filters = { channel_id: '', status: '', client_name: '', from: '', to: '' }

const emptyForm = {
  client_name: '',
  channel_id: '',
  date: new Date().toISOString().slice(0, 10),
  price: '',
  currency: 'RUB',
  format: 'post' as AdFormat,
  status: 'agreed' as SaleStatus,
  comment: '',
}

// ── Component ────────────────────────────────────────────────────────────────

export function Sales() {
  const { user } = useAuth()
  const canWrite = user?.role === 'root' || user?.role === 'admin' || user?.role === 'manager'

  const [channels, setChannels] = useState<Channel[]>([])
  const [sales, setSales] = useState<Sale[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [filters, setFilters] = useState<Filters>(emptyFilters)
  const [clientSearch, setClientSearch] = useState('')
  const [pageError, setPageError] = useState('')

  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState(emptyForm)
  const [createError, setCreateError] = useState('')
  const [creating, setCreating] = useState(false)

  const [editSale, setEditSale] = useState<Sale | null>(null)
  const [editForm, setEditForm] = useState(emptyForm)
  const [editError, setEditError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadChannels()
  }, [])

  useEffect(() => {
    loadSales()
    loadSummary()
  }, [filters])

  async function loadChannels() {
    const res = await apiFetch('/api/channels')
    if (res.ok) setChannels(await res.json())
  }

  async function loadSales() {
    const res = await apiFetch(`/api/sales${buildQS(filters)}`)
    if (res.ok) setSales(await res.json())
    else setPageError('Не удалось загрузить продажи')
  }

  async function loadSummary() {
    const res = await apiFetch(`/api/sales/summary${buildQS(filters)}`)
    if (res.ok) setSummary(await res.json())
  }

  function applyClientSearch() {
    setFilters(p => ({ ...p, client_name: clientSearch }))
  }

  // ── Create ───────────────────────────────────────────────────────────────

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setCreateError('')
    setCreating(true)
    try {
      const res = await apiFetch('/api/sales', {
        method: 'POST',
        body: JSON.stringify({
          client_name: createForm.client_name,
          channel_id: Number(createForm.channel_id),
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
      const created: Sale = await res.json()
      setSales(prev => [created, ...prev])
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

  // ── Edit ─────────────────────────────────────────────────────────────────

  function openEdit(s: Sale) {
    setEditSale(s)
    setEditForm({
      client_name: s.client_name,
      channel_id: String(s.channel_id),
      date: s.date,
      price: String(s.price),
      currency: s.currency,
      format: s.format,
      status: s.status,
      comment: s.comment ?? '',
    })
    setEditError('')
  }

  async function handleEdit(e: FormEvent) {
    e.preventDefault()
    if (!editSale) return
    setEditError('')
    setSaving(true)
    try {
      const res = await apiFetch(`/api/sales/${editSale.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          client_name: editForm.client_name,
          channel_id: Number(editForm.channel_id),
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
      const updated: Sale = await res.json()
      setSales(prev => prev.map(s => (s.id === updated.id ? updated : s)))
      setEditSale(null)
      loadSummary()
    } finally {
      setSaving(false)
    }
  }

  // ── Delete ───────────────────────────────────────────────────────────────

  async function handleDelete(s: Sale) {
    if (!confirm(`Удалить продажу клиенту "${s.client_name}" от ${s.date}?`)) return
    const res = await apiFetch(`/api/sales/${s.id}`, { method: 'DELETE' })
    if (res.ok || res.status === 204) {
      setSales(prev => prev.filter(x => x.id !== s.id))
      setSummary(prev =>
        prev ? { ...prev, total: prev.total - s.price, count: prev.count - 1 } : prev
      )
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  if (pageError) return <p style={{ color: 'red' }}>{pageError}</p>

  const hasFilters = Object.values(filters).some(Boolean)

  return (
    <div>
      <div style={headerRowStyle}>
        <h1 style={{ margin: 0 }}>Продажи</h1>
        {canWrite && (
          <button onClick={() => { setShowCreate(true); setCreateForm(emptyForm); setCreateError('') }}>
            + Добавить продажу
          </button>
        )}
      </div>

      {/* Filters */}
      <div style={filtersRowStyle}>
        <div style={{ display: 'flex', gap: 4 }}>
          <input
            placeholder="Поиск по клиенту…"
            value={clientSearch}
            onChange={e => setClientSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && applyClientSearch()}
            style={{ ...filterInputStyle, width: 180 }}
          />
          <button onClick={applyClientSearch} style={{ fontSize: 12, padding: '5px 10px' }}>
            Найти
          </button>
        </div>

        <select
          value={filters.channel_id}
          onChange={e => setFilters(p => ({ ...p, channel_id: e.target.value }))}
          style={filterInputStyle}
        >
          <option value="">Все каналы</option>
          {channels.map(ch => (
            <option key={ch.id} value={ch.id}>{ch.name}</option>
          ))}
        </select>

        <select
          value={filters.status}
          onChange={e => setFilters(p => ({ ...p, status: e.target.value }))}
          style={filterInputStyle}
        >
          <option value="">Все статусы</option>
          <option value="agreed">Согласовано</option>
          <option value="placed">Размещено</option>
          <option value="paid">Оплачено</option>
          <option value="cancelled">Отменено</option>
        </select>

        <input
          type="date"
          value={filters.from}
          onChange={e => setFilters(p => ({ ...p, from: e.target.value }))}
          style={filterInputStyle}
        />
        <span style={{ alignSelf: 'center', color: '#D4B896', fontSize: 13 }}>—</span>
        <input
          type="date"
          value={filters.to}
          onChange={e => setFilters(p => ({ ...p, to: e.target.value }))}
          style={filterInputStyle}
        />

        {hasFilters && (
          <button
            onClick={() => { setFilters(emptyFilters); setClientSearch('') }}
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
            <th style={thStyle}>Клиент</th>
            <th style={thStyle}>Канал</th>
            <th style={thStyle}>Формат</th>
            <th style={thStyle}>Сумма</th>
            <th style={thStyle}>Статус</th>
            <th style={thStyle}>Автор</th>
            {canWrite && <th style={thStyle}>Действия</th>}
          </tr>
        </thead>
        <tbody>
          {sales.length === 0 ? (
            <tr>
              <td colSpan={canWrite ? 8 : 7} style={{ ...tdStyle, textAlign: 'center', color: '#D4B896' }}>
                Нет продаж
              </td>
            </tr>
          ) : (
            sales.map(s => (
              <tr key={s.id}>
                <td style={tdStyle}>{s.date}</td>
                <td style={tdStyle}>{s.client_name}</td>
                <td style={tdStyle}>{s.channel.name}</td>
                <td style={tdStyle}>{FORMAT_LABELS[s.format]}</td>
                <td style={tdStyle}>
                  {s.price.toLocaleString('ru-RU', { minimumFractionDigits: 0 })} {s.currency}
                </td>
                <td style={tdStyle}>
                  <span style={{ color: STATUS_COLORS[s.status], fontWeight: 500, fontSize: 13 }}>
                    {STATUS_LABELS[s.status]}
                  </span>
                </td>
                <td style={{ ...tdStyle, color: '#8C7B6E' }}>{s.creator.username}</td>
                {canWrite && (
                  <td style={tdStyle}>
                    <button onClick={() => openEdit(s)} style={{ marginRight: 8 }}>Редакт.</button>
                    <button onClick={() => handleDelete(s)} style={{ background: 'transparent', color: '#dc2626', borderColor: '#dc2626' }}>Удалить</button>
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
        {summary !== null && sales.length > 0 && (
          <tfoot>
            <tr>
              <td colSpan={4} style={{ ...tdStyle, fontWeight: 600, background: '#F0E8DE', borderTop: '2px solid #E8DDD3' }}>
                Итого ({summary.count} продаж)
              </td>
              <td style={{ ...tdStyle, fontWeight: 600, background: '#F0E8DE', borderTop: '2px solid #E8DDD3' }}>
                {summary.total.toLocaleString('ru-RU', { minimumFractionDigits: 0 })} {summary.currency}
              </td>
              <td colSpan={canWrite ? 3 : 2} style={{ background: '#F0E8DE', borderTop: '2px solid #E8DDD3' }} />
            </tr>
          </tfoot>
        )}
      </table>

      {/* Create modal */}
      {showCreate && (
        <SaleModal
          title="Добавить продажу"
          form={createForm}
          setForm={setCreateForm}
          error={createError}
          submitting={creating}
          channels={channels}
          onSubmit={handleCreate}
          onClose={() => setShowCreate(false)}
        />
      )}

      {/* Edit modal */}
      {editSale && (
        <SaleModal
          title="Редактировать продажу"
          form={editForm}
          setForm={setEditForm}
          error={editError}
          submitting={saving}
          channels={channels}
          onSubmit={handleEdit}
          onClose={() => setEditSale(null)}
        />
      )}
    </div>
  )
}

// ── SaleModal ─────────────────────────────────────────────────────────────────

interface SaleModalProps {
  title: string
  form: typeof emptyForm
  setForm: React.Dispatch<React.SetStateAction<typeof emptyForm>>
  error: string
  submitting: boolean
  channels: Channel[]
  onSubmit: (e: FormEvent) => void
  onClose: () => void
}

function SaleModal({ title, form, setForm, error, submitting, channels, onSubmit, onClose }: SaleModalProps) {
  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        <div style={modalHeaderStyle}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
          <button onClick={onClose} style={closeBtnStyle}>×</button>
        </div>

        <form onSubmit={onSubmit} style={formStyle}>
          {error && <div style={errStyle}>{error}</div>}

          <label style={labelStyle}>
            Клиент *
            <input
              placeholder="Название клиента"
              value={form.client_name}
              onChange={e => setForm(p => ({ ...p, client_name: e.target.value }))}
              required
              autoFocus
            />
          </label>

          <label style={labelStyle}>
            Наш канал *
            <select
              value={form.channel_id}
              onChange={e => setForm(p => ({ ...p, channel_id: e.target.value }))}
              required
            >
              <option value="">— выберите —</option>
              {channels.map(ch => (
                <option key={ch.id} value={ch.id}>{ch.name}</option>
              ))}
            </select>
          </label>

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
              onChange={e => setForm(p => ({ ...p, status: e.target.value as SaleStatus }))}
            >
              <option value="agreed">Согласовано</option>
              <option value="placed">Размещено</option>
              <option value="paid">Оплачено</option>
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

// ── Styles ────────────────────────────────────────────────────────────────────

const headerRowStyle: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }
const filtersRowStyle: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }
const filterInputStyle: CSSProperties = { fontSize: 13, padding: '5px 8px' }
const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', background: '#FEFEFE' }
const thStyle: CSSProperties = { textAlign: 'left', padding: '10px 14px', borderBottom: '1px solid #E8DDD3', fontWeight: 600, fontSize: 13, background: '#F0E8DE', color: '#8C7B6E' }
const tdStyle: CSSProperties = { padding: '9px 14px', borderBottom: '1px solid #E8DDD3', fontSize: 13 }
const overlayStyle: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(44,43,40,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }
const modalStyle: CSSProperties = { background: '#FEFEFE', borderRadius: 10, padding: 24, width: 460, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 8px 40px rgba(44,43,40,0.15)' }
const modalHeaderStyle: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }
const closeBtnStyle: CSSProperties = { background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', lineHeight: 1, padding: 0, color: '#8C7B6E' }
const formStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 }
const errStyle: CSSProperties = { color: '#dc2626', fontSize: 13 }
const labelStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, fontWeight: 500, color: '#2C2B28' }
