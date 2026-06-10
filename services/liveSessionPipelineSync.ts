import type { LiveSessionsDashboardPayload } from './liveSessionsIntegrations';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Hidden BCC on live-session leadership assessment sends (matches edge function). */
export const LIVE_SESSION_ASSESSMENT_BCC_EMAIL = 'ali@globelife-paz.com';

function norm(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Builds email sets from the integrations dashboard: all Calendly invitees (upcoming + past),
 * and past invitees whose email matched a Zoom participant (attended_zoom).
 */
export function collectLiveSessionInviteAndAttendEmails(payload: LiveSessionsDashboardPayload): {
  invitedEmails: string[];
  attendedEmails: string[];
} {
  const invited = new Set<string>();
  const attended = new Set<string>();

  for (const m of payload.upcoming_meetings) {
    for (const i of m.invitees) {
      const e = norm(i.email);
      if (e) invited.add(e);
    }
  }
  for (const m of payload.past_meetings) {
    for (const i of m.invitees) {
      const e = norm(i.email);
      if (!e) continue;
      invited.add(e);
      if (i.attended_zoom) attended.add(e);
    }
  }

  return { invitedEmails: [...invited], attendedEmails: [...attended] };
}

/** Zoom-attended invitees with display context for the pipeline sync review UI. */
export function collectLiveSessionAttendeeProfiles(
  payload: LiveSessionsDashboardPayload,
): Array<{ email: string; displayName: string; sessionDateKey: string }> {
  const byEmail = new Map<string, { displayName: string; sessionDateKey: string }>();

  for (const m of payload.past_meetings) {
    const sessionDateKey =
      String(m.calendly?.start_time || m.zoom?.start_time || '').slice(0, 10) || '';
    for (const i of m.invitees) {
      if (!i.attended_zoom) continue;
      const email = norm(i.email);
      if (!email) continue;
      const displayName = String(i.name || '').trim() || email;
      const existing = byEmail.get(email);
      if (!existing || sessionDateKey > existing.sessionDateKey) {
        byEmail.set(email, { displayName, sessionDateKey });
      }
    }
  }

  return [...byEmail.entries()]
    .map(([email, meta]) => ({ email, ...meta }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export type LiveSessionAttendeeMatch = {
  email: string;
  displayName: string;
  sessionDateKey: string;
  candidateId: string | null;
  inPortal: boolean;
  pipelineStage: string | null;
  canSendAssessment: boolean;
  skipReason: string | null;
};

export type LiveSessionAssessmentDuplicateSource = {
  source: string;
  sentAt: string | null;
  label: string;
};

export type LiveSessionAssessmentPreviewRow = {
  email: string;
  displayName: string;
  inPortal: boolean;
  pipelineStage: string | null;
  canSendAssessment: boolean;
  skipReason: string | null;
  alreadySent: boolean;
  sentAt: string | null;
  duplicateSources: LiveSessionAssessmentDuplicateSource[];
  sessionAssessmentMode?: 'auto' | 'manual' | null;
};

export interface SyncLiveSessionPipelineResult {
  ok: true;
  invited_stage_updated: number;
  skipped_invite_not_in_portal: number;
  attended_rows_updated: number;
  skipped_attended_not_in_portal: number;
  matched_attendees: LiveSessionAttendeeMatch[];
  assessment_stage_updated?: number;
  assessment_emails_sent?: number;
  assessment_email_send_failed?: number;
}

async function postLiveSessionPipeline(
  accessToken: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { ok: false, error: 'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY' };
  }
  const token = (accessToken || '').trim() || SUPABASE_ANON_KEY;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/sync-live-session-pipeline`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = (json.error as string) || res.statusText || 'Request failed';
    return { ok: false, error: err };
  }
  return { ok: true, data: json };
}

/** Update candidate pipeline stages from Calendly/Zoom; returns matched attendees for review. */
export async function syncLiveSessionPipeline(
  accessToken: string,
  params: {
    invitedEmails: string[];
    attendedEmails: string[];
    attendeeProfiles?: Array<{ email: string; displayName: string; sessionDateKey?: string }>;
  },
): Promise<{ ok: true; data: SyncLiveSessionPipelineResult } | { ok: false; error: string }> {
  const result = await postLiveSessionPipeline(accessToken, {
    invitedEmails: params.invitedEmails,
    attendedEmails: params.attendedEmails,
    attendeeProfiles: params.attendeeProfiles ?? [],
  });
  if (!result.ok) return result;
  return { ok: true, data: result.data as unknown as SyncLiveSessionPipelineResult };
}

/** Check selected attendees against portal, session registrants, and email logs before sending. */
export async function previewLiveSessionAssessmentEmails(
  accessToken: string,
  params: {
    sessionDate: string;
    emails: string[];
    attendeeProfiles: Array<{ email: string; displayName: string; sessionDateKey: string }>;
  },
): Promise<{ ok: true; preview: LiveSessionAssessmentPreviewRow[] } | { ok: false; error: string }> {
  const result = await postLiveSessionPipeline(accessToken, {
    previewAssessment: true,
    sessionDate: params.sessionDate,
    previewAssessmentEmails: params.emails,
    attendeeProfiles: params.attendeeProfiles,
  });
  if (!result.ok) return result;
  const preview = Array.isArray(result.data.preview)
    ? (result.data.preview as LiveSessionAssessmentPreviewRow[])
    : [];
  return { ok: true, preview };
}

/** Send leadership assessment link to selected portal candidates (after sync review). */
export async function sendLiveSessionAssessmentEmails(
  accessToken: string,
  emails: string[],
  attendeeProfiles?: Array<{ email: string; displayName: string; sessionDateKey?: string }>,
  options?: { bccMonitor?: boolean },
): Promise<
  | {
      ok: true;
      assessment_emails_sent: number;
      assessment_email_send_failed: number;
      assessment_stage_updated: number;
      failed: Array<{ email: string; error: string }>;
    }
  | { ok: false; error: string }
> {
  const result = await postLiveSessionPipeline(accessToken, {
    sendAssessmentEmails: emails,
    attendeeProfiles: attendeeProfiles ?? [],
    assessmentBccMonitor: options?.bccMonitor !== false,
  });
  if (!result.ok) return result;
  const d = result.data;
  return {
    ok: true,
    assessment_emails_sent: Number(d.assessment_emails_sent || 0),
    assessment_email_send_failed: Number(d.assessment_email_send_failed || 0),
    assessment_stage_updated: Number(d.assessment_stage_updated || 0),
    failed: Array.isArray(d.assessment_send_failures)
      ? (d.assessment_send_failures as Array<{ email: string; error: string }>)
      : [],
  };
}
