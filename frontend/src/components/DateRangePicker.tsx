import { CSSProperties } from 'react'

interface DateRangePickerProps {
  dateFrom: string
  dateTo: string
  onChange: (dateFrom: string, dateTo: string) => void
  onError?: (error: string | null) => void
  error?: string | null
}

/**
 * Two `<input type="date">` fields rendered side-by-side with an
 * inline "С" / "По" prefix instead of column labels above. Lets the
 * filter row stay a single 36px-tall strip aligned with the other
 * selects/inputs around it.
 *
 * The browser handles the visible date placeholder ("дд.мм.гггг" or
 * the locale equivalent) — we just keep the prefix label visible to
 * say which input is "from" and which is "to".
 */
export function DateRangePicker({ dateFrom, dateTo, onChange, onError, error }: DateRangePickerProps) {
  const today = new Date().toISOString().slice(0, 10)

  function handleFrom(raw: string) {
    if (!raw) { onChange('', dateTo); onError?.(null); return }
    const to = dateTo || today
    if (raw > to) {
      onError?.('Начало позже конца')
      return
    }
    onError?.(null)
    onChange(raw, to)
  }

  function handleTo(raw: string) {
    if (!raw) { onChange(dateFrom, ''); onError?.(null); return }
    const clampedTo = raw > today ? today : raw
    const from = dateFrom || today
    if (from > clampedTo) {
      onError?.('Начало позже конца')
      return
    }
    onError?.(null)
    onChange(from, clampedTo)
  }

  return (
    <div style={wrapStyle} className="date-range-picker">
      <div style={fieldStyle} className="dp-field">
        <span style={prefixStyle}>С</span>
        <input
          type="date"
          aria-label="Дата с"
          value={dateFrom}
          max={today}
          onChange={e => handleFrom(e.target.value)}
          style={inputStyle}
        />
      </div>
      <div style={fieldStyle} className="dp-field">
        <span style={prefixStyle}>По</span>
        <input
          type="date"
          aria-label="Дата по"
          value={dateTo}
          max={today}
          onChange={e => handleTo(e.target.value)}
          style={inputStyle}
        />
      </div>
      {error && <span style={errorStyle}>{error}</span>}
    </div>
  )
}

const wrapStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
}

const fieldStyle: CSSProperties = {
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'center',
  height: 36,
}

const prefixStyle: CSSProperties = {
  position: 'absolute',
  left: 10,
  fontSize: 12,
  fontWeight: 600,
  color: '#8C7B6E',
  pointerEvents: 'none',
  lineHeight: 1,
}

const inputStyle: CSSProperties = {
  height: 36,
  boxSizing: 'border-box',
  fontSize: 13,
  padding: '0 10px 0 34px',
  border: '1.5px solid #E8DDD3',
  borderRadius: 8,
  background: '#FEFEFE',
  color: '#2C2B28',
  cursor: 'pointer',
  minWidth: 140,
}

const errorStyle: CSSProperties = {
  fontSize: 12,
  color: '#dc2626',
  alignSelf: 'center',
}
