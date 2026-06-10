/**
 * Calendly invitee ↔ Zoom participant matching for live sessions.
 */

export type ZoomParticipantLike = {
  name?: string;
  user_email?: string;
  join_time?: string;
  leave_time?: string;
};

export type CalInviteeLike = {
  email: string;
  name: string;
};

export type MatchMethod = 'email' | 'hybrid' | 'name' | null;

export type MatchedInvitee<TInvitee extends CalInviteeLike> = TInvitee & {
  attended_zoom: boolean;
  match_method: MatchMethod;
  join_time: string | null;
  leave_time: string | null;
};

export function normName(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strip Zoom display suffixes: "(iPhone)", "- Guest", trailing device labels. */
export function cleanZoomDisplayName(s: string): string {
  return normName(
    String(s || '')
      .replace(/\s*\([^)]*\)/g, ' ')
      .replace(/\s*-\s*(iphone|ipad|android|guest|unknown).*$/i, ' ')
      .replace(/\s*\|\s*.*$/, ' ')
      .replace(/\s+from\s+.+$/i, ' '),
  );
}

export function nameTokens(s: string): string[] {
  return normName(s)
    .split(' ')
    .filter((token) => token.length > 1);
}

export function emailLocalPart(email: string): string {
  return String(email || '')
    .trim()
    .toLowerCase()
    .split('@')[0]
    .replace(/[^a-z0-9]/g, '');
}

/** Zoom often puts the login email in the display-name field when user_email is empty. */
export function extractEmailsFromText(text: string): string[] {
  const matches = String(text || '').toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g);
  return matches ? [...new Set(matches)] : [];
}

export function effectiveZoomEmail(participant: ZoomParticipantLike): string {
  const direct = String(participant.user_email || '').trim().toLowerCase();
  if (direct) return direct;
  const fromName = extractEmailsFromText(participant.name ?? '');
  return fromName[0] ?? '';
}

function compactAlpha(value: string): string {
  return normName(value).replace(/\s+/g, '');
}

/** True when short is an initial or prefix of full (e.g. "n" → "natalie", "nat" → "natalie"). */
export function isInitialOrPrefix(short: string, full: string): boolean {
  const s = normName(short).replace(/\s+/g, '');
  const f = normName(full).replace(/\s+/g, '');
  if (!s || !f) return false;
  if (s === f) return true;
  if (s.length === 1) return f.startsWith(s);
  if (s.length >= 3 && f.startsWith(s)) return true;
  return false;
}

/**
 * Cross-field match: Calendly name/email vs Zoom name/email when exact email differs.
 * Handles e.g. Calendly "Anila Usman" + anilakanwal890@gmail.com vs Zoom "Anila Kanwal".
 */
export function samePersonByCrossField(
  calEmail: string,
  calName: string,
  zoomEmail: string,
  zoomName: string,
): boolean {
  const calLocal = emailLocalPart(calEmail);
  const zoomLocal = emailLocalPart(zoomEmail);
  const calNameTokens = nameTokens(calName).filter((t) => t.length >= 3);
  const zoomNameTokens = nameTokens(zoomName).filter((t) => t.length >= 3);

  if (calLocal.length >= 5 && zoomLocal.length >= 5) {
    if (calLocal === zoomLocal) return true;
    if (calLocal.includes(zoomLocal) || zoomLocal.includes(calLocal)) return true;
  }

  if (calLocal.length >= 4 && zoomNameTokens.length > 0) {
    const zoomInCalLocal = zoomNameTokens.filter((t) => calLocal.includes(t));
    if (zoomInCalLocal.length >= 2) return true;
    if (zoomInCalLocal.length >= 1 && calNameTokens.length > 0) {
      const calFirst = calNameTokens[0];
      const zoomFirst = zoomNameTokens[0];
      if (calFirst && zoomFirst && calFirst === zoomFirst) return true;
      if (calFirst && zoomFirst && isInitialOrPrefix(zoomFirst, calFirst)) return true;
    }
  }

  if (zoomLocal.length >= 4 && calNameTokens.length > 0) {
    const calInZoomLocal = calNameTokens.filter((t) => zoomLocal.includes(t));
    if (calInZoomLocal.length >= 2) return true;
    if (calInZoomLocal.length >= 1 && zoomNameTokens.length > 0) {
      const calFirst = calNameTokens[0];
      const zoomFirst = zoomNameTokens[0];
      if (calFirst && zoomFirst && calFirst === zoomFirst) return true;
    }
  }

  if (calNameTokens.length >= 2 && zoomNameTokens.length >= 2) {
    const calFirst = calNameTokens[0];
    const zoomFirst = zoomNameTokens[0];
    const zoomLast = zoomNameTokens[zoomNameTokens.length - 1];
    if (
      calFirst === zoomFirst &&
      zoomLast &&
      zoomLast.length >= 4 &&
      calLocal.includes(zoomLast) &&
      !calNameTokens.includes(zoomLast)
    ) {
      return true;
    }
  }

  return false;
}

export function samePersonByName(calName: string, zoomName: string): boolean {
  const a = normName(calName);
  const b = cleanZoomDisplayName(zoomName);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;

  const ap = a.split(' ').filter(Boolean);
  const bp = b.split(' ').filter(Boolean);
  if (!ap.length || !bp.length) return false;

  const calLast = ap[ap.length - 1];
  const zoomLast = bp[bp.length - 1];

  if (calLast.length >= 3 && calLast === zoomLast) {
    for (const calPart of ap.slice(0, -1)) {
      for (const zoomPart of bp.slice(0, -1)) {
        if (isInitialOrPrefix(zoomPart, calPart) || isInitialOrPrefix(calPart, zoomPart)) return true;
      }
    }
    if (bp.length === 1) return true;
  }

  if (ap.length >= 2 && bp.length >= 2) {
    const allB = new Set(bp);
    const shared = ap.filter((part) => part.length > 1 && allB.has(part));
    if (shared.length >= 2) return true;
  }

  if (ap.length >= 2 && bp.length >= 2) {
    const calFirst = ap[0];
    const zoomFirst = bp[0];
    if (calFirst === zoomFirst || isInitialOrPrefix(zoomFirst, calFirst) || isInitialOrPrefix(calFirst, zoomFirst)) {
      if (calLast === zoomLast) return true;
      if (calLast.length >= 3 && zoomLast.startsWith(calLast.slice(0, 3))) return true;
      if (zoomLast.length >= 3 && calLast.startsWith(zoomLast.slice(0, 3))) return true;
      if (bp.some((part) => part.startsWith(calLast) || calLast.startsWith(part))) return true;
    }
    const fuzzy = ap.filter(
      (part) =>
        part.length > 1 &&
        bp.some((zoomPart) => zoomPart.includes(part) || part.includes(zoomPart)),
    );
    if (fuzzy.length >= 2) return true;
  }

  if (ap.length >= 2 && bp.length === 1) {
    const calFirst = ap[0];
    if (bp[0] === calFirst || bp[0] === calLast) return true;
    if (isInitialOrPrefix(bp[0], calFirst) || isInitialOrPrefix(bp[0], calLast)) return true;
    if (bp[0].startsWith(calFirst) && bp[0].includes(calLast.slice(0, Math.min(4, calLast.length)))) return true;
    if (bp[0] === calLast) return true;
  }

  if (ap.length >= 2 && bp.length === 2) {
    if (bp[1] === calLast && isInitialOrPrefix(bp[0], ap[0])) return true;
    if (bp[1] === calLast && ap.length >= 3 && isInitialOrPrefix(bp[0], ap[ap.length - 2])) return true;
  }

  return false;
}

export function participantIdentityKey(p: ZoomParticipantLike): string {
  const email = (p.user_email ?? '').trim().toLowerCase();
  if (email) return `e:${email}`;
  const name = cleanZoomDisplayName(p.name ?? '');
  if (name) return `n:${name}`;
  return '';
}

export function dedupeZoomParticipants<T extends ZoomParticipantLike>(participants: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const participant of participants) {
    const key = participantIdentityKey(participant);
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, participant);
      continue;
    }
    const existingJoin = Date.parse(String(existing.join_time || ''));
    const nextJoin = Date.parse(String(participant.join_time || ''));
    const preferNext =
      (Number.isFinite(nextJoin) && !Number.isFinite(existingJoin)) ||
      (Number.isFinite(nextJoin) && Number.isFinite(existingJoin) && nextJoin < existingJoin);
    if (preferNext) byKey.set(key, participant);
  }
  return [...byKey.values()];
}

function buildParticipantMaps(participants: ZoomParticipantLike[]) {
  const participantByEmail = new Map<string, ZoomParticipantLike>();
  for (const participant of participants) {
    const emails = new Set<string>();
    const direct = (participant.user_email ?? '').trim().toLowerCase();
    if (direct) emails.add(direct);
    for (const embedded of extractEmailsFromText(participant.name ?? '')) emails.add(embedded);
    for (const email of emails) participantByEmail.set(email, participant);
  }
  const participantNames = participants
    .filter((participant) => participant.name || participant.user_email)
    .map((participant) => ({
      norm: cleanZoomDisplayName(participant.name ?? ''),
      raw: participant,
    }));
  return { participantByEmail, participantNames };
}

function matchParticipantToInvitee<T extends CalInviteeLike>(
  invitee: T,
  participant: ZoomParticipantLike,
): MatchMethod | null {
  const calEmail = String(invitee.email || '').trim().toLowerCase();
  const calLocal = emailLocalPart(calEmail);
  const calName = String(invitee.name || '').trim();
  const zoomName = String(participant.name || '').trim();
  const zoomEmails = new Set<string>();
  const directZoomEmail = String(participant.user_email || '').trim().toLowerCase();
  if (directZoomEmail) zoomEmails.add(directZoomEmail);
  for (const embedded of extractEmailsFromText(zoomName)) zoomEmails.add(embedded);

  if (calEmail) {
    for (const zoomEmail of zoomEmails) {
      if (zoomEmail === calEmail) return 'email';
    }
  }

  if (calLocal.length >= 5) {
    const zoomNameLocal = compactAlpha(zoomName);
    if (zoomNameLocal.length >= 5 && calLocal === zoomNameLocal) return 'hybrid';
    if (zoomName.includes('@') && emailLocalPart(zoomName) === calLocal) return 'hybrid';
  }

  const zoomEmailForHybrid = [...zoomEmails][0] ?? '';
  if (
    calEmail &&
    zoomEmailForHybrid &&
    calEmail !== zoomEmailForHybrid &&
    samePersonByCrossField(calEmail, calName, zoomEmailForHybrid, zoomName)
  ) {
    return 'hybrid';
  }

  if (calEmail && samePersonByCrossField(calEmail, calName, '', zoomName)) return 'hybrid';

  if (calName && zoomName && samePersonByName(calName, zoomName)) return 'name';

  return null;
}

export function matchInviteesToParticipants<T extends CalInviteeLike>(
  rawInvitees: T[],
  participants: ZoomParticipantLike[],
): {
  invitees: Array<MatchedInvitee<T>>;
  dedupedParticipants: ZoomParticipantLike[];
  walkinParticipants: ZoomParticipantLike[];
  stats: {
    invited_count: number;
    attended_matched_count: number;
    no_show_or_absent_count: number;
    zoom_participant_count: number;
    unique_zoom_attendee_count: number;
    walkin_count: number;
    total_showed_count: number;
    attendance_rate_pct: number | null;
    matched_by_email: number;
    matched_by_hybrid: number;
    matched_by_name: number;
  };
} {
  const dedupedParticipants = dedupeZoomParticipants(participants);
  const { participantByEmail, participantNames } = buildParticipantMaps(dedupedParticipants);
  const usedKeys = new Set<string>();

  type Slot = { invitee: T; match: ZoomParticipantLike | null; method: MatchMethod };
  const slots: Slot[] = rawInvitees.map((invitee) => ({ invitee, match: null, method: null }));

  const tryAssign = (slot: Slot, participant: ZoomParticipantLike, method: MatchMethod): boolean => {
    const key = participantIdentityKey(participant);
    if (!key || usedKeys.has(key)) return false;
    slot.match = participant;
    slot.method = method;
    usedKeys.add(key);
    return true;
  };

  for (const slot of slots) {
    const email = String(slot.invitee.email || '').trim().toLowerCase();
    if (!email || !participantByEmail.has(email)) continue;
    tryAssign(slot, participantByEmail.get(email)!, 'email');
  }

  for (const slot of slots) {
    if (slot.match) continue;
    let best: { participant: ZoomParticipantLike; method: MatchMethod; score: number } | null = null;
    for (const { raw } of participantNames) {
      const key = participantIdentityKey(raw);
      if (!key || usedKeys.has(key)) continue;
      const method = matchParticipantToInvitee(slot.invitee, raw);
      if (!method || method === 'email') continue;
      const score = method === 'hybrid' ? 80 : 60;
      if (!best || score > best.score) best = { participant: raw, method, score };
    }
    if (best) tryAssign(slot, best.participant, best.method);
  }

  const invitees = slots.map((slot) => ({
    ...slot.invitee,
    attended_zoom: slot.match !== null,
    match_method: slot.method,
    join_time: slot.match?.join_time ?? null,
    leave_time: slot.match?.leave_time ?? null,
  }));

  const attended = invitees.filter((invitee) => invitee.attended_zoom);
  const noShow = invitees.filter((invitee) => !invendee.attended_zoom);
  const matchedByEmail = attended.filter((invitee) => invitee.match_method === 'email').length;
  const matchedByHybrid = attended.filter((invitee) => invitee.match_method === 'hybrid').length;
  const matchedByName = attended.filter((invitee) => invitee.match_method === 'name').length;

  const walkinParticipants = dedupedParticipants.filter((participant) => {
    const key = participantIdentityKey(participant);
    return key ? !usedKeys.has(key) : true;
  });

  const invitedCount = rawInvitees.length;
  const uniqueZoomCount = dedupedParticipants.length;
  const totalShowedCount = uniqueZoomCount;

  return {
    invitees,
    dedupedParticipants,
    walkinParticipants,
    stats: {
      invited_count: invitedCount,
      attended_matched_count: attended.length,
      no_show_or_absent_count: noShow.length,
      zoom_participant_count: participants.length,
      unique_zoom_attendee_count: uniqueZoomCount,
      walkin_count: walkinParticipants.length,
      total_showed_count: totalShowedCount,
      attendance_rate_pct:
        invitedCount > 0 ? Math.round((attended.length / invitedCount) * 100) : null,
      matched_by_email: matchedByEmail,
      matched_by_hybrid: matchedByHybrid,
      matched_by_name: matchedByName,
    },
  };
}
