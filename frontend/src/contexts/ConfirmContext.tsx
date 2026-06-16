import { createContext, useContext, useState, useCallback, useRef, ReactNode, CSSProperties } from 'react'

interface ConfirmOptions {
  message: string
  confirmLabel?: string
}

type Resolver = (value: boolean) => void

interface ConfirmContextValue {
  confirm: (options: ConfirmOptions | string) => Promise<boolean>
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [confirmLabel, setConfirmLabel] = useState('Удалить')
  const resolverRef = useRef<Resolver | null>(null)

  const confirm = useCallback((options: ConfirmOptions | string): Promise<boolean> => {
    const msg = typeof options === 'string' ? options : options.message
    const label = typeof options === 'string' ? 'Удалить' : (options.confirmLabel ?? 'Удалить')
    setMessage(msg)
    setConfirmLabel(label)
    setOpen(true)
    return new Promise<boolean>(resolve => {
      resolverRef.current = resolve
    })
  }, [])

  function handleConfirm() {
    setOpen(false)
    resolverRef.current?.(true)
  }

  function handleCancel() {
    setOpen(false)
    resolverRef.current?.(false)
  }

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {open && (
        <div style={overlayStyle} onClick={handleCancel}>
          <div style={modalStyle} onClick={e => e.stopPropagation()}>
            <p style={messageStyle}>{message}</p>
            <div style={actionsStyle}>
              <button onClick={handleCancel} style={cancelBtnStyle}>Отмена</button>
              <button onClick={handleConfirm} style={confirmBtnStyle}>{confirmLabel}</button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): (options: ConfirmOptions | string) => Promise<boolean> {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider')
  return ctx.confirm
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(44,43,40,0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 200,
}

const modalStyle: CSSProperties = {
  background: '#FEFEFE',
  borderRadius: 10,
  padding: '28px 28px 24px',
  width: 360,
  boxShadow: '0 8px 40px rgba(44,43,40,0.18)',
}

const messageStyle: CSSProperties = {
  margin: '0 0 24px',
  fontSize: 15,
  color: '#2C2B28',
  lineHeight: 1.5,
}

const actionsStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  justifyContent: 'flex-end',
}

const cancelBtnStyle: CSSProperties = {
  background: 'transparent',
  border: '1px solid #E8DDD3',
  color: '#8C7B6E',
}

const confirmBtnStyle: CSSProperties = {
  background: '#dc2626',
  border: '1px solid #dc2626',
  color: '#fff',
  boxShadow: 'none',
}
