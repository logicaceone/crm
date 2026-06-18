import { useState, useEffect, FormEvent, CSSProperties } from 'react'
import { useToast } from '../contexts/ToastContext'
import { apiFetch } from '../lib/api'
import { SkeletonCards } from '../components/PageSkeleton'

interface SettingsData {
  telegram_bot_token_set: boolean
  max_api_base_url: string
  max_posts_sample: number
}

export function Settings() {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const [tgTokenSet, setTgTokenSet] = useState(false)
  const [tgToken, setTgToken] = useState('')

  const [maxUrl, setMaxUrl] = useState('')
  const [maxSample, setMaxSample] = useState(20)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const res = await apiFetch('/api/settings')
    if (res.ok) {
      const d: SettingsData = await res.json()
      setTgTokenSet(d.telegram_bot_token_set)
      setMaxUrl(d.max_api_base_url)
      setMaxSample(d.max_posts_sample)
    }
    setLoading(false)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const body: Record<string, unknown> = {
        max_api_base_url: maxUrl,
        max_posts_sample: maxSample,
      }
      // only include token if user typed something
      if (tgToken !== '') body.telegram_bot_token = tgToken

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
      setTgToken('')
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
