import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export function createDatabase(file = process.env.DB_FILE || path.resolve('data/meetups.sqlite')) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('attendee', 'coordinator')),
      gender TEXT,
      city TEXT NOT NULL DEFAULT '',
      locality TEXT NOT NULL DEFAULT '',
      bio TEXT NOT NULL DEFAULT '',
      interests TEXT NOT NULL DEFAULT '[]',
      profession TEXT NOT NULL DEFAULT '',
      languages TEXT NOT NULL DEFAULT '[]',
      match_genders TEXT NOT NULL DEFAULT '[]',
      visibility TEXT NOT NULL DEFAULT '{"city":true,"bio":true,"interests":true,"profession":false,"languages":true,"gender":false}',
      created_at TEXT NOT NULL,
      verified_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id),
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      cover_url TEXT NOT NULL DEFAULT '',
      venue_name TEXT NOT NULL,
      venue_address TEXT NOT NULL,
      map_url TEXT NOT NULL,
      event_date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL DEFAULT '',
      registration_link TEXT NOT NULL DEFAULT '',
      capacity INTEGER,
      visibility TEXT NOT NULL CHECK (visibility IN ('public', 'private')),
      organizer_name TEXT NOT NULL,
      organizer_contact TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'postponed')),
      registration_open INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS events_date_idx ON events(event_date);

    CREATE TABLE IF NOT EXISTS event_members (
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      travel TEXT NOT NULL DEFAULT '{}',
      joined_at TEXT NOT NULL,
      PRIMARY KEY (event_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS event_members_user_idx ON event_members(user_id);

    CREATE TABLE IF NOT EXISTS recommendation_refs (
      ref TEXT PRIMARY KEY,
      viewer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(viewer_id, target_id, event_id)
    );

    CREATE TABLE IF NOT EXISTS connection_requests (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired', 'blocked', 'disconnected')),
      created_at TEXT NOT NULL,
      responded_at TEXT,
      requester_consented_at TEXT,
      recipient_consented_at TEXT,
      expires_at TEXT NOT NULL,
      CHECK (requester_id <> recipient_id)
    );
    CREATE INDEX IF NOT EXISTS requests_pair_idx ON connection_requests(event_id, requester_id, recipient_id, status);
    CREATE INDEX IF NOT EXISTS requests_recipient_idx ON connection_requests(recipient_id, status);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL REFERENCES connection_requests(id) ON DELETE CASCADE,
      sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      read_at TEXT
    );
    CREATE INDEX IF NOT EXISTS messages_request_idx ON messages(request_id, created_at);

    CREATE TABLE IF NOT EXISTS blocks (
      id TEXT PRIMARY KEY,
      blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      CHECK (blocker_id <> blocked_id),
      UNIQUE(blocker_id, blocked_id)
    );

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
      request_id TEXT REFERENCES connection_requests(id) ON DELETE SET NULL,
      reason TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'resolved'))
    );

    CREATE TABLE IF NOT EXISTS announcements (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      author_id TEXT NOT NULL REFERENCES users(id),
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS announcements_event_idx ON announcements(event_id, created_at DESC);
  `);
  const requestColumns = new Set(db.pragma('table_info(connection_requests)').map((column) => column.name));
  if (!requestColumns.has('requester_consented_at')) db.exec('ALTER TABLE connection_requests ADD COLUMN requester_consented_at TEXT');
  if (!requestColumns.has('recipient_consented_at')) db.exec('ALTER TABLE connection_requests ADD COLUMN recipient_consented_at TEXT');
  return db;
}
