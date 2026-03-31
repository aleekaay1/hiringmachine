// Sends transactional emails after candidate actions (e.g. check-in submit). Uses service role to verify candidate row.
// Secrets: same SMTP as send-email + SUPABASE_SERVICE_ROLE_KEY (auto in hosted project).
// Deploy: supabase functions deploy send-candidate-email

import nodemailer from 'npm:nodemailer@6.9.10';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { applyPostCheckinMerge, POST_CHECKIN_EMAIL_SUBJECT } from '../_shared/postCheckinEmailTemplate.ts';
import { buildEmailSignatureHtml } from '../_shared/emailSignatureHtml.ts';
import { ZOOM_MEETING_URL } from '../_shared/hiringUrls.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
};

function getTransport() {
  const host = Deno.env.get('SMTP_HOSTNAME')?.trim();
  const port = Number(Deno.env.get('SMTP_PORT') ?? 587);
  const secure = (Deno.env.get('SMTP_SECURE') ?? 'false') === 'true';
  const user = Deno.env.get('SMTP_USERNAME')?.trim();
  const pass = Deno.env.get('SMTP_PASSWORD')?.trim();
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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    if (!serviceRole) {
      return new Response(JSON.stringify({ error: 'Server misconfiguration' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const candidateId = typeof body?.candidateId === 'string' ? body.candidateId.trim() : '';
    const candidateEmail = typeof body?.candidateEmail === 'string' ? body.candidateEmail.trim().toLowerCase() : '';
    const trigger = body?.trigger;

    if (!candidateId || !candidateEmail || trigger !== 'post_checkin') {
      return new Response(JSON.stringify({ error: 'Invalid request' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(supabaseUrl, serviceRole);
    const { data: row, error: qErr } = await admin
      .from('candidates')
      .select('id, email, first_name, last_name')
      .eq('id', candidateId)
      .maybeSingle();

    if (qErr || !row) {
      return new Response(JSON.stringify({ error: 'Candidate not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const dbEmail = (row.email as string).trim().toLowerCase();
    if (dbEmail !== candidateEmail) {
      return new Response(JSON.stringify({ error: 'Email mismatch' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const candidateName =
      `${(row.first_name as string) || ''} ${(row.last_name as string) || ''}`.trim() || 'Candidate';
    const sig = buildEmailSignatureHtml();
    const html = applyPostCheckinMerge(candidateName, ZOOM_MEETING_URL, sig);

    const from =
      Deno.env.get('SMTP_FROM')?.trim() ||
      Deno.env.get('SMTP_USERNAME')?.trim() ||
      'noreply@example.com';
    const transport = getTransport();
    await new Promise<void>((resolve, reject) => {
      transport.sendMail(
        {
          from,
          to: candidateEmail,
          subject: POST_CHECKIN_EMAIL_SUBJECT,
          text: html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
          html,
        },
        (err: Error | null) => (err ? reject(err) : resolve())
      );
    });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('send-candidate-email error:', e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : 'Failed to send email' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
