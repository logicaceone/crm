import { useState, useEffect, CSSProperties } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { apiFetch } from '../lib/api'
import { DateRangePicker } from '../components/DateRangePicker'

interface ChannelOption {
  id: number
  name: string
  platform: 'telegram' | 'max'
}

interface StatPoint {
  date: string
  subscribers_count: number
}

interface StatsResponse {
  channel: { id: number; name: string; platform: string }
  stats: StatPoint[]
}

type Preset = '7d' | '30d' | '90d' | 'all'

function toIso(d: Date) {
  return d.toISOString().slice(0, 10)
}

function presetRange(preset: Preset): { from: string; to: string } {
  const today = new Date()
  const to = toIso(today)
  if (preset === 'all') return { from: '', to }
  const days = preset === '7d' ? 7 : preset === '30d' ? 30 : 90
  const from = new Date(today)
  from.setDate(from.getDate() - days)
  return { from: toIso(from), to }
}

function PlatformChip({ platform }: { platform?: 'telegram' | 'max' }) {
  if (!platform) return null
  const isTg = platform === 'telegram'
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 12,
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: '0.03em',
      background: isTg ? '#0088cc18' : '#ff000018',
      color: isTg ? '#0088cc' : '#c0392b',
      border: `1px solid ${isTg ? '#0088cc44' : '#c0392b44'}`,
    }}>
      {isTg ? 'TG' : 'MAX'}
    </span>
  )
}

function formatDate(iso: string) {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  return n.toLocaleString('ru-RU')
}

interface TooltipPayload {
  payload?: { date: string; subscribers_count: number; growth: number | null }
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  if (!d) return null
  return (
    <div style={tooltipStyle}>
      <div style={{ fontWeight: 600, marginBottom: 4, color: '#2C2B28' }}>{d.date}</div>
      <div style={{ color: '#2C2B28' }}>Подписчики: <b>{fmt(d.subscribers_count)}</b></div>
      {d.growth != null && (
        <div style={{ color: d.growth >= 0 ? '#16a34a' : '#dc2626', marginTop: 2 }}>
          Прирост: {d.growth >= 0 ? '+' : ''}{fmt(d.growth)}
        </div>
      )}
    </div>
  )
}

export function Subscribers() {
  const [channels, setChannels] = useState<ChannelOption[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const initial = presetRange('30d')
  const [dateFrom, setDateFrom] = useState<string>(initial.from)
  const [dateTo, setDateTo] = useState<string>(initial.to)
  const [activePreset, setActivePreset] = useState<Preset | null>('30d')
  const [rangeError, setRangeError] = useState<string | null>(null)
  const [stats, setStats] = useState<StatPoint[]>([])
  const [loading, setLoading] = useState(false)
  const [channelsLoading, setChannelsLoading] = useState(true)

  const selectedChannel = channels.find(c => c.id === selectedId)

  function applyPreset(p: Preset) {
    const { from, to } = presetRange(p)
    setDateFrom(from)
    setDateTo(to)
    setActivePreset(p)
    setRangeError(null)
  }

  function handleRangeChange(from: string, to: string) {
    setActivePreset(null)
    setDateFrom(from)
    setDateTo(to)
  }

  // load channel list once
  useEffect(() => {
    apiFetch('/api/channels/all').then(async res => {
      if (res.ok) {
        const data: ChannelOption[] = await res.json()
        setChannels(data)
        if (data.length > 0) setSelectedId(data[0].id)
      }
      setChannelsLoading(false)
    })
  }, [])

  // reload stats when channel or date range changes
  useEffect(() => {
    if (selectedId == null) return
    if (rangeError) return
    const params = new URLSearchParams({ channel_id: String(selectedId) })
    if (dateFrom) params.set('from', dateFrom)
    if (dateTo) params.set('to', dateTo)
    setLoading(true)
    apiFetch(`/api/stats/subscribers?${params}`).then(async res => {
      if (res.ok) {
        const data: StatsResponse = await res.json()
        setStats(data.stats)
      }
      setLoading(false)
    })
  }, [selectedId, dateFrom, dateTo, rangeError])

  // enrich with growth for tooltip
  const chartData = stats.map((pt, i) => ({
    ...pt,
    growth: i === 0 ? null : pt.subscribers_count - stats[i - 1].subscribers_count,
    label: formatDate(pt.date),
  }))

  // summary cards
  const last = stats.length > 0 ? stats[stats.length - 1].subscribers_count : null
  const first = stats.length > 0 ? stats[0].subscribers_count : null
  const growth = last != null && first != null ? last - first : null
  const maxVal = stats.length > 0 ? Math.max(...stats.map(s => s.subscribers_count)) : null

  if (channelsLoading) return <p>Загрузка…</p>
  if (channels.length === 0) return <p style={{ color: '#8C7B6E' }}>Нет каналов. Добавьте канал на странице «Каналы».</p>

  return (
    <div>
      <h1 style={{ margin: '0 0 20px' }}>Подписчики</h1>

      {/* controls */}
      <div style={controlsStyle} className="filters-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <PlatformChip platform={selectedChannel?.platform} />
          <select
            value={selectedId ?? ''}
            onChange={e => setSelectedId(Number(e.target.value))}
            style={{ minWidth: 200 }}
          >
            {channels.map(ch => (
              <option key={ch.id} value={ch.id}>
                {ch.platform === 'telegram' ? '[TG]' : '[MAX]'} {ch.name}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 12, color: '#8C7B6E', fontWeight: 500 }}>Период</span>
          <div style={presetsStyle}>
            {(['7d', '30d', '90d', 'all'] as Preset[]).map(p => (
              <button
                key={p}
                onClick={() => applyPreset(p)}
                style={{
                  ...presetBtnStyle,
                  background: activePreset === p ? '#2C2B28' : 'transparent',
                  color: activePreset === p ? '#F0E8DE' : '#2C2B28',
                  borderColor: activePreset === p ? '#2C2B28' : '#E8DDD3',
                }}
              >
                {p === 'all' ? 'Всё время' : p === '7d' ? '7 дней' : p === '30d' ? '30 дней' : '90 дней'}
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

      {/* cards */}
      <div style={cardsRowStyle} className="cards-grid-4">
        <Card label="Подписчики сейчас" value={fmt(last)} />
        <Card
          label="Прирост за период"
          value={growth == null ? '—' : (growth >= 0 ? '+' : '') + fmt(growth)}
          valueColor={growth == null ? undefined : growth >= 0 ? '#16a34a' : '#dc2626'}
        />
        <Card label="Макс. за период" value={fmt(maxVal)} />
        <Card label="Снапшотов собрано" value={String(stats.length)} />
      </div>

      {/* chart */}
      {loading ? (
        <div style={emptyStyle}>Загрузка…</div>
      ) : stats.length === 0 ? (
        <div style={emptyStyle}>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#2C2B28', marginBottom: 6 }}>
            Нет снапшотов за выбранный период
          </div>
          <div style={{ fontSize: 13, color: '#8C7B6E' }}>
            Добавьте снапшот вручную или настройте синхронизацию
          </div>
        </div>
      ) : (
        <div style={chartWrapStyle}>
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={chartData} margin={{ top: 8, right: 24, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8DDD3" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 12, fill: '#8C7B6E' }}
                tickLine={false}
                axisLine={{ stroke: '#E8DDD3' }}
              />
              <YAxis
                tick={{ fontSize: 12, fill: '#8C7B6E' }}
                tickLine={false}
                axisLine={false}
                tickFormatter={v => Number(v).toLocaleString('ru-RU')}
                width={72}
              />
              <Tooltip content={<CustomTooltip />} />
              <Line
                type="monotone"
                dataKey="subscribers_count"
                stroke="#C07D4A"
                strokeWidth={2}
                dot={{ r: 4, fill: '#C07D4A', strokeWidth: 0 }}
                activeDot={{ r: 6 }}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

function Card({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 12, color: '#8C7B6E', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: valueColor ?? '#2C2B28' }}>{value}</div>
    </div>
  )
}

const controlsStyle: CSSProperties = {
  display: 'flex',
  gap: 12,
  alignItems: 'flex-end',
  marginBottom: 20,
  flexWrap: 'wrap',
}

const presetsStyle: CSSProperties = {
  display: 'flex',
  gap: 4,
}

const presetBtnStyle: CSSProperties = {
  height: 36,
  padding: '0 14px',
  boxSizing: 'border-box',
  fontSize: 13,
  borderRadius: 8,
  border: '1px solid #E8DDD3',
  cursor: 'pointer',
  fontWeight: 500,
  transition: 'all 0.15s',
  boxShadow: 'none',
}

const cardsRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, 1fr)',
  gap: 12,
  marginBottom: 20,
}

const cardStyle: CSSProperties = {
  background: '#FEFEFE',
  border: '1px solid #E8DDD3',
  borderRadius: 10,
  padding: '14px 18px',
}

const chartWrapStyle: CSSProperties = {
  background: '#FEFEFE',
  border: '1px solid #E8DDD3',
  borderRadius: 10,
  padding: '20px 8px 12px 4px',
}

const emptyStyle: CSSProperties = {
  background: '#FEFEFE',
  border: '1px solid #E8DDD3',
  borderRadius: 10,
  padding: 40,
  textAlign: 'center',
}

const tooltipStyle: CSSProperties = {
  background: '#FEFEFE',
  border: '1px solid #E8DDD3',
  borderRadius: 8,
  padding: '10px 14px',
  fontSize: 13,
  boxShadow: '0 4px 16px rgba(44,43,40,0.1)',
}
