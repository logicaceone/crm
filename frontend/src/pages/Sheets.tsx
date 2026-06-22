import { useState, useEffect, FormEvent, CSSProperties } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { useConfirm } from '../contexts/ConfirmContext'
import { apiFetch } from '../lib/api'
import { Modal } from '../components/Modal'
import { SkeletonTable } from '../components/PageSkeleton'

interface SyncResult {
  created: number
  skipped: number
  errors: number
  error_message?: string | null
  unmatched_channels?: string[]
}

interface SheetSource {
  id: number
  name: string
  gid: string
  is_active: boolean
  created_at: string
  last_synced_at: string | null
  last_sync_result: SyncResult | null
}

interface SectionProps {
  title: string
  subtitle: string
  apiPrefix: string         // e.g. '/api/sheets/sources' or '/api/sheets/sales-sources'
  syncAllPath: string       // e.g. '/api/sheets/sync-all'
  testPath: string          // e.g. '/api/sheets/sources/test'
  addPlaceholderName: string
  addPlaceholderGid: string
}

export function Sheets() {
  const { user } = useAuth()
  if (user?.role !== 'root') {
    return <p style={{ color: '#dc2626' }}>Доступ только для root</p>
  }

  return (
    <div>
      <h1 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700 }}>Парсинг Google Sheets</h1>
      <p style={subtitleStyle}>Импорт расходов и продаж из публичных таблиц</p>

      <SheetsSection
        title="Листы расходов"
        subtitle="СММ выплаты — импорт в категорию «Подписчики»"
        apiPrefix="/api/sheets/sources"
        syncAllPath="/api/sheets/sync-all"
        testPath="/api/sheets/sources/test"
        addPlaceholderName="Май 2026"
        addPlaceholderGid="2047126112"
      />

      <div style={{ height: 32 }} />

      <SheetsSection
        title="Листы продаж"
        subtitle="Реклама — импорт в модуль «Продажи». Импортируются только строки где «получил деньги» И «сделал пост» = TRUE."
        apiPrefix="/api/sheets/sales-sources"
        syncAllPath="/api/sheets/sales-sync-all"
        testPath="/api/sheets/sales-sources/test"
        addPlaceholderName="Май 2026"
        addPlaceholderGid="804964044"
      />
    </div>
  )
}

function SheetsSection({
  title, subtitle, apiPrefix, syncAllPath, testPath,
  addPlaceholderName, addPlaceholderGid,
}: SectionProps) {
  const toast = useToast()
  const confirm = useConfirm()

  const [sources, setSources] = useState<SheetSource[]>([])
  const [loading, setLoading] = useState(true)
  const [syncingId, setSyncingId] = useState<number | null>(null)
  const [syncingAll, setSyncingAll] = useState(false)

  const [showAdd, setShowAdd] = useState(false)
  const [addName, setAddName] = useState('')
  const [addGid, setAddGid] = useState('')
  const [addError, setAddError] = useState('')
  const [adding, setAdding] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const res = await apiFetch(apiPrefix)
    if (res.ok) setSources(await res.json())
    setLoading(false)
  }

  async function handleSyncOne(s: SheetSource) {
    setSyncingId(s.id)
    try {
      const res = await apiFetch(`${apiPrefix}/${s.id}/sync`, { method: 'POST' })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toast.error(d.detail ?? 'Ошибка синхронизации')
        return
      }
      const r: SyncResult = await res.json()
      const msg = `${s.name}: +${r.created} / ${r.skipped} / ${r.errors}`
      if (r.errors > 0) toast.error(`${msg} (есть ошибки)`)
      else toast.success(`${s.name}: импортировано ${r.created}, пропущено ${r.skipped}`)
      await load()
    } finally {
      setSyncingId(null)
    }
  }

  async function handleSyncAll() {
    setSyncingAll(true)
    try {
      const res = await apiFetch(syncAllPath, { method: 'POST' })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toast.error(d.detail ?? 'Ошибка синхронизации')
        return
      }
      const data = await res.json()
      const t = data.total
      const note = t.errors > 0 ? ' (ошибки!)' : ''
      toast.success(`Импортировано ${t.created}, пропущено ${t.skipped}${note}`)
      await load()
    } finally {
      setSyncingAll(false)
    }
  }

  async function handleToggle(s: SheetSource) {
    const res = await apiFetch(`${apiPrefix}/${s.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_active: !s.is_active }),
    })
    if (res.ok) {
      const updated: SheetSource = await res.json()
      setSources(prev => prev.map(x => x.id === updated.id ? updated : x))
    } else {
      toast.error('Не удалось обновить')
    }
  }

  async function handleDelete(s: SheetSource) {
    if (!await confirm(`Удалить лист «${s.name}»? Импортированные записи останутся.`)) return
    const res = await apiFetch(`${apiPrefix}/${s.id}`, { method: 'DELETE' })
    if (res.ok || res.status === 204) {
      setSources(prev => prev.filter(x => x.id !== s.id))
      toast.success('Лист удалён')
    } else {
      toast.error('Не удалось удалить')
    }
  }

  function openAdd() {
    setAddName('')
    setAddGid('')
    setAddError('')
    setTestResult(null)
    setShowAdd(true)
  }

  async function handleTest() {
    setTestResult(null)
    setTesting(true)
    try {
      const res = await apiFetch(testPath, {
        method: 'POST',
        body: JSON.stringify({ gid: addGid }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setTestResult('ERROR:' + (d.detail ?? 'Лист недоступен'))
        return
      }
      const data = await res.json()
      const firstDate = data.first_dates?.[0] ?? '—'
      setTestResult(`OK:Найдено ${data.row_count} строк, первая дата: ${firstDate}`)
    } finally {
      setTesting(false)
    }
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    setAddError('')
    setAdding(true)
    try {
      const res = await apiFetch(apiPrefix, {
        method: 'POST',
        body: JSON.stringify({ name: addName, gid: addGid }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setAddError(d.detail ?? 'Ошибка')
        return
      }
      const created: SheetSource = await res.json()
      setSources(prev => [...prev, created])
      setShowAdd(false)
      toast.success('Лист добавлен')
    } finally {
      setAdding(false)
    }
  }

  if (loading) return (
    <div>
      <h2 style={sectionTitleStyle}>{title}</h2>
      <p style={sectionSubtitleStyle}>{subtitle}</p>
      <SkeletonTable rows={3} cols={5} />
    </div>
  )

  return (
    <div>
      <div style={headerRowStyle}>
        <div>
          <h2 style={sectionTitleStyle}>{title}</h2>
          <p style={sectionSubtitleStyle}>{subtitle}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handleSyncAll} disabled={syncingAll || sources.length === 0}>
            {syncingAll ? 'Синхронизация…' : 'Синхронизировать все'}
          </button>
          <button onClick={openAdd}>+ Добавить лист</button>
        </div>
      </div>

      <div className="table-scroll">
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Название</th>
              <th style={thStyle}>GID</th>
              <th style={thStyle}>Статус</th>
              <th style={thStyle}>Последняя синхронизация</th>
              <th style={thStyle}>Результат</th>
              <th style={thStyle}>Действия</th>
            </tr>
          </thead>
          <tbody>
            {sources.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ ...tdStyle, textAlign: 'center', color: '#D4B896' }}>
                  Нет добавленных листов
                </td>
              </tr>
            ) : sources.map(s => {
              const r = s.last_sync_result
              const hasErrors = r ? (r.errors ?? 0) > 0 : false
              return (
                <tr key={s.id}>
                  <td style={tdStyle}>{s.name}</td>
                  <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12, color: '#8C7B6E' }}>{s.gid}</td>
                  <td style={tdStyle}>
                    <span style={s.is_active ? activeBadge : inactiveBadge}>
                      {s.is_active ? 'Активен' : 'Отключён'}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    {s.last_synced_at
                      ? new Date(s.last_synced_at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
                      : <span style={{ color: '#8C7B6E' }}>Никогда</span>}
                  </td>
                  <td style={{ ...tdStyle, color: hasErrors ? '#dc2626' : undefined }}>
                    {r ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span>
                          +{r.created ?? 0} / {r.skipped ?? 0} / {r.errors ?? 0}
                          {r.error_message ? ` (${r.error_message})` : ''}
                        </span>
                        {r.unmatched_channels && r.unmatched_channels.length > 0 && (
                          <span
                            style={{ fontSize: 11, color: '#C07D4A', cursor: 'help' }}
                            title={r.unmatched_channels.join('\n')}
                          >
                            ⚠ не найдено: {r.unmatched_channels.length}
                          </span>
                        )}
                      </div>
                    ) : '—'}
                  </td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <button
                        onClick={() => handleSyncOne(s)}
                        disabled={syncingId === s.id}
                        style={microBtnStyle}
                      >
                        {syncingId === s.id ? '…' : 'Синхр.'}
                      </button>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12 }}>
                        <input
                          type="checkbox"
                          checked={s.is_active}
                          onChange={() => handleToggle(s)}
                        />
                        вкл
                      </label>
                      <button
                        onClick={() => handleDelete(s)}
                        style={{ ...microBtnStyle, color: '#dc2626', borderColor: '#fca5a5' }}
                      >
                        Удалить
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <Modal title={`Добавить лист — ${title.toLowerCase()}`} onClose={() => setShowAdd(false)}>
          <form onSubmit={handleAdd} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {addError && <div style={{ color: '#dc2626', fontSize: 13 }}>{addError}</div>}
            <label style={labelStyle}>
              Название листа *
              <input
                placeholder={addPlaceholderName}
                value={addName}
                onChange={e => setAddName(e.target.value)}
                required
                autoFocus
              />
            </label>
            <label style={labelStyle}>
              GID листа *
              <input
                placeholder={addPlaceholderGid}
                value={addGid}
                onChange={e => { setAddGid(e.target.value); setTestResult(null) }}
                required
              />
              <span style={{ fontSize: 11, color: '#8C7B6E', marginTop: 2 }}>
                Найти в URL таблицы после <code>#gid=</code>
              </span>
            </label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button type="button" onClick={handleTest} disabled={testing || !addGid} style={{ fontSize: 12 }}>
                {testing ? 'Проверка…' : 'Проверить'}
              </button>
              {testResult && (
                <span style={{ fontSize: 12, color: testResult.startsWith('OK:') ? '#16a34a' : '#dc2626' }}>
                  {testResult.slice(testResult.indexOf(':') + 1)}
                </span>
              )}
            </div>
            <div className="modal-footer">
              <button type="button" onClick={() => setShowAdd(false)}>Отмена</button>
              <button type="submit" disabled={adding}>{adding ? 'Сохранение…' : 'Сохранить'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

const subtitleStyle: CSSProperties = { margin: '0 0 20px', fontSize: 13, color: '#8C7B6E' }
const sectionTitleStyle: CSSProperties = { margin: '0 0 2px', fontSize: 17, fontWeight: 600 }
const sectionSubtitleStyle: CSSProperties = { margin: '0 0 12px', fontSize: 12, color: '#8C7B6E' }
const headerRowStyle: CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
  marginBottom: 12, gap: 12, flexWrap: 'wrap',
}
const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', background: '#FEFEFE' }
const thStyle: CSSProperties = {
  textAlign: 'left', padding: '10px 12px',
  borderBottom: '1.5px solid #E8DDD3',
  fontWeight: 700, fontSize: 11,
  background: '#F0E8DE', color: '#8C7B6E',
  letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap',
}
const tdStyle: CSSProperties = {
  padding: '9px 12px',
  borderBottom: '1px solid #E8DDD3',
  fontSize: 13, verticalAlign: 'middle',
}
const microBtnStyle: CSSProperties = {
  fontSize: 11, padding: '2px 8px',
  background: 'transparent',
  border: '1px solid #E8DDD3',
  borderRadius: 6, cursor: 'pointer',
  color: '#2C2B28', whiteSpace: 'nowrap',
}
const activeBadge: CSSProperties = {
  display: 'inline-block', fontSize: 11, fontWeight: 600,
  padding: '2px 8px', borderRadius: 20,
  background: '#DCFCE7', color: '#15803D',
}
const inactiveBadge: CSSProperties = {
  display: 'inline-block', fontSize: 11, fontWeight: 600,
  padding: '2px 8px', borderRadius: 20,
  background: '#E5E7EB', color: '#374151',
}
const labelStyle: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 4,
  fontSize: 13, fontWeight: 500, color: '#2C2B28',
}
