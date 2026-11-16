import 'dotenv/config'
import 'express-async-errors'
import express from 'express'
import helmet from 'helmet'
import { rateLimit } from 'express-rate-limit'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { db, initializeDatabase } from './database.mjs'
import { clearSessionCookie, destroySession, hashPassword, newUserId, publicUser, readSessionUser, setSessionCookie, verifyGoogleCredential, verifyPassword } from './auth.mjs'
import { createRealtimeServer, hashShareToken, rooms } from './realtime.mjs'
import { chatRideIdSchema, getRideChat, markRideChatRead } from './chat.mjs'

const app = express()
const port = Number(process.env.PORT || 4000)
const isProduction = process.env.NODE_ENV === 'production'
const currentDir = fileURLToPath(new URL('.', import.meta.url))
const clientDist = resolve(currentDir, '../dist')
if (isProduction && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
  throw new Error('SESSION_SECRET must be set to a random value of at least 32 characters in production.')
}

app.disable('x-powered-by')
if (process.env.TRUST_PROXY) {
  const trustProxy = process.env.TRUST_PROXY.trim()
  app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy)
}
app.use(helmet(isProduction ? {
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  contentSecurityPolicy: { directives: {
    ...helmet.contentSecurityPolicy.getDefaultDirectives(),
    'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https://accounts.google.com/gsi/client', 'https://*.googleapis.com', 'https://*.gstatic.com', 'https://*.google.com', 'https://*.ggpht.com', 'https://*.googleusercontent.com', 'blob:'],
    'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://accounts.google.com/gsi/style', 'https://*.googleapis.com'],
    'font-src': ["'self'", 'https://fonts.gstatic.com', 'https://*.gstatic.com', 'data:'],
    'img-src': ["'self'", 'https://*.googleapis.com', 'https://*.gstatic.com', 'https://*.google.com', 'https://*.googleusercontent.com', 'data:', 'blob:'],
    'frame-src': ["'self'", 'https://accounts.google.com/gsi/', 'https://*.google.com'],
    'connect-src': ["'self'", 'https://accounts.google.com/gsi/', 'https://*.googleapis.com', 'https://*.gstatic.com', 'https://*.google.com', 'data:', 'blob:'],
    'worker-src': ["'self'", 'blob:'],
  } },
} : { contentSecurityPolicy: false }))
app.use(express.json({ limit: '20kb' }))

const configuredOrigins = (process.env.APP_ORIGIN || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean)
  .map(origin => {
    let parsed
    try { parsed = new URL(origin) } catch { throw new Error('APP_ORIGIN must contain comma-separated web origins, such as https://avanti.vercel.app.') }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new Error('APP_ORIGIN entries must be exact origins without paths, credentials, query strings, or fragments.')
    }
    if (isProduction && parsed.protocol !== 'https:') throw new Error('Production APP_ORIGIN entries must use HTTPS.')
    return parsed.origin
  })
if (isProduction && configuredOrigins.length === 0) {
  throw new Error('APP_ORIGIN is required in production. Set it to the exact HTTPS origin of the deployed frontend.')
}
const allowedOrigins = new Set([
  ...configuredOrigins,
  ...(!isProduction ? ['http://localhost:5173', 'http://127.0.0.1:5173'] : []),
])
const httpServer = createServer(app)
const io = createRealtimeServer(httpServer, allowedOrigins)
const fareConfig = JSON.parse(readFileSync(new URL('../shared/fare-config.json', import.meta.url), 'utf8'))

app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  const origin = req.get('origin')
  if (origin) {
    if (!allowedOrigins.has(origin)) return res.status(403).json({ error: 'Request origin is not allowed.' })
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    res.vary('Origin')
  }
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.setHeader('Access-Control-Max-Age', '600')
    return res.sendStatus(204)
  }
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    if (!origin || !allowedOrigins.has(origin)) return res.status(403).json({ error: 'Request origin is not allowed.' })
  }
  next()
})

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: 'draft-7', legacyHeaders: false })
const locationLimiter = rateLimit({ windowMs: 60_000, limit: 90, standardHeaders: 'draft-7', legacyHeaders: false })
const emailSchema = z.string().trim().email().max(254).transform(value => value.toLowerCase())
const roleSchema = z.enum(['rider', 'driver'])
const registrationSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: emailSchema,
  phone: z.string().trim().min(7).max(30),
  password: z.string().min(10).max(128),
}).strict()
const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(128) }).strict()
const googleSchema = z.object({ credential: z.string().min(20).max(8192), role: roleSchema, mode: z.enum(['login', 'register']) }).strict()
const rideSchema = z.object({
  pickup: z.string().trim().min(2).max(200),
  destination: z.string().trim().min(2).max(200),
  vehicle: z.enum(['Mini', 'Sedan', 'SUV']),
  pickupLat: z.number().finite().min(-90).max(90),
  pickupLng: z.number().finite().min(-180).max(180),
  destinationLat: z.number().finite().min(-90).max(90),
  destinationLng: z.number().finite().min(-180).max(180),
  routeDistanceMeters: z.number().int().positive().max(2_000_000),
  routeDurationSeconds: z.number().int().positive().max(86_400),
}).strict()
const locationSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracyMeters: z.number().finite().min(0).max(10_000).optional(),
  headingDegrees: z.number().finite().min(0).max(360).nullable().optional(),
  speedMetersPerSecond: z.number().finite().min(0).max(120).nullable().optional(),
  recordedAt: z.number().int().positive(),
}).strict()
const driverProfileSchema = z.object({
  vehicleModel: z.string().trim().min(2).max(80),
  vehicleColor: z.string().trim().min(2).max(40),
  vehicleRegistration: z.string().trim().min(4).max(20).regex(/^[A-Za-z0-9 -]+$/).transform(value => value.toUpperCase()),
}).strict()

function parseBody(schema, req, res) {
  const result = schema.safeParse(req.body)
  if (!result.success) {
    res.status(400).json({ error: result.error.issues[0]?.message || 'Check the information and try again.' })
    return null
  }
  return result.data
}

async function requireAuth(req, res, next) {
  const user = await readSessionUser(req)
  if (!user) return res.status(401).json({ error: 'Please sign in to continue.' })
  req.user = user
  next()
}

function requireRole(role) {
  return (req, res, next) => {
    if (req.user.role !== role) return res.status(403).json({ error: 'This account cannot access that portal.' })
    next()
  }
}

async function createSessionResponse(res, user) {
  await setSessionCookie(res, user.id)
  return res.json({ user: publicUser(user) })
}

app.post('/api/auth/:role/register', authLimiter, async (req, res, next) => {
  try {
    const role = roleSchema.safeParse(req.params.role)
    const data = parseBody(registrationSchema, req, res)
    if (!role.success) return res.status(404).json({ error: 'Unknown account role.' })
    if (!data) return
    if (await db.prepare('SELECT id FROM users WHERE email = ?').get(data.email)) {
      return res.status(409).json({ error: 'An account with this email already exists. Try logging in.' })
    }
    const user = { id: newUserId(), email: data.email, name: data.name, phone: data.phone, role: role.data, password_hash: await hashPassword(data.password), google_sub: null, created_at: new Date().toISOString() }
    await db.prepare('INSERT INTO users (id, email, name, phone, role, password_hash, google_sub, created_at) VALUES (@id, @email, @name, @phone, @role, @password_hash, @google_sub, @created_at)').run(user)
    return await createSessionResponse(res, user)
  } catch (error) {
    if (error?.code === '23505') return res.status(409).json({ error: 'An account with this email already exists. Try logging in.' })
    next(error)
  }
})

app.post('/api/auth/:role/login', authLimiter, async (req, res, next) => {
  try {
    const role = roleSchema.safeParse(req.params.role)
    const data = parseBody(loginSchema, req, res)
    if (!role.success) return res.status(404).json({ error: 'Unknown account role.' })
    if (!data) return
    const user = await db.prepare('SELECT * FROM users WHERE email = ? AND role = ?').get(data.email, role.data)
    const valid = await verifyPassword(data.password, user?.password_hash)
    if (!valid) return res.status(401).json({ error: 'Email or password is incorrect for this portal.' })
    return await createSessionResponse(res, user)
  } catch (error) { next(error) }
})

app.post('/api/auth/google', authLimiter, async (req, res, next) => {
  try {
    const data = parseBody(googleSchema, req, res)
    if (!data) return
    const identity = await verifyGoogleCredential(data.credential)
    let user = await db.prepare('SELECT * FROM users WHERE google_sub = ?').get(identity.subject)

    if (user && user.role !== data.role) return res.status(403).json({ error: 'This Google account belongs to the other Avanti portal.' })

    if (!user) {
      user = await db.prepare('SELECT * FROM users WHERE email = ?').get(identity.email)
      if (user && user.role !== data.role) return res.status(403).json({ error: 'This email belongs to the other Avanti portal.' })
      if (user?.google_sub && user.google_sub !== identity.subject) return res.status(409).json({ error: 'This email is already linked to another Google account.' })

      if (!user) {
        user = { id: newUserId(), email: identity.email, name: identity.name, phone: null, role: data.role, password_hash: null, google_sub: identity.subject, created_at: new Date().toISOString() }
        await db.prepare('INSERT INTO users (id, email, name, phone, role, password_hash, google_sub, created_at) VALUES (@id, @email, @name, @phone, @role, @password_hash, @google_sub, @created_at)').run(user)
      } else {
        await db.prepare('UPDATE users SET google_sub = ? WHERE id = ?').run(identity.subject, user.id)
        user = { ...user, google_sub: identity.subject }
      }
    }

    return await createSessionResponse(res, user)
  } catch (error) {
    if (error?.code === '23505') return res.status(409).json({ error: 'This Google account is already linked to another user.' })
    if (error?.status) return res.status(error.status).json({ error: error.message })
    console.error('Google sign-in callback failed:', error?.message || error)
    if (!isProduction) return res.status(500).json({ error: `Google sign-in failed: ${error?.message || 'Unknown server error'}` })
    next(error)
  }
})

app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }))

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  await destroySession(req)
  clearSessionCookie(res)
  res.status(204).end()
})

app.get('/api/rider/account', requireAuth, requireRole('rider'), (req, res) => res.json({ user: publicUser(req.user) }))
app.get('/api/driver/account', requireAuth, requireRole('driver'), (req, res) => res.json({ user: publicUser(req.user) }))

const activeRideStatuses = ['accepted', 'driver_arriving', 'driver_arrived', 'in_progress']
const terminalRideStatuses = ['completed', 'rejected', 'cancelled']

function publicRide(row) {
  if (!row) return null
  const active = activeRideStatuses.includes(row.status)
  return {
    id: row.id,
    pickup: row.pickup,
    destination: row.destination,
    pickupPoint: row.pickup_lat == null ? null : { lat: row.pickup_lat, lng: row.pickup_lng },
    destinationPoint: row.destination_lat == null ? null : { lat: row.destination_lat, lng: row.destination_lng },
    routeDistanceMeters: row.route_distance_meters,
    routeDurationSeconds: row.route_duration_seconds,
    estimatedFarePaise: row.estimated_fare_paise,
    requestExpiresAt: row.request_expires_at,
    vehicle: row.vehicle,
    status: row.status,
    riderName: row.rider_name,
    driver: row.driver_id ? {
      name: row.driver_name,
      phone: row.driver_phone || null,
      vehicleModel: row.vehicle_model || null,
      vehicleColor: row.vehicle_color || null,
      vehicleRegistration: row.vehicle_registration || null,
      rating: row.driver_rating == null ? null : row.driver_rating,
      ratingCount: row.rating_count || 0,
    } : null,
    driverLocation: active && row.latitude != null ? {
      latitude: row.latitude,
      longitude: row.longitude,
      accuracyMeters: row.accuracy_meters,
      headingDegrees: row.heading_degrees,
      recordedAt: row.recorded_at,
      updatedAt: row.location_updated_at,
    } : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    acceptedAt: row.accepted_at,
    driverArrivedAt: row.driver_arrived_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  }
}

const rideSelect = `SELECT rides.*, riders.name AS rider_name,
    drivers.name AS driver_name, drivers.phone AS driver_phone,
    profile.vehicle_model, profile.vehicle_color, profile.vehicle_registration,
    profile.rating AS driver_rating, profile.rating_count,
    location.latitude, location.longitude, location.accuracy_meters,
    location.heading_degrees, location.recorded_at, location.updated_at AS location_updated_at
  FROM rides
  JOIN users AS riders ON riders.id = rides.rider_id
  LEFT JOIN users AS drivers ON drivers.id = rides.driver_id
  LEFT JOIN driver_profiles AS profile ON profile.driver_id = rides.driver_id
  LEFT JOIN driver_locations AS location ON location.driver_id = rides.driver_id`

async function getPublicRide(id) {
  return publicRide(await db.prepare(`${rideSelect} WHERE rides.id = ?`).get(id))
}

function publicSharedTrip(ride) {
  return {
    pickup: ride.pickup,
    destination: ride.destination,
    pickupPoint: ride.pickupPoint,
    destinationPoint: ride.destinationPoint,
    vehicle: ride.vehicle,
    status: ride.status,
    routeDistanceMeters: ride.routeDistanceMeters,
    routeDurationSeconds: ride.routeDurationSeconds,
    updatedAt: ride.updatedAt,
    driver: ride.driver ? {
      name: ride.driver.name,
      vehicleModel: ride.driver.vehicleModel,
      vehicleColor: ride.driver.vehicleColor,
      vehicleRegistration: ride.driver.vehicleRegistration,
      rating: ride.driver.rating,
      ratingCount: ride.driver.ratingCount,
    } : null,
    driverLocation: ride.driverLocation,
  }
}

async function expireRideRequests() {
  const expired = await db.prepare("SELECT id FROM rides WHERE status = 'requested' AND request_expires_at <= ?").all(Date.now())
  if (expired.length) {
    await db.prepare("UPDATE rides SET status = 'rejected', updated_at = ? WHERE status = 'requested' AND request_expires_at <= ?").run(new Date().toISOString(), Date.now())
    for (const item of expired) await emitRideUpdate(await getPublicRide(item.id))
  }
  const staleDrivers = await db.prepare('SELECT driver_id FROM driver_locations WHERE is_online = TRUE AND updated_at < ?').all(Date.now() - 45_000)
  if (staleDrivers.length) {
    await db.prepare('UPDATE driver_locations SET is_online = FALSE WHERE is_online = TRUE AND updated_at < ?').run(Date.now() - 45_000)
    for (const driver of staleDrivers) io.in(rooms.user(driver.driver_id)).socketsLeave(rooms.onlineDrivers)
  }
  const expiredShares = await db.prepare('SELECT token_hash FROM ride_share_links WHERE revoked_at IS NULL AND expires_at <= ?').all(Date.now())
  if (expiredShares.length) {
    await db.prepare('UPDATE ride_share_links SET revoked_at = ? WHERE revoked_at IS NULL AND expires_at <= ?').run(Date.now(), Date.now())
    for (const share of expiredShares) io.in(rooms.share(share.token_hash)).disconnectSockets(true)
  }
}

async function emitRideUpdate(ride) {
  const owners = await db.prepare('SELECT rider_id, driver_id FROM rides WHERE id = ?').get(ride.id)
  if (!owners) return
  io.to(rooms.user(owners.rider_id)).emit('ride:updated', ride)
  io.to(rooms.ride(ride.id)).emit('trip:updated', publicSharedTrip(ride))
  if (owners.driver_id) {
    io.to(rooms.user(owners.driver_id)).emit('ride:updated', ride)
    io.in(rooms.user(owners.rider_id)).socketsJoin(rooms.ride(ride.id))
    io.in(rooms.user(owners.driver_id)).socketsJoin(rooms.ride(ride.id))
  }
  if (terminalRideStatuses.includes(ride.status)) {
    await db.prepare('UPDATE ride_share_links SET revoked_at = ? WHERE ride_id = ? AND revoked_at IS NULL').run(Date.now(), ride.id)
    io.in(rooms.ride(ride.id)).socketsLeave(rooms.ride(ride.id))
    io.to(rooms.chat(ride.id)).emit('chat:ended', { rideId: ride.id, status: ride.status })
    io.in(rooms.chat(ride.id)).socketsLeave(rooms.chat(ride.id))
  }
}

app.get('/api/rides', requireAuth, async (req, res) => {
  await expireRideRequests()
  const rows = req.user.role === 'rider'
    ? await db.prepare(`${rideSelect} WHERE rides.rider_id = ? ORDER BY rides.created_at DESC LIMIT 20`).all(req.user.id)
    : await db.prepare(`${rideSelect} WHERE (rides.status = 'requested' AND EXISTS (SELECT 1 FROM driver_locations WHERE driver_id = ? AND is_online = TRUE AND updated_at > ?)) OR (rides.driver_id = ? AND rides.status IN ('accepted', 'driver_arriving', 'driver_arrived', 'in_progress')) ORDER BY CASE WHEN rides.status = 'requested' THEN 0 ELSE 1 END, rides.created_at DESC LIMIT 50`).all(req.user.id, Date.now() - 45_000, req.user.id)
  res.json({ rides: rows.map(publicRide) })
})

app.get('/api/rides/:id/chat', requireAuth, async (req, res) => {
  const parsed = chatRideIdSchema.safeParse(req.params.id)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid ride ID.' })
  try {
    return res.json(await getRideChat(parsed.data, req.user.id))
  } catch (error) {
    return res.status(error?.status || 500).json({ error: error instanceof Error ? error.message : 'Could not load ride chat.' })
  }
})

app.post('/api/rides/:id/chat/read', requireAuth, async (req, res) => {
  const parsed = chatRideIdSchema.safeParse(req.params.id)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid ride ID.' })
  try {
    const result = await markRideChatRead(parsed.data, req.user.id)
    for (const senderId of result.senderIds) io.to(rooms.user(senderId)).emit('chat:receipt', {
      rideId: parsed.data,
      messageIds: result.messageIds,
      readAt: result.readAt,
    })
    return res.json(result)
  } catch (error) {
    return res.status(error?.status || 500).json({ error: error instanceof Error ? error.message : 'Could not mark chat messages as read.' })
  }
})

function calculateEstimatedFare(vehicle, distanceMeters, durationSeconds) {
  const rate = fareConfig[vehicle]
  const distance = Math.round(distanceMeters / 1000 * rate.perKmRate * 100) / 100
  const time = Math.round(durationSeconds / 60 * rate.perMinuteRate * 100) / 100
  return Math.round(Math.max(rate.minimumFare, rate.baseFare + distance + time + rate.bookingFee)) * 100
}

app.post('/api/rides', requireAuth, requireRole('rider'), async (req, res) => {
  const data = parseBody(rideSchema, req, res)
  if (!data) return
  const now = new Date().toISOString()
  const id = newUserId()
  const farePaise = calculateEstimatedFare(data.vehicle, data.routeDistanceMeters, data.routeDurationSeconds)
  await db.prepare(`INSERT INTO rides
    (id, rider_id, pickup, destination, vehicle, status, pickup_lat, pickup_lng, destination_lat, destination_lng,
      route_distance_meters, route_duration_seconds, estimated_fare_paise, request_expires_at, created_at, updated_at)
    VALUES (@id, @riderId, @pickup, @destination, @vehicle, 'requested', @pickupLat, @pickupLng, @destinationLat,
      @destinationLng, @distance, @duration, @fare, @requestExpiresAt, @now, @now)`)
    .run({ id, riderId: req.user.id, ...data, distance: data.routeDistanceMeters, duration: data.routeDurationSeconds, fare: farePaise, requestExpiresAt: Date.now() + 60_000, now })
  const ride = await getPublicRide(id)
  io.to(rooms.user(req.user.id)).emit('ride:updated', ride)
  io.to(rooms.onlineDrivers).emit('ride:request', ride)
  res.status(201).json({ ride })
})

const transitionByAction = {
  arriving: { from: 'accepted', to: 'driver_arriving', timestamp: null },
  arrived: { from: 'driver_arriving', to: 'driver_arrived', timestamp: 'driver_arrived_at' },
  start: { from: 'driver_arrived', to: 'in_progress', timestamp: 'started_at' },
  complete: { from: 'in_progress', to: 'completed', timestamp: 'completed_at' },
}

app.post('/api/rides/:id/:action', requireAuth, async (req, res) => {
  const { id, action } = req.params
  const current = await db.prepare('SELECT * FROM rides WHERE id = ?').get(id)
  if (!current) return res.status(404).json({ error: 'Ride not found.' })
  if (action === 'accept' || action === 'reject') {
    if (req.user.role !== 'driver') return res.status(403).json({ error: 'Only a driver can accept or reject a request.' })
    if (action === 'accept') {
      const profile = await db.prepare('SELECT vehicle_model, vehicle_color, vehicle_registration FROM driver_profiles WHERE driver_id = ?').get(req.user.id)
      if (!profile?.vehicle_model || !profile.vehicle_color || !profile.vehicle_registration) return res.status(409).json({ error: 'Complete your vehicle profile before accepting rides.' })
      const location = await db.prepare('SELECT is_online, updated_at FROM driver_locations WHERE driver_id = ?').get(req.user.id)
      if (!location?.is_online || location.updated_at < Date.now() - 45_000) return res.status(409).json({ error: 'Go online and enable current location before accepting a ride.' })
      const alreadyDriving = await db.prepare(`SELECT id FROM rides WHERE driver_id = ? AND status IN ('accepted', 'driver_arriving', 'driver_arrived', 'in_progress')`).get(req.user.id)
      if (alreadyDriving) return res.status(409).json({ error: 'Complete your current ride before accepting another request.' })
    }
    const nextStatus = action === 'accept' ? 'accepted' : 'rejected'
    const now = new Date().toISOString()
    let changed
    try {
      changed = action === 'accept'
        ? (await db.prepare("UPDATE rides SET status = 'accepted', driver_id = ?, accepted_at = ?, updated_at = ? WHERE id = ? AND status = 'requested' AND driver_id IS NULL AND request_expires_at > ? RETURNING id").get(req.user.id, now, now, id, Date.now())) != null
        : (await db.prepare("UPDATE rides SET status = 'rejected', updated_at = ? WHERE id = ? AND status = 'requested' AND driver_id IS NULL AND request_expires_at > ? RETURNING id").get(now, id, Date.now())) != null
    } catch (error) {
      if (error?.code === '23505' && action === 'accept') return res.status(409).json({ error: 'Complete your current ride before accepting another request.' })
      throw error
    }
    if (!changed) return res.status(409).json({ error: `This ride is no longer available to ${action}.` })
    const ride = await getPublicRide(id)
    await emitRideUpdate(ride)
    return res.json({ ride })
  }

  if (action === 'cancel') {
    const isRiderOwner = req.user.role === 'rider' && current.rider_id === req.user.id
    const isAssignedDriver = req.user.role === 'driver' && current.driver_id === req.user.id
    if (!isRiderOwner && !isAssignedDriver) return res.status(403).json({ error: 'You cannot cancel this ride.' })
    const cancellable = isRiderOwner
      ? ['requested', 'accepted', 'driver_arriving', 'driver_arrived']
      : ['accepted', 'driver_arriving', 'driver_arrived']
    if (!cancellable.includes(current.status)) return res.status(409).json({ error: 'This ride can no longer be cancelled.' })
    const now = new Date().toISOString()
    const result = await db.prepare(`UPDATE rides SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ? AND status = ?`).run(now, now, id, current.status)
    if (!result.changes) return res.status(409).json({ error: 'Ride status changed. Refresh and try again.' })
  } else if (transitionByAction[action]) {
    if (req.user.role !== 'driver' || current.driver_id !== req.user.id) return res.status(403).json({ error: 'Only the assigned driver can update this ride.' })
    const transition = transitionByAction[action]
    const now = new Date().toISOString()
    const timestampSql = transition.timestamp ? `, ${transition.timestamp} = @now` : ''
    const result = await db.prepare(`UPDATE rides SET status = @next, updated_at = @now${timestampSql} WHERE id = @id AND driver_id = @driverId AND status = @previous`)
      .run({ next: transition.to, now, id, driverId: req.user.id, previous: transition.from })
    if (!result.changes) return res.status(409).json({ error: 'This ride cannot move to that status. Refresh and try again.' })
  } else {
    return res.status(404).json({ error: 'Unknown ride action.' })
  }

  const ride = await getPublicRide(id)
  await emitRideUpdate(ride)
  res.json({ ride })
})

app.get('/api/driver/profile', requireAuth, requireRole('driver'), async (req, res) => {
  const profile = await db.prepare('SELECT vehicle_model AS vehicleModel, vehicle_color AS vehicleColor, vehicle_registration AS vehicleRegistration, rating, rating_count AS ratingCount FROM driver_profiles WHERE driver_id = ?').get(req.user.id) || null
  res.json({ profile })
})

app.put('/api/driver/profile', requireAuth, requireRole('driver'), async (req, res) => {
  const profile = parseBody(driverProfileSchema, req, res)
  if (!profile) return
  const existing = await db.prepare('SELECT driver_id FROM driver_profiles WHERE UPPER(vehicle_registration) = ? AND driver_id != ?').get(profile.vehicleRegistration, req.user.id)
  if (existing) return res.status(409).json({ error: 'That vehicle registration is already connected to another driver profile.' })
  try {
    await db.prepare(`INSERT INTO driver_profiles (driver_id, vehicle_model, vehicle_color, vehicle_registration, updated_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(driver_id) DO UPDATE SET vehicle_model = excluded.vehicle_model,
      vehicle_color = excluded.vehicle_color, vehicle_registration = excluded.vehicle_registration, updated_at = excluded.updated_at`)
      .run(req.user.id, profile.vehicleModel, profile.vehicleColor, profile.vehicleRegistration, new Date().toISOString())
  } catch (error) {
    if (error?.code === '23505') return res.status(409).json({ error: 'That vehicle registration is already connected to another driver profile.' })
    throw error
  }
  res.json({ profile: await db.prepare('SELECT vehicle_model AS vehicleModel, vehicle_color AS vehicleColor, vehicle_registration AS vehicleRegistration, rating, rating_count AS ratingCount FROM driver_profiles WHERE driver_id = ?').get(req.user.id) })
})

function parseLocation(body, res) {
  const location = parseBody(locationSchema, { body }, res)
  if (!location) return null
  const now = Date.now()
  if (location.recordedAt > now + 5_000 || location.recordedAt < now - 90_000) {
    res.status(400).json({ error: 'GPS update timestamp is stale or in the future. Retry with a fresh device location.' })
    return null
  }
  return location
}

function haversineMeters(a, b) {
  const toRadians = degrees => degrees * Math.PI / 180
  const dLat = toRadians(b.latitude - a.latitude)
  const dLng = toRadians(b.longitude - a.longitude)
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLng / 2) ** 2
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))
}

async function storeDriverLocation(driverId, location, online) {
  const previous = await db.prepare('SELECT * FROM driver_locations WHERE driver_id = ?').get(driverId)
  const now = Date.now()
  const nextPoint = { latitude: location.latitude, longitude: location.longitude }
  const movedMeters = previous ? haversineMeters({ latitude: previous.latitude, longitude: previous.longitude }, nextPoint) : Number.POSITIVE_INFINITY
  if (previous && online && movedMeters < 6 && now - previous.updated_at < 7_000) return previous
  await db.prepare(`INSERT INTO driver_locations
    (driver_id, latitude, longitude, accuracy_meters, heading_degrees, speed_meters_per_second, recorded_at, updated_at, is_online)
    VALUES (@driverId, @latitude, @longitude, @accuracy, @heading, @speed, @recordedAt, @updatedAt, @online)
    ON CONFLICT(driver_id) DO UPDATE SET latitude = excluded.latitude, longitude = excluded.longitude,
      accuracy_meters = excluded.accuracy_meters, heading_degrees = excluded.heading_degrees,
      speed_meters_per_second = excluded.speed_meters_per_second, recorded_at = excluded.recorded_at,
      updated_at = excluded.updated_at, is_online = excluded.is_online`)
    .run({ driverId, latitude: location.latitude, longitude: location.longitude, accuracy: location.accuracyMeters ?? null,
      heading: location.headingDegrees ?? null, speed: location.speedMetersPerSecond ?? null,
      recordedAt: location.recordedAt, updatedAt: now, online: Boolean(online) })
  return await db.prepare('SELECT * FROM driver_locations WHERE driver_id = ?').get(driverId)
}

function liveLocationRecord(row) {
  return { latitude: row.latitude, longitude: row.longitude, accuracyMeters: row.accuracy_meters,
    headingDegrees: row.heading_degrees, speedMetersPerSecond: row.speed_meters_per_second,
    recordedAt: row.recorded_at, updatedAt: row.updated_at }
}

app.post('/api/driver/online', locationLimiter, requireAuth, requireRole('driver'), async (req, res) => {
  const location = parseLocation(req.body, res)
  if (!location) return
  const profile = await db.prepare('SELECT vehicle_model, vehicle_color, vehicle_registration FROM driver_profiles WHERE driver_id = ?').get(req.user.id)
  if (!profile?.vehicle_model || !profile.vehicle_color || !profile.vehicle_registration) return res.status(409).json({ error: 'Complete your vehicle profile before going online.' })
  const stored = await storeDriverLocation(req.user.id, location, true)
  io.in(rooms.user(req.user.id)).socketsJoin(rooms.onlineDrivers)
  res.json({ online: true, location: liveLocationRecord(stored) })
})

app.post('/api/driver/offline', requireAuth, requireRole('driver'), async (req, res) => {
  const currentRide = await db.prepare("SELECT id FROM rides WHERE driver_id = ? AND status IN ('accepted', 'driver_arriving', 'driver_arrived', 'in_progress')").get(req.user.id)
  if (currentRide) return res.status(409).json({ error: 'Complete or cancel your active ride before going offline.' })
  await db.prepare('UPDATE driver_locations SET is_online = FALSE, updated_at = ? WHERE driver_id = ?').run(Date.now(), req.user.id)
  io.in(rooms.user(req.user.id)).socketsLeave(rooms.onlineDrivers)
  res.json({ online: false })
})

app.post('/api/driver/location', locationLimiter, requireAuth, requireRole('driver'), async (req, res) => {
  const location = parseLocation(req.body, res)
  if (!location) return
  const current = await db.prepare('SELECT is_online FROM driver_locations WHERE driver_id = ?').get(req.user.id)
  if (!current?.is_online) return res.status(409).json({ error: 'Go online before sending driver location.' })
  const stored = await storeDriverLocation(req.user.id, location, true)
  const assignments = await db.prepare(`SELECT id FROM rides WHERE driver_id = ? AND status IN ('accepted', 'driver_arriving', 'driver_arrived', 'in_progress')`).all(req.user.id)
  for (const assignment of assignments) {
    const ride = await db.prepare('SELECT rider_id FROM rides WHERE id = ?').get(assignment.id)
    const payload = { rideId: assignment.id, location: liveLocationRecord(stored) }
    io.to(rooms.user(ride.rider_id)).emit('driver:location', payload)
    io.to(rooms.user(req.user.id)).emit('driver:location', payload)
    io.to(rooms.ride(assignment.id)).emit('trip:location', { location: liveLocationRecord(stored) })
  }
  res.json({ location: liveLocationRecord(stored) })
})

app.get('/api/driver/location', requireAuth, requireRole('driver'), async (req, res) => {
  const location = await db.prepare('SELECT * FROM driver_locations WHERE driver_id = ?').get(req.user.id)
  res.json({ online: Boolean(location?.is_online), location: location ? liveLocationRecord(location) : null })
})

const shareExpiryMs = 6 * 60 * 60 * 1000
app.post('/api/rides/:id/share', requireAuth, requireRole('rider'), async (req, res) => {
  const ride = await db.prepare('SELECT * FROM rides WHERE id = ? AND rider_id = ?').get(req.params.id, req.user.id)
  if (!ride) return res.status(404).json({ error: 'Ride not found.' })
  if (!activeRideStatuses.includes(ride.status)) return res.status(409).json({ error: 'Trip sharing is available after a driver accepts the ride.' })
  const now = Date.now()
  const expiresAt = now + shareExpiryMs
  const token = randomBytes(32).toString('base64url')
  const tokenHash = hashShareToken(token)
  await db.transaction(async client => {
    await client.query('UPDATE ride_share_links SET revoked_at = $1 WHERE ride_id = $2 AND revoked_at IS NULL', [now, ride.id])
    await client.query('INSERT INTO ride_share_links (token_hash, ride_id, rider_id, created_at, expires_at) VALUES ($1, $2, $3, $4, $5)', [tokenHash, ride.id, req.user.id, now, expiresAt])
  })
  const origin = req.get('origin')
  const safeOrigin = origin && allowedOrigins.has(origin) ? origin : configuredOrigins[0] || 'http://localhost:5173'
  res.status(201).json({ url: `${safeOrigin}/trip/${token}`, expiresAt })
})

app.delete('/api/rides/:id/share', requireAuth, requireRole('rider'), async (req, res) => {
  const ride = await db.prepare('SELECT id FROM rides WHERE id = ? AND rider_id = ?').get(req.params.id, req.user.id)
  if (!ride) return res.status(404).json({ error: 'Ride not found.' })
  const links = await db.prepare('SELECT token_hash FROM ride_share_links WHERE ride_id = ? AND revoked_at IS NULL').all(ride.id)
  await db.prepare('UPDATE ride_share_links SET revoked_at = ? WHERE ride_id = ? AND revoked_at IS NULL').run(Date.now(), ride.id)
  for (const link of links) io.in(rooms.share(link.token_hash)).disconnectSockets(true)
  res.status(204).end()
})

app.get('/api/share/:token', async (req, res) => {
  const { token } = req.params
  if (token.length < 40 || token.length > 100) return res.status(404).json({ error: 'Shared trip not found or expired.' })
  const share = await db.prepare(`SELECT ride_share_links.ride_id FROM ride_share_links JOIN rides ON rides.id = ride_share_links.ride_id
    WHERE ride_share_links.token_hash = ? AND ride_share_links.revoked_at IS NULL AND ride_share_links.expires_at > ?
    AND rides.status IN ('accepted', 'driver_arriving', 'driver_arrived', 'in_progress')`).get(hashShareToken(token), Date.now())
  if (!share) return res.status(404).json({ error: 'Shared trip not found or expired.' })
  const ride = await getPublicRide(share.ride_id)
  res.json({ trip: {
    pickup: ride.pickup, destination: ride.destination, vehicle: ride.vehicle, status: ride.status,
    pickupPoint: ride.pickupPoint, destinationPoint: ride.destinationPoint,
    routeDistanceMeters: ride.routeDistanceMeters, routeDurationSeconds: ride.routeDurationSeconds,
    updatedAt: ride.updatedAt, driver: ride.driver ? {
      name: ride.driver.name, vehicleModel: ride.driver.vehicleModel,
      vehicleColor: ride.driver.vehicleColor, vehicleRegistration: ride.driver.vehicleRegistration,
      rating: ride.driver.rating, ratingCount: ride.driver.ratingCount,
    } : null,
    driverLocation: ride.driverLocation,
  } })
})

app.get('/api/health', async (_req, res) => {
  try {
    await db.healthCheck()
    res.json({ status: 'ok', database: 'connected', googleAuthConfigured: Boolean(process.env.GOOGLE_CLIENT_ID), realtime: true })
  } catch {
    res.status(503).json({ status: 'unavailable', database: 'disconnected' })
  }
})
app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }))

if (isProduction && process.env.SERVE_FRONTEND !== 'false' && existsSync(clientDist)) {
  app.use(express.static(clientDist, { index: false, maxAge: '1h' }))
  app.get('*', (_req, res) => res.sendFile(resolve(clientDist, 'index.html')))
}

app.use((error, _req, res, _next) => {
  console.error('API request failed:', error?.message || error)
  res.status(500).json({ error: 'Something went wrong. Please try again.' })
})

let requestExpiryTimer
try {
  await initializeDatabase()
  await db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now())
  requestExpiryTimer = setInterval(() => {
    expireRideRequests().catch(error => console.error('Background database maintenance failed:', error.message))
  }, 5_000)
  requestExpiryTimer.unref()
  httpServer.listen(port, '0.0.0.0', () => console.log(`Avanti API listening on port ${port}`))
} catch (error) {
  if (requestExpiryTimer) clearInterval(requestExpiryTimer)
  console.error('Could not connect to PostgreSQL or initialize the schema:', error.message)
  process.exitCode = 1
  await db.close()
}

let isShuttingDown = false
async function shutdown(signal) {
  if (isShuttingDown) return
  isShuttingDown = true
  if (requestExpiryTimer) clearInterval(requestExpiryTimer)
  console.log(`${signal} received; closing realtime connections and database pool.`)
  const forcedExit = setTimeout(() => {
    console.error('Graceful shutdown timed out.')
    process.exit(1)
  }, 25_000)
  forcedExit.unref()
  try {
    await new Promise(resolveClose => io.close(resolveClose))
    await db.close()
    clearTimeout(forcedExit)
  } catch (error) {
    console.error('Error during graceful shutdown:', error?.message || error)
    process.exitCode = 1
  }
}

process.once('SIGTERM', () => { void shutdown('SIGTERM') })
process.once('SIGINT', () => { void shutdown('SIGINT') })
