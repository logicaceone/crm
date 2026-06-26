import { useState, useEffect, FormEvent, CSSProperties } from 'react'
import { useToast } from '../contexts/ToastContext'
import { useConfirm } from '../contexts/ConfirmContext'
import { apiFetch } from '../lib/api'
import { SkeletonCards } from '../components/PageSkeleton'
import { Modal } from '../components/Modal'

interface SettingsData {
  telegram_bot_token_set: boolean
  max_bot_token_set: boolean
  max_api_base_url: string
  max_posts_sample: number
}

interface DailyReportConfig {
  enabled: boolean
  chat_id_set: boolean
  chat_id_masked: string | null
  schedule: string
}

export function Settings() {
  const toast = useToast()
  const confirm = useConfirm()
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const [tgTokenSet, setTgTokenSet] = useState(false)
  const [tgToken, setTgToken] = useState('')

  const [maxTokenSet, setMaxTokenSet] = useState(false)
  const [maxToken, setMaxToken] = useState('')

  const [maxUrl, setMaxUrl] = useState('')
  const [maxSample, setMaxSample] = useState(20)

  const [report, setReport] = useState<DailyReportConfig | null>(null)
  const [reportSaving, setReportSaving] = useState(false)
  const [reportSending, setReportSending] = useState(false)

  const [maxdashConfigured, setMaxdashConfigured] = useState(false)
  const [maxdashInput, setMaxdashInput] = useState('')
  const [maxdashSaving, setMaxdashSaving] = useState(false)
  const [maxdashChecking, setMaxdashChecking] = useState(false)

  const [botKeyConfigured, setBotKeyConfigured] = useState(false)
  const [generatedKey, setGeneratedKey] = useState<string | null>(null)
  const [showKeyModal, setShowKeyModal] = useState(false)
  const [isGeneratingBotKey, setIsGeneratingBotKey] = useState(false)
  const [isDeletingBotKey, setIsDeletingBotKey] = useState(false)

  interface BackupConfig {
    enabled: boolean
    chat_id_set: boolean
    chat_id_masked: string | null
    schedule: string
    keep_days: number
  }
  const [backup, setBackup] = useState<BackupConfig | null>(null)
  const [backupChatIdInput, setBackupChatIdInput] = useState('')
  const [backupSaving, setBackupSaving] = useState(false)
  const [backupRunning, setBackupRunning] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [sRes, rRes, mRes, bRes, kRes] = await Promise.all([
      apiFetch('/api/settings'),
      apiFetch('/api/settings/daily-report'),
      apiFetch('/api/settings/maxdash-token'),
      apiFetch('/api/settings/backup'),
      apiFetch('/api/settings/bot-api-key'),
    ])
    if (sRes.ok) {
      const d: SettingsData = await sRes.json()
      setTgTokenSet(d.telegram_bot_token_set)
      setMaxTokenSet(d.max_bot_token_set)
      setMaxUrl(d.max_api_base_url)
      setMaxSample(d.max_posts_sample)
    }
    if (rRes.ok) setReport(await rRes.json())
    if (mRes.ok) {
      const d = await mRes.json() as { configured: boolean }
      setMaxdashConfigured(d.configured)
    }
    if (bRes.ok) setBackup(await bRes.json())
    if (kRes.ok) {
      const d = await kRes.json() as { configured: boolean }
      setBotKeyConfigured(d.configured)
    }
    setLoading(false)
  }

  async function generateBotKey() {
    setIsGeneratingBotKey(true)
    try {
      const res = await apiFetch('/api/settings/bot-api-key', { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body.detail || 'Ошибка генерации ключа')
        return
      }
      setGeneratedKey(body.key)
      setBotKeyConfigured(true)
      setShowKeyModal(true)
    } finally {
      setIsGeneratingBotKey(false)
    }
  }

  async function handleRegenerateBotKey() {
    const ok = await confirm({
      message: 'Пересгенерировать ключ? Бот перестанет работать до обновления BOT_API_KEY в .env',
      confirmLabel: 'Пересгенерировать',
    })
    if (!ok) return
    await generateBotKey()
  }

  async function handleDeleteBotKey() {
    const ok = await confirm({
      message: 'Удалить API ключ? Бот немедленно потеряет доступ к CRM.',
      confirmLabel: 'Удалить',
    })
    if (!ok) return
    setIsDeletingBotKey(true)
    try {
      const res = await apiFetch('/api/settings/bot-api-key', { method: 'DELETE' })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toast.error(d.detail || 'Ошибка удаления')
        return
      }
      setBotKeyConfigured(false)
      toast.success('Ключ удалён')
    } finally {
      setIsDeletingBotKey(false)
    }
  }

  async function copyGeneratedKey() {
    if (!generatedKey) return
    try {
      await navigator.clipboard.writeText(generatedKey)
      toast.success('Скопировано')
    } catch {
      toast.error('Не удалось скопировать')
    }
  }

  async function saveBackupChatId() {
    const chat_id = backupChatIdInput.trim()
    setBackupSaving(true)
    try {
      const res = await apiFetch('/api/settings/backup-chat-id', {
        method: 'PATCH',
        body: JSON.stringify({ chat_id: chat_id || null }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toast.error(d.detail || 'Не удалось сохранить chat ID')
        return
      }
      setBackup(await res.json())
      setBackupChatIdInput('')
      toast.success(chat_id ? 'Chat ID сохранён' : 'Chat ID очищен')
    } finally {
      setBackupSaving(false)
    }
  }

  async function runBackupNow() {
    setBackupRunning(true)
    try {
      const res = await apiFetch('/api/settings/backup/run', { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body.detail || 'Не удалось создать бэкап')
        return
      }
      const sent = body.sent_to_telegram ? ', отправлен в Telegram' : ''
      toast.success(
        `✅ ${body.file} (${body.size_mb} MB)${sent}`
      )
    } finally {
      setBackupRunning(false)
    }
  }

  async function saveMaxdashToken() {
    const token = maxdashInput.trim()
    if (!token) return
    setMaxdashSaving(true)
    try {
      const res = await apiFetch('/api/settings/maxdash-token', {
        method: 'POST',
        body: JSON.stringify({ token }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toast.error(d.detail || 'Не удалось сохранить токен')
        return
      }
      setMaxdashConfigured(true)
      setMaxdashInput('')
      toast.success('Токен MaxDash сохранён')
    } finally {
      setMaxdashSaving(false)
    }
  }

  async function deleteMaxdashToken() {
    setMaxdashSaving(true)
    try {
      const res = await apiFetch('/api/settings/maxdash-token', { method: 'DELETE' })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toast.error(d.detail || 'Не удалось удалить токен')
        return
      }
      setMaxdashConfigured(false)
      toast.success('Токен MaxDash удалён')
    } finally {
      setMaxdashSaving(false)
    }
  }

  async function checkMaxdashToken() {
    setMaxdashChecking(true)
    try {
      const res = await apiFetch('/api/maxdash/check')
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body.detail || 'Токен недействителен')
        return
      }
      // MaxDash returns the plan name + counters; surface what we have.
      const plan = body?.response?.tariff || body?.tariff || body?.plan || 'OK'
      toast.success(`Подключено, тариф: ${plan}`)
    } finally {
      setMaxdashChecking(false)
    }
  }

  async function toggleReport(enabled: boolean) {
    setReportSaving(true)
    try {
      const res = await apiFetch('/api/settings/daily-report', {
        method: 'PATCH',
        body: JSON.stringify({ enabled }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toast.error(d.detail ?? 'Ошибка сохранения')
        return
      }
      setReport(await res.json())
      toast.success(enabled ? 'Дейли отчёт включён' : 'Дейли отчёт выключен')
    } finally {
      setReportSaving(false)
    }
  }

  async function sendTestReport() {
    setReportSending(true)
    try {
      const res = await apiFetch('/api/settings/daily-report/send-test', {
        method: 'POST',
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toast.error(d.detail ?? 'Не удалось отправить отчёт')
        return
      }
      toast.success('Тестовый отчёт отправлен')
    } finally {
      setReportSending(false)
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const body: Record<string, unknown> = {
        max_api_base_url: maxUrl,
        max_posts_sample: maxSample,
      }
      // only include tokens if user typed something
      if (tgToken !== '') body.telegram_bot_token = tgToken
      if (maxToken !== '') body.max_bot_token = maxToken

      const res = await apiFetch('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const d = await res.json()
        toast.error(d.detail ?? 'Ошибка сохранения')
        return
      }
      const updated: SettingsData = await res.json()
      setTgTokenSet(updated.telegram_bot_token_set)
      setMaxTokenSet(updated.max_bot_token_set)
      setTgToken('')
      setMaxToken('')
      setMaxUrl(updated.max_api_base_url)
      setMaxSample(updated.max_posts_sample)
      toast.success('Настройки сохранены')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return (
    <div>
      <h1 style={{ margin: '0 0 20px', fontSize: 22, fontWeight: 700 }}>Настройки</h1>
      <SkeletonCards count={2} />
    </div>
  )

  return (
    <div style={{ maxWidth: 560 }}>
      <h1 style={{ margin: '0 0 24px' }}>Настройки</h1>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

        <section style={sectionStyle}>
          <h2 style={sectionTitleStyle}>Telegram</h2>
          <p style={hintStyle}>Bot token используется для автосинхронизации подписчиков TG-каналов каждые 24ч.</p>
          <label style={labelStyle}>
            Bot Token
            <div style={{ position: 'relative' }}>
              <input
                type="password"
                autoComplete="off"
                placeholder={tgTokenSet ? '●●●●●●●● (сохранён, оставьте пустым чтобы не менять)' : 'Вставьте токен бота'}
                value={tgToken}
                onChange={e => setTgToken(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', paddingRight: tgTokenSet && tgToken === '' ? 80 : undefined }}
              />
              {tgTokenSet && tgToken === '' && (
                <span style={savedBadgeStyle}>Сохранён</span>
              )}
            </div>
          </label>
        </section>

        <section style={sectionStyle}>
          <h2 style={sectionTitleStyle}>Max.ru</h2>
          <p style={hintStyle}>Параметры интеграции с Max.ru для автосинхронизации подписчиков и просмотров.</p>
          <label style={labelStyle}>
            Bot Token
            <div style={{ position: 'relative' }}>
              <input
                type="password"
                autoComplete="off"
                placeholder={maxTokenSet ? '●●●●●●●● (сохранён, оставьте пустым чтобы не менять)' : 'Вставьте токен бота Max'}
                value={maxToken}
                onChange={e => setMaxToken(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', paddingRight: maxTokenSet && maxToken === '' ? 80 : undefined }}
              />
              {maxTokenSet && maxToken === '' && (
                <span style={savedBadgeStyle}>Сохранён</span>
              )}
            </div>
          </label>
          <label style={{ ...labelStyle, marginTop: 12 }}>
            API Base URL
            <input
              value={maxUrl}
              onChange={e => setMaxUrl(e.target.value)}
              placeholder="https://platform-api.max.ru"
            />
          </label>
          <label style={{ ...labelStyle, marginTop: 12 }}>
            Постов для выборки avg_views
            <input
              type="number"
              min={1}
              max={100}
              value={maxSample}
              onChange={e => setMaxSample(Number(e.target.value))}
              style={{ width: 120 }}
            />
            <span style={{ fontSize: 12, color: '#8C7B6E', marginTop: 2 }}>
              Сколько последних постов использовать при подсчёте среднего просмотров
            </span>
          </label>
        </section>

        <div>
          <button type="submit" disabled={submitting} style={{ minWidth: 120 }}>
            {submitting ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>

      </form>

      {/* Daily report block lives outside the form: its toggle and
          test button POST independently, no need to bundle with the
          main "Сохранить". */}
      <section style={{ ...sectionStyle, marginTop: 24 }}>
        <h2 style={sectionTitleStyle}>Дейли отчёт</h2>
        <p style={hintStyle}>
          Ежедневная сводка по подписчикам каждого канала отправляется в Telegram-группу.
        </p>

        {report ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={report.enabled}
                  disabled={reportSaving}
                  onChange={e => toggleReport(e.target.checked)}
                />
                <span style={{ fontSize: 14, fontWeight: 500 }}>Отправлять дейли отчёт</span>
              </label>
            </div>

            <div style={readOnlyRowStyle}>
              <span style={readOnlyLabelStyle}>ID группы</span>
              <span style={readOnlyValueStyle}>
                {report.chat_id_set
                  ? <code>{report.chat_id_masked}</code>
                  : <span style={{ color: '#dc2626' }}>не задан в .env</span>}
              </span>
            </div>
            <div style={readOnlyRowStyle}>
              <span style={readOnlyLabelStyle}>Время отправки</span>
              <span style={readOnlyValueStyle}><code>{report.schedule}</code></span>
            </div>

            <div style={{ marginTop: 14 }}>
              <button
                type="button"
                onClick={sendTestReport}
                disabled={reportSending || !report.chat_id_set}
                style={{ minWidth: 180 }}
              >
                {reportSending ? 'Отправка…' : 'Отправить тестовый отчёт'}
              </button>
            </div>
          </>
        ) : (
          <div style={{ fontSize: 13, color: '#8C7B6E' }}>Загрузка…</div>
        )}
      </section>

      <section style={{ ...sectionStyle, marginTop: 24 }}>
        <h2 style={sectionTitleStyle}>MaxDash API</h2>
        <p style={hintStyle}>
          Токен используется для получения рейтинга каналов MAX на странице «Конкуренты MAX».
          Сам токен не возвращается обратно после сохранения — только статус «настроен».
        </p>

        {maxdashConfigured ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{
                display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
                background: '#16a34a',
              }} />
              <span style={{ fontSize: 14, fontWeight: 500 }}>Токен настроен</span>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={checkMaxdashToken}
                disabled={maxdashChecking}
                style={{ minWidth: 120 }}
              >
                {maxdashChecking ? 'Проверка…' : 'Проверить'}
              </button>
              <button
                type="button"
                onClick={deleteMaxdashToken}
                disabled={maxdashSaving}
                style={{
                  minWidth: 140,
                  background: 'transparent',
                  border: '1px solid #dc2626',
                  color: '#dc2626',
                }}
              >
                Удалить токен
              </button>
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', gap: 8, alignItems: 'stretch', flexWrap: 'wrap' }}>
            <input
              type="password"
              autoComplete="off"
              placeholder="Токен MaxDash"
              value={maxdashInput}
              onChange={e => setMaxdashInput(e.target.value)}
              style={{ flex: '1 1 280px', minWidth: 200 }}
            />
            <button
              type="button"
              onClick={saveMaxdashToken}
              disabled={maxdashSaving || !maxdashInput.trim()}
              style={{ minWidth: 120 }}
            >
              {maxdashSaving ? 'Сохранение…' : 'Сохранить'}
            </button>
          </div>
        )}
      </section>

      <section style={{ ...sectionStyle, marginTop: 24 }}>
        <h2 style={sectionTitleStyle}>Telegram бот расходов</h2>
        <p style={hintStyle}>
          API ключ позволяет Telegram-боту создавать расходы в CRM от имени
          пользователя, привязанного по <code>telegram_username</code>.
          Ключ показывается ровно один раз — при генерации.
        </p>

        {botKeyConfigured ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{
                display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
                background: '#16a34a',
              }} />
              <span style={{ fontSize: 14, fontWeight: 500 }}>API ключ настроен</span>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={handleRegenerateBotKey}
                disabled={isGeneratingBotKey}
                style={{ minWidth: 160 }}
              >
                {isGeneratingBotKey ? 'Генерируем…' : 'Пересгенерировать'}
              </button>
              <button
                type="button"
                onClick={handleDeleteBotKey}
                disabled={isDeletingBotKey}
                style={{
                  minWidth: 140,
                  background: 'transparent',
                  border: '1px solid #dc2626',
                  color: '#dc2626',
                }}
              >
                {isDeletingBotKey ? 'Удаление…' : 'Удалить ключ'}
              </button>
            </div>
          </>
        ) : (
          <button
            type="button"
            onClick={generateBotKey}
            disabled={isGeneratingBotKey}
            style={{ minWidth: 200 }}
          >
            {isGeneratingBotKey ? 'Генерируем…' : 'Сгенерировать API ключ'}
          </button>
        )}
      </section>

      <section style={{ ...sectionStyle, marginTop: 24 }}>
        <h2 style={sectionTitleStyle}>Резервные копии</h2>
        <p style={hintStyle}>
          Ежедневно в 03:00 МСК backend снимает дамп PostgreSQL, gzip и
          шлёт файл в Telegram-чат через тот же бот, что и дейли отчёт.
          Локальные копии старше {backup?.keep_days ?? 30} дней удаляются.
        </p>

        {backup ? (
          <>
            <div style={readOnlyRowStyle}>
              <span style={readOnlyLabelStyle}>Автобэкап</span>
              <span style={readOnlyValueStyle}>
                {backup.enabled
                  ? <span style={{ color: '#16a34a' }}>активен — {backup.schedule}</span>
                  : <span style={{ color: '#8C7B6E' }}>выключен (BACKUP_ENABLED=false)</span>}
              </span>
            </div>
            <div style={readOnlyRowStyle}>
              <span style={readOnlyLabelStyle}>Chat ID</span>
              <span style={readOnlyValueStyle}>
                {backup.chat_id_set
                  ? <code>{backup.chat_id_masked}</code>
                  : <span style={{ color: '#dc2626' }}>не задан</span>}
              </span>
            </div>

            <label style={{ ...labelStyle, marginTop: 16 }}>
              Chat ID для бэкапов
              <div style={{ display: 'flex', gap: 8, alignItems: 'stretch', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  placeholder="-100xxxxxxxxxx"
                  value={backupChatIdInput}
                  onChange={e => setBackupChatIdInput(e.target.value)}
                  style={{ flex: '1 1 240px', minWidth: 200 }}
                />
                <button
                  type="button"
                  onClick={saveBackupChatId}
                  disabled={backupSaving}
                  style={{ minWidth: 120 }}
                >
                  {backupSaving ? 'Сохранение…' : 'Сохранить'}
                </button>
              </div>
              <span style={{ fontSize: 12, color: '#8C7B6E', marginTop: 4 }}>
                Узнать ID: добавить бота в чат, написать любое сообщение,
                открыть https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates,
                найти <code>"chat":&#123;"id": ...&#125;</code>.
              </span>
            </label>

            <div style={{ marginTop: 14 }}>
              <button
                type="button"
                onClick={runBackupNow}
                disabled={backupRunning || !backup.chat_id_set}
                style={{ minWidth: 200 }}
              >
                {backupRunning ? 'Создаём бэкап…' : 'Создать бэкап сейчас'}
              </button>
              {!backup.chat_id_set && (
                <span style={{ fontSize: 12, color: '#8C7B6E', marginLeft: 10 }}>
                  Сначала задайте Chat ID
                </span>
              )}
            </div>
          </>
        ) : (
          <div style={{ fontSize: 13, color: '#8C7B6E' }}>Загрузка…</div>
        )}
      </section>

      {showKeyModal && generatedKey && (
        <Modal
          title="🔑 API ключ сгенерирован"
          onClose={() => { setShowKeyModal(false); setGeneratedKey(null) }}
        >
          <div style={alertWarningStyle}>
            ⚠️ Сохраните ключ — он показывается только один раз.
            После закрытия этого окна ключ нельзя будет восстановить.
          </div>

          <div style={keyDisplayStyle}>
            <code style={keyCodeStyle}>{generatedKey}</code>
            <button type="button" onClick={copyGeneratedKey} style={copyBtnStyle}>
              Скопировать
            </button>
          </div>

          <div style={{ marginTop: 12 }}>
            <p style={{ margin: '0 0 6px', fontSize: 13, color: '#2C2B28' }}>
              Добавьте ключ в файл <code>/root/crm-bot/.env</code>:
            </p>
            <pre style={keyEnvBlockStyle}>BOT_API_KEY={generatedKey}</pre>
          </div>

          <div className="modal-footer" style={{ marginTop: 16 }}>
            <button
              type="button"
              onClick={() => { setShowKeyModal(false); setGeneratedKey(null) }}
            >
              Закрыл, ключ сохранён
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

const sectionStyle: CSSProperties = {
  background: '#FEFEFE',
  border: '1px solid #E8DDD3',
  borderRadius: 8,
  padding: '20px 24px',
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
}

const sectionTitleStyle: CSSProperties = {
  margin: '0 0 6px',
  fontSize: 15,
  fontWeight: 600,
  color: '#2C2B28',
}

const hintStyle: CSSProperties = {
  margin: '0 0 16px',
  fontSize: 13,
  color: '#8C7B6E',
}

const labelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontSize: 13,
  fontWeight: 500,
  color: '#2C2B28',
}

const readOnlyRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '8px 0',
  borderTop: '1px solid #F0E8DE',
  fontSize: 13,
}

const readOnlyLabelStyle: CSSProperties = {
  color: '#8C7B6E',
}

const readOnlyValueStyle: CSSProperties = {
  color: '#2C2B28',
  fontWeight: 500,
}

const savedBadgeStyle: CSSProperties = {
  position: 'absolute',
  right: 10,
  top: '50%',
  transform: 'translateY(-50%)',
  fontSize: 11,
  fontWeight: 600,
  color: '#16a34a',
  background: '#16a34a12',
  border: '1px solid #16a34a33',
  borderRadius: 10,
  padding: '2px 8px',
  pointerEvents: 'none',
}

const alertWarningStyle: CSSProperties = {
  background: '#fff3cd',
  border: '1px solid #ffc107',
  borderRadius: 6,
  padding: '10px 14px',
  color: '#856404',
  fontSize: 14,
  marginBottom: 12,
}

const keyDisplayStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  background: '#f5f5f5',
  border: '1px solid #ddd',
  borderRadius: 8,
  padding: '12px 16px',
  margin: '12px 0',
}

const keyCodeStyle: CSSProperties = {
  fontFamily: 'monospace',
  fontSize: 13,
  wordBreak: 'break-all',
  flex: 1,
}

const copyBtnStyle: CSSProperties = {
  flexShrink: 0,
  fontSize: 13,
  padding: '6px 12px',
}

const keyEnvBlockStyle: CSSProperties = {
  margin: 0,
  background: '#1e1e1e',
  color: '#d4d4d4',
  padding: 12,
  borderRadius: 6,
  fontSize: 13,
  overflowX: 'auto',
  fontFamily: 'monospace',
  wordBreak: 'break-all',
  whiteSpace: 'pre-wrap',
}
