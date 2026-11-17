import { io, type Socket } from 'socket.io-client'
import { apiUrl, realtimeBaseUrl } from './api'

let socket: Socket | null = null
let shareToken: string | null = null

function sessionSocketAuth(callback: (auth: Record<string, string>) => void) {
  void fetch(apiUrl('/api/realtime-token'), { credentials: 'include', cache: 'no-store' })
    .then(async response => {
      const result = await response.json().catch(() => ({})) as { token?: string; error?: string }
      if (!response.ok || !result.token) throw new Error(result.error || 'Sign in again to connect live updates.')
      callback({ realtimeTicket: result.token })
    })
    .catch(() => callback({}))
}

function ensureSocket(): Socket {
  socket ??= io(realtimeBaseUrl || window.location.origin, {
    autoConnect: false,
    withCredentials: false,
    auth: sessionSocketAuth,
  })
  return socket
}

/** Return the session socket without connecting so consumers can attach listeners first. */
export function getSessionRealtimeSocket(): Socket {
  const active = ensureSocket()
  if (shareToken) {
    active.disconnect()
    active.auth = sessionSocketAuth
    shareToken = null
  }
  return active
}

export function connectSessionRealtime(): Socket {
  const active = getSessionRealtimeSocket()
  if (!active.connected) active.connect()
  return active
}

export function connectShareRealtime(token: string): Socket {
  const active = ensureSocket()
  if (shareToken !== token) {
    active.disconnect()
    shareToken = token
    active.auth = { shareToken: token }
  }
  if (!active.connected) active.connect()
  return active
}

export function disconnectRealtime() {
  socket?.disconnect()
  socket = null
  shareToken = null
}
