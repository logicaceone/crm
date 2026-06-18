import { CSSProperties } from 'react'

interface DateRangePickerProps {
  dateFrom: string
  dateTo: string
  onChange: (dateFrom: string, dateTo: string) => void
  onError?: (error: string | null) => void
  error?: string | null
}

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
      <label style={labelStyle}>
        <span style={labelTextStyle}>С</span>
        <div style={inputWrapStyle}>
          <span style={iconStyle}>📅</span>
          <input
            type="date"
            value={dateFrom}
            max={today}
            onChange={e => handleFrom(e.target.value)}
            style={inputStyle}
          />
        </div>
      </label>
      <label style={labelStyle}>
        <span style={labelTextStyle}>По</span>
        <div style={inputWrapStyle}>
          <span style={iconStyle}>📅</span>
          <input
            type="date"
            value={dateTo}
            max={today}
            onChange={e => handleTo(e.target.value)}
            style={inputStyle}
          />
        </div>
      </label>
      {error && <span style={errorStyle}>{error}</span>}
    </div>
  )
}

const wrapStyle: CSSProperties = {
  gap: 8,
}

const labelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
}

const labelTextStyle: CSSProperties = {
  fontSize: 12,
  color: '#8C7B6E',
  fontWeight: 500,
  letterSpacing: '0.02em',
}

const inputWrapStyle: CSSProperties = {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
}

const iconStyle: CSSProperties = {
  position: 'absolute',
  left: 8,
  fontSize: 13,
  pointerEvents: 'none',
  lineHeight: 1,
  zIndex: 1,
}

const inputStyle: CSSProperties = {
  fontSize: 13,
  padding: '5px 8px 5px 28px',
  border: '1.5px solid #E8DDD3',
  borderRadius: 8,
  background: '#FEFEFE',
  color: '#2C2B28',
  cursor: 'pointer',
  minWidth: 120,
}

const errorStyle: CSSProperties = {
  fontSize: 12,
  color: '#dc2626',
  alignSelf: 'flex-end',
  paddingBottom: 2,
}
