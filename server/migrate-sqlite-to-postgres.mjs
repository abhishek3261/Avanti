import 'dotenv/config'
import Database from 'better-sqlite3'
import { mkdirSync, existsSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = resolve(process.env.DATABASE_PATH || resolve(root, 'data/avanti.sqlite'))
if (!existsSync(sourcePath)) throw new Error(`SQLite source database does not exist: ${sourcePath}`)

const source = new Database(sourcePath)
const backupDir = resolve(root, 'data/backups')
mkdirSync(backupDir, { recursive: true })
const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
const backupPath = resolve(backupDir, `avanti-pre-postgres-${timestamp}.sqlite`)
await source.backup(backupPath)
console.log(`SQLite backup created: ${basename(backupPath)}`)

const existingTables = new Set(source.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name))
const requiredTables = ['users', 'sessions', 'rides', 'driver_profiles', 'driver_locations', 'ride_share_links']
for (const table of requiredTables) {
  if (!existingTables.has(table)) throw new Error(`SQLite source is missing required table: ${table}`)
}
const violations = source.pragma('foreign_key_check')
if (violations.length) throw new Error(`SQLite source has ${violations.length} foreign-key violation(s); fix these before transfer.`)

const columnsFor = table => new Set(source.pragma(`table_info(${table})`).map(column => column.name))
const sourceRows = table => existingTables.has(table) ? source.prepare(`SELECT * FROM ${table}`).all() : []
const rideColumns = columnsFor('rides')
const rowsByTable = {
  users: sourceRows('users'),
  sessions: sourceRows('sessions'),
  rides: sourceRows('rides').map(row => {
    const status = row.status === 'declined' ? 'rejected' : row.status
    return {
      ...row,
      status,
      pickup_lat: rideColumns.has('pickup_lat') ? row.pickup_lat : null,
      pickup_lng: rideColumns.has('pickup_lng') ? row.pickup_lng : null,
      destination_lat: rideColumns.has('destination_lat') ? row.destination_lat : null,
      destination_lng: rideColumns.has('destination_lng') ? row.destination_lng : null,
      route_distance_meters: rideColumns.has('route_distance_meters') ? row.route_distance_meters : null,
      route_duration_seconds: rideColumns.has('route_duration_seconds') ? row.route_duration_seconds : null,
      estimated_fare_paise: rideColumns.has('estimated_fare_paise') ? row.estimated_fare_paise : null,
      request_expires_at: (rideColumns.has('request_expires_at') && row.request_expires_at != null)
        ? row.request_expires_at
        : status === 'requested' ? Date.now() + 60_000 : null,
      accepted_at: (rideColumns.has('accepted_at') && row.accepted_at)
        ? row.accepted_at
        : row.driver_id && ['accepted', 'driver_arriving', 'driver_arrived', 'in_progress', 'completed', 'cancelled'].includes(status)
          ? row.updated_at || row.created_at
          : null,
      driver_arrived_at: rideColumns.has('driver_arrived_at') ? row.driver_arrived_at : null,
      started_at: rideColumns.has('started_at') ? row.started_at : null,
      completed_at: rideColumns.has('completed_at') ? row.completed_at : null,
      cancelled_at: rideColumns.has('cancelled_at') ? row.cancelled_at : null,
    }
  }),
  driver_profiles: sourceRows('driver_profiles'),
  driver_locations: sourceRows('driver_locations').map(row => ({ ...row, is_online: Boolean(row.is_online) })),
  ride_share_links: sourceRows('ride_share_links'),
  ride_messages: sourceRows('ride_messages'),
}
source.close()

const { db, initializeDatabase } = await import('./database.mjs')

const tableColumns = {
  users: ['id', 'email', 'name', 'phone', 'role', 'password_hash', 'google_sub', 'created_at'],
  sessions: ['token_hash', 'user_id', 'expires_at', 'created_at'],
  rides: ['id', 'rider_id', 'driver_id', 'pickup', 'destination', 'vehicle', 'status', 'pickup_lat', 'pickup_lng', 'destination_lat', 'destination_lng', 'route_distance_meters', 'route_duration_seconds', 'estimated_fare_paise', 'request_expires_at', 'created_at', 'updated_at', 'accepted_at', 'driver_arrived_at', 'started_at', 'completed_at', 'cancelled_at'],
  driver_profiles: ['driver_id', 'vehicle_model', 'vehicle_color', 'vehicle_registration', 'rating', 'rating_count', 'updated_at'],
  driver_locations: ['driver_id', 'latitude', 'longitude', 'accuracy_meters', 'heading_degrees', 'speed_meters_per_second', 'recorded_at', 'updated_at', 'is_online'],
  ride_share_links: ['token_hash', 'ride_id', 'rider_id', 'created_at', 'expires_at', 'revoked_at'],
  ride_messages: ['id', 'ride_id', 'sender_id', 'recipient_id', 'client_message_id', 'body', 'created_at', 'delivered_at', 'read_at'],
}

try {
  if (process.env.DATABASE_URL_DIRECT) process.env.DATABASE_URL = process.env.DATABASE_URL_DIRECT
  await initializeDatabase()
  const tableNames = Object.keys(rowsByTable)
  const verification = {}
  const orphanChecks = [
    ['sessions', 'user_id', 'users'],
    ['rides', 'rider_id', 'users'],
    ['rides', 'driver_id', 'users'],
    ['driver_profiles', 'driver_id', 'users'],
    ['driver_locations', 'driver_id', 'users'],
    ['ride_share_links', 'ride_id', 'rides'],
    ['ride_share_links', 'rider_id', 'users'],
    ['ride_messages', 'ride_id', 'rides'],
    ['ride_messages', 'sender_id', 'users'],
    ['ride_messages', 'recipient_id', 'users'],
  ]
  await db.transaction(async client => {
    await client.query('LOCK TABLE users, sessions, rides, driver_profiles, driver_locations, ride_share_links, ride_messages IN ACCESS EXCLUSIVE MODE')
    for (const table of tableNames) {
      const result = await client.query(`SELECT COUNT(*) AS count FROM ${table}`)
      if (Number(result.rows[0].count) > 0) {
        throw new Error('PostgreSQL already contains application data. Migration stopped without overwriting it.')
      }
    }
    for (const table of tableNames) {
      const columns = tableColumns[table]
      const placeholders = columns.map((_column, index) => `$${index + 1}`).join(', ')
      const insert = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`
      for (const row of rowsByTable[table]) {
        await client.query(insert, columns.map(column => row[column] ?? null))
      }
    }
    for (const table of tableNames) {
      const result = await client.query(`SELECT COUNT(*) AS count FROM ${table}`)
      const actual = Number(result.rows[0].count)
      const expected = rowsByTable[table].length
      verification[table] = { source: expected, postgres: actual }
      if (actual !== expected) throw new Error(`Record count mismatch for ${table}: source ${expected}, PostgreSQL ${actual}.`)
    }
    for (const [child, foreignKey, parent] of orphanChecks) {
      const result = await client.query(`SELECT COUNT(*) AS count FROM ${child} c LEFT JOIN ${parent} p ON p.id = c.${foreignKey} WHERE c.${foreignKey} IS NOT NULL AND p.id IS NULL`)
      if (Number(result.rows[0].count) !== 0) throw new Error(`Foreign-key verification failed for ${child}.${foreignKey}.`)
    }
  })

  console.log('SQLite → PostgreSQL transfer verified:')
  console.table(verification)
  console.log('The SQLite source and timestamped backup were left untouched.')
} finally {
  await db.close()
}
