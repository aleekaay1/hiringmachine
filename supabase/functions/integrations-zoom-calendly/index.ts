/**
 * Live Career Overview Sessions — attendance dashboard.
 *
 * Fixed schedule (America/Toronto):
 *   TUESDAY   18:00–19:00  (recurring Zoom meeting A)
 *   WEDNESDAY 11:30–12:30  (recurring Zoom meeting B)
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
const SLOTS: SlotDef[] = [
  { weekday: 2, startH: 18, startM: 0,  endH: 19, endM: 0,  label: 'Tuesday 6 PM ET'     },
  { weekday: 3, startH: 11, startM: 30, endH: 12, endM: 30, label: 'Wednesday 11:30 AM ET' },
];

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
    const slot = dt.weekday === 2 ? SLOTS[0] : dt.weekday === 3 ? SLOTS[1] : null;
    if (!slot) return null;
    const slotStart = slot.startH * 60 + slot.startM;
    const dtMin = dt.hour * 60 + dt.minute;
    const distance = Math.abs(dtMin - slotStart);
    const maxPmiFallbackDistance = Number(Deno.env.get('PMI_FALLBACK_MAX_MINUTES_FROM_SLOT') ?? '180');
    if (distance <= Math.max(30, Math.min(480, maxPmiFallbackDistance))) return slot;
  }
  return null;
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

type ZoomParticipant = { name?: string; user_email?: string; join_time?: string; leave_time?: string };

function participantName(row: Record<string, unknown>): string {
  const name = String(row.name ?? '').trim();
  if (name) return name;
  const userName = String(row.user_name ?? '').trim();
  if (userName) return userName;
  return '';
}

function participantEmail(row: Record<string, unknown>): string {
  return String(row.user_email ?? row.email ?? '').trim().toLowerCase();
}

async function zoomParticipantsFromPath(token: string, path: string): Promise<ZoomParticipant[]> {
  const all: ZoomParticipant[] = [];
  let nextPageToken = '';
  let safety = 0;
  do {
    safety++;
    const withToken = `${path}${path.includes('?') ? '&' : '?'}page_size=300${nextPageToken ? `&next_page_token=${encodeURIComponent(nextPageToken)}` : ''}`;
    const res = await fetch(`${ZOOM_API}${withToken}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      throw new Error(`Zoom GET ${withToken}: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as {
      participants?: Array<Record<string, unknown>>;
      next_page_token?: string;
    };
    for (const p of body.participants ?? []) {
      all.push({
        name: participantName(p),
        user_email: participantEmail(p),
        join_time: typeof p.join_time === 'string' ? p.join_time : undefined,
        leave_time: typeof p.leave_time === 'string' ? p.leave_time : undefined,
      });
    }
    nextPageToken = String(body.next_page_token ?? '').trim();
  } while (nextPageToken && safety < 20);
  return all;
}

async function zoomParticipants(token: string, uuid: string): Promise<ZoomParticipant[]> {
  const encoded = encodeURIComponent(encodeURIComponent(uuid));
  try {
    // Preferred endpoint for reporting accounts.
    return await zoomParticipantsFromPath(token, `/report/meetings/${encoded}/participants`);
  } catch (e) {
    console.warn(`Zoom report participants failed for ${uuid}; trying past_meetings fallback.`, e instanceof Error ? e.message : String(e));
    try {
      // Fallback endpoint for non-report contexts.
      return await zoomParticipantsFromPath(token, `/past_meetings/${encoded}/participants`);
    } catch (fallbackErr) {
      console.warn(`Zoom participants unavailable for ${uuid}:`, fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr));
      return [];
    }
  }
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
type CalEvent = { uri?: string; name?: string; start_time?: string; end_time?: string; status?: string };
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

async function calendlyListEvents(token: string, userUri: string, from: Date, to: Date): Promise<CalEvent[]> {
  const all: CalEvent[] = [];
  let nextPath: string | null =
    `/scheduled_events?user=${encodeURIComponent(userUri)}` +
    `&min_start_time=${encodeURIComponent(from.toISOString())}` +
    `&max_start_time=${encodeURIComponent(to.toISOString())}&count=100`;
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
      try { const u = new URL(pag.next_page); nextPath = u.pathname + u.search; }
      catch { nextPath = null; }
    } else if (pag?.next_page_token) {
      nextPath =
        `/scheduled_events?user=${encodeURIComponent(userUri)}` +
        `&min_start_time=${encodeURIComponent(from.toISOString())}` +
        `&max_start_time=${encodeURIComponent(to.toISOString())}&count=100&page_token=${encodeURIComponent(pag.next_page_token)}`;
    } else {
      nextPath = null;
    }
  }
  return all;
}

async function calendlyInviteesForEvent(token: string, eventUri: string): Promise<CalInvitee[]> {
  const uuid = eventUri.replace(/\/$/, '').split('/').pop() ?? '';
  const body = (await calendlyGet(token, `/scheduled_events/${encodeURIComponent(uuid)}/invitees?count=100`)) as {
    collection?: Array<{
      uri?: string; event?: string; email?: string; name?: string; status?: string;
      no_show?: boolean; canceled?: boolean; timezone?: string;
      text_reminder_number?: string | null; cancel_url?: string;
      reschedule_url?: string; created_at?: string; updated_at?: string;
      questions_and_answers?: Array<{ question?: string; answer?: string }>;
    }>;
  };
  return (body.collection ?? []).map((r) => ({
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
  }));
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
    // Auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return new Response(JSON.stringify({ error: 'Invalid or expired session' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    // Health check
    const reqUrl = new URL(req.url);
    if (reqUrl.searchParams.get('health') === '1') {
      const calTok = Deno.env.get('CALENDLY_API_TOKEN')?.trim();
      const hostEmail = Deno.env.get('ZOOM_HOST_USER_EMAIL')?.trim();
      let zoom_ok = false; let zoom_error: string | null = null;
      try { const zt = await getZoomToken(); await zoomGetUserId(zt, hostEmail ?? ''); zoom_ok = true; }
      catch (e) { zoom_error = e instanceof Error ? e.message : String(e); }
      let calendly_ok: boolean | null = null; let calendly_error: string | null = null;
      if (calTok) {
        try { await calendlyGet(calTok, '/users/me'); calendly_ok = true; }
        catch (e) { calendly_ok = false; calendly_error = e instanceof Error ? e.message : String(e); }
      }
      return new Response(JSON.stringify({ ok: true, health: true, zoom_ok, zoom_error, calendly_configured: !!calTok, calendly_ok, calendly_error }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Config
    const zoomHostEmail = Deno.env.get('ZOOM_HOST_USER_EMAIL')?.trim();
    if (!zoomHostEmail) return new Response(JSON.stringify({ error: 'Missing ZOOM_HOST_USER_EMAIL' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const calendlyToken = Deno.env.get('CALENDLY_API_TOKEN')?.trim();
    const calendlyEnabled = !!calendlyToken;
    const slotToleranceMin = Math.max(5, Math.min(45, Number(Deno.env.get('INTEGRATION_SLOT_TOLERANCE_MINUTES') ?? '20')));
    const lookbackDays   = Math.max(14, Math.min(365, Number(Deno.env.get('ZOOM_LOOKBACK_DAYS')  ?? '90')));
    const lookaheadDays  = Math.max(7,  Math.min(180, Number(Deno.env.get('ZOOM_LOOKAHEAD_DAYS') ?? '60')));
    const minPastDateRaw = (Deno.env.get('LIVE_SESSIONS_MIN_PAST_DATE') ?? '2026-04-20').trim();
    const minPastDate = DateTime.fromISO(minPastDateRaw, { zone: TZ }).startOf('day');

    // Zoom — fetch all meetings
    const zoomToken = await getZoomToken();
    const zoomUserId = await zoomGetUserId(zoomToken, zoomHostEmail);
    const [zoomPastRaw, zoomUpRaw] = await Promise.all([
      zoomListMeetings(zoomToken, zoomUserId, 'past'),
      zoomListMeetings(zoomToken, zoomUserId, 'upcoming'),
    ]);

    const nowMs = Date.now();

    // Deduplicate by key, prefer upcoming row (richer fields)
    const byKey = new Map<string, ZoomRawMeeting>();
    for (const m of zoomPastRaw) { const k = zoomMeetingKey(m); if (!byKey.has(k)) byKey.set(k, m); }
    for (const m of zoomUpRaw)  { byKey.set(zoomMeetingKey(m), m); }

    const pastMeetings:     ZoomRawMeeting[] = [];
    const upcomingMeetings: ZoomRawMeeting[] = [];

    for (const m of byKey.values()) {
      const ms    = parseZoomStartMs(m);
      const topic = String(m.topic ?? '');
      const dt    = Number.isFinite(ms) ? DateTime.fromMillis(ms, { zone: TZ }) : null;

      // Accept if: (a) falls in a known time slot, OR (b) topic matches a known PMI keyword
      const slot = inferSlot(dt, topic, slotToleranceMin);
      if (!slot) continue;

      // Only within lookback / lookahead window
      if (!Number.isFinite(ms)) continue;
      if (ms < nowMs - lookbackDays * 86400_000) continue;
      if (ms > nowMs + lookaheadDays * 86400_000) continue;
      if (ms < nowMs) {
        if (dt?.isValid && minPastDate.isValid && dt < minPastDate) continue;
        pastMeetings.push(m);
      }
      else upcomingMeetings.push(m);
    }

    pastMeetings.sort((a, b) => parseZoomStartMs(b) - parseZoomStartMs(a));
    upcomingMeetings.sort((a, b) => parseZoomStartMs(a) - parseZoomStartMs(b));

    // Calendly — fetch events in same window
    let calEventsByDate = new Map<string, CalEvent>(); // key: YYYY-MM-DD (Toronto)
    let calInviteesCache = new Map<string, CalInvitee[]>(); // key: event uri
    let calUser: { name?: string; email?: string } | null = null;

    if (calendlyEnabled && calendlyToken) {
      const calUserRaw = (await calendlyGet(calendlyToken, '/users/me')) as { resource?: { uri?: string; name?: string; email?: string } };
      calUser = { name: calUserRaw.resource?.name, email: calUserRaw.resource?.email };
      const calUserUri = calUserRaw.resource?.uri;
      if (!calUserUri) throw new Error('Calendly /users/me did not return resource.uri');

      const from = new Date(nowMs - lookbackDays * 86400_000);
      const to   = new Date(nowMs + lookaheadDays * 86400_000);
      const allCalEvents = await calendlyListEvents(calendlyToken, calUserUri, from, to);

      // Only keep Calendly events that fall in a live session slot OR on a Tuesday/Wednesday
      // (PMI sessions may have a Calendly event registered under a different event type name)
      for (const ev of allCalEvents) {
        if (!ev.start_time) continue;
        const dt = DateTime.fromISO(ev.start_time, { zone: TZ });
        // Accept if in slot, OR if on Tuesday/Wednesday (PMI fallback — same-day match will handle specificity)
        const inSlot = slotForDt(dt, slotToleranceMin) !== null;
        const isTueOrWed = dt.weekday === 2 || dt.weekday === 3;
        if (!inSlot && !isTueOrWed) continue;
        const date = isoDate(dt);
        if (!calEventsByDate.has(date)) calEventsByDate.set(date, ev);
      }

      // Pre-load invitees for all matched Calendly events
      await Promise.all([...calEventsByDate.values()].map(async (ev) => {
        if (!ev.uri) return;
        const invitees = await calendlyInviteesForEvent(calendlyToken, ev.uri);
        calInviteesCache.set(ev.uri, invitees);
      }));
    }

    // ─── Build past session rows ────────────────────────────────────────────
    const combinedPast = await Promise.all(pastMeetings.map(async (m) => {
      const uuid     = String(m.uuid     ?? '');
      const topic    = String(m.topic    ?? '');
      const start    = String(m.start_time ?? '');
      const startMs  = parseZoomStartMs(m);
      const duration = Number(m.duration ?? 0);
      const host     = String((m as { host_email?: string }).host_email || zoomHostEmail);
      const startDt  = Number.isFinite(startMs) ? DateTime.fromMillis(startMs, { zone: TZ }) : null;
      const slot     = inferSlot(startDt, topic, slotToleranceMin);
      const dateKey  = startDt ? isoDate(startDt) : '';

      // Zoom participants (who actually joined)
      const participants = uuid ? await zoomParticipants(zoomToken, uuid) : [];

      // Build fast lookup structures
      // Email map: normalized email → participant row
      const participantByEmail = new Map<string, ZoomParticipant>();
      for (const p of participants) {
        const e = (p.user_email ?? '').trim().toLowerCase();
        if (e) participantByEmail.set(e, p);
      }
      // All participant display names (for name-based fallback)
      const participantNames = participants
        .filter((p) => p.name)
        .map((p) => ({ norm: normName(p.name ?? ''), raw: p }));

      // Match Calendly event for this exact date
      const calEv = calEventsByDate.get(dateKey) ?? null;
      const rawInvitees = (calEv?.uri ? (calInviteesCache.get(calEv.uri) ?? []) : [])
        .filter((i) => !i.canceled && i.status !== 'canceled');

      /**
       * Find the best Zoom participant match for a Calendly invitee.
       * Priority: (1) exact email, (2) name-based.
       */
      function findParticipant(invitee: CalInvitee): ZoomParticipant | null {
        // 1. Email match
        if (invitee.email && participantByEmail.has(invitee.email)) {
          return participantByEmail.get(invitee.email)!;
        }
        // 2. Name-based fallback (catches guests who joined without signing in)
        if (invitee.name) {
          for (const { norm, raw } of participantNames) {
            if (samePersonByName(invitee.name, raw.name ?? '') || normName(invitee.name) === norm) {
              return raw;
            }
          }
        }
        return null;
      }

      // Cross-reference each Calendly invitee
      const inviteesWithAttendance = rawInvitees.map((i) => {
        const match = findParticipant(i);
        return {
          email:         i.email,
          name:          i.name,
          status:        i.status,
          no_show:       i.no_show,
          attended_zoom: match !== null,
          match_method:  match ? (participantByEmail.has(i.email) ? 'email' : 'name') : null,
          join_time:     match?.join_time ?? null,
          leave_time:    match?.leave_time ?? null,
          phone_number:  i.phone_number ?? null,
          timezone:      i.timezone ?? null,
          invitee_uri:   i.uri,
          event_uri:     i.event_uri,
        };
      });

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
      const slot     = inferSlot(startDt, topic, slotToleranceMin);
      const dateKey  = startDt ? isoDate(startDt) : '';
      const calEv    = calEventsByDate.get(dateKey) ?? null;
      const invitees = (calEv?.uri ? (calInviteesCache.get(calEv.uri) ?? []) : [])
        .filter((i) => !i.canceled && i.status !== 'canceled')
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

    const generatedAt = new Date().toISOString();
    const responsePayload = {
      ok: true,
      generated_at: generatedAt,
      calendly_configured: calendlyEnabled,
      zoom_user: { id: zoomUserId, email: zoomHostEmail },
      calendly_user: calUser,
      slot_tolerance_minutes: slotToleranceMin,
      past_meetings: combinedPast,
      upcoming_meetings: combinedUpcoming,
      calendly_events_in_range: calEventsByDate.size,
    };

    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim() ?? '';
    const archiveResult = await persistSnapshot({
      supabaseUrl, serviceRole, generatedAtIso: generatedAt,
      payloadForHash: { zoom_user: responsePayload.zoom_user, past_meetings: combinedPast, upcoming_meetings: combinedUpcoming },
      payloadFull: responsePayload,
      invitees: [...calInviteesCache.values()].flat(),
    });

    return new Response(JSON.stringify({ ...responsePayload, archive: archiveResult }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('integrations-zoom-calendly', e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Integration error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
