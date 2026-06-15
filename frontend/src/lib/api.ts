type Handler = () => void
let _on401: Handler | undefined

export function setHandle401(fn: Handler) {
  _on401 = fn
}

export async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  })
  if (response.status === 401) {
    _on401?.()
  }
  return response
}
