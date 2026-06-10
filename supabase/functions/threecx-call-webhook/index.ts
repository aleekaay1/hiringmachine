/**
 * 3CX CRM ReportCall webhook — attach recording URLs to pipeline_call_records.
 * Deploy: npx supabase functions deploy threecx-call-webhook --no-verify-jwt
 * Secret: THREECX_WEBHOOK_SECRET (must match 3CX template WebhookSecret parameter)
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info, x-paz-webhook-secret',
};

type WebhookPayload = {
  source?: string;
  call_type?: string;
  call_direction?: string;
  phone_number?: string;
  agent_extension?: string;
  agent_email?: string;
  agent_first_name?: string;
  agent_last_name?: string;
  duration?: string;
  duration_seconds?: string | number;
  call_start_utc?: string;
  call_end_utc?: string;
  call_start_utc_millis?: string | number;
  call_end_utc_millis?: string | number;
  recording_url?: string;
  call_id?: string;
  queue_extension?: string;
  contact_name?: string;
};

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

function phonesMatch(a: string, b: string): boolean {
  const da = digitsOnly(a);
  const db = digitsOnly(b);
  if (!da || !db) return false;
  if (da === db) return true;
  if (da.length >= 10 && db.length >= 10) return da.slice(-10) === db.slice(-10);
  return da.endsWith(db) || db.endsWith(da);
}

function parseDurationSeconds(payload: WebhookPayload): number | null {
  const direct = Number(payload.duration_seconds);
  if (Number.isFinite(direct) && direct > 0) return Math.round(direct);
  const raw = String(payload.duration || '').trim();
  if (!raw) return null;
  const parts = raw.split(':').map((p) => Number(p));
  if (parts.some((p) => !Number.isFinite(p))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

function parseIsoTime(...values: Array<string | number | undefined | null>): number | null {
  for (const value of values) {
    if (value == null || value === '') continue;
    if (typeof value === 'number' && Number.isFinite(value)) {
      const ms = value > 1e12 ? value : value * 1000;
      const d = new Date(ms);
      if (!Number.isNaN(d.getTime())) return d.getTime();
      continue;
    }
    const d = new Date(String(value));
    if (!Number.isNaN(d.getTime())) return d.getTime();
  }
  return null;
}

function webhookSecretOk(req: Request): boolean {
  const expected = Deno.env.get('THREECX_WEBHOOK_SECRET')?.trim() || '';
  if (!expected) return true;
  const header = req.headers.get('x-paz-webhook-secret')?.trim() || '';
  if (header.length > 0 && header === expected) return true;
  const query = new URL(req.url).searchParams.get('secret')?.trim() || '';
  return query.length > 0 && query === expected;
}

async function resolveRecruiterUserIds(
  admin: ReturnType<typeof createClient>,
  extension: string,
  email: string,
): Promise<string[]> {
  const ids = new Set<string>();
  const ext = extension.trim();
  const normalizedEmail = email.trim().toLowerCase();

  if (ext) {
    const { data: settings } = await admin
      .from('pipeline_user_call_settings')
      .select('user_id')
      .eq('extension', ext);
    for (const row of settings || []) {
      if (row.user_id) ids.add(String(row.user_id));
    }

    const { data: profiles } = await admin
      .from('user_profiles')
      .select('user_id')
      .eq('extension', ext);
    for (const row of profiles || []) {
      if (row.user_id) ids.add(String(row.user_id));
    }
  }

  if (normalizedEmail) {
    const { data: byEmail } = await admin
      .from('user_profiles')
      .select('user_id')
      .ilike('email', normalizedEmail);
    for (const row of byEmail || []) {
      if (row.user_id) ids.add(String(row.user_id));
    }
  }

  return [...ids];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

  const url = new URL(req.url);
  if (req.method === 'GET' && url.searchParams.get('ping') === '1') {
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
    const payload = (await req.json()) as WebhookPayload;
    const recordingUrl = String(payload.recording_url || '').trim();
    const phoneNumber = String(payload.phone_number || '').trim();
    const callId = String(payload.call_id || '').trim() || null;
    const durationSeconds = parseDurationSeconds(payload);

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (!supabaseUrl || !serviceRole) {
      throw new Error('Missing Supabase service configuration.');
    }

    const admin = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (!recordingUrl && !callId) {
      return new Response(JSON.stringify({ ok: true, matched: false, reason: 'no_recording_url' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const recruiterIds = await resolveRecruiterUserIds(
      admin,
      String(payload.agent_extension || ''),
      String(payload.agent_email || ''),
    );

    const anchorMs =
      parseIsoTime(payload.call_end_utc_millis, payload.call_end_utc) ??
      parseIsoTime(payload.call_start_utc_millis, payload.call_start_utc) ??
      Date.now();
    const windowStart = new Date(anchorMs - 45 * 60 * 1000).toISOString();
    const windowEnd = new Date(anchorMs + 15 * 60 * 1000).toISOString();

    let query = admin
      .from('pipeline_call_records')
      .select('id, dialed_number, recruiter_user_id, disposed_at, dial_started_at, threecx_metadata, threecx_call_id')
      .gte('disposed_at', windowStart)
      .lte('disposed_at', windowEnd)
      .order('disposed_at', { ascending: false })
      .limit(80);

    if (recruiterIds.length === 1) {
      query = query.eq('recruiter_user_id', recruiterIds[0]);
    } else if (recruiterIds.length > 1) {
      query = query.in('recruiter_user_id', recruiterIds);
    }

    const { data: rows, error } = await query;
    if (error) throw error;

    const candidates = (rows || []).filter((row) => phonesMatch(phoneNumber, String(row.dialed_number || '')));
    if (candidates.length === 0) {
      return new Response(
        JSON.stringify({
          ok: true,
          matched: false,
          reason: 'no_call_record_match',
          recruiter_ids: recruiterIds,
          phone_number: phoneNumber,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const best = candidates.reduce((prev, curr) => {
      const prevDelta = Math.abs(new Date(prev.disposed_at).getTime() - anchorMs);
      const currDelta = Math.abs(new Date(curr.disposed_at).getTime() - anchorMs);
      return currDelta < prevDelta ? curr : prev;
    });

    const existingMeta =
      best.threecx_metadata && typeof best.threecx_metadata === 'object'
        ? (best.threecx_metadata as Record<string, unknown>)
        : {};

    const patch: Record<string, unknown> = {
      threecx_metadata: {
        ...existingMeta,
        threecx_call_id: callId,
        recording_url: recordingUrl || existingMeta.recording_url || null,
        duration_seconds: durationSeconds,
        threecx_report: {
          call_type: payload.call_type || null,
          call_direction: payload.call_direction || null,
          agent_extension: payload.agent_extension || null,
          agent_email: payload.agent_email || null,
          call_start_utc: payload.call_start_utc || null,
          call_end_utc: payload.call_end_utc || null,
          received_at: new Date().toISOString(),
        },
      },
    };

    if (recordingUrl) patch.recording_url = recordingUrl;
    if (callId) patch.threecx_call_id = callId;
    if (durationSeconds != null) patch.duration_seconds = durationSeconds;

    const { error: updateError } = await admin
      .from('pipeline_call_records')
      .update(patch)
      .eq('id', best.id);

    if (updateError) throw updateError;

    return new Response(
      JSON.stringify({
        ok: true,
        matched: true,
        call_record_id: best.id,
        recording_attached: Boolean(recordingUrl),
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('threecx-call-webhook failed', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Webhook processing failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
