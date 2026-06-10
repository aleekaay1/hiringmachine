/**
 * 3CX CRM ReportCall webhook — attach recording URLs to pipeline_call_records.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  attachRecordingToCallRecord,
  parseDurationSecondsFromText,
} from '../_shared/threecxCallMatch.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info, x-paz-webhook-secret',
};

type WebhookPayload = {
  source?: string;
  call_type?: string;
  call_direction?: string;
  phone_number?: string;
  agent_extension?: string;
  agent_email?: string;
  duration?: string;
  duration_seconds?: string | number;
  call_start_utc?: string;
  call_end_utc?: string;
  call_start_utc_millis?: string | number;
  call_end_utc_millis?: string | number;
  recording_url?: string;
  call_id?: string;
};

function webhookSecretOk(req: Request): boolean {
  const expected = Deno.env.get('THREECX_WEBHOOK_SECRET')?.trim() || '';
  if (!expected) return true;
  const header = req.headers.get('x-paz-webhook-secret')?.trim() || '';
  if (header.length > 0 && header === expected) return true;
  const query = new URL(req.url).searchParams.get('secret')?.trim() || '';
  return query.length > 0 && query === expected;
}

function parseIsoTime(...values: Array<string | number | undefined | null>): string {
  for (const value of values) {
    if (value == null || value === '') continue;
    if (typeof value === 'number' && Number.isFinite(value)) {
      const ms = value > 1e12 ? value : value * 1000;
      const d = new Date(ms);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
      continue;
    }
    const d = new Date(String(value));
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

function parseDurationSeconds(payload: WebhookPayload): number | null {
  const direct = Number(payload.duration_seconds);
  if (Number.isFinite(direct) && direct > 0) return Math.round(direct);
  return parseDurationSecondsFromText(String(payload.duration || ''));
}

async function logWebhookEvent(
  admin: ReturnType<typeof createClient>,
  row: {
    event_type: string;
    matched?: boolean | null;
    recording_attached?: boolean | null;
    agent_extension?: string | null;
    phone_number?: string | null;
    call_record_id?: string | null;
    detail?: string | null;
    payload?: Record<string, unknown> | null;
  },
) {
  try {
    await admin.from('threecx_webhook_events').insert({
      event_type: row.event_type,
      matched: row.matched ?? null,
      recording_attached: row.recording_attached ?? null,
      agent_extension: row.agent_extension ?? null,
      phone_number: row.phone_number ?? null,
      call_record_id: row.call_record_id ?? null,
      detail: row.detail ?? null,
      payload: row.payload ?? null,
    });
  } catch {
    // Table may not exist yet during rollout.
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const admin = supabaseUrl && serviceRole
    ? createClient(supabaseUrl, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;

  const url = new URL(req.url);
  if (req.method === 'GET' && url.searchParams.get('ping') === '1') {
    if (admin) {
      await logWebhookEvent(admin, { event_type: 'ping', detail: 'crm_lookup_ping' });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!webhookSecretOk(req)) {
    return new Response(JSON.stringify({ error: 'Invalid webhook secret' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    if (!admin) throw new Error('Missing Supabase service configuration.');

    const payload = (await req.json()) as WebhookPayload;
    const recordingUrl = String(payload.recording_url || '').trim();
    const phoneNumber = String(payload.phone_number || '').trim();
    const callId = String(payload.call_id || '').trim() || null;
    const durationSeconds = parseDurationSeconds(payload);
    const anchorIso = parseIsoTime(payload.call_end_utc_millis, payload.call_end_utc, payload.call_start_utc_millis, payload.call_start_utc);

    if (!recordingUrl && !callId) {
      await logWebhookEvent(admin, {
        event_type: 'report_call',
        matched: false,
        recording_attached: false,
        agent_extension: payload.agent_extension || null,
        phone_number: phoneNumber || null,
        detail: 'no_recording_url',
        payload: payload as Record<string, unknown>,
      });
      return new Response(JSON.stringify({ ok: true, matched: false, reason: 'no_recording_url' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const result = await attachRecordingToCallRecord(admin, {
      phoneNumber,
      agentExtension: String(payload.agent_extension || ''),
      agentEmail: String(payload.agent_email || ''),
      recordingUrl: recordingUrl || null,
      callId,
      durationSeconds,
      anchorIso,
      reportMeta: {
        call_type: payload.call_type || null,
        call_direction: payload.call_direction || null,
        agent_extension: payload.agent_extension || null,
        agent_email: payload.agent_email || null,
        call_start_utc: payload.call_start_utc || null,
        call_end_utc: payload.call_end_utc || null,
        source: 'webhook',
      },
    });

    await logWebhookEvent(admin, {
      event_type: 'report_call',
      matched: result.matched,
      recording_attached: Boolean(recordingUrl && result.matched),
      agent_extension: payload.agent_extension || null,
      phone_number: phoneNumber || null,
      call_record_id: result.callRecordId || null,
      detail: result.reason || (result.matched ? 'ok' : 'no_match'),
      payload: payload as Record<string, unknown>,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        matched: result.matched,
        call_record_id: result.callRecordId || null,
        recording_attached: Boolean(recordingUrl && result.matched),
        reason: result.reason,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('threecx-call-webhook failed', err);
    if (admin) {
      await logWebhookEvent(admin, {
        event_type: 'error',
        detail: err instanceof Error ? err.message : 'Webhook processing failed',
      });
    }
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Webhook processing failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
