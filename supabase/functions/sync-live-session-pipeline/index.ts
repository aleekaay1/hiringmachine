/**
 * Applies Calendly invite + Zoom attendance from the live-sessions dashboard to portal candidates:
 * - Invited → pipeline "Invited to Live Career Overview Session"
 * - Attended (Zoom) → "Live Career Overview Session Attended"
 * - Leadership assessment email: only when client sends `sendAssessmentEmails` (manual selection)
 * Auth: Supabase JWT (same pattern as integrations-zoom-calendly).
 * Deploy: supabase functions deploy sync-live-session-pipeline
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  pipelineStageAfterAssessmentFormSent,
  pipelineStageAfterLiveSessionAttended,
  pipelineStageAfterLiveSessionInvited,
} from '../_shared/pipelineStageLiveSession.ts';
import {
  AUTOMATED_STAGE3_AFTER_LIVE_SESSION,
  LIVE_SESSION_ASSESSMENT_BCC_EMAIL,
  sendStage3AssessmentLinkEmail,
  stage3AssessmentEmailAlreadySent,
} from '../_shared/sendStage3AssessmentLinkEmail.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
};

const LEGACY_INVITE_TAG = 'Career session invited';

const DEFAULT_ADMIN = {
  notes: [] as unknown[],
  pipelineStage: 'Checked In',
  rating: null as number | null,
  interviewScheduledAt: null as string | null,
  nextStep: '',
  tags: [] as string[],
  emailsSent: [] as Array<{ sentAt: string; subject: string; type?: string }>,
  evaluation: null as {
    doneAt: string;
    evaluatorName: string;
    comments: string;
    evaluationEmailSentAt?: string;
  } | null,
  resumeReviewedAt: null as string | null,
  questionnaireDisqualified: null as unknown,
};

type CandidateRow = {
  id: string;
  email: string;
  first_name: string | null;
  admin_data: unknown;
  assessment: unknown;
};

type AttendeeProfile = { email: string; displayName: string; sessionDateKey: string };

type AttendeeMatch = {
  email: string;
  displayName: string;
  sessionDateKey: string;
  candidateId: string | null;
  inPortal: boolean;
  pipelineStage: string | null;
  canSendAssessment: boolean;
  skipReason: string | null;
};

function normEmail(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

function parseAdmin(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && raw !== null ? { ...(raw as Record<string, unknown>) } : {};
}

function mergeAdminBase(prev: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...DEFAULT_ADMIN, ...prev };
  if (Array.isArray(merged.tags)) {
    merged.tags = merged.tags.filter((t) => String(t).trim().toLowerCase() !== LEGACY_INVITE_TAG.toLowerCase());
  }
  return merged;
}

function isDisqualified(admin: Record<string, unknown>): boolean {
  return admin.questionnaireDisqualified != null && typeof admin.questionnaireDisqualified === 'object';
}

function hasSubmittedAssessment(assessment: unknown): boolean {
  return assessment != null && typeof assessment === 'object';
}

function assessmentSkipReason(row: CandidateRow | undefined, admin: Record<string, unknown>): string | null {
  if (!row) return 'Not in portal';
  if (isDisqualified(admin)) return 'Disqualified';
  if (hasSubmittedAssessment(row.assessment)) return 'Assessment already submitted';
  if (stage3AssessmentEmailAlreadySent(admin)) return 'Leadership email already sent';
  return null;
}

function canSendAssessment(row: CandidateRow | undefined, admin: Record<string, unknown>): boolean {
  return assessmentSkipReason(row, admin) === null;
}

const STAGE3_EMAIL_TRIGGERS = new Set([
  AUTOMATED_STAGE3_AFTER_LIVE_SESSION,
  'crm_template:stage3_assessment_link',
  'stage3_assessment_link',
]);

function latestIso(...dates: Array<string | null | undefined>): string | null {
  const valid = dates.filter((d): d is string => typeof d === 'string' && d.length > 0);
  if (valid.length === 0) return null;
  return valid.sort((a, b) => b.localeCompare(a))[0] ?? null;
}

function portalStage3SentAt(admin: Record<string, unknown>): string | null {
  const emails = Array.isArray(admin.emailsSent)
    ? admin.emailsSent as Array<{ sentAt?: string; type?: string }>
    : [];
  let latest: string | null = null;
  for (const entry of emails) {
    if (!STAGE3_EMAIL_TRIGGERS.has(String(entry?.type || '').trim())) continue;
    latest = latestIso(latest, entry.sentAt);
  }
  return latest;
}

type RegistrantAssessmentRow = {
  assessment_email_sent_at: string | null;
  assessment_email_status: string | null;
  assessment_email_mode: string | null;
};

async function fetchRegistrantAssessmentMap(
  admin: ReturnType<typeof createClient>,
  sessionDate: string,
  emails: string[],
): Promise<Map<string, RegistrantAssessmentRow>> {
  const map = new Map<string, RegistrantAssessmentRow>();
  if (!sessionDate || emails.length === 0) return map;
  const chunk = 200;
  for (let i = 0; i < emails.length; i += chunk) {
    const slice = emails.slice(i, i + chunk);
    const { data, error } = await admin
      .from('live_session_registrants')
      .select('email, assessment_email_sent_at, assessment_email_status, assessment_email_mode')
      .eq('session_date', sessionDate)
      .in('email', slice);
    if (error) throw new Error(`live_session_registrants query: ${error.message}`);
    for (const row of data ?? []) {
      const em = normEmail((row as { email?: string }).email);
      if (!em) continue;
      map.set(em, {
        assessment_email_sent_at: (row as RegistrantAssessmentRow).assessment_email_sent_at ?? null,
        assessment_email_status: (row as RegistrantAssessmentRow).assessment_email_status ?? null,
        assessment_email_mode: (row as RegistrantAssessmentRow).assessment_email_mode ?? null,
      });
    }
  }
  return map;
}

async function fetchStage3EmailLogMap(
  admin: ReturnType<typeof createClient>,
  emails: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (emails.length === 0) return map;
  const chunk = 200;
  for (let i = 0; i < emails.length; i += chunk) {
    const slice = emails.slice(i, i + chunk);
    const { data, error } = await admin
      .from('email_send_logs')
      .select('to_email, created_at, trigger_label')
      .in('to_email', slice)
      .eq('status', 'sent')
      .order('created_at', { ascending: false });
    if (error) throw new Error(`email_send_logs query: ${error.message}`);
    for (const row of data ?? []) {
      const em = normEmail((row as { to_email?: string }).to_email);
      if (!em || map.has(em)) continue;
      const trigger = String((row as { trigger_label?: string }).trigger_label || '').trim();
      if (!STAGE3_EMAIL_TRIGGERS.has(trigger)) continue;
      const sentAt = String((row as { created_at?: string }).created_at || '').trim();
      if (sentAt) map.set(em, sentAt);
    }
  }
  return map;
}

function registrantAlreadySent(reg: RegistrantAssessmentRow | undefined): boolean {
  if (!reg) return false;
  return reg.assessment_email_status === 'sent' || !!reg.assessment_email_sent_at;
}

function parseAttendeeProfiles(raw: unknown): Map<string, AttendeeProfile> {
  const map = new Map<string, AttendeeProfile>();
  if (!Array.isArray(raw)) return map;
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const email = normEmail(o.email);
    if (!email) continue;
    const displayName = String(o.displayName || '').trim() || email;
    const sessionDateKey = String(o.sessionDateKey || '').trim();
    map.set(email, { email, displayName, sessionDateKey });
  }
  return map;
}

function buildAttendeeMatches(
  attendedEmails: string[],
  profiles: Map<string, AttendeeProfile>,
  byEmail: Map<string, CandidateRow>,
): AttendeeMatch[] {
  return attendedEmails.map((email) => {
    const row = byEmail.get(email);
    const profile = profiles.get(email);
    const admin = row ? mergeAdminBase(parseAdmin(row.admin_data)) : {};
    const displayName =
      profile?.displayName ||
      String(row?.first_name || '').trim() ||
      email;
    const skipReason = assessmentSkipReason(row, admin);
    return {
      email,
      displayName,
      sessionDateKey: profile?.sessionDateKey || '',
      candidateId: row?.id ?? null,
      inPortal: !!row,
      pipelineStage: row ? String(admin.pipelineStage || '') || null : null,
      canSendAssessment: canSendAssessment(row, admin),
      skipReason,
    };
  });
}

async function fetchCandidatesByEmails(
  admin: ReturnType<typeof createClient>,
  emails: string[],
): Promise<Map<string, CandidateRow>> {
  const map = new Map<string, CandidateRow>();
  const chunk = 200;
  for (let i = 0; i < emails.length; i += chunk) {
    const slice = emails.slice(i, i + chunk);
    if (slice.length === 0) continue;
    const { data, error } = await admin
      .from('candidates')
      .select('id, email, first_name, admin_data, assessment')
      .in('email', slice);
    if (error) throw new Error(`candidates query: ${error.message}`);
    for (const row of data ?? []) {
      const em = normEmail((row as { email?: string }).email);
      if (em) map.set(em, row as CandidateRow);
    }
  }
  return map;
}

async function recordRegistrantAssessment(
  admin: ReturnType<typeof createClient>,
  sessionDate: string,
  email: string,
  patch: {
    status: string;
    mode: 'auto' | 'manual';
    sentAt?: string | null;
    error?: string | null;
  },
): Promise<void> {
  if (!sessionDate) return;
  await admin.from('live_session_registrants').update({
    assessment_email_status: patch.status,
    assessment_email_mode: patch.mode,
    assessment_email_sent_at: patch.sentAt ?? null,
    assessment_email_error: patch.error ?? null,
    updated_at: new Date().toISOString(),
  }).eq('session_date', sessionDate).eq('email', email);
}

async function sendAssessmentToCandidate(
  admin: ReturnType<typeof createClient>,
  row: CandidateRow,
  sessionDate: string,
  bccMonitor = false,
): Promise<{ stageUpdated: boolean }> {
  const prev = parseAdmin(row.admin_data);
  const merged = mergeAdminBase(prev);
  const skip = assessmentSkipReason(row, merged);
  if (skip) throw new Error(skip);

  const logEntry = await sendStage3AssessmentLinkEmail({
    admin,
    candidateId: row.id,
    candidateEmail: row.email,
    firstName: String(row.first_name || '').trim(),
    sessionDate,
    sendMode: 'manual',
    ...(bccMonitor ? { bcc: LIVE_SESSION_ASSESSMENT_BCC_EMAIL } : {}),
  });
  const prevEmails = Array.isArray(merged.emailsSent) ? merged.emailsSent : [];
  merged.emailsSent = [...prevEmails, logEntry];
  const stageBefore = String(merged.pipelineStage || '');
  merged.pipelineStage = pipelineStageAfterAssessmentFormSent(merged.pipelineStage);
  const stageUpdated = String(merged.pipelineStage) !== stageBefore;

  const { error: upErr } = await admin.from('candidates').update({ admin_data: merged }).eq('id', row.id);
  if (upErr) throw new Error(upErr.message);
  return { stageUpdated };
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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    if (!serviceRole) {
      return new Response(JSON.stringify({ error: 'Server misconfiguration' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const apikeyHeader = req.headers.get('apikey')?.trim() ?? '';
    const allowAnonAppRequest = apikeyHeader === anonKey;

    if (!allowAnonAppRequest) {
      if (!authHeader?.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const {
        data: { user },
        error: authErr,
      } = await userClient.auth.getUser();
      if (authErr || !user) {
        return new Response(
          JSON.stringify({
            error: 'Invalid or expired session',
            detail: authErr?.message ?? 'no_user',
          }),
          {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        );
      }
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const invitedEmails = [...new Set(asStringArray(body.invitedEmails).map(normEmail).filter((e) => e.length > 0))];
    const attendedEmails = [...new Set(asStringArray(body.attendedEmails).map(normEmail).filter((e) => e.length > 0))];
    const sendAssessmentEmails = [
      ...new Set(asStringArray(body.sendAssessmentEmails).map(normEmail).filter((e) => e.length > 0)),
    ];
    const attendeeProfiles = parseAttendeeProfiles(body.attendeeProfiles);

    const admin = createClient(supabaseUrl, serviceRole);

    const previewAssessment = body.previewAssessment === true;
    const previewEmails = [
      ...new Set(asStringArray(body.previewAssessmentEmails).map(normEmail).filter((e) => e.length > 0)),
    ];
    const sessionDate = String(body.sessionDate || '').trim();

    if (previewAssessment && previewEmails.length > 0) {
      const byEmail = await fetchCandidatesByEmails(admin, previewEmails);
      const registrantMap = await fetchRegistrantAssessmentMap(admin, sessionDate, previewEmails);
      const emailLogMap = await fetchStage3EmailLogMap(admin, previewEmails);

      const preview = previewEmails.map((email) => {
        const row = byEmail.get(email);
        const profile = attendeeProfiles.get(email);
        const mergedAdmin = row ? mergeAdminBase(parseAdmin(row.admin_data)) : {};
        const skipReason = assessmentSkipReason(row, mergedAdmin);
        const reg = registrantMap.get(email);
        const portalSentAt = row ? portalStage3SentAt(mergedAdmin) : null;
        const logSentAt = emailLogMap.get(email) ?? null;
        const sessionSentAt = reg?.assessment_email_sent_at ?? null;

        const duplicateSources: Array<{ source: string; sentAt: string | null; label: string }> = [];
        if (registrantAlreadySent(reg)) {
          duplicateSources.push({
            source: 'this_session',
            sentAt: sessionSentAt,
            label: 'This live session',
          });
        }
        if (portalSentAt) {
          duplicateSources.push({
            source: 'portal',
            sentAt: portalSentAt,
            label: 'Candidate portal history',
          });
        }
        if (logSentAt) {
          duplicateSources.push({
            source: 'email_log',
            sentAt: logSentAt,
            label: 'Email send log',
          });
        }

        const alreadySent = duplicateSources.length > 0;
        const sentAt = latestIso(sessionSentAt, portalSentAt, logSentAt);
        const canSend = canSendAssessment(row, mergedAdmin) && !alreadySent;

        return {
          email,
          displayName:
            profile?.displayName ||
            String(row?.first_name || '').trim() ||
            email,
          inPortal: !!row,
          pipelineStage: row ? String(mergedAdmin.pipelineStage || '') || null : null,
          canSendAssessment: canSend,
          skipReason: alreadySent ? 'Assessment email already sent' : skipReason,
          alreadySent,
          sentAt,
          duplicateSources,
          sessionAssessmentMode: reg?.assessment_email_mode ?? null,
        };
      });

      return new Response(
        JSON.stringify({ ok: true, preview }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const sendOnly =
      sendAssessmentEmails.length > 0 && invitedEmails.length === 0 && attendedEmails.length === 0;

    if (sendOnly) {
      const bccMonitor = body.assessmentBccMonitor !== false;
      const byEmail = await fetchCandidatesByEmails(admin, sendAssessmentEmails);
      const sessionDates = [
        ...new Set(
          sendAssessmentEmails.map((e) => attendeeProfiles.get(e)?.sessionDateKey).filter(Boolean),
        ),
      ] as string[];
      const registrantMaps = new Map<string, Map<string, RegistrantAssessmentRow>>();
      for (const sd of sessionDates) {
        const emailsForDate = sendAssessmentEmails.filter(
          (e) => attendeeProfiles.get(e)?.sessionDateKey === sd,
        );
        registrantMaps.set(sd, await fetchRegistrantAssessmentMap(admin, sd, emailsForDate));
      }
      const emailLogMap = await fetchStage3EmailLogMap(admin, sendAssessmentEmails);

      let assessmentEmailsSent = 0;
      let assessmentEmailSendFailed = 0;
      let assessmentStageUpdated = 0;
      const assessment_send_failures: Array<{ email: string; error: string }> = [];

      for (const email of sendAssessmentEmails) {
        const row = byEmail.get(email);
        const sessionDateKey = attendeeProfiles.get(email)?.sessionDateKey ?? '';
        if (!row) {
          assessmentEmailSendFailed++;
          assessment_send_failures.push({ email, error: 'Not in portal' });
          if (sessionDateKey) {
            await recordRegistrantAssessment(admin, sessionDateKey, email, {
              status: 'skipped_not_in_portal',
              mode: 'manual',
              error: 'Not in portal',
            });
          }
          continue;
        }

        const reg = sessionDateKey ? registrantMaps.get(sessionDateKey)?.get(email) : undefined;
        const mergedAdmin = mergeAdminBase(parseAdmin(row.admin_data));
        if (registrantAlreadySent(reg) || emailLogMap.has(email) || stage3AssessmentEmailAlreadySent(mergedAdmin)) {
          const sentAt = latestIso(
            reg?.assessment_email_sent_at,
            portalStage3SentAt(mergedAdmin),
            emailLogMap.get(email),
          );
          assessmentEmailSendFailed++;
          assessment_send_failures.push({
            email,
            error: sentAt
              ? `Assessment email already sent (${sentAt})`
              : 'Assessment email already sent',
          });
          continue;
        }

        try {
          const { stageUpdated } = await sendAssessmentToCandidate(admin, row, sessionDateKey, bccMonitor);
          assessmentEmailsSent++;
          if (stageUpdated) assessmentStageUpdated++;
          if (sessionDateKey) {
            await recordRegistrantAssessment(admin, sessionDateKey, email, {
              status: 'sent',
              mode: 'manual',
              sentAt: new Date().toISOString(),
            });
          }
        } catch (sendErr) {
          assessmentEmailSendFailed++;
          const msg = sendErr instanceof Error ? sendErr.message : 'Send failed';
          assessment_send_failures.push({ email, error: msg });
          if (sessionDateKey) {
            await recordRegistrantAssessment(admin, sessionDateKey, email, {
              status: msg.startsWith('skipped_') ? msg : 'failed',
              mode: 'manual',
              error: msg,
            });
          }
          console.error('sync-live-session-pipeline send assessment', email, sendErr);
        }
      }

      for (const sessionDate of sessionDates) {
        const { count } = await admin
          .from('live_session_registrants')
          .select('id', { count: 'exact', head: true })
          .eq('session_date', sessionDate)
          .eq('assessment_email_status', 'sent');
        await admin.from('live_session_occurrences').update({
          assessment_emails_sent_count: count ?? 0,
        }).eq('session_date', sessionDate);
      }

      return new Response(
        JSON.stringify({
          ok: true,
          assessment_emails_sent: assessmentEmailsSent,
          assessment_email_send_failed: assessmentEmailSendFailed,
          assessment_stage_updated: assessmentStageUpdated,
          assessment_send_failures,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const union = [...new Set([...invitedEmails, ...attendedEmails])];
    const byEmail = await fetchCandidatesByEmails(admin, union);

    let invitedStageUpdated = 0;
    let skippedInviteNoRow = 0;
    let attendedUpdated = 0;
    let attendedSkippedNoRow = 0;

    for (const email of invitedEmails) {
      const row = byEmail.get(email);
      if (!row) {
        skippedInviteNoRow++;
        continue;
      }
      const prev = parseAdmin(row.admin_data);
      const merged = mergeAdminBase(prev);
      const nextStage = pipelineStageAfterLiveSessionInvited(merged.pipelineStage);
      if (String(nextStage) === String(merged.pipelineStage)) continue;
      merged.pipelineStage = nextStage;
      const { error: upErr } = await admin.from('candidates').update({ admin_data: merged }).eq('id', row.id);
      if (upErr) {
        console.error('sync-live-session-pipeline invite tag', upErr);
        continue;
      }
      invitedStageUpdated++;
      byEmail.set(email, { ...row, admin_data: merged });
    }

    for (const email of attendedEmails) {
      const row = byEmail.get(email);
      if (!row) {
        attendedSkippedNoRow++;
        continue;
      }

      const prev = parseAdmin(row.admin_data);
      const merged = mergeAdminBase(prev);
      const stageBefore = String(merged.pipelineStage || '');
      merged.pipelineStage = pipelineStageAfterLiveSessionAttended(merged.pipelineStage);

      const { error: upErr } = await admin.from('candidates').update({ admin_data: merged }).eq('id', row.id);
      if (upErr) {
        console.error('sync-live-session-pipeline attended', upErr);
        continue;
      }
      if (String(merged.pipelineStage) !== stageBefore) {
        attendedUpdated++;
      }
      byEmail.set(email, { ...row, admin_data: merged });
    }

    const matched_attendees = buildAttendeeMatches(attendedEmails, attendeeProfiles, byEmail);

    return new Response(
      JSON.stringify({
        ok: true,
        invited_stage_updated: invitedStageUpdated,
        skipped_invite_not_in_portal: skippedInviteNoRow,
        attended_rows_updated: attendedUpdated,
        skipped_attended_not_in_portal: attendedSkippedNoRow,
        matched_attendees,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    console.error('sync-live-session-pipeline:', e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : 'Sync failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
