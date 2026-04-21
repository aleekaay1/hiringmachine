import type { LiveSessionsDashboardPayload } from './liveSessionsIntegrations';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

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

export interface SyncLiveSessionPipelineResult {
  ok: true;
  tagged_invite: number;
  skipped_invite_not_in_portal: number;
  attended_rows_updated: number;
  skipped_attended_not_in_portal: number;
  assessment_emails_sent: number;
  assessment_email_send_failed: number;
}

export async function syncLiveSessionPipeline(
  accessToken: string,
  params: { invitedEmails: string[]; attendedEmails: string[] }
): Promise<{ ok: true; data: SyncLiveSessionPipelineResult } | { ok: false; error: string }> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { ok: false, error: 'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY' };
  }
  const res = await fetch(`${SUPABASE_URL}/functions/v1/sync-live-session-pipeline`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      invitedEmails: params.invitedEmails,
      attendedEmails: params.attendedEmails,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = (json.error as string) || res.statusText || 'Sync failed';
    return { ok: false, error: err };
  }
  return { ok: true, data: json as unknown as SyncLiveSessionPipelineResult };
}
