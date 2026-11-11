import { createHmac, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { OAuth2Client } from 'google-auth-library'
import { db } from './database.mjs'

const scrypt = promisify(scryptCallback)
const googleClient = new OAuth2Client()
const SESSION_COOKIE = 'avanti_session'
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

const hashToken = token => createHmac('sha256', process.env.SESSION_SECRET || 'avanti-development-session-key').update(token).digest('hex')
const isProduction = process.env.NODE_ENV === 'production'

export function publicUser(user) {
  return { id: user.id, email: user.email, name: user.name, phone: user.phone, role: user.role, createdAt: user.created_at }
}

export async function hashPassword(password) {
  const salt = randomBytes(16)
  const derived = await scrypt(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 })
  return `scrypt$131072$8$1$${salt.toString('hex')}$${Buffer.from(derived).toString('hex')}`
}

export async function verifyPassword(password, stored) {
  if (!stored) return false
  const [algorithm, n, r, p, saltHex, hashHex] = stored.split('$')
  if (algorithm !== 'scrypt' || n !== '131072' || r !== '8' || p !== '1' || !saltHex || !hashHex) return false
  const expected = Buffer.from(hashHex, 'hex')
  const actual = Buffer.from(await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: 256 * 1024 * 1024,
  }))
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function setSessionCookie(res, userId) {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = Date.now() + SESSION_TTL_MS
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now())
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(hashToken(token), userId, expiresAt, new Date().toISOString())
  const attributes = [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${SESSION_TTL_MS / 1000}`]
  if (isProduction) attributes.push('Secure')
  res.setHeader('Set-Cookie', attributes.join('; '))
}

export function clearSessionCookie(res) {
  const attributes = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0']
  if (isProduction) attributes.push('Secure')
  res.setHeader('Set-Cookie', attributes.join('; '))
}

export function readSessionUser(req) {
  const cookieHeader = req.headers.cookie || ''
  const tokenCookie = cookieHeader.split(';').map(part => part.trim()).find(part => part.startsWith(`${SESSION_COOKIE}=`))
  const token = tokenCookie?.slice(SESSION_COOKIE.length + 1)
  if (!token) return null
  return db.prepare(`SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?`).get(hashToken(token), Date.now()) || null
}

export function destroySession(req) {
  const cookieHeader = req.headers.cookie || ''
  const tokenCookie = cookieHeader.split(';').map(part => part.trim()).find(part => part.startsWith(`${SESSION_COOKIE}=`))
  const token = tokenCookie?.slice(SESSION_COOKIE.length + 1)
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token))
}

export async function verifyGoogleCredential(credential) {
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) throw Object.assign(new Error('Google sign-in is not configured on the server.'), { status: 503 })
  let ticket
  try {
    ticket = await googleClient.verifyIdToken({ idToken: credential, audience: clientId })
  } catch {
    throw Object.assign(new Error('Google sign-in could not be verified.'), { status: 401 })
  }
  const payload = ticket.getPayload()
  if (!payload?.sub || !payload.email || payload.email_verified !== true) {
    throw Object.assign(new Error('Google account must have a verified email address.'), { status: 401 })
  }
  return {
    subject: payload.sub,
    email: payload.email.toLowerCase().trim(),
    name: payload.name?.trim().slice(0, 100) || payload.email.split('@')[0],
  }
}

export function newUserId() {
  return randomUUID()
}

