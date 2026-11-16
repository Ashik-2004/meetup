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

async function request(pathname, { method = 'GET', body, cookie, headers = {} } = {}) {
  const response = await fetch(`${origin}${pathname}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function register(name) {
  const email = `${name.toLowerCase()}@test.invalid`;
  const { response, payload } = await request('/api/auth/register', {
    method: 'POST', body: { email, password: 'local-test-pass-123', name },
  });
  assert.equal(response.status, 201, JSON.stringify(payload));
  const setCookie = response.headers.get('set-cookie');
  const cookie = setCookie.match(/meetups_session=[^;]+/)[0];
  return { name, email, cookie, id: payload.user.id, role: payload.user.role };
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

async function createFixtureEvent(owner, name, visibility = 'public', { date = '2027-06-15', startTime = '09:00', endTime = '', coverUrl = '', registrationLink = '', capacity = null, description = `Synthetic ${name} event.` } = {}) {
  return request('/api/events', {
    method: 'POST', cookie: owner.cookie,
    body: { name, description, category: 'QA', coverUrl, venueName: 'Test Hall', venueAddress: 'Test City', mapUrl: 'https://maps.example.test/test', eventDate: date, startTime, endTime, registrationLink, capacity, visibility, organizerName: 'Synthetic Organizer', organizerContact: '' },
  });
}

async function joinAndSetTravelInEvent(user, eventRecord, locality) {
  const joined = await request(`/api/events/${eventRecord.slug}/join`, { method: 'POST', cookie: user.cookie, body: {} });
  assert.ok([200, 201].includes(joined.response.status), JSON.stringify(joined.payload));
  const saved = await request(`/api/events/${eventRecord.slug}/travel`, { method: 'PUT', cookie: user.cookie, body: { city: 'Kochi', locality, modes: ['Train'], travelDate: eventRecord.eventDate, departureTime: '08:00', lookingForCompanion: true } });
  assert.equal(saved.response.status, 200, JSON.stringify(saved.payload));
}

function databaseEventId(eventRecord) {
  return db.prepare('SELECT id FROM events WHERE slug = ?').get(eventRecord.slug).id;
}

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meetups-test-'));
  const created = createApp({ dbFile: path.join(tempDir, 'test.sqlite'), sessionSecret: 'test-session-secret-not-for-production' });
  db = created.db;
  server = created.app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;

  users = {
    coordinator: await register('Coordinator'),
    alice: await register('Alice'),
    bea: await register('Bea'),
    carl: await register('Carl'),
    moderator: await register('Moderator'),
  };
  db.prepare("UPDATE users SET role = 'coordinator' WHERE id = ?").run(users.coordinator.id);
  db.prepare('INSERT INTO moderators (user_id, provisioned_at) VALUES (?, ?)').run(users.moderator.id, new Date().toISOString());
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
  const dashboardEvent = coordinatorDashboard.payload.events[0];
  assert.deepEqual(Object.keys(dashboardEvent).sort(), ['aggregates', 'announcements', 'attendees', 'event'].sort());
  assert.deepEqual([...dashboardEvent.attendees].sort(), ['Coordinator', 'Alice Example', 'Bea Example', 'Carl Example'].sort());
  assert.ok(dashboardEvent.attendees.every((attendee) => typeof attendee === 'string'));
  assert.equal(dashboardEvent.aggregates.suppressed, true);
  assert.deepEqual(dashboardEvent.aggregates.byCity, {});
  assert.deepEqual(dashboardEvent.aggregates.byMode, {});
  assert.equal(JSON.stringify(coordinatorDashboard.payload).includes(users.alice.email), false);
  assert.equal(JSON.stringify(coordinatorDashboard.payload).includes('Alice Example hello'), false);
  assert.equal(JSON.stringify(coordinatorDashboard.payload).includes('Kakkanad'), false);
  assert.equal(JSON.stringify(coordinatorDashboard.payload).includes('Train'), false);
  assert.equal(JSON.stringify(coordinatorDashboard.payload).includes('Research'), false);
  assert.equal(JSON.stringify(coordinatorDashboard.payload).includes('private-contact@example.test'), false);
  assert.equal(JSON.stringify(coordinatorDashboard.payload).includes('lookingForCompanion'), false);
  const dashboardPage = await request('/api/coordinator/dashboard?limit=1&offset=0', { cookie: users.coordinator.cookie });
  assert.equal(dashboardPage.response.status, 200);
  assert.equal(dashboardPage.payload.events.length, 1);
  assert.equal(dashboardPage.payload.nextOffset, 1);
});

test('public registration cannot self-assign coordinator access and exact origin checks stay enabled', async () => {
  const tampered = await request('/api/auth/register', { method: 'POST', headers: { Origin: origin }, body: { email: 'self-promotion@test.invalid', password: 'local-test-pass-123', name: 'Self Promotion', role: 'coordinator' } });
  assert.equal(tampered.response.status, 400);
  const attendee = await request('/api/auth/register', { method: 'POST', headers: { Origin: origin }, body: { email: 'ordinary-attendee@test.invalid', password: 'local-test-pass-123', name: 'Ordinary Attendee' } });
  assert.equal(attendee.response.status, 201, JSON.stringify(attendee.payload));
  assert.equal(attendee.payload.user.role, 'attendee');
  const attendeeCookie = attendee.response.headers.get('set-cookie').match(/meetups_session=[^;]+/)[0];
  const ownProfile = await request('/api/me', { cookie: attendeeCookie });
  assert.equal(ownProfile.payload.user.gender, null);
  assert.equal(ownProfile.payload.user.city, '');
  assert.deepEqual(ownProfile.payload.user.matchGenders, []);
  const joinedWithoutProfile = await request(`/api/events/${event.slug}/join`, { method: 'POST', cookie: attendeeCookie, body: {} });
  assert.equal(joinedWithoutProfile.response.status, 201);
  const denied = await request('/api/events', { method: 'POST', cookie: attendeeCookie, body: {} });
  assert.equal(denied.response.status, 403);
  const foreignOrigin = await request('/api/auth/register', { method: 'POST', headers: { Origin: 'https://attacker.example' }, body: { email: 'foreign-origin@test.invalid', password: 'local-test-pass-123', name: 'Foreign Origin' } });
  assert.equal(foreignOrigin.response.status, 403);
  const previewDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meetups-origin-test-'));
  const preview = createApp({ dbFile: path.join(previewDir, 'preview.sqlite'), sessionSecret: 'preview-origin-test-secret', trustedOrigins: 'https://preview.example.test' });
  const previewServer = preview.app.listen(0, '127.0.0.1');
  await new Promise((resolve) => previewServer.once('listening', resolve));
  try {
    const previewResponse = await fetch(`http://127.0.0.1:${previewServer.address().port}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://preview.example.test' }, body: JSON.stringify({ email: 'preview-origin@test.invalid', password: 'local-test-pass-123', name: 'Preview Origin' }) });
    assert.equal(previewResponse.status, 201);
    const previewRejected = await fetch(`http://127.0.0.1:${previewServer.address().port}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://other-preview.example.test' }, body: JSON.stringify({ email: 'other-preview@test.invalid', password: 'local-test-pass-123', name: 'Other Preview' }) });
    assert.equal(previewRejected.status, 403);
  } finally {
    await new Promise((resolve) => previewServer.close(resolve)); preview.db.close(); fs.rmSync(previewDir, { recursive: true, force: true });
  }
});

test('event lists and match candidates enforce bounded pagination', async () => {
  const first = await request('/api/events?limit=1&offset=0', { cookie: users.alice.cookie });
  assert.equal(first.response.status, 200);
  assert.equal(first.payload.events.length, 1);
  assert.equal(first.payload.nextOffset, 1);
  const next = await request('/api/events?limit=1&offset=1', { cookie: users.alice.cookie });
  assert.equal(next.response.status, 200);
  assert.equal(next.payload.events.length, 0);
  assert.equal(next.payload.nextOffset, null);
  assert.equal((await request('/api/events?limit=51')).response.status, 400);
  assert.equal((await request('/api/events?offset=-1')).response.status, 400);
  const tooManyMatches = await request(`/api/events/${event.slug}/matches?limit=51`, { cookie: users.alice.cookie });
  assert.equal(tooManyMatches.response.status, 400);
});

test('coordinator attendee rosters are isolated per event and owner while aggregates remain thresholded', async () => {
  const secondaryCreated = await createFixtureEvent(users.coordinator, 'Same owner secondary event');
  assert.equal(secondaryCreated.response.status, 201, JSON.stringify(secondaryCreated.payload));
  const secondaryEvent = secondaryCreated.payload.event;
  const eventOnlyAttendee = await register('EventTwoAttendee');
  await saveProfile(eventOnlyAttendee, { name: 'Event Two Attendee' });
  for (const member of [users.coordinator, users.alice, users.bea, users.carl, eventOnlyAttendee]) {
    await joinAndSetTravelInEvent(member, secondaryEvent, 'Kakkanad');
  }

  const otherCoordinator = await register('OtherCoordinator');
  db.prepare("UPDATE users SET role = 'coordinator' WHERE id = ?").run(otherCoordinator.id);
  const otherEventCreated = await createFixtureEvent(otherCoordinator, 'Other owner event');
  assert.equal(otherEventCreated.response.status, 201, JSON.stringify(otherEventCreated.payload));
  const otherEvent = otherEventCreated.payload.event;
  const otherOwnerAttendee = await register('OtherOwnerAttendee');
  await saveProfile(otherOwnerAttendee, { name: 'Other Owner Attendee' });
  await joinAndSetTravelInEvent(otherOwnerAttendee, otherEvent, 'Edapally');

  const ownerDashboard = await request('/api/coordinator/dashboard?limit=50&offset=0', { cookie: users.coordinator.cookie });
  assert.equal(ownerDashboard.response.status, 200);
  const ownEvents = new Map(ownerDashboard.payload.events.map((entry) => [entry.event.slug, entry]));
  assert.deepEqual([...ownEvents.keys()].sort(), [event.slug, secondaryEvent.slug].sort());
  assert.deepEqual([...ownEvents.get(secondaryEvent.slug).attendees].sort(), ['Coordinator', 'Alice Example', 'Bea Example', 'Carl Example', 'Event Two Attendee'].sort());
  assert.equal(ownEvents.get(event.slug).attendees.includes('Event Two Attendee'), false);
  assert.equal(ownEvents.get(secondaryEvent.slug).aggregates.suppressed, false);
  assert.deepEqual(ownEvents.get(secondaryEvent.slug).aggregates.byCity, { Kochi: 5 });
  assert.deepEqual(ownEvents.get(secondaryEvent.slug).aggregates.byMode, { Train: 5 });
  assert.equal(JSON.stringify(ownerDashboard.payload).includes('Other Owner Attendee'), false);

  const otherDashboard = await request('/api/coordinator/dashboard?limit=50&offset=0', { cookie: otherCoordinator.cookie });
  assert.equal(otherDashboard.response.status, 200);
  assert.deepEqual(otherDashboard.payload.events.map((entry) => entry.event.slug), [otherEvent.slug]);
  assert.deepEqual(otherDashboard.payload.events[0].attendees, ['Other Owner Attendee']);
  assert.equal(JSON.stringify(otherDashboard.payload).includes('Alice Example'), false);
  assert.equal(JSON.stringify(otherDashboard.payload).includes('Event Two Attendee'), false);
});

test('matching uses real same-event members and requires mutual gender preferences', async () => {
  const response = await request(`/api/events/${event.slug}/matches`, { cookie: users.alice.cookie });
  assert.equal(response.response.status, 200);
  assert.equal(response.payload.matches.length, 2, JSON.stringify(response.payload));
  const firstPage = await request(`/api/events/${event.slug}/matches?limit=1&offset=0`, { cookie: users.alice.cookie });
  assert.equal(firstPage.response.status, 200);
  assert.equal(firstPage.payload.matches.length, 1);
  assert.equal(firstPage.payload.nextOffset, 1);
  const secondPage = await request(`/api/events/${event.slug}/matches?limit=1&offset=1`, { cookie: users.alice.cookie });
  assert.equal(secondPage.response.status, 200);
  assert.equal(secondPage.payload.matches.length, 1);
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

test('clearing all matching preferences persists empty and turns matching off', async () => {
  await saveProfile(users.alice, { gender: 'woman', matchGenders: [] });
  const profile = await request('/api/me', { cookie: users.alice.cookie });
  assert.deepEqual(profile.payload.user.matchGenders, []);
  const membership = db.prepare('SELECT travel FROM event_members WHERE event_id = ? AND user_id = ?').get(databaseEventId(event), users.alice.id);
  assert.equal(JSON.parse(membership.travel).lookingForCompanion, false);
  const matches = await request(`/api/events/${event.slug}/matches`, { cookie: users.alice.cookie });
  assert.equal(matches.response.status, 200);
  assert.equal(matches.payload.eligible, false);
  assert.deepEqual(matches.payload.matches, []);
  await saveProfile(users.alice, { gender: 'woman', matchGenders: ['woman'], name: 'Alice Example' });
  await joinAndSetTravel(users.alice);
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
  const requestPage = await request('/api/requests?limit=1&offset=0', { cookie: users.bea.cookie });
  assert.equal(requestPage.response.status, 200);
  assert.equal(requestPage.payload.incoming.length + requestPage.payload.outgoing.length, 1);
  assert.equal(requestPage.payload.nextOffset, 1);

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
  const connectionPage = await request('/api/connections?limit=1&offset=0', { cookie: users.alice.cookie });
  assert.equal(connectionPage.response.status, 200);
  assert.equal(connectionPage.payload.connections.length, 1);
  assert.equal(connectionPage.payload.nextOffset, 1);

  const sentMessage = await request(`/api/connections/${requestId}/messages`, { method: 'POST', cookie: users.alice.cookie, body: { body: 'Hello, see you at the event.' } });
  assert.equal(sentMessage.response.status, 201);
  const beaChat = await request(`/api/connections/${requestId}/messages`, { cookie: users.bea.cookie });
  assert.equal(beaChat.response.status, 200);
  assert.equal(beaChat.payload.messages.length, 1);
  assert.equal(beaChat.payload.messages[0].body, 'Hello, see you at the event.');
  const messagePage = await request(`/api/connections/${requestId}/messages?limit=1&offset=0`, { cookie: users.alice.cookie });
  assert.equal(messagePage.response.status, 200);
  assert.equal(messagePage.payload.messages.length, 1);
  assert.equal(messagePage.payload.nextOffset, 1);
  const thirdPartyChat = await request(`/api/connections/${requestId}/messages`, { cookie: users.carl.cookie });
  assert.equal(thirdPartyChat.response.status, 403);
});

test('blocks close requests and chat on the server without returning the other identity', async () => {
  const aliceMatches = await request(`/api/events/${event.slug}/matches`, { cookie: users.alice.cookie });
  const coordinatorRef = aliceMatches.payload.matches.find((match) => db.prepare('SELECT target_id FROM recommendation_refs WHERE ref = ?').get(match.userRef)?.target_id === users.coordinator.id)?.userRef;
  assert.ok(coordinatorRef);
  const pending = await request('/api/requests', { method: 'POST', cookie: users.alice.cookie, body: { userRef: coordinatorRef, consentConfirmed: true } });
  assert.equal(pending.response.status, 201);
  const pendingId = pending.payload.request.id;
  assert.equal((await request('/api/blocks', { method: 'POST', cookie: users.alice.cookie, body: { userRef: coordinatorRef } })).response.status, 200);
  assert.equal(db.prepare('SELECT status FROM connection_requests WHERE id = ?').get(pendingId).status, 'blocked');
  const alicePendingInbox = await request('/api/requests?limit=20&offset=0', { cookie: users.alice.cookie });
  const coordinatorPendingInbox = await request('/api/requests?limit=20&offset=0', { cookie: users.coordinator.cookie });
  assert.equal(JSON.stringify(alicePendingInbox.payload).includes(pendingId), false);
  assert.equal(JSON.stringify(coordinatorPendingInbox.payload).includes(pendingId), false);
  assert.equal((await request(`/api/requests/${pendingId}/respond`, { method: 'POST', cookie: users.coordinator.cookie, body: { action: 'accept' } })).response.status, 409);
  const coordinatorBlock = (await request('/api/blocks', { cookie: users.alice.cookie })).payload.blocks[0];
  assert.ok(coordinatorBlock);
  assert.equal((await request(`/api/blocks/${coordinatorBlock.id}`, { method: 'DELETE', cookie: users.alice.cookie })).response.status, 200);
  for (const user of [users.alice, users.coordinator]) {
    const inboxAfterUnblock = await request('/api/requests?limit=20&offset=0', { cookie: user.cookie });
    assert.equal(JSON.stringify(inboxAfterUnblock.payload).includes(pendingId), false);
  }
  assert.equal(db.prepare('SELECT status FROM connection_requests WHERE id = ?').get(pendingId).status, 'blocked');

  const connectionResponse = await request('/api/connections', { cookie: users.alice.cookie });
  const connection = connectionResponse.payload.connections.find((item) => item.id === acceptedRequestId);
  assert.ok(connection?.counterpartRef);
  const reportBody = { userRef: connection.counterpartRef, reason: 'safety', details: 'Test report only.', requestId: connection.id };
  const reported = await request('/api/reports', { method: 'POST', cookie: users.alice.cookie, headers: { 'Idempotency-Key': 'safety-report-0001' }, body: reportBody });
  assert.equal(reported.response.status, 201);
  const replay = await request('/api/reports', { method: 'POST', cookie: users.alice.cookie, headers: { 'Idempotency-Key': 'safety-report-0001' }, body: reportBody });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.payload.duplicate, true);
  const duplicate = await request('/api/reports', { method: 'POST', cookie: users.alice.cookie, body: reportBody });
  assert.equal(duplicate.response.status, 200);
  assert.equal(duplicate.payload.duplicate, true);
  const keyConflict = await request('/api/reports', { method: 'POST', cookie: users.alice.cookie, headers: { 'Idempotency-Key': 'safety-report-0001' }, body: { ...reportBody, reason: 'spam' } });
  assert.equal(keyConflict.response.status, 409);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM reports WHERE reporter_id = ? AND request_id = ?').get(users.alice.id, connection.id).count, 1);
  const savedReport = db.prepare('SELECT reporter_id, target_id, request_id, status FROM reports WHERE request_id = ?').get(connection.id);
  assert.equal(savedReport.reporter_id, users.alice.id);
  assert.equal(savedReport.target_id, users.bea.id);
  assert.equal(savedReport.status, 'open');
  const blocked = await request('/api/blocks', { method: 'POST', cookie: users.alice.cookie, body: { userRef: connection.counterpartRef } });
  assert.equal(blocked.response.status, 200);
  const aliceRequests = await request('/api/requests?limit=1&offset=0', { cookie: users.alice.cookie });
  const beaRequests = await request('/api/requests?limit=1&offset=0', { cookie: users.bea.cookie });
  for (const page of [aliceRequests, beaRequests]) {
    const blockedItem = [...page.payload.incoming, ...page.payload.outgoing].find((item) => item.id === connection.id);
    assert.equal(blockedItem, undefined);
  }
  assert.equal((await request(`/api/requests/${connection.id}/respond`, { method: 'POST', cookie: users.bea.cookie, body: { action: 'accept' } })).response.status, 409);
  const chat = await request(`/api/connections/${connection.id}/messages`, { cookie: users.bea.cookie });
  assert.equal(chat.response.status, 403);
  const matches = await request(`/api/events/${event.slug}/matches`, { cookie: users.alice.cookie });
  assert.equal(matches.payload.matches.some((match) => db.prepare('SELECT target_id FROM recommendation_refs WHERE ref = ?').get(match.userRef)?.target_id === db.prepare('SELECT id FROM users WHERE email = ?').get(users.bea.email).id), false);
  const beaBlock = (await request('/api/blocks', { cookie: users.alice.cookie })).payload.blocks[0];
  assert.ok(beaBlock);
  assert.equal((await request(`/api/blocks/${beaBlock.id}`, { method: 'DELETE', cookie: users.alice.cookie })).response.status, 200);
  for (const user of [users.alice, users.bea]) {
    const inboxAfterUnblock = await request('/api/requests?limit=20&offset=0', { cookie: user.cookie });
    assert.equal(JSON.stringify(inboxAfterUnblock.payload).includes(connection.id), false);
  }
  assert.equal(db.prepare('SELECT status FROM connection_requests WHERE id = ?').get(connection.id).status, 'blocked');
});

test('report references cannot be combined with a request from another event', async () => {
  await saveProfile(users.alice, { gender: 'woman', matchGenders: ['woman', 'man'], name: 'Alice Example' });
  const otherEventResult = await createFixtureEvent(users.coordinator, 'Cross-event report context');
  assert.equal(otherEventResult.response.status, 201, JSON.stringify(otherEventResult.payload));
  const otherEvent = otherEventResult.payload.event;
  await joinAndSetTravelInEvent(users.alice, otherEvent, 'Area Alice');
  await joinAndSetTravelInEvent(users.carl, otherEvent, 'Area Carl');
  const matches = await request(`/api/events/${otherEvent.slug}/matches`, { cookie: users.alice.cookie });
  const carlRef = matches.payload.matches.find((match) => db.prepare('SELECT target_id FROM recommendation_refs WHERE ref = ?').get(match.userRef)?.target_id === users.carl.id)?.userRef;
  assert.ok(carlRef);
  const otherRequest = await request('/api/requests', { method: 'POST', cookie: users.alice.cookie, body: { userRef: carlRef, consentConfirmed: true } });
  assert.equal(otherRequest.response.status, 201);
  const originalMatches = await request(`/api/events/${event.slug}/matches`, { cookie: users.alice.cookie });
  const oldEventRef = originalMatches.payload.matches.find((match) => db.prepare('SELECT target_id FROM recommendation_refs WHERE ref = ?').get(match.userRef)?.target_id === users.carl.id)?.userRef;
  assert.ok(oldEventRef);
  const mismatched = await request('/api/reports', { method: 'POST', cookie: users.alice.cookie, body: { userRef: oldEventRef, reason: 'safety', details: 'Wrong event context.', requestId: otherRequest.payload.request.id } });
  assert.equal(mismatched.response.status, 404);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM reports WHERE details = ?').get('Wrong event context.').count, 0);
});

test('only provisioned moderators can review reports, with access and status changes audited', async () => {
  const report = db.prepare('SELECT id FROM reports WHERE request_id = ?').get(acceptedRequestId);
  assert.ok(report);
  assert.equal((await request('/api/moderation/reports', { cookie: users.alice.cookie })).response.status, 403);
  assert.equal((await request(`/api/moderation/reports/${report.id}`, { cookie: users.alice.cookie })).response.status, 403);
  assert.equal((await request(`/api/moderation/reports/${report.id}`, { method: 'PATCH', cookie: users.alice.cookie, body: { status: 'resolved' } })).response.status, 403);
  assert.equal((await request('/api/reports', { cookie: users.alice.cookie })).response.status, 404);
  const list = await request('/api/moderation/reports?limit=20&offset=0', { cookie: users.moderator.cookie });
  assert.equal(list.response.status, 200, JSON.stringify(list.payload));
  assert.ok(list.payload.reports.some((item) => item.id === report.id));
  const detail = await request(`/api/moderation/reports/${report.id}`, { cookie: users.moderator.cookie });
  assert.equal(detail.response.status, 200);
  assert.equal(detail.payload.report.reporterName, 'Alice Example');
  assert.equal(detail.payload.report.targetName, 'Bea Example');
  assert.equal(detail.payload.report.eventName, 'Test Conference');
  const review = await request(`/api/moderation/reports/${report.id}`, { method: 'PATCH', cookie: users.moderator.cookie, body: { status: 'reviewing' } });
  assert.equal(review.response.status, 200);
  const resolved = await request(`/api/moderation/reports/${report.id}`, { method: 'PATCH', cookie: users.moderator.cookie, body: { status: 'resolved' } });
  assert.equal(resolved.response.status, 200);
  assert.equal(db.prepare('SELECT status FROM reports WHERE id = ?').get(report.id).status, 'resolved');
  const reportAudit = db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE actor_user_id = ? AND entity_id = ? AND action IN ('report.view', 'report.status_changed')").get(users.moderator.id, report.id);
  const listAudit = db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE actor_user_id = ? AND action = 'reports.list'").get(users.moderator.id);
  assert.ok(reportAudit.count >= 3, `expected audit entries for report detail and status actions; got ${reportAudit.count}`);
  assert.ok(listAudit.count >= 1, 'expected moderator report-list access to be audited');
});

test('announcement reads require event membership or ownership; an owner may post without joining', async () => {
  const created = await createFixtureEvent(users.coordinator, 'Owner-only announcement', 'private');
  assert.equal(created.response.status, 201);
  const privateEvent = created.payload.event;
  const firstPost = await request(`/api/events/${privateEvent.slug}/announcements`, { method: 'POST', cookie: users.coordinator.cookie, body: { body: 'Owner message before joining.' } });
  assert.equal(firstPost.response.status, 201);
  const secondPost = await request(`/api/events/${privateEvent.slug}/announcements`, { method: 'POST', cookie: users.coordinator.cookie, body: { body: 'Second owner message.' } });
  assert.equal(secondPost.response.status, 201);
  assert.equal((await request(`/api/events/${privateEvent.slug}/announcements`)).response.status, 401);
  assert.equal((await request(`/api/events/${privateEvent.slug}/announcements`, { cookie: users.alice.cookie })).response.status, 404);
  const ownerPage = await request(`/api/events/${privateEvent.slug}/announcements?limit=1&offset=0`, { cookie: users.coordinator.cookie });
  assert.equal(ownerPage.response.status, 200);
  assert.equal(ownerPage.payload.announcements.length, 1);
  assert.equal(ownerPage.payload.nextOffset, 1);
  const ownerNext = await request(`/api/events/${privateEvent.slug}/announcements?limit=1&offset=1`, { cookie: users.coordinator.cookie });
  assert.equal(ownerNext.response.status, 200);
  assert.equal(ownerNext.payload.announcements.length, 1);
  await joinAndSetTravelInEvent(users.alice, privateEvent, 'Private Area');
  const memberPage = await request(`/api/events/${privateEvent.slug}/announcements`, { cookie: users.alice.cookie });
  assert.equal(memberPage.response.status, 200);
  assert.equal(memberPage.payload.announcements.length, 2);
});

test('event dates must be calendar-valid and event times must be valid and ordered', async () => {
  const impossibleDate = await createFixtureEvent(users.coordinator, 'Impossible date', 'public', { date: '2026-02-30' });
  assert.equal(impossibleDate.response.status, 400);
  const impossibleMonth = await createFixtureEvent(users.coordinator, 'Impossible month', 'public', { date: '2026-13-40' });
  assert.equal(impossibleMonth.response.status, 400);
  const impossibleTime = await createFixtureEvent(users.coordinator, 'Impossible time', 'public', { startTime: '99:99' });
  assert.equal(impossibleTime.response.status, 400);
  const backwards = await createFixtureEvent(users.coordinator, 'Backwards time', 'public', { startTime: '12:00', endTime: '11:00' });
  assert.equal(backwards.response.status, 400);
  const sameTime = await createFixtureEvent(users.coordinator, 'Same time', 'public', { startTime: '12:00', endTime: '12:00' });
  assert.equal(sameTime.response.status, 400);
  const patchBackwards = await request(`/api/events/${event.slug}`, { method: 'PATCH', cookie: users.coordinator.cookie, body: { startTime: '12:00', endTime: '11:00' } });
  assert.equal(patchBackwards.response.status, 400);
});

test('partial event edits and cancellation preserve private visibility and omitted fields', async () => {
  const retainedFields = {
    endTime: '11:30',
    coverUrl: 'https://images.example.test/synthetic-cover.jpg',
    registrationLink: 'https://register.example.test/synthetic-event',
    capacity: 37,
  };
  const editedResult = await createFixtureEvent(users.coordinator, 'Private description patch', 'private', retainedFields);
  assert.equal(editedResult.response.status, 201, JSON.stringify(editedResult.payload));
  const edited = await request(`/api/events/${editedResult.payload.event.slug}`, {
    method: 'PATCH', cookie: users.coordinator.cookie, body: { description: 'Updated synthetic description only.' },
  });
  assert.equal(edited.response.status, 200, JSON.stringify(edited.payload));
  assert.equal(edited.payload.event.description, 'Updated synthetic description only.');
  assert.equal(edited.payload.event.visibility, 'private');
  assert.equal(edited.payload.event.endTime, retainedFields.endTime);
  assert.equal(edited.payload.event.coverUrl, retainedFields.coverUrl);
  assert.equal(edited.payload.event.registrationLink, retainedFields.registrationLink);
  assert.equal(edited.payload.event.capacity, retainedFields.capacity);

  const cancelledResult = await createFixtureEvent(users.coordinator, 'Private status patch', 'private', retainedFields);
  assert.equal(cancelledResult.response.status, 201, JSON.stringify(cancelledResult.payload));
  const cancelled = await request(`/api/events/${cancelledResult.payload.event.slug}`, {
    method: 'PATCH', cookie: users.coordinator.cookie, body: { status: 'cancelled' },
  });
  assert.equal(cancelled.response.status, 200, JSON.stringify(cancelled.payload));
  assert.equal(cancelled.payload.event.status, 'cancelled');
  assert.equal(cancelled.payload.event.registrationOpen, false);
  assert.equal(cancelled.payload.event.visibility, 'private');
  assert.equal(cancelled.payload.event.endTime, retainedFields.endTime);
  assert.equal(cancelled.payload.event.coverUrl, retainedFields.coverUrl);
  assert.equal(cancelled.payload.event.registrationLink, retainedFields.registrationLink);
  assert.equal(cancelled.payload.event.capacity, retainedFields.capacity);

  const publicEvents = await request('/api/events');
  assert.equal(publicEvents.payload.events.some((item) => [editedResult.payload.event.slug, cancelledResult.payload.event.slug].includes(item.slug)), false);
});

test('event cancellation expires pending requests and revokes accepted chat access', async () => {
  const dina = await register('Dina');
  await saveProfile(dina, { gender: 'woman', matchGenders: ['woman'], name: 'Dina Example' });
  await saveProfile(users.alice, { gender: 'woman', matchGenders: ['woman', 'man'], name: 'Alice Example' });
  const created = await createFixtureEvent(users.coordinator, 'Cancellation revocation');
  assert.equal(created.response.status, 201);
  const cancellationEvent = created.payload.event;
  await joinAndSetTravelInEvent(users.alice, cancellationEvent, 'Area Alice');
  await joinAndSetTravelInEvent(users.carl, cancellationEvent, 'Area Carl');
  await joinAndSetTravelInEvent(dina, cancellationEvent, 'Area Dina');
  const candidates = await request(`/api/events/${cancellationEvent.slug}/matches`, { cookie: users.alice.cookie });
  const carlRef = candidates.payload.matches.find((match) => db.prepare('SELECT target_id FROM recommendation_refs WHERE ref = ?').get(match.userRef)?.target_id === users.carl.id)?.userRef;
  const dinaRef = candidates.payload.matches.find((match) => db.prepare('SELECT target_id FROM recommendation_refs WHERE ref = ?').get(match.userRef)?.target_id === dina.id)?.userRef;
  assert.ok(carlRef); assert.ok(dinaRef);
  const acceptedRequest = await request('/api/requests', { method: 'POST', cookie: users.alice.cookie, body: { userRef: carlRef, consentConfirmed: true } });
  const pendingRequest = await request('/api/requests', { method: 'POST', cookie: users.alice.cookie, body: { userRef: dinaRef, consentConfirmed: true } });
  assert.equal(acceptedRequest.response.status, 201); assert.equal(pendingRequest.response.status, 201);
  const requestId = acceptedRequest.payload.request.id;
  const acceptance = await request(`/api/requests/${requestId}/respond`, { method: 'POST', cookie: users.carl.cookie, body: { action: 'accept' } });
  assert.equal(acceptance.response.status, 200);
  const message = await request(`/api/connections/${requestId}/messages`, { method: 'POST', cookie: users.alice.cookie, body: { body: 'Before cancellation.' } });
  assert.equal(message.response.status, 201);
  const cancelled = await request(`/api/events/${cancellationEvent.slug}`, { method: 'PATCH', cookie: users.coordinator.cookie, body: { status: 'cancelled' } });
  assert.equal(cancelled.response.status, 200);
  assert.equal(cancelled.payload.event.status, 'cancelled');
  assert.equal((await request(`/api/events/${cancellationEvent.slug}/matches`, { cookie: users.alice.cookie })).response.status, 409);
  assert.equal((await request('/api/requests', { method: 'POST', cookie: users.alice.cookie, body: { userRef: carlRef, consentConfirmed: true } })).response.status, 409);
  assert.equal((await request(`/api/events/${cancellationEvent.slug}/travel`, { method: 'PUT', cookie: users.alice.cookie, body: {} })).response.status, 409);
  assert.equal(db.prepare('SELECT status FROM connection_requests WHERE id = ?').get(requestId).status, 'disconnected');
  assert.equal(db.prepare('SELECT status FROM connection_requests WHERE id = ?').get(pendingRequest.payload.request.id).status, 'expired');
  assert.equal((await request(`/api/requests/${pendingRequest.payload.request.id}/respond`, { method: 'POST', cookie: dina.cookie, body: { action: 'accept' } })).response.status, 409);
  db.prepare("UPDATE connection_requests SET status = 'accepted' WHERE id = ?").run(requestId);
  assert.equal((await request(`/api/connections/${requestId}/messages`, { cookie: users.alice.cookie })).response.status, 403);
  assert.equal((await request(`/api/connections/${requestId}/messages`, { method: 'POST', cookie: users.carl.cookie, body: { body: 'After cancellation.' } })).response.status, 403);
  const liveConnections = await request('/api/connections?limit=20&offset=0', { cookie: users.alice.cookie });
  assert.equal(liveConnections.payload.connections.some((item) => item.id === requestId), false);
});

test('accepted chat is denied when either participant no longer belongs to the event', async () => {
  await saveProfile(users.alice, { gender: 'woman', matchGenders: ['woman', 'man'], name: 'Alice Example' });
  const created = await createFixtureEvent(users.coordinator, 'Membership gate');
  assert.equal(created.response.status, 201);
  const membershipEvent = created.payload.event;
  await joinAndSetTravelInEvent(users.alice, membershipEvent, 'Area Alice');
  await joinAndSetTravelInEvent(users.carl, membershipEvent, 'Area Carl');
  const matches = await request(`/api/events/${membershipEvent.slug}/matches`, { cookie: users.alice.cookie });
  const carlRef = matches.payload.matches.find((match) => db.prepare('SELECT target_id FROM recommendation_refs WHERE ref = ?').get(match.userRef)?.target_id === users.carl.id)?.userRef;
  assert.ok(carlRef);
  const sent = await request('/api/requests', { method: 'POST', cookie: users.alice.cookie, body: { userRef: carlRef, consentConfirmed: true } });
  assert.equal(sent.response.status, 201);
  const requestId = sent.payload.request.id;
  assert.equal((await request(`/api/requests/${requestId}/respond`, { method: 'POST', cookie: users.carl.cookie, body: { action: 'accept' } })).response.status, 200);
  assert.equal((await request(`/api/events/${membershipEvent.slug}/membership`, { method: 'DELETE', cookie: users.carl.cookie })).response.status, 200);
  assert.equal(db.prepare('SELECT 1 FROM event_members WHERE event_id = ? AND user_id = ?').get(databaseEventId(membershipEvent), users.carl.id), undefined);
  db.prepare("UPDATE connection_requests SET status = 'accepted' WHERE id = ?").run(requestId);
  assert.equal((await request(`/api/connections/${requestId}/messages`, { cookie: users.alice.cookie })).response.status, 403);
  assert.equal((await request(`/api/connections/${requestId}/messages`, { method: 'POST', cookie: users.carl.cookie, body: { body: 'No membership.' } })).response.status, 403);
  const connections = await request('/api/connections?limit=20&offset=0', { cookie: users.alice.cookie });
  assert.equal(connections.payload.connections.some((item) => item.id === requestId), false);
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

test('public reads are throttled and responses include a retry interval', async () => {
  const throttleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meetups-read-limit-test-'));
  const limited = createApp({ dbFile: path.join(throttleDir, 'throttle.sqlite'), sessionSecret: 'read-limit-test-secret' });
  const throttleServer = limited.app.listen(0, '127.0.0.1');
  await new Promise((resolve) => throttleServer.once('listening', resolve));
  try {
    const address = `http://127.0.0.1:${throttleServer.address().port}/api/events?limit=1`;
    let last;
    for (let index = 0; index < 121; index += 1) last = await fetch(address);
    assert.equal(last.status, 429);
    assert.ok(Number(last.headers.get('retry-after')) >= 1);
  } finally {
    await new Promise((resolve) => throttleServer.close(resolve));
    limited.db.close();
    fs.rmSync(throttleDir, { recursive: true, force: true });
  }
});

test('invalid profile fields are rejected and attendees cannot create events', async () => {
  const invalid = await request('/api/profile', { method: 'PUT', cookie: users.alice.cookie, body: { name: '', gender: 'unknown', city: '' } });
  assert.equal(invalid.response.status, 400);
  const denied = await request('/api/events', { method: 'POST', cookie: users.alice.cookie, body: {} });
  assert.equal(denied.response.status, 403);
});
