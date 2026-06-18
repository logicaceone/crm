import { useState, useEffect, CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { DateRangePicker } from '../components/DateRangePicker'
import { SkeletonKpiGrid, SkeletonTable } from '../components/PageSkeleton'

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
  const [audienceData, setAudienceData] = useState<Record<string, unknown>[]>([])
  const [channelNames, setChannelNames] = useState<Channel[]>([])
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
    const [topRes, purchRes, saleRes, chanRes] = await Promise.all([
      apiFetch('/api/dashboard/top-channels'),
      apiFetch('/api/dashboard/recent-purchases'),
      apiFetch('/api/dashboard/recent-sales'),
      apiFetch('/api/channels/all'),
    ])
    if (topRes.ok) setTopChannels(await topRes.json())
    if (purchRes.ok) setRecentPurchases(await purchRes.json())
    if (saleRes.ok) setRecentSales(await saleRes.json())

    if (chanRes.ok) {
      const channels: Channel[] = await chanRes.json()
      setChannelNames(channels)
      loadAudience(channels)
    }
    setLoading(false)
  }

  async function loadAudience(channels: Channel[]) {
    const ago90 = new Date()
    ago90.setDate(ago90.getDate() - 90)
    const from = toIso(ago90)

    const results = await Promise.all(
      channels.map(c =>
        apiFetch(`/api/channels/${c.id}/stats?from=${from}`)
          .then(r => r.ok ? r.json() as Promise<ChannelStat[]> : [])
      )
    )

    // merge into rows keyed by date
    const byDate: Record<string, Record<string, unknown>> = {}
    results.forEach((stats, idx) => {
      const ch = channels[idx]
      stats.forEach(s => {
        if (!byDate[s.date]) byDate[s.date] = { date: s.date }
        byDate[s.date][ch.name] = s.subscribers_count
      })
    })
    const rows = Object.values(byDate).sort((a, b) =>
      String(a.date).localeCompare(String(b.date))
    )
    setAudienceData(rows)
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

      {/* Middle row: top channels + recent activity */}
      <div className="mid-grid" style={midRowStyle}>
        {/* Top channels */}
        <div style={blockStyle}>
          <h2 style={blockTitleStyle}>Топ каналов по росту (30д)</h2>
          {topChannels.length === 0 ? (
            <p style={emptyTextStyle}>Нет данных о снапшотах</p>
          ) : (
            <table style={tableStyle}>
              <thead>
                <tr>
                  {['Канал', 'Подписчики', 'Прирост', '%'].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {topChannels.map(ch => (
                  <tr
                    key={ch.id}
                    onClick={() => navigate(`/channels/${ch.id}`)}
                    style={clickableRowStyle}
                  >
                    <td style={tdStyle}>{ch.name}</td>
                    <td style={tdStyle}>{fmt(ch.subscribers_current)}</td>
                    <td style={{ ...tdStyle, color: ch.growth >= 0 ? '#16a34a' : '#dc2626', fontWeight: 500 }}>
                      {ch.growth >= 0 ? '+' : ''}{fmt(ch.growth)}
                    </td>
                    <td style={{ ...tdStyle, color: ch.growth >= 0 ? '#16a34a' : '#dc2626' }}>
                      {ch.growth_pct > 0 ? '+' : ''}{ch.growth_pct.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Recent purchases */}
        <div style={blockStyle}>
          <h2 style={blockTitleStyle}>Последние закупки</h2>
          {recentPurchases.length === 0 ? (
            <p style={emptyTextStyle}>Нет закупок</p>
          ) : (
            <table style={tableStyle}>
              <thead>
                <tr>
                  {['Дата', 'Площадка', 'Сумма', 'Статус'].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentPurchases.map(p => (
                  <tr key={p.id} onClick={() => navigate('/purchases')} style={clickableRowStyle}>
                    <td style={tdStyle}>{p.date}</td>
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
          )}
        </div>

        {/* Recent sales */}
        <div style={blockStyle}>
          <h2 style={blockTitleStyle}>Последние продажи</h2>
          {recentSales.length === 0 ? (
            <p style={emptyTextStyle}>Нет продаж</p>
          ) : (
            <table style={tableStyle}>
              <thead>
                <tr>
                  {['Дата', 'Клиент', 'Канал', 'Сумма', 'Статус'].map(h => (
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
          )}
        </div>
      </div>

      {/* Audience table */}
      <AudienceTable rows={audienceData} channels={channelNames} />
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

function AudienceTable({
  rows,
  channels,
}: {
  rows: Record<string, unknown>[]
  channels: Channel[]
}) {
  if (rows.length === 0 || channels.length === 0) {
    return (
      <div style={chartCardStyle}>
        <h2 style={blockTitleStyle}>Аудитория каналов (90 дней)</h2>
        <p style={emptyTextStyle}>Нет снапшотов за последние 90 дней</p>
      </div>
    )
  }

  // newest dates first
  const sorted = [...rows].sort((a, b) =>
    String(b.date).localeCompare(String(a.date))
  )

  function getVal(row: Record<string, unknown>, chName: string): number | null {
    const v = row[chName]
    return typeof v === 'number' ? v : null
  }

  function getDelta(rowIdx: number, chName: string): number | null {
    if (rowIdx >= sorted.length - 1) return null
    const curr = getVal(sorted[rowIdx], chName)
    // previous in time = next index (since sorted desc)
    const prev = getVal(sorted[rowIdx + 1], chName)
    if (curr == null || prev == null) return null
    return curr - prev
  }

  function cellBg(delta: number | null): string {
    if (delta == null || delta === 0) return 'transparent'
    if (delta > 0) return 'rgba(22,163,74,0.07)'
    return 'rgba(220,38,38,0.07)'
  }

  return (
    <div style={chartCardStyle}>
      <h2 style={blockTitleStyle}>Аудитория каналов (90 дней)</h2>
      <div style={{ overflowX: 'auto', marginTop: 4 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={audThStyle}>Дата</th>
              {channels.map(ch => (
                <th key={ch.id} style={{ ...audThStyle, color: '#2C2B28', fontWeight: 600 }}>
                  {ch.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, rowIdx) => (
              <tr key={String(row.date)}>
                <td style={audDateStyle}>{String(row.date)}</td>
                {channels.map(ch => {
                  const val = getVal(row, ch.name)
                  const delta = getDelta(rowIdx, ch.name)
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
