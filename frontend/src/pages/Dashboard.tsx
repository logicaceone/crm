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
  purchases_count: number
}

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

interface RecentPurchase {
  id: number
  type: 'ad' | 'target'
  date: string
  channel_name: string
  price: number
  currency: string
  status: string
}

interface RecentSale {
  id: number
  date: string
  client_name: string
  channel_name: string
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

type Preset = 'month' | '30d' | '90d'

const PRESETS: { label: string; value: Preset }[] = [
  { label: 'Месяц', value: 'month' },
  { label: '30 дней', value: '30d' },
  { label: '90 дней', value: '90d' },
]

const PURCHASE_STATUS_LABELS: Record<string, string> = {
  planned: 'Планируется',
  placed: 'Размещено',
  cancelled: 'Отменено',
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
  const [recentPurchases, setRecentPurchases] = useState<RecentPurchase[]>([])
  const [recentSales, setRecentSales] = useState<RecentSale[]>([])
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
    const [topRes, purchRes, saleRes] = await Promise.all([
      apiFetch('/api/dashboard/top-channels'),
      apiFetch('/api/dashboard/recent-purchases'),
      apiFetch('/api/dashboard/recent-sales'),
    ])
    if (topRes.ok) setTopChannels(await topRes.json())
    if (purchRes.ok) setRecentPurchases(await purchRes.json())
    if (saleRes.ok) setRecentSales(await saleRes.json())
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
                  padding: '4px 12px',
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
        <KpiCard label="Расходы" value={summary ? fmt(summary.expenses) : '—'} currency="₽" accent="#dc2626" sub={`${summary?.purchases_count ?? 0} закупок`} />
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

      {/* Recent purchases — full width */}
      <div style={{ ...blockStyle, marginBottom: 16 }}>
        <h2 style={blockTitleStyle}>Последние закупки</h2>
        {recentPurchases.length === 0 ? (
          <p style={emptyTextStyle}>Нет закупок</p>
        ) : (
          <div className="table-scroll">
            <table style={fullTableStyle}>
              <thead>
                <tr>
                  {['Дата', 'Тип', 'Площадка / Платформа', 'Сумма', 'Статус'].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentPurchases.map(p => (
                  <tr key={p.id} onClick={() => navigate('/purchases')} style={clickableRowStyle}>
                    <td style={tdStyle}>{p.date}</td>
                    <td style={tdStyle}>
                      <PurchaseTypeBadge type={p.type} />
                    </td>
                    <td style={tdStyle}>{p.channel_name}</td>
                    <td style={tdStyle}>{fmt(p.price)} {p.currency}</td>
                    <td style={tdStyle}>
                      <span style={{ fontSize: 12, color: '#2C2B28' }}>
                        {PURCHASE_STATUS_LABELS[p.status] ?? p.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={blockFooterStyle}>
          <a onClick={() => navigate('/purchases')} style={blockFooterLinkStyle}>Все закупки →</a>
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
                    <td style={tdStyle}>{s.channel_name}</td>
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
      <AudienceTable platform="telegram" title="Аудитория каналов (90 дней) · Telegram" />
      <AudienceTable platform="max" title="Аудитория каналов (90 дней) · Max" />
    </div>
  )
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

const topGridStyle: CSSProperties = {
  gap: 12,
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

function PurchaseTypeBadge({ type }: { type: 'ad' | 'target' }) {
  const isAd = type === 'ad'
  return (
    <span style={{
      display: 'inline-block',
      fontSize: 11,
      fontWeight: 600,
      padding: '2px 8px',
      borderRadius: 20,
      background: isAd ? '#FEF3E2' : '#EFF6FF',
      color: isAd ? '#C07D4A' : '#2563EB',
      whiteSpace: 'nowrap',
    }}>
      {isAd ? 'Реклама' : 'Таргет'}
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

function AudienceTable({
  platform,
  title,
}: {
  platform: 'telegram' | 'max'
  title: string
}) {
  const [page, setPage] = useState(1)
  const [channels, setChannels] = useState<Channel[]>([])
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
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
        setChannels(data.channels)
        setRows(data.rows)
        setTotal(data.pagination.total)
        setTotalPages(data.pagination.total_pages)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [platform, page])

  function getVal(row: Record<string, unknown>, chName: string): number | null {
    const v = row[chName]
    return typeof v === 'number' ? v : null
  }

  // The current page comes back already sorted newest-first by the server.
  // Deltas use the NEXT row in the page; rows beyond the page boundary
  // don't have a comparable previous value within this view, so the
  // last row simply has no delta.
  function getDelta(idx: number, chName: string): number | null {
    if (idx >= rows.length - 1) return null
    const curr = getVal(rows[idx], chName)
    const prev = getVal(rows[idx + 1], chName)
    if (curr == null || prev == null) return null
    return curr - prev
  }

  function cellBg(delta: number | null): string {
    if (delta == null || delta === 0) return 'transparent'
    if (delta > 0) return 'rgba(22,163,74,0.07)'
    return 'rgba(220,38,38,0.07)'
  }

  // Empty platform — show an explanatory empty state but keep the block.
  if (!loading && channels.length === 0) {
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

  if (!loading && rows.length === 0) {
    return (
      <div style={{ ...chartCardStyle, marginBottom: 16 }}>
        <h2 style={blockTitleStyle}>{title}</h2>
        <p style={emptyTextStyle}>Нет снапшотов за последние 90 дней</p>
      </div>
    )
  }

  return (
    <div style={{ ...chartCardStyle, marginBottom: 16 }}>
      <h2 style={blockTitleStyle}>{title}</h2>
      <div style={{ overflowX: 'auto', marginTop: 4 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={audThStyle}>Дата</th>
              {channels.map(ch => (
                <th key={ch.id} style={{ ...audThStyle, color: '#2C2B28', fontWeight: 600 }}>
                  <PlatformChip platform={ch.platform} />
                  {ch.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={String(row.date)}>
                <td style={audDateStyle}>{String(row.date)}</td>
                {channels.map(ch => {
                  const val = getVal(row, ch.name)
                  const delta = getDelta(i, ch.name)
                  return (
                    <td
                      key={ch.id}
                      style={{
                        padding: '7px 14px',
                        borderBottom: '1px solid #F0E8DE',
                        textAlign: 'right',
                        background: cellBg(delta),
                        transition: 'background 0.1s',
                        minWidth: 110,
                      }}
                    >
                      {val != null ? (
                        <>
                          <div style={{ fontWeight: 600, color: '#2C2B28' }}>
                            {fmt(val)}
                          </div>
                          {delta != null && delta !== 0 && (
                            <div style={{
                              fontSize: 11,
                              color: delta > 0 ? '#16a34a' : '#dc2626',
                              fontWeight: 500,
                              marginTop: 1,
                            }}>
                              {delta > 0 ? '+' : ''}{fmt(delta)}
                            </div>
                          )}
                        </>
                      ) : (
                        <span style={{ color: '#D4B896' }}>—</span>
                      )}
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

const audThStyle: CSSProperties = {
  padding: '8px 14px',
  textAlign: 'right',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color: '#8C7B6E',
  background: '#F0E8DE',
  borderBottom: '1.5px solid #E8DDD3',
  whiteSpace: 'nowrap',
}

const audDateStyle: CSSProperties = {
  padding: '7px 14px',
  borderBottom: '1px solid #F0E8DE',
  color: '#8C7B6E',
  fontSize: 12,
  fontWeight: 500,
  whiteSpace: 'nowrap',
  textAlign: 'left',
  background: '#FAFAF8',
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
