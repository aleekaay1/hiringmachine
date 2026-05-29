import type { AppRole } from './accessControl';
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
}): BookedOutcomeClassification {
  const subtype = String(input.bookedSubtype || '').trim().toLowerCase();
  const email = normalizeEmail(input.candidateEmail);
  if (subtype !== 'webinar') {
    return {
      bucket: 'booked',
      matchedRows: 0,
      matchedEmail: email || null,
      maxWatchSeconds: 0,
      watchedSignal: false,
      reason: 'Booked subtype is not Webinar.',
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
  'Booked(Webinar) is mapped by candidate email to cached WebinarGeek rows: watched=true or >=24 min stays Booked; 1-23 min => Booked didn\'t watch; 0 min/no watch signal => Booked no show; no match or non-Webinar subtype stays Booked.';
