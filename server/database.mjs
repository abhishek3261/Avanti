import pg from 'pg'

const { Pool, types } = pg
// PostgreSQL BIGINT columns in this application store epoch milliseconds and
// bounded counters. Those values stay within JavaScript's exact integer range.
types.setTypeParser(20, value => Number(value))

const databaseUrl = process.env.DATABASE_URL?.trim()
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required. Configure a PostgreSQL connection string in the API environment.')
}

let parsedUrl
try { parsedUrl = new URL(databaseUrl) } catch {
  throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.')
}
if (!['postgres:', 'postgresql:'].includes(parsedUrl.protocol)) {
  throw new Error('DATABASE_URL must use the postgres:// or postgresql:// scheme.')
}

const production = process.env.NODE_ENV === 'production'
const poolMax = Number(process.env.DATABASE_POOL_MAX || 10)
if (!Number.isInteger(poolMax) || poolMax < 1 || poolMax > 100) {
  throw new Error('DATABASE_POOL_MAX must be an integer between 1 and 100.')
}
const databaseSchema = process.env.DATABASE_SCHEMA || 'public'
if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(databaseSchema)) {
  throw new Error('DATABASE_SCHEMA must be a simple PostgreSQL schema name.')
}
const sslMode = parsedUrl.searchParams.get('sslmode')
const channelBinding = parsedUrl.searchParams.get('channel_binding')
const sslRequired = process.env.DATABASE_SSL === 'true' || ['require', 'verify-ca', 'verify-full'].includes(sslMode)
if (production && !sslRequired) {
  throw new Error('Production PostgreSQL connections must use TLS. Set DATABASE_SSL=true or include sslmode=require in DATABASE_URL.')
}

const pool = new Pool({
  // node-postgres handles TLS and SCRAM channel binding through config options;
  // remove libpq-only flags from the URI after translating them explicitly.
  connectionString: (() => {
    const connectionUrl = new URL(databaseUrl)
    connectionUrl.searchParams.delete('sslmode')
    connectionUrl.searchParams.delete('channel_binding')
    return connectionUrl.toString()
  })(),
  max: poolMax,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  enableChannelBinding: channelBinding === 'require',
  ...(process.env.DATABASE_SCHEMA ? { options: `-c search_path=${databaseSchema}` } : {}),
  ...(sslRequired ? { ssl: { rejectUnauthorized: true } } : {}),
})

pool.on('error', error => {
  console.error('Unexpected PostgreSQL pool error:', error.message)
})

function toPostgres(sql, params) {
  const namedParams = params.length === 1 && params[0] && typeof params[0] === 'object' && !Array.isArray(params[0])
    ? params[0]
    : null
  if (namedParams) {
    const values = []
    const indexes = new Map()
    const namedSql = sql.replace(/@([A-Za-z_][A-Za-z0-9_]*)/g, (_match, name) => {
      if (!(name in namedParams)) throw new Error(`Missing SQL parameter: ${name}`)
      if (!indexes.has(name)) {
        indexes.set(name, values.length + 1)
        values.push(namedParams[name])
      }
      return `$${indexes.get(name)}`
    })
    return { text: namedSql, values }
  }

  let index = 0
  return { text: sql.replace(/\?/g, () => `$${++index}`), values: params }
}

function prepare(sql) {
  return {
    async get(...params) {
      const result = await pool.query(toPostgres(sql, params))
      return result.rows[0]
    },
    async all(...params) {
      const result = await pool.query(toPostgres(sql, params))
      return result.rows
    },
    async run(...params) {
      const result = await pool.query(toPostgres(sql, params))
      return { changes: result.rowCount, lastInsertRowid: undefined }
    },
  }
}

export const db = {
  prepare,
  async exec(sql) { return pool.query(sql) },
  async query(sql, params = []) { return pool.query(sql, params) },
  async transaction(callback) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const result = await callback(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  },
  async healthCheck() { await pool.query('SELECT 1'); return true },
  async close() { await pool.end() },
}

export async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      phone TEXT,
      role TEXT NOT NULL CHECK (role IN ('rider', 'driver')),
      password_hash TEXT,
      google_sub TEXT UNIQUE,
      created_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS rides (
      id TEXT PRIMARY KEY,
      rider_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      driver_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      pickup TEXT NOT NULL,
      destination TEXT NOT NULL,
      vehicle TEXT NOT NULL CHECK (vehicle IN ('Mini', 'Sedan', 'SUV')),
      status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'accepted', 'driver_arriving', 'driver_arrived', 'in_progress', 'completed', 'rejected', 'cancelled')),
      pickup_lat DOUBLE PRECISION,
      pickup_lng DOUBLE PRECISION,
      destination_lat DOUBLE PRECISION,
      destination_lng DOUBLE PRECISION,
      route_distance_meters INTEGER,
      route_duration_seconds INTEGER,
      estimated_fare_paise INTEGER,
      request_expires_at BIGINT,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      accepted_at TIMESTAMPTZ,
      driver_arrived_at TIMESTAMPTZ,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      cancelled_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS driver_profiles (
      driver_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      vehicle_model TEXT,
      vehicle_color TEXT,
      vehicle_registration TEXT,
      rating DOUBLE PRECISION,
      rating_count INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS driver_locations (
      driver_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
      longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
      accuracy_meters DOUBLE PRECISION,
      heading_degrees DOUBLE PRECISION,
      speed_meters_per_second DOUBLE PRECISION,
      recorded_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      is_online BOOLEAN NOT NULL DEFAULT FALSE
    );
    CREATE TABLE IF NOT EXISTS ride_share_links (
      token_hash TEXT PRIMARY KEY,
      ride_id TEXT NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
      rider_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL,
      revoked_at BIGINT
    );
    CREATE TABLE IF NOT EXISTS ride_messages (
      id TEXT PRIMARY KEY,
      ride_id TEXT NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
      sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_message_id TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      delivered_at TIMESTAMPTZ,
      read_at TIMESTAMPTZ,
      UNIQUE (sender_id, client_message_id)
    );
    CREATE INDEX IF NOT EXISTS rides_status_created_idx ON rides(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS rides_rider_created_idx ON rides(rider_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS rides_driver_status_idx ON rides(driver_id, status);
    CREATE UNIQUE INDEX IF NOT EXISTS rides_one_active_per_driver_idx ON rides(driver_id)
      WHERE driver_id IS NOT NULL AND status IN ('accepted', 'driver_arriving', 'driver_arrived', 'in_progress');
    CREATE INDEX IF NOT EXISTS driver_locations_online_idx ON driver_locations(is_online, updated_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS driver_profiles_registration_idx ON driver_profiles(UPPER(vehicle_registration)) WHERE vehicle_registration IS NOT NULL;
    CREATE INDEX IF NOT EXISTS ride_share_links_ride_idx ON ride_share_links(ride_id, expires_at DESC);
    CREATE INDEX IF NOT EXISTS ride_messages_conversation_idx ON ride_messages(ride_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS ride_messages_unread_idx ON ride_messages(ride_id, recipient_id, read_at);
  `)
}
