/**
 * Match pipeline Booked (Live Session) dispositions to Calendly registrants + Zoom attendance
 * from live_session_registrants (synced on Live Sessions refresh).
 */

import { supabase } from './supabaseClient';
import { torontoYmdFromDate } from './webinarGeekDates';

export type LiveSessionRegistrantRow = {
  session_date: string;
  email: string;
  attended_zoom: boolean;
  calendly_no_show: boolean | null;
  zoom_join_at: string | null;
};

export function normalizeLiveSessionEmail(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase();
}

export async function loadLiveSessionRegistrantsForMatching(): Promise<LiveSessionRegistrantRow[]> {
  const { data, error } = await supabase
    .from('live_session_registrants')
    .select('session_date, email, attended_zoom, calendly_no_show, zoom_join_at');
  if (error) {
    if (/relation|does not exist|schema cache/i.test(error.message)) return [];
    throw error;
  }
  return (data || []) as LiveSessionRegistrantRow[];
}

export function buildLiveSessionRowsByEmail(
  rows: LiveSessionRegistrantRow[],
): Map<string, LiveSessionRegistrantRow[]> {
  const map = new Map<string, LiveSessionRegistrantRow[]>();
  for (const row of rows) {
    const email = normalizeLiveSessionEmail(row.email);
    if (!email) continue;
    const list = map.get(email) || [];
    list.push(row);
    map.set(email, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.session_date.localeCompare(b.session_date));
  }
  return map;
}

/** Best registrant row for a booking disposition (session on/after book date, else latest prior). */
export function pickRegistrantForDisposition(
  rows: LiveSessionRegistrantRow[],
  disposedAtMs: number,
): LiveSessionRegistrantRow | null {
  if (!rows.length) return null;
  const disposeYmd = torontoYmdFromDate(new Date(disposedAtMs));
  const onOrAfter = rows.filter((r) => r.session_date >= disposeYmd);
  if (onOrAfter.length) return onOrAfter[0];
  return rows[rows.length - 1];
}

export function liveSessionAttendedFromRegistrant(row: LiveSessionRegistrantRow): boolean {
  return row.attended_zoom === true;
}

export async function loadCandidateEmailsById(candidateIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(candidateIds.filter(Boolean))];
  const chunk = 200;
  for (let i = 0; i < unique.length; i += chunk) {
    const slice = unique.slice(i, i + chunk);
    if (!slice.length) continue;
    const { data, error } = await supabase.from('candidates').select('id, email').in('id', slice);
    if (error) throw error;
    for (const row of data || []) {
      const id = String((row as { id?: string }).id || '').trim();
      const email = normalizeLiveSessionEmail((row as { email?: string }).email);
      if (id && email) map.set(id, email);
    }
  }
  return map;
}

export const LIVE_SESSION_BOOKED_OUTCOME_RULE_LABEL =
  'Booked (Live Session) is matched by candidate email to synced Calendly/Zoom rows: Zoom attendance (attended_zoom) => showed; registered but no Zoom join => Booked no show; no registration match yet stays Booked.';
