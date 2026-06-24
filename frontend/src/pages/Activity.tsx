import { useState, useEffect, useRef, CSSProperties } from 'react'
import { apiFetch } from '../lib/api'
import { SkeletonTable } from '../components/PageSkeleton'
import { Pagination } from '../components/Pagination'
import { useDebounced } from '../hooks/useDebounced'

const PER_PAGE = 15

interface Action {
  id: number
  username: string
  role: string
  action: string
  entity_type: string
  entity_id: number | null
  description: string | null
  created_at: string
}

const ACTION_LABELS: Record<string, string> = {
  create: 'Создание',
  update: 'Изменение',
  delete: 'Удаление',
}

const ACTION_COLORS: Record<string, string> = {
  create: '#16a34a',
  update: '#C07D4A',
  delete: '#dc2626',
}

const ENTITY_LABELS: Record<string, string> = {
  expense: 'Расход',
  purchase: 'Закупка',  // legacy log entries
  sale: 'Продажа',
  channel: 'Канал',
  channel_stat: 'Снапшот',
  external_channel: 'Площадка',
  user: 'Пользователь',
}

export function Activity() {
  const [actions, setActions] = useState<Action[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [filterAction, setFilterAction] = useState('')
  const [filterEntity, setFilterEntity] = useState('')
  const [userInput, setUserInput] = useState('')
  // 300ms debounce — refetch fires once the user stops typing, the
  // input itself stays controlled by `userInput`.
  const filterUser = useDebounced(userInput, 300)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const tableRef = useRef<HTMLTableElement>(null)

  useEffect(() => {
    setPage(1)
  }, [filterAction, filterEntity, filterUser])

  useEffect(() => {
    load()
  }, [filterAction, filterEntity, filterUser, page])

  async function load() {
    setLoading(true)
    const p = new URLSearchParams()
    if (filterAction) p.set('action', filterAction)
    if (filterEntity) p.set('entity_type', filterEntity)
    if (filterUser) p.set('username', filterUser)
    p.set('page', String(page))
    p.set('per_page', String(PER_PAGE))
    const res = await apiFetch(`/api/activity?${p}`)
    if (res.ok) {
      const data = await res.json()
      if (data.pagination.total_pages > 0 && page > data.pagination.total_pages) {
        setPage(data.pagination.total_pages)
        return
      }
      setActions(data.items)
      setTotal(data.pagination.total)
      setTotalPages(data.pagination.total_pages)
      setError('')
    } else {
      setError('Не удалось загрузить действия')
    }
    setLoading(false)
  }

  function changePage(p: number) {
    setPage(p)
    tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const hasFilters = filterAction || filterEntity || filterUser

  return (
    <div>
      <div style={headerRowStyle}>
        <h1 style={{ margin: 0 }}>Действия пользователей</h1>
      </div>

      <div className="filters-row-compact">
        <select
          value={filterAction}
          onChange={e => setFilterAction(e.target.value)}
          style={{ width: 180 }}
        >
          <option value="">Все действия</option>
          <option value="create">Создание</option>
          <option value="update">Изменение</option>
          <option value="delete">Удаление</option>
        </select>

        <select
          value={filterEntity}
          onChange={e => setFilterEntity(e.target.value)}
          style={{ width: 150 }}
        >
          <option value="">Все типы</option>
          <option value="expense">Расходы</option>
          <option value="sale">Продажи</option>
          <option value="channel">Каналы</option>
          <option value="channel_stat">Снапшоты</option>
          <option value="external_channel">Площадки</option>
          <option value="user">Пользователи</option>
        </select>

        <input
          placeholder="Фильтр по пользователю"
          value={userInput}
          onChange={e => setUserInput(e.target.value)}
          style={{ width: 200 }}
        />

        {hasFilters && (
          <button
            onClick={() => { setFilterAction(''); setFilterEntity(''); setUserInput('') }}
            style={{ fontSize: 12, color: '#8C7B6E', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            Сбросить
          </button>
        )}
      </div>

      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {loading && <SkeletonTable rows={8} cols={5} />}

      {!loading && (<>
        <table ref={tableRef} style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Дата и время</th>
              <th style={thStyle}>Пользователь</th>
              <th style={thStyle}>Действие</th>
              <th style={thStyle}>Тип</th>
              <th style={thStyle}>Описание</th>
            </tr>
          </thead>
          <tbody>
            {actions.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ ...tdStyle, textAlign: 'center', color: '#D4B896' }}>
                  Нет записей
                </td>
              </tr>
            ) : (
              actions.map(a => (
                <tr key={a.id}>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: '#8C7B6E' }}>
                    {new Date(a.created_at).toLocaleString('ru-RU', {
                      day: '2-digit', month: '2-digit', year: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </td>
                  <td style={tdStyle}>
                    <span style={{ fontWeight: 600 }}>{a.username}</span>
                    <span style={{ marginLeft: 6, fontSize: 11, color: '#8C7B6E' }}>{a.role}</span>
                  </td>
                  <td style={tdStyle}>
                    <span style={{
                      display: 'inline-block',
                      padding: '1px 8px',
                      borderRadius: 12,
                      fontSize: 12,
                      fontWeight: 600,
                      color: ACTION_COLORS[a.action] ?? '#2C2B28',
                      background: (ACTION_COLORS[a.action] ?? '#2C2B28') + '18',
                      border: `1px solid ${(ACTION_COLORS[a.action] ?? '#2C2B28')}44`,
                    }}>
                      {ACTION_LABELS[a.action] ?? a.action}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, color: '#8C7B6E', fontSize: 12 }}>
                    {ENTITY_LABELS[a.entity_type] ?? a.entity_type}
                    {a.entity_id && <span style={{ marginLeft: 4 }}>#{a.entity_id}</span>}
                  </td>
                  <td style={tdStyle}>{a.description ?? '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <Pagination
          page={page}
          total_pages={totalPages}
          total={total}
          per_page={PER_PAGE}
          onChange={changePage}
        />
      </>)}
    </div>
  )
}

const headerRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 16,
}

const filtersRowStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  marginBottom: 16,
  flexWrap: 'wrap',
}

const filterStyle: CSSProperties = {
  fontSize: 13,
  padding: '5px 8px',
}

const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  background: '#FEFEFE',
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
  padding: '9px 14px',
  borderBottom: '1px solid #E8DDD3',
  fontSize: 13,
}
