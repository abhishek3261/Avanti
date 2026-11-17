import { io, type Socket } from 'socket.io-client'
import { apiBaseUrl } from './api'

let socket: Socket | null = null
let shareToken: string | null = null

function ensureSocket(): Socket {
  socket ??= io(apiBaseUrl || window.location.origin, { autoConnect: false, withCredentials: true })
  return socket
}

/** Return the session socket without connecting so consumers can attach listeners first. */
export function getSessionRealtimeSocket(): Socket {
  const active = ensureSocket()
  if (shareToken) {
    active.disconnect()
    active.auth = {}
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
