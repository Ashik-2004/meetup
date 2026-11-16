const genderValues = new Set(['woman', 'man', 'nonbinary', 'prefer_not_to_say']);

export function publicLandingEvents(events = []) {
  return events.filter((event) => event?.visibility === 'public');
}

export function isEventMatchingEnabled(event, travel = event?.travel) {
  return !isMatchingActionDisabled(event) && travel?.lookingForCompanion === true;
}

export function isMatchingActionDisabled(event) {
  return event?.status !== 'active';
}

export function eventMatchingStatus(event, travel = event?.travel) {
  if (event?.status === 'cancelled') return { enabled: false, label: 'Event cancelled — matching paused' };
  const enabled = isEventMatchingEnabled(event, travel);
  return {
    enabled,
    label: enabled ? 'Matching on' : travel?.lookingForCompanion ? 'Matching unavailable' : 'Community only',
  };
}

export function clearInactiveEventState(state, inactiveEventSlugs = []) {
  const inactive = new Set(inactiveEventSlugs);
  if (!inactive.size) return state;
  const previousConnections = state.connections || [];
  const connections = previousConnections.filter((connection) => !inactive.has(connection.eventSlug));
  const selected = previousConnections.find((connection) => connection.id === state.selectedConnection);
  const clearSelected = Boolean(selected && inactive.has(selected.eventSlug));
  const clearDiscovery = inactive.has(state.discoverSlug);
  return {
    ...state,
    connections,
    connectionsNextOffset: connections.length < previousConnections.length ? null : state.connectionsNextOffset,
    selectedConnection: clearSelected ? '' : state.selectedConnection,
    messages: clearSelected ? [] : state.messages,
    messagesNextOffset: clearSelected ? null : state.messagesNextOffset,
    reportTarget: state.reportTarget && inactive.has(state.reportTarget.eventSlug) ? null : state.reportTarget,
    pendingMatch: state.pendingMatch && inactive.has(state.pendingMatch.eventSlug) ? null : state.pendingMatch,
    discoverSlug: clearDiscovery ? '' : state.discoverSlug,
    matches: clearDiscovery ? [] : state.matches,
    matchesNextOffset: clearDiscovery ? null : state.matchesNextOffset,
    matchMessage: clearDiscovery ? '' : state.matchMessage,
  };
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
