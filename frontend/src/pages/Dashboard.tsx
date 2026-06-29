import { useState, useEffect, CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { DateRangePicker } from '../components/DateRangePicker'
import { SkeletonKpiGrid, SkeletonTable } from '../components/PageSkeleton'
import { Pagination } from '../components/Pagination'

const AUDIENCE_PAGE_SIZE = 15

interface Summary {
  income: number
  expenses: number
  margin: number
  margin_pct: number
  sales_count: number
  expenses_count: number
}

type ExpenseCategory =
  | 'tg_ads' | 'vk_ads' | 'yandex' | 'blogger'
  | 'subscribers' | 'lunch' | 'giveaway' | 'services' | 'salary' | 'other'

interface TopChannel {
  id: number
  name: string
  platform: 'telegram' | 'max'
  tg_link: string | null
  subscribers_current: number
  subscribers_30d_ago: number
  growth: number
  growth_pct: number
}

interface RecentExpense {
  id: number
  category: ExpenseCategory
  date: string
  external_channel_name: string | null
  channel_name: string | null
  price: number
  currency: string
  status: string
  responsible: string | null
}

interface RecentSale {
  id: number
  date: string
  client_name: string
  channel_name: string | null
  price: number
  currency: string
  status: string
}

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
  platform?: 'telegram' | 'max'
}

interface SubscribersGroup {
  current: number
  first: number
  growth: number
  channels_count: number
}

interface SubscribersGroups {
  tg_light: SubscribersGroup
  tg_dark: SubscribersGroup
  tg_light_and_dark: SubscribersGroup
  max_light: SubscribersGroup
  all_light: SubscribersGroup
}

type Preset = 'month' | '30d' | '90d'

const PRESETS: { label: string; value: Preset }[] = [
  { label: 'Месяц', value: 'month' },
  { label: '30 дней', value: '30d' },
  { label: '90 дней', value: '90d' },
]

const EXPENSE_STATUS_LABELS: Record<string, string> = {
  planned: 'Планируется',
  placed: 'Размещено',
  cancelled: 'Отменено',
}

const CATEGORY_BADGE_LABEL: Record<ExpenseCategory, string> = {
  tg_ads: 'TG Ads', vk_ads: 'VK Ads', yandex: 'Яндекс',
  blogger: 'Блогеры', subscribers: 'Подписчики',
  lunch: 'Обеды', giveaway: 'Подарки',
  services: 'Сервисы', salary: 'Зарплата', other: 'Прочие',
}

const CATEGORY_BADGE_COLOR: Record<ExpenseCategory, { bg: string; fg: string }> = {
  tg_ads:      { bg: '#DBEAFE', fg: '#1D4ED8' },
  vk_ads:      { bg: '#DBEAFE', fg: '#1D4ED8' },
  yandex:      { bg: '#FEF3C7', fg: '#B45309' },
  blogger:     { bg: '#EDE9FE', fg: '#6D28D9' },
  subscribers: { bg: '#DCFCE7', fg: '#15803D' },
  lunch:       { bg: '#FFEDD5', fg: '#C2410C' },
  giveaway:    { bg: '#FCE7F3', fg: '#BE185D' },
  services:    { bg: '#E5E7EB', fg: '#374151' },
  salary:      { bg: '#E0F2FE', fg: '#0369A1' },
  other:       { bg: '#E5E7EB', fg: '#374151' },
}

const SALE_STATUS_LABELS: Record<string, string> = {
  agreed: 'Договорились',
  placed: 'Размещено',
  paid: 'Оплачено',
  cancelled: 'Отменено',
}

const SALE_STATUS_COLORS: Record<string, string> = {
  agreed: '#D4B896',
  placed: '#C07D4A',
  paid: '#16a34a',
  cancelled: '#dc2626',
}

function toIso(d: Date) {
  return d.toISOString().slice(0, 10)
}

function presetDates(p: Preset): { from: string; to: string } {
  const now = new Date()
  const to = toIso(now)
  if (p === 'month') {
    return { from: toIso(new Date(now.getFullYear(), now.getMonth(), 1)), to }
  }
  const days = p === '30d' ? 30 : 90
  const from = new Date(now)
  from.setDate(from.getDate() - days)
  return { from: toIso(from), to }
}

function fmt(n: number) {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 0 })
}

export function Dashboard() {
  const navigate = useNavigate()
  const [activePreset, setActivePreset] = useState<Preset | null>('month')
  const [dateFrom, setDateFrom] = useState(() => presetDates('month').from)
  const [dateTo, setDateTo] = useState(() => presetDates('month').to)
  const [rangeError, setRangeError] = useState<string | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [topChannels, setTopChannels] = useState<TopChannel[]>([])
  const [recentExpenses, setRecentExpenses] = useState<RecentExpense[]>([])
  const [recentSales, setRecentSales] = useState<RecentSale[]>([])
  const [subsGroups, setSubsGroups] = useState<SubscribersGroups | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadStatic()
  }, [])

  useEffect(() => {
    loadSummary(dateFrom, dateTo)
  }, [dateFrom, dateTo])

  function applyPreset(p: Preset) {
    const { from, to } = presetDates(p)
    setActivePreset(p)
    setDateFrom(from)
    setDateTo(to)
    setRangeError(null)
  }

  function handleRangeChange(from: string, to: string) {
    setActivePreset(null)
    setDateFrom(from)
    setDateTo(to)
  }

  async function loadStatic() {
    setLoading(true)
    const [topRes, expRes, saleRes, subsRes] = await Promise.all([
      apiFetch('/api/dashboard/top-channels'),
      apiFetch('/api/dashboard/recent-expenses'),
      apiFetch('/api/dashboard/recent-sales'),
      apiFetch('/api/dashboard/subscribers-summary'),
    ])
    if (topRes.ok) setTopChannels(await topRes.json())
    if (expRes.ok) setRecentExpenses(await expRes.json())
    if (saleRes.ok) setRecentSales(await saleRes.json())
    if (subsRes.ok) setSubsGroups(await subsRes.json())
    setLoading(false)
  }

  async function loadSummary(from: string, to: string) {
    const res = await apiFetch(`/api/dashboard/summary?from=${from}&to=${to}`)
    if (res.ok) setSummary(await res.json())
  }

  if (loading) {
    return (
      <div>
        <h1 style={{ margin: '0 0 20px', fontSize: 22, fontWeight: 700 }}>Дашборд</h1>
        <SkeletonKpiGrid />
        <div className="mid-grid" style={{ marginBottom: 16 }}>
          <SkeletonTable rows={4} cols={3} />
          <SkeletonTable rows={4} cols={3} />
          <SkeletonTable rows={4} cols={3} />
        </div>
        <SkeletonTable rows={5} cols={5} />
      </div>
    )
  }

  return (
    <div>
      <h1 style={{ margin: '0 0 20px', fontSize: 22, fontWeight: 700 }}>Дашборд</h1>

      {/* KPI section */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginBottom: 12, flexWrap: 'wrap' }} className="filters-bar">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 12, color: '#8C7B6E', fontWeight: 500 }}>Период</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {PRESETS.map(p => (
              <button
                key={p.value}
                onClick={() => applyPreset(p.value)}
                style={{
                  height: 36,
                  padding: '0 14px',
                  boxSizing: 'border-box',
                  borderRadius: 6,
                  border: '1px solid #E8DDD3',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: 500,
                  background: activePreset === p.value ? '#2C2B28' : '#F0E8DE',
                  color: activePreset === p.value ? '#FEFEFE' : '#2C2B28',
                  boxShadow: 'none',
                  transform: 'none',
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <DateRangePicker
          dateFrom={dateFrom}
          dateTo={dateTo}
          onChange={handleRangeChange}
          onError={setRangeError}
          error={rangeError}
        />
      </div>

      <div className="kpi-grid" style={cardsRowStyle}>
        <KpiCard label="Доходы" value={summary ? fmt(summary.income) : '—'} currency="₽" accent="#16a34a" sub={`${summary?.sales_count ?? 0} продаж`} />
        <KpiCard label="Расходы" value={summary ? fmt(summary.expenses) : '—'} currency="₽" accent="#dc2626" sub={`${summary?.expenses_count ?? 0} расходов`} />
        <KpiCard
          label="Маржа"
          value={summary ? fmt(summary.margin) : '—'}
          currency="₽"
          accent={!summary ? '#8C7B6E' : summary.margin >= 0 ? '#16a34a' : '#dc2626'}
        />
        <KpiCard
          label="Маржа %"
          value={summary ? `${summary.margin_pct > 0 ? '+' : ''}${summary.margin_pct.toFixed(1)}` : '—'}
          currency="%"
          accent={!summary ? '#8C7B6E' : summary.margin_pct >= 0 ? '#16a34a' : '#dc2626'}
        />
      </div>

      {/* Subscriber groups — independent of the date filter (always
          "all time" growth from the earliest to the latest snapshot). */}
      <div style={{ marginTop: 24, marginBottom: 8, fontSize: 14, fontWeight: 600, color: '#2C2B28' }}>
        Аудитория по группам
      </div>
      <div className="subs-groups-grid">
        <SubsCard title="TG Светлый" data={subsGroups?.tg_light} />
        <SubsCard title="TG Тёмный" data={subsGroups?.tg_dark} />
        <SubsCard title="TG Светлый + Тёмный" data={subsGroups?.tg_light_and_dark} />
        <SubsCard title="MAX Светлый" data={subsGroups?.max_light} />
        <SubsCard title="TG и MAX Светлый" data={subsGroups?.all_light} />
      </div>

      {/* Top channels — full width, 3-card grid */}
      <div style={{ ...blockStyle, marginBottom: 16 }}>
        <h2 style={blockTitleStyle}>Топ каналов по росту (30д)</h2>
        {topChannels.length === 0 ? (
          <p style={emptyTextStyle}>Нет данных о снапшотах</p>
        ) : (
          <div className="cards-grid-3" style={topGridStyle}>
            {topChannels.map(ch => (
              <div
                key={ch.id}
                onClick={() => navigate(`/channels/${ch.id}`)}
                style={topCardStyle}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontWeight: 600, color: '#2C2B28' }}>
                  <PlatformChip platform={ch.platform} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.name}</span>
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#2C2B28' }}>{fmt(ch.subscribers_current)}</div>
                <div style={{ fontSize: 12, color: '#8C7B6E', marginBottom: 6 }}>подписчиков</div>
                <div style={{
                  display: 'flex',
                  gap: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  color: ch.growth >= 0 ? '#16a34a' : '#dc2626',
                }}>
                  <span>{ch.growth >= 0 ? '↑' : '↓'} {ch.growth >= 0 ? '+' : ''}{fmt(ch.growth)}</span>
                  <span>({ch.growth_pct > 0 ? '+' : ''}{ch.growth_pct.toFixed(1)}%)</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent expenses — full width */}
      <div style={{ ...blockStyle, marginBottom: 16 }}>
        <h2 style={blockTitleStyle}>Последние расходы</h2>
        {recentExpenses.length === 0 ? (
          <p style={emptyTextStyle}>Нет расходов</p>
        ) : (
          <div className="table-scroll">
            <table style={fullTableStyle}>
              <thead>
                <tr>
                  {['Дата', 'Категория', 'Площадка / Канал', 'Сумма', 'Статус'].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentExpenses.map(e => (
                  <tr key={e.id} onClick={() => navigate('/expenses')} style={clickableRowStyle}>
                    <td style={tdStyle}>{e.date}</td>
                    <td style={tdStyle}>
                      <CategoryBadge category={e.category} />
                    </td>
                    <td style={tdStyle}>
                      {e.external_channel_name || e.channel_name || '—'}
                    </td>
                    <td style={tdStyle}>{fmt(e.price)} {e.currency}</td>
                    <td style={tdStyle}>
                      <span style={{ fontSize: 12, color: '#2C2B28' }}>
                        {EXPENSE_STATUS_LABELS[e.status] ?? e.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={blockFooterStyle}>
          <a onClick={() => navigate('/expenses')} style={blockFooterLinkStyle}>Все расходы →</a>
        </div>
      </div>

      {/* Recent sales — full width */}
      <div style={{ ...blockStyle, marginBottom: 16 }}>
        <h2 style={blockTitleStyle}>Последние продажи</h2>
        {recentSales.length === 0 ? (
          <p style={emptyTextStyle}>Нет продаж</p>
        ) : (
          <div className="table-scroll">
            <table style={fullTableStyle}>
              <thead>
                <tr>
                  {['Дата', 'Клиент', 'Наш канал', 'Сумма', 'Статус'].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentSales.map(s => (
                  <tr key={s.id} onClick={() => navigate('/sales')} style={clickableRowStyle}>
                    <td style={tdStyle}>{s.date}</td>
                    <td style={tdStyle}>{s.client_name}</td>
                    <td style={tdStyle}>{s.channel_name ?? '—'}</td>
                    <td style={tdStyle}>{fmt(s.price)} {s.currency}</td>
                    <td style={tdStyle}>
                      <span style={{
                        fontSize: 12,
                        color: SALE_STATUS_COLORS[s.status] ?? '#2C2B28',
                        fontWeight: 500,
                      }}>
                        {SALE_STATUS_LABELS[s.status] ?? s.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={blockFooterStyle}>
          <a onClick={() => navigate('/sales')} style={blockFooterLinkStyle}>Все продажи →</a>
        </div>
      </div>

      {/* Audience tables — TG + MAX as independent blocks */}
      <AudienceTable platform="telegram" title="Аудитория каналов (30 дней) · Telegram" />
      <AudienceTable platform="max" title="Аудитория каналов (30 дней) · Max" />
    </div>
  )
}

function SubsCard({ title, data }: { title: string; data?: SubscribersGroup }) {
  // No data yet — render a muted placeholder with the same footprint so
  // the grid doesn't jump after the fetch resolves.
  if (!data) {
    return (
      <div style={subsCardStyle}>
        <div style={subsTitleStyle}>{title}</div>
        <div style={{ ...subsValueStyle, color: '#D4B896' }}>—</div>
        <div style={{ height: 16 }} />
        <div style={subsCountStyle}>&nbsp;</div>
      </div>
    )
  }
  const positive = data.growth > 0
  const negative = data.growth < 0
  const arrow = positive ? '↑' : negative ? '↓' : ''
  const growthColor = positive ? '#16a34a' : negative ? '#dc2626' : '#8C7B6E'
  return (
    <div style={subsCardStyle}>
      <div style={subsTitleStyle}>{title}</div>
      <div style={subsValueStyle}>{fmt(data.current)}</div>
      <div style={{ ...subsGrowthStyle, color: growthColor }}>
        {arrow && <span style={{ marginRight: 4 }}>{arrow}</span>}
        {data.growth === 0
          ? 'без изменений'
          : `${positive ? '+' : ''}${fmt(data.growth)} за всё время`}
      </div>
      <div style={subsCountStyle}>{data.channels_count} {channelsWord(data.channels_count)}</div>
    </div>
  )
}

function channelsWord(n: number): string {
  // Russian plural: 1 канал, 2-4 канала, 5+ каналов.
  const mod100 = n % 100
  const mod10 = n % 10
  if (mod100 >= 11 && mod100 <= 14) return 'каналов'
  if (mod10 === 1) return 'канал'
  if (mod10 >= 2 && mod10 <= 4) return 'канала'
  return 'каналов'
}

function KpiCard({ label, value, currency, accent, sub }: {
  label: string
  value: string
  currency?: string
  accent: string
  sub?: string
}) {
  return (
    <div style={{ ...kpiCardStyle, borderTop: `4px solid ${accent}` }}>
      <div style={{ fontSize: 13, color: '#8C7B6E', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: accent }}>
        {value}
        {currency && <span style={{ fontSize: 14, fontWeight: 400, marginLeft: 4, color: '#D4B896' }}>{currency}</span>}
      </div>
      {sub && <div style={{ fontSize: 12, color: '#D4B896', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

const cardsRowStyle: CSSProperties = {
  gap: 16,
  marginBottom: 24,
}

const kpiCardStyle: CSSProperties = {
  background: '#FEFEFE',
  border: '1px solid #E8DDD3',
  borderRadius: 8,
  padding: '16px 20px',
}

const subsCardStyle: CSSProperties = {
  background: '#FEFEFE',
  border: '1px solid #E8DDD3',
  borderRadius: 8,
  padding: '14px 18px',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  minWidth: 0,
}

const subsTitleStyle: CSSProperties = {
  fontSize: 12,
  color: '#8C7B6E',
  fontWeight: 500,
  letterSpacing: '0.02em',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

const subsValueStyle: CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  color: '#2C2B28',
  lineHeight: 1.2,
}

const subsGrowthStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
}

const subsCountStyle: CSSProperties = {
  fontSize: 11,
  color: '#D4B896',
  marginTop: 2,
}

const topGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 16,
  marginTop: 8,
}

const topCardStyle: CSSProperties = {
  padding: '14px 16px',
  background: '#FAFAF8',
  border: '1px solid #E8DDD3',
  borderRadius: 8,
  cursor: 'pointer',
  minWidth: 0,
}

const fullTableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  marginTop: 4,
}

const blockFooterStyle: CSSProperties = {
  textAlign: 'right',
  paddingTop: 12,
  borderTop: '1px solid #F0E8DE',
  marginTop: 12,
}

const blockFooterLinkStyle: CSSProperties = {
  color: '#C07D4A',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  textDecoration: 'none',
}

const midRowStyle: CSSProperties = {
  gap: 16,
  marginBottom: 16,
}

const blockStyle: CSSProperties = {
  background: '#FEFEFE',
  border: '1px solid #E8DDD3',
  borderRadius: 8,
  padding: '16px 20px',
  overflow: 'auto',
}

const chartCardStyle: CSSProperties = {
  background: '#FEFEFE',
  border: '1px solid #E8DDD3',
  borderRadius: 8,
  padding: '16px 20px',
}

// ── Audience retention-style table ────────────────────────────────────────────

function CategoryBadge({ category }: { category: ExpenseCategory }) {
  const col = CATEGORY_BADGE_COLOR[category]
  return (
    <span style={{
      display: 'inline-block',
      fontSize: 11,
      fontWeight: 600,
      padding: '2px 8px',
      borderRadius: 20,
      background: col.bg,
      color: col.fg,
      whiteSpace: 'nowrap',
    }}>
      {CATEGORY_BADGE_LABEL[category]}
    </span>
  )
}

function PlatformChip({ platform }: { platform?: 'telegram' | 'max' }) {
  if (!platform) return null
  const isTg = platform === 'telegram'
  return (
    <span style={{
      display: 'inline-block',
      padding: '1px 6px',
      borderRadius: 10,
      fontSize: 9,
      fontWeight: 700,
      letterSpacing: '0.04em',
      verticalAlign: 'middle',
      marginRight: 5,
      background: isTg ? '#0088cc18' : '#ff000018',
      color: isTg ? '#0088cc' : '#c0392b',
      border: `1px solid ${isTg ? '#0088cc44' : '#c0392b44'}`,
    }}>
      {isTg ? 'TG' : 'MAX'}
    </span>
  )
}

interface AudienceRow {
  channel_id: number
  channel_name: string
  platform: 'telegram' | 'max'
  values: Record<string, number | null>
}

// "2026-06-18" → "18.06" (current year) or "18.06.25" (prior years).
function formatColHeader(iso: string): string {
  const [y, m, d] = iso.split('-')
  const thisYear = new Date().getFullYear()
  if (Number(y) === thisYear) return `${d}.${m}`
  return `${d}.${m}.${y.slice(-2)}`
}

function AudienceTable({
  platform,
  title,
}: {
  platform: 'telegram' | 'max'
  title: string
}) {
  const [page, setPage] = useState(1)
  const [columns, setColumns] = useState<string[]>([])
  const [rows, setRows] = useState<AudienceRow[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiFetch(`/api/dashboard/audience-table?platform=${platform}&page=${page}&per_page=${AUDIENCE_PAGE_SIZE}`)
      .then(async res => {
        if (!res.ok) return
        const data = await res.json()
        if (cancelled) return
        setColumns(data.columns ?? [])
        setRows(data.rows ?? [])
        setTotal(data.pagination.total)
        setTotalPages(data.pagination.total_pages)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [platform, page])

  // Empty platform — show explanatory state but keep the block.
  if (!loading && total === 0) {
    const isTg = platform === 'telegram'
    return (
      <div style={{ ...chartCardStyle, marginBottom: 16 }}>
        <h2 style={blockTitleStyle}>{title}</h2>
        <p style={emptyTextStyle}>
          {isTg ? 'Нет каналов Telegram. Добавьте канал с платформой Telegram.'
                : 'Нет каналов Max.ru. Добавьте канал с платформой Max.'}
        </p>
      </div>
    )
  }

  if (!loading && columns.length === 0) {
    return (
      <div style={{ ...chartCardStyle, marginBottom: 16 }}>
        <h2 style={blockTitleStyle}>{title}</h2>
        <p style={emptyTextStyle}>Нет снапшотов за последние 30 дней</p>
      </div>
    )
  }

  return (
    <div style={{ ...chartCardStyle, marginBottom: 16 }}>
      <h2 style={blockTitleStyle}>{title}</h2>
      <div style={{ overflowX: 'auto', marginTop: 4 }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: 13, width: '100%' }}>
          <thead>
            <tr>
              <th style={audChannelHeadStyle}>Канал</th>
              {columns.map(d => (
                <th key={d} style={audDateHeadStyle}>{formatColHeader(d)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.channel_id}>
                <td style={audChannelCellStyle}>
                  <PlatformChip platform={row.platform} />
                  <span style={{ fontWeight: 600, color: '#2C2B28' }}>{row.channel_name}</span>
                </td>
                {columns.map(d => {
                  const val = row.values[d]
                  return (
                    <td key={d} style={audValueCellStyle}>
                      {val != null
                        ? <span style={{ fontWeight: 500, color: '#2C2B28' }}>{fmt(val)}</span>
                        : <span style={{ color: '#D4B896' }}>—</span>}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination
        page={page}
        total_pages={totalPages}
        total={total}
        per_page={AUDIENCE_PAGE_SIZE}
        onChange={setPage}
      />
    </div>
  )
}

// Common header style shared by Канал and date columns. `sticky top: 0`
// would only matter if we also pinned vertically; the table doesn't
// scroll vertically inside the card, so plain headers are enough.
const audHeadBase: CSSProperties = {
  padding: '8px 14px',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color: '#8C7B6E',
  background: '#F0E8DE',
  borderBottom: '1.5px solid #E8DDD3',
  whiteSpace: 'nowrap',
}

const audChannelHeadStyle: CSSProperties = {
  ...audHeadBase,
  textAlign: 'left',
  // Sticky so the channel name stays visible while date columns scroll.
  // `left: 0` + a solid background prevents value cells from showing
  // through during the scroll.
  position: 'sticky',
  left: 0,
  zIndex: 2,
  minWidth: 200,
  boxShadow: '1px 0 0 #E8DDD3',
}

const audDateHeadStyle: CSSProperties = {
  ...audHeadBase,
  textAlign: 'right',
  minWidth: 80,
}

const audChannelCellStyle: CSSProperties = {
  padding: '7px 14px',
  borderBottom: '1px solid #F0E8DE',
  whiteSpace: 'nowrap',
  textAlign: 'left',
  background: '#FFFFFF',
  position: 'sticky',
  left: 0,
  zIndex: 1,
  minWidth: 200,
  boxShadow: '1px 0 0 #E8DDD3',
  display: 'table-cell',
}

const audValueCellStyle: CSSProperties = {
  padding: '7px 14px',
  borderBottom: '1px solid #F0E8DE',
  textAlign: 'right',
  whiteSpace: 'nowrap',
  minWidth: 80,
}

const blockTitleStyle: CSSProperties = {
  margin: '0 0 12px',
  fontSize: 14,
  fontWeight: 600,
  color: '#2C2B28',
}

const emptyTextStyle: CSSProperties = {
  fontSize: 13,
  color: '#D4B896',
  margin: 0,
}

const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
}

const thStyle: CSSProperties = {
  textAlign: 'left',
  padding: '6px 8px',
  fontSize: 12,
  fontWeight: 600,
  color: '#8C7B6E',
  borderBottom: '1px solid #E8DDD3',
}

const tdStyle: CSSProperties = {
  padding: '7px 8px',
  fontSize: 13,
  borderBottom: '1px solid #F0E8DE',
}

const clickableRowStyle: CSSProperties = {
  cursor: 'pointer',
}
