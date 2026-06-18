import { ReactNode, useEffect, CSSProperties } from 'react'

interface ModalProps {
  title: string
  badge?: string
  badgeStyle?: CSSProperties
  onClose: () => void
  onBack?: () => void
  children: ReactNode
}

export function Modal({ title, badge, badgeStyle, onClose, onBack, children }: ModalProps) {
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.body.classList.add('modal-open')
    return () => {
      document.body.style.overflow = prev
      document.body.classList.remove('modal-open')
    }
  }, [])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-drag-handle-bar" />
        <div className="modal-header-row">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
            {onBack && (
              <button type="button" onClick={onBack} style={backBtnStyle}>←</button>
            )}
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{title}</h2>
            {badge && (
              <span style={{ ...badgeBaseStyle, ...badgeStyle }}>{badge}</span>
            )}
          </div>
          <button type="button" onClick={onClose} style={closeBtnStyle}>×</button>
        </div>
        <div className="modal-form-body">
          {children}
        </div>
      </div>
    </div>
  )
}

const backBtnStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  fontSize: 20,
  cursor: 'pointer',
  lineHeight: 1,
  padding: '0 2px 0 0',
  color: '#8C7B6E',
  flexShrink: 0,
}

const closeBtnStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  fontSize: 22,
  cursor: 'pointer',
  lineHeight: 1,
  padding: 0,
  color: '#8C7B6E',
  flexShrink: 0,
}

const badgeBaseStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  padding: '3px 9px',
  borderRadius: 20,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  flexShrink: 0,
}
