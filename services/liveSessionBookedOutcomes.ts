/**
 * Match pipeline Booked (Live Session) dispositions to Calendly registrants + Zoom attendance
 * from live_session_registrants (synced on Live Sessions refresh).
 */

import {
  fetchPipelineCandidateEmailsViaFunction,
  isSupabaseNetworkError,
} from './dashboardTeamMetricsService';
import { supabase } from './supabaseClient';
import { torontoYmdFromDate } from './webinarGeekDates';

export type LiveSessionRegistrantRow = {
  session_date: string;
  email: string;
  phone: string | null;
  attended_zoom: boolean;
  calendly_no_show: boolean | null;
  zoom_join_at: string | null;
};

export type LiveSessionOutcomeStatus = 'pending' | 'scheduled' | 'attended' | 'no_show';

export type LiveSessionMatchResult = {
  status: LiveSessionOutcomeStatus;
  sessionDate: string | null;
  matchMethod: 'email' | 'phone' | null;
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

export async function loadLiveSessionRegistrantsForMatching(): Promise<LiveSessionRegistrantRow[]> {
  const { data, error } = await supabase
    .from('live_session_registrants')
    .select('session_date, email, phone, attended_zoom, calendly_no_show, zoom_join_at');
  if (error) {
    if (/relation|does not exist|schema cache/i.test(error.message)) return [];
    throw error;
  }
  return (data || []) as LiveSessionRegistrantRow[];
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
  dialedNumber?: string | null;
  disposedAtMs: number;
  byEmail: Map<string, LiveSessionRegistrantRow[]>;
  byPhone: Map<string, LiveSessionRegistrantRow[]>;
}): { registrant: LiveSessionRegistrantRow | null; matchMethod: 'email' | 'phone' | null } {
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
    dialedNumber: input.dialedNumber,
    disposedAtMs: input.disposedAtMs,
    byEmail,
    byPhone,
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

export const LIVE_SESSION_BOOKED_OUTCOME_RULE_LABEL =
  'Booked (Live Session) matched by candidate email or phone to Calendly/Zoom: registered => scheduled; Zoom join (attended_zoom) => showed (+15 Paz Coins); past session without join => no show.';
