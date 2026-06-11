/**
 * Call log admin: connection status, extension sync, today's recording backfill.
 * Deploy: npx supabase functions deploy threecx-call-admin
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { RECRUITER_3CX_EXTENSIONS } from '../_shared/recruiter3cxExtensions.ts';
import {
  fetchCallHistoryPaginatedForDay,
  fetchThreeCxCallHistory,
  fetchThreeCxCallHistoryForWindow,
  fetchThreeCxCallLogData,
  fetchThreeCxRecordingsForWindow,
  filterRowsForExtension,
  probeThreeCxHistoryAccess,
  sampleExternalNumbers,
  torontoDayBoundsFromMs,
  torontoDayUtcPeriod,
  torontoDateKey,
} from '../_shared/threecxApiHistory.ts';
import {
  computeMatchWindow,
  findHistoryRecording,
  findWebhookRecording,
  firstWebhookForExtensionToday,
  type RecordingCandidate,
} from '../_shared/threecxRecordingFetch.ts';
import { extensionsFromHistory } from '../_shared/threecxHistoryParse.ts';
import {
  attachRecordingToCallRecord,
  digitsOnly,
  parseDurationSecondsFromText,
  resolveRecruiterUserIds,
} from '../_shared/threecxCallMatch.ts';
import {
  normalizeTranscriptInput,
  readTranscriptFromCallMetadata,
  transcriptForMetadataStorage,
  type CallRecordingTranscript,
} from '../_shared/callRecordingTranscribe.ts';

const MATCH_BEFORE_MS = 30_000;
const MATCH_AFTER_MS = 30 * 60_000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info, Range',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
};

const CALL_LOG_EMAILS = new Set(['ali@globelife-paz.com', 'hr.licensing@globelife-paz.com']);

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function normalizeBase(v: string): string {
  return v.replace(/\/$/, '');
}

async function getThreeCxToken(): Promise<{ token: string; baseUrl: string }> {
  const baseUrl = Deno.env.get('THREECX_BASE_URL')?.trim() || '';
  const clientId = Deno.env.get('THREECX_CLIENT_ID')?.trim() || '';
  const clientSecret = Deno.env.get('THREECX_CLIENT_SECRET')?.trim() || '';
  if (!baseUrl || !clientId || !clientSecret) {
    throw new Error('Missing THREECX_BASE_URL / THREECX_CLIENT_ID / THREECX_CLIENT_SECRET in Supabase secrets.');
  }
  const tokenUrl = Deno.env.get('THREECX_TOKEN_URL')?.trim() || `${normalizeBase(baseUrl)}/connect/token`;
  const payload = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: payload.toString(),
  });
  const body = await res.json().catch(() => ({})) as { access_token?: string; error_description?: string };
  if (!res.ok || !body.access_token) {
    throw new Error(body.error_description || `3CX token failed (${res.status})`);
  }
  return { token: body.access_token, baseUrl: normalizeBase(baseUrl) };
}

function torontoTodayBounds(): { fromIso: string; toIso: string; dateKey: string } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const dateKey = fmt.format(new Date());
  return {
    dateKey,
    fromIso: `${dateKey}T00:00:00.000-04:00`,
    toIso: `${dateKey}T23:59:59.999-04:00`,
  };
}

function pickString(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const v = row[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return '';
}

async function assertCallLogAdmin(authHeader: string | null) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
  if (!authHeader?.startsWith('Bearer ') || !supabaseUrl || !anonKey) {
    throw new Error('Unauthorized');
  }
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth, error } = await userClient.auth.getUser();
  if (error || !auth.user) throw new Error('Unauthorized');

  const email = String(auth.user.email || '').trim().toLowerCase();
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const admin = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: profile } = await admin
    .from('user_profiles')
    .select('role')
    .eq('user_id', auth.user.id)
    .maybeSingle();

  const role = String(profile?.role || '');
  const allowed = role === 'admin' || CALL_LOG_EMAILS.has(email);
  if (!allowed) throw new Error('Forbidden');
  return { admin, userId: auth.user.id, email };
}

async function loadConnectionStatus(admin: ReturnType<typeof createClient>) {
  const bounds = torontoTodayBounds();
  const { data: events, error } = await admin
    .from('threecx_webhook_events')
    .select('id, received_at, event_type, matched, recording_attached')
    .order('received_at', { ascending: false })
    .limit(20);
  if (error && !/does not exist|schema cache/i.test(error.message || '')) throw error;

  const rows = events || [];
  const last = rows[0] || null;
  const todayRows = rows.filter((r) => String(r.received_at || '').slice(0, 10) === bounds.dateKey);
  const reportCallsToday = todayRows.filter((r) => r.event_type === 'report_call').length;
  const recordingsToday = todayRows.filter((r) => r.recording_attached).length;

  let apiConfigured = Boolean(
    Deno.env.get('THREECX_BASE_URL')?.trim()
    && Deno.env.get('THREECX_CLIENT_ID')?.trim()
    && Deno.env.get('THREECX_CLIENT_SECRET')?.trim(),
  );
  let apiOk = false;
  let apiError: string | null = null;
  if (apiConfigured) {
    try {
      const { token, baseUrl } = await getThreeCxToken();
      const probe = await probeThreeCxHistoryAccess(token, baseUrl);
      apiOk = probe.ok;
      apiError = probe.error;
    } catch (e) {
      apiError = e instanceof Error ? e.message : String(e);
    }
  }

  const lastAt = last?.received_at ? new Date(String(last.received_at)).getTime() : null;
  const minutesAgo = lastAt ? Math.round((Date.now() - lastAt) / 60000) : null;
  const webhookLive = lastAt != null && Date.now() - lastAt < 24 * 60 * 60 * 1000;

  return {
    webhookConfigured: Boolean(Deno.env.get('THREECX_WEBHOOK_SECRET')?.trim()),
    webhookLive,
    lastWebhookAt: last?.received_at || null,
    lastWebhookMinutesAgo: minutesAgo,
    lastEventType: last?.event_type || null,
    webhooksToday: reportCallsToday,
    recordingsAttachedToday: recordingsToday,
    extensionMapCount: RECRUITER_3CX_EXTENSIONS.length,
    threecxApiConfigured: apiConfigured,
    threecxApiOk: apiOk,
    threecxApiError: apiError,
    todayDate: bounds.dateKey,
  };
}

async function syncExtensions(admin: ReturnType<typeof createClient>) {
  if (!RECRUITER_3CX_EXTENSIONS.length) {
    return { updated: 0, skipped: 0, message: 'No rows in recruiter3cxExtensions.ts — add emails and extensions first.' };
  }
  let updated = 0;
  let skipped = 0;
  const details: Array<{ email: string; extension: string; status: string }> = [];

  for (const row of RECRUITER_3CX_EXTENSIONS) {
    const email = row.email.trim().toLowerCase();
    const extension = row.extension.trim();
    if (!email || !extension) {
      skipped += 1;
      details.push({ email, extension, status: 'invalid_row' });
      continue;
    }
    const { data: profiles, error } = await admin
      .from('user_profiles')
      .select('user_id, email')
      .ilike('email', email);
    if (error) throw error;
    if (!profiles?.length) {
      skipped += 1;
      details.push({ email, extension, status: 'user_not_found' });
      continue;
    }
    for (const profile of profiles) {
      await admin.from('user_profiles').update({ extension }).eq('user_id', profile.user_id);
      const { data: existing } = await admin
        .from('pipeline_user_call_settings')
        .select('user_id')
        .eq('user_id', profile.user_id)
        .maybeSingle();
      if (existing) {
        await admin.from('pipeline_user_call_settings').update({ extension, updated_at: new Date().toISOString() }).eq('user_id', profile.user_id);
      } else {
        await admin.from('pipeline_user_call_settings').insert({ user_id: profile.user_id, extension, dialing_locale: 'ca' });
      }
      updated += 1;
      details.push({ email, extension, status: 'ok' });
    }
  }

  return { updated, skipped, details };
}

function parseWebhookAnchorIso(payload: Record<string, unknown>, receivedAt: string): string {
  const end = pickString(payload, ['call_end_utc', 'call_end_utc_millis']);
  const start = pickString(payload, ['call_start_utc', 'call_start_utc_millis']);
  if (end) {
    const d = new Date(end);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  if (start) {
    const d = new Date(start);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return receivedAt;
}

async function backfillFromWebhookEvents(admin: ReturnType<typeof createClient>, bounds: ReturnType<typeof torontoTodayBounds>) {
  const fromMs = new Date(bounds.fromIso).getTime();
  const toMs = new Date(bounds.toIso).getTime();

  const { data: events, error } = await admin
    .from('threecx_webhook_events')
    .select('id, received_at, payload, agent_extension, phone_number')
    .eq('event_type', 'report_call')
    .gte('received_at', bounds.fromIso)
    .lte('received_at', bounds.toIso)
    .order('received_at', { ascending: true });
  if (error) throw error;

  let scanned = 0;
  let withRecording = 0;
  let matched = 0;
  let updated = 0;

  for (const event of events || []) {
    const payload = (event.payload && typeof event.payload === 'object')
      ? event.payload as Record<string, unknown>
      : {};
    const receivedAt = String(event.received_at || new Date().toISOString());
    const receivedMs = new Date(receivedAt).getTime();
    if (Number.isNaN(receivedMs) || receivedMs < fromMs || receivedMs > toMs) continue;

    scanned += 1;
    const recordingUrl = pickString(payload, ['recording_url', 'RecordingUrl']);
    if (!recordingUrl.startsWith('http')) continue;
    withRecording += 1;

    const phone = pickString(payload, ['phone_number', 'PhoneNumber']) || String(event.phone_number || '');
    const extension = pickString(payload, ['agent_extension', 'Agent']) || String(event.agent_extension || '');
    const duration = parseDurationSecondsFromText(pickString(payload, ['duration_seconds', 'duration', 'Duration']));
    const callId = pickString(payload, ['call_id', 'callId']) || `webhook-${event.id}`;
    const anchorIso = parseWebhookAnchorIso(payload, receivedAt);

    const result = await attachRecordingToCallRecord(admin, {
      phoneNumber: phone,
      agentExtension: extension,
      agentEmail: pickString(payload, ['agent_email', 'AgentEmail']),
      recordingUrl,
      callId,
      durationSeconds: duration,
      anchorIso,
      replayMode: true,
      reportMeta: { source: 'backfill_webhook_events', backfill_date: bounds.dateKey },
    });
    if (result.matched) {
      matched += 1;
      updated += 1;
      await admin.from('threecx_webhook_events').update({
        matched: true,
        recording_attached: true,
        call_record_id: result.callRecordId || null,
        detail: 'backfill_ok',
      }).eq('id', event.id);
    }
  }

  return { scanned, withRecording, matched, updated };
}

async function backfillFromCallHistory(
  admin: ReturnType<typeof createClient>,
  bounds: ReturnType<typeof torontoTodayBounds>,
) {
  const { token, baseUrl } = await getThreeCxToken();
  const { rows: history } = await fetchThreeCxCallHistory(token, baseUrl);

  const fromMs = new Date(bounds.fromIso).getTime();
  const toMs = new Date(bounds.toIso).getTime();

  let scanned = 0;
  let withRecording = 0;
  let matched = 0;
  let updated = 0;

  for (const row of history) {
    const startRaw = pickString(row, ['SegmentStartTime', 'StartTime', 'CallStartTimeUTC', 'CallStartTime']);
    if (!startRaw) continue;
    const startMs = new Date(startRaw).getTime();
    if (Number.isNaN(startMs) || startMs < fromMs || startMs > toMs) continue;

    scanned += 1;
    const recordingUrl = recordingUrlFromRow(row, baseUrl, token);
    if (!recordingUrl) continue;
    withRecording += 1;

    const phone = externalNumbersFromHistory(row)[0] || '';
    const extension = extensionsFromHistory(row)[0] || '';
    const duration = parseDurationSecondsFromText(
      pickString(row, ['TalkingDuration', 'Duration', 'TalkingTime']),
    );
    const callId = pickString(row, ['MainCallHistoryId', 'CallHistoryId', 'Id']) || `backfill-${startRaw}-${phone}`;

    const result = await attachRecordingToCallRecord(admin, {
      phoneNumber: phone,
      agentExtension: extension,
      agentEmail: '',
      recordingUrl,
      callId,
      durationSeconds: duration,
      anchorIso: startRaw,
      replayMode: true,
      reportMeta: { source: 'backfill_call_history', backfill_date: bounds.dateKey },
    });
    if (result.matched) {
      matched += 1;
      updated += 1;
    }
  }

  return { scanned, withRecording, matched, updated };
}

function stripRecordingFromMetadata(meta: unknown): Record<string, unknown> {
  if (!meta || typeof meta !== 'object') return {};
  const next = { ...(meta as Record<string, unknown>) };
  delete next.recording_url;
  delete next.duration_seconds;
  delete next.threecx_call_id;
  delete next.match_phone;
  delete next.match_anchor;
  delete next.match_extension;
  delete next.match_recruiter_ids;
  delete next.threecx_report;
  return next;
}

function rowHasStoredRecording(row: { recording_url?: string | null; threecx_metadata?: unknown }): boolean {
  if (String(row.recording_url || '').trim()) return true;
  const meta = row.threecx_metadata && typeof row.threecx_metadata === 'object'
    ? row.threecx_metadata as Record<string, unknown>
    : {};
  return Boolean(String(meta.recording_url || '').trim());
}

/** Clear recording columns AND threecx_metadata cache so rematch can re-attach correctly. */
async function clearAutoAttachedRecordings(
  admin: ReturnType<typeof createClient>,
  sinceIso: string | null,
) {
  let query = admin
    .from('pipeline_call_records')
    .select('id, recording_url, threecx_metadata')
    .order('disposed_at', { ascending: false })
    .limit(5000);
  if (sinceIso) query = query.gte('disposed_at', sinceIso);

  const { data: rows, error } = await query;
  if (error) throw error;

  const toClear = (rows || []).filter((r) => rowHasStoredRecording(r as {
    recording_url?: string | null;
    threecx_metadata?: unknown;
  }));
  if (!toClear.length) return 0;

  const chunk = 50;
  for (let i = 0; i < toClear.length; i += chunk) {
    const slice = toClear.slice(i, i + chunk);
    await Promise.all(slice.map(async (row) => {
      const { error: upErr } = await admin
        .from('pipeline_call_records')
        .update({
          recording_url: null,
          duration_seconds: null,
          threecx_call_id: null,
          threecx_metadata: stripRecordingFromMetadata(row.threecx_metadata),
        })
        .eq('id', row.id);
      if (upErr) throw upErr;
    }));
  }
  return toClear.length;
}

async function resetWebhookMatchState(
  admin: ReturnType<typeof createClient>,
  sinceIso: string | null,
) {
  let query = admin
    .from('threecx_webhook_events')
    .update({ matched: false, recording_attached: false, call_record_id: null, detail: 'pending_rematch' })
    .eq('event_type', 'report_call');
  if (sinceIso) query = query.gte('received_at', sinceIso);
  const { error } = await query;
  if (error) throw error;
}

/** Replay webhooks — incremental by default (unmatched only, no mass clear). */
async function syncRecordings(
  admin: ReturnType<typeof createClient>,
  hoursBack = 24,
  incremental = true,
) {
  const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();

  let cleared = 0;
  if (!incremental) {
    cleared = await clearAutoAttachedRecordings(admin, since);
    await resetWebhookMatchState(admin, since);
  }

  let eventsQuery = admin
    .from('threecx_webhook_events')
    .select('id, received_at, payload, agent_extension, phone_number, matched, call_record_id')
    .eq('event_type', 'report_call')
    .gte('received_at', since)
    .order('received_at', { ascending: true });

  if (incremental) {
    eventsQuery = eventsQuery.or('matched.eq.false,matched.is.null');
  }

  const { data: events, error } = await eventsQuery;
  if (error) throw error;

  let scanned = 0;
  let withRecording = 0;
  let matched = 0;
  let updated = 0;
  const claimedRecordIds = new Set<string>();

  for (const event of events || []) {
    const payload = (event.payload && typeof event.payload === 'object')
      ? event.payload as Record<string, unknown>
      : {};
    const recordingUrl = pickString(payload, ['recording_url', 'RecordingUrl']);
    if (!recordingUrl.startsWith('http')) continue;

    scanned += 1;
    withRecording += 1;

    const phone = pickString(payload, ['phone_number', 'PhoneNumber']) || String(event.phone_number || '');
    const extension = pickString(payload, ['agent_extension', 'Agent']) || String(event.agent_extension || '');
    const duration = parseDurationSecondsFromText(pickString(payload, ['duration_seconds', 'duration', 'Duration']));
    const callId = pickString(payload, ['call_id', 'callId']) || `webhook-${event.id}`;
    const receivedAt = String(event.received_at || new Date().toISOString());
    const anchorIso = parseWebhookAnchorIso(payload, receivedAt);

    const result = await attachRecordingToCallRecord(admin, {
      phoneNumber: phone,
      agentExtension: extension,
      agentEmail: pickString(payload, ['agent_email', 'AgentEmail']),
      recordingUrl,
      callId,
      durationSeconds: duration,
      anchorIso,
      replayMode: true,
      excludeRecordIds: claimedRecordIds,
      reportMeta: { source: 'sync_recordings', received_at: receivedAt },
    });
    if (result.matched) {
      matched += 1;
      updated += 1;
      if (result.callRecordId) claimedRecordIds.add(result.callRecordId);
      await admin.from('threecx_webhook_events').update({
        matched: true,
        recording_attached: true,
        call_record_id: result.callRecordId || null,
        detail: 'sync_ok',
      }).eq('id', event.id);
    }
  }

  return {
    hoursBack,
    scanned,
    withRecording,
    matched,
    updated,
    cleared,
    incremental,
    message: updated > 0
      ? `Attached ${updated} recording(s).`
      : withRecording > 0
        ? 'No new matches — check phone, recruiter extension, and disposition time.'
        : incremental
          ? 'No new recordings to attach.'
          : 'No recordings found in webhooks for this period.',
  };
}

async function backfillToday(admin: ReturnType<typeof createClient>) {
  const bounds = torontoTodayBounds();
  const webhook = await backfillFromWebhookEvents(admin, bounds);

  let apiWarning: string | null = null;
  let api = { scanned: 0, withRecording: 0, matched: 0, updated: 0 };
  try {
    api = await backfillFromCallHistory(admin, bounds);
  } catch (err) {
    apiWarning = err instanceof Error ? err.message : String(err);
  }

  return {
    todayDate: bounds.dateKey,
    scanned: webhook.scanned + api.scanned,
    withRecording: webhook.withRecording + api.withRecording,
    matched: webhook.matched + api.matched,
    updated: webhook.updated + api.updated,
    webhookScanned: webhook.scanned,
    webhookMatched: webhook.matched,
    apiScanned: api.scanned,
    apiMatched: api.matched,
    warning: webhook.updated > 0 ? null : apiWarning,
    message: webhook.updated > 0
      ? `Attached ${webhook.updated} recording(s) from today's webhooks.`
      : apiWarning && webhook.updated === 0
        ? undefined
        : undefined,
  };
}

async function resolveExtensionForRecruiter(
  admin: ReturnType<typeof createClient>,
  recruiterUserId: string | null,
): Promise<string> {
  if (!recruiterUserId) return '';
  const { data: profile } = await admin
    .from('user_profiles')
    .select('extension, email')
    .eq('user_id', recruiterUserId)
    .maybeSingle();
  const fromProfile = normalizeExtensionDigits(String(profile?.extension || ''));
  if (fromProfile) return fromProfile;
  const { data: settings } = await admin
    .from('pipeline_user_call_settings')
    .select('extension')
    .eq('user_id', recruiterUserId)
    .maybeSingle();
  const fromSettings = normalizeExtensionDigits(String(settings?.extension || ''));
  if (fromSettings) return fromSettings;
  const email = String(profile?.email || '').trim().toLowerCase();
  const hardcoded = RECRUITER_3CX_EXTENSIONS.find((row) => row.email.trim().toLowerCase() === email);
  return normalizeExtensionDigits(hardcoded?.extension || '');
}

async function saveRecordingOnCallRecord(
  admin: ReturnType<typeof createClient>,
  callRecordId: string,
  input: {
    recordingUrl: string;
    durationSeconds: number | null;
    callId: string;
    source: string;
    extension: string;
    anchorIso: string;
  },
) {
  const { data: record, error } = await admin
    .from('pipeline_call_records')
    .select('threecx_metadata')
    .eq('id', callRecordId)
    .maybeSingle();
  if (error) throw error;
  if (!record) throw new Error('Call record not found');

  const existingMeta = record.threecx_metadata && typeof record.threecx_metadata === 'object'
    ? record.threecx_metadata as Record<string, unknown>
    : {};

  const { error: upErr } = await admin.from('pipeline_call_records').update({
    recording_url: input.recordingUrl,
    duration_seconds: input.durationSeconds,
    threecx_call_id: input.callId,
    threecx_metadata: {
      ...existingMeta,
      recording_url: input.recordingUrl,
      duration_seconds: input.durationSeconds,
      threecx_call_id: input.callId,
      match_extension: input.extension,
      match_anchor: input.anchorIso,
      fetch_source: input.source,
      fetched_at: new Date().toISOString(),
    },
  }).eq('id', callRecordId);
  if (upErr) throw upErr;
}

function normalizeExtensionDigits(ext: string): string {
  const digits = digitsOnly(String(ext || '').trim());
  if (!digits) return '';
  return digits.length > 4 ? digits.slice(-4) : digits;
}

function extensionsMatch(a: string, b: string): boolean {
  const ea = normalizeExtensionDigits(a);
  const eb = normalizeExtensionDigits(b);
  return Boolean(ea && eb && ea === eb);
}

async function recruiterOwnsExtension(
  admin: ReturnType<typeof createClient>,
  recruiterUserId: string | null,
  eventExtension: string,
): Promise<boolean> {
  if (!recruiterUserId || !normalizeExtensionDigits(eventExtension)) return false;
  const ids = await resolveRecruiterUserIds(admin, normalizeExtensionDigits(eventExtension), '');
  return ids.includes(String(recruiterUserId));
}

function pickClosestRecordingCandidate(
  candidates: RecordingCandidate[],
  disposedMs: number,
): RecordingCandidate | null {
  const inWindow = candidates.filter((c) => {
    return c.anchorMs >= disposedMs - MATCH_BEFORE_MS && c.anchorMs <= disposedMs + MATCH_AFTER_MS;
  });
  const pool = inWindow.length ? inWindow : candidates;
  if (!pool.length) return null;
  return pool.reduce((prev, curr) => {
    const prevDelta = Math.abs(prev.anchorMs - disposedMs);
    const currDelta = Math.abs(curr.anchorMs - disposedMs);
    return currDelta < prevDelta ? curr : prev;
  });
}

async function fetchRecordingForCallRecord(
  admin: ReturnType<typeof createClient>,
  callRecordId: string,
) {
  const { data: record, error } = await admin
    .from('pipeline_call_records')
    .select('id, dialed_number, recruiter_user_id, disposed_at, dial_started_at, recording_url, duration_seconds, threecx_metadata')
    .eq('id', callRecordId)
    .maybeSingle();
  if (error) throw error;
  if (!record) throw new Error('Call record not found');

  const meta = record.threecx_metadata && typeof record.threecx_metadata === 'object'
    ? record.threecx_metadata as Record<string, unknown>
    : {};
  const phone = String(record.dialed_number || '').trim();
  const disposedMs = Date.parse(String(record.disposed_at || ''));
  const dialStartedMs = Date.parse(String(record.dial_started_at || ''));
  if (digitsOnly(phone).length < 10) {
    throw new Error('Disposition is missing a valid phone number.');
  }
  if (!Number.isFinite(disposedMs)) throw new Error('Invalid disposition time.');

  const extension = await resolveExtensionForRecruiter(admin, record.recruiter_user_id);
  if (!extension) {
    throw new Error('Recruiter extension not set — run sync-extensions or set extension in Account → Call settings.');
  }

  const cachedUrl = String(record.recording_url || meta.recording_url || '').trim();
  const cachedExt = normalizeExtensionDigits(String(meta.match_extension || ''));
  if (cachedUrl.startsWith('http')) {
    const cacheOk = !cachedExt
      || extensionsMatch(cachedExt, extension)
      || await recruiterOwnsExtension(admin, record.recruiter_user_id, cachedExt);
    if (cacheOk) {
      const duration = Number(record.duration_seconds ?? meta.duration_seconds);
      return {
        matched: true,
        callRecordId,
        recordingUrl: cachedUrl,
        durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : null,
        source: 'cached',
        message: 'Recording already saved for this call.',
      };
    }
  }

  const { anchorMs, startMs, endMs } = computeMatchWindow({
    disposedMs,
    dialStartedMs: Number.isFinite(dialStartedMs) ? dialStartedMs : null,
  });
  const dayBounds = torontoDayBoundsFromMs(disposedMs);
  const utcPeriod = torontoDayUtcPeriod(disposedMs);
  const dayKey = utcPeriod.dateKey;

  let best: RecordingCandidate | null = null;
  let apiWarning: string | null = null;
  let apiEndpoint = 'webhook';
  let apiRowsScanned = 0;
  const diag = {
    phoneHits: 0,
    extHits: 0,
    withRecording: 0,
    webhookRows: 0,
    webhookHits: 0,
    extensionDayRows: 0,
    sampleExtPhones: [] as string[],
    getCallLogAttempts: [] as string[],
  };

  try {
    const webhook = await findWebhookRecording(admin, {
      phone,
      extension,
      recruiterUserId: record.recruiter_user_id,
      startMs,
      endMs,
      targetMs: anchorMs,
    });
    diag.webhookRows = webhook.diag.rowsScanned;
    if (webhook.candidate) {
      diag.webhookHits = 1;
      best = webhook.candidate;
    }

    if (!best) {
      const { token, baseUrl } = await getThreeCxToken();
      const probe = await probeThreeCxHistoryAccess(token, baseUrl);
      if (!probe.ok) throw new Error(probe.error || '3CX call history API not available.');

      let paginated = await fetchCallHistoryPaginatedForDay(token, baseUrl, utcPeriod.dateKey);
      let extRows = filterRowsForExtension(paginated.rows, extension);
      if (!paginated.rows.length) {
        const callLog = await fetchThreeCxCallLogData(
          token,
          baseUrl,
          utcPeriod.periodFrom,
          utcPeriod.periodTo,
          extension,
          phone,
        );
        diag.getCallLogAttempts = callLog.attempts;
        if (callLog.rows.length) {
          paginated = { rows: callLog.rows, pages: 1, endpoint: callLog.endpoint };
          extRows = filterRowsForExtension(callLog.rows, extension);
        }
      }
      diag.extensionDayRows = extRows.length;
      diag.sampleExtPhones = sampleExternalNumbers(extRows.length ? extRows : paginated.rows.slice(0, 40));
      apiRowsScanned = extRows.length || paginated.rows.length;
      apiEndpoint = `${paginated.endpoint}(pages=${paginated.pages})`;

      const phoneMatch = findHistoryRecording({
        rows: extRows.length ? extRows : paginated.rows,
        phone,
        extension,
        startMs,
        endMs,
        targetMs: anchorMs,
        baseUrl,
        token,
        requirePhone: true,
      });
      diag.phoneHits = phoneMatch.diag.phoneHits;
      diag.extHits = phoneMatch.diag.extHits;
      diag.withRecording = phoneMatch.diag.withRecording;
      best = phoneMatch.candidate;

      if (!best && extRows.length) {
        const extOnly = findHistoryRecording({
          rows: extRows,
          phone,
          extension,
          startMs,
          endMs,
          targetMs: anchorMs,
          baseUrl,
          token,
          requirePhone: false,
        });
        if (extOnly.candidate) {
          diag.extHits = Math.max(diag.extHits, extOnly.diag.extHits);
          diag.withRecording = Math.max(diag.withRecording, extOnly.diag.withRecording);
          best = extOnly.candidate;
        }
      }

      if (!best) {
        const { rows: recRows, endpoint } = await fetchThreeCxRecordingsForWindow(token, baseUrl, dayBounds.fromIso, dayBounds.toIso);
        apiEndpoint = `${apiEndpoint}+${endpoint || 'Recordings'}`;
        const recMatch = findHistoryRecording({
          rows: recRows,
          phone,
          extension,
          startMs,
          endMs,
          targetMs: anchorMs,
          baseUrl,
          token,
          requirePhone: false,
        });
        if (recMatch.candidate) best = recMatch.candidate;
      }
    }
  } catch (err) {
    apiWarning = err instanceof Error ? err.message : String(err);
  }

  if (!best) {
    let message = `No recording (${extension}, ${digitsOnly(phone).slice(-10)}, ${dayKey}).`;
    message += ` Window: ${new Date(startMs).toISOString().slice(11, 16)}–${new Date(endMs).toISOString().slice(11, 16)} UTC around disposition.`;
    message += ` Webhooks scanned: ${diag.webhookRows}.`;
    if (apiRowsScanned) {
      message += ` CDR ext ${extension}: ${diag.extensionDayRows} segment(s).`;
      if (diag.sampleExtPhones.length) message += ` Sample numbers: ${diag.sampleExtPhones.join(', ')}.`;
    }
    if (diag.getCallLogAttempts.length) {
      message += ` GetCallLogData: ${diag.getCallLogAttempts.slice(0, 2).join('; ')}.`;
    }
    if (apiWarning) {
      message += ` ${apiWarning}`;
    } else {
      const firstExtWebhook = await firstWebhookForExtensionToday(admin, extension, utcPeriod.periodFrom);
      if (firstExtWebhook) {
        const firstMs = Date.parse(firstExtWebhook);
        if (Number.isFinite(firstMs) && disposedMs < firstMs - 60 * 1000) {
          message += ` No ReportCall for ext ${extension} at this time — CRM webhooks for this extension started at ${firstExtWebhook.slice(11, 19)} UTC (${dayKey}). Make a new test call after CRM v5 was uploaded.`;
        } else if (diag.webhookRows && !diag.webhookHits) {
          message += ' Webhooks exist for other extensions but none matched this phone+extension+time.';
        }
      } else if (!diag.webhookRows && !diag.extensionDayRows) {
        message += ' Re-upload CRM template v5 in 3CX (ReportCall) so hangup events are stored for recruiter extensions.';
      } else if (diag.webhookRows && !diag.webhookHits) {
        message += ' Webhook events exist but none matched phone+extension+time.';
      }
    }
    return { matched: false, callRecordId, recruiterExtension: extension, apiRowsScanned, message };
  }

  await saveRecordingOnCallRecord(admin, callRecordId, {
    recordingUrl: best.recordingUrl,
    durationSeconds: best.durationSeconds,
    callId: best.callId,
    source: best.source,
    extension: best.extension,
    anchorIso: new Date(best.anchorMs).toISOString(),
  });

  return {
    matched: true,
    callRecordId,
    recordingUrl: best.recordingUrl,
    durationSeconds: best.durationSeconds,
    source: best.source,
    message: best.source === 'threecx_webhook'
      ? 'Recording loaded from 3CX hangup webhook.'
      : best.source === 'threecx_webhook_ext_time'
        ? 'Recording matched from webhook by extension + time (phone not in webhook payload).'
      : best.source === 'threecx_api_ext_time'
        ? 'Recording matched by extension + time (phone not in CDR).'
        : 'Recording loaded from 3CX API.',
  };
}

async function listWebhookCalls(admin: ReturnType<typeof createClient>, hoursBack = 72) {
  const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
  const { data: events, error } = await admin
    .from('threecx_webhook_events')
    .select('id, received_at, payload, agent_extension, phone_number, matched, call_record_id')
    .eq('event_type', 'report_call')
    .gte('received_at', since)
    .order('received_at', { ascending: false })
    .limit(800);
  if (error) throw error;

  const rows = (events || []).map((event) => {
    const payload = (event.payload && typeof event.payload === 'object')
      ? event.payload as Record<string, unknown>
      : {};
    const recordingUrl = pickString(payload, ['recording_url', 'RecordingUrl']);
    const direction = pickString(payload, ['call_direction', 'CallDirection']) || null;
    const duration = parseDurationSecondsFromText(
      pickString(payload, ['duration_seconds', 'duration', 'Duration']),
    );
    return {
      id: String(event.id),
      receivedAt: String(event.received_at || ''),
      phoneNumber: pickString(payload, ['phone_number', 'PhoneNumber']) || String(event.phone_number || ''),
      agentExtension: pickString(payload, ['agent_extension', 'Agent']) || String(event.agent_extension || '') || null,
      callDirection: direction,
      recordingUrl: recordingUrl.startsWith('http') ? recordingUrl : null,
      durationSeconds: duration,
      matched: Boolean(event.matched),
      callRecordId: event.call_record_id ? String(event.call_record_id) : null,
    };
  }).filter((r) => r.recordingUrl);

  return { rows };
}

async function recordingUrlForCallRecord(
  admin: ReturnType<typeof createClient>,
  callRecordId: string,
): Promise<string> {
  const { data: record, error } = await admin
    .from('pipeline_call_records')
    .select('recording_url, threecx_metadata')
    .eq('id', callRecordId)
    .maybeSingle();
  if (error) throw error;
  if (!record) throw new Error('Call record not found');

  const meta = record.threecx_metadata && typeof record.threecx_metadata === 'object'
    ? record.threecx_metadata as Record<string, unknown>
    : {};
  const url = String(record.recording_url || meta.recording_url || '').trim();
  if (!url.startsWith('http')) {
    throw new Error('No recording URL saved for this call — click Load recording first.');
  }
  return url;
}

async function getRecordingTranscriptForCallRecord(
  admin: ReturnType<typeof createClient>,
  callRecordId: string,
): Promise<{ transcript: CallRecordingTranscript | null }> {
  const { data: record, error } = await admin
    .from('pipeline_call_records')
    .select('threecx_metadata')
    .eq('id', callRecordId)
    .maybeSingle();
  if (error) throw error;
  if (!record) throw new Error('Call record not found');

  const existingMeta = record.threecx_metadata && typeof record.threecx_metadata === 'object'
    ? record.threecx_metadata as Record<string, unknown>
    : {};
  return { transcript: readTranscriptFromCallMetadata(existingMeta) };
}

async function saveRecordingTranscriptForCallRecord(
  admin: ReturnType<typeof createClient>,
  callRecordId: string,
  transcriptInput: unknown,
): Promise<{ transcript: CallRecordingTranscript }> {
  const transcript = normalizeTranscriptInput(transcriptInput);
  if (!transcript) throw new Error('Invalid transcript payload.');

  const { data: record, error } = await admin
    .from('pipeline_call_records')
    .select('threecx_metadata')
    .eq('id', callRecordId)
    .maybeSingle();
  if (error) throw error;
  if (!record) throw new Error('Call record not found');

  const existingMeta = record.threecx_metadata && typeof record.threecx_metadata === 'object'
    ? record.threecx_metadata as Record<string, unknown>
    : {};
  const { error: upErr } = await admin.from('pipeline_call_records').update({
    threecx_metadata: {
      ...existingMeta,
      recording_transcript: transcriptForMetadataStorage(transcript),
    },
  }).eq('id', callRecordId);
  if (upErr) throw upErr;

  return { transcript };
}

async function streamRecordingResponse(
  admin: ReturnType<typeof createClient>,
  callRecordId: string,
  req: Request,
): Promise<Response> {
  const recordingUrl = await recordingUrlForCallRecord(admin, callRecordId);
  const upstreamHeaders: Record<string, string> = {};
  const range = req.headers.get('Range');
  if (range) upstreamHeaders.Range = range;

  const upstream = await fetch(recordingUrl, { headers: upstreamHeaders });
  if (!upstream.ok) {
    return json(upstream.status === 404 ? 404 : 502, {
      error: `3CX recording fetch failed (${upstream.status})`,
    });
  }

  const headers = new Headers(corsHeaders);
  const contentType = upstream.headers.get('Content-Type');
  headers.set('Content-Type', contentType && !contentType.includes('text/html')
    ? contentType
    : 'audio/mpeg');
  for (const key of ['Content-Length', 'Content-Range', 'Accept-Ranges'] as const) {
    const value = upstream.headers.get(key);
    if (value) headers.set(key, value);
  }

  return new Response(upstream.body, { status: upstream.status, headers });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

  try {
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const action = String(url.searchParams.get('action') || '').trim().toLowerCase();
      if (action === 'stream-recording') {
        const callRecordId = String(url.searchParams.get('callRecordId') || '').trim();
        if (!callRecordId) return json(400, { error: 'callRecordId is required' });
        const { admin } = await assertCallLogAdmin(req.headers.get('Authorization'));
        return await streamRecordingResponse(admin, callRecordId, req);
      }
      if (action === 'get-recording-transcript') {
        const callRecordId = String(url.searchParams.get('callRecordId') || '').trim();
        if (!callRecordId) return json(400, { error: 'callRecordId is required' });
        const { admin } = await assertCallLogAdmin(req.headers.get('Authorization'));
        const result = await getRecordingTranscriptForCallRecord(admin, callRecordId);
        return json(200, { ok: true, callRecordId, transcript: result.transcript });
      }
      return json(400, { error: 'Unknown GET action' });
    }

    if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

    const { admin } = await assertCallLogAdmin(req.headers.get('Authorization'));
    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      hoursBack?: number;
      incremental?: boolean;
      fullRematch?: boolean;
      callRecordId?: string;
    };
    const action = String(body.action || 'status').trim().toLowerCase();

    if (action === 'status') {
      const status = await loadConnectionStatus(admin);
      return json(200, { ok: true, ...status });
    }
    if (action === 'sync-extensions') {
      const result = await syncExtensions(admin);
      return json(200, { ok: true, ...result });
    }
    if (action === 'clear-recordings') {
      const hoursBack = Number(body.hoursBack);
      const since = hoursBack > 0
        ? new Date(Date.now() - Math.min(hoursBack, 336) * 60 * 60 * 1000).toISOString()
        : null;
      const cleared = await clearAutoAttachedRecordings(admin, since);
      await resetWebhookMatchState(admin, since);
      return json(200, {
        ok: true,
        cleared,
        hoursBack: hoursBack > 0 ? Math.min(hoursBack, 336) : null,
        message: `Cleared ${cleared} recording(s). Click Refresh & sync to rematch from webhooks.`,
      });
    }
    if (action === 'backfill-today' || action === 'sync-recordings') {
      const maxHours = body.fullRematch === true ? 336 : 72;
      const hoursBack = Number(body.hoursBack) > 0
        ? Math.min(Number(body.hoursBack), maxHours)
        : (action === 'backfill-today' ? 24 : 24);
      const incremental = body.fullRematch === true ? false : body.incremental !== false;
      const result = action === 'backfill-today'
        ? await backfillToday(admin)
        : await syncRecordings(admin, hoursBack, incremental);
      return json(200, { ok: true, ...result });
    }
    if (action === 'list-webhook-calls') {
      const hoursBack = Number(body.hoursBack) > 0 ? Math.min(Number(body.hoursBack), 168) : 72;
      const result = await listWebhookCalls(admin, hoursBack);
      return json(200, { ok: true, ...result });
    }
    if (action === 'fetch-recording') {
      const callRecordId = String(body.callRecordId || '').trim();
      if (!callRecordId) return json(400, { error: 'callRecordId is required' });
      const result = await fetchRecordingForCallRecord(admin, callRecordId);
      return json(200, { ok: true, ...result });
    }
    if (action === 'get-recording-transcript') {
      const callRecordId = String(body.callRecordId || '').trim();
      if (!callRecordId) return json(400, { error: 'callRecordId is required' });
      const result = await getRecordingTranscriptForCallRecord(admin, callRecordId);
      return json(200, { ok: true, callRecordId, transcript: result.transcript });
    }
    if (action === 'save-recording-transcript') {
      const callRecordId = String(body.callRecordId || '').trim();
      if (!callRecordId) return json(400, { error: 'callRecordId is required' });
      const result = await saveRecordingTranscriptForCallRecord(admin, callRecordId, body.transcript);
      return json(200, { ok: true, callRecordId, transcript: result.transcript });
    }

    return json(400, { error: `Unknown action: ${action}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Request failed';
    const status = message === 'Unauthorized' ? 401 : message === 'Forbidden' ? 403 : 500;
    return json(status, { error: message });
  }
});
