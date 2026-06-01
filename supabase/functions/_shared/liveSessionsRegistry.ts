import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

type CalendlyMeta = {
  name?: string;
  start_time?: string;
  end_time?: string;
  status?: string;
  uri?: string;
} | null;

type ZoomMeta = {
  uuid: string;
  topic: string;
  start_time: string;
  start_at_ms?: number | null;
  duration_minutes: number;
  host_email: string;
  join_url?: string;
  meeting_id?: string | number;
};

export type RegistryPastRow = {
  source: 'past';
  session_type?: string | null;
  zoom: ZoomMeta;
  calendly: CalendlyMeta;
  invitees: Array<{
    email: string;
    name: string;
    status: string;
    no_show?: boolean;
    attended_zoom: boolean;
    match_method?: 'email' | 'name' | null;
    join_time?: string | null;
    leave_time?: string | null;
    phone_number?: string | null;
    timezone?: string | null;
    invitee_uri?: string;
    event_uri?: string;
  }>;
  stats: {
    invited_count: number;
    attended_matched_count: number;
    no_show_or_absent_count: number;
    zoom_participant_count: number;
    attendance_rate_pct?: number | null;
  };
};

export type RegistryUpcomingRow = {
  source: 'scheduled';
  session_type?: string | null;
  zoom: ZoomMeta;
  calendly: CalendlyMeta;
  invitees: Array<{
    email: string;
    name: string;
    status: string;
    no_show?: boolean;
    phone_number?: string | null;
    timezone?: string | null;
    invitee_uri?: string;
    event_uri?: string;
  }>;
};

function sessionStartMs(zoom: ZoomMeta, calendly: CalendlyMeta): number | null {
  if (calendly?.start_time) {
    const p = Date.parse(calendly.start_time);
    if (Number.isFinite(p)) return p;
  }
  if (typeof zoom.start_at_ms === 'number' && Number.isFinite(zoom.start_at_ms)) return zoom.start_at_ms;
  if (zoom.start_time) {
    const p = Date.parse(zoom.start_time);
    if (Number.isFinite(p)) return p;
  }
  return null;
}

function torontoDateKey(ms: number | null, isoFallback?: string): string {
  const useMs = ms ?? (isoFallback ? Date.parse(isoFallback) : NaN);
  if (!Number.isFinite(useMs)) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(useMs));
}

export async function persistLiveSessionsRegistry(
  admin: SupabaseClient,
  params: {
    pastMeetings: RegistryPastRow[];
    upcomingMeetings: RegistryUpcomingRow[];
    syncedAt: string;
    nowMs: number;
  },
): Promise<{ ok: boolean; sessions: number; registrants: number; error?: string }> {
  const { pastMeetings, upcomingMeetings, syncedAt, nowMs } = params;
  const syncedIso = syncedAt;
  let registrantCount = 0;

  const upsertSession = async (
    sessionDate: string,
    status: 'past' | 'upcoming',
    zoom: ZoomMeta,
    calendly: CalendlyMeta,
    stats: RegistryPastRow['stats'] | null,
    invitees: RegistryPastRow['invitees'] | RegistryUpcomingRow['invitees'],
  ) => {
    const startMs = sessionStartMs(zoom, calendly);
    const { error: occErr } = await admin.from('live_session_occurrences').upsert({
      session_date: sessionDate,
      session_start_at: startMs != null ? new Date(startMs).toISOString() : syncedIso,
      status,
      calendly_event_uri: calendly?.uri ?? null,
      calendly_event_name: calendly?.name ?? null,
      calendly_start_at: calendly?.start_time ?? null,
      zoom_meeting_uuid: zoom.uuid || null,
      zoom_topic: zoom.topic || null,
      zoom_start_at: zoom.start_time || (startMs != null ? new Date(startMs).toISOString() : null),
      zoom_duration_minutes: zoom.duration_minutes ?? 30,
      scheduled_count: stats?.invited_count ?? invitees.length,
      attended_count: stats?.attended_matched_count ?? 0,
      attendance_rate_pct: stats?.attendance_rate_pct ?? null,
      zoom_participant_count: stats?.zoom_participant_count ?? 0,
      last_synced_at: syncedIso,
      updated_at: syncedIso,
    }, { onConflict: 'session_date' });
    if (occErr) throw occErr;

    const { error: clearRegErr } = await admin
      .from('live_session_registrants')
      .delete()
      .eq('session_date', sessionDate);
    if (clearRegErr) throw clearRegErr;

    if (invitees.length === 0) return;

    const rows = invitees.map((i) => {
      const email = String(i.email ?? '').trim().toLowerCase();
      if (!email) return null;
      const pastInv = i as RegistryPastRow['invitees'][number];
      const attended = 'attended_zoom' in pastInv ? pastInv.attended_zoom : false;
      return {
        session_date: sessionDate,
        email,
        name: i.name || null,
        phone: i.phone_number ?? null,
        calendly_status: i.status || null,
        calendly_invitee_uri: i.invitee_uri ?? null,
        calendly_no_show: Boolean(i.no_show),
        attended_zoom: attended,
        zoom_join_at: pastInv.join_time ?? null,
        zoom_leave_at: pastInv.leave_time ?? null,
        match_method: pastInv.match_method ?? null,
        calendly_synced_at: syncedIso,
        zoom_synced_at: attended ? syncedIso : null,
        updated_at: syncedIso,
      };
    }).filter(Boolean) as Record<string, unknown>[];

    registrantCount += rows.length;
    const { error: regErr } = await admin.from('live_session_registrants').insert(rows);
    if (regErr) throw regErr;
  };

  try {
    const seenDates = new Set<string>();

    for (const row of pastMeetings) {
      const ms = sessionStartMs(row.zoom, row.calendly);
      const dateKey = torontoDateKey(ms, row.calendly?.start_time ?? row.zoom.start_time);
      if (!dateKey || seenDates.has(dateKey)) continue;
      seenDates.add(dateKey);
      const status: 'past' | 'upcoming' = ms != null && ms >= nowMs ? 'upcoming' : 'past';
      await upsertSession(dateKey, status, row.zoom, row.calendly, row.stats, row.invitees);
    }

    for (const row of upcomingMeetings) {
      const ms = sessionStartMs(row.zoom, row.calendly);
      const dateKey = torontoDateKey(ms, row.calendly?.start_time ?? row.zoom.start_time);
      if (!dateKey) continue;
      seenDates.add(dateKey);
      await upsertSession(dateKey, 'upcoming', row.zoom, row.calendly, null, row.invitees);
    }

    const { data: existingOcc, error: listErr } = await admin
      .from('live_session_occurrences')
      .select('session_date');
    if (listErr) throw listErr;
    const staleDates = (existingOcc ?? [])
      .map((row) => String((row as { session_date?: string }).session_date || ''))
      .filter((d) => d && !seenDates.has(d));
    const chunk = 80;
    for (let i = 0; i < staleDates.length; i += chunk) {
      const slice = staleDates.slice(i, i + chunk);
      if (!slice.length) continue;
      const { error: delErr } = await admin.from('live_session_occurrences').delete().in('session_date', slice);
      if (delErr) throw delErr;
    }

    return { ok: true, sessions: seenDates.size, registrants: registrantCount };
  } catch (e) {
    return {
      ok: false,
      sessions: 0,
      registrants: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function loadLiveSessionsRegistryPayload(
  admin: SupabaseClient,
): Promise<{
  past_meetings: RegistryPastRow[];
  upcoming_meetings: RegistryUpcomingRow[];
  generated_at: string;
  from_cache: boolean;
} | null> {
  const { data: occurrences, error: occErr } = await admin
    .from('live_session_occurrences')
    .select('*')
    .order('session_start_at', { ascending: false });

  if (occErr) {
    console.warn('[live_sessions_registry] load occurrences failed', occErr.message);
    return null;
  }
  if (!occurrences?.length) return null;

  const dates = occurrences.map((o) => o.session_date as string);
  const { data: registrants, error: regErr } = await admin
    .from('live_session_registrants')
    .select('*')
    .in('session_date', dates);

  if (regErr) {
    console.warn('[live_sessions_registry] load registrants failed', regErr.message);
    return null;
  }

  const byDate = new Map<string, typeof registrants>();
  for (const r of registrants ?? []) {
    const d = String(r.session_date);
    const list = byDate.get(d) ?? [];
    list.push(r);
    byDate.set(d, list);
  }

  const past_meetings: RegistryPastRow[] = [];
  const upcoming_meetings: RegistryUpcomingRow[] = [];
  let latestSync = '';

  for (const occ of occurrences) {
    const sessionDate = String(occ.session_date);
    const regs = byDate.get(sessionDate) ?? [];
    const calendly = occ.calendly_event_uri
      ? {
          uri: occ.calendly_event_uri,
          name: occ.calendly_event_name,
          start_time: occ.calendly_start_at,
          status: 'active',
        }
      : null;
    const zoom = {
      uuid: occ.zoom_meeting_uuid ?? '',
      topic: occ.zoom_topic ?? 'Live Online Career Session',
      start_time: occ.zoom_start_at ?? occ.calendly_start_at ?? '',
      start_at_ms: occ.session_start_at ? Date.parse(String(occ.session_start_at)) : null,
      duration_minutes: occ.zoom_duration_minutes ?? 30,
      host_email: '',
      join_url: '',
    };

    const inviteesPast = regs.map((r) => ({
      email: r.email,
      name: r.name ?? '',
      status: r.calendly_status ?? 'active',
      no_show: r.calendly_no_show,
      attended_zoom: Boolean(r.attended_zoom),
      match_method: (r.match_method as 'email' | 'name' | null) ?? null,
      join_time: r.zoom_join_at,
      leave_time: r.zoom_leave_at,
      phone_number: r.phone,
      invitee_uri: r.calendly_invitee_uri,
    }));

    const synced = String(occ.last_synced_at ?? '');
    if (synced > latestSync) latestSync = synced;

    if (occ.status === 'upcoming') {
      upcoming_meetings.push({
        source: 'scheduled',
        session_type: 'Wednesday 11:30 AM ET (30 min)',
        zoom,
        calendly,
        invitees: inviteesPast.map((i) => ({
          email: i.email,
          name: i.name,
          status: i.status,
          no_show: i.no_show,
          phone_number: i.phone_number,
          invitee_uri: i.invitee_uri,
        })),
      });
    } else {
      past_meetings.push({
        source: 'past',
        session_type: 'Wednesday 11:30 AM ET (30 min)',
        zoom,
        calendly,
        invitees: inviteesPast,
        stats: {
          invited_count: occ.scheduled_count ?? inviteesPast.length,
          attended_matched_count: occ.attended_count ?? inviteesPast.filter((i) => i.attended_zoom).length,
          no_show_or_absent_count: inviteesPast.filter((i) => !i.attended_zoom).length,
          zoom_participant_count: occ.zoom_participant_count ?? 0,
          attendance_rate_pct: occ.attendance_rate_pct,
        },
      });
    }
  }

  upcoming_meetings.sort((a, b) => sessionStartMs(a.zoom, a.calendly)! - sessionStartMs(b.zoom, b.calendly)!);
  past_meetings.sort((a, b) => sessionStartMs(b.zoom, b.calendly)! - sessionStartMs(a.zoom, a.calendly)!);

  return {
    past_meetings,
    upcoming_meetings,
    generated_at: latestSync || new Date().toISOString(),
    from_cache: true,
  };
}

export function createServiceRoleClient(supabaseUrl: string, serviceRole: string) {
  return createClient(supabaseUrl, serviceRole);
}

/** Calendly start time decides upcoming vs past (not Zoom clock). */
function torontoDateKeyFromRow(
  zoom: ZoomMeta,
  calendly: CalendlyMeta,
): string {
  const ms = sessionStartMs(zoom, calendly);
  return torontoDateKey(ms, calendly?.start_time ?? zoom.start_time);
}

/**
 * @deprecated Sync now fully replaces the registry in the database. Kept for reference/tests only.
 * Previously merged fresh API rows with older DB rows (caused stale sessions to reappear).
 */
export function mergeSyncedWithStoredRegistry(
  syncedPast: RegistryPastRow[],
  syncedUpcoming: RegistryUpcomingRow[],
  stored: {
    past_meetings: RegistryPastRow[];
    upcoming_meetings: RegistryUpcomingRow[];
  },
  nowMs: number,
): { pastMeetings: RegistryPastRow[]; upcomingMeetings: RegistryUpcomingRow[] } {
  const pastByDate = new Map<string, RegistryPastRow>();
  const upcomingByDate = new Map<string, RegistryUpcomingRow>();

  for (const row of stored.past_meetings) {
    const key = torontoDateKeyFromRow(row.zoom, row.calendly);
    if (key) pastByDate.set(key, row);
  }
  for (const row of syncedPast) {
    const key = torontoDateKeyFromRow(row.zoom, row.calendly);
    if (key) pastByDate.set(key, row);
  }

  for (const row of stored.upcoming_meetings) {
    const key = torontoDateKeyFromRow(row.zoom, row.calendly);
    if (key) upcomingByDate.set(key, row);
  }
  for (const row of syncedUpcoming) {
    const key = torontoDateKeyFromRow(row.zoom, row.calendly);
    if (key) upcomingByDate.set(key, row);
  }

  return reclassifySessionsByStart(
    [...pastByDate.values()],
    [...upcomingByDate.values()],
    nowMs,
  );
}

export function reclassifySessionsByStart(
  pastMeetings: RegistryPastRow[],
  upcomingMeetings: RegistryUpcomingRow[],
  nowMs: number,
): { pastMeetings: RegistryPastRow[]; upcomingMeetings: RegistryUpcomingRow[] } {
  const pastOut: RegistryPastRow[] = [];
  const upOut: RegistryUpcomingRow[] = [...upcomingMeetings];

  const toUpcoming = (row: RegistryPastRow): RegistryUpcomingRow => ({
    source: 'scheduled',
    session_type: row.session_type,
    zoom: { ...row.zoom, join_url: row.zoom.join_url ?? '' },
    calendly: row.calendly,
    invitees: row.invitees.map((i) => ({
      email: i.email,
      name: i.name,
      status: i.status,
      no_show: i.no_show,
      phone_number: i.phone_number ?? null,
      timezone: i.timezone ?? null,
      invitee_uri: i.invitee_uri,
      event_uri: i.event_uri,
    })),
  });

  for (const row of pastMeetings) {
    const ms = sessionStartMs(row.zoom, row.calendly);
    if (ms != null && ms >= nowMs) {
      upOut.push(toUpcoming(row));
    } else {
      pastOut.push(row);
    }
  }

  upOut.sort((a, b) => (sessionStartMs(a.zoom, a.calendly) ?? 0) - (sessionStartMs(b.zoom, b.calendly) ?? 0));
  pastOut.sort((a, b) => (sessionStartMs(b.zoom, b.calendly) ?? 0) - (sessionStartMs(a.zoom, a.calendly) ?? 0));

  return { pastMeetings: pastOut, upcomingMeetings: upOut };
}
