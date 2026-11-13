// Webinar nurture sender. Same SMTP + signature path as send-email.
// Deploy: supabase functions deploy hm-nurture-sequence --project-ref ofhcnsuwrhyvxtvtdunw
// Cron: supabase/sql/paste_hm_nurture_sequence.sql (pg_cron every 15 minutes, header x-cron-secret).

import nodemailer from 'npm:nodemailer@6.9.10';
import {
  corsHeaders,
  cronSecretOk,
  json,
  normalizeEmail,
  serviceClient,
  str,
  userIsAuthenticated,
} from '../_shared/hiringMachine.ts';
import { insertEmailSendLog } from '../_shared/emailSendLog.ts';
import { buildAlexPazSignatureCardHtml } from '../_shared/agentOnboardingHtml.ts';
import { mergePortalBcc } from '../_shared/portalEmailBcc.ts';
import {
  applyNurtureTokens,
  assembleNurtureHtml,
  nurtureHtmlToText,
  parseVimeoRef,
  type NurturePerson,
} from '../_shared/nurtureEmailHtml.ts';

const SEQUENCE_ID = 'webinar-no-questionnaire';
const SEND_LIMIT = 20;

type StepRow = {
  step_number: number;
  subject: string;
  body_html: string;
  vimeo_url: string;
  delay_days: number;
};

type EnrollmentRow = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  status: string;
  current_step: number;
  next_step: number;
  next_send_at: string | null;
  last_error: string | null;
};

function smtpTransport() {
  const host = Deno.env.get('SMTP_HOSTNAME')?.trim();
  const port = Number(Deno.env.get('SMTP_PORT') ?? 587);
  const secure = (Deno.env.get('SMTP_SECURE') ?? 'false') === 'true';
  const user = Deno.env.get('SMTP_USERNAME')?.trim();
  const pass = Deno.env.get('SMTP_PASSWORD')?.trim();
  if (!host || !user || !pass) {
    throw new Error('Missing SMTP config (SMTP_HOSTNAME, SMTP_USERNAME, SMTP_PASSWORD)');
  }
  return {
    fromEmail: (
      Deno.env.get('SMTP_FROM')?.trim() ||
      user
    ).replace(/^.*<([^>]+)>.*/, '$1').trim().toLowerCase(),
    fromName: (Deno.env.get('SMTP_FROM_NAME')?.trim() || 'AO Globelife')
      .replace(/["<>]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'AO Globelife',
    transport: nodemailer.createTransport({
      host,
      port: Number.isNaN(port) ? 587 : port,
      secure,
      auth: { user, pass },
      ...(port === 587 && !secure ? { requireTLS: true } : {}),
    }),
  };
}

async function authUserId(req: Request): Promise<string | null> {
  const admin = serviceClient();
  const auth = req.headers.get('authorization') || '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

function personOf(row: EnrollmentRow): NurturePerson {
  return { firstName: row.first_name, lastName: row.last_name, email: row.email };
}

function clampDays(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(30, Math.max(0, Math.round(n)));
}

async function questionnaireSubmitted(
  admin: ReturnType<typeof serviceClient>,
  email: string,
): Promise<boolean> {
  const { data, error } = await admin.rpc('hm_nurture_questionnaire_submitted', { p_email: email });
  if (error) throw new Error(error.message);
  return data === true;
}

async function isUnsubscribed(admin: ReturnType<typeof serviceClient>, email: string): Promise<boolean> {
  const { data, error } = await admin
    .from('hm_bulk_unsubscribes')
    .select('email')
    .eq('email', normalizeEmail(email))
    .maybeSingle();
  if (error) return false;
  return Boolean(data?.email);
}

async function stopEnrollment(
  admin: ReturnType<typeof serviceClient>,
  id: string,
  reason: 'questionnaire_submitted' | 'unsubscribed',
): Promise<void> {
  const now = new Date().toISOString();
  await admin
    .from('hm_nurture_enrollments')
    .update({
      status: 'stopped',
      stop_reason: reason,
      next_send_at: null,
      stopped_at: now,
      updated_at: now,
    })
    .eq('id', id)
    .eq('status', 'active');
}

async function rememberSkip(
  admin: ReturnType<typeof serviceClient>,
  row: EnrollmentRow,
  message: string,
): Promise<void> {
  if (row.last_error === message) return;
  await admin
    .from('hm_nurture_enrollments')
    .update({ last_error: message, updated_at: new Date().toISOString() })
    .eq('id', row.id)
    .eq('status', 'active');
}

async function advanceEnrollment(
  admin: ReturnType<typeof serviceClient>,
  row: EnrollmentRow,
  stepNumber: number,
  steps: Map<number, StepRow>,
): Promise<void> {
  const now = new Date();
  const stamp = now.toISOString();
  if (stepNumber >= 6) {
    await admin
      .from('hm_nurture_enrollments')
      .update({
        status: 'completed',
        current_step: 6,
        next_step: 6,
        next_send_at: null,
        completed_at: stamp,
        last_error: null,
        updated_at: stamp,
      })
      .eq('id', row.id)
      .eq('status', 'active');
    return;
  }
  const next = steps.get(stepNumber + 1);
  const days = clampDays(next?.delay_days, 2);
  const at = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
  await admin
    .from('hm_nurture_enrollments')
    .update({
      current_step: stepNumber,
      next_step: stepNumber + 1,
      next_send_at: at,
      last_error: null,
      updated_at: stamp,
    })
    .eq('id', row.id)
    .eq('status', 'active')
    .eq('next_step', stepNumber);
}

async function sendOne(
  admin: ReturnType<typeof serviceClient>,
  row: EnrollmentRow,
  steps: Map<number, StepRow>,
  mail: ReturnType<typeof smtpTransport>,
  signatureHtml: string,
  userId: string | null,
): Promise<'sent' | 'failed' | 'stopped' | 'skipped'> {
  if (await questionnaireSubmitted(admin, row.email)) {
    await stopEnrollment(admin, row.id, 'questionnaire_submitted');
    return 'stopped';
  }
  if (await isUnsubscribed(admin, row.email)) {
    await stopEnrollment(admin, row.id, 'unsubscribed');
    return 'stopped';
  }

  const stepNumber = row.next_step;
  const step = steps.get(stepNumber);
  if (!step) {
    await rememberSkip(admin, row, `Email ${stepNumber} is missing from the sequence.`);
    return 'skipped';
  }

  const person = personOf(row);
  const subject = applyNurtureTokens(step.subject || '', person, false).trim();
  const vimeo = (step.vimeo_url || '').trim();
  const body = (step.body_html || '').trim();
  if (!subject) {
    await rememberSkip(admin, row, `Email ${stepNumber} has no subject yet, so it was not sent.`);
    return 'skipped';
  }
  if (!body && !vimeo) {
    await rememberSkip(admin, row, `Email ${stepNumber} has no body or video yet, so it was not sent.`);
    return 'skipped';
  }
  if (vimeo && !parseVimeoRef(vimeo)) {
    await rememberSkip(admin, row, `Email ${stepNumber} has a Vimeo link that could not be read.`);
    return 'skipped';
  }

  const { data: openSend } = await admin
    .from('hm_nurture_sends')
    .select('id, status')
    .eq('enrollment_id', row.id)
    .eq('step_number', stepNumber)
    .in('status', ['sent', 'claimed'])
    .maybeSingle();
  if (openSend?.status === 'sent') {
    await advanceEnrollment(admin, row, stepNumber, steps);
    return 'skipped';
  }
  if (openSend?.status === 'claimed') return 'skipped';

  const { data: claim, error: claimError } = await admin
    .from('hm_nurture_sends')
    .insert({
      enrollment_id: row.id,
      sequence_id: SEQUENCE_ID,
      step_number: stepNumber,
      email: row.email,
      subject,
      status: 'claimed',
    })
    .select('id')
    .single();
  if (claimError) {
    if (claimError.code === '23505') return 'skipped';
    throw new Error(claimError.message);
  }

  const html = assembleNurtureHtml({
    bodyHtml: body,
    vimeoUrl: vimeo,
    signatureHtml,
    person,
  });
  const text = nurtureHtmlToText(html);

  try {
    await new Promise<void>((resolve, reject) => {
      mail.transport.sendMail(
        {
          from: { name: mail.fromName, address: mail.fromEmail },
          to: row.email,
          bcc: mergePortalBcc(),
          subject,
          html,
          text,
        },
        (err: Error | null) => (err ? reject(err) : resolve()),
      );
    });
  } catch (sendErr) {
    const message = sendErr instanceof Error ? sendErr.message : String(sendErr);
    await admin
      .from('hm_nurture_sends')
      .update({ status: 'failed', error: message })
      .eq('id', claim.id);
    await admin
      .from('hm_nurture_enrollments')
      .update({
        last_error: message,
        next_send_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);
    await insertEmailSendLog(admin, {
      source: 'hm-nurture-sequence',
      trigger_label: `nurture:${row.id}:step:${stepNumber}`,
      from_email: mail.fromEmail,
      to_email: row.email,
      subject,
      sent_by_user_id: userId,
      status: 'failed',
      error_message: message,
      metadata: { enrollment_id: row.id, step_number: stepNumber },
    });
    return 'failed';
  }

  const sentAt = new Date().toISOString();
  await admin
    .from('hm_nurture_sends')
    .update({ status: 'sent', sent_at: sentAt, subject, error: null })
    .eq('id', claim.id);
  await advanceEnrollment(admin, row, stepNumber, steps);
  await insertEmailSendLog(admin, {
    source: 'hm-nurture-sequence',
    trigger_label: `nurture:${row.id}:step:${stepNumber}`,
    from_email: mail.fromEmail,
    to_email: row.email,
    subject,
    sent_by_user_id: userId,
    status: 'sent',
    metadata: {
      enrollment_id: row.id,
      step_number: stepNumber,
      body_html: html.slice(0, 50000),
    },
  });
  return 'sent';
}

async function loadDue(admin: ReturnType<typeof serviceClient>, force: boolean): Promise<EnrollmentRow[]> {
  const now = new Date().toISOString();
  const columns = 'id, email, first_name, last_name, status, current_step, next_step, next_send_at, last_error';
  const { data: dueRows, error: dueError } = await admin
    .from('hm_nurture_enrollments')
    .select(columns)
    .eq('sequence_id', SEQUENCE_ID)
    .eq('status', 'active')
    .lte('next_send_at', now)
    .order('last_error', { ascending: true, nullsFirst: true })
    .order('next_send_at', { ascending: true })
    .limit(SEND_LIMIT);
  if (dueError) throw new Error(dueError.message);
  const due = (dueRows || []) as EnrollmentRow[];
  if (!force) return due;

  const { data: retryRows, error: retryError } = await admin
    .from('hm_nurture_enrollments')
    .select(columns)
    .eq('sequence_id', SEQUENCE_ID)
    .eq('status', 'active')
    .not('last_error', 'is', null)
    .gt('next_send_at', now)
    .order('next_send_at', { ascending: true })
    .limit(SEND_LIMIT);
  if (retryError) throw new Error(retryError.message);
  const seen = new Set(due.map((row) => row.id));
  for (const row of (retryRows || []) as EnrollmentRow[]) {
    if (!seen.has(row.id)) due.push(row);
  }
  return due.slice(0, SEND_LIMIT);
}

async function tick(userId: string | null, force: boolean) {
  const admin = serviceClient();
  const autoRes = await admin.rpc('hm_nurture_auto_enroll');
  const staleBefore = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  await admin.from('hm_nurture_sends').delete().eq('status', 'claimed').lt('created_at', staleBefore);

  const { data: stepRows, error: stepError } = await admin
    .from('hm_nurture_steps')
    .select('step_number, subject, body_html, vimeo_url, delay_days')
    .eq('sequence_id', SEQUENCE_ID);
  if (stepError) throw new Error(stepError.message);
  const steps = new Map<number, StepRow>();
  for (const step of (stepRows || []) as StepRow[]) steps.set(Number(step.step_number), step);

  const due = await loadDue(admin, force);
  const counts = { sent: 0, failed: 0, stopped: 0, skipped: 0 };
  if (due.length) {
    const mail = smtpTransport();
    const signatureHtml = buildAlexPazSignatureCardHtml();
    for (const row of due) {
      const outcome = await sendOne(admin, row, steps, mail, signatureHtml, userId);
      counts[outcome] += 1;
    }
  }

  return {
    ok: true,
    auto_enroll: autoRes.error ? null : autoRes.data,
    auto_enroll_error: autoRes.error?.message || null,
    due: due.length,
    ...counts,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method === 'GET') return json(200, { ok: true, service: 'hm-nurture-sequence' });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const admin = serviceClient();
  const cronOk = cronSecretOk(req);
  const userOk = await userIsAuthenticated(req, admin);
  if (!cronOk && !userOk) return json(401, { error: 'Unauthorized' });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const action = str(body.action).toLowerCase() || 'tick';
  if (action !== 'tick' && action !== 'send_due') {
    return json(400, { error: 'Unknown action' });
  }

  try {
    const userId = userOk ? await authUserId(req) : null;
    const force = action === 'send_due' || body.force === true;
    return json(200, await tick(userId, force));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('hm-nurture-sequence', message);
    return json(500, { error: message });
  }
});
