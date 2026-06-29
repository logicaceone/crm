import { useState, useEffect, useRef, FormEvent, CSSProperties } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { useConfirm } from '../contexts/ConfirmContext'
import { apiFetch } from '../lib/api'
import { DateRangePicker } from '../components/DateRangePicker'
import { KebabMenu } from '../components/KebabMenu'
import { SkeletonTable } from '../components/PageSkeleton'
import { Modal } from '../components/Modal'
import { Pagination } from '../components/Pagination'

const PER_PAGE = 15

// ── Types ────────────────────────────────────────────────────────────────────

type ExpenseCategory =
  | 'tg_ads' | 'vk_ads' | 'yandex' | 'blogger'
  | 'subscribers' | 'lunch' | 'giveaway' | 'services' | 'salary' | 'other'

type ExpenseStatus = 'planned' | 'placed' | 'cancelled'

const CPA_CATEGORIES = new Set<ExpenseCategory>(['tg_ads', 'vk_ads', 'yandex', 'blogger'])
const RESPONSIBLE_REQUIRED = new Set<ExpenseCategory>([
  'subscribers', 'lunch', 'giveaway', 'services', 'salary', 'other',
])
const COMMENT_REQUIRED = new Set<ExpenseCategory>(['salary', 'other'])

interface ExternalChannel {
  id: number
  name: string
  tg_link: string | null
}

interface InternalChannel {
  id: number
  name: string
  platform: 'telegram' | 'max'
}

interface Expense {
  id: number
  category: ExpenseCategory
  external_channel_id: number | null
  external_channel: ExternalChannel | null
  channel_id: number | null
  channel: { id: number; name: string; platform: string } | null
  date: string
  price: number
  currency: string
  status: ExpenseStatus
  comment: string | null
  responsible: string | null
  invite_link: string | null
  joined_count: number
  left_count: number
  cpa_synced_at: string | null
  created_by: number
  creator: { id: number; username: string }
  created_at: string
}

interface Summary {
  total: number
  currency: string
  count: number
  by_category: Record<string, number>
}

interface Filters {
  external_channel_id: string
  status: string
  from: string
  to: string
  category: string
  responsible: string
}

type FormState = {
  category: ExpenseCategory
  external_channel_id: string
  channel_id: string
  date: string
  price: string
  status: ExpenseStatus
  comment: string
  responsible: string
  invite_link: string
  joined_count: string
  left_count: string
}

// ── Category metadata ────────────────────────────────────────────────────────

const CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  tg_ads: 'TG Ads',
  vk_ads: 'VK Ads',
  yandex: 'Яндекс',
  blogger: 'Реклама у блогеров',
  subscribers: 'Оплата подписчикам',
  lunch: 'Обеды',
  giveaway: 'Подарки',
  services: 'Сервисы',
  salary: 'Зарплата',
  other: 'Прочие',
}

const CATEGORY_BADGE_LABEL: Record<ExpenseCategory, string> = {
  tg_ads: 'TG Ads',
  vk_ads: 'VK Ads',
  yandex: 'Яндекс',
  blogger: 'Блогеры',
  subscribers: 'Подписчики',
  lunch: 'Обеды',
  giveaway: 'Подарки',
  services: 'Сервисы',
  salary: 'Зарплата',
  other: 'Прочие',
}

const CATEGORY_BADGE: Record<ExpenseCategory, { bg: string; fg: string }> = {
  tg_ads:      { bg: '#DBEAFE', fg: '#1D4ED8' }, // синий
  vk_ads:      { bg: '#DBEAFE', fg: '#1D4ED8' }, // синий
  yandex:      { bg: '#FEF3C7', fg: '#B45309' }, // жёлтый
  blogger:     { bg: '#EDE9FE', fg: '#6D28D9' }, // фиолетовый
  subscribers: { bg: '#DCFCE7', fg: '#15803D' }, // зелёный
  lunch:       { bg: '#FFEDD5', fg: '#C2410C' }, // оранжевый
  giveaway:    { bg: '#FCE7F3', fg: '#BE185D' }, // розовый
  services:    { bg: '#E5E7EB', fg: '#374151' }, // серый
  salary:      { bg: '#E0F2FE', fg: '#0369A1' }, // голубой
  other:       { bg: '#E5E7EB', fg: '#374151' }, // серый
}

const CATEGORY_ORDER: ExpenseCategory[] = [
  'tg_ads', 'vk_ads', 'yandex',
  'blogger', 'subscribers',
  'lunch', 'giveaway', 'services',
  'salary', 'other',
]

const STATUS_LABELS: Record<ExpenseStatus, string> = {
  planned: 'Запланировано',
  placed: 'Размещено',
  cancelled: 'Отменено',
}

const STATUS_COLORS: Record<ExpenseStatus, string> = {
  planned: '#C07D4A',
  placed: '#16a34a',
  cancelled: '#D4B896',
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatRelativeTime(iso: string): string {
  const ts = new Date(iso).getTime()
  if (isNaN(ts)) return ''
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (sec < 60) return 'только что'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} мин назад`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} ч назад`
  const days = Math.floor(hr / 24)
  if (days < 30) return `${days} дн назад`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} мес назад`
  return `${Math.floor(months / 12)} г назад`
}

function buildQS(f: Filters): string {
  const p = new URLSearchParams()
  if (f.external_channel_id) p.set('external_channel_id', f.external_channel_id)
  if (f.status) p.set('status', f.status)
  if (f.from) p.set('from', f.from)
  if (f.to) p.set('to', f.to)
  if (f.category) p.set('category', f.category)
  if (f.responsible) p.set('responsible', f.responsible)
  const s = p.toString()
  return s ? `?${s}` : ''
}

function makeEmptyForm(category: ExpenseCategory = 'tg_ads'): FormState {
  return {
    category,
    external_channel_id: '',
    channel_id: '',
    date: new Date().toISOString().slice(0, 10),
    price: '',
    status: 'planned',
    comment: '',
    responsible: '',
    invite_link: '',
    joined_count: '',
    left_count: '',
  }
}

// ── Component ────────────────────────────────────────────────────────────────

export function Expenses() {
  const { user } = useAuth()
  const toast = useToast()
  const confirm = useConfirm()
  const canWrite = user?.role === 'root' || user?.role === 'admin' || user?.role === 'manager'

  const [extChannels, setExtChannels] = useState<ExternalChannel[]>([])
  const [intChannels, setIntChannels] = useState<InternalChannel[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [filters, setFilters] = useState<Filters>({
    external_channel_id: '', status: '', from: '', to: '',
    category: '', responsible: '',
  })
  const [rangeError, setRangeError] = useState<string | null>(null)
  const [pageError, setPageError] = useState('')
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const tableRef = useRef<HTMLDivElement>(null)

  // Create flow: 'select' (category picker) → 'form'
  const [createStep, setCreateStep] = useState<'select' | 'form'>('select')
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState<FormState>(makeEmptyForm())
  const [createError, setCreateError] = useState('')
  const [creating, setCreating] = useState(false)

  const [showNewChannel, setShowNewChannel] = useState(false)
  const [newChName, setNewChName] = useState('')
  const [newChLink, setNewChLink] = useState('')
  const [addingCh, setAddingCh] = useState(false)

  const [editExpense, setEditExpense] = useState<Expense | null>(null)
  const [editForm, setEditForm] = useState<FormState>(makeEmptyForm())
  const [editError, setEditError] = useState('')
  const [saving, setSaving] = useState(false)

  const [creatingLinkId, setCreatingLinkId] = useState<number | null>(null)
  const [syncingCpaId, setSyncingCpaId] = useState<number | null>(null)

  useEffect(() => {
    loadExtChannels()
    loadIntChannels()
  }, [])

  useEffect(() => { setPage(1) }, [filters])

  useEffect(() => {
    loadExpenses()
    loadSummary()
  }, [filters, page])

  async function loadExtChannels() {
    const res = await apiFetch('/api/external-channels/all')
    if (res.ok) setExtChannels(await res.json())
  }

  async function loadIntChannels() {
    const res = await apiFetch('/api/channels/all')
    if (res.ok) setIntChannels(await res.json())
  }

  async function loadExpenses() {
    const qs = buildQS(filters)
    const sep = qs ? '&' : '?'
    const res = await apiFetch(`/api/expenses${qs}${sep}page=${page}&per_page=${PER_PAGE}`)
    if (res.ok) {
      const data = await res.json()
      if (data.pagination.total_pages > 0 && page > data.pagination.total_pages) {
        setPage(data.pagination.total_pages)
        return
      }
      setExpenses(data.items)
      setTotal(data.pagination.total)
      setTotalPages(data.pagination.total_pages)
    } else {
      setPageError('Не удалось загрузить расходы')
    }
    setLoading(false)
  }

  function changePage(p: number) {
    setPage(p)
    tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function loadSummary() {
    const res = await apiFetch(`/api/expenses/summary${buildQS(filters)}`)
    if (res.ok) setSummary(await res.json())
  }

  async function handleAddChannel() {
    if (!newChName.trim()) return
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

  function openCreate() {
    setCreateStep('select')
    setCreateForm(makeEmptyForm())
    setCreateError('')
    setShowNewChannel(false)
    setShowCreate(true)
  }

  function selectCategory(cat: ExpenseCategory) {
    setCreateForm(makeEmptyForm(cat))
    setCreateStep('form')
  }

  function buildBody(form: FormState): Record<string, unknown> {
    const isCPA = CPA_CATEGORIES.has(form.category)
    const isBlogger = form.category === 'blogger'
    // Non-CPA categories don't have a status step in the form — the
    // expense has already happened by the time it's logged, so we
    // force "placed".
    const status = isCPA ? form.status : 'placed'
    return {
      category: form.category,
      date: form.date,
      price: Number(form.price),
      currency: 'RUB',
      status,
      comment: form.comment || null,
      responsible: form.responsible || null,
      external_channel_id: isBlogger && form.external_channel_id
        ? Number(form.external_channel_id) : null,
      channel_id: isCPA && form.channel_id ? Number(form.channel_id) : null,
      invite_link: isCPA && form.invite_link ? form.invite_link : null,
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setCreateError('')
    setCreating(true)
    try {
      const res = await apiFetch('/api/expenses', {
        method: 'POST',
        body: JSON.stringify(buildBody(createForm)),
      })
      if (!res.ok) {
        const d = await res.json()
        const msg = d.detail ?? 'Ошибка создания'
        setCreateError(msg)
        toast.error(msg)
        return
      }
      await res.json()
      await Promise.all([loadExpenses(), loadSummary()])
      setShowCreate(false)
      toast.success('Расход добавлен')
    } finally {
      setCreating(false)
    }
  }

  function openEdit(e: Expense) {
    setEditExpense(e)
    setEditForm({
      category: e.category,
      external_channel_id: e.external_channel_id != null ? String(e.external_channel_id) : '',
      channel_id: e.channel_id != null ? String(e.channel_id) : '',
      date: e.date,
      price: String(e.price),
      status: e.status,
      comment: e.comment ?? '',
      responsible: e.responsible ?? '',
      invite_link: e.invite_link ?? '',
      joined_count: String(e.joined_count),
      left_count: String(e.left_count),
    })
    setEditError('')
  }

  async function handleEdit(e: FormEvent) {
    e.preventDefault()
    if (!editExpense) return
    setEditError('')
    setSaving(true)
    try {
      const ch = intChannels.find(c => c.id === Number(editForm.channel_id))
      const isMax = ch?.platform === 'max'
      const body: Record<string, unknown> = buildBody(editForm)
      // For Max channels CPA is manual — let users edit the counters.
      if (CPA_CATEGORIES.has(editForm.category) && isMax) {
        if (editForm.joined_count !== '') body.joined_count = Number(editForm.joined_count)
        if (editForm.left_count !== '') body.left_count = Number(editForm.left_count)
      }
      const res = await apiFetch(`/api/expenses/${editExpense.id}`, {
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
      const updated: Expense = await res.json()
      setExpenses(prev => prev.map(x => (x.id === updated.id ? updated : x)))
      setEditExpense(null)
      loadSummary()
      toast.success('Расход сохранён')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(e: Expense) {
    const label = `Удалить расход «${CATEGORY_LABEL[e.category]}» от ${e.date}?`
    if (!await confirm(label)) return
    const res = await apiFetch(`/api/expenses/${e.id}`, { method: 'DELETE' })
    if (res.ok || res.status === 204) {
      await Promise.all([loadExpenses(), loadSummary()])
      toast.success('Расход удалён')
    } else {
      toast.error('Не удалось удалить расход')
    }
  }

  async function handleCreateLink(e: Expense) {
    setCreatingLinkId(e.id)
    try {
      const res = await apiFetch(`/api/expenses/${e.id}/invite-link`, { method: 'POST' })
      if (!res.ok) {
        const d = await res.json()
        toast.error(d.detail ?? 'Ошибка создания ссылки')
        return
      }
      const data = await res.json()
      setExpenses(prev => prev.map(x => x.id === e.id ? { ...x, invite_link: data.invite_link } : x))
      toast.success('Инвайт-ссылка создана')
    } finally {
      setCreatingLinkId(null)
    }
  }

  async function handleSyncCpa(e: Expense) {
    setSyncingCpaId(e.id)
    try {
      const res = await apiFetch(`/api/expenses/${e.id}/sync-cpa`, { method: 'POST' })
      if (!res.ok) {
        const d = await res.json()
        toast.error(d.detail ?? 'Ошибка синхронизации CPA')
        if (res.status === 400) {
          await loadExpenses()
        }
        return
      }
      const data = await res.json()
      await loadExpenses()
      toast.success(`CPA обновлено: ${data.joined_count} вступило, ${data.left_count} отписалось`)
    } finally {
      setSyncingCpaId(null)
    }
  }

  async function copyLink(link: string) {
    await navigator.clipboard.writeText(link)
    toast.success('Ссылка скопирована')
  }

  const resetFilters = () => {
    setFilters({ external_channel_id: '', status: '', from: '', to: '', category: '', responsible: '' })
    setRangeError(null)
  }

  const hasFilters = !!(
    filters.external_channel_id || filters.status || filters.from ||
    filters.to || filters.category || filters.responsible
  )

  if (pageError) return <p style={{ color: 'red' }}>{pageError}</p>

  if (loading) return (
    <div>
      <h1 style={{ margin: '0 0 20px', fontSize: 22, fontWeight: 700 }}>Расходы</h1>
      <SkeletonTable rows={8} cols={6} />
    </div>
  )

  const colCount = canWrite ? 8 : 7

  const summaryTooltip = summary
    ? CATEGORY_ORDER
        .filter(c => (summary.by_category[c] ?? 0) > 0)
        .map(c => `${CATEGORY_BADGE_LABEL[c]}: ${(summary.by_category[c] ?? 0).toLocaleString('ru-RU')}`)
        .join('\n')
    : ''

  return (
    <div>
      <div style={headerRowStyle}>
        <h1 style={{ margin: 0 }}>Расходы</h1>
        {canWrite && (
          <button onClick={openCreate}>+ Добавить расход</button>
        )}
      </div>

      {/* Filters — one compact row */}
      <div className="filters-row-compact">
        <select
          value={filters.category}
          onChange={e => setFilters(p => ({ ...p, category: e.target.value }))}
          style={{ width: 180 }}
        >
          <option value="">Все категории</option>
          {CATEGORY_ORDER.map(c => (
            <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
          ))}
        </select>

        <select
          value={filters.status}
          onChange={e => setFilters(p => ({ ...p, status: e.target.value }))}
          style={{ width: 150 }}
        >
          <option value="">Все статусы</option>
          <option value="planned">Запланировано</option>
          <option value="placed">Размещено</option>
          <option value="cancelled">Отменено</option>
        </select>

        <input
          type="text"
          placeholder="Ответственный"
          value={filters.responsible}
          onChange={e => setFilters(p => ({ ...p, responsible: e.target.value }))}
          style={{ width: 160 }}
        />

        <DateRangePicker
          dateFrom={filters.from}
          dateTo={filters.to}
          onChange={(from, to) => setFilters(p => ({ ...p, from, to }))}
          onError={setRangeError}
          error={rangeError}
        />

        {hasFilters && (
          <button onClick={resetFilters} style={clearBtnStyle}>Сбросить</button>
        )}
      </div>

      {/* Table */}
      <div ref={tableRef} className="table-scroll">
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Дата</th>
              <th style={thStyle}>Категория</th>
              <th style={thStyle}>Площадка</th>
              <th style={thStyle}>Канал</th>
              <th style={thStyle}>Сумма</th>
              <th style={thStyle}>Ответственный</th>
              <th style={thStyle}>Статус</th>
              {canWrite && <th style={thStyle}>Действия</th>}
            </tr>
          </thead>
          <tbody>
            {expenses.length === 0 ? (
              <tr>
                <td colSpan={colCount} style={{ ...tdStyle, textAlign: 'center', color: '#D4B896' }}>Нет расходов</td>
              </tr>
            ) : (
              expenses.map(e => {
                const badge = CATEGORY_BADGE[e.category]
                const isCPA = CPA_CATEGORIES.has(e.category)
                const isTg = e.channel?.platform === 'telegram'
                return (
                  <tr key={e.id}>
                    <td style={tdStyle}>{e.date}</td>
                    <td style={tdStyle}>
                      <span style={{ ...categoryBadgeStyle, background: badge.bg, color: badge.fg }}>
                        {CATEGORY_BADGE_LABEL[e.category]}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      {e.category === 'blogger' ? (e.external_channel?.name ?? '—') : '—'}
                    </td>
                    <td style={{ ...tdStyle, color: '#8C7B6E', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {e.channel ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span>
                            <span style={{ fontSize: 10, fontWeight: 700, color: e.channel.platform === 'telegram' ? '#0088cc' : '#c0392b', marginRight: 4 }}>
                              {e.channel.platform === 'telegram' ? 'TG' : 'MAX'}
                            </span>
                            {e.channel.name}
                          </span>
                          {isCPA && e.invite_link && (
                            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                              <span title="вступило">+{e.joined_count}</span>
                              {e.left_count > 0 && <span style={{ color: '#dc2626' }} title="отписалось">−{e.left_count}</span>}
                              {e.cpa_synced_at && (
                                <span style={{ color: '#8C7B6E' }} title={new Date(e.cpa_synced_at).toLocaleString('ru-RU')}>
                                  · {formatRelativeTime(e.cpa_synced_at)}
                                </span>
                              )}
                              {isTg && canWrite && (
                                <button
                                  onClick={() => handleSyncCpa(e)}
                                  disabled={syncingCpaId === e.id}
                                  style={microBtnStyle}
                                  title="Обновить из Telegram"
                                >
                                  {syncingCpaId === e.id ? '…' : 'Обн.'}
                                </button>
                              )}
                            </span>
                          )}
                          {isCPA && !e.invite_link && isTg && canWrite && (
                            <button onClick={() => handleCreateLink(e)} disabled={creatingLinkId === e.id} style={microBtnStyle}>
                              {creatingLinkId === e.id ? '…' : 'Создать ссылку'}
                            </button>
                          )}
                          {isCPA && e.invite_link && (
                            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                              <a href={e.invite_link} target="_blank" rel="noopener noreferrer"
                                style={{ color: '#C07D4A', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>
                                {e.invite_link.replace('https://', '')}
                              </a>
                              <button onClick={() => copyLink(e.invite_link!)} style={{ ...microBtnStyle, padding: '2px 6px' }} title="Скопировать">⎘</button>
                            </span>
                          )}
                        </div>
                      ) : '—'}
                    </td>
                    <td style={tdStyle}>
                      {e.price.toLocaleString('ru-RU', { minimumFractionDigits: 0 })} {e.currency}
                    </td>
                    <td style={{ ...tdStyle, color: '#8C7B6E' }}>{e.responsible ?? '—'}</td>
                    <td style={tdStyle}>
                      {isCPA ? (
                        <span style={{ color: STATUS_COLORS[e.status], fontWeight: 500, fontSize: 13 }}>
                          {STATUS_LABELS[e.status]}
                        </span>
                      ) : '—'}
                    </td>
                    {canWrite && (
                      <td style={{ ...tdStyle, width: 48, textAlign: 'center' }}>
                        <KebabMenu actions={[
                          { label: 'Редактировать', onClick: () => openEdit(e) },
                          { label: 'Удалить', onClick: () => handleDelete(e), danger: true },
                        ]} />
                      </td>
                    )}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <Pagination
        page={page}
        total_pages={totalPages}
        total={total}
        per_page={PER_PAGE}
        onChange={changePage}
      />

      {summary !== null && total > 0 && (
        <div style={summaryRowStyle} title={summaryTooltip}>
          <div>Итого: {summary.count} расх.</div>
          <div style={{ fontWeight: 700 }}>
            {summary.total.toLocaleString('ru-RU', { minimumFractionDigits: 0 })} {summary.currency}
          </div>
        </div>
      )}

      {showCreate && createStep === 'select' && (
        <CategorySelectModal
          onSelect={selectCategory}
          onClose={() => setShowCreate(false)}
        />
      )}

      {showCreate && createStep === 'form' && (
        <ExpenseFormModal
          title="Добавить расход"
          form={createForm}
          setForm={setCreateForm}
          error={createError}
          submitting={creating}
          extChannels={extChannels}
          intChannels={intChannels}
          showNewChannel={showNewChannel}
          setShowNewChannel={setShowNewChannel}
          newChName={newChName}
          setNewChName={setNewChName}
          newChLink={newChLink}
          setNewChLink={setNewChLink}
          addingCh={addingCh}
          onAddChannel={handleAddChannel}
          onBack={() => setCreateStep('select')}
          onSubmit={handleCreate}
          onClose={() => setShowCreate(false)}
        />
      )}

      {editExpense && (
        <ExpenseFormModal
          title="Редактировать расход"
          form={editForm}
          setForm={setEditForm}
          error={editError}
          submitting={saving}
          extChannels={extChannels}
          intChannels={intChannels}
          showNewChannel={showNewChannel}
          setShowNewChannel={setShowNewChannel}
          newChName={newChName}
          setNewChName={setNewChName}
          newChLink={newChLink}
          setNewChLink={setNewChLink}
          addingCh={addingCh}
          onAddChannel={handleAddChannel}
          onSubmit={handleEdit}
          onClose={() => setEditExpense(null)}
          isEdit
        />
      )}
    </div>
  )
}

// ── CategorySelectModal ──────────────────────────────────────────────────────

function CategorySelectModal({
  onSelect,
  onClose,
}: {
  onSelect: (cat: ExpenseCategory) => void
  onClose: () => void
}) {
  return (
    <Modal title="Добавить расход" onClose={onClose}>
      <p style={{ fontSize: 13, color: '#8C7B6E', margin: '4px 0 16px' }}>
        Выберите категорию расхода
      </p>
      <div className="category-grid" style={categoryGridStyle}>
        {CATEGORY_ORDER.map(cat => {
          const badge = CATEGORY_BADGE[cat]
          return (
            <button
              key={cat}
              type="button"
              onClick={() => onSelect(cat)}
              style={{ ...categoryCardStyle, borderColor: badge.fg + '33' }}
            >
              <span style={{ ...categoryBadgeStyle, background: badge.bg, color: badge.fg, marginBottom: 6 }}>
                {CATEGORY_BADGE_LABEL[cat]}
              </span>
              <span style={{ fontSize: 12, color: '#2C2B28' }}>{CATEGORY_LABEL[cat]}</span>
            </button>
          )
        })}
      </div>
    </Modal>
  )
}

// ── ExpenseFormModal ─────────────────────────────────────────────────────────

interface ExpenseFormModalProps {
  title: string
  form: FormState
  setForm: React.Dispatch<React.SetStateAction<FormState>>
  error: string
  submitting: boolean
  extChannels: ExternalChannel[]
  intChannels: InternalChannel[]
  showNewChannel: boolean
  setShowNewChannel: (v: boolean) => void
  newChName: string
  setNewChName: (v: string) => void
  newChLink: string
  setNewChLink: (v: string) => void
  addingCh: boolean
  onAddChannel: () => void
  onBack?: () => void
  onSubmit: (e: FormEvent) => void
  onClose: () => void
  isEdit?: boolean
}

function ExpenseFormModal({
  title, form, setForm, error, submitting,
  extChannels, intChannels,
  showNewChannel, setShowNewChannel,
  newChName, setNewChName, newChLink, setNewChLink,
  addingCh, onAddChannel, onBack, onSubmit, onClose, isEdit,
}: ExpenseFormModalProps) {
  const isCPA = CPA_CATEGORIES.has(form.category)
  const isBlogger = form.category === 'blogger'
  const respRequired = RESPONSIBLE_REQUIRED.has(form.category)
  const commentRequired = COMMENT_REQUIRED.has(form.category)
  const selectedCh = intChannels.find(c => c.id === Number(form.channel_id))
  const isMax = selectedCh?.platform === 'max'
  const isTg = selectedCh?.platform === 'telegram'

  const badge = CATEGORY_BADGE[form.category]

  return (
    <Modal
      title={title}
      badge={CATEGORY_BADGE_LABEL[form.category]}
      badgeStyle={{ color: badge.fg, background: badge.bg }}
      onBack={onBack}
      onClose={onClose}
    >
      <form onSubmit={onSubmit} style={formStyle}>
        {error && <div style={errStyle}>{error}</div>}

        {isBlogger && (
          <>
            <label style={labelStyle}>
              Площадка размещения *
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <input
                    placeholder="Название площадки *"
                    value={newChName}
                    onChange={e => setNewChName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), onAddChannel())}
                    autoFocus
                  />
                  <input
                    placeholder="Ссылка (необязательно)"
                    value={newChLink}
                    onChange={e => setNewChLink(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), onAddChannel())}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" onClick={onAddChannel} disabled={addingCh} style={{ fontSize: 12 }}>
                      {addingCh ? 'Добавление…' : 'Добавить'}
                    </button>
                    <button type="button" onClick={() => setShowNewChannel(false)} style={{ fontSize: 12 }}>
                      Отмена
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {isCPA && (
          <label style={labelStyle}>
            Наш канал (для CPA)
            <select value={form.channel_id} onChange={e => setForm(p => ({ ...p, channel_id: e.target.value }))}>
              <option value="">— не выбран —</option>
              {intChannels.map(ch => (
                <option key={ch.id} value={ch.id}>
                  [{ch.platform === 'telegram' ? 'TG' : 'MAX'}] {ch.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="form-row-2col">
          <label style={labelStyle}>
            Дата *
            <input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} required />
          </label>
          <label style={labelStyle}>
            Сумма *
            <input
              type="number" min={0} step="0.01" placeholder="0"
              value={form.price}
              onChange={e => setForm(p => ({ ...p, price: e.target.value }))}
              required
            />
          </label>
        </div>

        {isCPA && (
          <label style={labelStyle}>
            Статус
            <select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value as ExpenseStatus }))}>
              <option value="planned">Запланировано</option>
              <option value="placed">Размещено</option>
              <option value="cancelled">Отменено</option>
            </select>
          </label>
        )}

        <label style={labelStyle}>
          Ответственный{respRequired ? ' *' : ''}
          <input
            type="text"
            value={form.responsible}
            onChange={e => setForm(p => ({ ...p, responsible: e.target.value }))}
            required={respRequired}
          />
        </label>

        <label style={labelStyle}>
          Комментарий{commentRequired ? ' *' : ''}
          <textarea
            rows={2}
            value={form.comment}
            onChange={e => setForm(p => ({ ...p, comment: e.target.value }))}
            required={commentRequired}
            style={{ resize: 'vertical' }}
          />
        </label>

        {/* CPA — Max manual fields */}
        {isCPA && isMax && (
          <div style={cpaSectionStyle}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#8C7B6E', marginBottom: 8 }}>
              CPA (Max.ru — вручную)
            </div>
            <label style={labelStyle}>
              Инвайт-ссылка
              <input placeholder="https://max.ru/..." value={form.invite_link} onChange={e => setForm(p => ({ ...p, invite_link: e.target.value }))} />
            </label>
            <div className="form-row-2col" style={{ marginTop: 8 }}>
              <label style={labelStyle}>
                Вступило
                <input type="number" min={0} value={form.joined_count} onChange={e => setForm(p => ({ ...p, joined_count: e.target.value }))} />
              </label>
              <label style={labelStyle}>
                Отписалось
                <input type="number" min={0} value={form.left_count} onChange={e => setForm(p => ({ ...p, left_count: e.target.value }))} />
              </label>
            </div>
          </div>
        )}

        {isCPA && isTg && isEdit && (
          <div style={cpaSectionStyle}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#8C7B6E', marginBottom: 4 }}>CPA (Telegram)</div>
            <div style={{ fontSize: 12, color: '#8C7B6E' }}>
              Инвайт-ссылка создаётся кнопкой «Создать ссылку» в таблице.
            </div>
          </div>
        )}

        <div className="modal-footer">
          <button type="button" onClick={onClose}>Отмена</button>
          <button type="submit" disabled={submitting}>{submitting ? 'Сохранение…' : 'Сохранить'}</button>
        </div>
      </form>
    </Modal>
  )
}

// ── Styles ───────────────────────────────────────────────────────────────────

const headerRowStyle: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }
const filtersRowStyle: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }
const filterSelectStyle: CSSProperties = { fontSize: 13, padding: '5px 8px' }
const clearBtnStyle: CSSProperties = { fontSize: 12, color: '#8C7B6E', background: 'none', border: 'none', cursor: 'pointer' }
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
  cursor: 'help',
}

const thStyle: CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
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
  padding: '9px 12px',
  borderBottom: '1px solid #E8DDD3',
  fontSize: 13,
  verticalAlign: 'middle',
}

const categoryBadgeStyle: CSSProperties = {
  display: 'inline-block',
  fontSize: 11,
  fontWeight: 600,
  padding: '2px 10px',
  borderRadius: 20,
  whiteSpace: 'nowrap',
}

const microBtnStyle: CSSProperties = {
  fontSize: 11,
  padding: '2px 8px',
  background: 'transparent',
  border: '1px solid #E8DDD3',
  borderRadius: 6,
  cursor: 'pointer',
  color: '#2C2B28',
  whiteSpace: 'nowrap',
}

const categoryGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 10,
}

const categoryCardStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#FEFEFE',
  border: '1.5px solid #E8DDD3',
  borderRadius: 10,
  padding: '14px 8px',
  cursor: 'pointer',
  textAlign: 'center',
  transition: 'border-color 0.15s, background 0.15s',
  width: '100%',
  minHeight: 78,
}

const formStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 }
const errStyle: CSSProperties = { color: '#dc2626', fontSize: 13 }

const labelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 13,
  fontWeight: 500,
  color: '#2C2B28',
}

const cpaSectionStyle: CSSProperties = {
  background: '#F5F4F0',
  border: '1px solid #E8DDD3',
  borderRadius: 8,
  padding: '12px 14px',
}

const inlineChannelStyle: CSSProperties = {
  background: '#F0E8DE',
  border: '1px solid #E8DDD3',
  borderRadius: 6,
  padding: 12,
}
