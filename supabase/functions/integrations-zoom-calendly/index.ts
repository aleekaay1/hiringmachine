/**
 * Live Online Career Session — attendance dashboard.
 *
 * Fixed schedule (America/Toronto):
 *   WEDNESDAY 11:30–12:00  (30-min webinar; Zoom + Calendly "Live Online Career Session")
 *
 * Matching strategy (v2 — date-exact):
 *   1. Keep only Zoom meeting occurrences whose start falls inside one of the two windows above.
 *   2. Keep only Calendly scheduled events that also fall inside one of the two windows.
 *   3. Pair them by EXACT calendar date (YYYY-MM-DD in America/Toronto) — not just weekday or
 *      a floating UTC tolerance.  A Calendly event for Tue 2026-04-22 matches the Zoom occurrence
 *      that ran on 2026-04-22, no guessing.
 *   4. Attend check: Calendly invitee email ∈ Zoom participant emails → attended_zoom = true.
 *
 * Secrets required:
 *   ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET, ZOOM_HOST_USER_EMAIL
 *   CALENDLY_API_TOKEN  (optional; without it, invitee data is empty)
 *
 * Optional secrets:
 *   ZOOM_LOOKBACK_DAYS   (default 90)   — how many past days to scan
 *   ZOOM_LOOKAHEAD_DAYS  (default 60)   — upcoming window
 *   INTEGRATION_SLOT_TOLERANCE_MINUTES  (default 20) — how far a meeting can start from slot edge
 *
 * Auth: Supabase JWT.
 * Deploy: supabase functions deploy integrations-zoom-calendly
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { DateTime } from 'npm:luxon@3.5.0';
import {
  createServiceRoleClient,
  loadLiveSessionsRegistryPayload,
  persistLiveSessionsRegistry,
  reclassifySessionsByStart,
} from '../_shared/liveSessionsRegistry.ts';
import {
  fetchZoomParticipantsForSessionDate,
  zoomParticipantsForUuid,
  zoomPastInstancesForMeetingId,
  type ZoomParticipant,
} from '../_shared/zoomAttendance.ts';
import { ZOOM_MEETING_URL } from '../_shared/hiringUrls.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
};

const ZOOM_API   = 'https://api.zoom.us/v2';
const CALENDLY_API = 'https://api.calendly.com';
const TZ = 'America/Toronto';

// ─── session slot definitions ──────────────────────────────────────────────
type SlotDef = { weekday: number; startH: number; startM: number; endH: number; endM: number; label: string };
const WEDNESDAY_LIVE_SLOT: SlotDef = {
  weekday: 3,
  startH: 11,
  startM: 30,
  endH: 12,
  endM: 0,
  label: 'Wednesday 11:30 AM ET (30 min)',
};
const SLOTS: SlotDef[] = [WEDNESDAY_LIVE_SLOT];
const LIVE_TOPIC_KEYWORD = 'live career overview session';
const LIVE_ONLINE_CALENDLY_NAME = 'live online career session';
const ZOOM_TOPIC_KEYWORDS = [
  LIVE_TOPIC_KEYWORD,
  LIVE_ONLINE_CALENDLY_NAME,
  'live career session',
  'career overview session',
];
type TargetMeetingDef = { id: string; weekday: number; slot: SlotDef };

/** PMI / recurring meeting id(s) — env override, else digits from ZOOM_MEETING_URL join link (6478311787). */
function meetingIdFromJoinUrl(url: string): string | null {
  const m = url.match(/\/j\/(\d{9,12})/i) ?? url.match(/[?&]meetingId=(\d+)/i);
  return m?.[1] ?? null;
}

function resolveConfiguredMeetingIds(): string[] {
  const raw = Deno.env.get('ZOOM_LIVE_SESSION_MEETING_ID')?.trim();
  if (raw && !['*', 'any'].includes(raw.toLowerCase())) {
    const ids = raw.split(/[,|]/).map((s) => s.replace(/\D/g, '')).filter(Boolean);
    if (ids.length > 0) return [...new Set(ids)];
  }
  const fromUrl = meetingIdFromJoinUrl(ZOOM_MEETING_URL);
  if (fromUrl) return [fromUrl];
  return ['6478311787'];
}

function getTargetMeetings(): TargetMeetingDef[] {
  return resolveConfiguredMeetingIds().map((id) => ({
    id,
    weekday: WEDNESDAY_LIVE_SLOT.weekday,
    slot: WEDNESDAY_LIVE_SLOT,
  }));
}

/** Keywords in the Zoom meeting topic that identify it as a live overview session PMI room. */
const PMI_TOPIC_KEYWORDS = ['personal meeting room', 'alex paz', 'career overview', 'career session', 'live overview'];

/** Returns true when the meeting topic matches a known PMI/personal-room keyword (case-insensitive). */
function isKnownPmiTopic(topic: string): boolean {
  const t = topic.toLowerCase();
  return PMI_TOPIC_KEYWORDS.some((k) => t.includes(k));
}

/** Returns slot definition if dt falls inside it (with tolerance), else null. */
function slotForDt(dt: DateTime, toleranceMin = 45): SlotDef | null {
  if (!dt.isValid) return null;
  for (const s of SLOTS) {
    if (dt.weekday !== s.weekday) continue;
    const startMod = s.startH * 60 + s.startM;
    const endMod   = s.endH   * 60 + s.endM;
    const dtMod    = dt.hour  * 60 + dt.minute;
    if (dtMod >= startMod - toleranceMin && dtMod <= endMod + toleranceMin) return s;
  }
  return null;
}

/**
 * Best slot label for a meeting. If it doesn't match a slot but has a PMI topic,
 * infer label from the weekday (Tue → Tuesday, Wed → Wednesday).
 */
function inferSlot(dt: DateTime | null, topic: string, toleranceMin: number): SlotDef | null {
  if (!dt?.isValid) return null;
  const bySlot = slotForDt(dt, toleranceMin);
  if (bySlot) return bySlot;
  // PMI topic fallback: accept on Tue/Wed only when reasonably close to slot start.
  // This avoids picking unrelated PMI occurrences on the same day.
  if (isKnownPmiTopic(topic)) {
    const slot = dt.weekday === 3 ? WEDNESDAY_LIVE_SLOT : null;
    if (!slot) return null;
    const slotStart = slot.startH * 60 + slot.startM;
    const dtMin = dt.hour * 60 + dt.minute;
    const distance = Math.abs(dtMin - slotStart);
    const maxPmiFallbackDistance = Number(Deno.env.get('PMI_FALLBACK_MAX_MINUTES_FROM_SLOT') ?? '180');
    if (distance <= Math.max(30, Math.min(480, maxPmiFallbackDistance))) return slot;
  }
  return null;
}

function meetingIdOf(m: ZoomRawMeeting): string {
  return String((m as { id?: string | number }).id ?? '').replace(/\D/g, '');
}

function zoomTopicMatchesLiveSession(topic: string): boolean {
  const t = topic.toLowerCase();
  return ZOOM_TOPIC_KEYWORDS.some((k) => t.includes(k));
}

/**
 * True when this Zoom row is our Wednesday live session PMI or a matching topic.
 * PMI topics are often "Personal Meeting Room" — do not require live-session keywords on topic.
 */
function isTargetLiveMeeting(m: ZoomRawMeeting, dt: DateTime | null, toleranceMin = 20): SlotDef | null {
  if (!dt?.isValid) return null;
  const id = meetingIdOf(m);
  const topic = String(m.topic ?? '');
  const target = getTargetMeetings().find((t) => t.id === id);
  if (!target || dt.weekday !== target.weekday) return null;

  const tol = Math.max(toleranceMin, 45);
  const inSlot = slotForDt(dt, tol) !== null || calendlySlotDistanceMinutes(dt) <= tol;
  if (inSlot) return target.slot;

  if (zoomTopicMatchesLiveSession(topic)) return target.slot;

  if (isKnownPmiTopic(topic)) {
    const slotStart = target.slot.startH * 60 + target.slot.startM;
    const dtMin = dt.hour * 60 + dt.minute;
    const distance = Math.abs(dtMin - slotStart);
    const maxDist = Number(Deno.env.get('PMI_FALLBACK_MAX_MINUTES_FROM_SLOT') ?? '180');
    if (distance <= Math.max(30, Math.min(480, maxDist))) return target.slot;
  }
  return null;
}

function calendlySlotDistanceMinutes(dt: DateTime): number {
  const slotStart = WEDNESDAY_LIVE_SLOT.startH * 60 + WEDNESDAY_LIVE_SLOT.startM;
  return Math.abs(dt.hour * 60 + dt.minute - slotStart);
}

function activeCalendlyInvitees(cache: Map<string, CalInvitee[]>, evUri: string | undefined | null): CalInvitee[] {
  if (!evUri) return [];
  return (cache.get(evUri) ?? []).filter((i) => {
    if (i.canceled) return false;
    const s = String(i.status ?? '').toLowerCase();
    return s !== 'canceled' && s !== 'cancelled';
  });
}

// ─── Name-based attendance matching ────────────────────────────────────────
/** Normalise a display name for fuzzy matching: lowercase, collapse whitespace, strip punctuation. */
function normName(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * True if two names are "the same person":
 *   - Exact match after normalisation, OR
 *   - Both non-empty first tokens match AND last token (if present) also matches.
 * Very conservative — avoids false-positives across common first names.
 */
function samePersonByName(calName: string, zoomName: string): boolean {
  const a = normName(calName);
  const b = normName(zoomName);
  if (!a || !b) return false;
  if (a === b) return true;
  // Split into parts and require ≥ 2 tokens to match (first + last)
  const ap = a.split(' ').filter(Boolean);
  const bp = b.split(' ').filter(Boolean);
  if (ap.length < 2 || bp.length < 2) return false;
  // Check both orderings in case name parts are swapped
  const allB = new Set(bp);
  const shared = ap.filter((p) => p.length > 1 && allB.has(p));
  if (shared.length >= 2) return true;

  // Fallback for abbreviated last names: "john d" vs "john doe"
  const aFirst = ap[0];
  const bFirst = bp[0];
  if (!aFirst || !bFirst || aFirst !== bFirst) return false;
  const aLast = ap[ap.length - 1];
  const bLast = bp[bp.length - 1];
  if (!aLast || !bLast) return false;
  if (aLast.length >= 2 && bLast.startsWith(aLast)) return true;
  if (bLast.length >= 2 && aLast.startsWith(bLast)) return true;
  return false;
}

/** ISO date string YYYY-MM-DD in America/Toronto. */
function isoDate(dt: DateTime): string {
  return dt.toISODate() ?? '';
}

// ─── Zoom auth ─────────────────────────────────────────────────────────────
type ZoomTokenResponse = { access_token: string };

async function getZoomToken(): Promise<string> {
  const accountId    = Deno.env.get('ZOOM_ACCOUNT_ID')?.trim();
  const clientId     = Deno.env.get('ZOOM_CLIENT_ID')?.trim();
  const clientSecret = Deno.env.get('ZOOM_CLIENT_SECRET')?.trim();
  if (!accountId || !clientId || !clientSecret) {
    throw new Error('Missing Zoom Server-to-Server OAuth secrets (ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET)');
  }
  const res = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`,
    { method: 'POST', headers: { Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' } },
  );
  if (!res.ok) throw new Error(`Zoom OAuth failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as ZoomTokenResponse).access_token;
}

async function zoomGet(token: string, path: string): Promise<unknown> {
  const res = await fetch(`${ZOOM_API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Zoom GET ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function zoomGetUserId(token: string, email: string): Promise<string> {
  const j = (await zoomGet(token, `/users/${encodeURIComponent(email)}`)) as { id?: string };
  if (!j.id) throw new Error(`Zoom user not found: ${email}`);
  return j.id;
}

type ZoomRawMeeting = Record<string, unknown>;

async function zoomListMeetings(token: string, userId: string, type: 'past' | 'upcoming'): Promise<ZoomRawMeeting[]> {
  const pageSize = type === 'past' ? 30 : 100;
  const maxPages = type === 'past' ? 10 : 15;
  const all: ZoomRawMeeting[] = [];
  let next: string | null = `/users/${encodeURIComponent(userId)}/meetings?type=${type}&page_size=${pageSize}`;
  let pages = 0;
  while (next && pages < maxPages) {
    const res = await fetch(`${ZOOM_API}${next}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) { console.warn(`Zoom meetings ${type}: ${res.status}`); break; }
    const j = (await res.json()) as { meetings?: ZoomRawMeeting[]; next_page_token?: string };
    for (const m of j.meetings ?? []) all.push(m);
    next = j.next_page_token
      ? `/users/${encodeURIComponent(userId)}/meetings?type=${type}&page_size=${pageSize}&next_page_token=${encodeURIComponent(j.next_page_token)}`
      : null;
    pages++;
  }
  return all;
}

function pickZoomInstanceForTorontoDate(
  instances: ZoomRawMeeting[],
  dateKey: string,
  targetMinutes: number | null,
): ZoomRawMeeting | null {
  const onDate = instances.filter((m) => {
    const ms = parseZoomStartMs(m);
    if (!Number.isFinite(ms)) return false;
    const dt = DateTime.fromMillis(ms, { zone: TZ });
    return dt.isValid && isoDate(dt) === dateKey;
  });
  if (onDate.length === 0) return null;
  if (onDate.length === 1) return onDate[0];
  if (targetMinutes == null) {
    onDate.sort((a, b) => parseZoomStartMs(b) - parseZoomStartMs(a));
    return onDate[0];
  }
  let best = onDate[0];
  let bestDist = Number.POSITIVE_INFINITY;
  for (const m of onDate) {
    const ms = parseZoomStartMs(m);
    const dt = Number.isFinite(ms) ? DateTime.fromMillis(ms, { zone: TZ }) : null;
    if (!dt?.isValid) continue;
    const dist = Math.abs(dt.hour * 60 + dt.minute - targetMinutes);
    if (dist < bestDist) {
      bestDist = dist;
      best = m;
    }
  }
  return best;
}

async function discoverLiveSessionMeetingIds(
  token: string,
  userId: string,
  lookbackDays: number,
  slotToleranceMin: number,
): Promise<string[]> {
  const ids = new Set(resolveConfiguredMeetingIds());
  const past = await zoomListMeetings(token, userId, 'past');
  const cutoff = Date.now() - lookbackDays * 86400_000;
  for (const m of past) {
    const ms = parseZoomStartMs(m);
    if (!Number.isFinite(ms) || ms < cutoff) continue;
    const dt = DateTime.fromMillis(ms, { zone: TZ });
    if (!dt.isValid) continue;
    const topic = String(m.topic ?? '');
    const matches =
      isTargetLiveMeeting(m, dt, slotToleranceMin) !== null ||
      zoomTopicMatchesLiveSession(topic) ||
      isKnownPmiTopic(topic);
    if (!matches) continue;
    const id = meetingIdOf(m);
    if (id) ids.add(id);
  }
  return [...ids];
}

function buildParticipantMaps(participants: ZoomParticipant[]) {
  const participantByEmail = new Map<string, ZoomParticipant>();
  for (const p of participants) {
    const e = (p.user_email ?? '').trim().toLowerCase();
    if (e) participantByEmail.set(e, p);
  }
  const participantNames = participants
    .filter((p) => p.name)
    .map((p) => ({ norm: normName(p.name ?? ''), raw: p }));
  return { participantByEmail, participantNames };
}

function findParticipantForInvitee(
  invitee: CalInvitee,
  participantByEmail: Map<string, ZoomParticipant>,
  participantNames: Array<{ norm: string; raw: ZoomParticipant }>,
): ZoomParticipant | null {
  if (invitee.email && participantByEmail.has(invitee.email)) {
    return participantByEmail.get(invitee.email)!;
  }
  if (invitee.name) {
    for (const { norm, raw } of participantNames) {
      if (samePersonByName(invitee.name, raw.name ?? '') || normName(invitee.name) === norm) {
        return raw;
      }
    }
  }
  return null;
}

function mapInviteesWithAttendance(
  rawInvitees: CalInvitee[],
  participants: ZoomParticipant[],
) {
  const { participantByEmail, participantNames } = buildParticipantMaps(participants);
  return rawInvitees.map((i) => {
    const match = findParticipantForInvitee(i, participantByEmail, participantNames);
    return {
      email: i.email,
      name: i.name,
      status: i.status,
      no_show: i.no_show,
      attended_zoom: match !== null,
      match_method: match ? (participantByEmail.has(i.email) ? 'email' as const : 'name' as const) : null,
      join_time: match?.join_time ?? null,
      leave_time: match?.leave_time ?? null,
      phone_number: i.phone_number ?? null,
      timezone: i.timezone ?? null,
      invitee_uri: i.uri,
      event_uri: i.event_uri,
    };
  });
}

// ─── Zoom time parsing ─────────────────────────────────────────────────────
function normalizeZoomTz(raw: string): string {
  const lower = raw.trim().toLowerCase();
  const map: Record<string, string> = {
    'eastern time (us and canada)': TZ, 'eastern standard time': TZ,
    'eastern daylight time': TZ, est: TZ, edt: TZ, et: TZ,
    'us/eastern': TZ, 'canada/eastern': TZ,
  };
  if (/^\w+\/\w+/.test(raw.trim())) return raw.trim();
  return map[lower] ?? raw.trim();
}

function parseZoomStartMs(m: ZoomRawMeeting): number {
  const st = m.start_time;
  if (typeof st === 'number' && Number.isFinite(st)) return st > 1e12 ? st : st * 1000;
  const raw = String(st ?? '').trim();
  if (!raw) return NaN;
  if (/^\d{10,16}$/.test(raw)) { const v = Number(raw); return v > 1e12 ? v : v * 1000; }

  const hasOff = /Z$/i.test(raw) || /[+-]\d{2}:\d{2}$/.test(raw);
  if (hasOff) { const t = new Date(raw).getTime(); if (Number.isFinite(t)) return t; }

  const tzRaw = String((m as { timezone?: string }).timezone ?? '').trim();
  if (tzRaw) {
    const dt = DateTime.fromISO(raw, { zone: normalizeZoomTz(tzRaw) });
    if (dt.isValid) return dt.toUTC().toMillis();
  }
  const assumed = Deno.env.get('ZOOM_ASSUMED_TIMEZONE_IF_MISSING')?.trim() || TZ;
  const dtA = DateTime.fromISO(raw, { zone: assumed });
  if (dtA.isValid) return dtA.toUTC().toMillis();
  return Date.parse(raw);
}

function zoomMeetingKey(m: ZoomRawMeeting): string {
  return `${String(m.uuid ?? '')}|${String(m.start_time ?? '')}`;
}

// ─── Calendly helpers ──────────────────────────────────────────────────────
type CalEvent = {
  uri?: string;
  name?: string;
  event_type?: string;
  start_time?: string;
  end_time?: string;
  status?: string;
};
type CalInvitee = {
  uri: string; event_uri: string; email: string; name: string;
  status: string; no_show: boolean; canceled: boolean;
  timezone?: string; phone_number?: string | null;
  cancel_url?: string; reschedule_url?: string;
  created_at?: string; updated_at?: string;
  questions_and_answers?: Array<{ question: string; answer: string }>;
};

async function calendlyGet(token: string, path: string): Promise<unknown> {
  const res = await fetch(`${CALENDLY_API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Calendly ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function calendlyListScheduledEventsPaged(
  token: string,
  scope: 'user' | 'organization',
  scopeUri: string,
  from: Date,
  to: Date,
): Promise<CalEvent[]> {
  const all: CalEvent[] = [];
  const scopeKey = scope === 'organization' ? 'organization' : 'user';
  const baseQuery =
    `min_start_time=${encodeURIComponent(from.toISOString())}` +
    `&max_start_time=${encodeURIComponent(to.toISOString())}&count=100`;
  let nextPath: string | null =
    `/scheduled_events?${scopeKey}=${encodeURIComponent(scopeUri)}&${baseQuery}`;
  let safety = 0;
  while (nextPath && safety < 50) {
    safety++;
    const body = (await calendlyGet(token, nextPath)) as {
      collection?: CalEvent[];
      pagination?: { next_page?: string | null; next_page_token?: string | null };
    };
    all.push(...(body.collection ?? []));
    const pag = body.pagination;
    if (pag?.next_page) {
      try {
        const u = new URL(pag.next_page);
        nextPath = u.pathname + u.search;
      } catch {
        nextPath = null;
      }
    } else if (pag?.next_page_token) {
      nextPath =
        `/scheduled_events?${scopeKey}=${encodeURIComponent(scopeUri)}&${baseQuery}` +
        `&page_token=${encodeURIComponent(pag.next_page_token)}`;
    } else {
      nextPath = null;
    }
  }
  return all;
}

async function calendlyResolveEventName(
  token: string,
  ev: CalEvent,
  cache: Map<string, string>,
): Promise<string> {
  const direct = String(ev.name ?? '').trim();
  if (direct) return direct;
  const et = String(ev.event_type ?? '').trim();
  if (!et) return '';
  if (cache.has(et)) return cache.get(et) ?? '';
  try {
    const uuid = et.replace(/\/$/, '').split('/').pop() ?? '';
    const body = (await calendlyGet(token, `/event_types/${encodeURIComponent(uuid)}`)) as {
      resource?: { name?: string };
    };
    const n = String(body.resource?.name ?? '').trim();
    cache.set(et, n);
    return n;
  } catch (e) {
    console.warn('[calendly] event_type name lookup failed', et, e instanceof Error ? e.message : String(e));
    return '';
  }
}

type CalendlyFetchBundle = {
  events: CalEvent[];
  userUri: string;
  organizationUri: string | null;
  fetch_stats: { user_scope_count: number; organization_scope_count: number; deduped_count: number };
  event_types: Array<{ uri: string; name: string }>;
  calendly_user: { name?: string; email?: string; uri?: string; scheduling_url?: string };
};

/** User + organization scheduled events (team Calendly often only returns org scope). */
async function calendlyFetchAllScheduledEvents(
  token: string,
  from: Date,
  to: Date,
): Promise<CalendlyFetchBundle> {
  const calUserRaw = (await calendlyGet(token, '/users/me')) as {
    resource?: {
      uri?: string;
      name?: string;
      email?: string;
      scheduling_url?: string;
      current_organization?: string;
    };
  };
  const userUri = calUserRaw.resource?.uri;
  if (!userUri) throw new Error('Calendly /users/me did not return resource.uri');
  const organizationUri = calUserRaw.resource?.current_organization?.trim() || null;

  const byUri = new Map<string, CalEvent>();
  let userScopeCount = 0;
  let orgScopeCount = 0;

  for (const ev of await calendlyListScheduledEventsPaged(token, 'user', userUri, from, to)) {
    if (!ev.uri) continue;
    byUri.set(ev.uri, ev);
    userScopeCount++;
  }
  if (organizationUri) {
    for (const ev of await calendlyListScheduledEventsPaged(token, 'organization', organizationUri, from, to)) {
      if (!ev.uri) continue;
      byUri.set(ev.uri, ev);
      orgScopeCount++;
    }
  }

  const nameCache = new Map<string, string>();
  const events: CalEvent[] = [];
  for (const ev of byUri.values()) {
    const resolvedName = await calendlyResolveEventName(token, ev, nameCache);
    events.push({ ...ev, name: resolvedName || ev.name });
  }

  const eventTypes: Array<{ uri: string; name: string }> = [];
  try {
    const typesPath = organizationUri
      ? `/event_types?organization=${encodeURIComponent(organizationUri)}&count=100`
      : `/event_types?user=${encodeURIComponent(userUri)}&count=100`;
    const typesBody = (await calendlyGet(token, typesPath)) as {
      collection?: Array<{ uri?: string; name?: string }>;
    };
    for (const t of typesBody.collection ?? []) {
      const name = String(t.name ?? '').trim();
      if (name) eventTypes.push({ uri: String(t.uri ?? ''), name });
    }
  } catch (e) {
    console.warn('[calendly] event_types list failed', e instanceof Error ? e.message : String(e));
  }

  console.log(
    '[calendly] scheduled_events — user:',
    userScopeCount,
    'org:',
    orgScopeCount,
    'deduped:',
    events.length,
    'event_types:',
    eventTypes.length,
  );

  return {
    events,
    userUri,
    organizationUri,
    fetch_stats: {
      user_scope_count: userScopeCount,
      organization_scope_count: orgScopeCount,
      deduped_count: events.length,
    },
    event_types: eventTypes,
    calendly_user: {
      name: calUserRaw.resource?.name,
      email: calUserRaw.resource?.email,
      uri: userUri,
      scheduling_url: calUserRaw.resource?.scheduling_url,
    },
  };
}

function calendlyEventNameKeywords(): string[] {
  const raw = Deno.env.get('CALENDLY_EVENT_NAME_KEYWORDS')?.trim();
  if (raw) {
    return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  }
  return [LIVE_ONLINE_CALENDLY_NAME, 'career overview', 'live career session'];
}

function calendlyEventMatchesLiveSession(eventName: string): boolean {
  const n = String(eventName ?? '').toLowerCase();
  if (n.includes(LIVE_ONLINE_CALENDLY_NAME)) return true;
  return calendlyEventNameKeywords().some((k) => n.includes(k));
}

/** Wednesday 11:30 AM ET window (with slot tolerance). */
function isWednesdayLiveSessionSlot(dt: DateTime, toleranceMin: number): boolean {
  if (!dt.isValid || dt.weekday !== 3) return false;
  const tol = Math.max(toleranceMin, 45);
  return slotForDt(dt, tol) !== null || calendlySlotDistanceMinutes(dt) <= tol;
}

function mapCalendlyInviteeRow(
  r: {
    uri?: string; event?: string; email?: string; name?: string; status?: string;
    no_show?: boolean; canceled?: boolean; timezone?: string;
    text_reminder_number?: string | null; cancel_url?: string;
    reschedule_url?: string; created_at?: string; updated_at?: string;
    questions_and_answers?: Array<{ question?: string; answer?: string }>;
  },
  eventUri: string,
): CalInvitee {
  return {
    uri: String(r.uri ?? ''),
    event_uri: String(r.event ?? eventUri),
    email: (r.email ?? '').trim().toLowerCase(),
    name: (r.name ?? '').trim(),
    status: (r.status ?? '').trim(),
    no_show: !!r.no_show,
    canceled: !!r.canceled,
    timezone: typeof r.timezone === 'string' ? r.timezone : undefined,
    phone_number: (() => {
      const qa = r.questions_and_answers ?? [];
      const found = qa.find((q) => (q.question ?? '').toLowerCase().includes('phone'));
      return found?.answer ?? (typeof r.text_reminder_number === 'string' ? r.text_reminder_number : null);
    })(),
    cancel_url: typeof r.cancel_url === 'string' ? r.cancel_url : undefined,
    reschedule_url: typeof r.reschedule_url === 'string' ? r.reschedule_url : undefined,
    created_at: typeof r.created_at === 'string' ? r.created_at : undefined,
    updated_at: typeof r.updated_at === 'string' ? r.updated_at : undefined,
    questions_and_answers: (r.questions_and_answers ?? [])
      .map((q) => ({ question: String(q.question ?? '').trim(), answer: String(q.answer ?? '').trim() }))
      .filter((q) => q.question || q.answer),
  };
}

async function calendlyInviteesForEvent(token: string, eventUri: string): Promise<CalInvitee[]> {
  const uuid = eventUri.replace(/\/$/, '').split('/').pop() ?? '';
  const all: CalInvitee[] = [];
  let nextPath: string | null = `/scheduled_events/${encodeURIComponent(uuid)}/invitees?count=100`;
  let safety = 0;
  while (nextPath && safety < 50) {
    safety++;
    const body = (await calendlyGet(token, nextPath)) as {
      collection?: Array<{
        uri?: string; event?: string; email?: string; name?: string; status?: string;
        no_show?: boolean; canceled?: boolean; timezone?: string;
        text_reminder_number?: string | null; cancel_url?: string;
        reschedule_url?: string; created_at?: string; updated_at?: string;
        questions_and_answers?: Array<{ question?: string; answer?: string }>;
      }>;
      pagination?: { next_page?: string | null; next_page_token?: string | null };
    };
    for (const r of body.collection ?? []) {
      all.push(mapCalendlyInviteeRow(r, eventUri));
    }
    const pag = body.pagination;
    if (pag?.next_page) {
      try {
        const u = new URL(pag.next_page);
        nextPath = u.pathname + u.search;
      } catch {
        nextPath = null;
      }
    } else if (pag?.next_page_token) {
      nextPath =
        `/scheduled_events/${encodeURIComponent(uuid)}/invitees?count=100&page_token=${encodeURIComponent(pag.next_page_token)}`;
    } else {
      nextPath = null;
    }
  }
  return all;
}

type CalendlyProbeEventRow = {
  uri: string;
  name: string;
  start_time: string;
  end_time: string;
  status: string;
  toronto_date: string;
  toronto_weekday: number;
  matches_live_name: boolean;
  matches_wednesday_slot: boolean;
  used_for_dashboard: boolean;
  invitee_count: number;
  invitee_count_active: number;
  invitees_sample: Array<{ email: string; name: string; status: string; canceled: boolean; no_show: boolean }>;
};

async function buildCalendlyProbePayload(
  token: string,
  lookbackDays: number,
  lookaheadDays: number,
): Promise<Record<string, unknown>> {
  const nowMs = Date.now();
  const from = new Date(nowMs - lookbackDays * 86400_000);
  const to = new Date(nowMs + lookaheadDays * 86400_000);
  const requireWednesdaySlot = (Deno.env.get('CALENDLY_REQUIRE_WEDNESDAY_SLOT') ?? Deno.env.get('CALENDLY_REQUIRE_TUE_WED') ?? '0').trim() !== '0';
  const slotToleranceMin = Number(Deno.env.get('INTEGRATION_SLOT_TOLERANCE_MINUTES') ?? '45');

  const bundle = await calendlyFetchAllScheduledEvents(token, from, to);
  const allCalEvents = bundle.events;

  const events: CalendlyProbeEventRow[] = [];
  for (const ev of allCalEvents) {
    if (!ev.start_time || !ev.uri) continue;
    const dt = DateTime.fromISO(ev.start_time, { zone: TZ });
    const name = String(ev.name ?? '');
    const matchesLive = calendlyEventMatchesLiveSession(name);
    const matchesWednesdaySlot = isWednesdayLiveSessionSlot(dt, slotToleranceMin);
    const usedForDashboard = matchesLive && (!requireWednesdaySlot || matchesWednesdaySlot);

    let invitees: CalInvitee[] = [];
    if (matchesLive) {
      try {
        invitees = await calendlyInviteesForEvent(token, ev.uri);
      } catch (e) {
        console.warn('[calendly_probe] invitees failed', ev.uri, e instanceof Error ? e.message : String(e));
      }
    }
    const active = invitees.filter((i) => !i.canceled && i.status !== 'canceled');

    events.push({
      uri: ev.uri,
      name,
      start_time: ev.start_time,
      end_time: String(ev.end_time ?? ''),
      status: String(ev.status ?? ''),
      toronto_date: dt.isValid ? isoDate(dt) : '',
      toronto_weekday: dt.weekday,
      matches_live_name: matchesLive,
      matches_wednesday_slot: matchesWednesdaySlot,
      used_for_dashboard: usedForDashboard,
      invitee_count: invitees.length,
      invitee_count_active: active.length,
      invitees_sample: active.slice(0, 8).map((i) => ({
        email: i.email,
        name: i.name,
        status: i.status,
        canceled: i.canceled,
        no_show: i.no_show,
      })),
    });
  }

  const matchingLive = events.filter((e) => e.matches_live_name);
  const used = events.filter((e) => e.used_for_dashboard);
  console.log('[calendly_probe] matching live name:', matchingLive.length, 'used for dashboard:', used.length);

  return {
    ok: true,
    calendly_probe: true,
    generated_at: new Date().toISOString(),
    calendly_user: bundle.calendly_user,
    organization_uri: bundle.organizationUri,
    fetch_stats: bundle.fetch_stats,
    event_types: bundle.event_types,
    range: { from: from.toISOString(), to: to.toISOString(), lookback_days: lookbackDays, lookahead_days: lookaheadDays },
    event_name_keywords: calendlyEventNameKeywords(),
    require_wednesday_slot: requireWednesdaySlot,
    events_total_in_range: allCalEvents.length,
    events_matching_live_name: matchingLive.length,
    events_used_for_dashboard: used.length,
    events,
    unique_event_type_names: [...new Set(allCalEvents.map((e) => String(e.name ?? '').trim()).filter(Boolean))].sort(),
  };
}

// ─── Snapshot persistence ──────────────────────────────────────────────────
async function sha256Hex(s: string): Promise<string> {
  const bytes = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function persistSnapshot(params: {
  supabaseUrl: string; serviceRole: string;
  generatedAtIso: string; payloadForHash: unknown; payloadFull: unknown;
  invitees: CalInvitee[];
}): Promise<{ enabled: boolean; wroteSnapshot: boolean; snapshotHash?: string; note?: string }> {
  const { supabaseUrl, serviceRole, generatedAtIso, payloadForHash, payloadFull, invitees } = params;
  if (!serviceRole) return { enabled: false, wroteSnapshot: false, note: 'missing_service_role' };
  const admin = createClient(supabaseUrl, serviceRole);
  const nextHash = await sha256Hex(JSON.stringify(payloadForHash));
  const { data: latest, error: latestErr } = await admin
    .from('live_sessions_snapshots').select('snapshot_hash')
    .order('generated_at', { ascending: false }).limit(1).maybeSingle();
  if (latestErr) return { enabled: false, wroteSnapshot: false, note: `snapshot_table_missing_or_error:${latestErr.message}` };
  if (latest?.snapshot_hash === nextHash) return { enabled: true, wroteSnapshot: false, snapshotHash: nextHash };
  const { error: insErr } = await admin.from('live_sessions_snapshots').insert({
    generated_at: generatedAtIso, snapshot_hash: nextHash, payload: payloadFull,
  });
  if (insErr) return { enabled: true, wroteSnapshot: false, snapshotHash: nextHash, note: `snapshot_insert_error:${insErr.message}` };
  if (invitees.length > 0) {
    const rows = invitees.map((i) => ({
      snapshot_hash: nextHash, invitee_uri: i.uri, event_uri: i.event_uri,
      email: i.email, name: i.name, status: i.status,
      no_show: i.no_show, canceled: i.canceled,
      timezone: i.timezone ?? null, phone_number: i.phone_number ?? null,
      cancel_url: i.cancel_url ?? null, reschedule_url: i.reschedule_url ?? null,
      created_at_source: i.created_at ?? null, updated_at_source: i.updated_at ?? null,
      questions_and_answers: i.questions_and_answers ?? [],
    }));
    await admin.from('live_session_invitees_archive').upsert(rows, { onConflict: 'snapshot_hash,invitee_uri' });
  }
  return { enabled: true, wroteSnapshot: true, snapshotHash: nextHash };
}

// ─── main handler ──────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'GET') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const reqUrl = new URL(req.url);
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const authHeader = req.headers.get('Authorization');
    const apikeyHeader = req.headers.get('apikey') ?? '';

    // Health check (before dashboard auth — needs headers, not a bare browser URL)
    if (reqUrl.searchParams.get('health') === '1') {
      const hasBearer = authHeader?.startsWith('Bearer ') ?? false;
      const hasAnonApiKey = apikeyHeader.length > 0 && apikeyHeader === anonKey;
      if (!hasBearer && !hasAnonApiKey) {
        return new Response(JSON.stringify({
          error: 'Unauthorized',
          hint:
            'This endpoint requires headers. In Live Sessions click "Check Zoom connection", or call with Authorization: Bearer <your_access_token> and apikey: <anon_key>.',
        }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (hasBearer) {
        const supabaseHealth = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: authHeader! } },
        });
        const { data: { user }, error: authErr } = await supabaseHealth.auth.getUser();
        if (authErr || !user) {
          return new Response(JSON.stringify({ error: 'Invalid or expired session' }), {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }
      const calTok = Deno.env.get('CALENDLY_API_TOKEN')?.trim();
      const hostEmail = Deno.env.get('ZOOM_HOST_USER_EMAIL')?.trim();
      let zoom_ok = false; let zoom_error: string | null = null;
      let zoom_past_instances_ok = false;
      let zoom_past_instances_count = 0;
      let zoom_participants_probe_ok = false;
      let zoom_participants_probe_error: string | null = null;
      let zoom_participants_probe_count = 0;
      const zoom_scopes_recommended = [
        'user:read:user:admin',
        'meeting:read:list_meetings:admin',
        'meeting:read:list_upcoming_meetings:admin',
        'meeting:read:list_past_instances:admin',
        'meeting:read:list_past_participants:admin',
        'report:read:list_meeting_participants:admin',
        'dashboard_meetings:read:list_meeting_participants:admin',
      ];
      try {
        const zt = await getZoomToken();
        await zoomGetUserId(zt, hostEmail ?? '');
        zoom_ok = true;
        const configuredIds = resolveConfiguredMeetingIds();
        const instancesByMeetingId: Record<string, number> = {};
        let probeMeetingId = configuredIds[0] ?? meetingIdFromJoinUrl(ZOOM_MEETING_URL) ?? '';
        for (const pmiId of configuredIds) {
          const instances = await zoomPastInstancesForMeetingId(zoomGet, zt, pmiId);
          instancesByMeetingId[pmiId] = instances.length;
          if (instances.length > zoom_past_instances_count) {
            zoom_past_instances_count = instances.length;
            probeMeetingId = pmiId;
            zoom_past_instances_ok = true;
            const testUuid = String(instances[0].uuid ?? '').trim();
            if (testUuid) {
              const probe = await zoomParticipantsForUuid(ZOOM_API, zt, testUuid);
              zoom_participants_probe_count = probe.length;
              zoom_participants_probe_ok = true;
              zoom_participants_probe_error = null;
            }
          }
        }
        if (!zoom_past_instances_ok) {
          zoom_participants_probe_error =
            `No past instances for meeting id(s) ${configuredIds.join(', ')}. Set Supabase secret ZOOM_LIVE_SESSION_MEETING_ID to your PMI digits (join link uses ${meetingIdFromJoinUrl(ZOOM_MEETING_URL) ?? 'unknown'}).`;
        }
      } catch (e) {
        zoom_error = e instanceof Error ? e.message : String(e);
        zoom_participants_probe_error = zoom_error;
      }
      let calendly_ok: boolean | null = null; let calendly_error: string | null = null;
      if (calTok) {
        try { await calendlyGet(calTok, '/users/me'); calendly_ok = true; }
        catch (e) { calendly_ok = false; calendly_error = e instanceof Error ? e.message : String(e); }
      }
      return new Response(JSON.stringify({
        ok: true,
        health: true,
        zoom_ok,
        zoom_error,
        zoom_past_instances_ok,
        zoom_past_instances_count,
        zoom_participants_probe_ok,
        zoom_participants_probe_error,
        zoom_participants_probe_count,
        zoom_pmi_meeting_id: probeMeetingId || configuredIds[0] || null,
        zoom_pmi_meeting_ids_configured: configuredIds,
        zoom_past_instances_by_meeting_id: instancesByMeetingId,
        zoom_join_url_meeting_id: meetingIdFromJoinUrl(ZOOM_MEETING_URL),
        zoom_scopes_recommended,
        calendly_configured: !!calTok,
        calendly_ok,
        calendly_error,
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Dashboard / sync — signed-in user required
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const supabase = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Invalid or expired session' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const lookbackDaysProbe = Math.max(14, Math.min(365, Number(Deno.env.get('ZOOM_LOOKBACK_DAYS') ?? '90')));
    const lookaheadDaysProbe = Math.max(7, Math.min(180, Number(Deno.env.get('ZOOM_LOOKAHEAD_DAYS') ?? '60')));

    if (reqUrl.searchParams.get('calendly_probe') === '1') {
      const calTok = Deno.env.get('CALENDLY_API_TOKEN')?.trim();
      if (!calTok) {
        return new Response(JSON.stringify({ ok: false, error: 'CALENDLY_API_TOKEN not set' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const probe = await buildCalendlyProbePayload(calTok, lookbackDaysProbe, lookaheadDaysProbe);
      return new Response(JSON.stringify(probe), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const syncLive = reqUrl.searchParams.get('sync') === '1';
    const readCacheOnly = reqUrl.searchParams.get('read_cache') === '1' && !syncLive;
    const serviceRoleEarly = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim() ?? '';

    if (readCacheOnly && serviceRoleEarly) {
      const adminCache = createServiceRoleClient(supabaseUrl, serviceRoleEarly);
      const cached = await loadLiveSessionsRegistryPayload(adminCache);
      const cacheMaxAgeMs = Math.max(
        60_000,
        Number(Deno.env.get('LIVE_SESSIONS_CACHE_MAX_AGE_MS') ?? String(6 * 60 * 60 * 1000)),
      );
      const cacheFresh =
        cached &&
        Number.isFinite(Date.parse(cached.generated_at)) &&
        Date.now() - Date.parse(cached.generated_at) <= cacheMaxAgeMs;
      if (cached && cacheFresh) {
        return new Response(JSON.stringify({
          ok: true,
          generated_at: cached.generated_at,
          from_cache: true,
          calendly_configured: true,
          zoom_user: { id: '', email: Deno.env.get('ZOOM_HOST_USER_EMAIL')?.trim() ?? '' },
          calendly_user: null,
          past_meetings: cached.past_meetings,
          upcoming_meetings: cached.upcoming_meetings,
          calendly_events_in_range: cached.past_meetings.length + cached.upcoming_meetings.length,
          registry: { ok: true, from_cache: true },
        }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    // Config
    const zoomHostEmail = Deno.env.get('ZOOM_HOST_USER_EMAIL')?.trim();
    if (!zoomHostEmail) return new Response(JSON.stringify({ error: 'Missing ZOOM_HOST_USER_EMAIL' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const calendlyToken = Deno.env.get('CALENDLY_API_TOKEN')?.trim();
    const calendlyEnabled = !!calendlyToken;
    const slotToleranceMin = Math.max(5, Math.min(120, Number(Deno.env.get('INTEGRATION_SLOT_TOLERANCE_MINUTES') ?? '45')));
    const lookbackDays   = Math.max(14, Math.min(365, Number(Deno.env.get('ZOOM_LOOKBACK_DAYS')  ?? '90')));
    const lookaheadDays  = Math.max(7,  Math.min(180, Number(Deno.env.get('ZOOM_LOOKAHEAD_DAYS') ?? '90')));
    const minPastDateRaw = (Deno.env.get('LIVE_SESSIONS_MIN_PAST_DATE') ?? '').trim();
    const minPastDate = minPastDateRaw
      ? DateTime.fromISO(minPastDateRaw, { zone: TZ }).startOf('day')
      : null;

    // Zoom — fetch all meetings
    const zoomToken = await getZoomToken();
    const zoomUserId = await zoomGetUserId(zoomToken, zoomHostEmail);
    const discoveredMeetingIds = await discoverLiveSessionMeetingIds(
      zoomToken,
      zoomUserId,
      lookbackDays,
      slotToleranceMin,
    );
    const targetMeetingIds = [...new Set([...resolveConfiguredMeetingIds(), ...discoveredMeetingIds])];
    const targetMeetingsForAttendance: TargetMeetingDef[] = targetMeetingIds.map((id) => ({
      id,
      weekday: WEDNESDAY_LIVE_SLOT.weekday,
      slot: WEDNESDAY_LIVE_SLOT,
    }));
    console.log('[integrations-zoom-calendly] PMI / live meeting ids:', targetMeetingIds.join(', '));

    const [zoomPastRaw, zoomUpRaw] = await Promise.all([
      zoomListMeetings(zoomToken, zoomUserId, 'past'),
      zoomListMeetings(zoomToken, zoomUserId, 'upcoming'),
    ]);

    const nowMs = Date.now();

    // Deduplicate by key, prefer upcoming row (richer fields)
    const byKey = new Map<string, ZoomRawMeeting>();
    for (const m of zoomPastRaw) { const k = zoomMeetingKey(m); if (!byKey.has(k)) byKey.set(k, m); }
    for (const m of zoomUpRaw)  { byKey.set(zoomMeetingKey(m), m); }

    const pastMeetingCandidates: ZoomRawMeeting[] = [];
    const upcomingMeetings: ZoomRawMeeting[] = [];

    for (const m of byKey.values()) {
      const ms    = parseZoomStartMs(m);
      const dt    = Number.isFinite(ms) ? DateTime.fromMillis(ms, { zone: TZ }) : null;

      // Only within lookback / lookahead window
      if (!Number.isFinite(ms)) continue;
      if (ms < nowMs - lookbackDays * 86400_000) continue;
      if (ms > nowMs + lookaheadDays * 86400_000) continue;
      if (ms < nowMs) {
        if (minPastDate?.isValid && dt?.isValid && dt < minPastDate) continue;
        // Past: keep only configured recurring live meetings.
        const slot = isTargetLiveMeeting(m, dt, slotToleranceMin);
        if (slot) pastMeetingCandidates.push(m);
      }
      else {
        // Upcoming: keep only configured recurring live meetings.
        const slot = isTargetLiveMeeting(m, dt, slotToleranceMin);
        if (slot) upcomingMeetings.push(m);
      }
    }

    upcomingMeetings.sort((a, b) => parseZoomStartMs(a) - parseZoomStartMs(b));

    // Calendly — fetch events in same window
    let calEventsByDate = new Map<string, CalEvent>(); // key: YYYY-MM-DD (Toronto)
    let calInviteesCache = new Map<string, CalInvitee[]>(); // key: event uri
    let calUser: { name?: string; email?: string } | null = null;
    const calendlyFilterLog: Array<{ name: string; start_time: string; reason: string }> = [];

    let calendlyFetchMeta: Record<string, unknown> | null = null;

    if (calendlyEnabled && calendlyToken) {
      const from = new Date(nowMs - lookbackDays * 86400_000);
      const to   = new Date(nowMs + lookaheadDays * 86400_000);
      const bundle = await calendlyFetchAllScheduledEvents(calendlyToken, from, to);
      calUser = { name: bundle.calendly_user.name, email: bundle.calendly_user.email };
      const allCalEvents = bundle.events;
      calendlyFetchMeta = {
        fetch_stats: bundle.fetch_stats,
        organization_uri: bundle.organizationUri,
        event_types: bundle.event_types,
      };
      const requireWednesdaySlot =
        (Deno.env.get('CALENDLY_REQUIRE_WEDNESDAY_SLOT') ?? Deno.env.get('CALENDLY_REQUIRE_TUE_WED') ?? '0').trim() !== '0';

      for (const ev of allCalEvents) {
        if (!ev.start_time) continue;
        const dt = DateTime.fromISO(ev.start_time, { zone: TZ });
        const name = String(ev.name ?? '');
        const isLiveName = calendlyEventMatchesLiveSession(name);
        const isWednesdaySlot = isWednesdayLiveSessionSlot(dt, slotToleranceMin);
        if (!isLiveName) {
          if (reqUrl.searchParams.get('calendly_debug') === '1') {
            calendlyFilterLog.push({ name, start_time: ev.start_time, reason: 'name_no_match' });
          }
          continue;
        }
        if (requireWednesdaySlot && !isWednesdaySlot) {
          if (reqUrl.searchParams.get('calendly_debug') === '1') {
            calendlyFilterLog.push({ name, start_time: ev.start_time, reason: 'not_wednesday_1130' });
          }
          continue;
        }
        const date = isoDate(dt);
        const existing = calEventsByDate.get(date);
        if (!existing) {
          calEventsByDate.set(date, ev);
        } else {
          const existingDt = DateTime.fromISO(existing.start_time, { zone: TZ });
          if (calendlySlotDistanceMinutes(dt) < calendlySlotDistanceMinutes(existingDt)) {
            calEventsByDate.set(date, ev);
          }
        }
      }

      console.log(
        '[integrations-zoom-calendly] Calendly events in range:',
        allCalEvents.length,
        'matched for dashboard:',
        calEventsByDate.size,
      );

      // Pre-load invitees for all matched Calendly events
      await Promise.all([...calEventsByDate.values()].map(async (ev) => {
        if (!ev.uri) return;
        try {
          const invitees = await calendlyInviteesForEvent(calendlyToken, ev.uri);
          calInviteesCache.set(ev.uri, invitees);
        } catch (e) {
          console.warn('[calendly] invitees failed', ev.uri, e instanceof Error ? e.message : String(e));
          calInviteesCache.set(ev.uri, []);
        }
      }));
    }

    // Choose one best past meeting occurrence per Toronto date:
    // prefer the one closest to Calendly event time on that date; else closest to slot start.
    const candidatesByDate = new Map<string, ZoomRawMeeting[]>();
    for (const m of pastMeetingCandidates) {
      const ms = parseZoomStartMs(m);
      if (!Number.isFinite(ms)) continue;
      const dt = DateTime.fromMillis(ms, { zone: TZ });
      if (!dt.isValid) continue;
      const dateKey = isoDate(dt);
      const list = candidatesByDate.get(dateKey) ?? [];
      list.push(m);
      candidatesByDate.set(dateKey, list);
    }

    // Calendly dates with no Zoom row in /users/meetings — resolve PMI past instance by meeting id.
    const pastInstancesCache = new Map<string, ZoomRawMeeting[]>();
    if (calendlyEnabled) {
      for (const [dateKey, calEv] of calEventsByDate.entries()) {
        if (!calEv.start_time || candidatesByDate.has(dateKey)) continue;
        const calStart = DateTime.fromISO(calEv.start_time, { zone: TZ });
        if (!calStart.isValid || calStart.toMillis() >= nowMs) continue;
        const targetMinutes = calStart.hour * 60 + calStart.minute;
        for (const target of targetMeetingsForAttendance) {
          let instances = pastInstancesCache.get(target.id);
          if (!instances) {
            instances = await zoomPastInstancesForMeetingId(zoomGet, zoomToken, target.id);
            pastInstancesCache.set(target.id, instances);
          }
          const picked = pickZoomInstanceForTorontoDate(instances, dateKey, targetMinutes);
          if (picked) {
            const list = candidatesByDate.get(dateKey) ?? [];
            list.push(picked);
            candidatesByDate.set(dateKey, list);
            console.log(`[zoom] past instance for ${dateKey} from PMI ${target.id}:`, picked.uuid);
            break;
          }
        }
      }
    }

    const selectedPastMeetings: ZoomRawMeeting[] = [];
    for (const [dateKey, list] of candidatesByDate.entries()) {
      if (list.length === 1) {
        selectedPastMeetings.push(list[0]);
        continue;
      }
      const calEv = calEventsByDate.get(dateKey) ?? null;
      const calStart = calEv?.start_time ? DateTime.fromISO(calEv.start_time, { zone: TZ }) : null;
      const targetMinutes = (() => {
        if (calStart?.isValid) return calStart.hour * 60 + calStart.minute;
        const dt0 = DateTime.fromISO(`${dateKey}T00:00:00`, { zone: TZ });
        if (!dt0.isValid) return null;
        const slot = slotForDt(dt0.set({ hour: 11, minute: 30 }), slotToleranceMin) || (dt0.weekday === 3 ? WEDNESDAY_LIVE_SLOT : null);
        return slot ? slot.startH * 60 + slot.startM : null;
      })();

      if (targetMinutes == null) {
        list.sort((a, b) => parseZoomStartMs(b) - parseZoomStartMs(a));
        selectedPastMeetings.push(list[0]);
        continue;
      }

      let best = list[0];
      let bestDist = Number.POSITIVE_INFINITY;
      for (const m of list) {
        const ms = parseZoomStartMs(m);
        const dt = Number.isFinite(ms) ? DateTime.fromMillis(ms, { zone: TZ }) : null;
        if (!dt?.isValid) continue;
        const minutes = dt.hour * 60 + dt.minute;
        const dist = Math.abs(minutes - targetMinutes);
        if (dist < bestDist) {
          bestDist = dist;
          best = m;
        }
      }
      selectedPastMeetings.push(best);
    }
    selectedPastMeetings.sort((a, b) => parseZoomStartMs(b) - parseZoomStartMs(a));

    // ─── Build past session rows ────────────────────────────────────────────
    const zoomAttendanceDebug: Array<Record<string, unknown>> = [];
    const combinedPast = await Promise.all(selectedPastMeetings.map(async (m) => {
      let uuid     = String(m.uuid     ?? '');
      const topic    = String(m.topic    ?? '');
      const start    = String(m.start_time ?? '');
      const startMs  = parseZoomStartMs(m);
      const duration = Number(m.duration ?? 0);
      const host     = String((m as { host_email?: string }).host_email || zoomHostEmail);
      const startDt  = Number.isFinite(startMs) ? DateTime.fromMillis(startMs, { zone: TZ }) : null;
      const slot     = isTargetLiveMeeting(m, startDt, slotToleranceMin);
      const dateKey  = startDt ? isoDate(startDt) : '';
      const calEvForParticipants = calEventsByDate.get(dateKey) ?? null;
      const calStartForParticipants = calEvForParticipants?.start_time
        ? DateTime.fromISO(calEvForParticipants.start_time, { zone: TZ })
        : null;
      const targetMinutesForParticipants = calStartForParticipants?.isValid
        ? calStartForParticipants.hour * 60 + calStartForParticipants.minute
        : (startDt?.isValid ? startDt.hour * 60 + startDt.minute : null);

      const calEv = calEventsByDate.get(dateKey) ?? null;
      const rawInvitees = activeCalendlyInvitees(calInviteesCache, calEv?.uri);

      const participantFetch = await fetchZoomParticipantsForSessionDate({
        zoomApiBase: ZOOM_API,
        token: zoomToken,
        zoomGet,
        dateKey,
        targetMinutes: targetMinutesForParticipants,
        meetingHint: m,
        targetMeetingIds,
        pastInstancesCache,
        parseZoomStartMs,
        isoDateFn: isoDate,
        timeZone: TZ,
      });
      const participants = participantFetch.participants;
      if (participantFetch.instanceUuid) {
        uuid = participantFetch.instanceUuid;
      }
      if (participants.length === 0) {
        console.warn(`[zoom] no participants for ${dateKey}`, participantFetch.debug);
      } else {
        console.log(`[zoom] ${dateKey}: ${participants.length} participants via ${participantFetch.debug.source}`);
      }
      zoomAttendanceDebug.push(participantFetch.debug as unknown as Record<string, unknown>);

      const inviteesWithAttendance = mapInviteesWithAttendance(rawInvitees, participants);

      const attended = inviteesWithAttendance.filter((i) => i.attended_zoom);
      const noShow   = inviteesWithAttendance.filter((i) => !i.attended_zoom);
      const attendedByEmail = attended.filter((i) => i.match_method === 'email').length;
      const attendedByName = attended.filter((i) => i.match_method === 'name').length;
      const participantsWithEmail = participants.filter((p) => (p.user_email ?? '').trim().length > 0).length;
      const participantSamples = participants.slice(0, 20).map((p) => ({
        name: p.name ?? '',
        email: (p.user_email ?? '').trim().toLowerCase(),
        join_time: p.join_time ?? null,
      }));
      const unmatchedInviteeSamples = noShow.slice(0, 20).map((i) => ({
        name: i.name,
        email: i.email,
      }));

      // Walk-ins: participants not matched to any Calendly invitee (by email or name)
      const matchedParticipantEmails = new Set(attended.map((i) => i.email).filter(Boolean));
      const walkinParticipants = participants.filter((p) => {
        const pe = (p.user_email ?? '').trim().toLowerCase();
        if (pe && matchedParticipantEmails.has(pe)) return false;
        // Also check by name to avoid duplicating matched-by-name participants
        return !attended.some((i) => samePersonByName(i.name, p.name ?? ''));
      });

      return {
        source: 'past' as const,
        session_type: slot?.label ?? null,
        zoom: { uuid, topic, start_time: start, start_at_ms: startMs, duration_minutes: duration, host_email: host, meeting_id: m.id },
        calendly: calEv ? { name: calEv.name, start_time: calEv.start_time, end_time: calEv.end_time, status: calEv.status, uri: calEv.uri } : null,
        participants: participants.map((p) => ({
          name:       p.name,
          email:      (p.user_email ?? '').trim().toLowerCase(),
          join_time:  p.join_time,
          leave_time: p.leave_time,
        })),
        invitees: inviteesWithAttendance,
        walkin_emails: walkinParticipants.map((p) => (p.user_email ?? '').trim().toLowerCase() || (p.name ?? '')),
        stats: {
          invited_count:           rawInvitees.length,
          attended_matched_count:  attended.length,
          no_show_or_absent_count: noShow.length,
          zoom_participant_count:  participants.length,
          attendance_rate_pct:     rawInvitees.length > 0 ? Math.round((attended.length / rawInvitees.length) * 100) : null,
        },
        debug_matching: {
          participants_with_email: participantsWithEmail,
          participants_without_email: Math.max(0, participants.length - participantsWithEmail),
          matched_by_email: attendedByEmail,
          matched_by_name: attendedByName,
          calendly_invitees_considered: rawInvitees.length,
          participant_samples: participantSamples,
          unmatched_invitee_samples: unmatchedInviteeSamples,
        },
      };
    }));

    // ─── Build upcoming rows ────────────────────────────────────────────────
    const combinedUpcoming = await Promise.all(upcomingMeetings.map(async (m) => {
      const startMs  = parseZoomStartMs(m);
      const topic    = String(m.topic ?? '');
      const startDt  = Number.isFinite(startMs) ? DateTime.fromMillis(startMs, { zone: TZ }) : null;
      const slot     = isTargetLiveMeeting(m, startDt, slotToleranceMin);
      const dateKey  = startDt ? isoDate(startDt) : '';
      const calEv    = calEventsByDate.get(dateKey) ?? null;
      const invitees = activeCalendlyInvitees(calInviteesCache, calEv?.uri)
        .map((i) => ({ email: i.email, name: i.name, status: i.status, no_show: i.no_show, phone_number: i.phone_number ?? null, timezone: i.timezone ?? null, invitee_uri: i.uri, event_uri: i.event_uri }));

      return {
        source: 'scheduled' as const,
        session_type: slot?.label ?? null,
        zoom: {
          uuid: String(m.uuid ?? ''), topic: String(m.topic ?? ''),
          start_time: String(m.start_time ?? ''), start_at_ms: startMs,
          duration_minutes: Number(m.duration ?? 0),
          host_email: String((m as { host_email?: string }).host_email || zoomHostEmail),
          join_url: String((m as { join_url?: string }).join_url || ''),
          meeting_id: m.id,
        },
        calendly: calEv ? { name: calEv.name, start_time: calEv.start_time, end_time: calEv.end_time, status: calEv.status, uri: calEv.uri } : null,
        invitees,
      };
    }));

    // Calendly-first: add sessions for matched Calendly dates that have no Zoom row (registrations still show).
    if (calendlyEnabled && calendlyToken) {
      const zoomPastDates = new Set(
        combinedPast.map((r) => {
          const ms = r.zoom.start_at_ms;
          const dt = typeof ms === 'number' && Number.isFinite(ms)
            ? DateTime.fromMillis(ms, { zone: TZ })
            : null;
          return dt?.isValid ? isoDate(dt) : '';
        }).filter(Boolean),
      );
      const zoomUpDates = new Set(
        combinedUpcoming.map((r) => {
          const ms = r.zoom.start_at_ms;
          const dt = typeof ms === 'number' && Number.isFinite(ms)
            ? DateTime.fromMillis(ms, { zone: TZ })
            : null;
          return dt?.isValid ? isoDate(dt) : '';
        }).filter(Boolean),
      );

      for (const [dateKey, calEv] of calEventsByDate.entries()) {
        if (!calEv.start_time || !calEv.uri) continue;
        const calStart = DateTime.fromISO(calEv.start_time, { zone: TZ });
        if (!calStart.isValid) continue;
        const calMs = calStart.toMillis();
        const rawInvitees = activeCalendlyInvitees(calInviteesCache, calEv.uri);
        const calMeta = {
          name: calEv.name,
          start_time: calEv.start_time,
          end_time: calEv.end_time,
          status: calEv.status,
          uri: calEv.uri,
        };

        if (calMs < nowMs) {
          if (zoomPastDates.has(dateKey)) {
            const existing = combinedPast.find((r) => {
              const calDt = r.calendly?.start_time
                ? DateTime.fromISO(r.calendly.start_time, { zone: TZ })
                : null;
              if (calDt?.isValid && isoDate(calDt) === dateKey) return true;
              const ms = r.zoom.start_at_ms;
              const zoomDt = typeof ms === 'number' && Number.isFinite(ms)
                ? DateTime.fromMillis(ms, { zone: TZ })
                : null;
              return zoomDt?.isValid ? isoDate(zoomDt) === dateKey : false;
            });
            const needsZoomAttendance = Boolean(
              existing &&
              rawInvitees.length > 0 &&
              (existing.invitees.length === 0 || (existing.stats?.zoom_participant_count ?? 0) === 0),
            );
            if (needsZoomAttendance && existing) {
              const targetMinutes = calStart.hour * 60 + calStart.minute;
              let zoomMeeting: ZoomRawMeeting | null = null;
              for (const target of targetMeetingsForAttendance) {
                let instances = pastInstancesCache.get(target.id);
                if (!instances) {
                  instances = await zoomPastInstancesForMeetingId(zoomGet, zoomToken, target.id);
                  pastInstancesCache.set(target.id, instances);
                }
                zoomMeeting = pickZoomInstanceForTorontoDate(instances, dateKey, targetMinutes);
                if (zoomMeeting) break;
              }
              const participantFetch = await fetchZoomParticipantsForSessionDate({
                zoomApiBase: ZOOM_API,
                token: zoomToken,
                zoomGet,
                dateKey,
                targetMinutes,
                meetingHint: zoomMeeting,
                targetMeetingIds,
                pastInstancesCache,
                parseZoomStartMs,
                isoDateFn: isoDate,
                timeZone: TZ,
              });
              const participants = participantFetch.participants;
              zoomAttendanceDebug.push(participantFetch.debug as unknown as Record<string, unknown>);
              const inviteesWithAttendance = mapInviteesWithAttendance(rawInvitees, participants);
              const attended = inviteesWithAttendance.filter((i) => i.attended_zoom);
              existing.invitees = inviteesWithAttendance;
              existing.calendly = calMeta;
              existing.participants = participants.map((p) => ({
                name: p.name,
                email: (p.user_email ?? '').trim().toLowerCase(),
                join_time: p.join_time,
                leave_time: p.leave_time,
              }));
              existing.stats = {
                invited_count: rawInvitees.length,
                attended_matched_count: attended.length,
                no_show_or_absent_count: inviteesWithAttendance.length - attended.length,
                zoom_participant_count: participants.length,
                attendance_rate_pct: rawInvitees.length > 0
                  ? Math.round((attended.length / rawInvitees.length) * 100)
                  : null,
              };
              if (zoomMeeting || participantFetch.instanceUuid) {
                const resolvedUuid = participantFetch.instanceUuid ?? String(zoomMeeting?.uuid ?? '');
                existing.zoom.uuid = resolvedUuid || existing.zoom.uuid;
                if (zoomMeeting) {
                  existing.zoom.topic = String(zoomMeeting.topic ?? existing.zoom.topic);
                  existing.zoom.start_time = String(zoomMeeting.start_time ?? existing.zoom.start_time);
                  existing.zoom.start_at_ms = parseZoomStartMs(zoomMeeting);
                  existing.zoom.meeting_id = zoomMeeting.id;
                }
              }
            }
            continue;
          }
          if (minPastDate?.isValid && calStart < minPastDate) continue;
          const targetMinutes = calStart.hour * 60 + calStart.minute;
          const participantFetch = await fetchZoomParticipantsForSessionDate({
            zoomApiBase: ZOOM_API,
            token: zoomToken,
            zoomGet,
            dateKey,
            targetMinutes,
            meetingHint: null,
            targetMeetingIds,
            pastInstancesCache,
            parseZoomStartMs,
            isoDateFn: isoDate,
            timeZone: TZ,
          });
          const participants = participantFetch.participants;
          zoomAttendanceDebug.push(participantFetch.debug as unknown as Record<string, unknown>);
          const inviteesWithAttendance = mapInviteesWithAttendance(rawInvitees, participants);
          const attended = inviteesWithAttendance.filter((i) => i.attended_zoom);
          combinedPast.push({
            source: 'past' as const,
            session_type: WEDNESDAY_LIVE_SLOT.label,
            zoom: {
              uuid: participantFetch.instanceUuid ?? '',
              topic: calEv.name ?? 'Live Online Career Session',
              start_time: calEv.start_time,
              start_at_ms: calMs,
              duration_minutes: 30,
              host_email: zoomHostEmail,
              meeting_id: targetMeetingIds[0],
            },
            calendly: calMeta,
            participants: participants.map((p) => ({
              name: p.name,
              email: (p.user_email ?? '').trim().toLowerCase(),
              join_time: p.join_time,
              leave_time: p.leave_time,
            })),
            invitees: inviteesWithAttendance,
            walkin_emails: [],
            stats: {
              invited_count: rawInvitees.length,
              attended_matched_count: attended.length,
              no_show_or_absent_count: inviteesWithAttendance.length - attended.length,
              zoom_participant_count: participants.length,
              attendance_rate_pct: rawInvitees.length > 0
                ? Math.round((attended.length / rawInvitees.length) * 100)
                : null,
            },
          });
          zoomPastDates.add(dateKey);
        } else {
          if (zoomUpDates.has(dateKey)) continue;
          combinedUpcoming.push({
            source: 'scheduled' as const,
            session_type: WEDNESDAY_LIVE_SLOT.label,
            zoom: {
              uuid: '',
              topic: calEv.name ?? 'Live Online Career Session',
              start_time: calEv.start_time,
              start_at_ms: calMs,
              duration_minutes: 30,
              host_email: zoomHostEmail,
              join_url: '',
            },
            calendly: calMeta,
            invitees: rawInvitees.map((i) => ({
              email: i.email,
              name: i.name,
              status: i.status,
              no_show: i.no_show,
              phone_number: i.phone_number ?? null,
              timezone: i.timezone ?? null,
              invitee_uri: i.uri,
              event_uri: i.event_uri,
            })),
          });
          zoomUpDates.add(dateKey);
        }
      }

      combinedPast.sort((a, b) => (b.zoom.start_at_ms ?? 0) - (a.zoom.start_at_ms ?? 0));
      combinedUpcoming.sort((a, b) => (a.zoom.start_at_ms ?? 0) - (b.zoom.start_at_ms ?? 0));
    }

    // Final pass: any past row with Calendly invitees but zero Zoom participants.
    for (const row of combinedPast) {
      if ((row.stats?.zoom_participant_count ?? 0) > 0) continue;
      const calStart = row.calendly?.start_time
        ? DateTime.fromISO(row.calendly.start_time, { zone: TZ })
        : null;
      const ms = row.zoom.start_at_ms;
      const zoomDt = typeof ms === 'number' && Number.isFinite(ms)
        ? DateTime.fromMillis(ms, { zone: TZ })
        : null;
      const dateKey = calStart?.isValid ? isoDate(calStart) : (zoomDt?.isValid ? isoDate(zoomDt) : '');
      if (!dateKey) continue;
      const rawInvitees = activeCalendlyInvitees(calInviteesCache, row.calendly?.uri);
      if (rawInvitees.length === 0) continue;
      const targetMinutes = calStart?.isValid
        ? calStart.hour * 60 + calStart.minute
        : (zoomDt?.isValid ? zoomDt.hour * 60 + zoomDt.minute : null);
      const participantFetch = await fetchZoomParticipantsForSessionDate({
        zoomApiBase: ZOOM_API,
        token: zoomToken,
        zoomGet,
        dateKey,
        targetMinutes,
        meetingHint: row.zoom as ZoomRawMeeting,
        targetMeetingIds,
        pastInstancesCache,
        parseZoomStartMs,
        isoDateFn: isoDate,
        timeZone: TZ,
      });
      if (participantFetch.participants.length === 0) continue;
      const inviteesWithAttendance = mapInviteesWithAttendance(rawInvitees, participantFetch.participants);
      const attended = inviteesWithAttendance.filter((i) => i.attended_zoom);
      row.invitees = inviteesWithAttendance;
      row.participants = participantFetch.participants.map((p) => ({
        name: p.name,
        email: (p.user_email ?? '').trim().toLowerCase(),
        join_time: p.join_time,
        leave_time: p.leave_time,
      }));
      row.stats = {
        invited_count: rawInvitees.length,
        attended_matched_count: attended.length,
        no_show_or_absent_count: inviteesWithAttendance.length - attended.length,
        zoom_participant_count: participantFetch.participants.length,
        attendance_rate_pct: rawInvitees.length > 0
          ? Math.round((attended.length / rawInvitees.length) * 100)
          : null,
      };
      if (participantFetch.instanceUuid) row.zoom.uuid = participantFetch.instanceUuid;
      zoomAttendanceDebug.push({ ...participantFetch.debug, backfill: true } as unknown as Record<string, unknown>);
    }

    const { pastMeetings: finalPast, upcomingMeetings: finalUpcoming } = reclassifySessionsByStart(
      combinedPast,
      combinedUpcoming,
      nowMs,
    );

    const generatedAt = new Date().toISOString();
    const includeCalDebug = reqUrl.searchParams.get('calendly_debug') === '1';
    const responsePayload = {
      ok: true,
      generated_at: generatedAt,
      from_cache: false,
      calendly_configured: calendlyEnabled,
      zoom_user: { id: zoomUserId, email: zoomHostEmail },
      calendly_user: calUser,
      slot_tolerance_minutes: slotToleranceMin,
      past_meetings: finalPast,
      upcoming_meetings: finalUpcoming,
      calendly_events_in_range: calEventsByDate.size,
      ...(reqUrl.searchParams.get('zoom_attendance_debug') === '1'
        ? { zoom_attendance_debug: zoomAttendanceDebug }
        : {}),
      ...(calendlyFetchMeta ? { calendly_fetch: calendlyFetchMeta } : {}),
      ...(includeCalDebug && calendlyEnabled && calendlyToken
        ? {
            calendly_debug: {
              event_name_keywords: calendlyEventNameKeywords(),
              require_wednesday_slot:
                (Deno.env.get('CALENDLY_REQUIRE_WEDNESDAY_SLOT') ?? Deno.env.get('CALENDLY_REQUIRE_TUE_WED') ?? '1').trim() !== '0',
              ...(calendlyFetchMeta ?? {}),
              events_matched_by_date: [...calEventsByDate.entries()].map(([date, ev]) => ({
                date,
                name: ev.name,
                start_time: ev.start_time,
                uri: ev.uri,
                invitee_count: ev.uri ? (calInviteesCache.get(ev.uri) ?? []).length : 0,
              })),
              skipped_samples: calendlyFilterLog.slice(0, 30),
            },
          }
        : {}),
    };

    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim() ?? '';
    let registryResult: { ok: boolean; sessions: number; registrants: number; error?: string } = {
      ok: false,
      sessions: 0,
      registrants: 0,
      error: 'missing_service_role',
    };
    if (serviceRole) {
      const admin = createServiceRoleClient(supabaseUrl, serviceRole);
      registryResult = await persistLiveSessionsRegistry(admin, {
        pastMeetings: finalPast,
        upcomingMeetings: finalUpcoming,
        syncedAt: generatedAt,
        nowMs,
      });
    }

    const archiveResult = await persistSnapshot({
      supabaseUrl, serviceRole, generatedAtIso: generatedAt,
      payloadForHash: { zoom_user: responsePayload.zoom_user, past_meetings: finalPast, upcoming_meetings: finalUpcoming },
      payloadFull: responsePayload,
      invitees: [...calInviteesCache.values()].flat(),
    });

    return new Response(JSON.stringify({ ...responsePayload, archive: archiveResult, registry: registryResult }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('integrations-zoom-calendly', e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Integration error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
