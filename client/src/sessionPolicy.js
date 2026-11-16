const genderValues = new Set(['woman', 'man', 'nonbinary', 'prefer_not_to_say']);

export function publicLandingEvents(events = []) {
  return events.filter((event) => event?.visibility === 'public');
}

export function normalizeMatchGenders(values = []) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value) => genderValues.has(value)))];
}

export function isCurrentAuthResponse(requestGeneration, currentGeneration, requestUserId, currentUserId) {
  return requestGeneration === currentGeneration && requestUserId === currentUserId;
}

export function isLikelyDetailedAddress(value = '') {
  return /(?:\b(?:flat|apartment|apt\.?|house|home|door\s*(?:no\.?|number)?|unit|floor|plot|building|street address)\b|\b\d{5,}\b|@)/i.test(String(value).trim());
}

export function clearAccountScopedState() {
  return {
    events: [],
    myEvents: [],
    ownedEvents: [],
    currentEvent: null,
    announcements: [],
    matches: [],
    matchMessage: '',
    discoverSlug: '',
    requests: { incoming: [], outgoing: [], pendingIncomingCount: 0 },
    connections: [],
    selectedConnection: '',
    messages: [],
    blocks: [],
    coordinatorEvents: [],
    moderationReports: [],
    selectedReport: null,
    pendingMatch: null,
    reportTarget: null,
    reportReason: 'safety',
    reportDetails: '',
  };
}
