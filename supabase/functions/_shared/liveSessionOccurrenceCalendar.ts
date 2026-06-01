/**
 * Resolve calendar invites from live_session_occurrences (Calendly/Zoom sync).
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  type LiveSessionCalendarEvent,
  type ResolvedLiveSession,
  LIVE_SESSION_TIMEZONE,
} from './calendarInvite.ts';

export type LiveSessionOccurrenceRecord = {
  session_date: string;
  session_start_at: string;
  status: string;
  calendly_event_name: string | null;
  calendly_start_at: string | null;
  zoom_duration_minutes: number | null;
};

const DEFAULT_TITLE = 'Live Online Career Session | Globe Life AIL · Paz Organization';

export function formatSessionDisplayLabels(start: Date, end: Date): { displayDate: string; displayTime: string } {
  const displayDate = new Intl.DateTimeFormat('en-US', {
    timeZone: LIVE_SESSION_TIMEZONE,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(start);
  const timeFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: LIVE_SESSION_TIMEZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const displayTime = `${timeFmt.format(start)} – ${timeFmt.format(end)} Eastern (ET)`;
  return { displayDate, displayTime };
}

function buildEventFields(
  env: Record<string, string | undefined>,
  zoomUrl: string,
  start: Date,
  end: Date,
): LiveSessionCalendarEvent {
  const title = env.PUBLIC_LIVE_SESSION_CALENDAR_TITLE?.trim() || DEFAULT_TITLE;
  const description =
    env.PUBLIC_LIVE_SESSION_CALENDAR_DESCRIPTION?.trim() ||
    `Live Online Career Session with Globe Life AIL · Paz Organization.\n\nJoin Zoom: ${zoomUrl}\n\nPlease join at least 5 minutes early.`;

  return {
    title,
    description,
    location: env.PUBLIC_LIVE_SESSION_CALENDAR_LOCATION?.trim() || `Online (Zoom) — ${zoomUrl}`,
    zoomUrl,
    start,
    end,
    recurringWeekly: false,
  };
}

export function resolvedCalendarFromOccurrence(
  occ: LiveSessionOccurrenceRecord,
  zoomUrl: string,
  env: Record<string, string | undefined> = {},
): ResolvedLiveSession {
  const start = new Date(occ.session_start_at);
  const durationMin =
    occ.zoom_duration_minutes && Number(occ.zoom_duration_minutes) > 0
      ? Number(occ.zoom_duration_minutes)
      : 30;
  const end = new Date(start.getTime() + durationMin * 60 * 1000);
  const labels = formatSessionDisplayLabels(start, end);
  return {
    ...buildEventFields(env, zoomUrl, start, end),
    displayDate: env.PUBLIC_LIVE_SESSION_DISPLAY_DATE?.trim() || labels.displayDate,
    displayTime: env.PUBLIC_LIVE_SESSION_DISPLAY_TIME?.trim() || labels.displayTime,
    sessionDate: occ.session_date,
  };
}

export function parseIsoDate(value: string | undefined | null): Date | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return null;
  return new Date(ms);
}

export function resolveLiveSessionCalendarFromOccurrence(
  env: Record<string, string | undefined>,
  zoomUrl: string,
  occurrence: LiveSessionOccurrenceRecord | null,
): ResolvedLiveSession | null {
  const envStart = parseIsoDate(env.PUBLIC_LIVE_SESSION_START_ISO);
  const envEnd = parseIsoDate(env.PUBLIC_LIVE_SESSION_END_ISO);
  if (envStart && envEnd && envEnd.getTime() > envStart.getTime()) {
    const labels = formatSessionDisplayLabels(envStart, envEnd);
    return {
      ...buildEventFields(env, zoomUrl, envStart, envEnd),
      displayDate: env.PUBLIC_LIVE_SESSION_DISPLAY_DATE?.trim() || labels.displayDate,
      displayTime: env.PUBLIC_LIVE_SESSION_DISPLAY_TIME?.trim() || labels.displayTime,
      sessionDate: env.PUBLIC_LIVE_SESSION_DATE?.trim() || null,
    };
  }

  if (occurrence) {
    return resolvedCalendarFromOccurrence(occurrence, zoomUrl, env);
  }

  return null;
}

export async function fetchOccurrenceBySessionDate(
  admin: SupabaseClient,
  sessionDate: string,
): Promise<LiveSessionOccurrenceRecord | null> {
  const date = String(sessionDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const { data, error } = await admin
    .from('live_session_occurrences')
    .select(
      'session_date, session_start_at, status, calendly_event_name, calendly_start_at, zoom_duration_minutes',
    )
    .eq('session_date', date)
    .maybeSingle();
  if (error || !data) return null;
  return data as LiveSessionOccurrenceRecord;
}

export async function fetchNextUpcomingOccurrence(
  admin: SupabaseClient,
  now = new Date(),
): Promise<LiveSessionOccurrenceRecord | null> {
  const nowIso = now.toISOString();
  const { data, error } = await admin
    .from('live_session_occurrences')
    .select(
      'session_date, session_start_at, status, calendly_event_name, calendly_start_at, zoom_duration_minutes',
    )
    .eq('status', 'upcoming')
    .gte('session_start_at', nowIso)
    .order('session_start_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data as LiveSessionOccurrenceRecord;
}

export async function listUpcomingOccurrences(
  admin: SupabaseClient,
  limit = 12,
): Promise<LiveSessionOccurrenceRecord[]> {
  const nowIso = new Date().toISOString();
  const { data, error } = await admin
    .from('live_session_occurrences')
    .select(
      'session_date, session_start_at, status, calendly_event_name, calendly_start_at, zoom_duration_minutes',
    )
    .eq('status', 'upcoming')
    .gte('session_start_at', nowIso)
    .order('session_start_at', { ascending: true })
    .limit(limit);
  if (error || !data) return [];
  return data as LiveSessionOccurrenceRecord[];
}
