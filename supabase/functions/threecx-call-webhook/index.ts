/**
 * 3CX CRM: ping + ReportCall for recruiter extensions only (store for on-demand Load recording).
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { isKnownRecruiterExtension } from '../_shared/threecxRecordingFetch.ts';
import { parseDurationSecondsFromText } from '../_shared/threecxCallMatch.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info, x-paz-webhook-secret',
};

type WebhookPayload = {
  phone_number?: string;
  agent_extension?: string;
  recording_url?: string;
  call_id?: string;
  duration?: string;
  duration_seconds?: string | number;
  call_start_utc?: string;
  call_end_utc?: string;
};

function webhookSecretOk(req: Request): boolean {
  const expected = Deno.env.get('THREECX_WEBHOOK_SECRET')?.trim() || '';
  if (!expected) return true;
  const header = req.headers.get('x-paz-webhook-secret')?.trim() || '';
  if (header.length > 0 && header === expected) return true;
  const query = new URL(req.url).searchParams.get('secret')?.trim() || '';
  return query.length > 0 && query === expected;
}

async function logWebhookEvent(
  admin: ReturnType<typeof createClient>,
  row: {
    event_type: string;
    matched?: boolean | null;
    recording_attached?: boolean | null;
    agent_extension?: string | null;
    phone_number?: string | null;
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
      detail: row.detail ?? null,
      payload: row.payload ?? null,
    });
  } catch {
    // Table optional
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
    if (admin) await logWebhookEvent(admin, { event_type: 'ping', detail: 'crm_lookup_ping' });
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
    const extension = String(payload.agent_extension || '').trim();
    const phoneNumber = String(payload.phone_number || '').trim();
    const recordingUrl = String(payload.recording_url || '').trim();

    if (!isKnownRecruiterExtension(extension)) {
      return new Response(JSON.stringify({ ok: true, ignored: true, reason: 'non_recruiter_extension' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const hasRecording = recordingUrl.startsWith('http');
    await logWebhookEvent(admin, {
      event_type: 'report_call',
      matched: null,
      recording_attached: false,
      agent_extension: extension || null,
      phone_number: phoneNumber || null,
      detail: hasRecording ? 'stored_for_on_demand' : 'no_recording_url',
      payload: payload as Record<string, unknown>,
    });

    return new Response(JSON.stringify({ ok: true, stored: true, has_recording: hasRecording }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
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
