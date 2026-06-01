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

async function sendAssessmentToCandidate(
  admin: ReturnType<typeof createClient>,
  row: CandidateRow,
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

    const sendOnly =
      sendAssessmentEmails.length > 0 && invitedEmails.length === 0 && attendedEmails.length === 0;

    if (sendOnly) {
      const byEmail = await fetchCandidatesByEmails(admin, sendAssessmentEmails);
      let assessmentEmailsSent = 0;
      let assessmentEmailSendFailed = 0;
      let assessmentStageUpdated = 0;
      const assessment_send_failures: Array<{ email: string; error: string }> = [];

      for (const email of sendAssessmentEmails) {
        const row = byEmail.get(email);
        if (!row) {
          assessmentEmailSendFailed++;
          assessment_send_failures.push({ email, error: 'Not in portal' });
          continue;
        }
        try {
          const { stageUpdated } = await sendAssessmentToCandidate(admin, row);
          assessmentEmailsSent++;
          if (stageUpdated) assessmentStageUpdated++;
        } catch (sendErr) {
          assessmentEmailSendFailed++;
          assessment_send_failures.push({
            email,
            error: sendErr instanceof Error ? sendErr.message : 'Send failed',
          });
          console.error('sync-live-session-pipeline send assessment', email, sendErr);
        }
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
