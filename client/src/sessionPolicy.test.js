import test from 'node:test';
import assert from 'node:assert/strict';
import { clearAccountScopedState, isCurrentAuthResponse, isLikelyDetailedAddress, normalizeMatchGenders, publicLandingEvents } from './sessionPolicy.js';
import { consentPolicy } from './consentConfig.js';

test('signed-out public landing data excludes private event cards', () => {
  const events = [
    { slug: 'public-one', visibility: 'public' },
    { slug: 'private-owned', visibility: 'private' },
    { slug: 'private-joined', visibility: 'private' },
  ];
  assert.deepEqual(publicLandingEvents(events).map((event) => event.slug), ['public-one']);
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
