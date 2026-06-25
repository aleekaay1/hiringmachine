/**
 * Match pipeline Booked (Live Session) dispositions to Calendly registrants + Zoom attendance
 * from live_session_registrants (synced on Live Sessions refresh).
 */

import {
  fetchLiveSessionRegistrantsViaFunction,
  fetchPipelineCandidateEmailsViaFunction,
  isSupabaseNetworkError,
} from './dashboardTeamMetricsService';
import { supabase } from './supabaseClient';
import { shiftYmdDays, torontoYmdFromDate } from './webinarGeekDates';

export type LiveSessionRegistrantRow = {
  session_date: string;
  email: string;
  name?: string | null;
  phone: string | null;
  attended_zoom: boolean;
  calendly_no_show: boolean | null;
  zoom_join_at: string | null;
  zoom_leave_at: string | null;
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

export function liveSessionPhonesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = normalizeLiveSessionPhone(a);
  const db = normalizeLiveSessionPhone(b);
  if (!da || !db || da.length < 10 || db.length < 10) return false;
  return da === db;
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

const REGISTRANTS_CACHE_TTL_MS = 60_000;
let registrantsCache: { key: string; expires: number; rows: LiveSessionRegistrantRow[] } | null = null;

export async function loadLiveSessionRegistrantsForMatching(options?: {
  sinceYmd?: string;
  untilYmd?: string;
}): Promise<LiveSessionRegistrantRow[]> {
  const sinceYmd = options?.sinceYmd ?? shiftYmdDays(torontoYmdFromDate(), -120);
  const untilYmd = options?.untilYmd;
  const cacheKey = `${sinceYmd}|${untilYmd ?? ''}`;
  const now = Date.now();
  if (registrantsCache && registrantsCache.key === cacheKey && registrantsCache.expires > now) {
    return registrantsCache.rows;
  }

  let rows: LiveSessionRegistrantRow[];
  try {
    rows = await loadLiveSessionRegistrantsFromRest(sinceYmd, untilYmd);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/relation|does not exist|schema cache/i.test(msg)) {
      rows = [];
    } else if (isSupabaseNetworkError(msg)) {
      const viaFn = await fetchLiveSessionRegistrantsViaFunction({ sinceYmd, untilYmd });
      rows = viaFn.ok ? viaFn.registrants : [];
    } else {
      throw e;
    }
  }

  registrantsCache = { key: cacheKey, expires: now + REGISTRANTS_CACHE_TTL_MS, rows };
  return rows;
}

async function loadLiveSessionRegistrantsFromRest(
  sinceYmd: string,
  untilYmd?: string,
): Promise<LiveSessionRegistrantRow[]> {
  const all: LiveSessionRegistrantRow[] = [];
  const pageSize = 1000;
  let from = 0;

  while (from < 25_000) {
    let query = supabase
      .from('live_session_registrants')
      .select('session_date, email, name, phone, attended_zoom, calendly_no_show, zoom_join_at, zoom_leave_at')
      .gte('session_date', sinceYmd)
      .order('session_date', { ascending: true })
      .range(from, from + pageSize - 1);
    if (untilYmd) query = query.lte('session_date', untilYmd);

    const { data, error } = await query;
    if (error) {
      if (/relation|does not exist|schema cache/i.test(error.message)) return [];
      if (isSupabaseNetworkError(error.message)) {
        const viaFn = await fetchLiveSessionRegistrantsViaFunction({ sinceYmd, untilYmd });
        if (viaFn.ok) return viaFn.registrants;
      }
      throw error;
    }

    const batch = (data || []) as LiveSessionRegistrantRow[];
    all.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }

  return all;
}

export function buildLiveSessionRowsByEmail(
  rows: LiveSessionRegistrantRow[],
): Map<string, LiveSessionRegistrantRow[]> {
  const map = new Map<string, LiveSessionRegistrantRow[]>();
  for (const row of rows) {
    const email = normalizeLiveSessionEmail(row.email);
    if (!email) continue;
    const list = map.get(email) || [];
    list.push(row);
    map.set(email, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.session_date.localeCompare(b.session_date));
  }
  return map;
}

export function buildLiveSessionRowsByPhone(
  rows: LiveSessionRegistrantRow[],
): Map<string, LiveSessionRegistrantRow[]> {
  const map = new Map<string, LiveSessionRegistrantRow[]>();
  for (const row of rows) {
    const phone = normalizeLiveSessionPhone(row.phone);
    if (!phone || phone.length < 10) continue;
    const list = map.get(phone) || [];
    list.push(row);
    map.set(phone, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.session_date.localeCompare(b.session_date));
  }
  return map;
}

/** Best registrant row for a booking disposition (session on/after book date, else latest prior). */
export function pickRegistrantForDisposition(
  rows: LiveSessionRegistrantRow[],
  disposedAtMs: number,
): LiveSessionRegistrantRow | null {
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

export function resolveLiveSessionOutcome(
  registrant: LiveSessionRegistrantRow | null,
  now = new Date(),
): LiveSessionMatchResult {
  if (!registrant) {
    return { status: 'pending', sessionDate: null, matchMethod: null, registrant: null };
  }
  if (liveSessionAttendedFromRegistrant(registrant)) {
    return {
      status: 'attended',
      sessionDate: registrant.session_date,
      matchMethod: null,
      registrant,
    };
  }
  const todayYmd = torontoYmdFromDate(now);
  if (registrant.session_date < todayYmd || registrant.calendly_no_show === true) {
    return {
      status: 'no_show',
      sessionDate: registrant.session_date,
      matchMethod: null,
      registrant,
    };
  }
  return {
    status: 'scheduled',
    sessionDate: registrant.session_date,
    matchMethod: null,
    registrant,
  };
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

function mergeEmailRows(map: Map<string, string>, rows: Array<{ id?: string; email?: string }>): void {
  for (const row of rows) {
    const id = String(row.id || '').trim();
    const email = normalizeLiveSessionEmail(row.email);
    if (id && email) map.set(id, email);
  }
}

function mergePhoneRows(map: Map<string, string>, rows: Array<{ id?: string; phone?: string | null }>): void {
  for (const row of rows) {
    const id = String(row.id || '').trim();
    const phone = String(row.phone || '').trim();
    if (id && phone) map.set(id, phone);
  }
}

async function loadPipelineCandidateEmailsChunk(slice: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!slice.length) return map;

  const { data: rpcData, error: rpcError } = await supabase.rpc('get_pipeline_candidate_emails', {
    p_ids: slice,
  });
  if (!rpcError && Array.isArray(rpcData)) {
    mergeEmailRows(map, rpcData as Array<{ id?: string; email?: string }>);
    return map;
  }

  const rpcMissing =
    rpcError?.code === 'PGRST202' ||
    /function.*does not exist|schema cache/i.test(rpcError?.message || '');

  try {
    const { data, error } = await supabase
      .from('pipeline_candidates')
      .select('id, email')
      .in('id', slice);
    if (!error) {
      mergeEmailRows(map, (data || []) as Array<{ id?: string; email?: string }>);
      if (map.size > 0 || !rpcMissing) return map;
    } else if (!isSupabaseNetworkError(error.message) && !rpcMissing) {
      throw error;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!isSupabaseNetworkError(msg) && !rpcMissing) throw e;
  }

  const viaFn = await fetchPipelineCandidateEmailsViaFunction(slice);
  if (viaFn.ok) {
    for (const [id, email] of viaFn.emails) map.set(id, email);
    return map;
  }

  if (rpcError && !rpcMissing) throw rpcError;
  if (!viaFn.ok && viaFn.error) throw new Error(viaFn.error);
  return map;
}

/** pipeline_call_records.candidate_id → pipeline_candidates.email */
export async function loadCandidateEmailsById(candidateIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(candidateIds.filter(Boolean))];
  if (!unique.length) return new Map();

  const viaFn = await fetchPipelineCandidateEmailsViaFunction(unique);
  if (viaFn.ok) return viaFn.emails;

  const map = new Map<string, string>();
  const chunk = 150;
  for (let i = 0; i < unique.length; i += chunk) {
    const slice = unique.slice(i, i + chunk);
    const part = await loadPipelineCandidateEmailsChunk(slice);
    for (const [id, email] of part) map.set(id, email);
  }
  if (map.size === 0 && !viaFn.ok) throw new Error(viaFn.error);
  return map;
}

/** candidate email (normalized) → pipeline_candidates.phone */
export async function loadCandidatePhonesByEmail(emails: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(emails.map(normalizeLiveSessionEmail).filter(Boolean))];
  if (!unique.length) return new Map();

  const map = new Map<string, string>();
  const chunk = 80;
  for (let i = 0; i < unique.length; i += chunk) {
    const slice = unique.slice(i, i + chunk);
    const { data, error } = await supabase
      .from('pipeline_candidates')
      .select('email, phone')
      .in('email', slice);
    if (error) {
      if (/relation|does not exist|schema cache/i.test(error.message)) return map;
      throw error;
    }
    for (const row of (data || []) as Array<{ email?: string | null; phone?: string | null }>) {
      const email = normalizeLiveSessionEmail(row.email);
      const phone = String(row.phone || '').trim();
      if (email && phone && !map.has(email)) map.set(email, phone);
    }
  }
  return map;
}

/** Portal verify/book form submissions: email → phone from booking audit metadata. */
export async function loadPortalBookingPhonesByEmail(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const { data, error } = await supabase
    .from('webinar_geek_portal_bookings')
    .select('candidate_email, metadata')
    .eq('status', 'booked')
    .order('created_at', { ascending: false })
    .limit(8000);
  if (error) {
    if (/relation|does not exist|schema cache|permission denied/i.test(error.message)) return map;
    throw error;
  }
  for (const row of (data || []) as Array<{ candidate_email?: string | null; metadata?: unknown }>) {
    const email = normalizeLiveSessionEmail(row.candidate_email);
    if (!email || map.has(email)) continue;
    const meta = row.metadata && typeof row.metadata === 'object'
      ? (row.metadata as Record<string, unknown>)
      : null;
    const payload = meta?.attempted_payload && typeof meta.attempted_payload === 'object'
      ? (meta.attempted_payload as Record<string, unknown>)
      : null;
    const phone = String(payload?.phone ?? meta?.phone ?? '').trim();
    if (phone) map.set(email, phone);
  }
  return map;
}

/** pipeline_call_records.candidate_id → pipeline_candidates.phone */
export async function loadCandidatePhonesById(candidateIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(candidateIds.filter(Boolean))];
  if (!unique.length) return new Map();

  const map = new Map<string, string>();
  const chunk = 150;
  for (let i = 0; i < unique.length; i += chunk) {
    const slice = unique.slice(i, i + chunk);
    const { data, error } = await supabase
      .from('pipeline_candidates')
      .select('id, phone')
      .in('id', slice);
    if (error) {
      if (/relation|does not exist|schema cache/i.test(error.message)) return map;
      throw error;
    }
    mergePhoneRows(map, (data || []) as Array<{ id?: string; phone?: string | null }>);
  }
  return map;
}

/** pipeline_call_records.candidate_id → pipeline_candidates.full_name */
export async function loadCandidateNamesById(candidateIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(candidateIds.filter(Boolean))];
  if (!unique.length) return new Map();

  const map = new Map<string, string>();
  const chunk = 150;
  for (let i = 0; i < unique.length; i += chunk) {
    const slice = unique.slice(i, i + chunk);
    const { data, error } = await supabase
      .from('pipeline_candidates')
      .select('id, full_name')
      .in('id', slice);
    if (error) {
      if (/relation|does not exist|schema cache/i.test(error.message)) return map;
      throw error;
    }
    for (const row of (data || []) as Array<{ id?: string; full_name?: string | null }>) {
      const id = String(row.id || '').trim();
      const name = String(row.full_name || '').trim();
      if (id && name) map.set(id, name);
    }
  }
  return map;
}

export const LIVE_SESSION_BOOKED_OUTCOME_RULE_LABEL =
  'Booked (Live Session) matched by candidate email, phone, or name to Calendly/Zoom: registered => scheduled; Zoom join (attended_zoom) => showed (+15 Paz Coins); past session without join => no show.';
