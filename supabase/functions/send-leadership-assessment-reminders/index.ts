// Sends one automated reminder to candidates who checked in ≥24h ago and have not submitted the Leadership Assessment.
// Invoke on a schedule (e.g. hourly) with header: x-cron-secret: <LEADERSHIP_REMINDER_CRON_SECRET>
// Deploy: supabase functions deploy send-leadership-assessment-reminders
// Secrets: SMTP_* (same as send-candidate-email), SUPABASE_SERVICE_ROLE_KEY, LEADERSHIP_REMINDER_CRON_SECRET

import nodemailer from 'npm:nodemailer@6.9.10';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { appendCandidateEmailLog } from '../_shared/candidateEmailLog.ts';
import { insertEmailSendLog } from '../_shared/emailSendLog.ts';
import { mergePortalBcc } from '../_shared/portalEmailBcc.ts';
import {
  buildLeadershipAssessmentReminder24hHtml,
  LEADERSHIP_ASSESSMENT_REMINDER_24H_SUBJECT,
} from '../_shared/leadershipAssessment24hReminderEmail.ts';
import { getAssessmentLookupUrlForEdge } from '../_shared/stage3AssessmentLinkEmail.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info, x-cron-secret',
};

const REMINDER_DELAY_MS = 24 * 60 * 60 * 1000;

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

type CandidateRow = {
  id: string;
  email: string;
  first_name: string | null;
  timestamp: string;
  status: string | null;
  assessment: unknown;
  applicant_questionnaire: Record<string, unknown> | null;
  admin_data: Record<string, unknown> | null;
};

function anchorCheckedInAt(admin: Record<string, unknown> | null, rowTimestamp: string): string | null {
  const c = admin?.checkedInAt;
  if (typeof c === 'string' && c.trim()) return c.trim();
  if (rowTimestamp?.trim()) return rowTimestamp.trim();
  return null;
}

function isDisqualified(admin: Record<string, unknown> | null): boolean {
  return admin?.questionnaireDisqualified != null && typeof admin.questionnaireDisqualified === 'object';
}

function reminderAlreadySent(admin: Record<string, unknown> | null): boolean {
  const v = admin?.leadershipAssessmentReminder24hSentAt;
  return typeof v === 'string' && v.trim().length > 0;
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
    const cronSecret = Deno.env.get('LEADERSHIP_REMINDER_CRON_SECRET')?.trim();
    const headerSecret = req.headers.get('x-cron-secret')?.trim();
    if (!cronSecret) {
      return new Response(
        JSON.stringify({ error: 'Server misconfiguration', detail: 'LEADERSHIP_REMINDER_CRON_SECRET not set' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    if (headerSecret !== cronSecret) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const url = new URL(req.url);
    const dryRun = url.searchParams.get('dry_run') === 'true';

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceRole);

    const { data: rows, error: qErr } = await admin
      .from('candidates')
      .select('id,email,first_name,timestamp,status,assessment,applicant_questionnaire,admin_data')
      .is('assessment', null)
      .order('timestamp', { ascending: false })
      .limit(1500);

    if (qErr) {
      return new Response(JSON.stringify({ error: qErr.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const now = Date.now();
    const cutoff = now - REMINDER_DELAY_MS;
    const assessmentUrl = getAssessmentLookupUrlForEdge();

    const eligible = (rows || []).filter((r: CandidateRow) => {
      const aq = r.applicant_questionnaire;
      if (!aq || typeof aq !== 'object') return false;
      if (typeof aq.occupation !== 'string' || !aq.occupation.trim()) return false;
      if (r.assessment != null) return false;
      if (r.status === 'assessment_complete') return false;
      const ad = r.admin_data;
      if (isDisqualified(ad)) return false;
      if (reminderAlreadySent(ad)) return false;
      const anchor = anchorCheckedInAt(ad, r.timestamp);
      if (!anchor) return false;
      const t = Date.parse(anchor);
      if (!Number.isFinite(t) || t > cutoff) return false;
      return true;
    });

    const from =
      Deno.env.get('SMTP_FROM')?.trim() ||
      Deno.env.get('SMTP_USERNAME')?.trim() ||
      'noreply@example.com';

    let sent = 0;
    const errors: string[] = [];

    if (!dryRun) {
      const transport = getTransport();
      for (const r of eligible) {
        const email = (r.email || '').trim().toLowerCase();
        const firstName = ((r.first_name as string) || '').trim();
        if (!email) {
          errors.push(`skip ${r.id}: no email`);
          continue;
        }
        const html = buildLeadershipAssessmentReminder24hHtml(firstName, assessmentUrl);
        const subject = LEADERSHIP_ASSESSMENT_REMINDER_24H_SUBJECT;
        const sentAt = new Date().toISOString();
        try {
          await new Promise<void>((resolve, reject) => {
            transport.sendMail(
              {
                from,
                to: email,
                bcc: mergePortalBcc(),
                subject,
                text: html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
                html,
              },
              (err: Error | null) => (err ? reject(err) : resolve()),
            );
          });
          await appendCandidateEmailLog(
            admin,
            r.id,
            { sentAt, subject, type: 'automated_leadership_assessment_reminder_24h' },
            { leadershipAssessmentReminder24hSentAt: sentAt },
          );
          await insertEmailSendLog(admin, {
            source: 'send-leadership-assessment-reminders',
            trigger_label: 'leadership_assessment_reminder_24h',
            from_email: from,
            to_email: email,
            subject,
            candidate_id: r.id,
            status: 'sent',
            metadata: { dry_run: false },
          });
          sent += 1;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          errors.push(`${r.id}: ${msg}`);
          await insertEmailSendLog(admin, {
            source: 'send-leadership-assessment-reminders',
            trigger_label: 'leadership_assessment_reminder_24h',
            from_email: from,
            to_email: email,
            subject,
            candidate_id: r.id,
            status: 'failed',
            error_message: msg,
            metadata: {},
          });
        }
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        dry_run: dryRun,
        scanned: rows?.length ?? 0,
        eligible: eligible.length,
        sent: dryRun ? 0 : sent,
        would_send_if_not_dry_run: dryRun ? eligible.length : undefined,
        errors: errors.slice(0, 25),
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    console.error('send-leadership-assessment-reminders:', e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
