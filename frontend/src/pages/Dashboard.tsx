import { useState, useEffect, CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { apiFetch } from '../lib/api'

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

const CHANNEL_COLORS = [
  '#2563eb', '#16a34a', '#dc2626', '#d97706',
  '#7c3aed', '#0891b2', '#db2777', '#65a30d',
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
  agreed: '#9ca3af',
  placed: '#2563eb',
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
  const [preset, setPreset] = useState<Preset>('month')
  const [summary, setSummary] = useState<Summary | null>(null)
  const [topChannels, setTopChannels] = useState<TopChannel[]>([])
  const [recentPurchases, setRecentPurchases] = useState<RecentPurchase[]>([])
  const [recentSales, setRecentSales] = useState<RecentSale[]>([])
  const [audienceData, setAudienceData] = useState<Record<string, unknown>[]>([])
  const [channelNames, setChannelNames] = useState<Channel[]>([])

  useEffect(() => {
    loadStatic()
  }, [])

  useEffect(() => {
    loadSummary(preset)
  }, [preset])

  async function loadStatic() {
    const [topRes, purchRes, saleRes, chanRes] = await Promise.all([
      apiFetch('/api/dashboard/top-channels'),
      apiFetch('/api/dashboard/recent-purchases'),
      apiFetch('/api/dashboard/recent-sales'),
      apiFetch('/api/channels'),
    ])
    if (topRes.ok) setTopChannels(await topRes.json())
    if (purchRes.ok) setRecentPurchases(await purchRes.json())
    if (saleRes.ok) setRecentSales(await saleRes.json())

    if (chanRes.ok) {
      const channels: Channel[] = await chanRes.json()
      setChannelNames(channels)
      loadAudience(channels)
    }
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

  async function loadSummary(p: Preset) {
    const { from, to } = presetDates(p)
    const res = await apiFetch(`/api/dashboard/summary?from=${from}&to=${to}`)
    if (res.ok) setSummary(await res.json())
  }

  return (
    <div>
      <h1 style={{ margin: '0 0 20px', fontSize: 22, fontWeight: 700 }}>Дашборд</h1>

      {/* KPI section */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        {PRESETS.map(p => (
          <button
            key={p.value}
            onClick={() => setPreset(p.value)}
            style={{
              padding: '5px 12px',
              borderRadius: 6,
              border: '1px solid #e5e7eb',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 500,
              background: preset === p.value ? '#111827' : '#f3f4f6',
              color: preset === p.value ? '#fff' : '#374151',
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div style={cardsRowStyle}>
        <KpiCard label="Доходы" value={summary ? fmt(summary.income) : '—'} currency="₽" accent="#16a34a" sub={`${summary?.sales_count ?? 0} продаж`} />
        <KpiCard label="Расходы" value={summary ? fmt(summary.expenses) : '—'} currency="₽" accent="#dc2626" sub={`${summary?.purchases_count ?? 0} закупок`} />
        <KpiCard
          label="Маржа"
          value={summary ? fmt(summary.margin) : '—'}
          currency="₽"
          accent={!summary ? '#6b7280' : summary.margin >= 0 ? '#16a34a' : '#dc2626'}
        />
        <KpiCard
          label="Маржа %"
          value={summary ? `${summary.margin_pct > 0 ? '+' : ''}${summary.margin_pct.toFixed(1)}` : '—'}
          currency="%"
          accent={!summary ? '#6b7280' : summary.margin_pct >= 0 ? '#16a34a' : '#dc2626'}
        />
      </div>

      {/* Middle row: top channels + recent activity */}
      <div style={midRowStyle}>
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
                      <span style={{ fontSize: 12, color: '#374151' }}>
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
                        color: SALE_STATUS_COLORS[s.status] ?? '#374151',
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

      {/* Audience chart */}
      <div style={chartCardStyle}>
        <h2 style={blockTitleStyle}>Аудитория каналов (90 дней)</h2>
        {audienceData.length === 0 ? (
          <p style={emptyTextStyle}>Нет снапшотов за последние 90 дней</p>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={audienceData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} width={72} tickFormatter={v => fmt(v)} />
              <Tooltip formatter={(v) => (typeof v === 'number' ? fmt(v) : v)} />
              <Legend />
              {channelNames.map((ch, i) => (
                <Line
                  key={ch.id}
                  type="monotone"
                  dataKey={ch.name}
                  stroke={CHANNEL_COLORS[i % CHANNEL_COLORS.length]}
                  dot={false}
                  strokeWidth={2}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
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
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: accent }}>
        {value}
        {currency && <span style={{ fontSize: 14, fontWeight: 400, marginLeft: 4, color: '#9ca3af' }}>{currency}</span>}
      </div>
      {sub && <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

const cardsRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, 1fr)',
  gap: 16,
  marginBottom: 24,
}

const kpiCardStyle: CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: '16px 20px',
}

const midRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr 1fr',
  gap: 16,
  marginBottom: 16,
}

const blockStyle: CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: '16px 20px',
  overflow: 'hidden',
}

const chartCardStyle: CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: '16px 20px',
}

const blockTitleStyle: CSSProperties = {
  margin: '0 0 12px',
  fontSize: 14,
  fontWeight: 600,
  color: '#374151',
}

const emptyTextStyle: CSSProperties = {
  fontSize: 13,
  color: '#9ca3af',
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
  color: '#6b7280',
  borderBottom: '1px solid #e5e7eb',
}

const tdStyle: CSSProperties = {
  padding: '7px 8px',
  fontSize: 13,
  borderBottom: '1px solid #f3f4f6',
}

const clickableRowStyle: CSSProperties = {
  cursor: 'pointer',
}
