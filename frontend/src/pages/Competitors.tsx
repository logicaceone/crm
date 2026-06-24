import { useState, useEffect, useMemo, CSSProperties } from 'react'
import { apiFetch } from '../lib/api'
import { Pagination } from '../components/Pagination'
import { SkeletonTable } from '../components/PageSkeleton'
import { useDebounced } from '../hooks/useDebounced'
import { useAuth } from '../contexts/AuthContext'

// Default region = "Татарстан" (substring). Server applies it as a
// case-insensitive substring filter so all MaxDash variants
// (Казань, Татарстан, Республика Татарстан, районы…) get included.
const DEFAULT_REGION = 'Татарстан'
const DEFAULT_CATEGORY = 'Новости и СМИ'
const PER_PAGE = 25

interface MaxdashItem {
  rank?: number
  title?: string
  username?: string
  avatar?: string
  categories?: string[]
  participants_count?: number
  participants_growth?: number
  err48?: number
  err7d?: number
  avg_post_reach?: number
  ci_index?: number
}

interface MaxdashResponse {
  count?: number
  cached_at?: string
  items?: MaxdashItem[]
}

type SortKey =
  | 'rank'
  | 'title'
  | 'participants_count'
  | 'err48'
  | 'avg_post_reach'
  | 'ci_index'

interface SortState {
  key: SortKey
  dir: 'asc' | 'desc'
}

function fmt(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 0 })
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return '—'
  return `${n.toFixed(2)}%`
}

function fmtCached(iso: string | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export function Competitors() {
  const { user } = useAuth()
  const isRoot = user?.role === 'root'

  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounced(search, 500)
  const [region, setRegion] = useState(DEFAULT_REGION)
  const [category, setCategory] = useState(DEFAULT_CATEGORY)
  const [minSubs, setMinSubs] = useState<string>('')
  const [maxSubs, setMaxSubs] = useState<string>('')

  const [data, setData] = useState<MaxdashResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<number | null>(null)

  const [sort, setSort] = useState<SortState>({ key: 'participants_count', dir: 'desc' })
  const [page, setPage] = useState(1)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setErrorCode(null)
    const params = new URLSearchParams()
    if (debouncedSearch) params.set('q', debouncedSearch)
    // Empty strings = drop the default region/category filter.
    params.set('region', region)
    params.set('category', category)
    if (minSubs) params.set('participants_min', minSubs)
    if (maxSubs) params.set('participants_max', maxSubs)
    params.set('limit', '500')

    apiFetch(`/api/competitors/search?${params.toString()}`)
      .then(async res => {
        if (cancelled) return
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          setError(body.detail || 'Не удалось загрузить данные. Попробуйте позже')
          setErrorCode(res.status)
          setData(null)
          return
        }
        setData(await res.json())
        setPage(1)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [debouncedSearch, region, category, minSubs, maxSubs])

  function resetFilters() {
    setSearch('')
    setRegion(DEFAULT_REGION)
    setCategory(DEFAULT_CATEGORY)
    setMinSubs('')
    setMaxSubs('')
  }

  function toggleSort(key: SortKey) {
    setSort(s => s.key === key
      ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'title' ? 'asc' : 'desc' })
  }

  const sorted = useMemo(() => {
    if (!data?.items) return []
    const items = [...data.items]
    items.sort((a, b) => {
      const av = (a as Record<string, unknown>)[sort.key]
      const bv = (b as Record<string, unknown>)[sort.key]
      const an = typeof av === 'number' ? av : (typeof av === 'string' ? av : Number.NEGATIVE_INFINITY)
      const bn = typeof bv === 'number' ? bv : (typeof bv === 'string' ? bv : Number.NEGATIVE_INFINITY)
      if (typeof an === 'string' && typeof bn === 'string') {
        return sort.dir === 'asc' ? an.localeCompare(bn, 'ru') : bn.localeCompare(an, 'ru')
      }
      const aNum = Number(an), bNum = Number(bn)
      return sort.dir === 'asc' ? aNum - bNum : bNum - aNum
    })
    return items
  }, [data, sort])

  const total = sorted.length
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))
  const pageRows = sorted.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  const tokenNotConfigured = errorCode === 503

  return (
    <div>
      <h1 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700 }}>Рейтинг каналов MAX</h1>
      <div style={{ color: '#8C7B6E', fontSize: 13, marginBottom: 16 }}>
        Данные MaxDash, кэш обновляется раз в сутки в 04:00 МСК
      </div>

      <div className="filters-row-compact">
        <input
          placeholder="Поиск по названию"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: 200 }}
        />
        <input
          placeholder="Регион"
          value={region}
          onChange={e => setRegion(e.target.value)}
          style={{ width: 200 }}
        />
        <input
          placeholder="Категория"
          value={category}
          onChange={e => setCategory(e.target.value)}
          style={{ width: 200 }}
        />
        <input
          type="number"
          min={0}
          placeholder="Подписчики от"
          value={minSubs}
          onChange={e => setMinSubs(e.target.value)}
          style={{ width: 140 }}
        />
        <input
          type="number"
          min={0}
          placeholder="до"
          value={maxSubs}
          onChange={e => setMaxSubs(e.target.value)}
          style={{ width: 110 }}
        />
        <button onClick={resetFilters} style={{ fontSize: 12, color: '#8C7B6E', background: 'none', border: 'none', cursor: 'pointer' }}>
          Сбросить
        </button>
      </div>

      <div style={metaRowStyle}>
        <span>Найдено каналов: <b>{data?.count ?? total ?? '—'}</b></span>
        <span>Данные обновлены: <b>{fmtCached(data?.cached_at)}</b></span>
      </div>

      {tokenNotConfigured ? (
        <div style={emptyBlockStyle}>
          MaxDash API не настроен. {isRoot
            ? <>Добавьте токен в <a href="/settings" style={{ color: '#C07D4A' }}>Настройках</a>.</>
            : <>Обратитесь к root-администратору.</>}
        </div>
      ) : loading ? (
        <SkeletonTable rows={8} cols={7} />
      ) : error ? (
        <div style={{ ...emptyBlockStyle, color: '#dc2626' }}>{error}</div>
      ) : pageRows.length === 0 ? (
        <div style={emptyBlockStyle}>Каналы не найдены по заданным фильтрам</div>
      ) : (
        <>
          <div className="table-scroll">
            <table style={tableStyle}>
              <thead>
                <tr>
                  <Th label="#" onClick={() => toggleSort('rank')} sort={sort} myKey="rank" align="right" />
                  <Th label="Канал" onClick={() => toggleSort('title')} sort={sort} myKey="title" />
                  <th style={thStyle}>Категория</th>
                  <Th label="Подписчики" onClick={() => toggleSort('participants_count')} sort={sort} myKey="participants_count" align="right" />
                  <Th label="ERR 48ч / 7д" onClick={() => toggleSort('err48')} sort={sort} myKey="err48" align="right" />
                  <Th label="Охват 1 поста" onClick={() => toggleSort('avg_post_reach')} sort={sort} myKey="avg_post_reach" align="right" />
                  <Th label="ИЦ" onClick={() => toggleSort('ci_index')} sort={sort} myKey="ci_index" align="right" />
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r, i) => {
                  // Highlight rows for "Светлый"-named channels — these are
                  // ours, so they stand out from the competitor list.
                  const isOurs = (r.title || '').toLowerCase().includes('светлый')
                  return (
                  <tr
                    key={(r.username || '') + i}
                    style={isOurs ? oursRowStyle : undefined}
                  >
                    <td style={{ ...tdStyle, textAlign: 'right', color: '#8C7B6E' }}>{r.rank ?? '—'}</td>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                        {r.avatar
                          ? <img src={r.avatar} alt="" style={avatarStyle} loading="lazy" />
                          : <div style={{ ...avatarStyle, background: '#F0E8DE' }} />}
                        <div style={{ minWidth: 0 }}>
                          {r.username
                            ? <a href={`https://max.ru/${r.username}`} target="_blank" rel="noreferrer" style={{ color: '#2C2B28', fontWeight: 600, textDecoration: 'none' }}>{r.title || r.username}</a>
                            : <span style={{ fontWeight: 600 }}>{r.title || '—'}</span>}
                          {r.username && <div style={{ fontSize: 12, color: '#8C7B6E' }}>@{r.username}</div>}
                        </div>
                      </div>
                    </td>
                    <td style={tdStyle}>{(r.categories ?? []).join(', ') || '—'}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <div style={{ fontWeight: 600 }}>{fmt(r.participants_count)}</div>
                      {r.participants_growth != null && r.participants_growth !== 0 && (
                        <div style={{
                          fontSize: 12,
                          color: r.participants_growth > 0 ? '#16a34a' : '#dc2626',
                          fontWeight: 500,
                        }}>
                          {r.participants_growth > 0 ? '+' : ''}{fmt(r.participants_growth)}
                        </div>
                      )}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <div>{fmtPct(r.err48)}</div>
                      <div style={{ fontSize: 12, color: '#8C7B6E' }}>{fmtPct(r.err7d)}</div>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{fmt(r.avg_post_reach)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 500 }}>{r.ci_index ?? '—'}</td>
                  </tr>
                  )
                })}
              </tbody>
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
    </div>
  )
}

function Th({ label, onClick, sort, myKey, align }: {
  label: string
  onClick: () => void
  sort: SortState
  myKey: SortKey
  align?: 'right' | 'left'
}) {
  const active = sort.key === myKey
  const arrow = active ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''
  return (
    <th
      style={{
        ...thStyle,
        textAlign: align || 'left',
        cursor: 'pointer',
        color: active ? '#2C2B28' : thStyle.color,
      }}
      onClick={onClick}
    >
      {label}{arrow}
    </th>
  )
}

const metaRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: 12,
  marginBottom: 10,
  fontSize: 13,
  color: '#8C7B6E',
}

const emptyBlockStyle: CSSProperties = {
  background: '#FEFEFE',
  border: '1px solid #E8DDD3',
  borderRadius: 8,
  padding: '32px 24px',
  textAlign: 'center',
  color: '#8C7B6E',
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
  padding: '10px 14px',
  borderBottom: '1px solid #F0E8DE',
  fontSize: 13,
  verticalAlign: 'middle',
}

const oursRowStyle: CSSProperties = {
  background: '#C07D4A14',
  boxShadow: 'inset 3px 0 0 #C07D4A',
}

const avatarStyle: CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: '50%',
  objectFit: 'cover',
  flexShrink: 0,
  border: '1px solid #E8DDD3',
}
