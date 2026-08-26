/**
 * Create support ticket + notify ali@globelife-paz.com
 * Deploy: supabase functions deploy support-tickets
 */

import nodemailer from 'npm:nodemailer@6.9.10';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { mergePortalBcc } from '../_shared/portalEmailBcc.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
};

const SUPPORT_NOTIFY_EMAIL = 'ali@globelife-paz.com';
const VALID_CATEGORIES = new Set(['bug', 'access', 'pipeline', 'leaderboard', 'email', 'feature', 'other']);

function getTransport() {
  const host = Deno.env.get('SMTP_HOSTNAME')?.trim();
  const port = Number(Deno.env.get('SMTP_PORT') ?? 587);
  const secure = (Deno.env.get('SMTP_SECURE') ?? 'false') === 'true';
  const user = Deno.env.get('SMTP_USERNAME')?.trim();
  const pass = Deno.env.get('SMTP_PASSWORD')?.trim();
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({
    host,
    port: Number.isNaN(port) ? 587 : port,
    secure,
    auth: { user, pass },
    ...(port === 587 && !secure ? { requireTLS: true } : {}),
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();
    if (!serviceRole) {
      return new Response(JSON.stringify({ error: 'Server misconfiguration' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userErr,
    } = await authClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'Invalid or expired session' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const category = String(body?.category || '').trim().toLowerCase();
    const subject = String(body?.subject || '').trim();
    const ticketBody = String(body?.body || '').trim();
    const submitterName = String(body?.submitterName || '').trim() || null;

    if (!VALID_CATEGORIES.has(category)) {
      return new Response(JSON.stringify({ error: 'Invalid category' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!subject || subject.length < 3) {
      return new Response(JSON.stringify({ error: 'Subject is required (min 3 characters).' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!ticketBody || ticketBody.length < 10) {
      return new Response(JSON.stringify({ error: 'Description is required (min 10 characters).' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const submitterEmail = String(user.email || '').trim().toLowerCase();
    if (!submitterEmail) {
      return new Response(JSON.stringify({ error: 'Account email is required to submit a ticket.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(supabaseUrl, serviceRole);
    const nowIso = new Date().toISOString();

    const { data: ticket, error: ticketErr } = await admin
      .from('support_tickets')
      .insert({
        user_id: user.id,
        submitter_email: submitterEmail,
        submitter_name: submitterName,
        category,
        subject,
        body: ticketBody,
        status: 'open',
        updated_at: nowIso,
      })
      .select('*')
      .single();

    if (ticketErr || !ticket) {
      return new Response(JSON.stringify({ error: ticketErr?.message || 'Could not create ticket' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    await admin.from('support_ticket_events').insert({
      ticket_id: ticket.id,
      actor_user_id: user.id,
      actor_email: submitterEmail,
      event_type: 'created',
      message: ticketBody,
      new_status: 'open',
      visible_to_user: true,
    });

    const transport = getTransport();
    let emailSent = false;
    if (transport) {
      const from = Deno.env.get('SMTP_FROM')?.trim() || Deno.env.get('SMTP_USERNAME')?.trim();
      const html = `
        <h2>New support ticket</h2>
        <p><strong>From:</strong> ${escapeHtml(submitterName || submitterEmail)} (${escapeHtml(submitterEmail)})</p>
        <p><strong>Category:</strong> ${escapeHtml(category)}</p>
        <p><strong>Subject:</strong> ${escapeHtml(subject)}</p>
        <p><strong>Ticket ID:</strong> ${escapeHtml(String(ticket.id))}</p>
        <hr/>
        <pre style="white-space:pre-wrap;font-family:Inter,sans-serif">${escapeHtml(ticketBody)}</pre>
        <p style="color:#666;font-size:12px">Resolve in the Paz Ops Console.</p>
      `;
      try {
        await transport.sendMail({
          from,
          to: SUPPORT_NOTIFY_EMAIL,
          bcc: mergePortalBcc(),
          replyTo: submitterEmail,
          subject: `[Paz Support · ${category}] ${subject}`,
          html,
          text: `New ticket from ${submitterEmail}\nCategory: ${category}\nSubject: ${subject}\n\n${ticketBody}`,
        });
        emailSent = true;
      } catch {
        emailSent = false;
      }
    }

    return new Response(JSON.stringify({ ok: true, ticket, emailSent }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
