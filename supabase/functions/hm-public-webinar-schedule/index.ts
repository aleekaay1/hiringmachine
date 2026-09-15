// Public webinar self-schedule for cold-email candidates (no staff auth).
// Deploy: supabase functions deploy hm-public-webinar-schedule --project-ref ofhcnsuwrhyvxtvtdunw
// Requires Edge secret: WEBINARGEEK_API_TOKEN
// Optional: WEBINARGEEK_API_BASE_URL, PUBLIC_WEBINAR_GEEK_WEBINAR_ID, PUBLIC_WEBINAR_CUSTOM_FIELD

import { corsHeaders, json, normalizeEmail, str } from '../_shared/hiringMachine.ts';

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
 */
async function resolveJitQuickSlot(
  preferredWebinarId?: string,
): Promise<Record<string, unknown> | null> {
  const webinarsRes = await wgGet('/webinars', { per_page: 50 });
  if (!webinarsRes.ok) return null;
  const webinars = Array.isArray(webinarsRes.json.webinars)
    ? (webinarsRes.json.webinars as Array<Record<string, unknown>>)
    : [];

  const nowMs = Date.now();
  let best: Record<string, unknown> | null = null;
  let bestMs = Number.MAX_SAFE_INTEGER;

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
      if (ms < bestMs) {
        bestMs = ms;
        const period = Number(episode.jit_period_minutes);
        best = {
          id: jitBroadcastId,
          title: str(episode.title || webinar.title) || 'Watch soon',
          date: closestMs != null ? (closestMs > 1e12 ? closestMs / 1000 : closestMs) : Math.floor(ms / 1000),
          webinar_id: webinar.id ?? null,
          episode_id: episode.id ?? null,
          day_label: 'today',
          starts_in_minutes: Math.max(1, Math.round((ms - nowMs) / 60000)),
          jit_period_minutes: Number.isFinite(period) && period > 0 ? period : 5,
          is_jit: true,
          active_jit: true,
        };
      }
    }
  }

  return best;
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

  if (broadcast.cancelled === true) {
    return {
      ok: false as const,
      status: 422,
      error: 'This session was cancelled. Please pick another upcoming time.',
    };
  }
  if (broadcast.has_ended === true) {
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

      if (wantQuick && !broadcastId) {
        const schedule = await loadPublicSchedule();
        if (!schedule.ok) {
          return json(schedule.status, { error: schedule.error });
        }
        if (!schedule.quick) {
          return json(409, {
            error:
              'Watch soon is unavailable right now. Enable Just-in-time on your webinar in WebinarGeek, or pick a time from today’s / tomorrow’s list.',
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

      const [broadcastContext, existingRows] = await Promise.all([
        resolveBroadcastContext(broadcastId, webinarId || undefined),
        findSubscriptionForBroadcast(email, broadcastId),
      ]);

      if (!broadcastContext.ok) {
        return json(broadcastContext.status === 404 ? 404 : broadcastContext.status === 422 ? 422 : 502, {
          error: broadcastContext.error,
        });
      }

      if (existingRows.length > 0) {
        const row = existingRows[0];
        return json(200, {
          ok: true,
          booked: true,
          already_registered: true,
          email_verified: row.email_verified === true,
          broadcast: {
            id: broadcastId,
            title: broadcastContext.title,
            date: broadcastContext.date,
            webinar_id: broadcastContext.webinarId,
          },
          message:
            'You are already registered for this session. Check your inbox for the WebinarGeek confirmation email.',
        });
      }

      let payload = buildSubscriptionPayload({
        email,
        firstname,
        surname,
        phone,
        customField,
        registrationFields: broadcastContext.registrationFields,
      });

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
        return json(502, {
          error: wgErrorMessage(bookRes.json, `WebinarGeek booking failed (${bookRes.status})`),
          source_status: bookRes.status,
        });
      }

      let subscriptionRow = subscriptionRowsFromWgJson(bookRes.json)[0] || null;
      if (!subscriptionRow) {
        const confirmed = await findSubscriptionForBroadcast(email, broadcastId);
        subscriptionRow = confirmed[0] || null;
      }

      return json(200, {
        ok: true,
        booked: true,
        already_registered: false,
        quick: wantQuick,
        email_verified: subscriptionRow?.email_verified === true,
        broadcast: {
          id: broadcastId,
          title: broadcastContext.title,
          date: broadcastContext.date,
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
