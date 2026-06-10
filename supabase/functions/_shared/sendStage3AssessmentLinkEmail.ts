/**
 * Sends the post–live-session Leadership Assessment link (stage 3).
 * Used by sync-live-session-pipeline and kept in sync with services/emailTemplates stage3_assessment_link.
 */
import nodemailer from 'npm:nodemailer@6.9.10';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { wrapTransactionalEmailHtml } from './emailHtmlShell.ts';
import { insertEmailSendLog } from './emailSendLog.ts';
import {
  buildStage3AssessmentLinkHtml,
  getAssessmentLookupUrlForEdge,
  STAGE3_ASSESSMENT_LINK_SUBJECT,
} from './stage3AssessmentLinkEmail.ts';

export const AUTOMATED_STAGE3_AFTER_LIVE_SESSION = 'automated_stage3_after_live_session';

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

export function stage3AssessmentEmailAlreadySent(admin: Record<string, unknown> | null): boolean {
  const emails = Array.isArray(admin?.emailsSent) ? admin!.emailsSent as Array<{ type?: string }> : [];
  const sent = new Set([
    AUTOMATED_STAGE3_AFTER_LIVE_SESSION,
    'crm_template:stage3_assessment_link',
    'stage3_assessment_link',
  ]);
  return emails.some((e) => sent.has(String(e?.type || '').trim()));
}

export async function sendStage3AssessmentLinkEmail(input: {
  admin: SupabaseClient;
  candidateId: string;
  candidateEmail: string;
  firstName: string;
  sessionDate?: string;
  sendMode?: 'auto' | 'manual';
}): Promise<{ sentAt: string; subject: string; type: string }> {
  const to = input.candidateEmail.trim().toLowerCase();
  if (!to) throw new Error('missing_candidate_email');

  const assessmentUrl = getAssessmentLookupUrlForEdge();
  const inner = buildStage3AssessmentLinkHtml(input.firstName || 'there', assessmentUrl);
  const html = wrapTransactionalEmailHtml(inner);
  const subject = STAGE3_ASSESSMENT_LINK_SUBJECT;

  const from =
    Deno.env.get('SMTP_FROM')?.trim() ||
    Deno.env.get('SMTP_USERNAME')?.trim() ||
    'noreply@example.com';

  const transport = getTransport();
  await new Promise<void>((resolve, reject) => {
    transport.sendMail(
      {
        from,
        to,
        subject,
        html,
        text: html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
      },
      (err: Error | null) => (err ? reject(err) : resolve()),
    );
  });

  const sentAt = new Date().toISOString();
  await insertEmailSendLog(input.admin, {
    source: input.sendMode === 'auto' ? 'live-session-auto-assessment' : 'sync-live-session-pipeline',
    trigger_label: AUTOMATED_STAGE3_AFTER_LIVE_SESSION,
    from_email: from,
    to_email: to,
    subject,
    candidate_id: input.candidateId,
    status: 'sent',
    metadata: {
      category: 'leadership_assessment',
      send_mode: input.sendMode ?? 'manual',
      session_date: input.sessionDate ?? null,
      template: 'stage3_assessment_link',
    },
  });

  return { sentAt, subject, type: AUTOMATED_STAGE3_AFTER_LIVE_SESSION };
}
