/**
 * Client access to live_session_occurrences (synced from Calendly + Zoom).
 */

import { supabase } from './supabaseClient';
import {
  type LiveSessionOccurrenceRecord,
  resolvedCalendarFromOccurrence,
  resolveLiveSessionCalendar,
  formatSessionDisplayLabels,
} from './calendarInvite';
import { ZOOM_MEETING_URL } from './hiringUrls';

export type { LiveSessionOccurrenceRecord };

export async function fetchNextUpcomingLiveSession(): Promise<LiveSessionOccurrenceRecord | null> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
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

export async function fetchLiveSessionByDate(sessionDate: string): Promise<LiveSessionOccurrenceRecord | null> {
  const date = String(sessionDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const { data, error } = await supabase
    .from('live_session_occurrences')
    .select(
      'session_date, session_start_at, status, calendly_event_name, calendly_start_at, zoom_duration_minutes',
    )
    .eq('session_date', date)
    .maybeSingle();
  if (error || !data) return null;
  return data as LiveSessionOccurrenceRecord;
}

export async function listUpcomingLiveSessions(limit = 16): Promise<LiveSessionOccurrenceRecord[]> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
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

export function sessionLabelsFromOccurrence(occ: LiveSessionOccurrenceRecord): { date: string; time: string } {
  const resolved = resolvedCalendarFromOccurrence(occ, ZOOM_MEETING_URL);
  return { date: resolved.displayDate, time: resolved.displayTime };
}

export function sessionLabelsFromStartIso(
  startIso: string,
  durationMinutes = 30,
): { date: string; time: string } | null {
  const parsed = Date.parse(startIso);
  if (!Number.isFinite(parsed)) return null;
  const start = new Date(parsed);
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  return formatSessionDisplayLabels(start, end);
}

export function resolveLiveSessionForEmail(
  occurrence: LiveSessionOccurrenceRecord | null,
  env: Record<string, string | undefined> = {},
) {
  return resolveLiveSessionCalendar(env, ZOOM_MEETING_URL, occurrence);
}
