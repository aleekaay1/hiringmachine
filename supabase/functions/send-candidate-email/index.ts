// Sends transactional emails after candidate actions: post_checkin (check-in submit), post_assessment_submit (Leadership Assessment submit).
// Secrets: same SMTP as send-email + SUPABASE_SERVICE_ROLE_KEY (auto in hosted project).
// Deploy: supabase functions deploy send-candidate-email

import nodemailer from 'npm:nodemailer@6.9.10';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { applyPostCheckinMerge, POST_CHECKIN_EMAIL_SUBJECT } from '../_shared/postCheckinEmailTemplate.ts';
import {
  applyPostAssessmentSubmitMerge,
  POST_ASSESSMENT_SUBMIT_EMAIL_SUBJECT,
} from '../_shared/postAssessmentSubmitEmailTemplate.ts';
import { buildEmailSignatureHtml } from '../_shared/emailSignatureHtml.ts';
import { ZOOM_MEETING_URL } from '../_shared/hiringUrls.ts';
import {
  buildAddToCalendarEmailHtml,
  buildGoogleCalendarUrl,
  buildIcsContent,
  buildOutlookCalendarUrl,
  resolveLiveSessionCalendar,
  liveSessionCalendarIcsUrl,
} from '../_shared/calendarInvite.ts';
import {
  buildAssessmentInternalNotificationSubject,
  parseAssessmentNotifyRecipients,
  sendAssessmentInternalNotificationIfConfigured,
  type AssessmentNotifyCandidateRow,
} from '../_shared/assessmentCompleteInternalNotification.ts';
import { appendCandidateEmailLog } from '../_shared/candidateEmailLog.ts';
import { insertEmailSendLog } from '../_shared/emailSendLog.ts';

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
    const candidateId =
      body?.candidateId != null && body.candidateId !== '' ? String(body.candidateId).trim() : '';
    const candidateEmail =
      typeof body?.candidateEmail === 'string' ? body.candidateEmail.trim().toLowerCase() : '';
    const trigger = typeof body?.trigger === 'string' ? body.trigger.trim() : '';
    const isPostCheckin = trigger === 'post_checkin';
    const isPostAssessmentSubmit = trigger === 'post_assessment_submit';

    if (!candidateId) {
      return new Response(JSON.stringify({ error: 'Invalid request', detail: 'missing_candidate_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!candidateEmail) {
      return new Response(JSON.stringify({ error: 'Invalid request', detail: 'missing_candidate_email' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!isPostCheckin && !isPostAssessmentSubmit) {
      return new Response(
        JSON.stringify({
          error: 'Invalid request',
          detail: 'invalid_trigger',
          trigger: trigger || null,
          hint: 'Expected post_checkin or post_assessment_submit.',
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const admin = createClient(supabaseUrl, serviceRole);
    const { data: row, error: qErr } = await admin
      .from('candidates')
      .select('id, email, first_name, last_name, phone, city, timestamp, status, fit_category, score')
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

    const firstName = ((row.first_name as string) || '').trim();
    const candidateName =
      `${firstName} ${(row.last_name as string) || ''}`.trim() || 'Candidate';
    const sig = buildEmailSignatureHtml();

    let subject: string;
    let html: string;
    let calendarAttachment: { filename: string; content: string; contentType: string } | undefined;

    if (isPostCheckin) {
      subject = POST_CHECKIN_EMAIL_SUBJECT;
      const liveSessionEnv = {
        PUBLIC_LIVE_SESSION_START_ISO: Deno.env.get('PUBLIC_LIVE_SESSION_START_ISO') ?? undefined,
        PUBLIC_LIVE_SESSION_END_ISO: Deno.env.get('PUBLIC_LIVE_SESSION_END_ISO') ?? undefined,
        PUBLIC_LIVE_SESSION_DISPLAY_DATE: Deno.env.get('PUBLIC_LIVE_SESSION_DISPLAY_DATE') ?? undefined,
        PUBLIC_LIVE_SESSION_DISPLAY_TIME: Deno.env.get('PUBLIC_LIVE_SESSION_DISPLAY_TIME') ?? undefined,
        PUBLIC_LIVE_SESSION_CALENDAR_TITLE: Deno.env.get('PUBLIC_LIVE_SESSION_CALENDAR_TITLE') ?? undefined,
        PUBLIC_LIVE_SESSION_CALENDAR_DESCRIPTION: Deno.env.get('PUBLIC_LIVE_SESSION_CALENDAR_DESCRIPTION') ?? undefined,
        PUBLIC_LIVE_SESSION_CALENDAR_LOCATION: Deno.env.get('PUBLIC_LIVE_SESSION_CALENDAR_LOCATION') ?? undefined,
      };
      const calendarEvent = resolveLiveSessionCalendar(liveSessionEnv, ZOOM_MEETING_URL);
      const icsUrl = liveSessionCalendarIcsUrl(`${supabaseUrl}/functions/v1`);
      const addToCalendarHtml = buildAddToCalendarEmailHtml({
        icsDownloadUrl: icsUrl,
        googleUrl: buildGoogleCalendarUrl(calendarEvent),
        outlookUrl: buildOutlookCalendarUrl(calendarEvent),
      });
      calendarAttachment = {
        filename: 'live-online-career-session.ics',
        content: buildIcsContent(calendarEvent),
        contentType: 'text/calendar; charset=utf-8',
      };
      html = applyPostCheckinMerge({
        firstName: firstName || 'there',
        sessionDate: calendarEvent.displayDate,
        sessionTime: calendarEvent.displayTime,
        zoomUrl: ZOOM_MEETING_URL,
        addToCalendarHtml,
        emailSignatureHtml: sig,
      });
    } else {
      subject = POST_ASSESSMENT_SUBMIT_EMAIL_SUBJECT;
      html = applyPostAssessmentSubmitMerge(candidateName, sig);
    }

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
          subject,
          text: html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
          html,
          ...(calendarAttachment ? { attachments: [calendarAttachment] } : {}),
        },
        (err: Error | null) => (err ? reject(err) : resolve())
      );
    });

    const sentAt = new Date().toISOString();
    const logType = isPostCheckin
      ? 'automated_post_checkin'
      : 'automated_post_assessment_submit';
    await appendCandidateEmailLog(admin, candidateId, {
      sentAt,
      subject,
      type: logType,
    });

    await insertEmailSendLog(admin, {
      source: 'send-candidate-email',
      trigger_label: isPostCheckin ? 'post_checkin' : 'post_assessment_submit',
      from_email: from,
      to_email: candidateEmail,
      subject,
      candidate_id: candidateId,
      status: 'sent',
      metadata: { path: 'candidate_transactional' },
    });

    if (isPostAssessmentSubmit) {
      const notifyRow = row as AssessmentNotifyCandidateRow;
      try {
        await sendAssessmentInternalNotificationIfConfigured(transport, from, notifyRow);
        const internalTo = parseAssessmentNotifyRecipients().join(', ');
        const internalSubject = buildAssessmentInternalNotificationSubject(
          `${firstName} ${(row.last_name as string) || ''}`.trim() || 'Candidate'
        );
        await insertEmailSendLog(admin, {
          source: 'send-candidate-email',
          trigger_label: 'post_assessment_internal_notification',
          from_email: from,
          to_email: internalTo,
          subject: internalSubject,
          candidate_id: candidateId,
          status: 'sent',
          metadata: { path: 'internal_assessment_complete' },
        });
      } catch (notifyErr) {
        console.error('send-candidate-email: internal notification failed:', notifyErr);
        try {
          const internalTo = parseAssessmentNotifyRecipients().join(', ');
          const internalSubject = buildAssessmentInternalNotificationSubject(
            `${firstName} ${(row.last_name as string) || ''}`.trim() || 'Candidate'
          );
          await insertEmailSendLog(admin, {
            source: 'send-candidate-email',
            trigger_label: 'post_assessment_internal_notification',
            from_email: from,
            to_email: internalTo,
            subject: internalSubject,
            candidate_id: candidateId,
            status: 'failed',
            error_message: notifyErr instanceof Error ? notifyErr.message : String(notifyErr),
            metadata: { path: 'internal_assessment_complete' },
          });
        } catch {
          /* ignore secondary log errors */
        }
      }
    }

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
