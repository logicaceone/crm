import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

export interface KebabAction {
  label: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}

export function KebabMenu({ actions }: { actions: KebabAction[] }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)

  function openMenu() {
    if (!btnRef.current) return
    const rect = btnRef.current.getBoundingClientRect()
    setPos({
      top: rect.bottom + window.scrollY + 4,
      left: rect.right + window.scrollX,
    })
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    function close() { setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('scroll', close, true)
    }
  }, [open])

  const dropdown = open ? createPortal(
    <div
      onMouseDown={e => e.stopPropagation()}
      style={{
        position: 'absolute',
        top: pos.top,
        left: pos.left,
        transform: 'translateX(-100%)',
        background: '#FEFEFE',
        border: '1px solid #E8DDD3',
        borderRadius: 8,
        boxShadow: '0 4px 20px rgba(44,43,40,0.12)',
        minWidth: 154,
        zIndex: 9999,
        padding: '4px 0',
        overflow: 'hidden',
      }}
    >
      {actions.map((action, i) => (
        <button
          key={i}
          onClick={() => { action.onClick(); setOpen(false) }}
          disabled={action.disabled}
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            background: 'transparent',
            border: 'none',
            borderRadius: 0,
            padding: '8px 14px',
            fontSize: 13,
            fontWeight: 500,
            color: action.danger ? '#dc2626' : '#2C2B28',
            cursor: action.disabled ? 'not-allowed' : 'pointer',
            boxShadow: 'none',
            opacity: action.disabled ? 0.5 : 1,
          }}
          onMouseEnter={e => { (e.currentTarget.style.background = action.danger ? '#fff5f5' : '#F5F4F0') }}
          onMouseLeave={e => { (e.currentTarget.style.background = 'transparent') }}
        >
          {action.label}
        </button>
      ))}
    </div>,
    document.body
  ) : null

  return (
    <>
      <button
        ref={btnRef}
        onClick={e => { e.stopPropagation(); open ? setOpen(false) : openMenu() }}
        title="Действия"
        style={{
          background: open ? '#F0E8DE' : 'transparent',
          border: '1px solid #E8DDD3',
          borderRadius: 6,
          padding: '3px 10px',
          cursor: 'pointer',
          fontSize: 18,
          lineHeight: 1,
          color: '#8C7B6E',
          letterSpacing: '0.08em',
          boxShadow: 'none',
          transition: 'background 0.12s',
        }}
      >
        ···
      </button>
      {dropdown}
    </>
  )
}
