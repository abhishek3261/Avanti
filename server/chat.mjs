import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { db } from './database.mjs'

export const chatMessageSchema = z.object({
  rideId: z.string().uuid(),
  clientMessageId: z.string().uuid(),
  body: z.string()
    .transform(value => value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim())
    .pipe(z.string().min(1).max(2_000)),
}).strict()

export const chatRideIdSchema = z.string().uuid()

const activeStatuses = new Set(['accepted', 'driver_arriving', 'driver_arrived', 'in_progress'])
const readableStatuses = new Set([...activeStatuses, 'completed', 'cancelled'])

function chatError(message, status) {
  return Object.assign(new Error(message), { status })
}

export async function getRideChatAccess(rideId, userId) {
  const ride = await db.prepare(`SELECT id, rider_id, driver_id, status, accepted_at
    FROM rides WHERE id = ?`).get(rideId)
  if (!ride) throw chatError('Ride not found.', 404)
  if (!ride.accepted_at || !ride.driver_id || !readableStatuses.has(ride.status)) {
    throw chatError('Chat is available after a driver accepts the ride.', 409)
  }
  if (userId !== ride.rider_id && userId !== ride.driver_id) {
    throw chatError('You are not a participant in this ride chat.', 403)
  }
  return {
    ride,
    recipientId: userId === ride.rider_id ? ride.driver_id : ride.rider_id,
    canSend: activeStatuses.has(ride.status),
  }
}

function publicMessage(row) {
  return {
    id: row.id,
    rideId: row.ride_id,
    senderId: row.sender_id,
    recipientId: row.recipient_id,
    clientMessageId: row.client_message_id,
    body: row.body,
    createdAt: row.created_at,
    deliveredAt: row.delivered_at,
    readAt: row.read_at,
  }
}

export async function getRideChat(rideId, userId) {
  const access = await getRideChatAccess(rideId, userId)
  const rows = (await db.prepare(`SELECT * FROM ride_messages WHERE ride_id = ?
    ORDER BY created_at DESC, id DESC LIMIT 100`).all(rideId)).reverse()
  const unreadCount = (await db.prepare(`SELECT COUNT(*) AS count FROM ride_messages
    WHERE ride_id = ? AND recipient_id = ? AND read_at IS NULL`).get(rideId, userId)).count
  return { messages: rows.map(publicMessage), unreadCount, canSend: access.canSend }
}

export async function createRideChatMessage(input, userId) {
  const access = await getRideChatAccess(input.rideId, userId)
  if (!access.canSend) throw chatError('This ride chat is closed. You can still read its messages.', 409)

  const row = {
    id: randomUUID(),
    rideId: input.rideId,
    senderId: userId,
    recipientId: access.recipientId,
    clientMessageId: input.clientMessageId,
    body: input.body,
    createdAt: new Date().toISOString(),
  }
  const inserted = await db.prepare(`INSERT INTO ride_messages
    (id, ride_id, sender_id, recipient_id, client_message_id, body, created_at)
    VALUES (@id, @rideId, @senderId, @recipientId, @clientMessageId, @body, @createdAt)
    ON CONFLICT (sender_id, client_message_id) DO NOTHING RETURNING *`).get(row)
  if (!inserted) {
    const existing = await db.prepare(`SELECT * FROM ride_messages
      WHERE sender_id = ? AND client_message_id = ?`).get(userId, input.clientMessageId)
    if (existing.ride_id !== input.rideId || existing.body !== input.body) {
      throw chatError('This message ID was already used for a different message.', 409)
    }
    return { message: publicMessage(existing), recipientId: existing.recipient_id }
  }
  return { message: publicMessage({
    id: row.id,
    ride_id: row.rideId,
    sender_id: row.senderId,
    recipient_id: row.recipientId,
    client_message_id: row.clientMessageId,
    body: row.body,
    created_at: row.createdAt,
    delivered_at: null,
    read_at: null,
  }), recipientId: row.recipientId }
}

export async function markRideChatDelivered(rideId, messageId, userId) {
  await getRideChatAccess(rideId, userId)
  const deliveredAt = new Date().toISOString()
  const row = await db.prepare(`UPDATE ride_messages SET delivered_at = COALESCE(delivered_at, ?)
    WHERE id = ? AND ride_id = ? AND recipient_id = ? AND delivered_at IS NULL RETURNING *`).get(deliveredAt, messageId, rideId, userId)
  if (!row) return null
  return { message: publicMessage(row), deliveredAt: row.delivered_at }
}

export async function markRideChatRead(rideId, userId) {
  await getRideChatAccess(rideId, userId)
  const unread = await db.prepare(`SELECT id, sender_id FROM ride_messages
    WHERE ride_id = ? AND recipient_id = ? AND read_at IS NULL`).all(rideId, userId)
  if (!unread.length) return { messageIds: [], senderIds: [], readAt: null }
  const readAt = new Date().toISOString()
  await db.prepare(`UPDATE ride_messages SET delivered_at = COALESCE(delivered_at, ?), read_at = ?
    WHERE ride_id = ? AND recipient_id = ? AND read_at IS NULL`).run(readAt, readAt, rideId, userId)
  return {
    messageIds: unread.map(message => message.id),
    senderIds: [...new Set(unread.map(message => message.sender_id))],
    readAt,
  }
}

