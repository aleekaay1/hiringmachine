/**
 * Call log admin: connection status, extension sync, today's recording backfill.
 * Deploy: npx supabase functions deploy threecx-call-admin
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { RECRUITER_3CX_EXTENSIONS } from '../_shared/recruiter3cxExtensions.ts';
import {
  attachRecordingToCallRecord,
  digitsOnly,
  parseDurationSecondsFromText,
} from '../_shared/threecxCallMatch.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
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

function externalNumberFromHistory(row: Record<string, unknown>): string {
  const direction = pickString(row, ['Direction', 'CallDirection']).toLowerCase();
  const src = pickString(row, ['SrcCallerNumber', 'SourceCallerId', 'CallerNumber', 'SrcNumber']);
  const dst = pickString(row, ['DstCallerNumber', 'DestinationCallerId', 'CalleeNumber', 'DstNumber']);
  if (direction.includes('out')) return dst || src;
  if (direction.includes('in')) return src || dst;
  const srcDigits = digitsOnly(src);
  const dstDigits = digitsOnly(dst);
  if (srcDigits.length >= 10 && dstDigits.length < 10) return src;
  if (dstDigits.length >= 10 && srcDigits.length < 10) return dst;
  return dst || src;
}

function extensionFromHistory(row: Record<string, unknown>): string {
  return pickString(row, ['SrcDn', 'DstDn', 'AgentDn', 'Extension', 'AgentExtension']);
}

function recordingUrlFromHistory(row: Record<string, unknown>, baseUrl: string, token: string): string | null {
  const direct = pickString(row, ['RecordingUrl', 'recording_url', 'RecordingURL']);
  if (direct.startsWith('http')) return direct;
  const recId = pickString(row, ['RecId', 'RecordingId', 'recId', 'Id']);
  if (!recId) return null;
  return `${baseUrl}/xapi/v1/Recordings/Pbx.DownloadRecording(recId=${encodeURIComponent(recId)})?access_token=${encodeURIComponent(token)}`;
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
      await getThreeCxToken();
      apiOk = true;
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

async function backfillToday(admin: ReturnType<typeof createClient>) {
  const { token, baseUrl } = await getThreeCxToken();
  const bounds = torontoTodayBounds();
  const url = `${baseUrl}/xapi/v1/CallHistoryView?$top=500&$orderby=SegmentStartTime%20desc`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`CallHistoryView failed (${res.status}): ${raw.slice(0, 300)}`);
  }
  const parsed = JSON.parse(raw) as { value?: Array<Record<string, unknown>> };
  const history = parsed.value || [];

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
    const recordingUrl = recordingUrlFromHistory(row, baseUrl, token);
    if (!recordingUrl) continue;
    withRecording += 1;

    const phone = externalNumberFromHistory(row);
    const extension = extensionFromHistory(row);
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
      reportMeta: { source: 'backfill_today', backfill_date: bounds.dateKey },
    });
    if (result.matched) {
      matched += 1;
      if (recordingUrl) updated += 1;
    }
  }

  return {
    todayDate: bounds.dateKey,
    scanned,
    withRecording,
    matched,
    updated,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const { admin } = await assertCallLogAdmin(req.headers.get('Authorization'));
    const body = (await req.json().catch(() => ({}))) as { action?: string };
    const action = String(body.action || 'status').trim().toLowerCase();

    if (action === 'status') {
      const status = await loadConnectionStatus(admin);
      return json(200, { ok: true, ...status });
    }
    if (action === 'sync-extensions') {
      const result = await syncExtensions(admin);
      return json(200, { ok: true, ...result });
    }
    if (action === 'backfill-today') {
      const result = await backfillToday(admin);
      return json(200, { ok: true, ...result });
    }

    return json(400, { error: `Unknown action: ${action}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Request failed';
    const status = message === 'Unauthorized' ? 401 : message === 'Forbidden' ? 403 : 500;
    return json(status, { error: message });
  }
});
