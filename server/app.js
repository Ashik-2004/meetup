import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import express from 'express';
import { z } from 'zod';
import { createDatabase } from './db.js';
import { isBlocked, pairEligibility, parseJson } from './matching.js';

const scryptAsync = promisify(crypto.scrypt);
const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const addDays = (days) => new Date(Date.now() + days * 86_400_000).toISOString();
const TRAVEL_MODES = ['Train', 'Bus', 'Car', 'Bike', 'Walking / meeting at venue', 'Other', 'Not decided yet'];
const GENDERS = ['woman', 'man', 'nonbinary', 'prefer_not_to_say'];
const DEFAULT_VISIBILITY = { city: true, bio: true, interests: true, profession: false, languages: true, gender: false };

const registerSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(128),
  name: z.string().trim().min(1).max(80),
  role: z.enum(['attendee', 'coordinator']).default('attendee'),
});
const profileSchema = z.object({
  name: z.string().trim().min(1).max(80),
  gender: z.enum(GENDERS),
  city: z.string().trim().min(1).max(100),
  locality: z.string().trim().max(100).default(''),
  bio: z.string().trim().max(240).default(''),
  interests: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  profession: z.string().trim().max(80).default(''),
  languages: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  matchGenders: z.array(z.enum(GENDERS)).max(4).optional(),
  visibility: z.object({
    city: z.boolean().optional(), bio: z.boolean().optional(), interests: z.boolean().optional(),
    profession: z.boolean().optional(), languages: z.boolean().optional(), gender: z.boolean().optional(),
  }).optional(),
});
const eventSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().min(5).max(3000),
  category: z.string().trim().min(1).max(80),
  coverUrl: z.string().trim().max(500).refine((value) => value === '' || isHttpUrl(value), 'Use an http or https link.').default(''),
  venueName: z.string().trim().min(1).max(160),
  venueAddress: z.string().trim().min(1).max(300),
  mapUrl: z.string().trim().min(1).max(500).refine(isHttpUrl, 'Use an http or https map link.'),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).or(z.literal('')).default(''),
  registrationLink: z.string().trim().max(500).refine((value) => value === '' || isHttpUrl(value), 'Use an http or https link.').default(''),
  capacity: z.number().int().positive().max(100000).nullable().default(null),
  visibility: z.enum(['public', 'private']).default('public'),
  organizerName: z.string().trim().min(1).max(100),
  organizerContact: z.string().trim().max(200).default(''),
});
const travelSchema = z.object({
  city: z.string().trim().max(100).default(''),
  locality: z.string().trim().max(100).default(''),
  modes: z.array(z.enum(TRAVEL_MODES)).max(TRAVEL_MODES.length).default([]),
  travelDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')).default(''),
  departureTime: z.string().regex(/^\d{2}:\d{2}$/).or(z.literal('')).default(''),
  lookingForCompanion: z.boolean(),
  willingToShare: z.boolean().default(false),
  carIntent: z.enum(['offering', 'seeking', 'not-sharing', '']).default(''),
  seats: z.number().int().min(0).max(12).default(0),
  meetingPoint: z.string().trim().max(160).default(''),
  details: z.string().trim().max(300).default(''),
}).superRefine((data, context) => {
  if (!data.lookingForCompanion) return;
  if (!data.city) context.addIssue({ code: 'custom', path: ['city'], message: 'Add a starting city to enable matching.' });
  if (!data.locality) context.addIssue({ code: 'custom', path: ['locality'], message: 'Add an approximate locality to enable matching.' });
  if (!data.modes.length) context.addIssue({ code: 'custom', path: ['modes'], message: 'Choose at least one travel method to enable matching.' });
});
const announcementSchema = z.object({ body: z.string().trim().min(2).max(1200) });
const reportSchema = z.object({
  userRef: z.string().uuid(),
  reason: z.enum(['safety', 'harassment', 'spam', 'misrepresentation', 'other']),
  details: z.string().trim().max(1000).default(''),
  requestId: z.string().uuid().optional(),
});
const responseSchema = z.object({ action: z.enum(['accept', 'decline']) });
const requestCreateSchema = z.object({ userRef: z.string().uuid(), consentConfirmed: z.literal(true) });
const messageSchema = z.object({ body: z.string().trim().min(1).max(2000) });

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((item) => {
    const index = item.indexOf('=');
    if (index < 0) return ['', ''];
    return [item.slice(0, index).trim(), decodeURIComponent(item.slice(index + 1).trim())];
  }).filter(([key]) => key));
}

async function makePasswordHash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = await scryptAsync(password, salt, 64);
  return `${salt}:${Buffer.from(key).toString('hex')}`;
}

async function passwordMatches(password, encoded) {
  const [salt, expectedHex] = String(encoded || '').split(':');
  if (!salt || !expectedHex) return false;
  const actual = Buffer.from(await scryptAsync(password, salt, 64));
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function sendValidationError(res, parsed) {
  return res.status(400).json({ error: 'Check the highlighted fields and try again.', fields: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) });
}

function slugify(value) {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 54) || 'event';
}

function isHttpUrl(value) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function readTravel(row) {
  return parseJson(row?.travel, {});
}

function baseEvent(db, event, viewerId = null) {
  const memberCount = db.prepare('SELECT COUNT(*) AS count FROM event_members WHERE event_id = ?').get(event.id).count;
  const isMember = viewerId ? Boolean(db.prepare('SELECT 1 FROM event_members WHERE event_id = ? AND user_id = ?').get(event.id, viewerId)) : false;
  const isOwner = viewerId === event.owner_id;
  return {
    slug: event.slug,
    name: event.name,
    description: event.description,
    category: event.category,
    coverUrl: event.cover_url,
    venueName: event.venue_name,
    venueAddress: event.venue_address,
    mapUrl: event.map_url,
    eventDate: event.event_date,
    startTime: event.start_time,
    endTime: event.end_time,
    registrationLink: event.registration_link,
    capacity: event.capacity,
    visibility: event.visibility,
    organizerName: event.organizer_name,
    status: event.status,
    registrationOpen: Boolean(event.registration_open),
    memberCount,
    isMember,
    isOwner,
    createdAt: event.created_at,
  };
}

function publicProfile(user) {
  const visibility = { ...DEFAULT_VISIBILITY, ...parseJson(user.visibility, {}) };
  const profile = { name: user.name };
  if (visibility.city) profile.city = user.city;
  if (visibility.bio && user.bio) profile.bio = user.bio;
  if (visibility.interests) profile.interests = parseJson(user.interests, []);
  if (visibility.profession && user.profession) profile.profession = user.profession;
  if (visibility.languages) profile.languages = parseJson(user.languages, []);
  if (visibility.gender && user.gender !== 'prefer_not_to_say') profile.gender = user.gender;
  return profile;
}

function ensureUserRef(db, viewerId, targetId, eventId) {
  const ref = id();
  const createdAt = now();
  const expiresAt = addDays(30);
  db.prepare(`
    INSERT INTO recommendation_refs (ref, viewer_id, target_id, event_id, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(viewer_id, target_id, event_id)
    DO UPDATE SET ref = excluded.ref, expires_at = excluded.expires_at, created_at = excluded.created_at
  `).run(ref, viewerId, targetId, eventId, expiresAt, createdAt);
  return ref;
}

function findUserRef(db, viewerId, ref) {
  return db.prepare(`SELECT * FROM recommendation_refs WHERE ref = ? AND viewer_id = ? AND expires_at > ?`).get(ref, viewerId, now());
}

function anonymousTravel(db, viewerId, targetId, eventId, travel, eventName, reasons = []) {
  const city = travel.city || 'City not added';
  const modes = Array.isArray(travel.modes) ? travel.modes : [];
  const result = {
    userRef: ensureUserRef(db, viewerId, targetId, eventId),
    alias: city === 'City not added' ? 'A private attendee' : `Someone from ${city}`,
    eventName,
    city,
    approximateLocality: travel.locality || '',
    modes,
    travelDate: travel.travelDate || '',
    departureTime: travel.departureTime || '',
    reasons,
  };
  if (travel.carIntent === 'offering' && Number(travel.seats) > 0) result.seatsOffered = Number(travel.seats);
  return result;
}

function expireRequests(db, userId) {
  const timestamp = now();
  db.prepare(`UPDATE connection_requests SET status = 'expired', responded_at = ? WHERE status = 'pending' AND expires_at <= ? AND (requester_id = ? OR recipient_id = ?)`).run(timestamp, timestamp, userId, userId);
}

function participantRequest(db, requestId, userId) {
  return db.prepare(`SELECT * FROM connection_requests WHERE id = ? AND (requester_id = ? OR recipient_id = ?)`).get(requestId, userId, userId);
}

function requireAccepted(db, requestId, userId) {
  const request = participantRequest(db, requestId, userId);
  if (!request || request.status !== 'accepted' || !request.requester_consented_at || !request.recipient_consented_at || isBlocked(db, request.requester_id, request.recipient_id)) return null;
  return request;
}

function rateLimit({ limit = 30, windowMs = 60_000 } = {}) {
  const buckets = new Map();
  return (req, res, next) => {
    const key = `${req.ip}:${req.path}`;
    const current = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= current) {
      buckets.set(key, { count: 1, resetAt: current + windowMs });
      if (buckets.size > 3000) for (const [k, v] of buckets) if (v.resetAt <= current) buckets.delete(k);
      return next();
    }
    bucket.count += 1;
    if (bucket.count > limit) return res.status(429).json({ error: 'Too many attempts. Please wait a moment and try again.' });
    next();
  };
}

export function createApp({ db: suppliedDb, dbFile, sessionSecret = process.env.SESSION_SECRET || 'meetups-local-development-session-secret-change-this', requestTtlDays = Number(process.env.REQUEST_TTL_DAYS || 14) } = {}) {
  const db = suppliedDb || createDatabase(dbFile);
  const app = express();
  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction && sessionSecret.includes('development')) throw new Error('Set SESSION_SECRET to a long random value before production use.');
  const hashToken = (value) => crypto.createHmac('sha256', sessionSecret).update(value).digest('hex');

  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.get('origin')) {
      try {
        if (new URL(req.get('origin')).host !== req.get('host')) return res.status(403).json({ error: 'Request origin was not allowed.' });
      } catch {
        return res.status(403).json({ error: 'Request origin was not allowed.' });
      }
    }
    next();
  });
  app.use(express.json({ limit: '32kb' }));
  app.use((req, _res, next) => {
    const token = parseCookies(req.headers.cookie).meetups_session;
    if (token) {
      const session = db.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?').get(hashToken(token));
      if (session && session.expires_at > now()) req.user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);
      else if (session) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
    }
    next();
  });
  const authLimiter = rateLimit({ limit: 12, windowMs: 60_000 });
  const requestLimiter = rateLimit({ limit: 20, windowMs: 60_000 });
  const requireAuth = (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Please sign in to continue.' });
  const requireCoordinator = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Please sign in to continue.' });
    if (req.user.role !== 'coordinator') return res.status(403).json({ error: 'Coordinator access is required.' });
    next();
  };

  const issueSession = (userId, res) => {
    const raw = crypto.randomBytes(32).toString('hex');
    const created = now();
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(hashToken(raw), userId, addDays(14), created);
    const cookie = `meetups_session=${encodeURIComponent(raw)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=1209600${isProduction ? '; Secure' : ''}`;
    res.setHeader('Set-Cookie', cookie);
  };
  const safeOwnProfile = (user) => ({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    gender: user.gender,
    city: user.city,
    locality: user.locality,
    bio: user.bio,
    interests: parseJson(user.interests, []),
    profession: user.profession,
    languages: parseJson(user.languages, []),
    matchGenders: parseJson(user.match_genders, []),
    visibility: { ...DEFAULT_VISIBILITY, ...parseJson(user.visibility, {}) },
    verified: Boolean(user.verified_at),
  });

  app.get('/api/health', (_req, res) => res.json({ status: 'ok', app: 'Meetups' }));

  app.post('/api/auth/register', authLimiter, async (req, res, next) => {
    try {
      if (isProduction) return res.status(503).json({ error: 'Email verification has not been configured for this deployment.' });
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) return sendValidationError(res, parsed);
      const { email, password, name, role } = parsed.data;
      const normalizedEmail = email.toLowerCase();
      if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(normalizedEmail)) return res.status(409).json({ error: 'An account with this email already exists.' });
      const userId = id();
      const time = now();
      const passwordHash = await makePasswordHash(password);
      db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at, verified_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(userId, normalizedEmail, passwordHash, name, role, time, time);
      issueSession(userId, res);
      return res.status(201).json({ user: safeOwnProfile(db.prepare('SELECT * FROM users WHERE id = ?').get(userId)), localVerification: true });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/auth/login', authLimiter, async (req, res, next) => {
    try {
      const parsed = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(128) }).safeParse(req.body);
      if (!parsed.success) return sendValidationError(res, parsed);
      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(parsed.data.email.toLowerCase());
      if (!user || !(await passwordMatches(parsed.data.password, user.password_hash))) return res.status(401).json({ error: 'Email or password is incorrect.' });
      issueSession(user.id, res);
      return res.json({ user: safeOwnProfile(user) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    const token = parseCookies(req.headers.cookie).meetups_session;
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
    res.setHeader('Set-Cookie', `meetups_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${isProduction ? '; Secure' : ''}`);
    res.json({ ok: true });
  });

  app.get('/api/me', requireAuth, (req, res) => res.json({ user: safeOwnProfile(req.user) }));

  app.put('/api/profile', requireAuth, (req, res) => {
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(res, parsed);
    const data = parsed.data;
    const existingVisibility = { ...DEFAULT_VISIBILITY, ...parseJson(req.user.visibility, {}) };
    const visibility = { ...existingVisibility, ...(data.visibility || {}) };
    let matchGenders = data.matchGenders;
    if (!matchGenders) matchGenders = ['woman', 'man'].includes(data.gender) ? [data.gender] : [];
    db.prepare(`UPDATE users SET name = ?, gender = ?, city = ?, locality = ?, bio = ?, interests = ?, profession = ?, languages = ?, match_genders = ?, visibility = ? WHERE id = ?`)
      .run(data.name, data.gender, data.city, data.locality, data.bio, JSON.stringify(data.interests), data.profession, JSON.stringify(data.languages), JSON.stringify([...new Set(matchGenders)]), JSON.stringify(visibility), req.user.id);
    res.json({ user: safeOwnProfile(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
  });

  app.get('/api/events', (req, res) => {
    const rows = db.prepare(`
      SELECT e.* FROM events e
      WHERE e.visibility = 'public' OR e.owner_id = ? OR EXISTS (SELECT 1 FROM event_members em WHERE em.event_id = e.id AND em.user_id = ?)
      ORDER BY e.event_date ASC, e.start_time ASC
    `).all(req.user?.id || '', req.user?.id || '');
    res.json({ events: rows.map((event) => baseEvent(db, event, req.user?.id || null)) });
  });

  app.get('/api/events/:slug', (req, res) => {
    const event = db.prepare('SELECT * FROM events WHERE slug = ?').get(req.params.slug);
    if (!event) return res.status(404).json({ error: 'Event not found.' });
    return res.json({ event: baseEvent(db, event, req.user?.id || null) });
  });

  app.post('/api/events', requireCoordinator, (req, res) => {
    const parsed = eventSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(res, parsed);
    const data = parsed.data;
    let slug = `${slugify(data.name)}-${crypto.randomBytes(12).toString('hex')}`;
    while (db.prepare('SELECT 1 FROM events WHERE slug = ?').get(slug)) slug = `${slugify(data.name)}-${crypto.randomBytes(12).toString('hex')}`;
    const eventId = id();
    const created = now();
    db.prepare(`INSERT INTO events (id, owner_id, slug, name, description, category, cover_url, venue_name, venue_address, map_url, event_date, start_time, end_time, registration_link, capacity, visibility, organizer_name, organizer_contact, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(eventId, req.user.id, slug, data.name, data.description, data.category, data.coverUrl, data.venueName, data.venueAddress, data.mapUrl, data.eventDate, data.startTime, data.endTime, data.registrationLink, data.capacity, data.visibility, data.organizerName, data.organizerContact, created);
    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
    res.status(201).json({ event: baseEvent(db, event, req.user.id), invitationPath: `/event/${slug}` });
  });

  app.patch('/api/events/:slug', requireCoordinator, (req, res) => {
    const existing = db.prepare('SELECT * FROM events WHERE slug = ?').get(req.params.slug);
    if (!existing) return res.status(404).json({ error: 'Event not found.' });
    if (existing.owner_id !== req.user.id) return res.status(403).json({ error: 'Only this event coordinator can edit it.' });
    const partialSchema = eventSchema.partial().extend({ status: z.enum(['active', 'cancelled', 'postponed']).optional(), registrationOpen: z.boolean().optional() });
    const parsed = partialSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(res, parsed);
    const fields = {
      name: 'name', description: 'description', category: 'category', coverUrl: 'cover_url', venueName: 'venue_name', venueAddress: 'venue_address',
      mapUrl: 'map_url', eventDate: 'event_date', startTime: 'start_time', endTime: 'end_time', registrationLink: 'registration_link', capacity: 'capacity',
      visibility: 'visibility', organizerName: 'organizer_name', organizerContact: 'organizer_contact', status: 'status', registrationOpen: 'registration_open',
    };
    const assignments = [];
    const values = [];
    for (const [key, value] of Object.entries(parsed.data)) {
      assignments.push(`${fields[key]} = ?`);
      values.push(key === 'registrationOpen' ? Number(value) : value);
    }
    if (!assignments.length) return res.json({ event: baseEvent(db, existing, req.user.id) });
    values.push(existing.id);
    db.prepare(`UPDATE events SET ${assignments.join(', ')} WHERE id = ?`).run(...values);
    return res.json({ event: baseEvent(db, db.prepare('SELECT * FROM events WHERE id = ?').get(existing.id), req.user.id) });
  });

  app.post('/api/events/:slug/join', requireAuth, (req, res) => {
    const event = db.prepare('SELECT * FROM events WHERE slug = ?').get(req.params.slug);
    if (!event) return res.status(404).json({ error: 'Event not found.' });
    if (event.status !== 'active' || !event.registration_open) return res.status(409).json({ error: 'Registration is not open for this event.' });
    const existing = db.prepare('SELECT 1 FROM event_members WHERE event_id = ? AND user_id = ?').get(event.id, req.user.id);
    if (existing) return res.json({ joined: true, alreadyJoined: true });
    const count = db.prepare('SELECT COUNT(*) AS count FROM event_members WHERE event_id = ?').get(event.id).count;
    if (event.capacity && count >= event.capacity) return res.status(409).json({ error: 'This event has reached its attendee limit.' });
    db.prepare('INSERT INTO event_members (event_id, user_id, travel, joined_at) VALUES (?, ?, ?, ?)')
      .run(event.id, req.user.id, JSON.stringify({ lookingForCompanion: false, modes: [] }), now());
    res.status(201).json({ joined: true, alreadyJoined: false });
  });

  app.delete('/api/events/:slug/membership', requireAuth, (req, res) => {
    const event = db.prepare('SELECT id FROM events WHERE slug = ?').get(req.params.slug);
    if (!event) return res.status(404).json({ error: 'Event not found.' });
    db.prepare(`UPDATE connection_requests SET status = 'expired', responded_at = ? WHERE event_id = ? AND status = 'pending' AND (requester_id = ? OR recipient_id = ?)`).run(now(), event.id, req.user.id, req.user.id);
    db.prepare(`UPDATE connection_requests SET status = 'disconnected', responded_at = ? WHERE event_id = ? AND status = 'accepted' AND (requester_id = ? OR recipient_id = ?)`).run(now(), event.id, req.user.id, req.user.id);
    db.prepare('DELETE FROM event_members WHERE event_id = ? AND user_id = ?').run(event.id, req.user.id);
    res.json({ left: true });
  });

  app.put('/api/events/:slug/travel', requireAuth, (req, res) => {
    const event = db.prepare('SELECT * FROM events WHERE slug = ?').get(req.params.slug);
    if (!event) return res.status(404).json({ error: 'Event not found.' });
    const membership = db.prepare('SELECT * FROM event_members WHERE event_id = ? AND user_id = ?').get(event.id, req.user.id);
    if (!membership) return res.status(403).json({ error: 'Join this event before saving travel preferences.' });
    const parsed = travelSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(res, parsed);
    const data = parsed.data;
    if (data.lookingForCompanion && (!req.user.gender || parseJson(req.user.match_genders, []).length === 0)) return res.status(409).json({ error: 'Complete your profile and choose who you are comfortable travelling with before turning on matching.' });
    if (data.modes.includes('Car')) {
      if (data.carIntent === 'offering' && data.seats < 1) return res.status(400).json({ error: 'Add at least one available seat to offer a carpool.' });
      if (data.carIntent === 'offering' && !data.willingToShare) return res.status(400).json({ error: 'Confirm that you are willing to share travel before offering seats.' });
    }
    const travel = { ...data, modes: [...new Set(data.modes)] };
    const save = db.transaction(() => {
      db.prepare(`UPDATE users SET city = CASE WHEN ? <> '' THEN ? ELSE city END, locality = CASE WHEN ? <> '' THEN ? ELSE locality END WHERE id = ?`).run(data.city, data.city, data.locality, data.locality, req.user.id);
      db.prepare('UPDATE event_members SET travel = ? WHERE event_id = ? AND user_id = ?').run(JSON.stringify(travel), event.id, req.user.id);
    });
    save();
    res.json({ travel });
  });

  app.get('/api/my/events', requireAuth, (req, res) => {
    const rows = db.prepare(`SELECT e.*, em.travel, em.joined_at FROM event_members em JOIN events e ON e.id = em.event_id WHERE em.user_id = ? ORDER BY e.event_date ASC`).all(req.user.id);
    const owned = db.prepare(`SELECT e.* FROM events e WHERE e.owner_id = ? ORDER BY e.event_date ASC`).all(req.user.id);
    const joinedEvents = rows.map((row) => ({ ...baseEvent(db, row, req.user.id), joinedAt: row.joined_at, travel: readTravel(row) }));
    const ownerEvents = owned.map((event) => baseEvent(db, event, req.user.id));
    res.json({ events: joinedEvents, ownedEvents: ownerEvents });
  });

  app.get('/api/events/:slug/announcements', (req, res) => {
    const event = db.prepare('SELECT * FROM events WHERE slug = ?').get(req.params.slug);
    if (!event) return res.status(404).json({ error: 'Event not found.' });
    const announcements = db.prepare(`SELECT a.id, a.body, a.created_at AS createdAt, u.name AS authorName FROM announcements a JOIN users u ON u.id = a.author_id WHERE a.event_id = ? ORDER BY a.created_at DESC`).all(event.id);
    res.json({ announcements });
  });

  app.post('/api/events/:slug/announcements', requireCoordinator, (req, res) => {
    const event = db.prepare('SELECT * FROM events WHERE slug = ?').get(req.params.slug);
    if (!event) return res.status(404).json({ error: 'Event not found.' });
    if (event.owner_id !== req.user.id) return res.status(403).json({ error: 'Only this event coordinator can publish an announcement.' });
    const parsed = announcementSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(res, parsed);
    const announcementId = id();
    const created = now();
    db.prepare('INSERT INTO announcements (id, event_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)').run(announcementId, event.id, req.user.id, parsed.data.body, created);
    res.status(201).json({ announcement: { id: announcementId, body: parsed.data.body, createdAt: created, authorName: req.user.name } });
  });

  app.get('/api/events/:slug/matches', requireAuth, (req, res) => {
    expireRequests(db, req.user.id);
    const event = db.prepare('SELECT * FROM events WHERE slug = ?').get(req.params.slug);
    if (!event) return res.status(404).json({ error: 'Event not found.' });
    const member = db.prepare('SELECT * FROM event_members WHERE event_id = ? AND user_id = ?').get(event.id, req.user.id);
    if (!member) return res.status(403).json({ error: 'Join this event before exploring travel matches.' });
    if (event.status !== 'active') return res.status(409).json({ error: 'This event is not active.' });
    const ownTravel = readTravel(member);
    if (ownTravel.lookingForCompanion !== true) return res.json({ matches: [], eligible: false, message: 'Turn on “Looking for a travel companion” in your travel preferences to see compatible attendees. Joining the community does not opt you into matching.' });
    const candidates = db.prepare(`SELECT u.id FROM event_members em JOIN users u ON u.id = em.user_id WHERE em.event_id = ? AND u.id <> ? ORDER BY em.joined_at ASC`).all(event.id, req.user.id);
    const matches = [];
    for (const candidate of candidates) {
      const eligible = pairEligibility(db, event.id, req.user.id, candidate.id);
      if (!eligible) continue;
      const otherTravel = eligible.second.id === candidate.id ? eligible.secondTravel : eligible.firstTravel;
      matches.push(anonymousTravel(db, req.user.id, candidate.id, event.id, otherTravel, event.name, eligible.reasons));
    }
    matches.sort((a, b) => b.reasons.length - a.reasons.length);
    return res.json({ matches, eligible: true, message: matches.length ? '' : 'No compatible attendees yet. Matches are based on real members of this event; try again later if plans change.' });
  });

  app.post('/api/requests', requireAuth, requestLimiter, (req, res) => {
    expireRequests(db, req.user.id);
    const parsed = requestCreateSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(res, parsed);
    const ref = findUserRef(db, req.user.id, parsed.data.userRef);
    if (!ref) return res.status(404).json({ error: 'That anonymous match is no longer available. Refresh recommendations.' });
    const eligible = pairEligibility(db, ref.event_id, req.user.id, ref.target_id);
    if (!eligible) return res.status(409).json({ error: 'This attendee is no longer an available compatible match.' });
    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(ref.event_id);
    const requestId = id();
    const created = now();
    db.prepare(`INSERT INTO connection_requests (id, event_id, requester_id, recipient_id, status, created_at, requester_consented_at, expires_at) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`)
      .run(requestId, ref.event_id, req.user.id, ref.target_id, created, created, new Date(Date.now() + requestTtlDays * 86_400_000).toISOString());
    return res.status(201).json({ request: { id: requestId, status: 'pending', eventName: event.name }, senderConsentRecorded: true });
  });

  app.get('/api/requests', requireAuth, (req, res) => {
    expireRequests(db, req.user.id);
    const rows = db.prepare(`
      SELECT r.*, e.name AS event_name, e.slug AS event_slug,
        CASE WHEN r.requester_id = ? THEN r.recipient_id ELSE r.requester_id END AS counterpart_id,
        CASE WHEN r.requester_id = ? THEN 'outgoing' ELSE 'incoming' END AS direction
      FROM connection_requests r JOIN events e ON e.id = r.event_id
      WHERE (r.requester_id = ? OR r.recipient_id = ?) AND r.status <> 'accepted'
      ORDER BY r.created_at DESC
    `).all(req.user.id, req.user.id, req.user.id, req.user.id);
    const incoming = [];
    const outgoing = [];
    for (const row of rows) {
      const targetMember = db.prepare('SELECT travel FROM event_members WHERE event_id = ? AND user_id = ?').get(row.event_id, row.counterpart_id);
      const travel = readTravel(targetMember);
      const other = anonymousTravel(db, req.user.id, row.counterpart_id, row.event_id, travel, row.event_name);
      const item = {
        id: row.id,
        direction: row.direction,
        status: row.status,
        eventName: row.event_name,
        eventSlug: row.event_slug,
        alias: other.alias,
        city: other.city,
        approximateLocality: other.approximateLocality,
        modes: other.modes,
        travelDate: other.travelDate,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        counterpartRef: other.userRef,
      };
      (row.direction === 'incoming' ? incoming : outgoing).push(item);
    }
    res.json({ incoming, outgoing });
  });

  app.post('/api/requests/:requestId/respond', requireAuth, (req, res) => {
    expireRequests(db, req.user.id);
    const parsed = responseSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(res, parsed);
    const request = participantRequest(db, req.params.requestId, req.user.id);
    if (!request || request.recipient_id !== req.user.id) return res.status(404).json({ error: 'Request not found.' });
    if (request.status !== 'pending') return res.status(409).json({ error: 'This request is no longer pending.' });
    if (parsed.data.action === 'decline') {
      db.prepare(`UPDATE connection_requests SET status = 'declined', responded_at = ? WHERE id = ? AND status = 'pending'`).run(now(), request.id);
      return res.json({ status: 'declined' });
    }
      const eligible = pairEligibility(db, request.event_id, request.requester_id, request.recipient_id, request.id);
    if (!eligible) return res.status(409).json({ error: 'This connection is no longer compatible or available.' });
    const recipientConsent = now();
    const update = db.prepare(`UPDATE connection_requests SET status = 'accepted', responded_at = ?, recipient_consented_at = ? WHERE id = ? AND status = 'pending' AND requester_consented_at IS NOT NULL`);
    const result = update.run(recipientConsent, recipientConsent, request.id);
    if (!result.changes) return res.status(409).json({ error: 'This request has already been handled.' });
    return res.json({ status: 'accepted', recipientConsentRecorded: true, reveal: 'Identity and approved profile details are now available to both attendees. Private chat is open.' });
  });

  app.post('/api/requests/:requestId/cancel', requireAuth, (req, res) => {
    const request = participantRequest(db, req.params.requestId, req.user.id);
    if (!request || request.requester_id !== req.user.id) return res.status(404).json({ error: 'Request not found.' });
    if (request.status !== 'pending') return res.status(409).json({ error: 'Only a pending request can be cancelled.' });
    db.prepare(`UPDATE connection_requests SET status = 'cancelled', responded_at = ? WHERE id = ? AND status = 'pending'`).run(now(), request.id);
    res.json({ status: 'cancelled' });
  });

  app.get('/api/connections', requireAuth, (req, res) => {
    const rows = db.prepare(`SELECT r.*, e.name AS event_name, e.slug AS event_slug,
      CASE WHEN r.requester_id = ? THEN r.recipient_id ELSE r.requester_id END AS partner_id
      FROM connection_requests r JOIN events e ON e.id = r.event_id
      WHERE (r.requester_id = ? OR r.recipient_id = ?) AND r.status = 'accepted'
        AND r.requester_consented_at IS NOT NULL AND r.recipient_consented_at IS NOT NULL
      ORDER BY r.responded_at DESC`).all(req.user.id, req.user.id, req.user.id);
    const connections = rows.filter((row) => !isBlocked(db, req.user.id, row.partner_id)).map((row) => {
      const partner = db.prepare('SELECT * FROM users WHERE id = ?').get(row.partner_id);
      return {
        id: row.id,
        eventName: row.event_name,
        eventSlug: row.event_slug,
        acceptedAt: row.responded_at,
        counterpartRef: ensureUserRef(db, req.user.id, row.partner_id, row.event_id),
        profile: publicProfile(partner),
        unreadCount: db.prepare(`SELECT COUNT(*) AS count FROM messages WHERE request_id = ? AND sender_id <> ? AND read_at IS NULL`).get(row.id, req.user.id).count,
      };
    });
    res.json({ connections });
  });

  app.get('/api/connections/:requestId/messages', requireAuth, (req, res) => {
    const request = requireAccepted(db, req.params.requestId, req.user.id);
    if (!request) return res.status(403).json({ error: 'Chat is available only to accepted, unblocked connections.' });
    db.prepare('UPDATE messages SET read_at = ? WHERE request_id = ? AND sender_id <> ? AND read_at IS NULL').run(now(), request.id, req.user.id);
    const messages = db.prepare('SELECT id, sender_id, body, created_at, read_at FROM messages WHERE request_id = ? ORDER BY created_at ASC').all(request.id)
      .map((message) => ({ id: message.id, fromMe: message.sender_id === req.user.id, body: message.body, createdAt: message.created_at, readAt: message.read_at }));
    res.json({ messages });
  });

  app.post('/api/connections/:requestId/messages', requireAuth, requestLimiter, (req, res) => {
    const request = requireAccepted(db, req.params.requestId, req.user.id);
    if (!request) return res.status(403).json({ error: 'Chat is available only to accepted, unblocked connections.' });
    const parsed = messageSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(res, parsed);
    const messageId = id();
    const created = now();
    db.prepare('INSERT INTO messages (id, request_id, sender_id, body, created_at) VALUES (?, ?, ?, ?, ?)').run(messageId, request.id, req.user.id, parsed.data.body, created);
    res.status(201).json({ message: { id: messageId, fromMe: true, body: parsed.data.body, createdAt: created, readAt: null } });
  });

  app.post('/api/connections/:requestId/disconnect', requireAuth, (req, res) => {
    const request = requireAccepted(db, req.params.requestId, req.user.id);
    if (!request) return res.status(403).json({ error: 'No active connection is available to disconnect.' });
    db.prepare(`UPDATE connection_requests SET status = 'disconnected', responded_at = ? WHERE id = ? AND status = 'accepted'`).run(now(), request.id);
    res.json({ status: 'disconnected' });
  });

  app.post('/api/blocks', requireAuth, (req, res) => {
    const parsed = z.object({ userRef: z.string().uuid() }).safeParse(req.body);
    if (!parsed.success) return sendValidationError(res, parsed);
    const ref = findUserRef(db, req.user.id, parsed.data.userRef);
    if (!ref || ref.target_id === req.user.id) return res.status(404).json({ error: 'Attendee not found.' });
    const createdAt = now();
    db.prepare('INSERT OR IGNORE INTO blocks (id, blocker_id, blocked_id, created_at) VALUES (?, ?, ?, ?)').run(id(), req.user.id, ref.target_id, createdAt);
    db.prepare(`UPDATE connection_requests SET status = 'blocked', responded_at = ? WHERE status IN ('pending', 'accepted') AND ((requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?))`).run(createdAt, req.user.id, ref.target_id, ref.target_id, req.user.id);
    res.json({ blocked: true });
  });

  app.get('/api/blocks', requireAuth, (req, res) => {
    const rows = db.prepare('SELECT * FROM blocks WHERE blocker_id = ? ORDER BY created_at DESC').all(req.user.id);
    const blocks = rows.map((row) => ({ id: row.id, createdAt: row.created_at }));
    res.json({ blocks });
  });

  app.delete('/api/blocks/:blockId', requireAuth, (req, res) => {
    const result = db.prepare('DELETE FROM blocks WHERE blocker_id = ? AND id = ?').run(req.user.id, req.params.blockId);
    if (!result.changes) return res.status(404).json({ error: 'Block not found.' });
    res.json({ unblocked: true });
  });

  app.post('/api/reports', requireAuth, requestLimiter, (req, res) => {
    const parsed = reportSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(res, parsed);
    const ref = findUserRef(db, req.user.id, parsed.data.userRef);
    if (!ref || ref.target_id === req.user.id) return res.status(404).json({ error: 'Attendee not found.' });
    if (parsed.data.requestId) {
      const request = participantRequest(db, parsed.data.requestId, req.user.id);
      if (!request || ![request.requester_id, request.recipient_id].includes(ref.target_id)) return res.status(404).json({ error: 'Conversation context not found.' });
    }
    const reportId = id();
    db.prepare('INSERT INTO reports (id, reporter_id, target_id, event_id, request_id, reason, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(reportId, req.user.id, ref.target_id, ref.event_id === 'blocks' ? null : ref.event_id, parsed.data.requestId || null, parsed.data.reason, parsed.data.details, now());
    res.status(201).json({ submitted: true, message: 'Report submitted. It is private and cannot be viewed by the reported attendee.' });
  });

  app.get('/api/coordinator/dashboard', requireCoordinator, (req, res) => {
    const events = db.prepare('SELECT * FROM events WHERE owner_id = ? ORDER BY event_date ASC').all(req.user.id);
    const dashboard = events.map((event) => {
      const attendees = db.prepare(`SELECT u.name, u.city, em.travel FROM event_members em JOIN users u ON u.id = em.user_id WHERE em.event_id = ? ORDER BY em.joined_at ASC`).all(event.id)
        .map((attendee) => {
          const travel = parseJson(attendee.travel, {});
          return { name: attendee.name, city: attendee.city || travel.city || 'Not provided', modes: Array.isArray(travel.modes) ? travel.modes : [], lookingForCompanion: travel.lookingForCompanion === true };
        });
      const byCity = {};
      const byMode = {};
      for (const attendee of attendees) {
        byCity[attendee.city] = (byCity[attendee.city] || 0) + 1;
        for (const mode of attendee.modes) byMode[mode] = (byMode[mode] || 0) + 1;
      }
      return {
        event: baseEvent(db, event, req.user.id),
        attendees,
        aggregates: { byCity, byMode },
        announcements: db.prepare('SELECT COUNT(*) AS count FROM announcements WHERE event_id = ?').get(event.id).count,
      };
    });
    res.json({ events: dashboard });
  });

  const distDirectory = path.resolve(process.cwd(), 'dist');
  if (fs.existsSync(path.join(distDirectory, 'index.html'))) {
    app.use(express.static(distDirectory, { index: false }));
    app.get(/^\/(?!api(?:\/|$)).*/, (_req, res, next) => {
      res.sendFile(path.join(distDirectory, 'index.html'), (error) => error && next(error));
    });
  }

  app.use((req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use((error, _req, res, _next) => {
    if (res.headersSent) return;
    console.error('[meetups-api]', error?.message || error);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });

  return { app, db };
}
