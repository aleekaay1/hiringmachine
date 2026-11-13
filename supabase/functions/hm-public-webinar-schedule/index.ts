// Public webinar self-schedule for cold-email candidates (no staff auth).
// Deploy: supabase functions deploy hm-public-webinar-schedule --project-ref ofhcnsuwrhyvxtvtdunw --no-verify-jwt
// Requires Edge secret: WEBINARGEEK_API_TOKEN
// Optional: WEBINARGEEK_API_BASE_URL, PUBLIC_WEBINAR_GEEK_WEBINAR_ID, PUBLIC_WEBINAR_CUSTOM_FIELD
//
// Calling-bot API (same schedule + subscribe path as /schedule-webinar).
// Vercel: GET /api/webinar/sessions  POST /api/webinar/registrations  GET /api/webinar/verification
// This function: GET /sessions  POST /registrations  GET /verification
// Auth: Authorization: Bearer <key> or X-API-Key: <key>
// Secret: WEBINAR_BOOKING_API_KEY
// Staff delete: POST ?mode=delete-signup { id } with the signed-in user session.

import { createClient } from 'npm:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.9.10';
import { corsHeaders, json, normalizeEmail, serviceClient, str } from '../_shared/hiringMachine.ts';
import { insertEmailSendLog } from '../_shared/emailSendLog.ts';
import { PORTAL_EMAIL_BCC } from '../_shared/portalEmailBcc.ts';

const WEBINARGEEK_BASE = (
  Deno.env.get('WEBINARGEEK_API_BASE_URL')?.trim() || 'https://app.webinargeek.com/api/v2'
).replace(/\/$/, '');

type RegistrationFieldRow = {
  name?: string;
  mandatory?: boolean;
  extra_field?: boolean;
  field_options?: Array<{ label?: string }>;
};

async function wgRequest(
  path: string,
  init: RequestInit = {},
  options: { contentType?: string | null } = {},
): Promise<{ ok: boolean; status: number; json: Record<string, unknown>; raw: string }> {
  const token = Deno.env.get('WEBINARGEEK_API_TOKEN')?.trim();
  if (!token) {
    return {
      ok: false,
      status: 503,
      json: { error: 'Missing WEBINARGEEK_API_TOKEN secret on the server.' },
      raw: '',
    };
  }
  const url = `${WEBINARGEEK_BASE}${path.startsWith('/') ? '' : '/'}${path}`;
  const headers: Record<string, string> = { 'Api-Token': token };
  // Content-Type is only for requests that send JSON. A body-less DELETE
  // with application/json is parsed as an action payload and WebinarGeek
  // answers {"code":"invalid_action","message":"Invalid action"}.
  if (options.contentType !== null) {
    headers['Content-Type'] = options.contentType || 'application/json';
  }
  Object.assign(headers, init.headers || {});
  if (options.contentType === null) delete headers['Content-Type'];
  const res = await fetch(url, {
    ...init,
    headers,
  });
  const raw = await res.text();
  let parsed: Record<string, unknown> = {};
  if (raw.trim()) {
    try {
      const value: unknown = JSON.parse(raw);
      if (Array.isArray(value)) parsed = { __root_array: value };
      else if (value && typeof value === 'object') parsed = value as Record<string, unknown>;
      else parsed = { value };
    } catch {
      parsed = { raw_body: raw.slice(0, 500) };
    }
  }
  return { ok: res.ok, status: res.status, json: parsed, raw };
}

async function wgGet(path: string, params?: Record<string, string | number | boolean | undefined>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || String(v).length === 0) continue;
    sp.set(k, String(v));
  }
  const suffix = sp.size > 0 ? `?${sp.toString()}` : '';
  return wgRequest(`${path}${suffix}`, { method: 'GET' });
}

async function wgPost(path: string, body: Record<string, unknown>) {
  return wgRequest(path, { method: 'POST', body: JSON.stringify(body) });
}

async function wgDelete(path: string, body?: string) {
  if (body == null) return wgRequest(path, { method: 'DELETE' }, { contentType: null });
  return wgRequest(path, { method: 'DELETE', body });
}

const SCHEDULE_TZ = 'America/Toronto';
/** Fallback “soon” window when JIT virtual broadcast is not available. */
const QUICK_WINDOW_MS = 90 * 60 * 1000;

function numericId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const n = Number(value.trim());
    if (Number.isSafeInteger(n) && n > 0) return n;
  }
  return null;
}

function positiveInt(value: unknown): number | null {
  const n = numericId(value);
  return n;
}

function nonNegativeInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const n = Number(value.trim());
    if (Number.isSafeInteger(n) && n >= 0) return n;
  }
  return null;
}

/** True when WebinarGeek's per-broadcast subscriber cap is already reached. */
function sessionIsFull(count: number | null, maximum: number | null): boolean {
  if (maximum == null || maximum <= 0 || count == null) return false;
  return count >= maximum;
}

function sessionClosed(row: Record<string, unknown>): boolean {
  return row.cancelled === true || row.has_ended === true;
}

function nestedRecord(row: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = row[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function maximumSubscribersFor(row: Record<string, unknown>): number | null {
  const webinar = nestedRecord(row, 'webinar');
  const episode = nestedRecord(row, 'episode');
  return (
    positiveInt(webinar?.maximum_number_of_subscribers) ??
    positiveInt(episode?.maximum_number_of_subscribers) ??
    positiveInt(row.maximum_number_of_subscribers)
  );
}

/** ISO 8601 in the session timezone, with that instant's real UTC offset. */
function isoOffset(value: unknown, timeZone = SCHEDULE_TZ): string | null {
  let ms = unixMsFromField(value);
  if (ms == null && typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) ms = parsed;
  }
  if (ms == null) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '00';
  const year = get('year');
  const month = get('month');
  const day = get('day');
  let hour = get('hour');
  if (hour === '24') hour = '00';
  const minute = get('minute');
  const second = get('second');
  const asUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  const offsetMin = Math.round((asUtc - ms) / 60000);
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${year}-${month}-${day}T${hour}:${minute}:${second}${sign}${hh}:${mm}`;
}

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function providedApiKey(req: Request): string {
  const header = req.headers.get('x-api-key')?.trim() || '';
  if (header) return header;
  const auth = req.headers.get('authorization')?.trim() || '';
  const match = /^Bearer\s+(\S.*)$/i.exec(auth);
  return match ? match[1].trim() : '';
}

function bookingApiKeyOk(req: Request): boolean {
  const expected = Deno.env.get('WEBINAR_BOOKING_API_KEY')?.trim() || '';
  const provided = providedApiKey(req);
  if (!expected || !provided) return false;
  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(provided);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function botEndpoint(pathname: string): 'sessions' | 'registrations' | 'verification' | null {
  const path = pathname.replace(/\/+$/, '').toLowerCase();
  if (path.endsWith('/sessions')) return 'sessions';
  if (path.endsWith('/registrations')) return 'registrations';
  if (path.endsWith('/verification')) return 'verification';
  return null;
}

function unixMsFromField(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1e12 ? n : n * 1000;
}

function torontoYmdFromMs(ms: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SCHEDULE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ms));
  const y = parts.find((p) => p.type === 'year')?.value || '1970';
  const m = parts.find((p) => p.type === 'month')?.value || '01';
  const d = parts.find((p) => p.type === 'day')?.value || '01';
  return `${y}-${m}-${d}`;
}

function addCalendarDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() + days);
  return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, '0')}-${String(utc.getUTCDate()).padStart(2, '0')}`;
}

function upcomingBroadcastRows(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const nowMs = Date.now();
  return rows
    .map((row) => ({ row, ms: unixMsFromField(row.date) }))
    .filter(({ row, ms }) => {
      if (row.cancelled === true) return false;
      if (row.has_ended === true) return false;
      if (row.active_jit === true) return false; // handled via JIT resolver
      if (ms == null) return false;
      return ms >= nowMs;
    })
    .sort((a, b) => (a.ms ?? Number.MAX_SAFE_INTEGER) - (b.ms ?? Number.MAX_SAFE_INTEGER))
    .map(({ row }) => row);
}

/** Same calendar day + next day only (Toronto), one broadcast per start time. */
function publicScheduleSlots(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const nowMs = Date.now();
  const todayYmd = torontoYmdFromMs(nowMs);
  const tomorrowYmd = addCalendarDaysYmd(todayYmd, 1);
  const allowed = new Set([todayYmd, tomorrowYmd]);

  const upcoming = upcomingBroadcastRows(rows);
  const bySlot = new Map<number, Record<string, unknown>>();
  for (const row of upcoming) {
    const ms = unixMsFromField(row.date);
    if (ms == null) continue;
    const ymd = torontoYmdFromMs(ms);
    if (!allowed.has(ymd)) continue;
    if (!bySlot.has(ms)) bySlot.set(ms, row);
  }

  return [...bySlot.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ms, row]) => ({
      ...row,
      day_label: torontoYmdFromMs(ms) === todayYmd ? 'today' : 'tomorrow',
    }));
}

function nearestSoonSlot(
  slots: Array<Record<string, unknown>>,
): Record<string, unknown> | null {
  const nowMs = Date.now();
  for (const row of slots) {
    const ms = unixMsFromField(row.date);
    if (ms == null) continue;
    if (ms - nowMs <= QUICK_WINDOW_MS) {
      return {
        ...row,
        starts_in_minutes: Math.max(1, Math.round((ms - nowMs) / 60000)),
        is_jit: false,
      };
    }
  }
  return null;
}

/**
 * WebinarGeek Just-in-time uses a virtual broadcast (`active_jit` / episode.jit_broadcast_id).
 * Subscribing to that ID creates a real slot at the next 5/10/15‑minute mark.
 *
 * Prefer the published AO Globe Life registration webinar — accounts often have older
 * unpublished duplicates that still expose a JIT broadcast id.
 */
function webinarJitScore(webinar: Record<string, unknown>, episode: Record<string, unknown>): number {
  let score = 0;
  const title = `${str(webinar.title)} ${str(episode.title)}`.toLowerCase();
  const url = `${str(webinar.url)} ${str(webinar.view_without_registration_url)}`.toLowerCase();
  if (url.includes('globe-life-online-career-session')) score += 100;
  if (url.includes('globelifepaz')) score += 40;
  if (title.includes('ao globe life')) score += 50;
  if (title.includes('ao paz')) score += 20;
  if (episode.published === true) score += 30;
  if (episode.published === false) score -= 80;
  if (webinar.archived === true) score -= 200;
  return score;
}

async function resolveJitQuickSlot(
  preferredWebinarId?: string,
): Promise<Record<string, unknown> | null> {
  const webinarsRes = await wgGet('/webinars', { per_page: 50 });
  if (!webinarsRes.ok) return null;
  const webinars = Array.isArray(webinarsRes.json.webinars)
    ? (webinarsRes.json.webinars as Array<Record<string, unknown>>)
    : [];

  const nowMs = Date.now();
  type Candidate = { score: number; ms: number; row: Record<string, unknown> };
  const candidates: Candidate[] = [];

  for (const webinar of webinars) {
    if (webinar.archived === true) continue;
    const webinarId = webinar.id != null ? String(webinar.id) : '';
    if (preferredWebinarId && webinarId && webinarId !== preferredWebinarId) continue;

    const episodes = Array.isArray(webinar.episodes)
      ? (webinar.episodes as Array<Record<string, unknown>>)
      : [];
    for (const episode of episodes) {
      if (episode.jit_enabled !== true) continue;
      const jitBroadcastId = episode.jit_broadcast_id;
      if (jitBroadcastId == null || String(jitBroadcastId).trim() === '') continue;

      const closestMs =
        unixMsFromField(episode.jit_closest_time) ??
        unixMsFromField(
          Array.isArray(episode.broadcasts)
            ? (episode.broadcasts as Array<Record<string, unknown>>).find((b) => b.active_jit === true)?.date
            : null,
        );
      const ms = closestMs ?? nowMs + 5 * 60 * 1000;
      const period = Number(episode.jit_period_minutes);
      const score = preferredWebinarId
        ? 1000
        : webinarJitScore(webinar, episode);
      candidates.push({
        score,
        ms,
        row: {
          id: jitBroadcastId,
          title: str(episode.title || webinar.title) || 'Watch now',
          date: closestMs != null ? (closestMs > 1e12 ? closestMs / 1000 : closestMs) : Math.floor(ms / 1000),
          webinar_id: webinar.id ?? null,
          episode_id: episode.id ?? null,
          webinar_url: str(webinar.url) || null,
          day_label: 'today',
          starts_in_minutes: Math.max(1, Math.round((ms - nowMs) / 60000)),
          jit_period_minutes: Number.isFinite(period) && period > 0 ? period : 5,
          is_jit: true,
          active_jit: true,
          episode_published: episode.published === true,
        },
      });
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score || a.ms - b.ms);
  // Ignore clearly unpublished duplicates when a better match exists
  const top = candidates[0];
  if (top.score < 0) return null;
  return top.row;
}

async function loadPublicSchedule(): Promise<
  | { ok: true; broadcasts: Array<Record<string, unknown>>; quick: Record<string, unknown> | null }
  | { ok: false; status: number; error: string }
> {
  const configuredWebinarId = Deno.env.get('PUBLIC_WEBINAR_GEEK_WEBINAR_ID')?.trim() || '';
  const broadcastsRes = await wgGet(
    '/broadcasts',
    configuredWebinarId
      ? { webinar_id: configuredWebinarId, per_page: 100, nested_resources: 'episode,webinar' }
      : { per_page: 100, nested_resources: 'episode,webinar' },
  );
  if (!broadcastsRes.ok) {
    return {
      ok: false,
      status: broadcastsRes.status === 503 ? 503 : 502,
      error: wgErrorMessage(broadcastsRes.json, 'Unable to load upcoming webinars'),
    };
  }
  const rawRows = Array.isArray(broadcastsRes.json.broadcasts)
    ? (broadcastsRes.json.broadcasts as Array<Record<string, unknown>>)
    : [];
  const broadcasts = publicScheduleSlots(rawRows);
  const jitQuick = await resolveJitQuickSlot(configuredWebinarId || undefined);
  const quick = jitQuick || nearestSoonSlot(broadcasts);
  return { ok: true, broadcasts, quick };
}

function registrationFieldsFromJson(json: Record<string, unknown>): RegistrationFieldRow[] {
  const fields = json.registration_fields;
  return Array.isArray(fields) ? (fields as RegistrationFieldRow[]) : [];
}

function buildSubscriptionPayload(input: {
  email: string;
  firstname: string;
  surname: string;
  phone?: string | null;
  customField?: string | null;
  registrationFields?: RegistrationFieldRow[];
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    email: input.email,
    firstname: input.firstname,
    surname: input.surname.trim() || '.',
  };
  const phone = str(input.phone);
  if (phone) payload.phone = phone;
  if (input.customField) payload.custom_field = input.customField;

  const extraFields: Record<string, string> = {};
  for (const field of input.registrationFields || []) {
    const name = str(field.name);
    if (!name || !field.mandatory || !field.extra_field) continue;
    const option = field.field_options?.[0]?.label;
    extraFields[name] = str(option) || 'Yes';
  }
  if (Object.keys(extraFields).length) payload.extra_fields = extraFields;
  return payload;
}

function subscriptionRowsFromWgJson(parsed: Record<string, unknown>): Array<Record<string, unknown>> {
  if (Array.isArray(parsed.subscriptions)) return parsed.subscriptions as Array<Record<string, unknown>>;
  if (parsed.subscription && typeof parsed.subscription === 'object') {
    return [parsed.subscription as Record<string, unknown>];
  }
  if (parsed.id != null && parsed.email != null) return [parsed];
  return [];
}

function wgErrorMessage(parsed: Record<string, unknown>, fallback: string): string {
  const title = str(parsed.title);
  const message = str(parsed.message || parsed.detail);
  const errorRaw = parsed.error;
  const errorText =
    typeof errorRaw === 'string'
      ? errorRaw.trim()
      : errorRaw && typeof errorRaw === 'object'
      ? wgErrorMessage(errorRaw as Record<string, unknown>, '')
      : '';
  return title || message || errorText || fallback;
}

function subscriptionBroadcastId(row: Record<string, unknown>): string | null {
  const broadcast =
    row.broadcast && typeof row.broadcast === 'object'
      ? (row.broadcast as Record<string, unknown>)
      : null;
  const id = broadcast?.id ?? row.broadcast_id;
  return id != null && String(id).trim() ? String(id) : null;
}

async function findSubscriptionForBroadcast(
  email: string,
  broadcastId: string,
): Promise<Array<Record<string, unknown>>> {
  const normalized = normalizeEmail(email);
  if (!normalized || !broadcastId) return [];

  const baseParams = {
    email: normalized,
    broadcast_id: broadcastId,
    per_page: 50,
    nested_resources: 'broadcast,webinar',
  };
  const passes: Array<Record<string, string | number | boolean | undefined>> = [
    baseParams,
    { ...baseParams, email_verified: false },
    { ...baseParams, include_unverified: true },
  ];

  const merged = new Map<string, Record<string, unknown>>();
  for (const params of passes) {
    const res = await wgGet('/subscriptions', params);
    if (!res.ok) continue;
    for (const row of subscriptionRowsFromWgJson(res.json)) {
      if (subscriptionBroadcastId(row) !== broadcastId) continue;
      const id = row.id != null ? String(row.id) : '';
      const key = id || `${String(row.email || '')}|${String(row.created_at || '')}`;
      if (!merged.has(key)) merged.set(key, row);
    }
    if (merged.size > 0) break;
  }
  return [...merged.values()];
}

async function resolveBroadcastContext(broadcastId: string, webinarIdHint?: string) {
  const broadcastRes = await wgGet(`/broadcasts/${encodeURIComponent(broadcastId)}`, {
    nested_resources: 'webinar,episode',
  });
  if (!broadcastRes.ok) {
    return {
      ok: false as const,
      status: broadcastRes.status,
      error: wgErrorMessage(broadcastRes.json, `Broadcast ${broadcastId} not found (${broadcastRes.status})`),
    };
  }

  const broadcast = broadcastRes.json;
  const nestedWebinar =
    broadcast.webinar && typeof broadcast.webinar === 'object'
      ? (broadcast.webinar as Record<string, unknown>)
      : null;
  const resolvedWebinarId =
    str(webinarIdHint || nestedWebinar?.id || broadcast.webinar_id) || null;

  let registrationFields = registrationFieldsFromJson(broadcast);
  if (!registrationFields.length && nestedWebinar) {
    registrationFields = registrationFieldsFromJson(nestedWebinar);
  }
  let maximumSubscribers = maximumSubscribersFor(broadcast);
  if ((!registrationFields.length || maximumSubscribers == null) && resolvedWebinarId) {
    const webinarRes = await wgGet(`/webinars/${encodeURIComponent(resolvedWebinarId)}`);
    if (webinarRes.ok) {
      if (!registrationFields.length) registrationFields = registrationFieldsFromJson(webinarRes.json);
      if (maximumSubscribers == null) {
        maximumSubscribers = positiveInt(webinarRes.json.maximum_number_of_subscribers);
      }
    }
  }

  if (broadcast.cancelled === true && broadcast.active_jit !== true) {
    return {
      ok: false as const,
      status: 422,
      error: 'This session was cancelled. Please pick another upcoming time.',
    };
  }
  if (broadcast.has_ended === true && broadcast.active_jit !== true) {
    return {
      ok: false as const,
      status: 422,
      error: 'This session has already ended. Please pick an upcoming time.',
    };
  }

  return {
    ok: true as const,
    webinarId: resolvedWebinarId,
    registrationFields,
    title: str(broadcast.title || broadcast.name) || null,
    date: broadcast.date ?? null,
    subscriptionsCount: nonNegativeInt(broadcast.subscriptions_count),
    maximumSubscribers,
  };
}

function formatBroadcast(row: Record<string, unknown>) {
  return {
    id: row.id ?? null,
    title: row.title ?? row.name ?? null,
    date: row.date ?? null,
    webinar_id: row.webinar_id ?? null,
    webinar_url: row.webinar_url ?? null,
    day_label: row.day_label === 'tomorrow' ? 'tomorrow' : row.day_label === 'today' ? 'today' : null,
    starts_in_minutes:
      typeof row.starts_in_minutes === 'number' && Number.isFinite(row.starts_in_minutes)
        ? row.starts_in_minutes
        : null,
    is_jit: row.is_jit === true || row.active_jit === true,
    jit_period_minutes:
      typeof row.jit_period_minutes === 'number' && Number.isFinite(row.jit_period_minutes)
        ? row.jit_period_minutes
        : null,
  };
}

function linksFromSubscription(row: Record<string, unknown> | null): {
  watch_link: string | null;
  confirmation_link: string | null;
  broadcast_id: string | null;
  broadcast_date: unknown;
} {
  if (!row) {
    return { watch_link: null, confirmation_link: null, broadcast_id: null, broadcast_date: null };
  }
  const nested =
    row.broadcast && typeof row.broadcast === 'object'
      ? (row.broadcast as Record<string, unknown>)
      : null;
  return {
    watch_link: str(row.watch_link) || null,
    confirmation_link: str(row.confirmation_link) || null,
    broadcast_id: nested?.id != null ? String(nested.id) : row.broadcast_id != null ? String(row.broadcast_id) : null,
    broadcast_date: nested?.date ?? row.broadcast_date ?? null,
  };
}

function sessionAtFromWgDate(value: unknown): string | null {
  const ms = unixMsFromField(value);
  if (ms == null) return null;
  return new Date(ms).toISOString();
}

function formatSessionWhen(value: unknown): string {
  let ms = unixMsFromField(value);
  if (ms == null && typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) ms = parsed;
  }
  if (ms == null) return '';
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: SCHEDULE_TZ,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString();
  }
}

function phoneDigits(value: unknown): string {
  return String(value || '').replace(/\D/g, '');
}

function registrationStillActive(sessionAt: string | null | undefined): boolean {
  if (!sessionAt) return true;
  const ms = Date.parse(sessionAt);
  if (!Number.isFinite(ms)) return true;
  // Allow a new booking only after the prior session is well past (3 hours after start).
  return ms > Date.now() - 3 * 60 * 60 * 1000;
}

async function findExistingPublicSignup(
  email: string,
  phone?: string,
): Promise<Record<string, unknown> | null> {
  const admin = serviceClient();
  const { data: byEmail, error } = await admin
    .from('hm_public_webinar_signups')
    .select(
      'id, first_name, last_name, email, phone, session_at, session_label, broadcast_id, webinar_id, wg_subscription_id, watch_link, confirmation_link, email_verified, created_at, already_registered',
    )
    .ilike('email', email)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) {
    console.error('findExistingPublicSignup email lookup failed', error);
  }
  const emailHit = (byEmail || []).find((row) =>
    registrationStillActive(row.session_at != null ? String(row.session_at) : null),
  );
  if (emailHit) return emailHit as Record<string, unknown>;

  const digits = phoneDigits(phone);
  if (digits.length < 7) return null;

  const { data: phoneRows, error: phoneErr } = await admin
    .from('hm_public_webinar_signups')
    .select(
      'id, first_name, last_name, email, phone, session_at, session_label, broadcast_id, webinar_id, wg_subscription_id, watch_link, confirmation_link, email_verified, created_at, already_registered',
    )
    .not('phone', 'is', null)
    .order('created_at', { ascending: false })
    .limit(100);
  if (phoneErr) {
    console.error('findExistingPublicSignup phone lookup failed', phoneErr);
    return null;
  }
  const phoneHit = (phoneRows || []).find((row) => {
    if (phoneDigits(row.phone) !== digits) return false;
    return registrationStillActive(row.session_at != null ? String(row.session_at) : null);
  });
  return phoneHit ? (phoneHit as Record<string, unknown>) : null;
}

async function findAnySubscriptionForEmail(
  email: string,
  webinarId?: string | null,
): Promise<Record<string, unknown> | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const baseParams = {
    email: normalized,
    per_page: 50,
    nested_resources: 'broadcast,webinar',
  };
  const passes: Array<Record<string, string | number | boolean | undefined>> = [
    baseParams,
    { ...baseParams, email_verified: false },
    { ...baseParams, include_unverified: true },
  ];
  for (const params of passes) {
    const res = await wgGet('/subscriptions', params);
    if (!res.ok) continue;
    const rows = subscriptionRowsFromWgJson(res.json);
    const matches = rows.filter((row) => {
      const nestedWebinar =
        row.webinar && typeof row.webinar === 'object'
          ? (row.webinar as Record<string, unknown>)
          : null;
      const nestedBroadcast =
        row.broadcast && typeof row.broadcast === 'object'
          ? (row.broadcast as Record<string, unknown>)
          : null;
      const rowWebinarId = str(
        nestedWebinar?.id || row.webinar_id || nestedBroadcast?.webinar_id,
      );
      if (webinarId && rowWebinarId && rowWebinarId !== webinarId) return false;
      const dateMs =
        unixMsFromField(nestedBroadcast?.date) ??
        unixMsFromField(row.broadcast_date) ??
        unixMsFromField(row.created_at);
      if (dateMs != null && dateMs < Date.now() - 3 * 60 * 60 * 1000) return false;
      return true;
    });
    if (matches.length) {
      matches.sort((a, b) => {
        const aB =
          a.broadcast && typeof a.broadcast === 'object'
            ? (a.broadcast as Record<string, unknown>)
            : null;
        const bB =
          b.broadcast && typeof b.broadcast === 'object'
            ? (b.broadcast as Record<string, unknown>)
            : null;
        const aMs = unixMsFromField(aB?.date) ?? 0;
        const bMs = unixMsFromField(bB?.date) ?? 0;
        return bMs - aMs;
      });
      return matches[0];
    }
  }
  return null;
}

function rememberSubscription(
  merged: Map<string, Record<string, unknown>>,
  row: Record<string, unknown>,
) {
  const id = row.id != null ? String(row.id) : '';
  const key = id || `${String(row.email || '')}|${String(row.created_at || '')}`;
  if (!merged.has(key)) merged.set(key, row);
}

/**
 * Email-filtered WebinarGeek lookup used first by the staff Webinar verify page
 * (integrations-webinar-geek GET ?mode=verify → findSubscriptionsByEmail).
 * That filter often omits people who have not confirmed yet. The caller then
 * reads the public signup row (and its live subscription) before the staff
 * page's recent-subscription scan, so a known booking is not reported missing.
 */
async function findSubscriptionsByEmail(email: string): Promise<{
  ok: boolean;
  rows: Array<Record<string, unknown>>;
}> {
  const normalized = normalizeEmail(email);
  if (!normalized) return { ok: true, rows: [] };
  const nested = { nested_resources: 'broadcast,webinar', per_page: 50 };
  const passes: Array<Record<string, string | number | boolean | undefined>> = [
    { ...nested, email: normalized },
    { ...nested, email: normalized, email_verified: false },
    { ...nested, email: normalized, include_unverified: true },
  ];
  const merged = new Map<string, Record<string, unknown>>();
  let anyOk = false;
  for (const params of passes) {
    const res = await wgGet('/subscriptions', params);
    if (!res.ok) continue;
    anyOk = true;
    for (const row of subscriptionRowsFromWgJson(res.json)) rememberSubscription(merged, row);
    if (merged.size > 0) break;
  }
  return { ok: anyOk, rows: [...merged.values()] };
}

/** Staff verify fallback: page recent subscriptions, including the unverified pass. */
async function scanRecentSubscriptionsForEmail(email: string): Promise<{
  ok: boolean;
  rows: Array<Record<string, unknown>>;
}> {
  const sinceMs = Date.now() - 45 * 24 * 60 * 60 * 1000;
  const passes: Array<Record<string, string | number | boolean | undefined>> = [
    {},
    { email_verified: false },
    { include_unverified: true },
  ];
  const matched: Array<Record<string, unknown>> = [];
  let anyOk = false;
  for (const extra of passes) {
    let page = 1;
    let foundOnPass = false;
    for (let guard = 0; guard < 10; guard++) {
      const res = await wgGet('/subscriptions', {
        per_page: 100,
        page,
        nested_resources: 'broadcast,webinar',
        ...extra,
      });
      if (!res.ok) break;
      anyOk = true;
      const pageRows = subscriptionRowsFromWgJson(res.json);
      if (!pageRows.length) break;
      for (const row of pageRows) {
        if (normalizeEmail(row.email) !== email) continue;
        matched.push(row);
        foundOnPass = true;
      }
      const times = pageRows
        .map((row) => unixMsFromField(row.created_at))
        .filter((ms): ms is number => ms != null);
      const newest = times.length ? Math.max(...times) : null;
      if (newest != null && newest < sinceMs) break;
      const pages =
        res.json.pages && typeof res.json.pages === 'object'
          ? (res.json.pages as Record<string, unknown>)
          : {};
      const totalPages = Number(pages.total_pages || 1);
      if (!pages.next || page >= totalPages) break;
      page += 1;
    }
    if (foundOnPass) break;
  }
  return { ok: anyOk, rows: matched };
}

/** Booking row from /schedule-webinar, then the live WebinarGeek subscription it points at. */
async function subscriptionFromPublicSignup(
  email: string,
): Promise<Record<string, unknown> | null> {
  try {
    const admin = serviceClient();
    const { data, error } = await admin
      .from('hm_public_webinar_signups')
      .select('broadcast_id, wg_subscription_id, email_verified, email')
      .ilike('email', email)
      .order('created_at', { ascending: false })
      .limit(10);
    if (error) {
      console.error('verification signup lookup failed', error);
      return null;
    }
    const signup = (data || []).find((row) => str(row.wg_subscription_id)) || data?.[0];
    if (!signup) return null;
    const subscriptionId = str(signup.wg_subscription_id);
    if (subscriptionId) {
      const res = await wgGet(`/subscriptions/${encodeURIComponent(subscriptionId)}`, {
        nested_resources: 'broadcast,webinar',
      });
      if (res.ok) {
        const row = subscriptionRowsFromWgJson(res.json)[0];
        if (row) return row;
        if (res.json.id != null) return res.json;
      }
    }
    return {
      id: signup.wg_subscription_id ?? null,
      email,
      email_verified: signup.email_verified === true,
      broadcast_id: signup.broadcast_id ?? null,
    };
  } catch (err) {
    console.error('verification signup lookup failed', err);
    return null;
  }
}

function subscriptionSortMs(row: Record<string, unknown>): number {
  const broadcast =
    row.broadcast && typeof row.broadcast === 'object'
      ? (row.broadcast as Record<string, unknown>)
      : null;
  return unixMsFromField(broadcast?.date) ?? unixMsFromField(row.created_at) ?? 0;
}

async function handleBotVerification(url: URL): Promise<Response> {
  const email = normalizeEmail(url.searchParams.get('email') || '');
  if (!email) return respond(400, { error: 'email is required.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return respond(400, { error: 'email is invalid.' });
  }
  const lookedUp = await findSubscriptionsByEmail(email);
  let rows = lookedUp.rows;
  let lookupOk = lookedUp.ok;
  if (rows.length === 0) {
    const fromSignup = await subscriptionFromPublicSignup(email);
    if (fromSignup) rows = [fromSignup];
  }
  if (rows.length === 0) {
    const scanned = await scanRecentSubscriptionsForEmail(email);
    if (scanned.ok) lookupOk = true;
    rows = scanned.rows;
  }
  if (rows.length === 0 && !lookupOk) {
    return respond(502, { error: 'Unable to check WebinarGeek verification.' });
  }
  if (rows.length === 0) {
    return respond(404, { error: 'No signup found for this email.' });
  }
  const verified = rows.some((row) => row.email_verified === true);
  const pool = verified ? rows.filter((row) => row.email_verified === true) : rows;
  const chosen = [...pool].sort((a, b) => subscriptionSortMs(b) - subscriptionSortMs(a))[0];
  return respond(200, {
    email,
    verified,
    registration_id: numericId(chosen?.id),
    session_id: numericId(subscriptionBroadcastId(chosen || {})),
  });
}

type BookResult = { status: number; payload: Record<string, unknown> };

async function hydrateRegistration(input: {
  email: string;
  broadcastId: string | null;
  webinarId: string | null;
  registrationId: unknown;
  watchLink: string | null;
  confirmationLink: string | null;
  date: unknown;
}): Promise<{
  registrationId: unknown;
  watchLink: string | null;
  confirmationLink: string | null;
  date: unknown;
  broadcastId: string | null;
}> {
  let registrationId = input.registrationId;
  let watchLink = input.watchLink;
  let confirmationLink = input.confirmationLink;
  let date = input.date;
  let broadcastId = input.broadcastId;
  if (numericId(registrationId) != null && watchLink) {
    return { registrationId, watchLink, confirmationLink, date, broadcastId };
  }

  let row: Record<string, unknown> | null = null;
  if (broadcastId) {
    const rows = await findSubscriptionForBroadcast(input.email, broadcastId);
    row = rows[0] || null;
  }
  if (!row) row = await findAnySubscriptionForEmail(input.email, input.webinarId);
  if (row) {
    const links = linksFromSubscription(row);
    if (numericId(registrationId) == null) registrationId = row.id;
    watchLink = watchLink || links.watch_link;
    confirmationLink = confirmationLink || links.confirmation_link;
    if (date == null) date = links.broadcast_date;
    broadcastId = links.broadcast_id || broadcastId;
  }
  return { registrationId, watchLink, confirmationLink, date, broadcastId };
}

async function alreadyRegisteredResponse(input: {
  email: string;
  whenLabel: string;
  broadcastId: string | null;
  title: string | null;
  date: unknown;
  webinarId: string | null;
  emailVerified?: boolean;
  watchLink?: string | null;
  confirmationLink?: string | null;
  registrationId?: unknown;
}): Promise<BookResult> {
  const hydrated = await hydrateRegistration({
    email: input.email,
    broadcastId: input.broadcastId,
    webinarId: input.webinarId,
    registrationId: input.registrationId ?? null,
    watchLink: input.watchLink || null,
    confirmationLink: input.confirmationLink || null,
    date: input.date,
  });
  const when = input.whenLabel || 'the session you already chose';
  return {
    status: 200,
    payload: {
      ok: true,
      booked: false,
      already_registered: true,
      registration_id: numericId(hydrated.registrationId),
      email_verified: input.emailVerified === true,
      watch_link: hydrated.watchLink,
      confirmation_link: hydrated.confirmationLink,
      broadcast: {
        id: hydrated.broadcastId,
        title: input.title,
        date: hydrated.date ?? input.date,
        webinar_id: input.webinarId,
      },
      message: `You have already registered for the webinar on ${when}. Please check your email for the WebinarGeek confirmation and join link (and spam/promotions if you do not see it).`,
    },
  };
}

/** Same validation, WebinarGeek subscribe, and signup records as POST ?mode=book. */
async function bookFromPublicBody(
  body: Record<string, unknown>,
  options?: { channel?: string | null },
): Promise<BookResult> {
  const email = normalizeEmail(body.email);
  const firstname = str(body.firstname || body.first_name || body.firstName);
  const surname = str(body.surname || body.last_name || body.lastName);
  const phone = str(body.phone);
  const wantQuick =
    body.quick === true ||
    body.quick === 1 ||
    body.quick === '1' ||
    String(body.quick || '').toLowerCase() === 'true' ||
    body.mode === 'quick' ||
    str(body.schedule_mode) === 'quick';
  let broadcastId = String(body.broadcast_id ?? body.broadcastId ?? '').trim();
  let webinarId = String(body.webinar_id ?? body.webinarId ?? '').trim();
  const customField =
    str(body.custom_field) ||
    Deno.env.get('PUBLIC_WEBINAR_CUSTOM_FIELD')?.trim() ||
    'cold-email';
  const reference = str(body.reference).slice(0, 200);
  const channel = str(options?.channel) || null;

  if (!email || !firstname) {
    return { status: 400, payload: { error: 'email and firstname are required.' } };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { status: 400, payload: { error: 'Please enter a valid email address.' } };
  }

  // Always re-resolve JIT from the preferred published webinar (ignore stale client ids).
  if (wantQuick) {
    const schedule = await loadPublicSchedule();
    if (!schedule.ok) {
      return { status: schedule.status, payload: { error: schedule.error } };
    }
    if (!schedule.quick?.id) {
      return {
        status: 409,
        payload: {
          error:
            'Watch now is unavailable right now. Enable Just-in-time on your published AO webinar, or pick a time from today’s / tomorrow’s list.',
          quick_available: false,
        },
      };
    }
    broadcastId = String(schedule.quick.id ?? '').trim();
    webinarId = String(schedule.quick.webinar_id ?? '').trim() || webinarId;
  }

  if (!broadcastId) {
    return {
      status: 400,
      payload: {
        error: wantQuick
          ? 'Could not resolve a Just-in-time session. Try again or pick a time from the list.'
          : 'email, firstname, and broadcast_id are required.',
      },
    };
  }

  // Block duplicate form submissions (any upcoming session for this email/phone).
  const existingSignup = await findExistingPublicSignup(email, phone);
  if (existingSignup) {
    const sessionAt = existingSignup.session_at != null ? String(existingSignup.session_at) : null;
    const whenLabel =
      str(existingSignup.session_label) || formatSessionWhen(sessionAt) || 'your selected time';
    return alreadyRegisteredResponse({
      email,
      whenLabel,
      broadcastId: existingSignup.broadcast_id != null ? String(existingSignup.broadcast_id) : null,
      title: null,
      date: sessionAt,
      webinarId: existingSignup.webinar_id != null ? String(existingSignup.webinar_id) : null,
      emailVerified: existingSignup.email_verified === true,
      watchLink: existingSignup.watch_link != null ? String(existingSignup.watch_link) : null,
      confirmationLink:
        existingSignup.confirmation_link != null ? String(existingSignup.confirmation_link) : null,
      registrationId: existingSignup.wg_subscription_id,
    });
  }

  // For JIT virtual broadcasts, skip "already registered" lookup on the virtual id —
  // WebinarGeek creates a real broadcast on subscribe and handles duplicates itself.
  const broadcastContext = await resolveBroadcastContext(broadcastId, webinarId || undefined);
  if (!broadcastContext.ok) {
    const status = broadcastContext.status === 404 ? 404 : broadcastContext.status === 422 ? 422 : 502;
    return { status, payload: { error: broadcastContext.error } };
  }

  // Also block if WebinarGeek already has an active subscription for this email.
  const existingWg = await findAnySubscriptionForEmail(email, broadcastContext.webinarId);
  if (existingWg) {
    const links = linksFromSubscription(existingWg);
    const effectiveBroadcastId = links.broadcast_id || broadcastId;
    const effectiveDate = links.broadcast_date ?? broadcastContext.date;
    const whenLabel = formatSessionWhen(effectiveDate) || 'your selected time';
    return alreadyRegisteredResponse({
      email,
      whenLabel,
      broadcastId: effectiveBroadcastId,
      title: broadcastContext.title,
      date: effectiveDate,
      webinarId: broadcastContext.webinarId,
      emailVerified: existingWg.email_verified === true,
      watchLink: links.watch_link,
      confirmationLink: links.confirmation_link,
      registrationId: existingWg.id,
    });
  }

  if (!wantQuick) {
    const existingRows = await findSubscriptionForBroadcast(email, broadcastId);
    if (existingRows.length > 0) {
      const row = existingRows[0];
      const links = linksFromSubscription(row);
      const effectiveBroadcastId = links.broadcast_id || broadcastId;
      const effectiveDate = links.broadcast_date ?? broadcastContext.date;
      const whenLabel = formatSessionWhen(effectiveDate) || 'your selected time';
      return alreadyRegisteredResponse({
        email,
        whenLabel,
        broadcastId: effectiveBroadcastId,
        title: broadcastContext.title,
        date: effectiveDate,
        webinarId: broadcastContext.webinarId,
        emailVerified: row.email_verified === true,
        watchLink: links.watch_link,
        confirmationLink: links.confirmation_link,
        registrationId: row.id,
      });
    }
  }

  if (sessionIsFull(broadcastContext.subscriptionsCount, broadcastContext.maximumSubscribers)) {
    return { status: 409, payload: { error: 'This session is full.' } };
  }

  let payload = buildSubscriptionPayload({
    email,
    firstname,
    surname,
    phone,
    customField,
    registrationFields: broadcastContext.registrationFields,
  });
  // Explicitly ensure WG sends confirmation (default is true; set false only if needed).
  payload.skip_confirmation_mail = false;

  let bookRes = await wgPost(
    `/broadcasts/${encodeURIComponent(broadcastId)}/subscriptions`,
    payload,
  );

  if (!bookRes.ok && bookRes.status === 422 && customField) {
    const withoutTag = { ...payload };
    delete withoutTag.custom_field;
    const retry = await wgPost(
      `/broadcasts/${encodeURIComponent(broadcastId)}/subscriptions`,
      withoutTag,
    );
    if (retry.ok) {
      bookRes = retry;
      payload = withoutTag;
    }
  }

  if (!bookRes.ok && bookRes.status === 422 && !surname) {
    const withSurname = buildSubscriptionPayload({
      email,
      firstname,
      surname: '.',
      phone,
      customField: payload.custom_field ? String(payload.custom_field) : null,
      registrationFields: broadcastContext.registrationFields,
    });
    withSurname.skip_confirmation_mail = false;
    const retry = await wgPost(
      `/broadcasts/${encodeURIComponent(broadcastId)}/subscriptions`,
      withSurname,
    );
    if (retry.ok) {
      bookRes = retry;
      payload = withSurname;
    }
  }

  if (!bookRes.ok) {
    const wgMsg = wgErrorMessage(bookRes.json, `WebinarGeek booking failed (${bookRes.status})`);
    const looksDuplicate =
      bookRes.status === 422 &&
      /already|registered|subscribed|exists|duplicate/i.test(wgMsg);
    if (looksDuplicate) {
      const confirmed = await findAnySubscriptionForEmail(email, broadcastContext.webinarId);
      const links = linksFromSubscription(confirmed);
      const effectiveDate = links.broadcast_date ?? broadcastContext.date;
      return alreadyRegisteredResponse({
        email,
        whenLabel: formatSessionWhen(effectiveDate) || 'your selected time',
        broadcastId: links.broadcast_id || broadcastId,
        title: broadcastContext.title,
        date: effectiveDate,
        webinarId: broadcastContext.webinarId,
        emailVerified: confirmed?.email_verified === true,
        watchLink: links.watch_link,
        confirmationLink: links.confirmation_link,
        registrationId: confirmed?.id,
      });
    }
    if (/full|limit|maximum|no longer possible|sold out/i.test(wgMsg)) {
      return { status: 409, payload: { error: 'This session is full.' } };
    }
    return { status: 502, payload: { error: wgMsg, source_status: bookRes.status } };
  }

  let subscriptionRow = subscriptionRowsFromWgJson(bookRes.json)[0] || null;
  if (!subscriptionRow) {
    const confirmed = await findSubscriptionForBroadcast(email, broadcastId);
    subscriptionRow = confirmed[0] || null;
  }
  const links = linksFromSubscription(subscriptionRow);
  let effectiveBroadcastId = links.broadcast_id || broadcastId;
  let effectiveDate = links.broadcast_date ?? broadcastContext.date;
  let registrationId: unknown = subscriptionRow?.id ?? null;
  let watchLink = links.watch_link;
  let confirmationLink = links.confirmation_link;
  if (numericId(registrationId) == null || !watchLink) {
    const hydrated = await hydrateRegistration({
      email,
      broadcastId: effectiveBroadcastId,
      webinarId: broadcastContext.webinarId,
      registrationId,
      watchLink,
      confirmationLink,
      date: effectiveDate,
    });
    registrationId = hydrated.registrationId;
    watchLink = hydrated.watchLink;
    confirmationLink = hydrated.confirmationLink;
    effectiveBroadcastId = hydrated.broadcastId || effectiveBroadcastId;
    effectiveDate = hydrated.date ?? effectiveDate;
  }

  await logPublicSignup({
    firstname,
    surname,
    email,
    phone,
    wantQuick,
    sessionDate: effectiveDate,
    broadcastId: effectiveBroadcastId,
    webinarId: broadcastContext.webinarId,
    subscriptionId: registrationId != null ? String(registrationId) : null,
    alreadyRegistered: false,
    emailVerified: subscriptionRow?.email_verified === true,
    watchLink,
    confirmationLink,
    customField,
    reference,
    channel,
  });

  // Fire-and-forget staff alert + call-workspace lead — never block the registrant response.
  void upsertHmPersonFromPublicWebinarSignup({
    firstname,
    surname,
    email,
    phone,
    wantQuick,
    sessionDate: effectiveDate,
    broadcastId: effectiveBroadcastId,
    webinarId: broadcastContext.webinarId,
    webinarTitle: broadcastContext.title,
    subscriptionId: registrationId != null ? String(registrationId) : null,
    customField,
    reference,
  }).catch((err) => console.error('public webinar hm_people upsert error', err));
  void notifyStaffPublicWebinarSignup({
    firstname,
    surname,
    email,
    phone,
    wantQuick,
    sessionDate: effectiveDate,
    broadcastId: effectiveBroadcastId,
    webinarId: broadcastContext.webinarId,
    webinarTitle: broadcastContext.title,
    subscriptionId: registrationId != null ? String(registrationId) : null,
    emailVerified: subscriptionRow?.email_verified === true,
    watchLink,
    confirmationLink,
    customField,
    reference,
  }).catch((err) => console.error('public webinar signup notify error', err));

  return {
    status: 200,
    payload: {
      ok: true,
      booked: true,
      already_registered: false,
      registration_id: numericId(registrationId),
      quick: wantQuick,
      email_verified: subscriptionRow?.email_verified === true,
      watch_link: watchLink,
      confirmation_link: confirmationLink,
      broadcast: {
        id: effectiveBroadcastId,
        title: broadcastContext.title,
        date: effectiveDate,
        webinar_id: broadcastContext.webinarId,
      },
      message: wantQuick
        ? 'You are registered for the soonest available session. Check your email for the WebinarGeek join link — it starts shortly.'
        : 'You are registered. WebinarGeek will email you a confirmation with the join link shortly.',
    },
  };
}

function botSessionFromBroadcast(row: Record<string, unknown>): Record<string, unknown> | null {
  const sessionId = numericId(row.id);
  const start = isoOffset(row.date);
  if (sessionId == null || !start) return null;
  const available =
    !sessionClosed(row) &&
    !sessionIsFull(nonNegativeInt(row.subscriptions_count), maximumSubscribersFor(row));
  return {
    session_id: sessionId,
    start_time: start,
    available,
    title: str(row.title || row.name) || 'Live webinar',
    timezone: SCHEDULE_TZ,
  };
}

async function handleBotSessions(): Promise<Response> {
  const schedule = await loadPublicSchedule();
  if (!schedule.ok) {
    return respond(schedule.status === 503 ? 503 : 502, { error: schedule.error });
  }
  const sessions: Array<Record<string, unknown>> = [];
  for (const row of schedule.broadcasts) {
    const session = botSessionFromBroadcast(row);
    if (session) sessions.push(session);
  }
  return respond(200, sessions);
}

function botErrorFromBook(status: number, payload: Record<string, unknown>): Response {
  const error = str(payload.error) || 'Request failed.';
  if (status === 400) return respond(400, { error });
  if (status === 404) return respond(404, { error: 'Unknown session.' });
  if (status === 409 || status === 422) return respond(409, { error });
  if (/not found/i.test(error)) return respond(404, { error: 'Unknown session.' });
  if (/full|limit|maximum|no longer possible|sold out/i.test(error)) {
    return respond(409, { error: 'This session is not bookable.' });
  }
  return respond(status >= 400 && status < 600 ? status : 502, { error });
}

function botRegistrationResponse(payload: Record<string, unknown>, fallbackSessionId: number): Response {
  const broadcast =
    payload.broadcast && typeof payload.broadcast === 'object'
      ? (payload.broadcast as Record<string, unknown>)
      : {};
  const sessionId = numericId(broadcast.id) ?? fallbackSessionId;
  const start = isoOffset(broadcast.date);
  const registrationId = numericId(payload.registration_id);
  const watch = str(payload.watch_link) || null;
  if (registrationId == null || !start) {
    return respond(502, { error: 'Registration succeeded but the booking record was incomplete.' });
  }
  return respond(200, {
    registration_id: registrationId,
    session_id: sessionId,
    start_time: start,
    watch_link: watch,
  });
}

async function handleBotRegistration(req: Request): Promise<Response> {
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return respond(400, { error: 'Invalid JSON body.' });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return respond(400, { error: 'Invalid request body.' });
  }
  const record = parsed as Record<string, unknown>;
  if (record.session_id == null || record.session_id === '') {
    return respond(400, { error: 'session_id is required.' });
  }
  const sessionId = numericId(record.session_id);
  if (sessionId == null) return respond(400, { error: 'session_id must be a number.' });
  const firstname = str(record.firstname);
  const surname = str(record.surname);
  const email = normalizeEmail(record.email);
  const phoneRaw = str(record.phone);
  const phone = phoneRaw.replace(/\D/g, '');
  if (!firstname) return respond(400, { error: 'firstname is required.' });
  if (!surname) return respond(400, { error: 'surname is required.' });
  if (!email) return respond(400, { error: 'email is required.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return respond(400, { error: 'email is invalid.' });
  }
  if (!phoneRaw) return respond(400, { error: 'phone is required.' });
  if (!phone) return respond(400, { error: 'phone is invalid.' });

  const result = await bookFromPublicBody(
    {
      email,
      firstname,
      surname,
      phone,
      broadcast_id: String(sessionId),
      quick: false,
    },
    { channel: 'booking-api' },
  );
  if (result.status === 200 && result.payload.ok === true) {
    return botRegistrationResponse(result.payload, sessionId);
  }
  return botErrorFromBook(result.status, result.payload);
}

async function logPublicSignup(input: {
  firstname: string;
  surname: string;
  email: string;
  phone?: string;
  wantQuick: boolean;
  sessionDate: unknown;
  broadcastId: string | null;
  webinarId: string | null;
  subscriptionId?: string | null;
  alreadyRegistered: boolean;
  emailVerified?: boolean | null;
  watchLink?: string | null;
  confirmationLink?: string | null;
  customField?: string | null;
  reference?: string | null;
  channel?: string | null;
}): Promise<void> {
  try {
    const admin = serviceClient();
    const { error } = await admin.from('hm_public_webinar_signups').insert({
      first_name: input.firstname,
      last_name: input.surname || null,
      email: input.email,
      phone: input.phone || null,
      schedule_mode: input.wantQuick ? 'quick' : 'pick',
      session_at: sessionAtFromWgDate(input.sessionDate),
      session_label: formatSessionWhen(input.sessionDate) || null,
      broadcast_id: input.broadcastId,
      webinar_id: input.webinarId,
      wg_subscription_id: input.subscriptionId || null,
      already_registered: input.alreadyRegistered,
      email_verified: input.emailVerified ?? null,
      watch_link: input.watchLink || null,
      confirmation_link: input.confirmationLink || null,
      custom_field: input.customField || null,
      reference: input.reference || null,
      metadata: {
        source: 'hm-public-webinar-schedule',
        reference: input.reference || null,
        ...(input.channel ? { channel: input.channel } : {}),
      },
    });
    if (error) console.error('hm_public_webinar_signups insert failed', error);
  } catch (err) {
    console.error('hm_public_webinar_signups insert failed', err);
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function smtpTransport() {
  const host = Deno.env.get('SMTP_HOSTNAME')?.trim();
  const port = Number(Deno.env.get('SMTP_PORT') ?? 587);
  const secure = (Deno.env.get('SMTP_SECURE') ?? 'false') === 'true';
  const user = Deno.env.get('SMTP_USERNAME')?.trim();
  const pass = Deno.env.get('SMTP_PASSWORD')?.trim();
  if (!host || !user || !pass) throw new Error('Missing SMTP config');
  return nodemailer.createTransport({
    host,
    port: Number.isNaN(port) ? 587 : port,
    secure,
    auth: { user, pass },
    ...(port === 587 && !secure ? { requireTLS: true } : {}),
  });
}

function notifyRecipients(): string[] {
  const raw =
    Deno.env.get('PUBLIC_WEBINAR_SIGNUP_NOTIFY_EMAIL')?.trim() ||
    PORTAL_EMAIL_BCC;
  return raw
    .split(/[,;]/)
    .map((a) => a.trim())
    .filter(Boolean);
}

/** Create/update Hiring Machine call-queue person so recruiters can dial from /pipeline/call. */
async function upsertHmPersonFromPublicWebinarSignup(input: {
  firstname: string;
  surname: string;
  email: string;
  phone?: string;
  wantQuick: boolean;
  sessionDate: unknown;
  broadcastId: string | null;
  webinarId: string | null;
  webinarTitle?: string | null;
  subscriptionId?: string | null;
  customField?: string | null;
  reference?: string | null;
}): Promise<void> {
  try {
    const admin = serviceClient();
    const email = normalizeEmail(input.email);
    if (!email) return;
    const phone = phoneDigits(input.phone) || null;
    const fullName = `${input.firstname} ${input.surname}`.trim() || input.firstname || null;
    const when = formatSessionWhen(input.sessionDate) || 'session TBA';
    const mode = input.wantQuick ? 'Watch now' : 'Pick a time';
    const summary = `Public webinar form · ${mode} · ${when}`;
    const now = new Date().toISOString();

    const { data: existing } = await admin
      .from('hm_people')
      .select('id, stage, phone, extracted_phone, full_name')
      .ilike('email', email)
      .maybeSingle();

    const terminal =
      existing?.stage === 'sent_to_hub' || existing?.stage === 'not_interested';
    const patch: Record<string, unknown> = {
      email,
      updated_at: now,
      campaign_name: 'Public webinar form',
      reply_snippet: summary.slice(0, 280),
      last_reply_text: summary,
      ai_summary: `Registered via /schedule-webinar (${mode}). Session: ${when}.${
        input.reference ? ` Reference: ${input.reference}.` : ''
      }`,
      raw_lead: {
        source: 'hm_public_webinar_signups',
        broadcast_id: input.broadcastId,
        webinar_id: input.webinarId,
        webinar_title: input.webinarTitle || null,
        subscription_id: input.subscriptionId || null,
        custom_field: input.customField || null,
        reference: input.reference || null,
        schedule_mode: input.wantQuick ? 'quick' : 'pick',
        session_label: when,
      },
    };
    if (fullName && !existing?.full_name) patch.full_name = fullName;
    if (phone && !existing?.phone) {
      patch.phone = phone;
      patch.extracted_phone = phone;
    }
    if (!terminal) {
      // Prefer call_ready so they land in the dialer queue.
      if (
        !existing?.stage ||
        existing.stage === 'replied' ||
        existing.stage === 'ooo' ||
        existing.stage === 'shortlisted'
      ) {
        patch.stage = 'call_ready';
      }
    }

    if (existing?.id) {
      const { error } = await admin.from('hm_people').update(patch).eq('id', existing.id);
      if (error) console.error('hm_people update from webinar signup failed', error);
      return;
    }

    const { error: insertErr } = await admin.from('hm_people').insert({
      ...patch,
      full_name: fullName,
      phone,
      extracted_phone: phone,
      extracted_email: email,
      stage: 'call_ready',
      qualify_status: 'none',
      created_at: now,
    });
    if (insertErr) console.error('hm_people insert from webinar signup failed', insertErr);
  } catch (err) {
    console.error('upsertHmPersonFromPublicWebinarSignup failed', err);
  }
}

/** Staff alert when someone completes /schedule-webinar (new bookings only). */
async function notifyStaffPublicWebinarSignup(input: {
  firstname: string;
  surname: string;
  email: string;
  phone?: string;
  wantQuick: boolean;
  sessionDate: unknown;
  broadcastId: string | null;
  webinarId: string | null;
  webinarTitle?: string | null;
  subscriptionId?: string | null;
  emailVerified?: boolean | null;
  watchLink?: string | null;
  confirmationLink?: string | null;
  customField?: string | null;
  reference?: string | null;
}): Promise<void> {
  const toList = notifyRecipients();
  if (!toList.length) return;

  const name =
    `${input.firstname} ${input.surname}`.trim() || input.firstname || '—';
  const when = formatSessionWhen(input.sessionDate) || 'Date TBA';
  const mode = input.wantQuick ? 'Watch now' : 'Pick a time';
  const subject = `New webinar registration — ${name}`;
  const rows: Array<[string, string]> = [
    ['Name', name],
    ['Email', input.email],
    ['Phone', input.phone || '—'],
    ['Mode', mode],
    ['Session', when],
    ['Webinar', input.webinarTitle || '—'],
    ['Broadcast ID', input.broadcastId || '—'],
    ['Webinar ID', input.webinarId || '—'],
    ['Subscription ID', input.subscriptionId || '—'],
    ['Email verified', input.emailVerified === true ? 'Yes' : input.emailVerified === false ? 'No' : '—'],
    ['Tag', input.customField || '—'],
    ['Reference', input.reference || '—'],
    ['Watch link', input.watchLink || '—'],
    ['Confirmation link', input.confirmationLink || '—'],
  ];
  const htmlRows = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 10px;color:#555;vertical-align:top;"><strong>${escapeHtml(label)}</strong></td><td style="padding:6px 10px;color:#111;">${escapeHtml(value)}</td></tr>`,
    )
    .join('');
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;color:#222;">
      <p style="margin:0 0 12px 0;">A new signup was submitted on the public <strong>/schedule-webinar</strong> form.</p>
      <table style="border-collapse:collapse;width:100%;max-width:560px;border:1px solid #e5e7eb;">${htmlRows}</table>
      <p style="margin:14px 0 0 0;color:#666;font-size:12px;">Hiring Machine · public webinar schedule</p>
    </div>
  `.trim();
  const text = rows.map(([label, value]) => `${label}: ${value}`).join('\n');

  const fromEmail =
    Deno.env.get('SMTP_FROM')?.trim() ||
    Deno.env.get('SMTP_USERNAME')?.trim() ||
    'noreply@example.com';
  const fromName = (Deno.env.get('SMTP_FROM_NAME')?.trim() || 'AO Globelife')
    .replace(/["<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'AO Globelife';

  const transport = smtpTransport();
  const admin = serviceClient();
  try {
    await new Promise<void>((resolve, reject) => {
      transport.sendMail(
        {
          from: { name: fromName, address: fromEmail },
          to: toList.join(', '),
          subject,
          text,
          html,
        },
        (err: Error | null) => (err ? reject(err) : resolve()),
      );
    });
    await insertEmailSendLog(admin, {
      source: 'hm-public-webinar-schedule',
      trigger_label: 'public_webinar_signup_notify',
      from_email: fromEmail,
      to_email: toList.join(', '),
      subject,
      status: 'sent',
      metadata: {
        registrant_email: input.email,
        broadcast_id: input.broadcastId,
        webinar_id: input.webinarId,
        mode,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('public webinar signup notify failed', msg);
    await insertEmailSendLog(admin, {
      source: 'hm-public-webinar-schedule',
      trigger_label: 'public_webinar_signup_notify',
      from_email: fromEmail,
      to_email: toList.join(', '),
      subject,
      status: 'failed',
      error_message: msg,
      metadata: {
        registrant_email: input.email,
        broadcast_id: input.broadcastId,
      },
    }).catch(() => undefined);
  }
}

async function requireSignedInUser(req: Request): Promise<Response | null> {
  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return json(401, { error: 'Sign in again to delete a signup.' });
  }
  const url = Deno.env.get('SUPABASE_URL') || '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') || '';
  if (!url || !anon) return json(500, { error: 'Missing Supabase auth config.' });
  const supabase = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return json(401, { error: 'Sign in again to delete a signup.' });
  return null;
}

function wgRejectedDelete(res: { json: Record<string, unknown>; raw: string }): boolean {
  const message = wgErrorMessage(res.json, '');
  return /invalid action/i.test(message) || /invalid action/i.test(res.raw);
}

/**
 * Deletes that one subscription (the seat on its broadcast).
 * Unsubscribe only flags the row; the booked session stays in WebinarGeek.
 * This does not call the broadcast delete API, so the time slot remains.
 */
async function removeWebinarGeekSubscription(
  subscriptionId: string,
): Promise<'removed' | 'already_gone'> {
  const id = numericId(subscriptionId) ?? subscriptionId.trim();
  const path = `/subscriptions/${encodeURIComponent(String(id))}`;
  let res = await wgDelete(path);
  // Same resource, still DELETE. Retry with an empty JSON object only when
  // WebinarGeek rejected the body-less call as an invalid action.
  if (!res.ok && res.status !== 204 && wgRejectedDelete(res)) {
    res = await wgDelete(path, '{}');
  }
  if (res.ok || res.status === 204) return 'removed';
  const message = wgErrorMessage(res.json, `WebinarGeek delete subscription failed (${res.status})`);
  if (res.status === 404 || /not found|already (removed|deleted)|does not exist/i.test(message)) {
    return 'already_gone';
  }
  throw new Error(message);
}

async function countMatching(
  admin: ReturnType<typeof serviceClient>,
  table: string,
  column: string,
  value: string,
): Promise<number | null> {
  const { count, error } = await admin
    .from(table)
    .select('id', { count: 'exact', head: true })
    .ilike(column, value);
  if (error) return null;
  return count || 0;
}

async function portalPersonDeletePlan(
  admin: ReturnType<typeof serviceClient>,
  email: string,
  signupId: string,
): Promise<{ personId: string | null; person: 'kept' | 'none'; person_kept_reason: string | null }> {
  const { data: person, error } = await admin
    .from('hm_people')
    .select(
      'id, stage, pipeline_candidate_id, instantly_lead_id, instantly_email_id, campaign_id, campaign_name, unibox_url, positive_source, last_called_at, sent_to_hub_at, shortlisted_email_sent_at, qualify_status, raw_lead',
    )
    .ilike('email', email)
    .maybeSingle();
  if (error) return { personId: null, person: 'kept', person_kept_reason: 'the portal contact could not be checked' };
  if (!person?.id) return { personId: null, person: 'none', person_kept_reason: null };

  const raw =
    person.raw_lead && typeof person.raw_lead === 'object'
      ? (person.raw_lead as Record<string, unknown>)
      : {};
  const fromThisSignup =
    str(raw.source) === 'hm_public_webinar_signups' || str(person.campaign_name) === 'Public webinar form';

  const { count: otherSignups, error: signupCountError } = await admin
    .from('hm_public_webinar_signups')
    .select('id', { count: 'exact', head: true })
    .ilike('email', email)
    .neq('id', signupId);
  if (signupCountError) {
    return { personId: null, person: 'kept', person_kept_reason: 'other signups could not be checked' };
  }
  if ((otherSignups || 0) > 0) {
    return { personId: null, person: 'kept', person_kept_reason: 'they have another webinar signup' };
  }

  if (
    str(person.instantly_lead_id) ||
    str(person.instantly_email_id) ||
    str(person.campaign_id) ||
    str(person.unibox_url) ||
    str(person.positive_source)
  ) {
    return { personId: null, person: 'kept', person_kept_reason: 'they are an Instantly or campaign contact' };
  }
  if (str(person.pipeline_candidate_id)) {
    return { personId: null, person: 'kept', person_kept_reason: 'they are linked to a pipeline candidate' };
  }
  if (person.last_called_at || person.sent_to_hub_at || person.shortlisted_email_sent_at) {
    return { personId: null, person: 'kept', person_kept_reason: 'they have call or hiring history' };
  }
  const stage = str(person.stage);
  if (stage && !['call_ready', 'replied', 'ooo', 'shortlisted'].includes(stage)) {
    return { personId: null, person: 'kept', person_kept_reason: 'they have been worked in the call workspace' };
  }
  if (str(person.qualify_status) && str(person.qualify_status) !== 'none') {
    return { personId: null, person: 'kept', person_kept_reason: 'they have qualify history' };
  }
  if (!fromThisSignup) {
    return { personId: null, person: 'kept', person_kept_reason: 'they existed in the portal before this signup' };
  }

  const [pipelineHits, checkInHits, hiredByPerson, emailSends] = await Promise.all([
    countMatching(admin, 'pipeline_candidates', 'email', email),
    countMatching(admin, 'candidates', 'email', email),
    admin
      .from('hm_hired_agents')
      .select('id', { count: 'exact', head: true })
      .or(`person_id.eq.${person.id},email.ilike.${email}`),
    admin.from('hm_email_sends').select('id', { count: 'exact', head: true }).eq('person_id', person.id),
  ]);
  if (pipelineHits == null || pipelineHits > 0) {
    return { personId: null, person: 'kept', person_kept_reason: 'they match a pipeline candidate' };
  }
  if (checkInHits == null || checkInHits > 0) {
    return { personId: null, person: 'kept', person_kept_reason: 'they have a check-in' };
  }
  if (hiredByPerson.error || (hiredByPerson.count || 0) > 0) {
    return { personId: null, person: 'kept', person_kept_reason: 'they are a hired agent' };
  }
  if (emailSends.error || (emailSends.count || 0) > 0) {
    return { personId: null, person: 'kept', person_kept_reason: 'they have portal emails' };
  }

  return { personId: String(person.id), person: 'none', person_kept_reason: null };
}

async function handleStaffDeleteSignup(req: Request): Promise<Response> {
  const denied = await requireSignedInUser(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { id?: string };
  const signupId = str(body.id);
  if (!signupId) return json(400, { error: 'Signup id is required.' });

  const admin = serviceClient();
  const { data: signup, error } = await admin
    .from('hm_public_webinar_signups')
    .select('id, email, wg_subscription_id')
    .eq('id', signupId)
    .maybeSingle();
  if (error) return json(500, { error: error.message });
  if (!signup) return json(404, { error: 'Signup not found.' });

  const email = normalizeEmail(signup.email);
  const subscriptionId = str(signup.wg_subscription_id);
  let webinargeek: 'removed' | 'already_gone' | 'none' = 'none';
  if (subscriptionId) {
    try {
      webinargeek = await removeWebinarGeekSubscription(subscriptionId);
    } catch (err) {
      return json(502, {
        error: err instanceof Error ? err.message : 'Could not remove the WebinarGeek registration.',
      });
    }
  }

  const personPlan = email
    ? await portalPersonDeletePlan(admin, email, signupId)
    : { personId: null, person: 'none' as const, person_kept_reason: null };

  const { error: deleteError } = await admin.from('hm_public_webinar_signups').delete().eq('id', signupId);
  if (deleteError) return json(500, { error: deleteError.message });

  let person: 'removed' | 'kept' | 'none' = personPlan.personId ? 'removed' : personPlan.person;
  let personKeptReason = personPlan.person_kept_reason;
  if (personPlan.personId) {
    const { error: personError } = await admin.from('hm_people').delete().eq('id', personPlan.personId);
    if (personError) {
      person = 'kept';
      personKeptReason = personError.message;
    }
  }

  return json(200, {
    ok: true,
    signup: true,
    webinargeek,
    person,
    person_kept_reason: personKeptReason,
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    // Staff Form signups posts ?mode=delete-signup. `action` is the same value
    // when a client sends the mode under that name.
    const modeParam = (url.searchParams.get('mode') || url.searchParams.get('action') || '').trim();
    const bot =
      botEndpoint(url.pathname) ||
      (modeParam === 'bot-sessions'
        ? 'sessions'
        : modeParam === 'bot-register'
          ? 'registrations'
          : modeParam === 'bot-verify'
            ? 'verification'
            : null);
    if (bot) {
      if (!bookingApiKeyOk(req)) {
        return respond(401, { error: 'Missing or invalid API key.' });
      }
      if (bot === 'sessions') {
        if (req.method !== 'GET') return respond(405, { error: 'Method not allowed.' });
        return await handleBotSessions();
      }
      if (bot === 'verification') {
        if (req.method !== 'GET') return respond(405, { error: 'Method not allowed.' });
        return await handleBotVerification(url);
      }
      if (req.method !== 'POST') return respond(405, { error: 'Method not allowed.' });
      return await handleBotRegistration(req);
    }

    const mode =
      (url.searchParams.get('mode') || url.searchParams.get('action') || '').trim() ||
      (req.method === 'GET' ? 'upcoming' : 'book');

    if (req.method === 'GET' && (mode === 'upcoming' || mode === 'upcoming-broadcasts')) {
      const schedule = await loadPublicSchedule();
      if (!schedule.ok) {
        return json(schedule.status, { error: schedule.error });
      }
      return json(200, {
        ok: true,
        broadcasts: schedule.broadcasts.map(formatBroadcast),
        quick_slot: schedule.quick ? formatBroadcast(schedule.quick) : null,
        timezone: SCHEDULE_TZ,
        window: 'today_and_tomorrow',
        quick_window_minutes: Math.round(QUICK_WINDOW_MS / 60000),
      });
    }

    if (req.method === 'GET' && mode === 'jit-catalog') {
      const webinarsRes = await wgGet('/webinars', { per_page: 50 });
      if (!webinarsRes.ok) {
        return json(webinarsRes.status === 503 ? 503 : 502, {
          error: wgErrorMessage(webinarsRes.json, 'Unable to load webinars'),
        });
      }
      const webinars = Array.isArray(webinarsRes.json.webinars)
        ? (webinarsRes.json.webinars as Array<Record<string, unknown>>)
        : [];
      const rows: Array<Record<string, unknown>> = [];
      for (const webinar of webinars) {
        const episodes = Array.isArray(webinar.episodes)
          ? (webinar.episodes as Array<Record<string, unknown>>)
          : [];
        for (const episode of episodes) {
          if (episode.jit_enabled !== true) continue;
          rows.push({
            webinar_id: webinar.id ?? null,
            webinar_title: webinar.title ?? null,
            webinar_url: webinar.url ?? null,
            archived: webinar.archived === true,
            episode_id: episode.id ?? null,
            episode_title: episode.title ?? null,
            episode_published: episode.published === true,
            jit_broadcast_id: episode.jit_broadcast_id ?? null,
            jit_period_minutes: episode.jit_period_minutes ?? null,
            jit_closest_time: episode.jit_closest_time ?? null,
            score: webinarJitScore(webinar, episode),
          });
        }
      }
      rows.sort((a, b) => Number(b.score) - Number(a.score));
      return json(200, { ok: true, jit_webinars: rows });
    }

    if (req.method === 'POST' && mode === 'book') {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const result = await bookFromPublicBody(body);
      return json(result.status, result.payload);
    }

    if (req.method === 'POST' && mode === 'delete-signup') {
      return await handleStaffDeleteSignup(req);
    }

    return json(405, {
      error: 'Method not allowed. Use GET ?mode=upcoming, POST ?mode=book, or POST ?mode=delete-signup.',
    });
  } catch (err) {
    console.error('hm-public-webinar-schedule error', err);
    return json(500, {
      error: err instanceof Error ? err.message : 'Unexpected server error',
    });
  }
});
