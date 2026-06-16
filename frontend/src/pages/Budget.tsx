import { useState, useEffect, CSSProperties } from 'react'
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts'
import { apiFetch } from '../lib/api'

interface Summary {
  expenses: number
  income: number
  margin: number
  margin_pct: number
  currency: string
}

interface MonthRow {
  month: string
  expenses: number
  income: number
  margin: number
}

interface Channel {
  id: number
  name: string
}

interface Filters {
  from: string
  to: string
  channel_id: string
}

function toIso(d: Date) {
  return d.toISOString().slice(0, 10)
}

function firstOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function firstOfQuarter(d: Date) {
  const q = Math.floor(d.getMonth() / 3)
  return new Date(d.getFullYear(), q * 3, 1)
}

function firstOfYear(d: Date) {
  return new Date(d.getFullYear(), 0, 1)
}

const PRESETS = [
  { label: 'Месяц', getFrom: (d: Date) => firstOfMonth(d) },
  { label: 'Квартал', getFrom: (d: Date) => firstOfQuarter(d) },
  { label: 'Год', getFrom: (d: Date) => firstOfYear(d) },
]

function buildQS(f: Filters) {
  const p = new URLSearchParams()
  if (f.from) p.set('from', f.from)
  if (f.to) p.set('to', f.to)
  if (f.channel_id) p.set('channel_id', f.channel_id)
  return p.toString() ? '?' + p.toString() : ''
}

function fmt(n: number) {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 0 })
}

export function Budget() {
  const today = toIso(new Date())

  const [filters, setFilters] = useState<Filters>({
    from: toIso(firstOfYear(new Date())),
    to: today,
    channel_id: '',
  })
  const [activePreset, setActivePreset] = useState<number>(2) // Год

  const [channels, setChannels] = useState<Channel[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [monthly, setMonthly] = useState<MonthRow[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    apiFetch('/api/channels').then(r => r.ok ? r.json() : []).then(setChannels)
  }, [])

  useEffect(() => {
    load()
  }, [filters])

  async function load() {
    setLoading(true)
    const qs = buildQS(filters)
    const [sumRes, monRes] = await Promise.all([
      apiFetch(`/api/budget/summary${qs}`),
      apiFetch(`/api/budget/monthly${qs}`),
    ])
    if (sumRes.ok) setSummary(await sumRes.json())
    if (monRes.ok) setMonthly(await monRes.json())
    setLoading(false)
  }

  function applyPreset(idx: number) {
    const now = new Date()
    setFilters(f => ({ ...f, from: toIso(PRESETS[idx].getFrom(now)), to: today }))
    setActivePreset(idx)
  }

  function setFilter(key: keyof Filters, val: string) {
    setActivePreset(-1)
    setFilters(f => ({ ...f, [key]: val }))
  }

  const noData = monthly.length === 0 && !loading

  const totals = monthly.reduce(
    (acc, r) => ({ expenses: acc.expenses + r.expenses, income: acc.income + r.income, margin: acc.margin + r.margin }),
    { expenses: 0, income: 0, margin: 0 }
  )

  return (
    <div>
      <h1 style={{ margin: '0 0 20px', fontSize: 22, fontWeight: 700 }}>Бюджет и маржа</h1>

      {/* Filters */}
      <div style={filtersRowStyle}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {PRESETS.map((p, i) => (
            <button
              key={i}
              onClick={() => applyPreset(i)}
              style={{
                ...presetBtnStyle,
                background: activePreset === i ? '#2C2B28' : '#F0E8DE',
                color: activePreset === i ? '#FEFEFE' : '#2C2B28',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <label style={filterLabelStyle}>
          С
          <input type="date" value={filters.from} onChange={e => setFilter('from', e.target.value)} style={inputStyle} />
        </label>
        <label style={filterLabelStyle}>
          По
          <input type="date" value={filters.to} onChange={e => setFilter('to', e.target.value)} style={inputStyle} />
        </label>
        <label style={filterLabelStyle}>
          Канал
          <select value={filters.channel_id} onChange={e => setFilter('channel_id', e.target.value)} style={inputStyle}>
            <option value="">Все каналы</option>
            {channels.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
      </div>

      {/* KPI cards */}
      <div style={cardsRowStyle}>
        <KpiCard
          label="Расходы"
          value={summary ? fmt(summary.expenses) : '—'}
          currency={summary?.currency}
          accent="#dc2626"
        />
        <KpiCard
          label="Доходы"
          value={summary ? fmt(summary.income) : '—'}
          currency={summary?.currency}
          accent="#16a34a"
        />
        <KpiCard
          label="Маржа"
          value={summary ? fmt(summary.margin) : '—'}
          currency={summary?.currency}
          sub={summary ? `${summary.margin_pct > 0 ? '+' : ''}${summary.margin_pct.toFixed(1)}%` : undefined}
          accent={!summary ? '#8C7B6E' : summary.margin >= 0 ? '#16a34a' : '#dc2626'}
        />
      </div>

      {noData ? (
        <div style={emptyStyle}>
          Нет данных за выбранный период. Добавьте закупки или продажи.
        </div>
      ) : (
        <>
          {/* Bar chart: income vs expenses */}
          <div style={chartCardStyle}>
            <h3 style={chartTitleStyle}>Доходы и расходы по месяцам</h3>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={monthly} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={72} tickFormatter={v => fmt(v)} />
                <Tooltip formatter={(v) => (typeof v === 'number' ? fmt(v) : v)} />
                <Legend />
                <Bar dataKey="income" name="Доходы" fill="#16a34a" radius={[3, 3, 0, 0]} />
                <Bar dataKey="expenses" name="Расходы" fill="#dc2626" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Line chart: margin */}
          <div style={chartCardStyle}>
            <h3 style={chartTitleStyle}>Маржа по месяцам</h3>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={monthly} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={72} tickFormatter={v => fmt(v)} />
                <Tooltip formatter={(v) => (typeof v === 'number' ? fmt(v) : v)} />
                <ReferenceLine y={0} stroke="#8C7B6E" strokeDasharray="4 4" />
                <Line
                  type="monotone"
                  dataKey="margin"
                  name="Маржа"
                  stroke="#2563eb"
                  dot={{ r: 4, fill: '#2563eb' }}
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Table */}
          <table style={tableStyle}>
            <thead>
              <tr>
                {['Месяц', 'Доходы', 'Расходы', 'Маржа', 'Маржа %'].map(h => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {monthly.map(r => (
                <tr key={r.month}>
                  <td style={tdStyle}>{r.month}</td>
                  <td style={{ ...tdStyle, color: '#16a34a' }}>{fmt(r.income)}</td>
                  <td style={{ ...tdStyle, color: '#dc2626' }}>{fmt(r.expenses)}</td>
                  <td style={{ ...tdStyle, color: r.margin >= 0 ? '#16a34a' : '#dc2626', fontWeight: 500 }}>
                    {r.margin >= 0 ? '+' : ''}{fmt(r.margin)}
                  </td>
                  <td style={{ ...tdStyle, color: r.margin >= 0 ? '#16a34a' : '#dc2626' }}>
                    {r.income ? `${((r.margin / r.income) * 100).toFixed(1)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: '#F0E8DE', fontWeight: 600 }}>
                <td style={tdStyle}>Итого</td>
                <td style={{ ...tdStyle, color: '#16a34a' }}>{fmt(totals.income)}</td>
                <td style={{ ...tdStyle, color: '#dc2626' }}>{fmt(totals.expenses)}</td>
                <td style={{ ...tdStyle, color: totals.margin >= 0 ? '#16a34a' : '#dc2626' }}>
                  {totals.margin >= 0 ? '+' : ''}{fmt(totals.margin)}
                </td>
                <td style={{ ...tdStyle, color: totals.margin >= 0 ? '#16a34a' : '#dc2626' }}>
                  {totals.income ? `${((totals.margin / totals.income) * 100).toFixed(1)}%` : '—'}
                </td>
              </tr>
            </tfoot>
          </table>
        </>
      )}
    </div>
  )
}

function KpiCard({ label, value, currency, sub, accent }: {
  label: string
  value: string
  currency?: string
  sub?: string
  accent: string
}) {
  return (
    <div style={{ ...kpiCardStyle, borderTop: `4px solid ${accent}` }}>
      <div style={{ fontSize: 13, color: '#8C7B6E', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: accent }}>
        {value}
        {currency && <span style={{ fontSize: 14, fontWeight: 400, marginLeft: 4, color: '#D4B896' }}>{currency}</span>}
      </div>
      {sub && <div style={{ fontSize: 14, color: accent, marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

const filtersRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 12,
  alignItems: 'flex-end',
  marginBottom: 24,
  background: '#FEFEFE',
  border: '1px solid #E8DDD3',
  borderRadius: 8,
  padding: '12px 16px',
}

const presetBtnStyle: CSSProperties = {
  padding: '5px 12px',
  borderRadius: 6,
  border: '1px solid #E8DDD3',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 500,
}

const filterLabelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  fontSize: 12,
  color: '#8C7B6E',
  fontWeight: 500,
}

const inputStyle: CSSProperties = {
  fontSize: 13,
  padding: '4px 8px',
  border: '1px solid #E8DDD3',
  borderRadius: 6,
}

const cardsRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 16,
  marginBottom: 24,
}

const kpiCardStyle: CSSProperties = {
  background: '#FEFEFE',
  border: '1px solid #E8DDD3',
  borderRadius: 8,
  padding: '16px 20px',
}

const chartCardStyle: CSSProperties = {
  background: '#FEFEFE',
  border: '1px solid #E8DDD3',
  borderRadius: 8,
  padding: '16px 20px',
  marginBottom: 16,
}

const chartTitleStyle: CSSProperties = {
  margin: '0 0 12px',
  fontSize: 14,
  fontWeight: 600,
  color: '#2C2B28',
}

const emptyStyle: CSSProperties = {
  textAlign: 'center',
  padding: '64px 0',
  color: '#D4B896',
  fontSize: 15,
}

const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  background: '#FEFEFE',
  border: '1px solid #E8DDD3',
  borderRadius: 8,
  overflow: 'hidden',
}

const thStyle: CSSProperties = {
  textAlign: 'left',
  padding: '10px 14px',
  borderBottom: '2px solid #E8DDD3',
  fontWeight: 600,
  fontSize: 13,
  background: '#F0E8DE',
}

const tdStyle: CSSProperties = {
  padding: '8px 14px',
  borderBottom: '1px solid #F0E8DE',
  fontSize: 13,
}
