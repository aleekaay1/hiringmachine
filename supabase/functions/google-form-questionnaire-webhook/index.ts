/**
 * Google Form → Paz portal: real-time post-webinar questionnaire webhook.
 * Configure via Google Apps Script onFormSubmit (see scripts/google-form-webhook.gs).
 *
 * Deploy: supabase functions deploy google-form-questionnaire-webhook
 * Secret: GOOGLE_FORM_WEBHOOK_SECRET (or WEBINARGEEK_WEBHOOK_SECRET) via ?secret= or header
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { processIncomingGoogleFormWebhook } from '../_shared/webinarGeekQuestionnaires.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info, x-google-form-webhook-secret',
};

function webhookSecretOk(req: Request): boolean {
  const expected = Deno.env.get('GOOGLE_FORM_WEBHOOK_SECRET')?.trim()
    || Deno.env.get('WEBINARGEEK_WEBHOOK_SECRET')?.trim()
    || '';
  if (!expected) return true;
  const header = req.headers.get('x-google-form-webhook-secret')?.trim() || '';
  if (header && header === expected) return true;
  const query = new URL(req.url).searchParams.get('secret')?.trim() || '';
  return query.length > 0 && query === expected;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const admin = supabaseUrl && serviceRole
    ? createClient(supabaseUrl, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;

  if (req.method === 'GET') {
    const url = new URL(req.url);
    const hasSecret = Boolean(
      Deno.env.get('GOOGLE_FORM_WEBHOOK_SECRET')?.trim()
        || Deno.env.get('WEBINARGEEK_WEBHOOK_SECRET')?.trim(),
    );
    return new Response(JSON.stringify({
      ok: true,
      service: 'google-form-questionnaire-webhook',
      webhook_url: `${url.origin}${url.pathname}`,
      secret_required: hasSecret,
      setup: 'Google Form → Apps Script onFormSubmit → POST JSON here with ?secret=YOUR_SECRET',
    }), {
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

  if (!admin) {
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!webhookSecretOk(req)) {
    return new Response(JSON.stringify({ error: 'Invalid webhook secret' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const result = await processIncomingGoogleFormWebhook(admin, body);
    if (!result.ok) {
      return new Response(JSON.stringify(result), {
        status: 202,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
