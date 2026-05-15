const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export interface ZoomMeetingCore {
  uuid: string;
  topic: string;
  start_time: string;
  /** UTC millis from Edge (reliable sort; optional on older payloads) */
  start_at_ms?: number | null;
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
  /** How this invitee was matched to a Zoom participant: 'email' | 'name' | null */
  match_method?: 'email' | 'name' | null;
  /** UTC ISO string — when they joined Zoom (present when attended_zoom = true) */
  join_time?: string | null;
  /** UTC ISO string — when they left Zoom */
  leave_time?: string | null;
  phone_number?: string | null;
  timezone?: string | null;
  questions_and_answers?: Array<{ question: string; answer: string }>;
  invitee_uri?: string;
  event_uri?: string;
}

export interface PastMeetingStats {
  invited_count: number;
  attended_matched_count: number;
  no_show_or_absent_count: number;
  zoom_participant_count: number;
  /** Computed by edge function: attended / invited × 100 (null when invited_count = 0) */
  attendance_rate_pct?: number | null;
  zoom_only_emails: string[];
}

export interface PastMeetingRow {
  source: 'past';
  /** Human label: "Tuesday 6 PM ET" or "Wednesday 11:30 AM ET" */
  session_type?: string | null;
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
  /** Emails who joined Zoom but were not on the Calendly invitee list */
  walkin_emails?: string[];
  stats: PastMeetingStats;
}

export interface UpcomingMeetingInvitee {
  email: string;
  name: string;
  status: string;
  no_show?: boolean;
  phone_number?: string | null;
  timezone?: string | null;
  questions_and_answers?: Array<{ question: string; answer: string }>;
  invitee_uri?: string;
  event_uri?: string;
}

export interface UpcomingMeetingRow {
  source: 'scheduled';
  /** Human label: "Tuesday 6 PM ET" or "Wednesday 11:30 AM ET" */
  session_type?: string | null;
  zoom: ZoomMeetingCore;
  calendly: {
    name?: string;
    start_time?: string;
    end_time?: string;
    status?: string;
    uri?: string;
  } | null;
  invitees: UpcomingMeetingInvitee[];
}

/**
 * Prefer wall time from `start_time` for bucketing — server `start_at_ms` can disagree with Zoom’s
 * string when Zoom mis-lists a row (client then fixes past vs upcoming).
 */
export function zoomMeetingStartMs(zoom: ZoomMeetingCore): number | null {
  const s = String(zoom.start_time ?? '').trim();
  if (s) {
    if (/^\d{10,16}$/.test(s)) {
      const v = Number(s);
      if (v > 1e12) return v;
      if (v > 1e9) return v * 1000;
    }
    const parsed = Date.parse(s);
    if (Number.isFinite(parsed)) return parsed;
    const t = new Date(s).getTime();
    if (Number.isFinite(t)) return t;
  }
  const n = zoom.start_at_ms;
  if (typeof n === 'number' && Number.isFinite(n)) return n;
  return null;
}

function meetingRowKey(zoom: ZoomMeetingCore): string {
  return `${zoom.uuid}|${zoom.start_time}`;
}

/** Moves rows whose `start_time` parses to a future instant out of `past_meetings` into `upcoming_meetings`. */
export function reconcileLiveSessionsPastUpcoming(
  payload: LiveSessionsDashboardPayload,
  nowMs: number = Date.now()
): LiveSessionsDashboardPayload {
  const misplaced: PastMeetingRow[] = [];
  const pastOk: PastMeetingRow[] = [];
  for (const row of payload.past_meetings) {
    const ms = zoomMeetingStartMs(row.zoom);
    if (ms != null && ms >= nowMs) misplaced.push(row);
    else pastOk.push(row);
  }

  const upcomingKeys = new Set(payload.upcoming_meetings.map((r) => meetingRowKey(r.zoom)));
  const added: UpcomingMeetingRow[] = [];
  for (const row of misplaced) {
    const k = meetingRowKey(row.zoom);
    if (upcomingKeys.has(k)) continue;
    upcomingKeys.add(k);
    added.push({
      source: 'scheduled',
      zoom: row.zoom,
      calendly: row.calendly,
      invitees: row.invitees.map((i) => ({
        email: i.email,
        name: i.name,
        status: i.status,
        no_show: i.no_show,
      })),
    });
  }

  const upcoming = [...payload.upcoming_meetings, ...added].sort((a, b) => {
    const ma = zoomMeetingStartMs(a.zoom) ?? 0;
    const mb = zoomMeetingStartMs(b.zoom) ?? 0;
    return ma - mb;
  });

  const pastSorted = [...pastOk].sort((a, b) => {
    const mb = zoomMeetingStartMs(b.zoom) ?? 0;
    const ma = zoomMeetingStartMs(a.zoom) ?? 0;
    return mb - ma;
  });

  return {
    ...payload,
    past_meetings: pastSorted,
    upcoming_meetings: upcoming,
  };
}

export interface LiveSessionsDashboardPayload {
  ok: boolean;
  generated_at: string;
  calendly_configured: boolean;
  zoom_user: { id: string; email: string };
  calendly_user: { name?: string; email?: string } | null;
  /** Deprecated filter fields — kept for backward-compat with old snapshots */
  zoom_topic_filter?: string | null;
  zoom_meeting_id_filter?: string | null;
  zoom_topic_requires_meeting_id?: boolean;
  zoom_strict_time_slots_toronto?: boolean;
  calendly_event_name_filter?: string | null;
  /** Minutes of tolerance around slot boundaries (default 20) */
  slot_tolerance_minutes?: number;
  past_meetings: PastMeetingRow[];
  upcoming_meetings: UpcomingMeetingRow[];
  calendly_events_in_range: number;
  match_tolerance_minutes?: number;
  archive?: {
    enabled: boolean;
    wroteSnapshot: boolean;
    snapshotHash?: string;
    note?: string;
  };
}

export interface IntegrationHealthPayload {
  ok: boolean;
  health: boolean;
  zoom_ok: boolean;
  zoom_error: string | null;
  calendly_configured: boolean;
  calendly_ok: boolean | null;
  calendly_error: string | null;
}

export async function fetchIntegrationHealth(
  accessToken: string
): Promise<{ ok: true; data: IntegrationHealthPayload } | { ok: false; error: string }> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { ok: false, error: 'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY' };
  }
  const url = `${SUPABASE_URL}/functions/v1/integrations-zoom-calendly?health=1`;
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
  return { ok: true, data: json as unknown as IntegrationHealthPayload };
}

export type CalendlyProbePayload = {
  ok: boolean;
  calendly_probe: boolean;
  generated_at: string;
  calendly_user: { name?: string; email?: string; uri?: string; scheduling_url?: string };
  range: { from: string; to: string; lookback_days: number; lookahead_days: number };
  event_name_keywords: string[];
  require_tue_wed: boolean;
  events_total_in_range: number;
  events_matching_live_name: number;
  events_used_for_dashboard: number;
  unique_event_type_names: string[];
  events: Array<{
    uri: string;
    name: string;
    start_time: string;
    end_time: string;
    status: string;
    toronto_date: string;
    toronto_weekday: number;
    matches_live_name: boolean;
    matches_tue_wed: boolean;
    used_for_dashboard: boolean;
    invitee_count: number;
    invitee_count_active: number;
    invitees_sample: Array<{ email: string; name: string; status: string; canceled: boolean; no_show: boolean }>;
  }>;
};

/** Log Calendly probe payload to the browser console (tables + summary). */
export function logCalendlyProbeToConsole(payload: CalendlyProbePayload): void {
  console.group('[Live sessions] Calendly probe');
  console.log('User:', payload.calendly_user);
  console.log('Range:', payload.range);
  console.log('Keywords:', payload.event_name_keywords);
  console.log('Require Tue/Wed:', payload.require_tue_wed);
  console.log(
    `Events in range: ${payload.events_total_in_range} · matching live name: ${payload.events_matching_live_name} · used on dashboard: ${payload.events_used_for_dashboard}`,
  );
  console.log('Unique Calendly event type names:', payload.unique_event_type_names);
  const liveRows = payload.events.filter((e) => e.matches_live_name);
  console.table(
    liveRows.map((e) => ({
      date: e.toronto_date,
      name: e.name,
      start: e.start_time,
      invitees: e.invitee_count_active,
      tue_wed: e.matches_tue_wed,
      dashboard: e.used_for_dashboard,
    })),
  );
  for (const e of liveRows.slice(0, 12)) {
    if (e.invitees_sample.length > 0) {
      console.log(`Invitees sample — ${e.name} (${e.start_time}):`, e.invitees_sample);
    }
  }
  console.groupEnd();
}

export async function fetchCalendlyProbe(
  accessToken: string,
): Promise<{ ok: true; data: CalendlyProbePayload } | { ok: false; error: string }> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { ok: false, error: 'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY' };
  }
  const url = `${SUPABASE_URL}/functions/v1/integrations-zoom-calendly?calendly_probe=1`;
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
    return { ok: false, error: err };
  }
  const data = json as unknown as CalendlyProbePayload;
  logCalendlyProbeToConsole(data);
  return { ok: true, data };
}

export async function fetchLiveSessionsDashboard(
  accessToken: string
): Promise<{ ok: true; data: LiveSessionsDashboardPayload } | { ok: false; error: string }> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { ok: false, error: 'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY' };
  }
  const url = `${SUPABASE_URL}/functions/v1/integrations-zoom-calendly?calendly_debug=1`;
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
  const payload = json as unknown as LiveSessionsDashboardPayload & {
    calendly_debug?: Record<string, unknown>;
  };
  if (payload.calendly_debug) {
    console.group('[Live sessions] Calendly debug (dashboard fetch)');
    console.log(payload.calendly_debug);
    console.groupEnd();
  }
  const { calendly_debug: _dbg, ...rest } = payload;
  return { ok: true, data: reconcileLiveSessionsPastUpcoming(rest) };
}
