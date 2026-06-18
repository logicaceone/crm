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

type PurchaseType = 'ad' | 'target'
type AdFormat = 'post' | 'repost' | 'integration' | 'other'
type PurchaseStatus = 'planned' | 'placed' | 'cancelled'

interface ExternalChannel {
  id: number
  name: string
  tg_link: string | null
}

interface InternalChannel {
  id: number
  name: string
  platform: 'telegram' | 'max'
  tg_link: string | null
  max_chat_link: string | null
}

interface Purchase {
  id: number
  type: PurchaseType
  external_channel_id: number | null
  external_channel: ExternalChannel | null
  target_platform: string | null
  channel_id: number | null
  channel: { id: number; name: string; platform: string } | null
  date: string
  price: number
  currency: string
  format: AdFormat | null
  status: PurchaseStatus
  comment: string | null
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
  by_type: Record<string, number>
}

interface Filters {
  external_channel_id: string
  status: string
  from: string
  to: string
  type: string
}

type FormState = {
  type: PurchaseType
  external_channel_id: string
  target_platform: string
  channel_id: string
  date: string
  price: string
  currency: string
  format: AdFormat
  status: PurchaseStatus
  comment: string
  invite_link: string
  joined_count: string
  left_count: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

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

const TARGET_PLATFORMS = ['VK Ads', 'Яндекс Директ', 'Другое']

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildQS(f: Filters): string {
  const p = new URLSearchParams()
  if (f.external_channel_id) p.set('external_channel_id', f.external_channel_id)
  if (f.status) p.set('status', f.status)
  if (f.from) p.set('from', f.from)
  if (f.to) p.set('to', f.to)
  if (f.type) p.set('type', f.type)
  const s = p.toString()
  return s ? `?${s}` : ''
}

function makeEmptyForm(type: PurchaseType = 'ad'): FormState {
  return {
    type,
    external_channel_id: '',
    target_platform: '',
    channel_id: '',
    date: new Date().toISOString().slice(0, 10),
    price: '',
    currency: 'RUB',
    format: 'post',
    status: 'planned',
    comment: '',
    invite_link: '',
    joined_count: '',
    left_count: '',
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function Purchases() {
  const { user } = useAuth()
  const toast = useToast()
  const confirm = useConfirm()
  const canWrite = user?.role === 'root' || user?.role === 'admin' || user?.role === 'manager'

  const [extChannels, setExtChannels] = useState<ExternalChannel[]>([])
  const [intChannels, setIntChannels] = useState<InternalChannel[]>([])
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [filters, setFilters] = useState<Filters>({ external_channel_id: '', status: '', from: '', to: '', type: '' })
  const [rangeError, setRangeError] = useState<string | null>(null)
  const [pageError, setPageError] = useState('')
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const tableRef = useRef<HTMLDivElement>(null)

  // Create flow: 'select' → type picker, 'form' → actual form
  const [createStep, setCreateStep] = useState<'select' | 'form'>('select')
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState<FormState>(makeEmptyForm())
  const [createError, setCreateError] = useState('')
  const [creating, setCreating] = useState(false)

  const [showNewChannel, setShowNewChannel] = useState(false)
  const [newChName, setNewChName] = useState('')
  const [newChLink, setNewChLink] = useState('')
  const [addingCh, setAddingCh] = useState(false)

  const [editPurchase, setEditPurchase] = useState<Purchase | null>(null)
  const [editForm, setEditForm] = useState<FormState>(makeEmptyForm())
  const [editError, setEditError] = useState('')
  const [saving, setSaving] = useState(false)

  const [creatingLinkId, setCreatingLinkId] = useState<number | null>(null)
  const [syncingCpaId, setSyncingCpaId] = useState<number | null>(null)

  useEffect(() => {
    loadExtChannels()
    loadIntChannels()
  }, [])

  useEffect(() => {
    setPage(1)
  }, [filters])

  useEffect(() => {
    loadPurchases()
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

  async function loadPurchases() {
    const qs = buildQS(filters)
    const sep = qs ? '&' : '?'
    const res = await apiFetch(`/api/purchases${qs}${sep}page=${page}&per_page=${PER_PAGE}`)
    if (res.ok) {
      const data = await res.json()
      setPurchases(data.items)
      setTotal(data.pagination.total)
      setTotalPages(data.pagination.total_pages)
    } else {
      setPageError('Не удалось загрузить закупки')
    }
    setLoading(false)
  }

  function changePage(p: number) {
    setPage(p)
    tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function loadSummary() {
    const res = await apiFetch(`/api/purchases/summary${buildQS(filters)}`)
    if (res.ok) setSummary(await res.json())
  }

  // ── Add external channel inline ──────────────────────────────────────────

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

  // ── Open create modal ────────────────────────────────────────────────────

  function openCreate() {
    setCreateStep('select')
    setCreateForm(makeEmptyForm())
    setCreateError('')
    setShowNewChannel(false)
    setShowCreate(true)
  }

  function selectType(type: PurchaseType) {
    setCreateForm(makeEmptyForm(type))
    setCreateStep('form')
  }

  // ── Create purchase ──────────────────────────────────────────────────────

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setCreateError('')
    setCreating(true)
    try {
      const body: Record<string, unknown> = {
        type: createForm.type,
        date: createForm.date,
        price: Number(createForm.price),
        currency: createForm.currency,
        status: createForm.status,
        comment: createForm.comment || null,
        channel_id: createForm.channel_id ? Number(createForm.channel_id) : null,
      }
      if (createForm.type === 'ad') {
        body.external_channel_id = Number(createForm.external_channel_id)
        body.format = createForm.format
        body.invite_link = createForm.invite_link || null
      } else {
        body.target_platform = createForm.target_platform
      }

      const res = await apiFetch('/api/purchases', { method: 'POST', body: JSON.stringify(body) })
      if (!res.ok) {
        const d = await res.json()
        const msg = d.detail ?? 'Ошибка создания'
        setCreateError(msg)
        toast.error(msg)
        return
      }
      await res.json()
      await Promise.all([loadPurchases(), loadSummary()])
      setShowCreate(false)
      toast.success('Закупка добавлена')
    } finally {
      setCreating(false)
    }
  }

  // ── Edit purchase ────────────────────────────────────────────────────────

  function openEdit(p: Purchase) {
    setEditPurchase(p)
    setEditForm({
      type: p.type,
      external_channel_id: p.external_channel_id != null ? String(p.external_channel_id) : '',
      target_platform: p.target_platform ?? '',
      channel_id: p.channel_id != null ? String(p.channel_id) : '',
      date: p.date,
      price: String(p.price),
      currency: p.currency,
      format: p.format ?? 'post',
      status: p.status,
      comment: p.comment ?? '',
      invite_link: p.invite_link ?? '',
      joined_count: String(p.joined_count),
      left_count: String(p.left_count),
    })
    setEditError('')
  }

  async function handleEdit(e: FormEvent) {
    e.preventDefault()
    if (!editPurchase) return
    setEditError('')
    setSaving(true)
    try {
      const ch = intChannels.find(c => c.id === Number(editForm.channel_id))
      const isMax = ch?.platform === 'max'
      const body: Record<string, unknown> = {
        type: editForm.type,
        date: editForm.date,
        price: Number(editForm.price),
        currency: editForm.currency,
        status: editForm.status,
        comment: editForm.comment || null,
        channel_id: editForm.channel_id ? Number(editForm.channel_id) : null,
      }
      if (editForm.type === 'ad') {
        body.external_channel_id = editForm.external_channel_id ? Number(editForm.external_channel_id) : null
        body.format = editForm.format
        body.invite_link = editForm.invite_link || null
        if (isMax) {
          if (editForm.joined_count !== '') body.joined_count = Number(editForm.joined_count)
          if (editForm.left_count !== '') body.left_count = Number(editForm.left_count)
        }
      } else {
        body.target_platform = editForm.target_platform
        body.external_channel_id = null
        body.format = null
        body.invite_link = null
      }

      const res = await apiFetch(`/api/purchases/${editPurchase.id}`, {
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
      const updated: Purchase = await res.json()
      setPurchases(prev => prev.map(p => (p.id === updated.id ? updated : p)))
      setEditPurchase(null)
      loadSummary()
      toast.success('Закупка сохранена')
    } finally {
      setSaving(false)
    }
  }

  // ── Delete purchase ──────────────────────────────────────────────────────

  async function handleDelete(p: Purchase) {
    const label = p.type === 'ad'
      ? `Удалить рекламу от ${p.date} (${p.external_channel?.name ?? '?'})?`
      : `Удалить таргет от ${p.date} (${p.target_platform ?? '?'})?`
    if (!await confirm(label)) return
    const res = await apiFetch(`/api/purchases/${p.id}`, { method: 'DELETE' })
    if (res.ok || res.status === 204) {
      await Promise.all([loadPurchases(), loadSummary()])
      toast.success('Закупка удалена')
    } else {
      toast.error('Не удалось удалить закупку')
    }
  }

  // ── CPA actions ──────────────────────────────────────────────────────────

  async function handleCreateLink(p: Purchase) {
    setCreatingLinkId(p.id)
    try {
      const res = await apiFetch(`/api/purchases/${p.id}/invite-link`, { method: 'POST' })
      if (!res.ok) {
        const d = await res.json()
        toast.error(d.detail ?? 'Ошибка создания ссылки')
        return
      }
      const data = await res.json()
      setPurchases(prev => prev.map(x => x.id === p.id ? { ...x, invite_link: data.invite_link } : x))
      toast.success('Инвайт-ссылка создана')
    } finally {
      setCreatingLinkId(null)
    }
  }

  async function handleSyncCpa(p: Purchase) {
    setSyncingCpaId(p.id)
    try {
      const res = await apiFetch(`/api/purchases/${p.id}/sync-cpa`, { method: 'POST' })
      if (!res.ok) {
        const d = await res.json()
        toast.error(d.detail ?? 'Ошибка синхронизации CPA')
        return
      }
      const data = await res.json()
      await loadPurchases()
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
    setFilters({ external_channel_id: '', status: '', from: '', to: '', type: '' })
    setRangeError(null)
  }

  const hasFilters = !!(filters.external_channel_id || filters.status || filters.from || filters.to || filters.type)

  // ── Render ───────────────────────────────────────────────────────────────

  if (pageError) return <p style={{ color: 'red' }}>{pageError}</p>

  const colCount = canWrite ? 11 : 10

  if (loading) return (
    <div>
      <h1 style={{ margin: '0 0 20px', fontSize: 22, fontWeight: 700 }}>Закупки</h1>
      <SkeletonTable rows={8} cols={6} />
    </div>
  )

  return (
    <div>
      {/* Header */}
      <div style={headerRowStyle}>
        <h1 style={{ margin: 0 }}>Закупки</h1>
        {canWrite && (
          <button onClick={openCreate}>+ Добавить закупку</button>
        )}
      </div>

      {/* Filters */}
      <div style={filtersRowStyle} className="filters-bar">
        {/* Type filter */}
        <select
          value={filters.type}
          onChange={e => setFilters(p => ({ ...p, type: e.target.value }))}
          style={filterSelectStyle}
        >
          <option value="">Все типы</option>
          <option value="ad">Реклама</option>
          <option value="target">Таргет</option>
        </select>

        {/* External channel filter — only relevant for ad type */}
        {filters.type !== 'target' && (
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
        )}

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
              <th style={thStyle}>Тип</th>
              <th style={thStyle}>Дата</th>
              <th style={thStyle}>Площадка / Платформа</th>
              <th style={thStyle}>Канал</th>
              <th style={thStyle}>Формат</th>
              <th style={thStyle}>Сумма</th>
              <th style={thStyle}>Статус</th>
              <th style={thStyle}>Вступило</th>
              <th style={thStyle}>Отписалось</th>
              <th style={thStyle}>Ссылка</th>
              {canWrite && <th style={thStyle}>Действия</th>}
            </tr>
          </thead>
          <tbody>
            {purchases.length === 0 ? (
              <tr>
                <td colSpan={colCount} style={{ ...tdStyle, textAlign: 'center', color: '#D4B896' }}>Нет закупок</td>
              </tr>
            ) : (
              purchases.map(p => {
                const isAd = p.type === 'ad'
                const isTg = p.channel?.platform === 'telegram'
                const isMax = p.channel?.platform === 'max'
                return (
                  <tr key={p.id}>
                    {/* Тип */}
                    <td style={tdStyle}>
                      <span style={isAd ? adBadgeStyle : targetBadgeStyle}>
                        {isAd ? 'Реклама' : 'Таргет'}
                      </span>
                    </td>

                    {/* Дата */}
                    <td style={tdStyle}>{p.date}</td>

                    {/* Площадка / Платформа */}
                    <td style={tdStyle}>
                      {isAd ? (p.external_channel?.name ?? '—') : (p.target_platform ?? '—')}
                    </td>

                    {/* Наш канал */}
                    <td style={{ ...tdStyle, color: '#8C7B6E', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.channel ? (
                        <span>
                          <span style={{ fontSize: 10, fontWeight: 700, color: p.channel.platform === 'telegram' ? '#0088cc' : '#c0392b', marginRight: 4 }}>
                            {p.channel.platform === 'telegram' ? 'TG' : 'MAX'}
                          </span>
                          {p.channel.name}
                        </span>
                      ) : '—'}
                    </td>

                    {/* Формат — только для рекламы */}
                    <td style={tdStyle}>
                      {isAd && p.format ? FORMAT_LABELS[p.format] : '—'}
                    </td>

                    {/* Сумма */}
                    <td style={tdStyle}>
                      {p.price.toLocaleString('ru-RU', { minimumFractionDigits: 0 })} {p.currency}
                    </td>

                    {/* Статус */}
                    <td style={tdStyle}>
                      <span style={{ color: STATUS_COLORS[p.status], fontWeight: 500, fontSize: 13 }}>
                        {STATUS_LABELS[p.status]}
                      </span>
                    </td>

                    {/* Вступило — только для рекламы */}
                    <td style={tdStyle}>
                      {isAd && p.channel ? (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontWeight: p.joined_count > 0 ? 600 : undefined }}>{p.joined_count}</span>
                          {isTg && p.invite_link && canWrite && (
                            <button
                              onClick={() => handleSyncCpa(p)}
                              disabled={syncingCpaId === p.id}
                              style={microBtnStyle}
                              title="Обновить из Telegram"
                            >
                              {syncingCpaId === p.id ? '…' : 'Обн.'}
                            </button>
                          )}
                        </span>
                      ) : '—'}
                    </td>

                    {/* Отписалось — только для рекламы */}
                    <td style={tdStyle}>
                      {isAd && p.channel ? (
                        <span style={{ color: p.left_count > 0 ? '#dc2626' : undefined }}>{p.left_count}</span>
                      ) : '—'}
                    </td>

                    {/* Ссылка — только для TG-рекламы */}
                    <td style={tdStyle}>
                      {isAd && isTg && !p.invite_link && canWrite && (
                        <button onClick={() => handleCreateLink(p)} disabled={creatingLinkId === p.id} style={microBtnStyle}>
                          {creatingLinkId === p.id ? '…' : 'Создать ссылку'}
                        </button>
                      )}
                      {isAd && p.invite_link && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <a href={p.invite_link} target="_blank" rel="noopener noreferrer"
                            style={{ color: '#C07D4A', fontSize: 12, maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>
                            {p.invite_link.replace('https://', '')}
                          </a>
                          <button onClick={() => copyLink(p.invite_link!)} style={{ ...microBtnStyle, padding: '2px 6px' }} title="Скопировать">⎘</button>
                        </span>
                      )}
                      {(!isAd || (!isTg && !p.invite_link && !isMax)) && !p.invite_link && ''}
                      {isAd && isMax && !p.invite_link && '—'}
                      {!isAd && '—'}
                    </td>

                    {/* Действия */}
                    {canWrite && (
                      <td style={{ ...tdStyle, width: 48, textAlign: 'center' }}>
                        <KebabMenu actions={[
                          { label: 'Редактировать', onClick: () => openEdit(p) },
                          { label: 'Удалить', onClick: () => handleDelete(p), danger: true },
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
        <div style={summaryRowStyle}>
          <div>
            Итого: {summary.count} зак.
            {' · '}
            <span style={{ color: '#C07D4A' }}>
              Реклама: {(summary.by_type['ad'] ?? 0).toLocaleString('ru-RU', { minimumFractionDigits: 0 })}
            </span>
            {' / '}
            <span style={{ color: '#2563EB' }}>
              Таргет: {(summary.by_type['target'] ?? 0).toLocaleString('ru-RU', { minimumFractionDigits: 0 })}
            </span>
          </div>
          <div style={{ fontWeight: 700 }}>
            {summary.total.toLocaleString('ru-RU', { minimumFractionDigits: 0 })} {summary.currency}
          </div>
        </div>
      )}

      {/* ── Create: step 1 — type selection ── */}
      {showCreate && createStep === 'select' && (
        <TypeSelectModal
          onSelect={selectType}
          onClose={() => setShowCreate(false)}
        />
      )}

      {/* ── Create: step 2 — form ── */}
      {showCreate && createStep === 'form' && (
        <PurchaseFormModal
          title="Добавить закупку"
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

      {/* ── Edit modal ── */}
      {editPurchase && (
        <PurchaseFormModal
          title="Редактировать закупку"
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
          onClose={() => setEditPurchase(null)}
          isEdit
        />
      )}
    </div>
  )
}

// ── TypeSelectModal ───────────────────────────────────────────────────────────

function TypeSelectModal({
  onSelect,
  onClose,
}: {
  onSelect: (type: PurchaseType) => void
  onClose: () => void
}) {
  return (
    <Modal title="Добавить закупку" onClose={onClose}>
      <p style={{ fontSize: 13, color: '#8C7B6E', margin: '4px 0 20px' }}>
        Выберите тип закупки
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <button type="button" onClick={() => onSelect('ad')} style={typeCardStyle}>
          <div style={{ fontSize: 28, marginBottom: 10 }}>📢</div>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6, color: '#2C2B28' }}>Реклама</div>
          <div style={{ fontSize: 12, color: '#8C7B6E', lineHeight: 1.4 }}>
            Размещение поста<br />в Telegram / MAX канале
          </div>
        </button>
        <button type="button" onClick={() => onSelect('target')} style={typeCardStyle}>
          <div style={{ fontSize: 28, marginBottom: 10 }}>🎯</div>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6, color: '#2C2B28' }}>Таргет</div>
          <div style={{ fontSize: 12, color: '#8C7B6E', lineHeight: 1.4 }}>
            VK Ads, Яндекс Директ<br />и другие платформы
          </div>
        </button>
      </div>
    </Modal>
  )
}

// ── PurchaseFormModal ─────────────────────────────────────────────────────────

interface PurchaseFormModalProps {
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

function PurchaseFormModal({
  title, form, setForm, error, submitting,
  extChannels, intChannels,
  showNewChannel, setShowNewChannel,
  newChName, setNewChName, newChLink, setNewChLink,
  addingCh, onAddChannel, onBack, onSubmit, onClose, isEdit,
}: PurchaseFormModalProps) {
  const isAd = form.type === 'ad'
  const selectedCh = intChannels.find(c => c.id === Number(form.channel_id))
  const isMax = selectedCh?.platform === 'max'
  const isTg = selectedCh?.platform === 'telegram'

  const badge = isAd ? 'Реклама' : 'Таргет'
  const badgeStyle = isAd
    ? { color: '#C07D4A', background: '#FEF3E2' }
    : { color: '#2563EB', background: '#EFF6FF' }

  return (
    <Modal title={title} badge={badge} badgeStyle={badgeStyle} onBack={onBack} onClose={onClose}>
      <form onSubmit={onSubmit} style={formStyle}>
          {error && <div style={errStyle}>{error}</div>}

          {/* ── Ad: площадка размещения ── */}
          {isAd && (
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

          {/* ── Target: платформа ── */}
          {!isAd && (
            <label style={labelStyle}>
              Платформа *
              <select
                value={form.target_platform}
                onChange={e => setForm(p => ({ ...p, target_platform: e.target.value }))}
                required
              >
                <option value="">— выберите —</option>
                {TARGET_PLATFORMS.map(pl => (
                  <option key={pl} value={pl}>{pl}</option>
                ))}
              </select>
            </label>
          )}

          {/* Наш канал */}
          <label style={labelStyle}>
            Наш канал{isAd ? ' (для CPA)' : ''}
            <select value={form.channel_id} onChange={e => setForm(p => ({ ...p, channel_id: e.target.value }))}>
              <option value="">— не выбран —</option>
              {intChannels.map(ch => (
                <option key={ch.id} value={ch.id}>
                  [{ch.platform === 'telegram' ? 'TG' : 'MAX'}] {ch.name}
                </option>
              ))}
            </select>
          </label>

          {/* Дата + Формат (только для рекламы) */}
          {isAd ? (
            <div className="form-row-2col">
              <label style={labelStyle}>
                Дата *
                <input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} required />
              </label>
              <label style={labelStyle}>
                Формат *
                <select value={form.format} onChange={e => setForm(p => ({ ...p, format: e.target.value as AdFormat }))}>
                  <option value="post">Пост</option>
                  <option value="repost">Репост</option>
                  <option value="integration">Интеграция</option>
                  <option value="other">Другое</option>
                </select>
              </label>
            </div>
          ) : (
            <label style={labelStyle}>
              Дата *
              <input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} required />
            </label>
          )}

          {/* Сумма + Валюта */}
          <div className="form-row-2col">
            <label style={labelStyle}>
              Сумма *
              <input
                type="number" min={0} step="0.01" placeholder="0"
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
            <select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value as PurchaseStatus }))}>
              <option value="planned">Запланировано</option>
              <option value="placed">Размещено</option>
              <option value="cancelled">Отменено</option>
            </select>
          </label>

          <label style={labelStyle}>
            Комментарий
            <textarea rows={2} value={form.comment} onChange={e => setForm(p => ({ ...p, comment: e.target.value }))} style={{ resize: 'vertical' }} />
          </label>

          {/* CPA — Max (только для рекламы) */}
          {isAd && isMax && (
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

          {/* CPA — Telegram info */}
          {isAd && isTg && isEdit && (
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

// ── Styles ────────────────────────────────────────────────────────────────────

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

const adBadgeStyle: CSSProperties = {
  display: 'inline-block',
  fontSize: 11,
  fontWeight: 600,
  padding: '2px 8px',
  borderRadius: 20,
  background: '#FEF3E2',
  color: '#C07D4A',
  whiteSpace: 'nowrap',
}

const targetBadgeStyle: CSSProperties = {
  display: 'inline-block',
  fontSize: 11,
  fontWeight: 600,
  padding: '2px 8px',
  borderRadius: 20,
  background: '#EFF6FF',
  color: '#2563EB',
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

const typeCardStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  background: '#FEFEFE',
  border: '1.5px solid #E8DDD3',
  borderRadius: 10,
  padding: '20px 16px',
  cursor: 'pointer',
  textAlign: 'center',
  transition: 'border-color 0.15s, background 0.15s',
  width: '100%',
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
