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

export type MatchedInvitee<TInvitee extends CalInviteeLike> = TInvitee & {
  attended_zoom: boolean;
  match_method: 'email' | 'name' | null;
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

export function samePersonByName(calName: string, zoomName: string): boolean {
  const a = normName(calName);
  const b = cleanZoomDisplayName(zoomName);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;

  const ap = a.split(' ').filter(Boolean);
  const bp = b.split(' ').filter(Boolean);
  if (!ap.length || !bp.length) return false;

  if (ap.length >= 2 && bp.length >= 2) {
    const allB = new Set(bp);
    const shared = ap.filter((part) => part.length > 1 && allB.has(part));
    if (shared.length >= 2) return true;
  }

  if (ap.length >= 2) {
    const calFirst = ap[0];
    const calLast = ap[ap.length - 1];
    const zoomFirst = bp[0];
    const zoomLast = bp[bp.length - 1];
    if (calFirst === zoomFirst) {
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
    const calLast = ap[ap.length - 1];
    if (bp[0] === calFirst || bp[0] === calLast) return true;
    if (bp[0].startsWith(calFirst) && bp[0].includes(calLast.slice(0, Math.min(4, calLast.length)))) return true;
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
    const email = (participant.user_email ?? '').trim().toLowerCase();
    if (email) participantByEmail.set(email, participant);
  }
  const participantNames = participants
    .filter((participant) => participant.name)
    .map((participant) => ({
      norm: cleanZoomDisplayName(participant.name ?? ''),
      raw: participant,
    }));
  return { participantByEmail, participantNames };
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
    matched_by_name: number;
  };
} {
  const dedupedParticipants = dedupeZoomParticipants(participants);
  const { participantByEmail, participantNames } = buildParticipantMaps(dedupedParticipants);
  const usedKeys = new Set<string>();

  type Slot = { invitee: T; match: ZoomParticipantLike | null; method: 'email' | 'name' | null };
  const slots: Slot[] = rawInvitees.map((invitee) => ({ invitee, match: null, method: null }));

  for (const slot of slots) {
    const email = String(slot.invitee.email || '').trim().toLowerCase();
    if (!email || !participantByEmail.has(email)) continue;
    const participant = participantByEmail.get(email)!;
    const key = participantIdentityKey(participant);
    if (!key || usedKeys.has(key)) continue;
    slot.match = participant;
    slot.method = 'email';
    usedKeys.add(key);
  }

  for (const slot of slots) {
    if (slot.match || !slot.invitee.name) continue;
    for (const { raw } of participantNames) {
      const key = participantIdentityKey(raw);
      if (!key || usedKeys.has(key)) continue;
      if (!samePersonByName(slot.invitee.name, raw.name ?? '')) continue;
      slot.match = raw;
      slot.method = 'name';
      usedKeys.add(key);
      break;
    }
  }

  const invitees = slots.map((slot) => ({
    ...slot.invitee,
    attended_zoom: slot.match !== null,
    match_method: slot.method,
    join_time: slot.match?.join_time ?? null,
    leave_time: slot.match?.leave_time ?? null,
  }));

  const attended = invitees.filter((invitee) => invitee.attended_zoom);
  const noShow = invitees.filter((invitee) => !invitee.attended_zoom);
  const matchedByEmail = attended.filter((invitee) => invitee.match_method === 'email').length;
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
      matched_by_name: matchedByName,
    },
  };
}
