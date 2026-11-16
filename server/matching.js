export function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

const clean = (value) => String(value || '').trim().toLocaleLowerCase();

export function isBlocked(db, firstId, secondId) {
  return Boolean(db.prepare(`
    SELECT 1 FROM blocks
    WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)
    LIMIT 1
  `).get(firstId, secondId, secondId, firstId));
}

export function hasActivePairState(db, eventId, firstId, secondId, excludeRequestId = null) {
  return Boolean(db.prepare(`
    SELECT 1 FROM connection_requests
    WHERE event_id = ?
      AND ((requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?))
      AND (? IS NULL OR id <> ?)
      AND status IN ('pending', 'accepted')
    LIMIT 1
  `).get(eventId, firstId, secondId, secondId, firstId, excludeRequestId, excludeRequestId));
}

export function travelCompatibility(first, second) {
  const a = first.travel;
  const b = second.travel;
  const methodsA = Array.isArray(a.modes) ? a.modes : [];
  const methodsB = Array.isArray(b.modes) ? b.modes : [];
  const intersection = methodsA.filter((mode) => methodsB.includes(mode));
  const shared = intersection.filter((mode) => mode !== 'Car');
  const carIsCompatible = intersection.includes('Car') && (
    (a.carIntent === 'offering' && b.carIntent === 'seeking' && Number(a.seats || 0) > 0) ||
    (b.carIntent === 'offering' && a.carIntent === 'seeking' && Number(b.seats || 0) > 0) ||
    (a.carIntent === 'offering' && b.carIntent === 'offering' && a.willingToShare === true && b.willingToShare === true && (Number(a.seats || 0) + Number(b.seats || 0) > 0))
  );
  if (shared.length === 0 && !carIsCompatible) return null;

  const cityA = clean(a.city || first.user.city);
  const cityB = clean(b.city || second.user.city);
  if (!cityA || cityA !== cityB) return null;

  const dateA = clean(a.travelDate);
  const dateB = clean(b.travelDate);
  if (dateA && dateB && dateA !== dateB) return null;

  const sameLocality = Boolean(clean(a.locality) && clean(a.locality) === clean(b.locality));
  const reasons = [`Same starting city: ${a.city || first.user.city}`];
  const matchedModes = [...shared, ...(carIsCompatible ? ['Car'] : [])];
  reasons.push(matchedModes.includes('Car') ? 'Car travel is explicitly compatible' : `Compatible travel: ${matchedModes.join(', ')}`);
  if (sameLocality) reasons.push('Same approximate starting locality');
  if (dateA && dateA === dateB) reasons.push('Same travel date');
  return { matchedModes, sameLocality, reasons };
}

export function profilePreferencesAllow(user, candidate) {
  if (!user.gender || !candidate.gender) return false;
  const accepted = parseJson(user.match_genders, []);
  return Array.isArray(accepted) && accepted.includes(candidate.gender);
}

export function pairEligibility(db, eventId, firstId, secondId, excludeRequestId = null) {
  if (firstId === secondId || isBlocked(db, firstId, secondId) || hasActivePairState(db, eventId, firstId, secondId, excludeRequestId)) return null;

  const first = db.prepare(`
    SELECT u.*, em.travel
    FROM event_members em JOIN users u ON u.id = em.user_id
    WHERE em.event_id = ? AND em.user_id = ?
  `).get(eventId, firstId);
  const second = db.prepare(`
    SELECT u.*, em.travel
    FROM event_members em JOIN users u ON u.id = em.user_id
    WHERE em.event_id = ? AND em.user_id = ?
  `).get(eventId, secondId);
  if (!first || !second || !first.verified_at || !second.verified_at) return null;

  const firstTravel = parseJson(first.travel, {});
  const secondTravel = parseJson(second.travel, {});
  if (firstTravel.lookingForCompanion !== true || secondTravel.lookingForCompanion !== true) return null;
  if (!profilePreferencesAllow(first, second) || !profilePreferencesAllow(second, first)) return null;

  const compatibility = travelCompatibility(
    { user: first, travel: firstTravel },
    { user: second, travel: secondTravel },
  );
  if (!compatibility) return null;
  return { first, second, firstTravel, secondTravel, ...compatibility };
}
