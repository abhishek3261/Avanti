import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const databasePath = resolve(process.env.DATABASE_PATH || 'data/avanti.sqlite')
mkdirSync(dirname(databasePath), { recursive: true })

export const db = new Database(databasePath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    phone TEXT,
    role TEXT NOT NULL CHECK (role IN ('rider', 'driver')),
    password_hash TEXT,
    google_sub TEXT UNIQUE,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL
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
    pickup_lat REAL,
    pickup_lng REAL,
    destination_lat REAL,
    destination_lng REAL,
    route_distance_meters INTEGER,
    route_duration_seconds INTEGER,
    estimated_fare_paise INTEGER,
    request_expires_at INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    accepted_at TEXT,
    driver_arrived_at TEXT,
    started_at TEXT,
    completed_at TEXT,
    cancelled_at TEXT
  );

  CREATE TABLE IF NOT EXISTS driver_profiles (
    driver_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    vehicle_model TEXT,
    vehicle_color TEXT,
    vehicle_registration TEXT,
    rating REAL,
    rating_count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS driver_locations (
    driver_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    latitude REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    accuracy_meters REAL,
    heading_degrees REAL,
    speed_meters_per_second REAL,
    recorded_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    is_online INTEGER NOT NULL DEFAULT 0 CHECK (is_online IN (0, 1))
  );

  CREATE TABLE IF NOT EXISTS ride_share_links (
    token_hash TEXT PRIMARY KEY,
    ride_id TEXT NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
    rider_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    revoked_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS ride_messages (
    id TEXT PRIMARY KEY,
    ride_id TEXT NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
    sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_message_id TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    delivered_at TEXT,
    read_at TEXT,
    UNIQUE (sender_id, client_message_id)
  );

  CREATE INDEX IF NOT EXISTS rides_status_created_idx ON rides(status, created_at DESC);
  CREATE INDEX IF NOT EXISTS rides_rider_created_idx ON rides(rider_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS rides_driver_status_idx ON rides(driver_id, status);
  CREATE INDEX IF NOT EXISTS driver_locations_online_idx ON driver_locations(is_online, updated_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS driver_profiles_registration_idx ON driver_profiles(UPPER(vehicle_registration)) WHERE vehicle_registration IS NOT NULL;
  CREATE INDEX IF NOT EXISTS ride_share_links_ride_idx ON ride_share_links(ride_id, expires_at DESC);
  CREATE INDEX IF NOT EXISTS ride_messages_conversation_idx ON ride_messages(ride_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS ride_messages_unread_idx ON ride_messages(ride_id, recipient_id, read_at);
`)

function migrateRideLifecycle() {
  const definition = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'rides'").get()?.sql || ''
  const columns = new Set(db.pragma('table_info(rides)').map(column => column.name))
  if (definition.includes("'driver_arriving'") && columns.has('pickup_lat') && columns.has('completed_at') && columns.has('request_expires_at')) return

  db.pragma('foreign_keys = OFF')
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec(`
      CREATE TABLE rides_migrating (
        id TEXT PRIMARY KEY,
        rider_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        driver_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        pickup TEXT NOT NULL,
        destination TEXT NOT NULL,
        vehicle TEXT NOT NULL CHECK (vehicle IN ('Mini', 'Sedan', 'SUV')),
        status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'accepted', 'driver_arriving', 'driver_arrived', 'in_progress', 'completed', 'rejected', 'cancelled')),
        pickup_lat REAL,
        pickup_lng REAL,
        destination_lat REAL,
        destination_lng REAL,
        route_distance_meters INTEGER,
        route_duration_seconds INTEGER,
        estimated_fare_paise INTEGER,
        request_expires_at INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        accepted_at TEXT,
        driver_arrived_at TEXT,
        started_at TEXT,
        completed_at TEXT,
        cancelled_at TEXT
      );
      INSERT INTO rides_migrating (id, rider_id, driver_id, pickup, destination, vehicle, status, created_at, updated_at, request_expires_at)
        SELECT id, rider_id, driver_id, pickup, destination, vehicle,
          CASE status WHEN 'declined' THEN 'rejected' ELSE status END,
          created_at, updated_at, CASE WHEN status = 'requested' THEN (CAST(strftime('%s','now') AS INTEGER) + 60) * 1000 ELSE NULL END FROM rides;
      DROP TABLE rides;
      ALTER TABLE rides_migrating RENAME TO rides;
      CREATE INDEX rides_status_created_idx ON rides(status, created_at DESC);
      CREATE INDEX rides_rider_created_idx ON rides(rider_id, created_at DESC);
      CREATE INDEX rides_driver_status_idx ON rides(driver_id, status);
    `)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  } finally {
    db.pragma('foreign_keys = ON')
  }
}

migrateRideLifecycle()
db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now())
