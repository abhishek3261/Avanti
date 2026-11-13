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
    status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'accepted', 'declined', 'cancelled')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS rides_status_created_idx ON rides(status, created_at DESC);
  CREATE INDEX IF NOT EXISTS rides_rider_created_idx ON rides(rider_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS rides_driver_status_idx ON rides(driver_id, status);
`)
db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now())
