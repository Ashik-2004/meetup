import test from 'node:test';
import assert from 'node:assert/strict';
import { clearAccountScopedState, clearInactiveEventState, eventMatchingStatus, isCurrentAuthResponse, isEventMatchingEnabled, isLikelyDetailedAddress, isMatchingActionDisabled, normalizeMatchGenders, publicLandingEvents } from './sessionPolicy.js';
import { consentPolicy } from './consentConfig.js';

test('signed-out public landing data excludes private event cards', () => {
  const events = [
    { slug: 'public-one', visibility: 'public' },
    { slug: 'private-owned', visibility: 'private' },
    { slug: 'private-joined', visibility: 'private' },
  ];
  assert.deepEqual(publicLandingEvents(events).map((event) => event.slug), ['public-one']);
});

test('cancelled and inactive events never display matching as enabled', () => {
  const cancelled = { status: 'cancelled', travel: { lookingForCompanion: true } };
  const postponed = { status: 'postponed', travel: { lookingForCompanion: true } };
  const active = { status: 'active', travel: { lookingForCompanion: true } };
  assert.equal(isEventMatchingEnabled(cancelled), false);
  assert.equal(isMatchingActionDisabled(cancelled), true);
  assert.equal(isMatchingActionDisabled(active), false);
  assert.deepEqual(eventMatchingStatus(cancelled), { enabled: false, label: 'Event cancelled — matching paused' });
  assert.deepEqual(eventMatchingStatus(postponed), { enabled: false, label: 'Matching unavailable' });
  assert.deepEqual(eventMatchingStatus(active), { enabled: true, label: 'Matching on' });
  assert.deepEqual(eventMatchingStatus({ status: 'active', travel: { lookingForCompanion: false } }), { enabled: false, label: 'Community only' });
});

test('cancelling an event immediately clears its rendered profile, chat, discovery, and consent state', () => {
  const cleared = clearInactiveEventState({
    connections: [
      { id: 'cancelled-link', eventSlug: 'cancelled-event', profile: { name: 'Private Cancelled Profile' } },
      { id: 'active-link', eventSlug: 'active-event', profile: { name: 'Active Profile' } },
    ],
    connectionsNextOffset: 20,
    selectedConnection: 'cancelled-link',
    messages: [{ body: 'Private cancelled-event chat text' }],
    messagesNextOffset: 30,
    discoverSlug: 'cancelled-event',
    matches: [{ alias: 'Private cancelled-event match' }],
    matchesNextOffset: 25,
    matchMessage: 'Private cancelled-event recommendation state',
    pendingMatch: { eventSlug: 'cancelled-event', userRef: 'private-reference' },
    reportTarget: { eventSlug: 'cancelled-event', profile: { name: 'Report Target Profile' } },
  }, ['cancelled-event']);

  assert.deepEqual(cleared.connections.map((connection) => connection.id), ['active-link']);
  assert.equal(cleared.connectionsNextOffset, null);
  assert.equal(cleared.selectedConnection, '');
  assert.deepEqual(cleared.messages, []);
  assert.equal(cleared.messagesNextOffset, null);
  assert.equal(cleared.reportTarget, null);
  assert.equal(cleared.pendingMatch, null);
  assert.equal(cleared.discoverSlug, '');
  assert.deepEqual(cleared.matches, []);
  assert.equal(cleared.matchesNextOffset, null);
  assert.equal(cleared.matchMessage, '');
  assert.equal(JSON.stringify(cleared).includes('Private Cancelled Profile'), false);
  assert.equal(JSON.stringify(cleared).includes('Private cancelled-event chat text'), false);
  assert.equal(JSON.stringify(cleared).includes('Report Target Profile'), false);
  assert.equal(JSON.stringify(cleared).includes('Private cancelled-event match'), false);
  assert.equal(JSON.stringify(cleared).includes('private-reference'), false);
});

test('sign-out reset clears account-scoped and event-detail data', () => {
  const state = clearAccountScopedState();
  assert.deepEqual(state.events, []);
  assert.deepEqual(state.myEvents, []);
  assert.deepEqual(state.ownedEvents, []);
  assert.equal(state.currentEvent, null);
  assert.deepEqual(state.announcements, []);
  assert.deepEqual(state.matches, []);
  assert.deepEqual(state.requests, { incoming: [], outgoing: [], pendingIncomingCount: 0 });
  assert.deepEqual(state.connections, []);
  assert.deepEqual(state.moderationReports, []);
});

test('clearing all match-gender choices remains an explicit empty preference', () => {
  assert.deepEqual(normalizeMatchGenders([]), []);
  assert.deepEqual(normalizeMatchGenders(['woman', 'woman']), ['woman']);
  assert.deepEqual(normalizeMatchGenders(['invalid']), []);
});

test('late responses from a prior auth generation or account cannot update state', () => {
  assert.equal(isCurrentAuthResponse(4, 4, 'user-a', 'user-a'), true);
  assert.equal(isCurrentAuthResponse(3, 4, 'user-a', 'user-a'), false);
  assert.equal(isCurrentAuthResponse(4, 4, 'user-a', 'user-b'), false);
});

test('approximate locality accepts neighbourhoods but rejects address-like values', () => {
  assert.equal(isLikelyDetailedAddress('Kakkanad'), false);
  assert.equal(isLikelyDetailedAddress('Edappally 5th Mile'), false);
  assert.equal(isLikelyDetailedAddress('Flat 4B, Sample Apartments'), true);
  assert.equal(isLikelyDetailedAddress('Door No 12345'), true);
});

test('sender and recipient consent copy disclose that both names always reveal after acceptance', () => {
  assert.match(consentPolicy.senderDisclosure, /both your names/i);
  assert.match(consentPolicy.recipientDisclosure, /both attendees['’] names/i);
  assert.match(consentPolicy.senderDisclosure, /profile fields each of you selected to share/i);
  assert.match(consentPolicy.recipientDisclosure, /profile fields each chose to share/i);
  assert.equal(consentPolicy.recipientAction, 'Accept & reveal profiles');
});
