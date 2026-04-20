/**
 * Fetches aggregated Zoom + Calendly data via Supabase Edge Function (secrets stay server-side).
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export interface ZoomMeetingCore {
  uuid: string;
  topic: string;
  start_time: string;
  duration_minutes: number;
  host_email: string;
  meeting_id?: string | number;
  join_url?: string;
}

export interface PastMeetingParticipant {
  name?: string;
  email: string;
  join_time?: string;
  leave_time?: string;
}

export interface PastMeetingInvitee {
  email: string;
  name: string;
  status: string;
  no_show?: boolean;
  attended_zoom: boolean;
}

export interface PastMeetingStats {
  invited_count: number;
  attended_matched_count: number;
  no_show_or_absent_count: number;
  zoom_participant_count: number;
  zoom_only_emails: string[];
}

export interface PastMeetingRow {
  source: 'past';
  zoom: ZoomMeetingCore;
  calendly: {
    name?: string;
    start_time?: string;
    end_time?: string;
    status?: string;
    uri?: string;
  } | null;
  participants: PastMeetingParticipant[];
  invitees: PastMeetingInvitee[];
  stats: PastMeetingStats;
}

export interface UpcomingMeetingRow {
  source: 'scheduled';
  zoom: ZoomMeetingCore;
  calendly: {
    name?: string;
    start_time?: string;
    end_time?: string;
    status?: string;
    uri?: string;
  } | null;
}

export interface LiveSessionsDashboardPayload {
  ok: boolean;
  generated_at: string;
  zoom_user: { id: string; email: string };
  calendly_user: { name?: string; email?: string };
  past_meetings: PastMeetingRow[];
  upcoming_meetings: UpcomingMeetingRow[];
  calendly_events_in_range: number;
}

export async function fetchLiveSessionsDashboard(
  accessToken: string
): Promise<{ ok: true; data: LiveSessionsDashboardPayload } | { ok: false; error: string }> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { ok: false, error: 'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY' };
  }
  const url = `${SUPABASE_URL}/functions/v1/integrations-zoom-calendly`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: SUPABASE_ANON_KEY,
    },
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = (json.error as string) || res.statusText || 'Request failed';
    const hint = typeof json.hint === 'string' ? ` ${json.hint}` : '';
    return { ok: false, error: `${err}${hint}` };
  }
  return { ok: true, data: json as LiveSessionsDashboardPayload };
}
