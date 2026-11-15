import { io, type Socket } from 'socket.io-client'

let socket: Socket | null = null
let shareToken: string | null = null

function ensureSocket(): Socket {
  socket ??= io({ autoConnect: false, withCredentials: true })
  return socket
}

export function connectSessionRealtime(): Socket {
  const active = ensureSocket()
  if (shareToken) {
    active.disconnect()
    active.auth = {}
    shareToken = null
  }
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
