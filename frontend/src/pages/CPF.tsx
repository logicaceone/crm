import { useState, useEffect, useMemo, CSSProperties } from 'react'
import { apiFetch } from '../lib/api'
import { DateRangePicker } from '../components/DateRangePicker'
import { Pagination } from '../components/Pagination'
import { SkeletonTable } from '../components/PageSkeleton'

type Platform = 'telegram' | 'max'
type Preset = '7d' | '30d' | '90d'

interface SummaryRow {
  channel_id: number
  channel_name: string
  platform: Platform
  spent: number
  joined: number
  cpf: number | null
}

interface ByChannelRow {
  source_type: 'ad' | 'target'
  source_name: string
  spent: number
  joined: number
  cpf: number | null
}

interface ByChannelResponse {
  channel_id: number
  channel_name: string
  platform: Platform
  total: { spent: number; joined: number; cpf: number | null }
  rows: ByChannelRow[]
}

interface ChannelOption {
  id: number
  name: string
  platform: Platform
}

function toIso(d: Date) {
  return d.toISOString().slice(0, 10)
}

function presetRange(p: Preset): { from: string; to: string } {
  const today = new Date()
  const days = p === '7d' ? 7 : p === '30d' ? 30 : 90
  const from = new Date(today)
  from.setDate(from.getDate() - days)
  return { from: toIso(from), to: toIso(today) }
}

function fmtMoney(n: number) {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 0 })
}

function fmtCpf(n: number | null) {
  if (n == null) return '—'
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 0 })
}

function PlatformChip({ platform }: { platform: Platform }) {
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

function SourceTypeChip({ type }: { type: 'ad' | 'target' }) {
  const isAd = type === 'ad'
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 12,
      fontSize: 11,
      fontWeight: 600,
      background: isAd ? '#dbeafe' : '#fef3c7',
      color: isAd ? '#1d4ed8' : '#92400e',
    }}>
      {isAd ? 'Реклама' : 'Таргет'}
    </span>
  )
}

// median for non-null CPFs in a list, used to color the bars/cells in
// both blocks. Returning 0 when nothing is available keeps the colour
// rules trivial (everything green) — looks cleaner than blanking the bar.
function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

function cpfColor(cpf: number, med: number): string {
  if (med <= 0) return '#16a34a'
  if (cpf <= med) return '#16a34a'
  if (cpf <= med * 1.5) return '#ca8a04'
  return '#dc2626'
}

export function CPF() {
  return (
    <div>
      <h1 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700 }}>Аналитика CPF</h1>
      <div style={{ color: '#8C7B6E', fontSize: 13, marginBottom: 20 }}>
        Cost Per Follower — стоимость привлечения одного подписчика
      </div>

      <SummaryBlock />
      <div style={{ height: 24 }} />
      <ByChannelBlock />
    </div>
  )
}

// ── Block 1: summary across all channels ─────────────────────────────

function SummaryBlock() {
  const [preset, setPreset] = useState<Preset | null>('30d')
  const initial = presetRange('30d')
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [rangeError, setRangeError] = useState<string | null>(null)
  const [rows, setRows] = useState<SummaryRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!from || !to || rangeError) return
    setLoading(true)
    const qs = new URLSearchParams({ from, to }).toString()
    apiFetch(`/api/cpf/summary?${qs}`)
      .then(r => (r.ok ? r.json() : []))
      .then((data: SummaryRow[]) => setRows(data))
      .finally(() => setLoading(false))
  }, [from, to, rangeError])

  function applyPreset(p: Preset) {
    const r = presetRange(p)
    setFrom(r.from)
    setTo(r.to)
    setPreset(p)
    setRangeError(null)
  }

  function handleRange(f: string, t: string) {
    setPreset(null)
    setRangeError(null)
    setFrom(f)
    setTo(t)
  }

  const cpfs = useMemo(
    () => rows.filter(r => r.cpf != null).map(r => r.cpf as number),
    [rows]
  )
  const med = useMemo(() => median(cpfs), [cpfs])
  const maxCpf = useMemo(() => (cpfs.length ? Math.max(...cpfs) : 1), [cpfs])

  const totalSpent = rows.reduce((acc, r) => acc + r.spent, 0)
  const totalJoined = rows.reduce((acc, r) => acc + r.joined, 0)
  const avgCpf = totalJoined > 0 ? totalSpent / totalJoined : null

  return (
    <section style={cardStyle}>
      <div style={blockHeaderStyle}>
        <div>
          <h2 style={blockTitleStyle}>Общая статистика</h2>
          <div style={{ color: '#8C7B6E', fontSize: 12 }}>
            CPF по всем каналам за период
          </div>
        </div>
      </div>

      <div style={filtersRowStyle} className="filters-bar">
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {(['7d', '30d', '90d'] as Preset[]).map(p => (
            <button
              key={p}
              onClick={() => applyPreset(p)}
              style={{
                ...presetBtnStyle,
                background: preset === p ? '#2C2B28' : '#F0E8DE',
                color: preset === p ? '#FEFEFE' : '#2C2B28',
              }}
            >
              {p === '7d' ? '7д' : p === '30d' ? '30д' : '90д'}
            </button>
          ))}
        </div>
        <DateRangePicker
          dateFrom={from}
          dateTo={to}
          onChange={handleRange}
          onError={setRangeError}
          error={rangeError}
        />
      </div>

      {loading ? (
        <SkeletonTable rows={5} cols={3} />
      ) : rows.length === 0 ? (
        <div style={emptyStyle}>Нет каналов.</div>
      ) : (
        <>
          <div className="cpf-summary-list">
            {rows.map(r => (
              <SummaryRowItem
                key={r.channel_id}
                row={r}
                median={med}
                maxCpf={maxCpf}
              />
            ))}
          </div>
          <div style={summaryFooterStyle}>
            <div>
              <div style={{ fontSize: 12, color: '#8C7B6E' }}>Средний CPF</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#2C2B28' }}>
                {avgCpf == null ? '—' : `${fmtCpf(avgCpf)} ₽`}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 12, color: '#8C7B6E' }}>
                Расходы / подписчики
              </div>
              <div style={{ fontSize: 13, color: '#2C2B28', fontWeight: 600 }}>
                {fmtMoney(totalSpent)} ₽ / {fmtMoney(totalJoined)}
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  )
}

function SummaryRowItem({
  row,
  median: med,
  maxCpf,
}: {
  row: SummaryRow
  median: number
  maxCpf: number
}) {
  const hasData = row.cpf != null && row.joined > 0
  const barColor = hasData ? cpfColor(row.cpf as number, med) : '#D4B896'
  const widthPct = hasData ? Math.max(4, ((row.cpf as number) / maxCpf) * 100) : 0

  return (
    <div style={summaryRowStyle} className="cpf-summary-row">
      <div style={summaryRowHeaderStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <PlatformChip platform={row.platform} />
          <span style={{
            fontWeight: 600,
            color: '#2C2B28',
            fontSize: 14,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {row.channel_name}
          </span>
        </div>
        <div style={summaryRowMetricsStyle}>
          {hasData ? (
            <>
              <span style={{ color: '#8C7B6E', fontSize: 13 }}>
                {fmtMoney(row.joined)} подп.
              </span>
              <span style={{ color: barColor, fontWeight: 700, fontSize: 15 }}>
                {fmtCpf(row.cpf)} ₽/подп
              </span>
            </>
          ) : (
            <span style={{ color: '#8C7B6E', fontSize: 13 }}>Нет данных</span>
          )}
        </div>
      </div>
      {hasData && (
        <div style={barTrackStyle}>
          <div
            style={{
              ...barFillStyle,
              width: `${widthPct}%`,
              background: barColor,
            }}
          />
        </div>
      )}
    </div>
  )
}

// ── Block 2: per-channel breakdown ───────────────────────────────────

const PER_PAGE = 15

function ByChannelBlock() {
  const [channels, setChannels] = useState<ChannelOption[]>([])
  const [channelId, setChannelId] = useState<number | null>(null)
  const [preset, setPreset] = useState<Preset | null>('30d')
  const initial = presetRange('30d')
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [rangeError, setRangeError] = useState<string | null>(null)
  const [data, setData] = useState<ByChannelResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)

  useEffect(() => {
    apiFetch('/api/channels/all')
      .then(r => (r.ok ? r.json() : []))
      .then((list: ChannelOption[]) => {
        setChannels(list)
        if (list.length > 0) setChannelId(list[0].id)
      })
  }, [])

  useEffect(() => {
    if (channelId == null || !from || !to || rangeError) return
    setLoading(true)
    setPage(1)
    const qs = new URLSearchParams({
      channel_id: String(channelId),
      from,
      to,
    }).toString()
    apiFetch(`/api/cpf/by-channel?${qs}`)
      .then(r => (r.ok ? r.json() : null))
      .then((d: ByChannelResponse | null) => setData(d))
      .finally(() => setLoading(false))
  }, [channelId, from, to, rangeError])

  function applyPreset(p: Preset) {
    const r = presetRange(p)
    setFrom(r.from)
    setTo(r.to)
    setPreset(p)
    setRangeError(null)
  }

  function handleRange(f: string, t: string) {
    setPreset(null)
    setRangeError(null)
    setFrom(f)
    setTo(t)
  }

  const allCpfs = useMemo(
    () => (data?.rows ?? []).filter(r => r.cpf != null).map(r => r.cpf as number),
    [data]
  )
  const med = useMemo(() => median(allCpfs), [allCpfs])

  const total = data?.rows.length ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))
  const pageRows = (data?.rows ?? []).slice((page - 1) * PER_PAGE, page * PER_PAGE)

  return (
    <section style={cardStyle}>
      <div style={blockHeaderStyle}>
        <div>
          <h2 style={blockTitleStyle}>Аналитика CPF по каналу</h2>
          <div style={{ color: '#8C7B6E', fontSize: 12 }}>
            Разбивка по площадкам и таргетингу
          </div>
        </div>
      </div>

      <div style={filtersRowStyle} className="filters-bar">
        <label style={filterLabelStyle}>
          Канал
          <select
            value={channelId ?? ''}
            onChange={e => setChannelId(e.target.value ? Number(e.target.value) : null)}
            style={selectStyle}
          >
            {channels.length === 0 && <option value="">—</option>}
            {channels.map(c => (
              <option key={c.id} value={c.id}>
                {c.platform === 'telegram' ? '[TG]' : '[MAX]'} {c.name}
              </option>
            ))}
          </select>
        </label>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {(['7d', '30d', '90d'] as Preset[]).map(p => (
            <button
              key={p}
              onClick={() => applyPreset(p)}
              style={{
                ...presetBtnStyle,
                background: preset === p ? '#2C2B28' : '#F0E8DE',
                color: preset === p ? '#FEFEFE' : '#2C2B28',
              }}
            >
              {p === '7d' ? '7д' : p === '30d' ? '30д' : '90д'}
            </button>
          ))}
        </div>
        <DateRangePicker
          dateFrom={from}
          dateTo={to}
          onChange={handleRange}
          onError={setRangeError}
          error={rangeError}
        />
      </div>

      {loading ? (
        <SkeletonTable rows={6} cols={5} />
      ) : !data || data.rows.length === 0 ? (
        <div style={emptyStyle}>
          Нет закупок с CPA-данными за выбранный период. Убедитесь что у закупок
          заполнено поле joined_count.
        </div>
      ) : (
        <>
          <div className="table-scroll">
            <table style={tableStyle}>
              <thead>
                <tr>
                  {['Площадка/Источник', 'Тип', 'Расходы', 'Подписалось', 'CPF'].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r, i) => (
                  <tr key={`${r.source_type}-${r.source_name}-${i}`}>
                    <td style={tdStyle}>{r.source_name}</td>
                    <td style={tdStyle}><SourceTypeChip type={r.source_type} /></td>
                    <td style={tdStyle}>{fmtMoney(r.spent)} ₽</td>
                    <td style={tdStyle}>{fmtMoney(r.joined)}</td>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>
                      {r.cpf == null ? (
                        <span style={{ color: '#8C7B6E', fontWeight: 400 }}>—</span>
                      ) : (
                        <span style={{ color: cpfColor(r.cpf, med) }}>
                          {fmtCpf(r.cpf)} ₽
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: '#F0E8DE', fontWeight: 600 }}>
                  <td style={tdStyle}>Итого</td>
                  <td style={tdStyle}></td>
                  <td style={tdStyle}>{fmtMoney(data.total.spent)} ₽</td>
                  <td style={tdStyle}>{fmtMoney(data.total.joined)}</td>
                  <td style={tdStyle}>
                    {data.total.cpf == null ? (
                      <span style={{ color: '#8C7B6E', fontWeight: 400 }}>—</span>
                    ) : (
                      <span style={{ color: cpfColor(data.total.cpf, med) }}>
                        {fmtCpf(data.total.cpf)} ₽
                      </span>
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          {total > PER_PAGE && (
            <div style={{ marginTop: 12 }}>
              <Pagination
                page={page}
                total_pages={totalPages}
                total={total}
                per_page={PER_PAGE}
                onChange={setPage}
              />
            </div>
          )}
        </>
      )}
    </section>
  )
}

// ── styles ───────────────────────────────────────────────────────────

const cardStyle: CSSProperties = {
  background: '#FEFEFE',
  border: '1px solid #E8DDD3',
  borderRadius: 8,
  padding: '18px 20px',
}

const blockHeaderStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-end',
  marginBottom: 14,
}

const blockTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: 16,
  fontWeight: 700,
  color: '#2C2B28',
}

const filtersRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 12,
  alignItems: 'flex-end',
  marginBottom: 16,
}

const filterLabelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  fontSize: 12,
  color: '#8C7B6E',
  fontWeight: 500,
}

const selectStyle: CSSProperties = {
  fontSize: 13,
  padding: '5px 8px',
  border: '1.5px solid #E8DDD3',
  borderRadius: 8,
  background: '#FEFEFE',
  color: '#2C2B28',
  minWidth: 200,
}

const presetBtnStyle: CSSProperties = {
  padding: '5px 12px',
  borderRadius: 6,
  border: '1px solid #E8DDD3',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 500,
}

const emptyStyle: CSSProperties = {
  textAlign: 'center',
  padding: '40px 0',
  color: '#8C7B6E',
  fontSize: 14,
}

const summaryRowStyle: CSSProperties = {
  padding: '12px 0',
  borderBottom: '1px solid #F0E8DE',
}

const summaryRowHeaderStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
  marginBottom: 6,
}

const summaryRowMetricsStyle: CSSProperties = {
  display: 'flex',
  gap: 16,
  alignItems: 'baseline',
  whiteSpace: 'nowrap',
}

const barTrackStyle: CSSProperties = {
  height: 8,
  background: '#F0E8DE',
  borderRadius: 4,
  overflow: 'hidden',
}

const barFillStyle: CSSProperties = {
  height: '100%',
  borderRadius: 4,
  transition: 'width 0.25s ease',
}

const summaryFooterStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginTop: 16,
  padding: '14px 16px',
  background: '#F0E8DE',
  borderRadius: 8,
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
  padding: '8px 14px',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: '#8C7B6E',
  background: '#F0E8DE',
  borderBottom: '1.5px solid #E8DDD3',
  whiteSpace: 'nowrap',
}

const tdStyle: CSSProperties = {
  padding: '8px 14px',
  borderBottom: '1px solid #F0E8DE',
  fontSize: 13,
}
