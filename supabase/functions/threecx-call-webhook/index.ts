/**
 * 3CX CRM ping endpoint only. ReportCall webhooks are ignored — recordings load on-demand via 3CX API.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info, x-paz-webhook-secret',
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
    detail?: string | null;
  },
) {
  try {
    await admin.from('threecx_webhook_events').insert({
      event_type: row.event_type,
      detail: row.detail ?? null,
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

  // Acknowledge ReportCall without storing payloads — fetch recordings from Call log instead.
  return new Response(
    JSON.stringify({
      ok: true,
      ignored: true,
      reason: 'fetch_on_demand',
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
