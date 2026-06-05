import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  buildBookingIdentitiesForUser,
  isBookingLinkTag,
  parseBookingLinkTag,
  recruiterOwnsBookingLinkSlug,
} from '../_shared/webinarGeekBookingLinks.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
};

const WEBINARGEEK_BASE = (Deno.env.get('WEBINARGEEK_API_BASE_URL')?.trim() || 'https://app.webinargeek.com/api/v2').replace(/\/$/, '');

function deriveInviterSignal(row: Record<string, unknown>): string | null {
  const extraFields = row.extra_fields && typeof row.extra_fields === 'object'
    ? row.extra_fields as Record<string, unknown>
    : null;
  const candidates = [
    row.inviter_name,
    row.invited_by,
    row.invited_by_name,
    row.utm_source,
    row.utm_term,
    row.utm_content,
    row.custom_field,
    row.registration_page_name,
    row.referrer_name,
    row.affiliate_name,
  ];
  for (const v of candidates) {
    const s = String(v || '').trim();
    if (s && s.toLowerCase() !== 'registration_page') return s;
  }
  const source = String(row.registration_source || '').trim();
  if (source && source.toLowerCase() !== 'registration_page') return source;
  if (extraFields) {
    for (const v of Object.values(extraFields)) {
      const s = String(v || '').trim();
      if (s && s.toLowerCase() !== 'registration_page') return s;
    }
  }
  return null;
}

function parseBool(value: string | null): boolean | undefined {
  if (value == null) return undefined;
  if (value === '1' || value.toLowerCase() === 'true') return true;
  if (value === '0' || value.toLowerCase() === 'false') return false;
  return undefined;
}

async function wgRequest(path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; json: Record<string, unknown>; raw: string }> {
  const token = Deno.env.get('WEBINARGEEK_API_TOKEN')?.trim();
  if (!token) throw new Error('Missing WEBINARGEEK_API_TOKEN secret');
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
  let json: Record<string, unknown> = {};
  if (raw.trim()) {
    try {
      json = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      json = { raw_body: raw.slice(0, 500) };
    }
  }
  return { ok: res.ok, status: res.status, json, raw };
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
  return wgRequest(path, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function normalizeLookupEmail(value: string): string {
  return String(value || '').trim().toLowerCase();
}

function subscriptionRowsFromWgJson(json: Record<string, unknown>): Array<Record<string, unknown>> {
  if (Array.isArray(json.subscriptions)) {
    return json.subscriptions as Array<Record<string, unknown>>;
  }
  if (json.subscription && typeof json.subscription === 'object') {
    return [json.subscription as Record<string, unknown>];
  }
  if (json.id != null && json.email != null) {
    return [json];
  }
  return [];
}

function wgErrorMessage(json: Record<string, unknown>, fallback: string): string {
  const title = String(json.title || '').trim();
  const message = String(json.message || json.detail || '').trim();
  const errorRaw = json.error;
  const errorText = typeof errorRaw === 'string'
    ? errorRaw.trim()
    : errorRaw && typeof errorRaw === 'object'
    ? wgErrorMessage(errorRaw as Record<string, unknown>, '')
    : '';
  const code = String(json.code || '').trim();

  const fieldErrors: string[] = [];
  if (Array.isArray(json.errors)) {
    for (const entry of json.errors) {
      if (entry && typeof entry === 'object') {
        const row = entry as Record<string, unknown>;
        const field = String(row.field || row.attribute || '').trim();
        const msg = String(row.message || '').trim();
        if (field && msg) fieldErrors.push(`${field} ${msg}`);
        else if (msg) fieldErrors.push(msg);
      } else {
        const text = String(entry || '').trim();
        if (text) fieldErrors.push(text);
      }
    }
  }

  const parts = [
    title,
    message || errorText,
    fieldErrors.length ? fieldErrors.join('; ') : '',
    code ? `(${code})` : '',
  ].filter(Boolean);

  if (parts.length) return parts.join(': ').replace(/: \(/, ' (');

  if (json.errors && typeof json.errors === 'object' && !Array.isArray(json.errors)) {
    const nested: string[] = [];
    for (const [key, value] of Object.entries(json.errors as Record<string, unknown>)) {
      if (Array.isArray(value)) nested.push(`${key}: ${value.map(String).join(', ')}`);
      else nested.push(`${key}: ${String(value)}`);
    }
    if (nested.length) return nested.join('; ');
  }

  const rawBody = String(json.raw_body || '').trim();
  if (rawBody) return rawBody.slice(0, 240);

  const keys = Object.keys(json).filter((key) => key !== 'ok');
  if (keys.length) {
    try {
      return JSON.stringify(json);
    } catch {
      /* fall through */
    }
  }
  return fallback;
}

type RegistrationFieldRow = {
  name?: string;
  mandatory?: boolean;
  extra_field?: boolean;
  field_options?: Array<{ label?: string }>;
};

function registrationFieldsFromWebinarJson(json: Record<string, unknown>): RegistrationFieldRow[] {
  const fields = json.registration_fields;
  return Array.isArray(fields) ? fields as RegistrationFieldRow[] : [];
}

function buildSubscriptionPayload(input: {
  email: string;
  firstname: string;
  surname: string;
  customField?: string | null;
  registrationFields?: RegistrationFieldRow[];
}): Record<string, unknown> {
  const effectiveSurname = input.surname.trim() || '.';
  const payload: Record<string, unknown> = {
    email: input.email,
    firstname: input.firstname,
    surname: effectiveSurname,
  };
  if (input.customField) payload.custom_field = input.customField;

  const extraFields: Record<string, string> = {};
  for (const field of input.registrationFields || []) {
    const name = String(field.name || '').trim();
    if (!name || !field.mandatory || !field.extra_field) continue;
    const option = field.field_options?.[0]?.label;
    extraFields[name] = String(option || 'Yes');
  }
  if (Object.keys(extraFields).length) payload.extra_fields = extraFields;

  return payload;
}

function subscriptionBroadcastId(row: Record<string, unknown>): string | null {
  const broadcast = row.broadcast && typeof row.broadcast === 'object'
    ? row.broadcast as Record<string, unknown>
    : null;
  const id = broadcast?.id ?? row.broadcast_id;
  return id != null && String(id).trim() ? String(id) : null;
}

const WG_LINK_CATALOG_ID = 'default';
const WG_BOOKING_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

type CachedBookingIdentity = {
  tag: string;
  channel: string;
  slug: string;
  label: string;
  source: string;
};

function parseCachedIdentities(raw: unknown): CachedBookingIdentity[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row) => row && typeof row === 'object')
    .map((row) => row as Record<string, unknown>)
    .filter((row) => typeof row.tag === 'string' && row.tag.trim())
    .map((row) => ({
      tag: String(row.tag),
      channel: String(row.channel || ''),
      slug: String(row.slug || ''),
      label: String(row.label || row.tag),
      source: String(row.source || 'cached'),
    }));
}

function cacheIsFresh(syncedAt: string | null | undefined, maxAgeMs = WG_BOOKING_CACHE_MAX_AGE_MS): boolean {
  if (!syncedAt) return false;
  const ms = Date.parse(syncedAt);
  if (!Number.isFinite(ms)) return false;
  return Date.now() - ms <= maxAgeMs;
}

async function loadUserBookingIdentitiesCache(
  admin: ReturnType<typeof createClient>,
  userId: string,
): Promise<{ identities: CachedBookingIdentity[]; syncedAt: string | null } | null> {
  try {
    const { data, error } = await admin
      .from('webinar_geek_user_booking_identities')
      .select('identities, synced_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) return null;
    return {
      identities: parseCachedIdentities((data as { identities?: unknown } | null)?.identities),
      syncedAt: String((data as { synced_at?: string } | null)?.synced_at || '') || null,
    };
  } catch {
    return null;
  }
}

async function saveUserBookingIdentitiesCache(
  admin: ReturnType<typeof createClient>,
  userId: string,
  identities: CachedBookingIdentity[],
): Promise<void> {
  try {
    const nowIso = new Date().toISOString();
    await admin.from('webinar_geek_user_booking_identities').upsert({
      user_id: userId,
      identities,
      synced_at: nowIso,
    }, { onConflict: 'user_id' });
  } catch (err) {
    console.error('webinar_geek_user_booking_identities upsert failed:', err);
  }
}

async function loadRegistrationLinkCatalog(
  admin: ReturnType<typeof createClient>,
): Promise<{ tags: string[]; syncedAt: string | null } | null> {
  try {
    const { data, error } = await admin
      .from('webinar_geek_registration_link_catalog')
      .select('tags, synced_at')
      .eq('id', WG_LINK_CATALOG_ID)
      .maybeSingle();
    if (error) return null;
    const tags = Array.isArray((data as { tags?: unknown } | null)?.tags)
      ? ((data as { tags: unknown[] }).tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean))
      : [];
    return {
      tags,
      syncedAt: String((data as { synced_at?: string } | null)?.synced_at || '') || null,
    };
  } catch {
    return null;
  }
}

async function saveRegistrationLinkCatalog(
  admin: ReturnType<typeof createClient>,
  tags: string[],
): Promise<void> {
  try {
    const nowIso = new Date().toISOString();
    await admin.from('webinar_geek_registration_link_catalog').upsert({
      id: WG_LINK_CATALOG_ID,
      tags,
      synced_at: nowIso,
    }, { onConflict: 'id' });
  } catch (err) {
    console.error('webinar_geek_registration_link_catalog upsert failed:', err);
  }
}

async function scanObservedRegistrationLinkTags(): Promise<string[]> {
  const observedTags = new Set<string>();
  const subscriptionsScan = await wgGetAllSubscriptions(
    { per_page: 250, nested_resources: 'broadcast,webinar' },
    { maxPages: 20 },
  );
  if (!subscriptionsScan.ok) return [];
  for (const row of subscriptionsScan.rows) {
    const customField = String(row.custom_field || '').trim();
    if (isBookingLinkTag(customField)) observedTags.add(customField.toLowerCase());
    const pageName = String(row.registration_page_name || '').trim();
    if (isBookingLinkTag(pageName)) observedTags.add(pageName.toLowerCase());
  }
  return [...observedTags].sort();
}

async function resolveObservedRegistrationLinkTags(
  admin: ReturnType<typeof createClient>,
  forceRefresh: boolean,
): Promise<string[]> {
  const catalog = await loadRegistrationLinkCatalog(admin);
  if (!forceRefresh && catalog && cacheIsFresh(catalog.syncedAt) && catalog.tags.length) {
    return catalog.tags;
  }
  const scanned = await scanObservedRegistrationLinkTags();
  if (scanned.length) await saveRegistrationLinkCatalog(admin, scanned);
  return scanned.length ? scanned : (catalog?.tags ?? []);
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
      json: broadcastRes.json,
    };
  }

  const broadcast = broadcastRes.json;
  const nestedWebinar = broadcast.webinar && typeof broadcast.webinar === 'object'
    ? broadcast.webinar as Record<string, unknown>
    : null;
  const resolvedWebinarId = String(
    webinarIdHint || nestedWebinar?.id || broadcast.webinar_id || '',
  ).trim() || null;

  let registrationFields: RegistrationFieldRow[] = registrationFieldsFromWebinarJson(broadcast);
  if (!registrationFields.length && nestedWebinar) {
    registrationFields = registrationFieldsFromWebinarJson(nestedWebinar);
  }
  if (!registrationFields.length && resolvedWebinarId) {
    const webinarRes = await wgGet(`/webinars/${encodeURIComponent(resolvedWebinarId)}`);
    if (webinarRes.ok) registrationFields = registrationFieldsFromWebinarJson(webinarRes.json);
  }

  const cancelled = broadcast.cancelled === true;
  const hasEnded = broadcast.has_ended === true;
  if (cancelled) {
    return {
      ok: false as const,
      status: 422,
      error: 'This broadcast was cancelled in WebinarGeek. Pick another upcoming session.',
      json: broadcastRes.json,
    };
  }
  if (hasEnded) {
    return {
      ok: false as const,
      status: 422,
      error: 'This broadcast has already ended. Pick an upcoming session from the list.',
      json: broadcastRes.json,
    };
  }

  return {
    ok: true as const,
    broadcast,
    webinarId: resolvedWebinarId,
    registrationFields,
  };
}

async function attemptBroadcastBooking(
  broadcastId: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; json: Record<string, unknown>; raw: string; endpoint: string }> {
  const endpoint = `/broadcasts/${encodeURIComponent(broadcastId)}/subscriptions`;
  const res = await wgPost(endpoint, payload);
  return { ...res, endpoint };
}

function simplifySubscriptionRow(row: Record<string, unknown>) {
  const broadcast = row.broadcast && typeof row.broadcast === 'object'
    ? row.broadcast as Record<string, unknown>
    : null;
  const webinar = row.webinar && typeof row.webinar === 'object'
    ? row.webinar as Record<string, unknown>
    : null;
  return {
    id: row.id ?? null,
    email: row.email ?? null,
    firstname: row.firstname ?? null,
    surname: row.surname ?? null,
    email_verified: row.email_verified === true,
    watched: row.watched === true,
    custom_field: row.custom_field ?? null,
    registration_source: row.registration_source ?? null,
    created_at: row.created_at ?? null,
    broadcast_id: broadcast?.id ?? row.broadcast_id ?? null,
    broadcast_title: broadcast?.title ?? broadcast?.name ?? null,
    broadcast_date: broadcast?.date ?? null,
    webinar_id: webinar?.id ?? row.webinar_id ?? null,
    webinar_title: webinar?.title ?? webinar?.name ?? null,
  };
}

async function findSubscriptionForBroadcast(
  email: string,
  broadcastId: string,
): Promise<Array<Record<string, unknown>>> {
  const normalized = normalizeLookupEmail(email);
  if (!normalized || !broadcastId) return [];

  const res = await wgGet('/subscriptions', {
    email: normalized,
    broadcast_id: broadcastId,
    per_page: 10,
    nested_resources: 'broadcast,webinar',
  });
  if (!res.ok) return [];

  return subscriptionRowsFromWgJson(res.json).filter(
    (row) => subscriptionBroadcastId(row) === broadcastId,
  );
}

async function findSubscriptionsByEmail(email: string): Promise<Array<Record<string, unknown>>> {
  const normalized = normalizeLookupEmail(email);
  if (!normalized) return [];

  const nested = { nested_resources: 'broadcast,webinar', per_page: 50 };
  const passes: Array<Record<string, string | number | boolean | undefined>> = [
    { ...nested, email: normalized },
    { ...nested, email: normalized, email_verified: false },
    { ...nested, email: normalized, include_unverified: true },
  ];

  const merged = new Map<string, Record<string, unknown>>();
  for (const params of passes) {
    const res = await wgGet('/subscriptions', params);
    if (!res.ok) continue;
    for (const row of subscriptionRowsFromWgJson(res.json)) {
      const id = row.id != null ? String(row.id) : '';
      const key = id || `${String(row.email || '')}|${String(row.created_at || '')}`;
      if (!merged.has(key)) merged.set(key, row);
    }
    if (merged.size > 0) break;
  }

  if (merged.size === 0) {
    const recent = await wgGetAllSubscriptions(
      { per_page: 250, nested_resources: 'broadcast,webinar' },
      { maxPages: 10, sinceMs: Date.now() - 45 * 24 * 60 * 60 * 1000 },
    );
    if (recent.ok) {
      for (const row of recent.rows) {
        if (normalizeLookupEmail(String(row.email || '')) !== normalized) continue;
        const id = row.id != null ? String(row.id) : '';
        const key = id || `${String(row.email || '')}|${String(row.created_at || '')}`;
        if (!merged.has(key)) merged.set(key, row);
      }
    }
  }

  return [...merged.values()];
}

function upcomingBroadcastRows(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const nowMs = Date.now();
  return rows
    .map((row) => {
      const ms = unixMsFromField(row.date);
      return { row, ms };
    })
    .filter(({ row, ms }) => {
      if (row.cancelled === true) return false;
      if (row.has_ended === true) return false;
      if (ms == null) return false;
      return ms >= nowMs;
    })
    .sort((a, b) => (a.ms ?? Number.MAX_SAFE_INTEGER) - (b.ms ?? Number.MAX_SAFE_INTEGER))
    .map(({ row }) => row);
}

function unixMsFromField(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1e12 ? n : n * 1000;
}

function subscriptionRowHrScheduledMs(row: Record<string, unknown>): number | null {
  return unixMsFromField(row.created_at);
}

function subscriptionRowWebinarSessionMs(row: Record<string, unknown>): number | null {
  const broadcast = row.broadcast && typeof row.broadcast === 'object' ? row.broadcast as Record<string, unknown> : null;
  return unixMsFromField(broadcast?.date);
}

/** Legacy: latest known event time (watch / session). */
function subscriptionRowEventMs(row: Record<string, unknown>): number | null {
  const candidates = [
    subscriptionRowWebinarSessionMs(row),
    subscriptionRowHrScheduledMs(row),
    unixMsFromField(row.watched_true_set_at),
  ];
  let best: number | null = null;
  for (const ms of candidates) {
    if (ms == null) continue;
    if (best == null || ms > best) best = ms;
  }
  return best;
}

function parseYmdToUtcStartMs(ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
}

function parseYmdToUtcEndMs(ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999);
}

function msInWindow(ms: number, sinceMs: number | null, untilMs: number | null): boolean {
  if (sinceMs != null && ms < sinceMs) return false;
  if (untilMs != null && ms > untilMs) return false;
  return true;
}

/** Include row if HR scheduled or webinar session falls in the fetch window. */
function rowInWindow(row: Record<string, unknown>, sinceMs: number | null, untilMs: number | null): boolean {
  if (sinceMs == null && untilMs == null) return true;
  const times = [
    subscriptionRowHrScheduledMs(row),
    subscriptionRowWebinarSessionMs(row),
  ].filter((n): n is number => n != null);
  if (times.length === 0) return false;
  return times.some((ms) => msInWindow(ms, sinceMs, untilMs));
}

/** Default list excludes people who have not confirmed email (WG docs). Prefer primary row on id clash (watch stats). */
function mergeSubscriptionsPreferFirst(
  primary: Array<Record<string, unknown>>,
  secondary: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const byId = new Map<string, Record<string, unknown>>();
  for (const r of primary) {
    const id = r.id;
    if (id == null || id === '') continue;
    byId.set(String(id), r);
  }
  for (const r of secondary) {
    const id = r.id;
    if (id == null || id === '') continue;
    const key = String(id);
    if (!byId.has(key)) byId.set(key, r);
  }
  return [...byId.values()];
}

async function wgGetAllSubscriptionsOnePass(
  params: Record<string, string | number | boolean | undefined>,
  opts?: { sinceMs?: number | null; untilMs?: number | null; maxPages?: number },
) {
  const perPage = Math.min(1000, Math.max(50, Number(params.per_page || 250)));
  const sinceMs = opts?.sinceMs ?? null;
  const untilMs = opts?.untilMs ?? null;
  const maxPages = Math.min(500, Math.max(1, Number(opts?.maxPages ?? 40)));
  const rows: Array<Record<string, unknown>> = [];
  let page = 1;
  let totalPages = 1;
  for (let guard = 0; guard < maxPages; guard++) {
    const res = await wgGet('/subscriptions', {
      ...params,
      per_page: perPage,
      page,
    });
    if (!res.ok) return { ...res, rows, pagesFetched: page - 1, totalPages };
    const pageRows = Array.isArray(res.json.subscriptions)
      ? (res.json.subscriptions as Array<Record<string, unknown>>)
      : [];
    const filtered = sinceMs != null || untilMs != null
      ? pageRows.filter((r) => rowInWindow(r, sinceMs, untilMs))
      : pageRows;
    rows.push(...filtered);

    const pageTimes = pageRows.map(subscriptionRowEventMs).filter((n): n is number => n != null);
    const oldestOnPage = pageTimes.length ? Math.min(...pageTimes) : null;
    const newestOnPage = pageTimes.length ? Math.max(...pageTimes) : null;

    const pages = (res.json.pages && typeof res.json.pages === 'object')
      ? (res.json.pages as Record<string, unknown>)
      : {};
    totalPages = Number(pages.total_pages || totalPages || 1);
    const nextLink = typeof pages.next === 'string' ? pages.next : null;

    if (sinceMs != null && pageRows.length > 0 && oldestOnPage != null && newestOnPage != null && newestOnPage < sinceMs) {
      break;
    }

    if (!nextLink || page >= totalPages) {
      return { ok: true as const, status: res.status, json: { ...res.json, subscriptions: rows }, rows, pagesFetched: page, totalPages };
    }
    page += 1;
  }
  return { ok: true as const, status: 200, json: { subscriptions: rows }, rows, pagesFetched: page - 1, totalPages };
}

/**
 * Fetches subscriptions and merges an extra pass with `email_verified=false` so invited people who have not
 * confirmed their email in WebinarGeek still appear (default GET list omits them per WG docs).
 * Set WEBINARGEEK_SUBSCRIPTIONS_SKIP_UNVERIFIED_PASS=1 to disable the extra pass (fewer API calls).
 */
async function wgGetAllSubscriptions(
  params: Record<string, string | number | boolean | undefined>,
  opts?: { sinceMs?: number | null; untilMs?: number | null; maxPages?: number },
) {
  const primary = await wgGetAllSubscriptionsOnePass(params, opts);
  if (!primary.ok) return { ...primary, unverified_pass: 'not_applicable' };

  const skipExtra = Deno.env.get('WEBINARGEEK_SUBSCRIPTIONS_SKIP_UNVERIFIED_PASS') === '1';
  if (skipExtra) {
    return { ...primary, unverified_pass: 'skipped_env' };
  }

  if (params.email_verified === false) {
    return { ...primary, unverified_pass: 'not_applicable' };
  }

  let secondary = await wgGetAllSubscriptionsOnePass({ ...params, email_verified: false }, opts);
  let unverifiedStrategy: 'email_verified_false' | 'include_unverified_true' = 'email_verified_false';
  if (!secondary.ok) {
    secondary = await wgGetAllSubscriptionsOnePass({ ...params, include_unverified: true }, opts);
    unverifiedStrategy = 'include_unverified_true';
  }
  if (!secondary.ok) {
    return {
      ...primary,
      unverified_pass: 'failed',
      pages_fetched_unverified: secondary.pagesFetched ?? 0,
    };
  }

  const mergedRows = mergeSubscriptionsPreferFirst(primary.rows, secondary.rows);
  if (mergedRows.length === primary.rows.length) {
    return {
      ...primary,
      unverified_pass: 'skipped_duplicate',
      pages_fetched_unverified: secondary.pagesFetched ?? 0,
      unverified_strategy: unverifiedStrategy,
    };
  }

  return {
    ok: true,
    status: primary.status,
    json: { ...primary.json, subscriptions: mergedRows },
    rows: mergedRows,
    pagesFetched: primary.pagesFetched,
    totalPages: Math.max(primary.totalPages ?? 1, secondary.totalPages ?? 1),
    unverified_pass: 'ok',
    pages_fetched_unverified: secondary.pagesFetched ?? 0,
    unverified_strategy: unverifiedStrategy,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Invalid or expired session' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const url = new URL(req.url);
    const mode = (url.searchParams.get('mode') || 'dashboard').trim();

    if (req.method === 'GET' && mode === 'health') {
      const ping = await wgGet('/account');
      return new Response(JSON.stringify({
        ok: ping.ok,
        status: ping.status,
        connected: ping.ok,
        error: ping.ok ? null : (ping.json.error || ping.json.message || 'WebinarGeek request failed'),
      }), {
        status: ping.ok ? 200 : 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'GET' && mode === 'verify') {
      const email = normalizeLookupEmail(url.searchParams.get('email') || '');
      if (!email) {
        return new Response(JSON.stringify({ error: 'Missing email query parameter.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const rows = await findSubscriptionsByEmail(email);
      const simplified = rows.map(simplifySubscriptionRow);
      const verified = simplified.some((row) => row.email_verified === true);
      const scheduled = simplified.length > 0;
      const status = !scheduled ? 'not_found' : verified ? 'verified_scheduled' : 'pending_verification';
      return new Response(JSON.stringify({
        ok: true,
        email,
        found: scheduled,
        verified,
        scheduled,
        status,
        subscriptions: simplified,
        checked_at: new Date().toISOString(),
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'GET' && mode === 'upcoming-broadcasts') {
      const webinarId = url.searchParams.get('webinar_id')?.trim();
      const broadcastsRes = await wgGet('/broadcasts', webinarId ? { webinar_id: webinarId, per_page: 100 } : { per_page: 100 });
      if (!broadcastsRes.ok) {
        return new Response(JSON.stringify({
          error: String(broadcastsRes.json.error || broadcastsRes.json.message || 'Unable to load broadcasts'),
          source_status: broadcastsRes.status,
        }), {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const rawRows = Array.isArray(broadcastsRes.json.broadcasts)
        ? broadcastsRes.json.broadcasts as Array<Record<string, unknown>>
        : [];
      const upcoming = upcomingBroadcastRows(rawRows).slice(0, 40).map((row) => ({
        id: row.id ?? null,
        title: row.title ?? row.name ?? null,
        date: row.date ?? null,
        webinar_id: row.webinar_id ?? null,
        subscriptions_count: row.subscriptions_count ?? null,
      }));
      return new Response(JSON.stringify({ ok: true, broadcasts: upcoming }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'GET' && mode === 'booking-identities') {
      const forceRefresh = url.searchParams.get('refresh') === '1';
      const profileRes = await admin
        .from('user_profiles')
        .select('full_name, email')
        .eq('user_id', user.id)
        .maybeSingle();
      const userEmail = String((profileRes.data as { email?: string } | null)?.email || user.email || '').trim();
      const userFullName = String((profileRes.data as { full_name?: string } | null)?.full_name || '').trim();

      let settingsTag = '';
      try {
        const { data: settingsRow } = await admin
          .from('pipeline_user_call_settings')
          .select('webinar_geek_custom_field')
          .eq('user_id', user.id)
          .maybeSingle();
        settingsTag = String((settingsRow as { webinar_geek_custom_field?: string } | null)?.webinar_geek_custom_field || '').trim();
      } catch {
        // Column may not exist yet before migration.
      }

      if (!forceRefresh) {
        const userCache = await loadUserBookingIdentitiesCache(admin, user.id);
        if (userCache && cacheIsFresh(userCache.syncedAt) && userCache.identities.length) {
          return new Response(JSON.stringify({
            ok: true,
            user_email: userEmail || null,
            user_name: userFullName || null,
            identities: userCache.identities,
            from_cache: true,
            checked_at: userCache.syncedAt,
          }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      const observedTags = await resolveObservedRegistrationLinkTags(admin, forceRefresh);
      const identities = buildBookingIdentitiesForUser({
        email: userEmail,
        fullName: userFullName,
        observedTags,
        settingsTag,
      });

      await saveUserBookingIdentitiesCache(admin, user.id, identities);

      return new Response(JSON.stringify({
        ok: true,
        user_email: userEmail || null,
        user_name: userFullName || null,
        identities,
        from_cache: false,
        observed_link_count: observedTags.length,
        checked_at: new Date().toISOString(),
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'GET' && mode === 'dashboard') {
      const webinarId = url.searchParams.get('webinar_id')?.trim();
      const broadcastId = url.searchParams.get('broadcast_id')?.trim();
      const perPage = Number(url.searchParams.get('per_page') || '250');
      const watched = parseBool(url.searchParams.get('watched_webinar'));
      const watchedLive = parseBool(url.searchParams.get('watched_live'));
      const watchedReplay = parseBool(url.searchParams.get('watched_replay'));
      const since = url.searchParams.get('since')?.trim() || '';
      const until = url.searchParams.get('until')?.trim() || '';
      const includeCatalog = url.searchParams.get('include_catalog') !== '0';
      const maxPages = Math.min(80, Math.max(1, Number(url.searchParams.get('max_pages') || '20')));

      const sinceMs = since ? parseYmdToUtcStartMs(since) : null;
      const untilMs = until ? parseYmdToUtcEndMs(until) : null;

      const account = await wgGet('/account');
      const webinars = includeCatalog
        ? await wgGet('/webinars')
        : { ok: true as const, status: 200, json: { webinars: [] as unknown[] } };
      const broadcasts = includeCatalog
        ? await wgGet('/broadcasts', webinarId ? { webinar_id: webinarId } : undefined)
        : { ok: true as const, status: 200, json: { broadcasts: [] as unknown[] } };

      const subscriptions = await wgGetAllSubscriptions({
        webinar_id: webinarId || undefined,
        broadcast_id: broadcastId || undefined,
        watched_webinar: watched,
        watched_live: watchedLive,
        watched_replay: watchedReplay,
        nested_resources: 'broadcast,episode,webinar',
        per_page: Number.isFinite(perPage) ? perPage : 250,
      }, { sinceMs, untilMs, maxPages });

      const selectedWebinar = webinarId ? await wgGet(`/webinars/${webinarId}`) : null;
      const selectedBroadcast = broadcastId ? await wgGet(`/broadcasts/${broadcastId}`) : null;

      const response = {
        ok: true,
        generated_at: new Date().toISOString(),
        filters: {
          webinar_id: webinarId || null,
          broadcast_id: broadcastId || null,
          watched_webinar: watched ?? null,
          watched_live: watchedLive ?? null,
          watched_replay: watchedReplay ?? null,
          since: since || null,
          until: until || null,
          include_catalog: includeCatalog,
          max_pages: maxPages,
        },
        account: account.json,
        webinars: webinars.json,
        broadcasts: broadcasts.json,
        subscriptions: subscriptions.json,
        selected_webinar: selectedWebinar?.json || null,
        selected_broadcast: selectedBroadcast?.json || null,
        health: {
          account_ok: account.ok,
          webinars_ok: webinars.ok,
          broadcasts_ok: broadcasts.ok,
          subscriptions_ok: subscriptions.ok,
        },
        subscriptions_pagination: {
          pages_fetched: subscriptions.pagesFetched ?? 1,
          total_pages: subscriptions.totalPages ?? 1,
          total_rows: Array.isArray((subscriptions.json as Record<string, unknown>).subscriptions)
            ? ((subscriptions.json as Record<string, unknown>).subscriptions as Array<unknown>).length
            : 0,
          unverified_email_pass: (subscriptions as { unverified_pass?: string }).unverified_pass ?? null,
          pages_fetched_unverified_pass: (subscriptions as { pages_fetched_unverified?: number }).pages_fetched_unverified ?? null,
          unverified_merge_strategy: (subscriptions as { unverified_strategy?: string }).unverified_strategy ?? null,
        },
      };
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'POST' && mode === 'sync') {
      const body = (await req.json().catch(() => ({}))) as {
        webinar_id?: string;
        broadcast_id?: string;
        per_page?: number;
        since?: string;
        until?: string;
        max_pages?: number;
      };
      const webinarId = String(body.webinar_id || '').trim();
      const broadcastId = String(body.broadcast_id || '').trim();
      const perPage = Number(body.per_page || 250);
      const since = String(body.since || '').trim();
      const until = String(body.until || '').trim();
      const maxPages = Math.min(80, Math.max(1, Number(body.max_pages || 25)));
      const sinceMs = since ? parseYmdToUtcStartMs(since) : null;
      const untilMs = until ? parseYmdToUtcEndMs(until) : null;

      const subscriptions = await wgGetAllSubscriptions({
        webinar_id: webinarId || undefined,
        broadcast_id: broadcastId || undefined,
        nested_resources: 'broadcast,episode,webinar',
        per_page: Number.isFinite(perPage) ? perPage : 250,
      }, { sinceMs, untilMs, maxPages });
      if (!subscriptions.ok) {
        return new Response(JSON.stringify({
          error: String(subscriptions.json.error || subscriptions.json.message || 'Unable to fetch WebinarGeek subscriptions'),
          source_status: subscriptions.status,
        }), {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const subRows = Array.isArray(subscriptions.json.subscriptions)
        ? subscriptions.json.subscriptions as Array<Record<string, unknown>>
        : [];

      const broadcastsOverview = await wgGet('/broadcasts', webinarId ? { webinar_id: webinarId } : undefined);
      const broadcastRows = Array.isArray(broadcastsOverview.json.broadcasts)
        ? broadcastsOverview.json.broadcasts as Array<Record<string, unknown>>
        : [];
      const broadcastSubscriptionsTotal = broadcastRows.reduce((s, b) => s + Number(b.subscriptions_count || 0), 0);
      const estimatedUnverifiedOrPending = Math.max(0, broadcastSubscriptionsTotal - subRows.length);

      const { data: candidates, error: candErr } = await admin
        .from('candidates')
        .select('id,email,first_name,last_name,admin_data')
        .limit(5000);
      if (candErr) throw candErr;

      const byEmail = new Map<string, Record<string, unknown>>();
      const byName = new Map<string, Record<string, unknown>>();
      for (const c of candidates || []) {
        const email = String((c as Record<string, unknown>).email || '').trim().toLowerCase();
        const first = String((c as Record<string, unknown>).first_name || '').trim().toLowerCase();
        const last = String((c as Record<string, unknown>).last_name || '').trim().toLowerCase();
        if (email) byEmail.set(email, c as Record<string, unknown>);
        if (first || last) byName.set(`${first}|${last}`, c as Record<string, unknown>);
      }

      const matchedByCandidate = new Map<string, Array<Record<string, unknown>>>();
      const unmatched: Array<Record<string, unknown>> = [];
      let emailMatches = 0;
      let nameMatches = 0;

      for (const row of subRows) {
        const email = String(row.email || '').trim().toLowerCase();
        const first = String(row.firstname || '').trim().toLowerCase();
        const last = String(row.surname || '').trim().toLowerCase();
        let candidate = byEmail.get(email);
        let matchMethod: 'email' | 'name' | null = null;
        if (candidate) {
          matchMethod = 'email';
          emailMatches += 1;
        } else {
          candidate = byName.get(`${first}|${last}`);
          if (candidate) {
            matchMethod = 'name';
            nameMatches += 1;
          }
        }
        if (!candidate) {
          unmatched.push({
            subscription_id: row.id || null,
            email: row.email || null,
            firstname: row.firstname || null,
            surname: row.surname || null,
          });
          continue;
        }
        const cid = String(candidate.id);
        if (!matchedByCandidate.has(cid)) matchedByCandidate.set(cid, []);
        matchedByCandidate.get(cid)!.push({ ...row, _match_method: matchMethod });
      }

      let updatedCandidates = 0;
      const nowIso = new Date().toISOString();
      for (const c of candidates || []) {
        const cid = String((c as Record<string, unknown>).id || '');
        const rows = matchedByCandidate.get(cid);
        if (!rows || rows.length === 0) continue;

        const watchedCount = rows.filter((r) => r.watched === true).length;
        const watchedLiveCount = rows.filter((r) => r.watched_live === true).length;
        const watchedReplayCount = rows.filter((r) => r.watched_replay === true).length;
        const totalWatchDuration = rows.reduce((s, r) => s + Number(r.watch_duration || 0), 0);
        const ips = Array.from(new Set(rows.map((r) => String(r.registration_ip || '').trim()).filter(Boolean)));
        const sources = Array.from(new Set(rows.map((r) => String(r.registration_source || '').trim()).filter(Boolean)));
        const inviterSignals = Array.from(new Set(rows.map((r) => deriveInviterSignal(r)).filter((v): v is string => Boolean(v))));

        const webinarGeekData = {
          synced_at: nowIso,
          source: 'webinargeek',
          total_subscriptions: rows.length,
          watched_count: watchedCount,
          watched_live_count: watchedLiveCount,
          watched_replay_count: watchedReplayCount,
          total_watch_duration: totalWatchDuration,
          latest_watch_start: rows
            .map((r) => Number(r.watch_start || 0))
            .filter((n) => Number.isFinite(n) && n > 0)
            .sort((a, b) => b - a)[0] ?? null,
          latest_watch_end: rows
            .map((r) => Number(r.watch_end || 0))
            .filter((n) => Number.isFinite(n) && n > 0)
            .sort((a, b) => b - a)[0] ?? null,
          registration_ips: ips,
          registration_sources: sources,
          inviter_signals: inviterSignals,
          records: rows.map((r) => ({
            subscription_id: r.id || null,
            email: r.email || null,
            firstname: r.firstname || null,
            surname: r.surname || null,
            watched: r.watched === true,
            watched_live: r.watched_live === true,
            watched_replay: r.watched_replay === true,
            watch_duration: Number(r.watch_duration || 0),
            watch_duration_live: Number(r.watch_duration_live || 0),
            watch_duration_replay: Number(r.watch_duration_replay || 0),
            watched_true_set_at: r.watched_true_set_at || null,
            watch_start: r.watch_start || null,
            watch_end: r.watch_end || null,
            registration_source: r.registration_source || null,
            custom_field: r.custom_field || null,
            extra_fields: r.extra_fields || null,
            inviter_signal: deriveInviterSignal(r),
            registration_ip: r.registration_ip || null,
            unsubscribed: r.unsubscribed === true,
            broadcast: r.broadcast || null,
            webinar: r.webinar || null,
            episode: r.episode || null,
            created_at: r.created_at || null,
            match_method: r._match_method || null,
          })),
        };

        const existingAdmin = (c as Record<string, unknown>).admin_data && typeof (c as Record<string, unknown>).admin_data === 'object'
          ? ((c as Record<string, unknown>).admin_data as Record<string, unknown>)
          : {};
        const nextAdmin = {
          ...existingAdmin,
          webinarGeek: webinarGeekData,
        };
        const { error: upErr } = await admin.from('candidates').update({ admin_data: nextAdmin }).eq('id', cid);
        if (upErr) throw upErr;
        updatedCandidates += 1;
      }

      return new Response(JSON.stringify({
        ok: true,
        synced_at: nowIso,
        filters: {
          webinar_id: webinarId || null,
          broadcast_id: broadcastId || null,
          per_page: perPage,
          since: since || null,
          until: until || null,
          max_pages: maxPages,
          pages_fetched: subscriptions.pagesFetched ?? 1,
          total_pages: subscriptions.totalPages ?? 1,
        },
        total_subscriptions: subRows.length,
        broadcast_subscriptions_total: broadcastSubscriptionsTotal,
        estimated_unverified_or_pending: estimatedUnverifiedOrPending,
        unverified_email_pass: (subscriptions as { unverified_pass?: string }).unverified_pass ?? null,
        pages_fetched_unverified_pass: (subscriptions as { pages_fetched_unverified?: number }).pages_fetched_unverified ?? null,
        unverified_merge_strategy: (subscriptions as { unverified_strategy?: string }).unverified_strategy ?? null,
        matched_subscriptions: Array.from(matchedByCandidate.values()).reduce((s, rows) => s + rows.length, 0),
        unmatched_subscriptions: unmatched.length,
        matched_candidates: matchedByCandidate.size,
        updated_candidates: updatedCandidates,
        match_breakdown: {
          email_matches: emailMatches,
          name_matches: nameMatches,
        },
        unmatched_samples: unmatched.slice(0, 25),
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'POST' && mode === 'book') {
      const body = (await req.json().catch(() => ({}))) as {
        email?: string;
        firstname?: string;
        surname?: string;
        broadcast_id?: string | number;
        webinar_id?: string | number;
        custom_field?: string;
        candidate_id?: string;
      };
      const email = normalizeLookupEmail(body.email || '');
      const firstname = String(body.firstname || '').trim();
      const surname = String(body.surname || '').trim();
      const broadcastId = String(body.broadcast_id || '').trim();
      const webinarId = String(body.webinar_id || '').trim();
      const customField = String(body.custom_field || '').trim();
      const candidateId = String(body.candidate_id || '').trim() || null;

      if (!email || !firstname || !broadcastId) {
        return new Response(JSON.stringify({ error: 'email, firstname, and broadcast_id are required.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const [profileRes, settingsRow, broadcastContext, existingRows] = await Promise.all([
        admin.from('user_profiles').select('full_name, email').eq('user_id', user.id).maybeSingle(),
        admin.from('pipeline_user_call_settings').select('webinar_geek_custom_field').eq('user_id', user.id).maybeSingle().catch(() => ({ data: null })),
        resolveBroadcastContext(broadcastId, webinarId || undefined),
        findSubscriptionForBroadcast(email, broadcastId),
      ]);

      const bookedByLabel =
        String((profileRes.data as { full_name?: string } | null)?.full_name || '').trim() ||
        String(user.email || '').trim() ||
        user.id;
      const userEmail = String((profileRes.data as { email?: string } | null)?.email || user.email || '').trim();
      const userFullName = String((profileRes.data as { full_name?: string } | null)?.full_name || '').trim();
      const settingsCustomField = String((settingsRow.data as { webinar_geek_custom_field?: string } | null)?.webinar_geek_custom_field || '').trim();

      let effectiveCustomField: string | null = null;
      const requestedTag = customField || settingsCustomField || '';
      const parsedTag = parseBookingLinkTag(requestedTag);
      if (!parsedTag) {
        return new Response(JSON.stringify({
          error: 'Select a Cooper/RMS registration link to book as.',
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (!recruiterOwnsBookingLinkSlug(parsedTag.slugKey, userFullName, userEmail)) {
        return new Response(JSON.stringify({
          error: 'That registration link does not match your account.',
        }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      effectiveCustomField = parsedTag.tag;

      if (!broadcastContext.ok) {
        return new Response(JSON.stringify({
          error: broadcastContext.error,
          source_status: broadcastContext.status,
          wg_details: broadcastContext.json,
        }), {
          status: broadcastContext.status === 404 ? 404 : 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const resolvedWebinarId = broadcastContext.webinarId || webinarId || null;
      const alreadyRegistered = existingRows.length > 0;
      if (alreadyRegistered) {
        const simplified = existingRows.map(simplifySubscriptionRow);
        return new Response(JSON.stringify({
          ok: true,
          booked: true,
          already_registered: true,
          subscription: simplified[0] || null,
          email_verified: simplified.some((row) => row.email_verified === true),
          custom_field: effectiveCustomField,
          booked_by: bookedByLabel,
          message: 'Already registered for this session in WebinarGeek.',
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const subscriptionPayload = buildSubscriptionPayload({
        email,
        firstname,
        surname,
        customField: effectiveCustomField,
        registrationFields: broadcastContext.registrationFields,
      });

      let bookRes = await attemptBroadcastBooking(broadcastId, subscriptionPayload);
      let usedPayload = subscriptionPayload;
      let droppedCustomField = false;

      if (!bookRes.ok && bookRes.status === 422 && effectiveCustomField) {
        const withoutTag = { ...subscriptionPayload };
        delete withoutTag.custom_field;
        const retry = await attemptBroadcastBooking(broadcastId, withoutTag);
        if (retry.ok) {
          bookRes = retry;
          usedPayload = withoutTag;
          droppedCustomField = true;
          effectiveCustomField = null;
        }
      }

      if (!bookRes.ok && bookRes.status === 422 && !surname.trim()) {
        const withSurname = buildSubscriptionPayload({
          email,
          firstname,
          surname: '.',
          customField: droppedCustomField ? null : effectiveCustomField,
          registrationFields: broadcastContext.registrationFields,
        });
        const retry = await attemptBroadcastBooking(broadcastId, withSurname);
        if (retry.ok) {
          bookRes = retry;
          usedPayload = withSurname;
        }
      }

      const subscriptionRow = bookRes.ok
        ? subscriptionRowsFromWgJson(bookRes.json)[0] || null
        : null;

      const auditRow = {
        booked_by_user_id: user.id,
        booked_by_label: bookedByLabel,
        candidate_email: email,
        candidate_first_name: firstname,
        candidate_last_name: surname || null,
        candidate_id: candidateId,
        broadcast_id: broadcastId,
        webinar_id: resolvedWebinarId,
        custom_field: effectiveCustomField,
        wg_subscription_id: subscriptionRow?.id != null ? String(subscriptionRow.id) : null,
        email_verified: subscriptionRow?.email_verified === true,
        status: bookRes.ok ? 'booked' : 'failed',
        error_message: bookRes.ok
          ? null
          : wgErrorMessage(bookRes.json, `WebinarGeek booking failed (${bookRes.status})`),
        metadata: {
          registration_link: effectiveCustomField,
          registration_source: 'api',
          wg_status: bookRes.status,
          wg_code: bookRes.json.code ?? null,
          dropped_custom_field: droppedCustomField,
          attempted_endpoint: bookRes.endpoint,
          attempted_payload: usedPayload,
          wg_response: bookRes.ok ? null : bookRes.json,
        },
      };

      try {
        void admin.from('webinar_geek_portal_bookings').insert(auditRow).then(({ error }) => {
          if (error) console.error('webinar_geek_portal_bookings insert failed:', error);
        });
      } catch (auditErr) {
        console.error('webinar_geek_portal_bookings insert failed:', auditErr);
      }

      if (!bookRes.ok) {
        return new Response(JSON.stringify({
          error: auditRow.error_message,
          source_status: bookRes.status,
          wg_code: bookRes.json.code ?? null,
          wg_details: bookRes.json,
          attempted_endpoint: bookRes.endpoint,
          attempted_payload: usedPayload,
        }), {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const simplified = subscriptionRow ? simplifySubscriptionRow(subscriptionRow) : null;
      return new Response(JSON.stringify({
        ok: true,
        booked: true,
        subscription: simplified,
        email_verified: simplified?.email_verified === true,
        custom_field: effectiveCustomField,
        dropped_custom_field: droppedCustomField,
        booked_by: bookedByLabel,
        message: droppedCustomField
          ? 'Registered, but WebinarGeek rejected the Cooper/RMS link tag — booked without link attribution.'
          : simplified?.email_verified
          ? 'Registered and email already verified in WebinarGeek.'
          : 'Registered — candidate must confirm the WebinarGeek email to appear as verified.',
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Unsupported mode' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
