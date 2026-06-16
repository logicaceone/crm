import { createContext, useContext, useState, useCallback, CSSProperties, ReactNode } from 'react'

type ToastType = 'success' | 'error'

interface ToastItem {
  id: number
  message: string
  type: ToastType
}

interface ToastContextValue {
  success: (message: string) => void
  error: (message: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

let _nextId = 1

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const add = useCallback((message: string, type: ToastType) => {
    const id = _nextId++
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 3500)
  }, [])

  const success = useCallback((message: string) => add(message, 'success'), [add])
  const error = useCallback((message: string) => add(message, 'error'), [add])

  return (
    <ToastContext.Provider value={{ success, error }}>
      {children}
      <div style={containerStyle}>
        {toasts.map(t => (
          <div key={t.id} style={{ ...toastStyle, ...(t.type === 'success' ? successStyle : errorStyle) }}>
            <span style={iconStyle}>{t.type === 'success' ? '✓' : '✕'}</span>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

const containerStyle: CSSProperties = {
  position: 'fixed',
  bottom: 24,
  right: 24,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  zIndex: 9999,
  pointerEvents: 'none',
}

const toastStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '12px 18px',
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 500,
  boxShadow: '0 4px 20px rgba(44,43,40,0.18)',
  animation: 'slideIn 0.2s ease',
  maxWidth: 360,
}

const successStyle: CSSProperties = {
  background: '#16a34a',
  color: '#fff',
}

const errorStyle: CSSProperties = {
  background: '#dc2626',
  color: '#fff',
}

const iconStyle: CSSProperties = {
  fontWeight: 700,
  fontSize: 15,
  flexShrink: 0,
}
