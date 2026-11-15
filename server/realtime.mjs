import { createHash } from 'node:crypto'
import { Server } from 'socket.io'
import { db } from './database.mjs'
import { readSessionUser } from './auth.mjs'

const activeStatuses = ['accepted', 'driver_arriving', 'driver_arrived', 'in_progress']

export const rooms = {
  onlineDrivers: 'drivers:online',
  user: userId => `user:${userId}`,
  ride: rideId => `ride:${rideId}`,
  share: tokenHash => `share:${tokenHash}`,
}

export const hashShareToken = token => createHash('sha256').update(token).digest('hex')

export function activeShare(token) {
  const tokenHash = hashShareToken(token)
  const link = db.prepare(`SELECT share.ride_id, share.rider_id, share.expires_at, rides.status
    FROM ride_share_links AS share JOIN rides ON rides.id = share.ride_id
    WHERE share.token_hash = ? AND share.revoked_at IS NULL AND share.expires_at > ?`).get(tokenHash, Date.now())
  if (!link || !activeStatuses.includes(link.status)) return null
  return { ...link, tokenHash }
}

export function createRealtimeServer(httpServer, allowedOrigins) {
  const io = new Server(httpServer, {
    cors: { origin: [...allowedOrigins], credentials: true },
    serveClient: true,
  })

  io.use((socket, next) => {
    const shareToken = socket.handshake.auth?.shareToken
    if (typeof shareToken === 'string') {
      if (shareToken.length < 40 || shareToken.length > 100) return next(new Error('Shared trip link is invalid.'))
      const share = activeShare(shareToken)
      if (share) {
        socket.data.share = share
        return next()
      }
      return next(new Error('Shared trip link has expired or was revoked.'))
    }
    const user = readSessionUser({ headers: socket.handshake.headers })
    if (user) {
      socket.data.user = user
      return next()
    }
    next(new Error('Authentication required.'))
  })

  io.on('connection', socket => {
    const share = socket.data.share
    if (share) {
      socket.join(rooms.ride(share.ride_id))
      socket.join(rooms.share(share.tokenHash))
      return
    }

    const user = socket.data.user
    socket.join(rooms.user(user.id))
    const activeRideIds = user.role === 'rider'
      ? db.prepare("SELECT id FROM rides WHERE rider_id = ? AND status IN ('accepted', 'driver_arriving', 'driver_arrived', 'in_progress')").all(user.id)
      : db.prepare("SELECT id FROM rides WHERE driver_id = ? AND status IN ('accepted', 'driver_arriving', 'driver_arrived', 'in_progress')").all(user.id)
    for (const ride of activeRideIds) socket.join(rooms.ride(ride.id))

    if (user.role === 'driver') {
      const status = db.prepare('SELECT is_online, updated_at FROM driver_locations WHERE driver_id = ?').get(user.id)
      if (status?.is_online && status.updated_at > Date.now() - 45_000) socket.join(rooms.onlineDrivers)
    }
  })

  return io
}
