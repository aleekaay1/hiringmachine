// Public webinar self-schedule for cold-email candidates (no staff auth).
// Deploy: supabase functions deploy hm-public-webinar-schedule --project-ref ofhcnsuwrhyvxtvtdunw
// Requires Edge secret: WEBINARGEEK_API_TOKEN
// Optional: WEBINARGEEK_API_BASE_URL, PUBLIC_WEBINAR_GEEK_WEBINAR_ID, PUBLIC_WEBINAR_CUSTOM_FIELD

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
  const res = await fetch(url, {
    ...init,
    headers: {
      'Api-Token': token,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
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

const SCHEDULE_TZ = 'America/Toronto';
/** Fallback “soon” window when JIT virtual broadcast is not available. */
const QUICK_WINDOW_MS = 90 * 60 * 1000;

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
  if (!registrationFields.length && resolvedWebinarId) {
    const webinarRes = await wgGet(`/webinars/${encodeURIComponent(resolvedWebinarId)}`);
    if (webinarRes.ok) registrationFields = registrationFieldsFromJson(webinarRes.json);
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
      'id, first_name, last_name, email, phone, session_at, session_label, broadcast_id, webinar_id, watch_link, confirmation_link, email_verified, created_at, already_registered',
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
      'id, first_name, last_name, email, phone, session_at, session_label, broadcast_id, webinar_id, watch_link, confirmation_link, email_verified, created_at, already_registered',
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

function alreadyRegisteredResponse(input: {
  whenLabel: string;
  broadcastId: string | null;
  title: string | null;
  date: unknown;
  webinarId: string | null;
  emailVerified?: boolean;
  watchLink?: string | null;
  confirmationLink?: string | null;
}) {
  const when = input.whenLabel || 'the session you already chose';
  return json(200, {
    ok: true,
    booked: false,
    already_registered: true,
    email_verified: input.emailVerified === true,
    watch_link: input.watchLink || null,
    confirmation_link: input.confirmationLink || null,
    broadcast: {
      id: input.broadcastId,
      title: input.title,
      date: input.date,
      webinar_id: input.webinarId,
    },
    message: `You have already registered for the webinar on ${when}. Please check your email for the WebinarGeek confirmation and join link (and spam/promotions if you do not see it).`,
  });
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
      metadata: {
        source: 'hm-public-webinar-schedule',
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
      ai_summary: `Registered via /schedule-webinar (${mode}). Session: ${when}.`,
      raw_lead: {
        source: 'hm_public_webinar_signups',
        broadcast_id: input.broadcastId,
        webinar_id: input.webinarId,
        webinar_title: input.webinarTitle || null,
        subscription_id: input.subscriptionId || null,
        custom_field: input.customField || null,
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const mode = (url.searchParams.get('mode') || '').trim() || (req.method === 'GET' ? 'upcoming' : 'book');

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

      if (!email || !firstname) {
        return json(400, { error: 'email and firstname are required.' });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return json(400, { error: 'Please enter a valid email address.' });
      }

      // Always re-resolve JIT from the preferred published webinar (ignore stale client ids).
      if (wantQuick) {
        const schedule = await loadPublicSchedule();
        if (!schedule.ok) {
          return json(schedule.status, { error: schedule.error });
        }
        if (!schedule.quick?.id) {
          return json(409, {
            error:
              'Watch now is unavailable right now. Enable Just-in-time on your published AO webinar, or pick a time from today’s / tomorrow’s list.',
            quick_available: false,
          });
        }
        broadcastId = String(schedule.quick.id ?? '').trim();
        webinarId = String(schedule.quick.webinar_id ?? '').trim() || webinarId;
      }

      if (!broadcastId) {
        return json(400, {
          error: wantQuick
            ? 'Could not resolve a Just-in-time session. Try again or pick a time from the list.'
            : 'email, firstname, and broadcast_id are required.',
        });
      }

      // Block duplicate form submissions (any upcoming session for this email/phone).
      const existingSignup = await findExistingPublicSignup(email, phone);
      if (existingSignup) {
        const sessionAt = existingSignup.session_at != null ? String(existingSignup.session_at) : null;
        const whenLabel =
          str(existingSignup.session_label) || formatSessionWhen(sessionAt) || 'your selected time';
        return alreadyRegisteredResponse({
          whenLabel,
          broadcastId: existingSignup.broadcast_id != null ? String(existingSignup.broadcast_id) : null,
          title: null,
          date: sessionAt,
          webinarId: existingSignup.webinar_id != null ? String(existingSignup.webinar_id) : null,
          emailVerified: existingSignup.email_verified === true,
          watchLink: existingSignup.watch_link != null ? String(existingSignup.watch_link) : null,
          confirmationLink:
            existingSignup.confirmation_link != null ? String(existingSignup.confirmation_link) : null,
        });
      }

      // For JIT virtual broadcasts, skip "already registered" lookup on the virtual id —
      // WebinarGeek creates a real broadcast on subscribe and handles duplicates itself.
      const broadcastContext = await resolveBroadcastContext(broadcastId, webinarId || undefined);
      if (!broadcastContext.ok) {
        return json(broadcastContext.status === 404 ? 404 : broadcastContext.status === 422 ? 422 : 502, {
          error: broadcastContext.error,
        });
      }

      // Also block if WebinarGeek already has an active subscription for this email.
      const existingWg = await findAnySubscriptionForEmail(email, broadcastContext.webinarId);
      if (existingWg) {
        const links = linksFromSubscription(existingWg);
        const effectiveBroadcastId = links.broadcast_id || broadcastId;
        const effectiveDate = links.broadcast_date ?? broadcastContext.date;
        const whenLabel = formatSessionWhen(effectiveDate) || 'your selected time';
        return alreadyRegisteredResponse({
          whenLabel,
          broadcastId: effectiveBroadcastId,
          title: broadcastContext.title,
          date: effectiveDate,
          webinarId: broadcastContext.webinarId,
          emailVerified: existingWg.email_verified === true,
          watchLink: links.watch_link,
          confirmationLink: links.confirmation_link,
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
            whenLabel,
            broadcastId: effectiveBroadcastId,
            title: broadcastContext.title,
            date: effectiveDate,
            webinarId: broadcastContext.webinarId,
            emailVerified: row.email_verified === true,
            watchLink: links.watch_link,
            confirmationLink: links.confirmation_link,
          });
        }
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
            whenLabel: formatSessionWhen(effectiveDate) || 'your selected time',
            broadcastId: links.broadcast_id || broadcastId,
            title: broadcastContext.title,
            date: effectiveDate,
            webinarId: broadcastContext.webinarId,
            emailVerified: confirmed?.email_verified === true,
            watchLink: links.watch_link,
            confirmationLink: links.confirmation_link,
          });
        }
        return json(502, {
          error: wgMsg,
          source_status: bookRes.status,
        });
      }

      let subscriptionRow = subscriptionRowsFromWgJson(bookRes.json)[0] || null;
      if (!subscriptionRow) {
        const confirmed = await findSubscriptionForBroadcast(email, broadcastId);
        subscriptionRow = confirmed[0] || null;
      }
      const links = linksFromSubscription(subscriptionRow);
      const effectiveBroadcastId = links.broadcast_id || broadcastId;
      const effectiveDate = links.broadcast_date ?? broadcastContext.date;

      await logPublicSignup({
        firstname,
        surname,
        email,
        phone,
        wantQuick,
        sessionDate: effectiveDate,
        broadcastId: effectiveBroadcastId,
        webinarId: broadcastContext.webinarId,
        subscriptionId: subscriptionRow?.id != null ? String(subscriptionRow.id) : null,
        alreadyRegistered: false,
        emailVerified: subscriptionRow?.email_verified === true,
        watchLink: links.watch_link,
        confirmationLink: links.confirmation_link,
        customField,
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
        subscriptionId: subscriptionRow?.id != null ? String(subscriptionRow.id) : null,
        customField,
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
        subscriptionId: subscriptionRow?.id != null ? String(subscriptionRow.id) : null,
        emailVerified: subscriptionRow?.email_verified === true,
        watchLink: links.watch_link,
        confirmationLink: links.confirmation_link,
        customField,
      }).catch((err) => console.error('public webinar signup notify error', err));

      return json(200, {
        ok: true,
        booked: true,
        already_registered: false,
        quick: wantQuick,
        email_verified: subscriptionRow?.email_verified === true,
        broadcast: {
          id: effectiveBroadcastId,
          title: broadcastContext.title,
          date: effectiveDate,
          webinar_id: broadcastContext.webinarId,
        },
        message: wantQuick
          ? 'You are registered for the soonest available session. Check your email for the WebinarGeek join link — it starts shortly.'
          : 'You are registered. WebinarGeek will email you a confirmation with the join link shortly.',
      });
    }

    return json(405, { error: 'Method not allowed. Use GET ?mode=upcoming or POST ?mode=book.' });
  } catch (err) {
    console.error('hm-public-webinar-schedule error', err);
    return json(500, {
      error: err instanceof Error ? err.message : 'Unexpected server error',
    });
  }
});
