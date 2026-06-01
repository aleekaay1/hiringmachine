// Send email via G Suite / Gmail SMTP. Requires auth (validated below; gateway verify_jwt off in config).
// Deploy: supabase functions deploy send-email
// Secrets (Dashboard → Edge Functions → Secrets): SMTP_HOSTNAME, SMTP_PORT, SMTP_SECURE, SMTP_USERNAME, SMTP_PASSWORD, SMTP_FROM

import nodemailer from 'npm:nodemailer@6.9.10';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { insertEmailSendLog } from '../_shared/emailSendLog.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  // apikey: required by Supabase gateway + browser preflight when calling from the web app
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
};

function getTransport() {
  const host = Deno.env.get('SMTP_HOSTNAME')?.trim();
  const port = Number(Deno.env.get('SMTP_PORT') ?? 587);
  const secure = (Deno.env.get('SMTP_SECURE') ?? 'false') === 'true';
  // Trim: pasted secrets often include accidental newlines/spaces (breaks Gmail auth).
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
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    // Use anon key + forwarded JWT (Supabase-recommended). Avoids failures when
    // SUPABASE_SERVICE_ROLE_KEY was overridden with a wrong value in Dashboard secrets.
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    if (!anonKey) {
      return new Response(JSON.stringify({ error: 'Server misconfiguration (missing SUPABASE_ANON_KEY)' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error } = await supabase.auth.getUser();
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
    const cc = typeof body?.cc === 'string' ? body.cc.trim() : '';
    const rawAttachments = Array.isArray(body?.attachments) ? body.attachments : [];
    const triggerLabel =
      typeof body?.trigger === 'string' && body.trigger.trim() ? body.trigger.trim() : null;
    const logCandidateId =
      body?.candidateId != null && String(body.candidateId).trim()
        ? String(body.candidateId).trim()
        : null;
    const inReplyTo = typeof body?.inReplyTo === 'string' ? body.inReplyTo.trim() : '';
    const references = typeof body?.references === 'string' ? body.references.trim() : '';

    if (!to || !subject) {
      return new Response(JSON.stringify({ error: 'Missing to or subject' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const from =
      Deno.env.get('SMTP_FROM')?.trim() ||
      Deno.env.get('SMTP_USERNAME')?.trim() ||
      'noreply@example.com';
    const attachments = rawAttachments
      .map((a: { filename?: string; content?: string; contentType?: string }) => {
        const filename = typeof a?.filename === 'string' && a.filename.trim() ? a.filename.trim() : 'attachment';
        const content = typeof a?.content === 'string' ? a.content.trim() : '';
        if (!content) return null;
        return {
          filename,
          content,
          encoding: 'base64' as const,
          contentType: typeof a?.contentType === 'string' ? a.contentType : undefined,
        };
      })
      .filter(Boolean) as Array<{
      filename: string;
      content: string;
      encoding: 'base64';
      contentType?: string;
    }>;

    const htmlBody = typeof bodyHtml === 'string' ? bodyHtml.trim() : '';
    const textBody = typeof bodyText === 'string' ? bodyText.trim() : '';
    const transport = getTransport();
    try {
      await new Promise<void>((resolve, reject) => {
        transport.sendMail(
          {
            from,
            to,
            ...(cc ? { cc } : {}),
            subject,
            ...(htmlBody
              ? textBody
                ? { html: htmlBody, text: textBody }
                : { html: htmlBody }
              : textBody
                ? { text: textBody }
                : {}),
            ...(attachments.length ? { attachments } : {}),
            ...(inReplyTo ? { inReplyTo } : {}),
            ...(references ? { references } : {}),
          },
          (err: Error | null) => (err ? reject(err) : resolve())
        );
      });
    } catch (sendErr) {
      const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();
      if (serviceRole) {
        const logClient = createClient(supabaseUrl, serviceRole);
        await insertEmailSendLog(logClient, {
          source: 'send-email',
          trigger_label: triggerLabel,
          from_email: from,
          to_email: to,
          cc_email: cc || null,
          subject,
          candidate_id: logCandidateId,
          sent_by_user_id: user.id,
          status: 'failed',
          error_message: sendErr instanceof Error ? sendErr.message : String(sendErr),
          metadata: { attachmentCount: attachments.length },
        });
      }
      throw sendErr;
    }

    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();
    if (serviceRole) {
      const logClient = createClient(supabaseUrl, serviceRole);
      await insertEmailSendLog(logClient, {
        source: 'send-email',
        trigger_label: triggerLabel,
        from_email: from,
        to_email: to,
        cc_email: cc || null,
        subject,
        candidate_id: logCandidateId,
        sent_by_user_id: user.id,
        status: 'sent',
        metadata: { attachmentCount: attachments.length },
      });
    }

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
