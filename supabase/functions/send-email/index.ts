// Send email via G Suite / Gmail SMTP. Requires auth.
// Deploy: supabase functions deploy send-email
// Secrets (Dashboard → Edge Functions → Secrets): SMTP_HOSTNAME, SMTP_PORT, SMTP_SECURE, SMTP_USERNAME, SMTP_PASSWORD, SMTP_FROM

import nodemailer from 'npm:nodemailer@6.9.10';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

function getTransport() {
  const host = Deno.env.get('SMTP_HOSTNAME');
  const port = Number(Deno.env.get('SMTP_PORT') ?? 587);
  const secure = (Deno.env.get('SMTP_SECURE') ?? 'false') === 'true';
  const user = Deno.env.get('SMTP_USERNAME');
  const pass = Deno.env.get('SMTP_PASSWORD');
  if (!host || !user || !pass) {
    throw new Error('Missing SMTP config (SMTP_HOSTNAME, SMTP_USERNAME, SMTP_PASSWORD)');
  }
  return nodemailer.createTransport({
    host,
    port: Number.isNaN(port) ? 587 : port,
    secure,
    auth: { user, pass },
    ...(port === 587 && !secure ? { requireTLS: true } : {}),
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
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
    const token = authHeader.slice(7);
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return new Response(JSON.stringify({ error: 'Invalid or expired session' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const to = body?.to?.trim();
    const subject = body?.subject?.trim();
    const bodyHtml = body?.bodyHtml;
    const bodyText = body?.bodyText;

    if (!to || !subject) {
      return new Response(JSON.stringify({ error: 'Missing to or subject' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const from = Deno.env.get('SMTP_FROM') || Deno.env.get('SMTP_USERNAME') || 'noreply@example.com';
    const transport = getTransport();
    await new Promise<void>((resolve, reject) => {
      transport.sendMail(
        {
          from,
          to,
          subject,
          text: bodyText || (typeof bodyHtml === 'string' ? bodyHtml.replace(/<[^>]*>/g, '') : ''),
          html: typeof bodyHtml === 'string' ? bodyHtml : undefined,
        },
        (err: Error | null) => (err ? reject(err) : resolve())
      );
    });

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    console.error('Send email error:', e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : 'Failed to send email' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
