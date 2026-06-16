import { useState, useEffect, FormEvent, CSSProperties } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { useAuth } from '../contexts/AuthContext'
import { apiFetch } from '../lib/api'

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
  tg_link: string | null
  description: string | null
  created_at: string
}

type Period = '7d' | '30d' | '90d' | 'all'

const PERIODS: { label: string; value: Period }[] = [
  { label: '7д', value: '7d' },
  { label: '30д', value: '30d' },
  { label: '90д', value: '90d' },
  { label: 'Всё время', value: 'all' },
]

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function periodParams(period: Period): string {
  if (period === 'all') return ''
  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90
  return `?from=${toIso(addDays(new Date(), -days))}`
}

export function ChannelDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const canWrite = user?.role === 'admin' || user?.role === 'manager'

  const [channel, setChannel] = useState<Channel | null>(null)
  const [stats, setStats] = useState<ChannelStat[]>([])
  const [period, setPeriod] = useState<Period>('all')
  const [pageError, setPageError] = useState('')

  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ date: toIso(new Date()), subscribers_count: '', avg_views_per_post: '' })
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    loadChannel()
  }, [id])

  useEffect(() => {
    if (id) loadStats(period)
  }, [id, period])

  async function loadChannel() {
    const res = await apiFetch(`/api/channels/${id}`)
    if (!res.ok) { setPageError('Канал не найден'); return }
    const data = await res.json()
    setChannel(data)
  }

  async function loadStats(p: Period) {
    const qs = periodParams(p)
    const res = await apiFetch(`/api/channels/${id}/stats${qs}`)
    if (res.ok) setStats(await res.json())
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    setFormError('')
    setSubmitting(true)
    try {
      const res = await apiFetch(`/api/channels/${id}/stats`, {
        method: 'POST',
        body: JSON.stringify({
          date: form.date,
          subscribers_count: Number(form.subscribers_count),
          avg_views_per_post: Number(form.avg_views_per_post),
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        setFormError(d.detail ?? 'Ошибка')
        return
      }
      const newStat: ChannelStat = await res.json()
      setStats(prev => {
        const merged = [...prev, newStat].sort((a, b) => a.date.localeCompare(b.date))
        return merged
      })
      setShowAdd(false)
      setForm({ date: toIso(new Date()), subscribers_count: '', avg_views_per_post: '' })
    } finally {
      setSubmitting(false)
    }
  }

  if (pageError) return <p style={{ color: 'red' }}>{pageError}</p>
  if (!channel) return <p>Загрузка…</p>

  const chartData = stats.map(s => ({
    date: s.date,
    subscribers: s.subscribers_count,
    views: s.avg_views_per_post,
  }))

  return (
    <div>
      {/* Back */}
      <button onClick={() => navigate('/channels')} style={backBtnStyle}>
        ← Назад
      </button>

      {/* Channel info */}
      <section style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ margin: '0 0 4px' }}>{channel.name}</h1>
            {channel.tg_link && (
              <a href={channel.tg_link} target="_blank" rel="noopener noreferrer" style={{ fontSize: 14 }}>
                {channel.tg_link}
              </a>
            )}
            {channel.description && (
              <p style={{ margin: '8px 0 0', color: '#555', fontSize: 14 }}>{channel.description}</p>
            )}
            <p style={{ margin: '6px 0 0', color: '#888', fontSize: 12 }}>
              Добавлен: {new Date(channel.created_at).toLocaleDateString('ru-RU')}
            </p>
          </div>
          {canWrite && (
            <button onClick={() => { setShowAdd(true); setFormError('') }}>
              + Добавить снапшот
            </button>
          )}
        </div>
      </section>

      {/* Period filter */}
      <div style={periodRowStyle}>
        {PERIODS.map(p => (
          <button
            key={p.value}
            onClick={() => setPeriod(p.value)}
            style={{
              ...periodBtnStyle,
              background: period === p.value ? '#2C2B28' : '#F0E8DE',
              color: period === p.value ? '#F0E8DE' : '#2C2B28',
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {stats.length === 0 ? (
        <div style={emptyStyle}>
          Добавьте первый снапшот, чтобы увидеть динамику
        </div>
      ) : (
        <>
          {/* Charts */}
          <div style={chartsRowStyle}>
            <ChartCard title="Подписчики">
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} width={60} />
                  <Tooltip formatter={(v) => (typeof v === 'number' ? v.toLocaleString() : v)} />
                  <Line type="monotone" dataKey="subscribers" stroke="#2563eb" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Ср. просмотры на пост">
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} width={60} />
                  <Tooltip formatter={(v) => (typeof v === 'number' ? v.toLocaleString() : v)} />
                  <Line type="monotone" dataKey="views" stroke="#16a34a" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* Stats table */}
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Дата</th>
                <th style={thStyle}>Подписчики</th>
                <th style={thStyle}>Ср. просмотры</th>
                <th style={thStyle}>Прирост подписчиков</th>
              </tr>
            </thead>
            <tbody>
              {[...stats].reverse().map((s, i, arr) => {
                const prev = arr[i + 1]
                const diff = prev ? s.subscribers_count - prev.subscribers_count : null
                return (
                  <tr key={s.id}>
                    <td style={tdStyle}>{s.date}</td>
                    <td style={tdStyle}>{s.subscribers_count.toLocaleString()}</td>
                    <td style={tdStyle}>{s.avg_views_per_post.toLocaleString()}</td>
                    <td style={{ ...tdStyle, color: diffColor(diff) }}>
                      {diff === null ? '—' : diff >= 0 ? `+${diff.toLocaleString()}` : diff.toLocaleString()}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </>
      )}

      {/* Add snapshot modal */}
      {showAdd && (
        <div style={overlayStyle}>
          <div style={modalStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>Добавить снапшот</h2>
              <button onClick={() => setShowAdd(false)} style={closeBtnStyle}>×</button>
            </div>
            <form onSubmit={handleAdd} style={formStyle}>
              {formError && <div style={{ color: '#dc2626', fontSize: 14 }}>{formError}</div>}
              <label style={labelStyle}>
                Дата
                <input
                  type="date"
                  value={form.date}
                  onChange={e => setForm(p => ({ ...p, date: e.target.value }))}
                  required
                  autoFocus
                />
              </label>
              <label style={labelStyle}>
                Подписчики
                <input
                  type="number"
                  min={0}
                  placeholder="0"
                  value={form.subscribers_count}
                  onChange={e => setForm(p => ({ ...p, subscribers_count: e.target.value }))}
                  required
                />
              </label>
              <label style={labelStyle}>
                Ср. просмотры на пост
                <input
                  type="number"
                  min={0}
                  placeholder="0"
                  value={form.avg_views_per_post}
                  onChange={e => setForm(p => ({ ...p, avg_views_per_post: e.target.value }))}
                  required
                />
              </label>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                <button type="button" onClick={() => setShowAdd(false)}>Отмена</button>
                <button type="submit" disabled={submitting}>
                  {submitting ? 'Сохранение…' : 'Сохранить'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={chartCardStyle}>
      <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600, color: '#2C2B28' }}>{title}</h3>
      {children}
    </div>
  )
}

function diffColor(diff: number | null): string {
  if (diff === null) return 'inherit'
  if (diff > 0) return '#16a34a'
  if (diff < 0) return '#dc2626'
  return 'inherit'
}

const backBtnStyle: CSSProperties = {
  marginBottom: 16,
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  fontSize: 13,
  color: '#C07D4A',
  padding: 0,
}

const cardStyle: CSSProperties = {
  background: '#FEFEFE',
  border: '1px solid #E8DDD3',
  borderRadius: 8,
  padding: 20,
  marginBottom: 20,
}

const periodRowStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  marginBottom: 20,
}

const periodBtnStyle: CSSProperties = {
  padding: '6px 14px',
  borderRadius: 6,
  border: '1px solid #E8DDD3',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 500,
}

const emptyStyle: CSSProperties = {
  textAlign: 'center',
  padding: '48px 0',
  color: '#D4B896',
  fontSize: 15,
}

const chartsRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 16,
  marginBottom: 24,
}

const chartCardStyle: CSSProperties = {
  background: '#FEFEFE',
  border: '1px solid #E8DDD3',
  borderRadius: 8,
  padding: 16,
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
  borderBottom: '1px solid #E8DDD3',
  fontWeight: 600,
  fontSize: 13,
  background: '#F0E8DE',
  color: '#8C7B6E',
}

const tdStyle: CSSProperties = {
  padding: '8px 14px',
  borderBottom: '1px solid #E8DDD3',
  fontSize: 13,
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(44,43,40,0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 100,
}

const modalStyle: CSSProperties = {
  background: '#FEFEFE',
  borderRadius: 10,
  padding: 24,
  width: 380,
  boxShadow: '0 8px 40px rgba(44,43,40,0.15)',
}

const closeBtnStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  fontSize: 22,
  cursor: 'pointer',
  lineHeight: 1,
  padding: 0,
}

const formStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
}

const labelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 13,
  fontWeight: 500,
  color: '#2C2B28',
}
