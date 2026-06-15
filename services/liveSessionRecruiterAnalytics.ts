import type { UserProfile } from './accessControl';
import {
  buildLiveSessionRowsByEmail,
  buildLiveSessionRowsByPhone,
  pickRegistrantForCallDisposition,
  resolveLiveSessionOutcome,
  type LiveSessionRegistrantRow,
} from './liveSessionBookedOutcomes';
import {
  readCallRecordLiveSessionOutcome,
  type PipelineCallRecord,
} from './pipelineService';
import { COINS_PER_LIVE_SESSION_SHOW } from './recruiterCoins';
import {
  eventMsToTorontoYmd,
  fridayWeekBoundsFromYmd,
  monthBoundsFromFirstYmd,
  shiftMonthFirstYmd,
  torontoMonthStartToday,
  torontoYmdFromDate,
  ymdToLocalDate,
  ymdToShortLabel,
} from './webinarGeekDates';
import { pctRounded } from './webinarGeekRecruiterAnalytics';

export type LiveSessionOutcomeStatus = 'attended' | 'no_show' | 'scheduled' | 'pending';

export type LiveSessionMatchMethod = 'email' | 'phone' | 'name' | null;

export type LiveSessionDateGrouping = 'booked' | 'session';

export type LiveSessionBookingRow = {
  callRecordId: string;
  recruiterUserId: string | null;
  recruiterName: string;
  candidateId: string;
  candidateName: string;
  candidateEmail: string;
  candidatePhone: string;
  bookedAt: string;
  bookedYmd: string;
  sessionDate: string | null;
  sessionDateLabel: string;
  outcome: LiveSessionOutcomeStatus;
  matchMethod: LiveSessionMatchMethod | null;
  calendlyNoShow: boolean | null;
  coinsEarned: number;
};

export type LiveSessionRecruiterProfile = {
  userId: string | null;
  displayName: string;
  booked: number;
  showed: number;
  noShow: number;
  scheduled: number;
  pending: number;
  showRatePct: number;
  coinsEarned: number;
};

export type LiveSessionSummaryRow = {
  sessionDate: string;
  sessionDateLabel: string;
  booked: number;
  showed: number;
  noShow: number;
  scheduled: number;
  pending: number;
  showRatePct: number;
};

export type LiveSessionScopeMode = 'month' | 'week' | 'all';

function readBookedSubtype(record: PipelineCallRecord): string {
  const meta = record.threecx_metadata && typeof record.threecx_metadata === 'object' ? record.threecx_metadata : {};
  return String(
    record.booked_subtype ||
      (meta as Record<string, unknown>).booked_subtype ||
      (meta as Record<string, unknown>).bookedSubtype ||
      '',
  )
    .trim()
    .toLowerCase();
}

function displayNameForRecord(
  record: PipelineCallRecord,
  directory: Map<string, { fullName: string | null; email: string | null }>,
): string {
  const label = String(record.recruiter_label || '').trim();
  if (label) return label;
  const uid = record.recruiter_user_id;
  if (uid && directory.has(uid)) {
    const p = directory.get(uid)!;
    return String(p.fullName || p.email || 'Recruiter').trim() || 'Recruiter';
  }
  return 'Recruiter';
}

function resolveBookingOutcome(input: {
  record: PipelineCallRecord;
  candidateEmail?: string;
  candidatePhone?: string;
  candidateName?: string;
  byEmail: Map<string, LiveSessionRegistrantRow[]>;
  byPhone: Map<string, LiveSessionRegistrantRow[]>;
  allRegistrants: LiveSessionRegistrantRow[];
  now?: Date;
}): {
  outcome: LiveSessionOutcomeStatus;
  sessionDate: string | null;
  matchMethod: LiveSessionMatchMethod | null;
  calendlyNoShow: boolean | null;
} {
  const persisted = readCallRecordLiveSessionOutcome(input.record);
  if (persisted.status) {
    return {
      outcome: persisted.status,
      sessionDate: persisted.sessionDate,
      matchMethod: (persisted.matchMethod as LiveSessionMatchMethod | null) || null,
      calendlyNoShow: null,
    };
  }

  const disposedMs = Date.parse(input.record.disposed_at || input.record.created_at);
  const { registrant, matchMethod } = pickRegistrantForCallDisposition({
    email: input.candidateEmail,
    candidatePhone: input.candidatePhone,
    candidateName: input.candidateName,
    dialedNumber: input.record.dialed_number,
    disposedAtMs: Number.isFinite(disposedMs) ? disposedMs : Date.now(),
    byEmail: input.byEmail,
    byPhone: input.byPhone,
    allRegistrants: input.allRegistrants,
  });
  const resolved = resolveLiveSessionOutcome(registrant, input.now);
  return {
    outcome: resolved.status,
    sessionDate: resolved.sessionDate,
    matchMethod: matchMethod || resolved.matchMethod,
    calendlyNoShow: registrant?.calendly_no_show ?? null,
  };
}

export function buildLiveSessionBookingRows(input: {
  records: PipelineCallRecord[];
  candidateEmailById: Map<string, string>;
  candidatePhoneById: Map<string, string>;
  candidateNameById: Map<string, string>;
  registrants: LiveSessionRegistrantRow[];
  recruiterDirectory: Map<string, { fullName: string | null; email: string | null }>;
  now?: Date;
}): LiveSessionBookingRow[] {
  const byEmail = buildLiveSessionRowsByEmail(input.registrants);
  const byPhone = buildLiveSessionRowsByPhone(input.registrants);
  const rows: LiveSessionBookingRow[] = [];

  for (const record of input.records) {
    if (String(record.disposition || '').trim().toLowerCase() !== 'booked') continue;
    if (readBookedSubtype(record) !== 'live session') continue;

    const bookedAt = record.disposed_at || record.created_at;
    const bookedMs = Date.parse(bookedAt);
    const bookedYmd = Number.isFinite(bookedMs) ? eventMsToTorontoYmd(bookedMs) : 'unknown';

    const { outcome, sessionDate, matchMethod, calendlyNoShow } = resolveBookingOutcome({
      record,
      candidateEmail: input.candidateEmailById.get(record.candidate_id),
      candidatePhone: input.candidatePhoneById.get(record.candidate_id),
      candidateName: input.candidateNameById.get(record.candidate_id),
      byEmail,
      byPhone,
      allRegistrants: input.registrants,
      now: input.now,
    });

    rows.push({
      callRecordId: record.id,
      recruiterUserId: record.recruiter_user_id,
      recruiterName: displayNameForRecord(record, input.recruiterDirectory),
      candidateId: record.candidate_id,
      candidateName: input.candidateNameById.get(record.candidate_id) || '—',
      candidateEmail: input.candidateEmailById.get(record.candidate_id) || '',
      candidatePhone:
        input.candidatePhoneById.get(record.candidate_id) || record.dialed_number || '',
      bookedAt,
      bookedYmd,
      sessionDate,
      sessionDateLabel: sessionDate ? ymdToShortLabel(sessionDate) : '—',
      outcome,
      matchMethod,
      calendlyNoShow,
      coinsEarned: outcome === 'attended' ? COINS_PER_LIVE_SESSION_SHOW : 0,
    });
  }

  rows.sort((a, b) => {
    const sessionCmp = (b.sessionDate || '').localeCompare(a.sessionDate || '');
    if (sessionCmp !== 0) return sessionCmp;
    return b.bookedAt.localeCompare(a.bookedAt);
  });

  return rows;
}

export function buildRecruiterProfilesFromBookingRows(
  rows: LiveSessionBookingRow[],
): LiveSessionRecruiterProfile[] {
  const map = new Map<string, LiveSessionRecruiterProfile>();

  for (const row of rows) {
    const key = row.recruiterUserId || row.recruiterName;
    if (!map.has(key)) {
      map.set(key, {
        userId: row.recruiterUserId,
        displayName: row.recruiterName,
        booked: 0,
        showed: 0,
        noShow: 0,
        scheduled: 0,
        pending: 0,
        showRatePct: 0,
        coinsEarned: 0,
      });
    }
    const p = map.get(key)!;
    p.booked += 1;
    if (row.outcome === 'attended') {
      p.showed += 1;
      p.coinsEarned += row.coinsEarned;
    } else if (row.outcome === 'no_show') p.noShow += 1;
    else if (row.outcome === 'scheduled') p.scheduled += 1;
    else p.pending += 1;
  }

  const profiles = [...map.values()];
  for (const p of profiles) {
    p.showRatePct = pctRounded(p.showed, p.booked);
  }
  profiles.sort((a, b) => {
    if (b.booked !== a.booked) return b.booked - a.booked;
    if (b.showed !== a.showed) return b.showed - a.showed;
    return a.displayName.localeCompare(b.displayName);
  });
  return profiles;
}

export function buildSessionSummariesFromBookingRows(
  rows: LiveSessionBookingRow[],
): LiveSessionSummaryRow[] {
  const map = new Map<string, LiveSessionSummaryRow>();

  for (const row of rows) {
    const sessionDate = row.sessionDate || 'unknown';
    if (!map.has(sessionDate)) {
      map.set(sessionDate, {
        sessionDate,
        sessionDateLabel: sessionDate === 'unknown' ? 'Unmatched' : ymdToShortLabel(sessionDate),
        booked: 0,
        showed: 0,
        noShow: 0,
        scheduled: 0,
        pending: 0,
        showRatePct: 0,
      });
    }
    const s = map.get(sessionDate)!;
    s.booked += 1;
    if (row.outcome === 'attended') s.showed += 1;
    else if (row.outcome === 'no_show') s.noShow += 1;
    else if (row.outcome === 'scheduled') s.scheduled += 1;
    else s.pending += 1;
  }

  const summaries = [...map.values()];
  for (const s of summaries) {
    s.showRatePct = pctRounded(s.showed, s.booked);
  }
  summaries.sort((a, b) => b.sessionDate.localeCompare(a.sessionDate));
  return summaries;
}

export function ymdInRange(ymd: string, sinceYmd: string, untilYmd: string): boolean {
  if (!ymd || ymd === 'unknown') return false;
  return ymd >= sinceYmd && ymd <= untilYmd;
}

export function rowDateKey(row: LiveSessionBookingRow, grouping: LiveSessionDateGrouping): string {
  return grouping === 'booked' ? row.bookedYmd : row.sessionDate || 'unknown';
}

export function rowInScope(
  row: LiveSessionBookingRow,
  sinceYmd: string,
  untilYmd: string,
  grouping: LiveSessionDateGrouping,
): boolean {
  const key = rowDateKey(row, grouping);
  if (key === 'unknown') return grouping === 'booked';
  return ymdInRange(key, sinceYmd, untilYmd);
}

export function matchesSearch(row: LiveSessionBookingRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    row.recruiterName,
    row.candidateName,
    row.candidateEmail,
    row.candidatePhone,
    row.sessionDateLabel,
    row.outcome,
    row.matchMethod || '',
  ]
    .join(' ')
    .toLowerCase();
  return hay.includes(q);
}

export function scopeBounds(input: {
  mode: LiveSessionScopeMode;
  monthAnchorYmd?: string;
  weekAnchorYmd?: string;
  allSinceYmd: string;
  allUntilYmd: string;
}): { sinceYmd: string; untilYmd: string; title: string } {
  if (input.mode === 'all') {
    return {
      sinceYmd: input.allSinceYmd,
      untilYmd: input.allUntilYmd,
      title: `${ymdToShortLabel(input.allSinceYmd)} → ${ymdToShortLabel(input.allUntilYmd)}`,
    };
  }
  if (input.mode === 'week') {
    const anchor = input.weekAnchorYmd || torontoYmdFromDate();
    const week = fridayWeekBoundsFromYmd(anchor);
    return { sinceYmd: week.since, untilYmd: week.until, title: week.title };
  }
  const monthStart = input.monthAnchorYmd || torontoMonthStartToday();
  const month = monthBoundsFromFirstYmd(monthStart);
  return { sinceYmd: month.since, untilYmd: month.until, title: month.title };
}

export function recruiterDirectoryFromProfiles(
  profiles: UserProfile[],
): Map<string, { fullName: string | null; email: string | null }> {
  return new Map(
    profiles.map((p) => [p.user_id, { fullName: p.full_name, email: p.email ?? null }]),
  );
}

export function isoWindowFromYmd(sinceYmd: string, untilYmd: string): { fromIso: string; toIso: string } {
  const from = ymdToLocalDate(sinceYmd);
  from.setHours(0, 0, 0, 0);
  const to = ymdToLocalDate(untilYmd);
  to.setHours(23, 59, 59, 999);
  return { fromIso: from.toISOString(), toIso: to.toISOString() };
}

export { shiftMonthFirstYmd, torontoMonthStartToday, torontoYmdFromDate, ymdToShortLabel };
