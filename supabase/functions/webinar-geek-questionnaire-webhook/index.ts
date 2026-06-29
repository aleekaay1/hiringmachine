/**
 * WebinarGeek → Paz portal: real-time post-webinar evaluation / questionnaire webhook.
 * Configure in WebinarGeek: Integrations → Webhooks → event "New evaluation form".
 *
 * Deploy: supabase functions deploy webinar-geek-questionnaire-webhook
 * Secret: WEBINARGEEK_WEBHOOK_SECRET (header x-webinar-geek-webhook-secret or ?secret=)
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { processIncomingQuestionnaireWebhook } from '../_shared/webinarGeekQuestionnaires.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info, x-webinar-geek-webhook-secret',
};

function webhookSecretOk(req: Request): boolean {
  const expected = Deno.env.get('WEBINARGEEK_WEBHOOK_SECRET')?.trim() || '';
  if (!expected) return true;
  const header = req.headers.get('x-webinar-geek-webhook-secret')?.trim() || '';
  if (header && header === expected) return true;
  const query = new URL(req.url).searchParams.get('secret')?.trim() || '';
  return query.length > 0 && query === expected;
}

function publicWebhookUrl(req: Request): string {
  const configured = Deno.env.get('WEBINARGEEK_WEBHOOK_PUBLIC_URL')?.trim();
  if (configured) return configured;
  const url = new URL(req.url);
  return `${url.origin}${url.pathname}`;
}

async function logWebhookEvent(
  admin: ReturnType<typeof createClient>,
  input: {
    event_type: string;
    ok?: boolean;
    detail?: string | null;
    payload?: Record<string, unknown> | null;
    wg_submission_key?: string | null;
  },
) {
  try {
    await admin.from('webinar_geek_webhook_events').insert({
      event_type: input.event_type,
      ok: input.ok ?? null,
      detail: input.detail ?? null,
      payload: input.payload ?? null,
      wg_submission_key: input.wg_submission_key ?? null,
    });
  } catch {
    // optional audit table
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

  if (req.method === 'GET') {
    const webhookUrl = publicWebhookUrl(req);
    const hasSecret = Boolean(Deno.env.get('WEBINARGEEK_WEBHOOK_SECRET')?.trim());
    return new Response(JSON.stringify({
      ok: true,
      service: 'webinar-geek-questionnaire-webhook',
      webhook_url: webhookUrl,
      secret_required: hasSecret,
      setup: {
        webinargeek: 'Integrations → Webhooks → add endpoint → trigger "New evaluation form" (evaluation form submitted)',
        secret_header: 'x-webinar-geek-webhook-secret',
        secret_query: '?secret=YOUR_SECRET',
      },
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

  await logWebhookEvent(admin, {
    event_type: String(body.event || body.type || body.trigger || 'webhook_received'),
    payload: body,
  });

  try {
    const result = await processIncomingQuestionnaireWebhook(admin, body);
    await logWebhookEvent(admin, {
      event_type: result.ok ? 'processed' : 'ignored',
      ok: result.ok,
      detail: result.error ?? null,
      wg_submission_key: result.ok ? `wg_webhook:${body.id || ''}` : null,
      payload: { submission_id: result.submission_id ?? null, matched_pipeline: result.matched_pipeline },
    });

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
    await logWebhookEvent(admin, {
      event_type: 'error',
      ok: false,
      detail: message,
      payload: body,
    });
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
