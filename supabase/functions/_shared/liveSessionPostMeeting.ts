/**
 * Post–live-session automation: refresh Zoom attendance, update pipeline, send leadership assessments.
 */
import { DateTime } from 'npm:luxon@3.5.0';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { matchInviteesToParticipants } from './liveSessionAttendanceMatch.ts';
import {
  pipelineStageAfterAssessmentFormSent,
  pipelineStageAfterLiveSessionAttended,
  pipelineStageAfterLiveSessionInvited,
} from './pipelineStageLiveSession.ts';
import {
  sendStage3AssessmentLinkEmail,
  stage3AssessmentEmailAlreadySent,
} from './sendStage3AssessmentLinkEmail.ts';
import {
  fetchZoomParticipantsForSessionDate,
  type ZoomParticipant,
  zoomPastInstancesForMeetingId,
} from './zoomAttendance.ts';
import { getZoomServerToken, zoomApiGet } from './zoomServerAuth.ts';

const TZ = 'America/Toronto';
const WEDNESDAY_TARGET_MINUTES = 11 * 60 + 30;
const POST_MEETING_DELAY_MINUTES = 60;

type RegistrantRow = {
  email: string;
  name: string | null;
  phone: string | null;
  calendly_status: string | null;
  calendly_invitee_uri: string | null;
  calendly_no_show: boolean | null;
  assessment_email_sent_at?: string | null;
  assessment_email_status?: string | null;
  assessment_email_mode?: string | null;
  assessment_email_error?: string | null;
};

type CandidateRow = {
  id: string;
  email: string;
  first_name: string | null;
  admin_data: unknown;
  assessment: unknown;
};

const DEFAULT_ADMIN = {
  pipelineStage: 'Checked In',
  tags: [] as string[],
  emailsSent: [] as Array<{ sentAt: string; subject: string; type?: string }>,
  questionnaireDisqualified: null as unknown,
};

function resolveMeetingIds(): string[] {
  const raw = Deno.env.get('ZOOM_LIVE_SESSION_MEETING_ID')?.trim();
  if (!raw) return [];
  return raw.split(/[\s,;]+/).map((s) => s.replace(/\D/g, '')).filter(Boolean);
}

function parseZoomStartMs(m: Record<string, unknown>): number {
  const s = String(m.start_time ?? '');
  const p = Date.parse(s);
  return Number.isFinite(p) ? p : 0;
}

function isoDate(dt: DateTime): string {
  return dt.toFormat('yyyy-MM-dd');
}

function normEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function parseAdmin(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && raw !== null ? { ...(raw as Record<string, unknown>) } : {};
}

function mergeAdminBase(prev: Record<string, unknown>): Record<string, unknown> {
  return { ...DEFAULT_ADMIN, ...prev };
}

function isDisqualified(admin: Record<string, unknown>): boolean {
  return admin.questionnaireDisqualified != null && typeof admin.questionnaireDisqualified === 'object';
}

function hasSubmittedAssessment(assessment: unknown): boolean {
  return assessment != null && typeof assessment === 'object';
}

function assessmentSkipReason(row: CandidateRow | undefined, admin: Record<string, unknown>): string | null {
  if (!row) return 'skipped_not_in_portal';
  if (isDisqualified(admin)) return 'skipped_disqualified';
  if (hasSubmittedAssessment(row.assessment)) return 'skipped_submitted';
  if (stage3AssessmentEmailAlreadySent(admin)) return 'skipped_already_sent';
  return null;
}

async function fetchCandidatesByEmails(
  admin: SupabaseClient,
  emails: string[],
): Promise<Map<string, CandidateRow>> {
  const map = new Map<string, CandidateRow>();
  const chunk = 200;
  for (let i = 0; i < emails.length; i += chunk) {
    const slice = emails.slice(i, i + chunk);
    if (!slice.length) continue;
    const { data, error } = await admin
      .from('candidates')
      .select('id, email, first_name, admin_data, assessment')
      .in('email', slice);
    if (error) throw new Error(`candidates query: ${error.message}`);
    for (const row of data ?? []) {
      const em = normEmail(String((row as { email?: string }).email || ''));
      if (em) map.set(em, row as CandidateRow);
    }
  }
  return map;
}

async function sendAssessmentToCandidate(
  admin: SupabaseClient,
  row: CandidateRow,
  sessionDate: string,
  mode: 'auto' | 'manual',
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
    sendMode: mode,
  });

  const prevEmails = Array.isArray(merged.emailsSent) ? merged.emailsSent : [];
  merged.emailsSent = [...prevEmails, logEntry];
  merged.pipelineStage = pipelineStageAfterAssessmentFormSent(merged.pipelineStage);

  const { error } = await admin.from('candidates').update({ admin_data: merged }).eq('id', row.id);
  if (error) throw new Error(error.message);
  return { stageUpdated: true };
}

export type PostMeetingRunResult = {
  session_date: string;
  zoom_participants: number;
  matched_attended: number;
  assessments_sent: number;
  assessments_failed: number;
  assessments_skipped: number;
  errors: string[];
};

export async function runLiveSessionPostMeeting(
  admin: SupabaseClient,
  sessionDate: string,
  options?: { sendAssessments?: boolean; mode?: 'auto' | 'manual'; force?: boolean },
): Promise<PostMeetingRunResult> {
  const sendAssessments = options?.sendAssessments !== false;
  const mode = options?.mode ?? 'auto';
  const errors: string[] = [];

  const { data: occ, error: occErr } = await admin
    .from('live_session_occurrences')
    .select('*')
    .eq('session_date', sessionDate)
    .maybeSingle();
  if (occErr) throw new Error(occErr.message);
  if (!occ) throw new Error(`No live session occurrence for ${sessionDate}`);

  if (!options?.force && occ.assessment_auto_run_at && mode === 'auto') {
    return {
      session_date: sessionDate,
      zoom_participants: Number(occ.zoom_participant_count || 0),
      matched_attended: Number(occ.attended_count || 0),
      assessments_sent: Number(occ.assessment_emails_sent_count || 0),
      assessments_failed: Number(occ.assessment_emails_failed_count || 0),
      assessments_skipped: 0,
      errors: ['already_ran'],
    };
  }

  const { data: regs, error: regErr } = await admin
    .from('live_session_registrants')
    .select('*')
    .eq('session_date', sessionDate);
  if (regErr) throw new Error(regErr.message);

  const registrants = (regs ?? []) as Array<RegistrantRow & { session_date: string }>;
  const rawInvitees = registrants.map((r) => ({
    email: r.email,
    name: r.name || '',
    status: r.calendly_status || 'active',
    no_show: Boolean(r.calendly_no_show),
    phone_number: r.phone,
    invitee_uri: r.calendly_invitee_uri,
  }));

  let participants: ZoomParticipant[] = [];
  try {
    const token = await getZoomServerToken();
    const meetingIds = resolveMeetingIds();
    const pastInstancesCache = new Map<string, Record<string, unknown>[]>();
    if (meetingIds.length) {
      for (const id of meetingIds) {
        pastInstancesCache.set(id, await zoomPastInstancesForMeetingId(zoomApiGet, token, id));
      }
    }
    const fetch = await fetchZoomParticipantsForSessionDate({
      zoomApiBase: 'https://api.zoom.us/v2',
      token,
      zoomGet: zoomApiGet,
      dateKey: sessionDate,
      targetMinutes: WEDNESDAY_TARGET_MINUTES,
      meetingHint: null,
      targetMeetingIds: meetingIds,
      pastInstancesCache,
      parseZoomStartMs,
      isoDateFn: isoDate,
      timeZone: TZ,
    });
    participants = fetch.participants;
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }

  const matched = matchInviteesToParticipants(rawInvitees, participants);
  const nowIso = new Date().toISOString();

  let assessmentsSent = 0;
  let assessmentsFailed = 0;
  let assessmentsSkipped = 0;

  const attendedEmails = matched.invitees.filter((i) => i.attended_zoom).map((i) => normEmail(i.email));
  const allEmails = [...new Set([...rawInvitees.map((i) => normEmail(i.email)), ...attendedEmails])];
  const candidatesByEmail = await fetchCandidatesByEmails(admin, allEmails);

  for (const inv of matched.invitees) {
    const email = normEmail(inv.email);
    if (!email) continue;
    const existing = registrants.find((r) => normEmail(r.email) === email);
    const preserveAssessment =
      existing?.assessment_email_sent_at && existing.assessment_email_status === 'sent'
        ? {
            assessment_email_sent_at: existing.assessment_email_sent_at,
            assessment_email_status: existing.assessment_email_status,
            assessment_email_mode: existing.assessment_email_mode,
            assessment_email_error: null,
          }
        : {};

    const row: Record<string, unknown> = {
      session_date: sessionDate,
      email,
      name: inv.name || null,
      phone: existing?.phone ?? null,
      calendly_status: inv.status || existing?.calendly_status || null,
      calendly_invitee_uri: existing?.calendly_invitee_uri ?? null,
      calendly_no_show: Boolean(inv.no_show),
      attended_zoom: inv.attended_zoom,
      zoom_join_at: inv.join_time ?? null,
      zoom_leave_at: inv.leave_time ?? null,
      match_method: inv.match_method ?? null,
      zoom_synced_at: inv.attended_zoom ? nowIso : existing ? null : null,
      updated_at: nowIso,
      ...preserveAssessment,
    };

    if (inv.attended_zoom && sendAssessments && !preserveAssessment.assessment_email_sent_at) {
      const candidate = candidatesByEmail.get(email);
      const adminData = candidate ? mergeAdminBase(parseAdmin(candidate.admin_data)) : {};
      const skip = assessmentSkipReason(candidate, adminData);
      if (skip) {
        assessmentsSkipped++;
        row.assessment_email_status = skip;
        row.assessment_email_error = skip.replace(/^skipped_/, '').replace(/_/g, ' ');
      } else {
        try {
          await sendAssessmentToCandidate(admin, candidate!, sessionDate, mode);
          assessmentsSent++;
          row.assessment_email_sent_at = nowIso;
          row.assessment_email_status = 'sent';
          row.assessment_email_mode = mode;
          row.assessment_email_error = null;
        } catch (e) {
          assessmentsFailed++;
          const msg = e instanceof Error ? e.message : 'Send failed';
          errors.push(`${email}: ${msg}`);
          row.assessment_email_status = 'failed';
          row.assessment_email_mode = mode;
          row.assessment_email_error = msg;
        }
      }
    } else if (inv.attended_zoom && !row.assessment_email_status) {
      row.assessment_email_status = 'pending';
    }

    const { error: upErr } = await admin
      .from('live_session_registrants')
      .upsert(row, { onConflict: 'session_date,email' });
    if (upErr) errors.push(`registrant ${email}: ${upErr.message}`);
  }

  for (const email of allEmails) {
    const row = candidatesByEmail.get(email);
    if (!row) continue;
    const prev = parseAdmin(row.admin_data);
    const merged = mergeAdminBase(prev);
    const inv = matched.invitees.find((i) => normEmail(i.email) === email);
    if (!inv) continue;
    if (inv.attended_zoom) {
      merged.pipelineStage = pipelineStageAfterLiveSessionAttended(merged.pipelineStage);
    } else {
      const next = pipelineStageAfterLiveSessionInvited(merged.pipelineStage);
      merged.pipelineStage = next;
    }
    if (String(merged.pipelineStage) !== String(prev.pipelineStage ?? '')) {
      await admin.from('candidates').update({ admin_data: merged }).eq('id', row.id);
    }
  }

  const attendedCount = matched.stats.attended_matched_count;
  const { error: occUpErr } = await admin.from('live_session_occurrences').update({
    attended_count: attendedCount,
    zoom_participant_count: matched.stats.unique_zoom_attendee_count,
    attendance_rate_pct: matched.stats.attendance_rate_pct,
    assessment_auto_run_at: mode === 'auto' ? nowIso : occ.assessment_auto_run_at,
    assessment_emails_sent_count:
      Number(occ.assessment_emails_sent_count || 0) + assessmentsSent,
    assessment_emails_failed_count:
      Number(occ.assessment_emails_failed_count || 0) + assessmentsFailed,
    last_synced_at: nowIso,
    updated_at: nowIso,
    status: 'past',
  }).eq('session_date', sessionDate);
  if (occUpErr) errors.push(occUpErr.message);

  return {
    session_date: sessionDate,
    zoom_participants: matched.stats.unique_zoom_attendee_count,
    matched_attended: attendedCount,
    assessments_sent: assessmentsSent,
    assessments_failed: assessmentsFailed,
    assessments_skipped: assessmentsSkipped,
    errors,
  };
}

/** Sessions that ended ~60+ minutes ago and have not had auto assessment run yet. */
export async function findSessionsDueForAutoRun(
  admin: SupabaseClient,
  nowMs: number = Date.now(),
): Promise<string[]> {
  const now = DateTime.fromMillis(nowMs, { zone: TZ });
  const { data, error } = await admin
    .from('live_session_occurrences')
    .select('session_date, session_start_at, assessment_auto_run_at, status')
    .order('session_start_at', { ascending: false })
    .limit(30);
  if (error) throw new Error(error.message);

  const due: string[] = [];
  for (const row of data ?? []) {
    const sessionDate = String((row as { session_date?: string }).session_date || '');
    const startRaw = (row as { session_start_at?: string }).session_start_at;
    const autoRun = (row as { assessment_auto_run_at?: string | null }).assessment_auto_run_at;
    if (!sessionDate || !startRaw || autoRun) continue;
    const startMs = Date.parse(startRaw);
    if (!Number.isFinite(startMs)) continue;
    const start = DateTime.fromMillis(startMs, { zone: TZ });
    const minutesSinceStart = now.diff(start, 'minutes').minutes;
    if (minutesSinceStart >= POST_MEETING_DELAY_MINUTES && minutesSinceStart <= 24 * 60) {
      due.push(sessionDate);
    }
  }
  return due;
}
