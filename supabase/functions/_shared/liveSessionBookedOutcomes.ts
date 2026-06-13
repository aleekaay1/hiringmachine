/** Edge mirror of services/liveSessionBookedOutcomes.ts — keep in sync. */

export type LiveSessionRegistrantRow = {
  session_date: string;
  email: string;
  name?: string | null;
  phone: string | null;
  attended_zoom: boolean;
  calendly_no_show: boolean | null;
  zoom_join_at: string | null;
};

export type LiveSessionOutcomeStatus = 'pending' | 'scheduled' | 'attended' | 'no_show';

export type LiveSessionMatchResult = {
  status: LiveSessionOutcomeStatus;
  sessionDate: string | null;
  matchMethod: 'email' | 'phone' | 'name' | null;
  registrant: LiveSessionRegistrantRow | null;
};

export function normalizeLiveSessionEmail(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase();
}

export function normalizeLiveSessionPhone(value: string | null | undefined): string {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

export function normalizeLiveSessionName(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function liveSessionNamesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeLiveSessionName(a);
  const nb = normalizeLiveSessionName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const partsA = na.split(' ').filter(Boolean);
  const partsB = nb.split(' ').filter(Boolean);
  if (partsA.length >= 2 && partsB.length >= 2) {
    const lastA = partsA[partsA.length - 1];
    const lastB = partsB[partsB.length - 1];
    if (lastA === lastB && partsA[0][0] === partsB[0][0]) return true;
  }
  return false;
}

export function torontoYmdFromDate(d: Date): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(d);
}

export function buildLiveSessionRowsByEmail(rows: LiveSessionRegistrantRow[]): Map<string, LiveSessionRegistrantRow[]> {
  const map = new Map<string, LiveSessionRegistrantRow[]>();
  for (const row of rows) {
    const email = normalizeLiveSessionEmail(row.email);
    if (!email) continue;
    const list = map.get(email) || [];
    list.push(row);
    map.set(email, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.session_date.localeCompare(b.session_date));
  return map;
}

export function buildLiveSessionRowsByPhone(rows: LiveSessionRegistrantRow[]): Map<string, LiveSessionRegistrantRow[]> {
  const map = new Map<string, LiveSessionRegistrantRow[]>();
  for (const row of rows) {
    const phone = normalizeLiveSessionPhone(row.phone);
    if (!phone || phone.length < 10) continue;
    const list = map.get(phone) || [];
    list.push(row);
    map.set(phone, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.session_date.localeCompare(b.session_date));
  return map;
}

export function pickRegistrantForDisposition(rows: LiveSessionRegistrantRow[], disposedAtMs: number): LiveSessionRegistrantRow | null {
  if (!rows.length) return null;
  const disposeYmd = torontoYmdFromDate(new Date(disposedAtMs));
  const onOrAfter = rows.filter((r) => r.session_date >= disposeYmd);
  if (onOrAfter.length) return onOrAfter[0];
  return rows[rows.length - 1];
}

export function pickRegistrantForCallDisposition(input: {
  email?: string | null;
  candidatePhone?: string | null;
  candidateName?: string | null;
  dialedNumber?: string | null;
  disposedAtMs: number;
  byEmail: Map<string, LiveSessionRegistrantRow[]>;
  byPhone: Map<string, LiveSessionRegistrantRow[]>;
  allRegistrants?: LiveSessionRegistrantRow[];
}): { registrant: LiveSessionRegistrantRow | null; matchMethod: 'email' | 'phone' | 'name' | null } {
  const email = normalizeLiveSessionEmail(input.email);
  if (email) {
    const match = pickRegistrantForDisposition(input.byEmail.get(email) || [], input.disposedAtMs);
    if (match) return { registrant: match, matchMethod: 'email' };
  }
  for (const phone of [input.candidatePhone, input.dialedNumber]) {
    const key = normalizeLiveSessionPhone(phone);
    if (!key || key.length < 10) continue;
    const match = pickRegistrantForDisposition(input.byPhone.get(key) || [], input.disposedAtMs);
    if (match) return { registrant: match, matchMethod: 'phone' };
  }
  const candidateName = normalizeLiveSessionName(input.candidateName);
  if (candidateName && input.allRegistrants?.length) {
    const nameMatches = input.allRegistrants.filter((row) => liveSessionNamesMatch(row.name, candidateName));
    const match = pickRegistrantForDisposition(nameMatches, input.disposedAtMs);
    if (match) return { registrant: match, matchMethod: 'name' };
  }
  return { registrant: null, matchMethod: null };
}

export function liveSessionAttendedFromRegistrant(row: LiveSessionRegistrantRow): boolean {
  return row.attended_zoom === true;
}

export function resolveLiveSessionOutcome(registrant: LiveSessionRegistrantRow | null, now = new Date()): LiveSessionMatchResult {
  if (!registrant) return { status: 'pending', sessionDate: null, matchMethod: null, registrant: null };
  if (liveSessionAttendedFromRegistrant(registrant)) {
    return { status: 'attended', sessionDate: registrant.session_date, matchMethod: null, registrant };
  }
  const todayYmd = torontoYmdFromDate(now);
  if (registrant.session_date < todayYmd || registrant.calendly_no_show === true) {
    return { status: 'no_show', sessionDate: registrant.session_date, matchMethod: null, registrant };
  }
  return { status: 'scheduled', sessionDate: registrant.session_date, matchMethod: null, registrant };
}

export function matchLiveSessionForCallDisposition(input: {
  email?: string | null;
  candidatePhone?: string | null;
  candidateName?: string | null;
  dialedNumber?: string | null;
  disposedAtMs: number;
  registrants: LiveSessionRegistrantRow[];
  now?: Date;
}): LiveSessionMatchResult {
  const byEmail = buildLiveSessionRowsByEmail(input.registrants);
  const byPhone = buildLiveSessionRowsByPhone(input.registrants);
  const { registrant, matchMethod } = pickRegistrantForCallDisposition({
    email: input.email,
    candidatePhone: input.candidatePhone,
    candidateName: input.candidateName,
    dialedNumber: input.dialedNumber,
    disposedAtMs: input.disposedAtMs,
    byEmail,
    byPhone,
    allRegistrants: input.registrants,
  });
  const outcome = resolveLiveSessionOutcome(registrant, input.now);
  return { ...outcome, matchMethod: matchMethod || outcome.matchMethod };
}
