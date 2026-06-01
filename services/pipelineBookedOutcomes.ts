import type { AppRole } from './accessControl';
import {
  buildLiveSessionRowsByEmail,
  liveSessionAttendedFromRegistrant,
  pickRegistrantForDisposition,
  type LiveSessionRegistrantRow,
} from './liveSessionBookedOutcomes';
import { filterRowsForRecruiterOwnership } from './recruiterDataScope';
import { loadWebinarGeekDashboardCache } from './webinarGeekDashboardCache';

type AnyRow = Record<string, unknown>;

export type BookedOutcomeBucket = 'booked' | 'booked_no_show' | 'booked_didnt_watch';

export type BookedOutcomeClassification = {
  bucket: BookedOutcomeBucket;
  matchedRows: number;
  matchedEmail: string | null;
  maxWatchSeconds: number;
  watchedSignal: boolean;
  reason: string;
};

const HALF_WATCH_SECONDS = Math.floor(47 * 60 * 0.5);

function normalizeEmail(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase();
}

function watchSecondsFromRow(row: AnyRow): number {
  const sec = Number(row.watch_duration || 0);
  return Number.isFinite(sec) && sec > 0 ? sec : 0;
}

function watchedSignalFromRow(row: AnyRow): boolean {
  if (row.watched === true) return true;
  return watchSecondsFromRow(row) >= HALF_WATCH_SECONDS;
}

export async function loadScopedWebinarRowsForViewer(input: {
  role: AppRole | null;
  viewerEmail: string | null;
  viewerFullName: string | null;
}): Promise<AnyRow[]> {
  const { data } = await loadWebinarGeekDashboardCache();
  const allRows = data?.subscriptions || [];
  if (input.role !== 'recruiter') return allRows;
  return filterRowsForRecruiterOwnership(allRows, input.viewerEmail, input.viewerFullName);
}

export function buildWebinarRowsByEmail(rows: AnyRow[]): Map<string, AnyRow[]> {
  const map = new Map<string, AnyRow[]>();
  for (const row of rows) {
    const email = normalizeEmail(String(row.email || ''));
    if (!email) continue;
    const list = map.get(email) || [];
    list.push(row);
    map.set(email, list);
  }
  return map;
}

export function classifyBookedOutcome(input: {
  bookedSubtype: string | null | undefined;
  candidateEmail: string | null | undefined;
  rowsByEmail: Map<string, AnyRow[]>;
  liveSessionByEmail?: Map<string, LiveSessionRegistrantRow[]>;
  disposedAtMs?: number | null;
}): BookedOutcomeClassification {
  const subtype = String(input.bookedSubtype || '').trim().toLowerCase();
  const email = normalizeEmail(input.candidateEmail);

  if (subtype === 'live session') {
    if (!email) {
      return {
        bucket: 'booked',
        matchedRows: 0,
        matchedEmail: null,
        maxWatchSeconds: 0,
        watchedSignal: false,
        reason: 'Candidate has no email for live session matching.',
      };
    }
    const liveRows = input.liveSessionByEmail?.get(email) || [];
    if (!liveRows.length) {
      return {
        bucket: 'booked',
        matchedRows: 0,
        matchedEmail: email,
        maxWatchSeconds: 0,
        watchedSignal: false,
        reason: 'No Calendly registration found for this email yet (sync Live Sessions).',
      };
    }
    const disposedMs =
      typeof input.disposedAtMs === 'number' && Number.isFinite(input.disposedAtMs)
        ? input.disposedAtMs
        : Date.now();
    const match = pickRegistrantForDisposition(liveRows, disposedMs);
    if (!match) {
      return {
        bucket: 'booked',
        matchedRows: liveRows.length,
        matchedEmail: email,
        maxWatchSeconds: 0,
        watchedSignal: false,
        reason: 'Could not resolve session date for live registration.',
      };
    }
    if (liveSessionAttendedFromRegistrant(match)) {
      return {
        bucket: 'booked',
        matchedRows: liveRows.length,
        matchedEmail: email,
        maxWatchSeconds: 0,
        watchedSignal: true,
        reason: `Zoom attendance matched for session ${match.session_date}.`,
      };
    }
    return {
      bucket: 'booked_no_show',
      matchedRows: liveRows.length,
      matchedEmail: email,
      maxWatchSeconds: 0,
      watchedSignal: false,
      reason: `Registered for ${match.session_date} but no Zoom attendance on sync.`,
    };
  }

  if (subtype !== 'webinar') {
    return {
      bucket: 'booked',
      matchedRows: 0,
      matchedEmail: email || null,
      maxWatchSeconds: 0,
      watchedSignal: false,
      reason: 'Booked subtype is not Webinar or Live Session.',
    };
  }
  if (!email) {
    return {
      bucket: 'booked',
      matchedRows: 0,
      matchedEmail: null,
      maxWatchSeconds: 0,
      watchedSignal: false,
      reason: 'Candidate has no email for WebinarGeek matching.',
    };
  }
  const rows = rowsByEmail.get(email) || [];
  if (!rows.length) {
    return {
      bucket: 'booked',
      matchedRows: 0,
      matchedEmail: email,
      maxWatchSeconds: 0,
      watchedSignal: false,
      reason: 'No matching WebinarGeek rows for candidate email.',
    };
  }
  const maxWatchSeconds = rows.reduce((max, row) => Math.max(max, watchSecondsFromRow(row)), 0);
  const watchedSignal = rows.some((row) => watchedSignalFromRow(row));
  if (watchedSignal) {
    return {
      bucket: 'booked',
      matchedRows: rows.length,
      matchedEmail: email,
      maxWatchSeconds,
      watchedSignal: true,
      reason: 'Matched WebinarGeek row shows attended/watch signal.',
    };
  }
  if (maxWatchSeconds > 0) {
    return {
      bucket: 'booked_didnt_watch',
      matchedRows: rows.length,
      matchedEmail: email,
      maxWatchSeconds,
      watchedSignal: false,
      reason: 'Matched rows only show partial watch time below half threshold.',
    };
  }
  return {
    bucket: 'booked_no_show',
    matchedRows: rows.length,
    matchedEmail: email,
    maxWatchSeconds: 0,
    watchedSignal: false,
    reason: 'Matched rows show no watch signal.',
  };
}

export const BOOKED_OUTCOME_RULE_LABEL =
  'Booked (Webinar): email → WebinarGeek watch signal. Booked (Live Session): email → Calendly/Zoom sync (attended_zoom = showed). See live session rule on filter tooltips.';

export { buildLiveSessionRowsByEmail, loadLiveSessionRegistrantsForMatching };
