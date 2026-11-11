import 'dotenv/config'
import express from 'express'
import helmet from 'helmet'
import { rateLimit } from 'express-rate-limit'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { db } from './database.mjs'
import { clearSessionCookie, destroySession, hashPassword, newUserId, publicUser, readSessionUser, setSessionCookie, verifyGoogleCredential, verifyPassword } from './auth.mjs'

const app = express()
const port = Number(process.env.PORT || 4000)
const isProduction = process.env.NODE_ENV === 'production'
const currentDir = fileURLToPath(new URL('.', import.meta.url))
const clientDist = resolve(currentDir, '../dist')
if (isProduction && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
  throw new Error('SESSION_SECRET must be set to a random value of at least 32 characters in production.')
}

app.disable('x-powered-by')
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY))
app.use(helmet(isProduction ? {
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  contentSecurityPolicy: { directives: {
    ...helmet.contentSecurityPolicy.getDefaultDirectives(),
    'script-src': ["'self'", 'https://accounts.google.com/gsi/client'],
    'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
    'frame-src': ["'self'", 'https://accounts.google.com/gsi/'],
    'connect-src': ["'self'", 'https://accounts.google.com/gsi/'],
  } },
} : { contentSecurityPolicy: false }))
app.use(express.json({ limit: '20kb' }))

const allowedOrigins = new Set([
  process.env.APP_ORIGIN,
  'http://localhost:5173',
  'http://127.0.0.1:5173',
].filter(Boolean))

app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const origin = req.get('origin')
    if (!origin || !allowedOrigins.has(origin)) return res.status(403).json({ error: 'Request origin is not allowed.' })
  }
  next()
})

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: 'draft-7', legacyHeaders: false })
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

function parseBody(schema, req, res) {
  const result = schema.safeParse(req.body)
  if (!result.success) {
    res.status(400).json({ error: result.error.issues[0]?.message || 'Check the information and try again.' })
    return null
  }
  return result.data
}

function requireAuth(req, res, next) {
  const user = readSessionUser(req)
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

function createSessionResponse(res, user) {
  setSessionCookie(res, user.id)
  return res.json({ user: publicUser(user) })
}

app.post('/api/auth/:role/register', authLimiter, async (req, res, next) => {
  try {
    const role = roleSchema.safeParse(req.params.role)
    const data = parseBody(registrationSchema, req, res)
    if (!role.success) return res.status(404).json({ error: 'Unknown account role.' })
    if (!data) return
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(data.email)) {
      return res.status(409).json({ error: 'An account with this email already exists. Try logging in.' })
    }
    const user = { id: newUserId(), email: data.email, name: data.name, phone: data.phone, role: role.data, password_hash: await hashPassword(data.password), google_sub: null, created_at: new Date().toISOString() }
    db.prepare('INSERT INTO users (id, email, name, phone, role, password_hash, google_sub, created_at) VALUES (@id, @email, @name, @phone, @role, @password_hash, @google_sub, @created_at)').run(user)
    return createSessionResponse(res, user)
  } catch (error) {
    if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'An account with this email already exists. Try logging in.' })
    next(error)
  }
})

app.post('/api/auth/:role/login', authLimiter, async (req, res, next) => {
  try {
    const role = roleSchema.safeParse(req.params.role)
    const data = parseBody(loginSchema, req, res)
    if (!role.success) return res.status(404).json({ error: 'Unknown account role.' })
    if (!data) return
    const user = db.prepare('SELECT * FROM users WHERE email = ? AND role = ?').get(data.email, role.data)
    const valid = await verifyPassword(data.password, user?.password_hash)
    if (!valid) return res.status(401).json({ error: 'Email or password is incorrect for this portal.' })
    return createSessionResponse(res, user)
  } catch (error) { next(error) }
})

app.post('/api/auth/google', authLimiter, async (req, res, next) => {
  try {
    const data = parseBody(googleSchema, req, res)
    if (!data) return
    const identity = await verifyGoogleCredential(data.credential)
    let user = db.prepare('SELECT * FROM users WHERE google_sub = ?').get(identity.subject)

    if (user && user.role !== data.role) return res.status(403).json({ error: 'This Google account belongs to the other Avanti portal.' })

    if (!user) {
      user = db.prepare('SELECT * FROM users WHERE email = ?').get(identity.email)
      if (user && user.role !== data.role) return res.status(403).json({ error: 'This email belongs to the other Avanti portal.' })
      if (data.mode === 'login' && !user) return res.status(401).json({ error: 'No account found for this portal. Register first.' })
      if (user?.google_sub && user.google_sub !== identity.subject) return res.status(409).json({ error: 'This email is already linked to another Google account.' })

      if (!user) {
        user = { id: newUserId(), email: identity.email, name: identity.name, phone: null, role: data.role, password_hash: null, google_sub: identity.subject, created_at: new Date().toISOString() }
        db.prepare('INSERT INTO users (id, email, name, phone, role, password_hash, google_sub, created_at) VALUES (@id, @email, @name, @phone, @role, @password_hash, @google_sub, @created_at)').run(user)
      } else {
        db.prepare('UPDATE users SET google_sub = ? WHERE id = ?').run(identity.subject, user.id)
        user = { ...user, google_sub: identity.subject }
      }
    }

    return createSessionResponse(res, user)
  } catch (error) {
    if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'This Google account is already linked to another user.' })
    if (error?.status) return res.status(error.status).json({ error: error.message })
    next(error)
  }
})

app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }))

app.post('/api/auth/logout', requireAuth, (req, res) => {
  destroySession(req)
  clearSessionCookie(res)
  res.status(204).end()
})

app.get('/api/rider/account', requireAuth, requireRole('rider'), (req, res) => res.json({ user: publicUser(req.user) }))
app.get('/api/driver/account', requireAuth, requireRole('driver'), (req, res) => res.json({ user: publicUser(req.user) }))
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }))
app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }))

if (isProduction && existsSync(clientDist)) {
  app.use(express.static(clientDist, { index: false, maxAge: '1h' }))
  app.get('*', (_req, res) => res.sendFile(resolve(clientDist, 'index.html')))
}

app.use((error, _req, res, _next) => {
  console.error('API request failed:', error?.message || error)
  res.status(500).json({ error: 'Something went wrong. Please try again.' })
})

app.listen(port, () => console.log(`Avanti API listening on http://localhost:${port}`))
