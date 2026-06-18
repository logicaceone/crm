import { useState, useEffect, useRef, FormEvent, CSSProperties } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { useConfirm } from '../contexts/ConfirmContext'
import { apiFetch } from '../lib/api'
import { DateRangePicker } from '../components/DateRangePicker'
import { KebabMenu } from '../components/KebabMenu'
import { Modal } from '../components/Modal'
import { Pagination } from '../components/Pagination'

const PER_PAGE = 15

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
  const toast = useToast()
  const confirm = useConfirm()
  const canWrite = user?.role === 'root' || user?.role === 'admin' || user?.role === 'manager'

  const [channels, setChannels] = useState<Channel[]>([])
  const [sales, setSales] = useState<Sale[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [filters, setFilters] = useState<Filters>(emptyFilters)
  const [rangeError, setRangeError] = useState<string | null>(null)
  const [clientSearch, setClientSearch] = useState('')
  const [pageError, setPageError] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const tableRef = useRef<HTMLDivElement>(null)

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
    setPage(1)
  }, [filters])

  useEffect(() => {
    loadSales()
    loadSummary()
  }, [filters, page])

  async function loadChannels() {
    const res = await apiFetch('/api/channels')
    if (res.ok) setChannels(await res.json())
  }

  async function loadSales() {
    const qs = buildQS(filters)
    const sep = qs ? '&' : '?'
    const res = await apiFetch(`/api/sales${qs}${sep}page=${page}&per_page=${PER_PAGE}`)
    if (res.ok) {
      const data = await res.json()
      setSales(data.items)
      setTotal(data.pagination.total)
      setTotalPages(data.pagination.total_pages)
    } else {
      setPageError('Не удалось загрузить продажи')
    }
  }

  function changePage(p: number) {
    setPage(p)
    tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
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
        const msg = d.detail ?? 'Ошибка создания'
        setCreateError(msg)
        toast.error(msg)
        return
      }
      await res.json()
      await Promise.all([loadSales(), loadSummary()])
      setShowCreate(false)
      setCreateForm(emptyForm)
      toast.success('Продажа добавлена')
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
        const msg = d.detail ?? 'Ошибка сохранения'
        setEditError(msg)
        toast.error(msg)
        return
      }
      const updated: Sale = await res.json()
      setSales(prev => prev.map(s => (s.id === updated.id ? updated : s)))
      setEditSale(null)
      loadSummary()
      toast.success('Продажа сохранена')
    } finally {
      setSaving(false)
    }
  }

  // ── Delete ───────────────────────────────────────────────────────────────

  async function handleDelete(s: Sale) {
    if (!await confirm(`Удалить продажу клиенту "${s.client_name}" от ${s.date}?`)) return
    const res = await apiFetch(`/api/sales/${s.id}`, { method: 'DELETE' })
    if (res.ok || res.status === 204) {
      await Promise.all([loadSales(), loadSummary()])
      toast.success('Продажа удалена')
    } else {
      toast.error('Не удалось удалить продажу')
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
      <div style={filtersRowStyle} className="filters-bar">
        <div style={{ display: 'flex', gap: 4 }}>
          <input
            placeholder="Поиск по клиенту…"
            value={clientSearch}
            onChange={e => setClientSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && applyClientSearch()}
            style={{ ...filterInputStyle, width: 180 }}
            className="filter-search-input"
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

        <DateRangePicker
          dateFrom={filters.from}
          dateTo={filters.to}
          onChange={(from, to) => setFilters(p => ({ ...p, from, to }))}
          onError={setRangeError}
          error={rangeError}
        />

        {hasFilters && (
          <button
            onClick={() => { setFilters(emptyFilters); setClientSearch(''); setRangeError(null) }}
            style={{ fontSize: 12, color: '#8C7B6E', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            Сбросить
          </button>
        )}
      </div>

      {/* Table */}
      <div ref={tableRef} className="table-scroll"><table style={tableStyle}>
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
                  <td style={{ ...tdStyle, width: 48, textAlign: 'center' }}>
                    <KebabMenu actions={[
                      { label: 'Редактировать', onClick: () => openEdit(s) },
                      { label: 'Удалить', onClick: () => handleDelete(s), danger: true },
                    ]} />
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table></div>

      <Pagination
        page={page}
        total_pages={totalPages}
        total={total}
        per_page={PER_PAGE}
        onChange={changePage}
      />

      {summary !== null && total > 0 && (
        <div style={summaryRowStyle}>
          <div>Итого ({summary.count} продаж)</div>
          <div style={{ fontWeight: 700 }}>
            {summary.total.toLocaleString('ru-RU', { minimumFractionDigits: 0 })} {summary.currency}
          </div>
        </div>
      )}

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
    <Modal title={title} onClose={onClose}>
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

          <div className="form-row-2col">
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
          </div>

          <div className="form-row-2col">
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
              <div className="currency-badge">₽ RUB</div>
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

          <div className="modal-footer">
            <button type="button" onClick={onClose}>Отмена</button>
            <button type="submit" disabled={submitting}>
              {submitting ? 'Сохранение…' : 'Сохранить'}
            </button>
          </div>
        </form>
    </Modal>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const headerRowStyle: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }
const filtersRowStyle: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }
const filterInputStyle: CSSProperties = { fontSize: 13, padding: '5px 8px' }
const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', background: '#FEFEFE' }
const summaryRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
  flexWrap: 'wrap',
  padding: '12px 16px',
  background: '#F0E8DE',
  border: '1px solid #E8DDD3',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  marginTop: 8,
}
const thStyle: CSSProperties = { textAlign: 'left', padding: '10px 14px', borderBottom: '1.5px solid #E8DDD3', fontWeight: 700, fontSize: 11, background: '#F0E8DE', color: '#8C7B6E', letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap' }
const tdStyle: CSSProperties = { padding: '9px 14px', borderBottom: '1px solid #E8DDD3', fontSize: 13 }
const formStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 }
const errStyle: CSSProperties = { color: '#dc2626', fontSize: 13 }
const labelStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, fontWeight: 500, color: '#2C2B28' }
