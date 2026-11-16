import assert from 'node:assert/strict'
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import 'dotenv/config'
import { after, test } from 'node:test'
import { io as connectSocket } from 'socket.io-client'

const testDatabaseUrl = process.env.TEST_DATABASE_URL

test('ride chat authorizes participants, persists messages, receipts, retries, and read-only completion', {
  skip: !testDatabaseUrl && 'Set TEST_DATABASE_URL to an isolated PostgreSQL test database.',
}, async () => {
  const { default: pg } = await import('pg')
  const admin = new pg.Pool({ connectionString: testDatabaseUrl, max: 2 })
  const schema = `avanti_chat_test_${randomBytes(6).toString('hex')}`
  await admin.query(`CREATE SCHEMA ${schema}`)
  process.env.DATABASE_URL = testDatabaseUrl
  process.env.DATABASE_SCHEMA = schema
  process.env.SESSION_SECRET = 'test-chat-session-secret-that-is-long-enough'

  const { db, initializeDatabase } = await import('./database.mjs')
  const chat = await import('./chat.mjs')
  const { createRealtimeServer } = await import('./realtime.mjs')
  await initializeDatabase()

  const addUser = async (role, suffix = randomUUID()) => {
    const user = { id: randomUUID(), email: `${suffix}@test.invalid`, name: role, phone: null, role, createdAt: new Date().toISOString() }
    await db.prepare(`INSERT INTO users (id, email, name, phone, role, password_hash, google_sub, created_at)
      VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)`).run(user.id, user.email, user.name, user.phone, user.role, user.createdAt)
    return user
  }
  const addRide = async (rider, driver, status = 'accepted') => {
    const now = new Date().toISOString()
    const ride = { id: randomUUID(), riderId: rider.id, driverId: driver?.id || null, status, now }
    await db.prepare(`INSERT INTO rides
      (id, rider_id, driver_id, pickup, destination, vehicle, status, created_at, updated_at, accepted_at)
      VALUES (?, ?, ?, 'Pickup', 'Destination', 'Mini', ?, ?, ?, ?)`)
      .run(ride.id, ride.riderId, ride.driverId, status, now, now, status === 'requested' ? null : now)
    return ride
  }
  const createSession = async userId => {
    const token = randomBytes(32).toString('base64url')
    const tokenHash = createHmac('sha256', process.env.SESSION_SECRET).update(token).digest('hex')
    await db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .run(tokenHash, userId, Date.now() + 60_000, new Date().toISOString())
    return token
  }
  const connectAuthenticated = (port, token) => {
    const socket = connectSocket(`http://127.0.0.1:${port}`, {
      autoConnect: false,
      extraHeaders: { Cookie: `avanti_session=${token}` },
      reconnection: false,
    })
    return new Promise((resolve, reject) => {
      socket.once('connect', () => resolve(socket))
      socket.once('connect_error', reject)
      socket.connect()
    })
  }
  const emitWithAck = (socket, event, payload) => new Promise(resolve => socket.emit(event, payload, resolve))

  const rider = await addUser('rider')
  const driver = await addUser('driver')
  const outsider = await addUser('rider')
  const ride = await addRide(rider, driver)
  const notAccepted = await addRide(rider, null, 'requested')

  await assert.rejects(chat.getRideChat(notAccepted.id, rider.id), error => error.status === 409)
  await assert.rejects(chat.getRideChat(ride.id, outsider.id), error => error.status === 403)

  const httpServer = createServer()
  const io = createRealtimeServer(httpServer, new Set(['http://127.0.0.1']))
  await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve))
  const port = httpServer.address().port
  let riderSocket
  let driverSocket
  let outsiderSocket
  try {
    riderSocket = await connectAuthenticated(port, await createSession(rider.id))
    driverSocket = await connectAuthenticated(port, await createSession(driver.id))
    outsiderSocket = await connectAuthenticated(port, await createSession(outsider.id))

    const riderJoin = await emitWithAck(riderSocket, 'chat:join', { rideId: ride.id })
    assert.equal(riderJoin.ok, true)
    assert.equal(riderJoin.otherOnline, true)
    assert.equal((await emitWithAck(driverSocket, 'chat:join', { rideId: ride.id })).ok, true)
    const unauthorized = await emitWithAck(outsiderSocket, 'chat:join', { rideId: ride.id })
    assert.equal(unauthorized.ok, false)

    const typingSignal = new Promise(resolve => driverSocket.once('chat:typing', resolve))
    riderSocket.emit('chat:typing', { rideId: ride.id, typing: true })
    const typing = await typingSignal
    assert.equal(typing.userId, rider.id)
    assert.equal(typing.typing, true)

    const incoming = new Promise(resolve => driverSocket.once('chat:message', resolve))
    const payload = chat.chatMessageSchema.parse({ rideId: ride.id, clientMessageId: randomUUID(), body: '  Hello\u0000 driver  ' })
    const sent = await emitWithAck(riderSocket, 'chat:send', payload)
    assert.equal(sent.ok, true)
    assert.equal(sent.message.body, 'Hello driver')
    const received = await incoming
    assert.equal(received.id, sent.message.id)

    const retry = await chat.createRideChatMessage(payload, rider.id)
    assert.equal(retry.message.id, sent.message.id)
    const unreadBeforeRead = await chat.getRideChat(ride.id, driver.id)
    assert.equal(unreadBeforeRead.unreadCount, 1)

    const receipt = new Promise(resolve => riderSocket.once('chat:receipt', resolve))
    driverSocket.emit('chat:delivered', { rideId: ride.id, messageId: sent.message.id })
    const deliveredReceipt = await receipt
    assert.deepEqual(deliveredReceipt.messageIds, [sent.message.id])
    assert.ok(deliveredReceipt.deliveredAt)

    const read = await chat.markRideChatRead(ride.id, driver.id)
    assert.deepEqual(read.messageIds, [sent.message.id])
    assert.ok(read.readAt)
    assert.equal((await chat.getRideChat(ride.id, driver.id)).unreadCount, 0)

    const offlinePresence = new Promise(resolve => riderSocket.once('chat:presence', resolve))
    driverSocket.disconnect()
    assert.equal((await offlinePresence).online, false)
    driverSocket = null

    const endedAt = new Date().toISOString()
    await db.prepare("UPDATE rides SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?").run(endedAt, endedAt, ride.id)
    assert.equal((await chat.getRideChat(ride.id, rider.id)).canSend, false)
    await assert.rejects(chat.createRideChatMessage({ ...payload, clientMessageId: randomUUID() }, rider.id), error => error.status === 409)
  } finally {
    riderSocket?.disconnect()
    driverSocket?.disconnect()
    outsiderSocket?.disconnect()
    await new Promise(resolve => io.close(resolve))
    await db.close()
    await admin.query(`DROP SCHEMA ${schema} CASCADE`)
    await admin.end()
  }
})
