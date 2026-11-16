import { createHash } from 'node:crypto'
import { Server } from 'socket.io'
import { z } from 'zod'
import { db } from './database.mjs'
import { readSessionUser } from './auth.mjs'
import { chatMessageSchema, chatRideIdSchema, createRideChatMessage, getRideChatAccess, markRideChatDelivered } from './chat.mjs'

const activeStatuses = ['accepted', 'driver_arriving', 'driver_arrived', 'in_progress']

export const rooms = {
  onlineDrivers: 'drivers:online',
  user: userId => `user:${userId}`,
  ride: rideId => `ride:${rideId}`,
  chat: rideId => `chat:${rideId}`,
  share: tokenHash => `share:${tokenHash}`,
}

export const hashShareToken = token => createHash('sha256').update(token).digest('hex')

export async function activeShare(token) {
  const tokenHash = hashShareToken(token)
  const link = await db.prepare(`SELECT share.ride_id, share.rider_id, share.expires_at, rides.status
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

  io.use(async (socket, next) => {
    try {
      const shareToken = socket.handshake.auth?.shareToken
      if (typeof shareToken === 'string') {
        if (shareToken.length < 40 || shareToken.length > 100) return next(new Error('Shared trip link is invalid.'))
        const share = await activeShare(shareToken)
        if (share) {
          socket.data.share = share
          return next()
        }
        return next(new Error('Shared trip link has expired or was revoked.'))
      }
      const user = await readSessionUser({ headers: socket.handshake.headers })
      if (!user) return next(new Error('Authentication required.'))
      socket.data.user = user
      return next()
    } catch (error) {
      next(error)
    }
  })

  io.on('connection', socket => {
    void (async () => {
    const share = socket.data.share
    if (share) {
      socket.join(rooms.ride(share.ride_id))
      socket.join(rooms.share(share.tokenHash))
      return
    }

    const user = socket.data.user
    socket.join(rooms.user(user.id))

    socket.on('chat:join', async (payload, acknowledge) => {
      const reply = typeof acknowledge === 'function' ? acknowledge : () => undefined
      if (!socket.data.user) return reply({ ok: false, error: 'Authentication required.' })
      const parsed = z.object({ rideId: chatRideIdSchema }).strict().safeParse(payload)
      if (!parsed.success) return reply({ ok: false, error: 'Invalid ride chat.' })
      try {
        const { canSend } = await getRideChatAccess(parsed.data.rideId, socket.data.user.id)
        socket.join(rooms.chat(parsed.data.rideId))
        const ride = await db.prepare('SELECT rider_id, driver_id FROM rides WHERE id = ?').get(parsed.data.rideId)
        const otherId = socket.data.user.id === ride.rider_id ? ride.driver_id : ride.rider_id
        const otherSockets = await io.in(rooms.user(otherId)).fetchSockets()
        reply({ ok: true, canSend, otherOnline: otherSockets.length > 0 })
      } catch (error) {
        reply({ ok: false, error: error instanceof Error ? error.message : 'You cannot access this chat.' })
      }
    })

    socket.on('chat:leave', payload => {
      const parsed = z.object({ rideId: chatRideIdSchema }).strict().safeParse(payload)
      if (parsed.success) socket.leave(rooms.chat(parsed.data.rideId))
    })

    socket.on('chat:send', async (payload, acknowledge) => {
      const reply = typeof acknowledge === 'function' ? acknowledge : () => undefined
      if (!socket.data.user) return reply({ ok: false, error: 'Authentication required.' })
      const parsed = chatMessageSchema.safeParse(payload)
      if (!parsed.success) return reply({ ok: false, error: parsed.error.issues[0]?.message || 'Message is invalid.' })

      const now = Date.now()
      const recent = (socket.data.chatSentAt || []).filter(sentAt => now - sentAt < 60_000)
      if (recent.length >= 30) return reply({ ok: false, error: 'You are sending messages too quickly. Please wait a moment.' })
      socket.data.chatSentAt = [...recent, now]

      try {
        const { message, recipientId } = await createRideChatMessage(parsed.data, socket.data.user.id)
        io.to(rooms.user(recipientId)).emit('chat:message', message)
        reply({ ok: true, message })
      } catch (error) {
        reply({ ok: false, error: error instanceof Error ? error.message : 'Message could not be sent.' })
      }
    })

    socket.on('chat:delivered', async payload => {
      if (!socket.data.user) return
      const parsed = z.object({ rideId: chatRideIdSchema, messageId: z.string().uuid() }).strict().safeParse(payload)
      if (!parsed.success) return
      try {
        const result = await markRideChatDelivered(parsed.data.rideId, parsed.data.messageId, socket.data.user.id)
        if (result) io.to(rooms.user(result.message.senderId)).emit('chat:receipt', {
          rideId: parsed.data.rideId,
          messageIds: [parsed.data.messageId],
          deliveredAt: result.deliveredAt,
        })
      } catch { /* A message receipt is best-effort; history remains persisted. */ }
    })

    socket.on('chat:typing', async payload => {
      if (!socket.data.user) return
      const parsed = z.object({ rideId: chatRideIdSchema, typing: z.boolean() }).strict().safeParse(payload)
      if (!parsed.success) return
      const now = Date.now()
      const recent = (socket.data.chatTypingAt || []).filter(sentAt => now - sentAt < 5_000)
      if (recent.length >= 25) return
      socket.data.chatTypingAt = [...recent, now]
      try {
        const access = await getRideChatAccess(parsed.data.rideId, socket.data.user.id)
        if (!access.canSend) return
        io.to(rooms.user(access.recipientId)).emit('chat:typing', {
          rideId: parsed.data.rideId,
          userId: socket.data.user.id,
          typing: parsed.data.typing,
        })
      } catch { /* Ignore typing signals for rides the socket cannot access. */ }
    })

    socket.on('disconnect', async () => {
      const remainingSockets = await io.in(rooms.user(user.id)).fetchSockets()
      if (remainingSockets.length) return
      const activeRideRows = user.role === 'rider'
        ? await db.prepare("SELECT id, rider_id, driver_id FROM rides WHERE rider_id = ? AND status IN ('accepted', 'driver_arriving', 'driver_arrived', 'in_progress')").all(user.id)
        : await db.prepare("SELECT id, rider_id, driver_id FROM rides WHERE driver_id = ? AND status IN ('accepted', 'driver_arriving', 'driver_arrived', 'in_progress')").all(user.id)
      for (const ride of activeRideRows) {
        const otherId = user.id === ride.rider_id ? ride.driver_id : ride.rider_id
        io.to(rooms.user(otherId)).emit('chat:presence', { rideId: ride.id, userId: user.id, online: false })
      }
    })

    const activeRideRows = user.role === 'rider'
      ? await db.prepare("SELECT id, rider_id, driver_id FROM rides WHERE rider_id = ? AND status IN ('accepted', 'driver_arriving', 'driver_arrived', 'in_progress')").all(user.id)
      : await db.prepare("SELECT id, rider_id, driver_id FROM rides WHERE driver_id = ? AND status IN ('accepted', 'driver_arriving', 'driver_arrived', 'in_progress')").all(user.id)
    if (socket.connected) {
      for (const ride of activeRideRows) {
        socket.join(rooms.ride(ride.id))
        const otherId = user.id === ride.rider_id ? ride.driver_id : ride.rider_id
        io.to(rooms.user(otherId)).emit('chat:presence', { rideId: ride.id, userId: user.id, online: true })
      }
      if (user.role === 'driver') {
        const status = await db.prepare('SELECT is_online, updated_at FROM driver_locations WHERE driver_id = ?').get(user.id)
        if (status?.is_online && status.updated_at > Date.now() - 45_000) socket.join(rooms.onlineDrivers)
      }
    }
    })().catch(error => {
      console.error('Socket connection setup failed:', error.message)
      socket.disconnect(true)
    })
  })

  return io
}
