import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from './app.js';

let tempDir;
let db;
let server;
let origin;
let users;
let event;
let acceptedRequestId;

async function request(pathname, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(`${origin}${pathname}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function register(name, role = 'attendee') {
  const email = `${name.toLowerCase()}@test.invalid`;
  const { response, payload } = await request('/api/auth/register', {
    method: 'POST', body: { email, password: 'local-test-pass-123', name, role },
  });
  assert.equal(response.status, 201, JSON.stringify(payload));
  const setCookie = response.headers.get('set-cookie');
  const cookie = setCookie.match(/meetups_session=[^;]+/)[0];
  return { name, email, cookie, id: payload.user.id };
}

async function saveProfile(user, { gender = 'woman', matchGenders = ['woman'], name = user.name, visibility = {} } = {}) {
  const { response, payload } = await request('/api/profile', {
    method: 'PUT', cookie: user.cookie,
    body: {
      name, gender, city: 'Kochi', locality: 'Kakkanad', bio: `${name} hello`, interests: ['travel'],
      profession: 'Research', languages: ['English'], matchGenders,
      visibility: { city: true, bio: true, interests: true, profession: false, languages: true, gender: false, ...visibility },
    },
  });
  assert.equal(response.status, 200, JSON.stringify(payload));
}

async function joinAndSetTravel(user, modes = ['Train']) {
  const join = await request(`/api/events/${event.slug}/join`, { method: 'POST', cookie: user.cookie, body: {} });
  assert.ok([201, 200].includes(join.response.status), JSON.stringify(join.payload));
  const result = await request(`/api/events/${event.slug}/travel`, {
    method: 'PUT', cookie: user.cookie,
    body: {
      city: 'Kochi', locality: 'Kakkanad', modes, travelDate: event.eventDate, departureTime: '08:00',
      lookingForCompanion: true, willingToShare: false, carIntent: '', seats: 0, meetingPoint: '', details: '',
    },
  });
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
}

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meetups-test-'));
  const created = createApp({ dbFile: path.join(tempDir, 'test.sqlite'), sessionSecret: 'test-session-secret-not-for-production' });
  db = created.db;
  server = created.app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;

  users = {
    coordinator: await register('Coordinator', 'coordinator'),
    alice: await register('Alice'),
    bea: await register('Bea'),
    carl: await register('Carl'),
  };
  await saveProfile(users.coordinator, { gender: 'woman', matchGenders: ['woman'] });
  await saveProfile(users.alice, { gender: 'woman', matchGenders: ['woman'], name: 'Alice Example', visibility: { profession: false } });
  await saveProfile(users.bea, { gender: 'woman', matchGenders: ['woman'], name: 'Bea Example', visibility: { profession: false } });
  await saveProfile(users.carl, { gender: 'man', matchGenders: ['woman'], name: 'Carl Example' });

  const create = await request('/api/events', {
    method: 'POST', cookie: users.coordinator.cookie,
    body: {
      name: 'Test Conference', description: 'A real event created by this test.', category: 'Technology', coverUrl: '',
      venueName: 'Civic Hall', venueAddress: 'Bengaluru', mapUrl: 'https://maps.example.test/event', eventDate: '2027-03-12',
      startTime: '09:00', endTime: '', registrationLink: '', capacity: null, visibility: 'public',
      organizerName: 'Test Organizer', organizerContact: 'private-contact@example.test',
    },
  });
  assert.equal(create.response.status, 201, JSON.stringify(create.payload));
  event = create.payload.event;
  await joinAndSetTravel(users.coordinator);
  await joinAndSetTravel(users.alice);
  await joinAndSetTravel(users.bea);
  await joinAndSetTravel(users.carl);
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  db?.close();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

test('public event hides organizer contact and coordinator data is access-controlled', async () => {
  const publicPage = await request(`/api/events/${event.slug}`);
  assert.equal(publicPage.response.status, 200);
  assert.equal(publicPage.payload.event.organizerContact, undefined);
  assert.equal(publicPage.payload.event.memberCount, 4);
  const attendeeDashboard = await request('/api/coordinator/dashboard', { cookie: users.alice.cookie });
  assert.equal(attendeeDashboard.response.status, 403);
  const coordinatorDashboard = await request('/api/coordinator/dashboard', { cookie: users.coordinator.cookie });
  assert.equal(coordinatorDashboard.response.status, 200);
  assert.equal(coordinatorDashboard.payload.events[0].attendees.length, 4);
  assert.equal(JSON.stringify(coordinatorDashboard.payload).includes(users.alice.email), false);
});

test('matching uses real same-event members and requires mutual gender preferences', async () => {
  const response = await request(`/api/events/${event.slug}/matches`, { cookie: users.alice.cookie });
  assert.equal(response.response.status, 200);
  assert.equal(response.payload.matches.length, 2, JSON.stringify(response.payload));
  const aliases = response.payload.matches.map((match) => match.alias);
  assert.ok(aliases.includes('Someone from Kochi'));
  assert.equal(JSON.stringify(response.payload).includes('Carl Example'), false);
  assert.equal(JSON.stringify(response.payload).includes(users.bea.email), false);
  const blockedByPreference = db.prepare('SELECT id FROM users WHERE email = ?').get(users.carl.email).id;
  assert.equal(response.payload.matches.some((match) => match.userRef === blockedByPreference), false);
  for (const match of response.payload.matches) {
    assert.equal('name' in match, false);
    assert.equal('email' in match, false);
    assert.equal('id' in match, false);
    assert.equal('profile' in match, false);
  }
});

test('recipient inbox stays anonymous; only recorded acceptance unlocks reveal and chat', async () => {
  const recommendations = await request(`/api/events/${event.slug}/matches`, { cookie: users.alice.cookie });
  const beaId = db.prepare('SELECT id FROM users WHERE email = ?').get(users.bea.email).id;
  const beaMatch = recommendations.payload.matches.find((match) => db.prepare('SELECT target_id FROM recommendation_refs WHERE ref = ?').get(match.userRef)?.target_id === beaId);
  assert.ok(beaMatch);
  const withoutConsent = await request('/api/requests', { method: 'POST', cookie: users.alice.cookie, body: { userRef: beaMatch.userRef } });
  assert.equal(withoutConsent.response.status, 400);
  const sent = await request('/api/requests', { method: 'POST', cookie: users.alice.cookie, body: { userRef: beaMatch.userRef, consentConfirmed: true } });
  assert.equal(sent.response.status, 201, JSON.stringify(sent.payload));
  const requestId = sent.payload.request.id;
  acceptedRequestId = requestId;

  const inbox = await request('/api/requests', { cookie: users.bea.cookie });
  assert.equal(inbox.response.status, 200);
  const incoming = inbox.payload.incoming.find((item) => item.id === requestId);
  assert.ok(incoming);
  const incomingText = JSON.stringify(incoming);
  assert.equal(incomingText.includes('Alice Example'), false);
  assert.equal(incomingText.includes(users.alice.email), false);
  assert.equal(incomingText.includes(users.alice.id), false);
  assert.equal(incoming.requesterId, undefined);

  const prematureChat = await request(`/api/connections/${requestId}/messages`, { cookie: users.alice.cookie });
  assert.equal(prematureChat.response.status, 403);
  assert.equal(prematureChat.payload.messages, undefined);

  const accepted = await request(`/api/requests/${requestId}/respond`, { method: 'POST', cookie: users.bea.cookie, body: { action: 'accept' } });
  assert.equal(accepted.response.status, 200);
  assert.equal(accepted.payload.status, 'accepted');
  const consent = db.prepare('SELECT requester_consented_at, recipient_consented_at FROM connection_requests WHERE id = ?').get(requestId);
  assert.ok(consent.requester_consented_at);
  assert.ok(consent.recipient_consented_at);
  const aliceConnections = await request('/api/connections', { cookie: users.alice.cookie });
  const connection = aliceConnections.payload.connections.find((item) => item.id === requestId);
  assert.equal(connection.profile.name, 'Bea Example');
  assert.equal(connection.profile.email, undefined);
  assert.equal(connection.profile.profession, undefined);

  const sentMessage = await request(`/api/connections/${requestId}/messages`, { method: 'POST', cookie: users.alice.cookie, body: { body: 'Hello, see you at the event.' } });
  assert.equal(sentMessage.response.status, 201);
  const beaChat = await request(`/api/connections/${requestId}/messages`, { cookie: users.bea.cookie });
  assert.equal(beaChat.response.status, 200);
  assert.equal(beaChat.payload.messages.length, 1);
  assert.equal(beaChat.payload.messages[0].body, 'Hello, see you at the event.');
  const thirdPartyChat = await request(`/api/connections/${requestId}/messages`, { cookie: users.carl.cookie });
  assert.equal(thirdPartyChat.response.status, 403);
});

test('blocks close requests and chat on the server without returning the other identity', async () => {
  const connectionResponse = await request('/api/connections', { cookie: users.alice.cookie });
  const connection = connectionResponse.payload.connections.find((item) => item.id === acceptedRequestId);
  assert.ok(connection?.counterpartRef);
  const reported = await request('/api/reports', { method: 'POST', cookie: users.alice.cookie, body: { userRef: connection.counterpartRef, reason: 'safety', details: 'Test report only.', requestId: connection.id } });
  assert.equal(reported.response.status, 201);
  const savedReport = db.prepare('SELECT reporter_id, target_id, request_id, status FROM reports WHERE request_id = ?').get(connection.id);
  assert.equal(savedReport.reporter_id, users.alice.id);
  assert.equal(savedReport.target_id, users.bea.id);
  assert.equal(savedReport.status, 'open');
  const blocked = await request('/api/blocks', { method: 'POST', cookie: users.alice.cookie, body: { userRef: connection.counterpartRef } });
  assert.equal(blocked.response.status, 200);
  const chat = await request(`/api/connections/${connection.id}/messages`, { cookie: users.bea.cookie });
  assert.equal(chat.response.status, 403);
  const matches = await request(`/api/events/${event.slug}/matches`, { cookie: users.alice.cookie });
  assert.equal(matches.payload.matches.some((match) => db.prepare('SELECT target_id FROM recommendation_refs WHERE ref = ?').get(match.userRef)?.target_id === db.prepare('SELECT id FROM users WHERE email = ?').get(users.bea.email).id), false);
});

test('private event invite links show details but stay out of public browsing; unsafe map links are rejected', async () => {
  const eventBody = {
    name: 'Private Test Gathering', description: 'A private invitation with details.', category: 'Community', coverUrl: '',
    venueName: 'Community Hall', venueAddress: 'Kochi', mapUrl: 'javascript:alert(1)', eventDate: '2027-04-10',
    startTime: '10:00', endTime: '', registrationLink: '', capacity: null, visibility: 'private',
    organizerName: 'Test Organizer', organizerContact: 'private@example.test',
  };
  const unsafe = await request('/api/events', { method: 'POST', cookie: users.coordinator.cookie, body: eventBody });
  assert.equal(unsafe.response.status, 400);
  const created = await request('/api/events', { method: 'POST', cookie: users.coordinator.cookie, body: { ...eventBody, mapUrl: 'https://maps.example.test/private-event' } });
  assert.equal(created.response.status, 201, JSON.stringify(created.payload));
  const invitePage = await request(`/api/events/${created.payload.event.slug}`);
  assert.equal(invitePage.response.status, 200);
  assert.equal(invitePage.payload.event.visibility, 'private');
  const publicEvents = await request('/api/events');
  assert.equal(publicEvents.payload.events.some((item) => item.slug === created.payload.event.slug), false);
});

test('invalid profile fields are rejected and attendees cannot create events', async () => {
  const invalid = await request('/api/profile', { method: 'PUT', cookie: users.alice.cookie, body: { name: '', gender: 'unknown', city: '' } });
  assert.equal(invalid.response.status, 400);
  const denied = await request('/api/events', { method: 'POST', cookie: users.alice.cookie, body: {} });
  assert.equal(denied.response.status, 403);
});
