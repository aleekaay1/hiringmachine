import {
  buildRecruiterScopeTokens,
  isDemoStaffProfile,
  recruiterOwnsNameKey,
  type UserProfile,
} from './accessControl';
import {
  buildLiveSessionRowsByEmail,
  buildLiveSessionRowsByPhone,
  liveSessionAttendedFromRegistrant,
  pickRegistrantForCallDisposition,
  type LiveSessionRegistrantRow,
} from './liveSessionBookedOutcomes';
import { readCallRecordMeta, readCallRecordLiveSessionOutcome, type PipelineCallRecord } from './pipelineService';
import {
  fridayWeekBoundsFromYmd,
  monthBoundsFromFirstYmd,
  shiftMonthFirstYmd,
  shiftYmdDays,
  torontoMonthStartToday,
  torontoYmdFromDate,
  ymdToLocalDate,
  ymdToShortLabel,
} from './webinarGeekDates';
import { nameKeyFromRow, HALF_WATCH_SECONDS } from './webinarGeekInviters';
import { fmtHrScheduledDateKey } from './webinarGeekRecruiterAnalytics';

type AnyRow = Record<string, unknown>;
type RecruiterDirectory = Map<string, { fullName: string | null; email: string | null }>;

const EXCLUDED_LEADERBOARD_NAMES = new Set(['unknown recruiter', 'unknown', 'admin']);

export function excludedLeaderboardUserIds(profiles: UserProfile[]): Set<string> {
  return new Set(
    profiles.filter((p) => p.role === 'admin' || isDemoStaffProfile(p)).map((p) => p.user_id),
  );
}

export function isExcludedLeaderboardParticipant(
  displayName: string,
  recruiterUserId: string | null,
  excludedUserIds?: Set<string>,
): boolean {
  const normalized = String(displayName || '').trim().toLowerCase();
  if (!normalized || EXCLUDED_LEADERBOARD_NAMES.has(normalized)) return true;
  if (/^unknown(\s+recruiter)?$/i.test(normalized)) return true;
  if (normalized === 'administrator' || normalized === 'admin') return true;
  if (normalized === 'demo leadership' || normalized === 'demo admin' || normalized.startsWith('demo ')) {
    return true;
  }
  if (recruiterUserId && excludedUserIds?.has(recruiterUserId)) return true;
  return false;
}

function filterAggregates(aggregates: Aggregate[], excludedUserIds: Set<string>): Aggregate[] {
  return aggregates.filter(
    (agg) => !isExcludedLeaderboardParticipant(agg.displayName, agg.recruiterUserId, excludedUserIds),
  );
}

export function filterLeaderboardRows(
  rows: RecruiterLeaderboardRow[],
  excludedUserIds: Set<string> = new Set(),
): RecruiterLeaderboardRow[] {
  const filtered = rows.filter(
    (row) => !isExcludedLeaderboardParticipant(row.displayName, row.recruiterUserId, excludedUserIds),
  );
  filtered.forEach((row, index) => {
    row.rank = index + 1;
  });
  return filtered;
}

export const LEADERBOARD_BADGE_TOP_PERFORMER = 'Top Performer';
export const LEADERBOARD_BADGE_FAST_CLIMBER = 'Fast Climber';
export const LEADERBOARD_BADGE_CONSISTENT_CLOSER = 'Consistent Closer';

export type LeaderboardBadgeId = 'topPerformer' | 'fastClimber' | 'consistentCloser';

export type LeaderboardWindow = {
  fromIso: string;
  toIso: string;
  label: string;
  sinceYmd: string;
  untilYmd: string;
};

export type LeaderboardBadgeWinners = {
  topPerformer: RecruiterLeaderboardRow | null;
  fastClimber: RecruiterLeaderboardRow | null;
  consistentCloser: RecruiterLeaderboardRow | null;
};

export type LeaderboardPeriod = 'last7' | 'lastWeek' | 'last30' | 'thisMonth' | 'custom';

export type LeaderboardCustomRange = {
  sinceYmd: string;
  untilYmd: string;
};

export function defaultLeaderboardCustomRange(): LeaderboardCustomRange {
  const week = fridayWeekBoundsFromYmd(torontoYmdFromDate());
  return { sinceYmd: week.since, untilYmd: week.until };
}

export function isValidYmd(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return dt.getFullYear() === y && dt.getMonth() === (m || 1) - 1 && dt.getDate() === d;
}

export function leaderboardSnapshotKey(period: LeaderboardPeriod, custom?: LeaderboardCustomRange | null): string {
  if (period === 'custom' && custom?.sinceYmd && custom?.untilYmd) {
    return `custom:${custom.sinceYmd}_${custom.untilYmd}`;
  }
  return period;
}

function inclusiveDayCount(sinceYmd: string, untilYmd: string): number {
  const start = ymdToLocalDate(sinceYmd);
  const end = ymdToLocalDate(untilYmd);
  const ms = end.getTime() - start.getTime();
  return Math.max(1, Math.floor(ms / 86400000) + 1);
}

export type LeaderboardRecruiterSeed = {
  recruiterKey: string;
  recruiterUserId: string;
  displayName: string;
};

export type RecruiterLeaderboardRow = {
  recruiterKey: string;
  recruiterUserId: string | null;
  displayName: string;
  calls: number;
  /** Webinar bookings (WebinarGeek) + live-session bookings (call dispositions). */
  booked: number;
  webinarBooked: number;
  webinarShowed: number;
  liveSessionBooked: number;
  liveSessionShowed: number;
  showRatio: number;
  showRatioSmoothed: number;
  bookedNorm: number;
  callsNorm: number;
  lowSampleFactor: number;
  score: number;
  rank: number;
  previousRank: number | null;
  rankDelta: number;
  passedLabel: string | null;
  overtakenByLabel: string | null;
  badges: string[];
};

type Aggregate = {
  recruiterKey: string;
  recruiterUserId: string | null;
  displayName: string;
  calls: number;
  booked: number;
  webinarBooked: number;
  webinarShowed: number;
  liveSessionBooked: number;
  liveSessionShowed: number;
};

function utcRangeFromTorontoYmd(sinceYmd: string, untilYmd: string): { from: Date; to: Date } {
  const from = ymdToLocalDate(sinceYmd);
  from.setHours(0, 0, 0, 0);
  const to = ymdToLocalDate(untilYmd);
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

function windowFromYmdRange(sinceYmd: string, untilYmd: string, label: string): LeaderboardWindow {
  const { from, to } = utcRangeFromTorontoYmd(sinceYmd, untilYmd);
  return {
    fromIso: from.toISOString(),
    toIso: to.toISOString(),
    label,
    sinceYmd,
    untilYmd,
  };
}

function customPeriodBounds(range: LeaderboardCustomRange): {
  current: LeaderboardWindow;
  previous: LeaderboardWindow;
} {
  const { sinceYmd, untilYmd } = range;
  const days = inclusiveDayCount(sinceYmd, untilYmd);
  const prevUntilYmd = shiftYmdDays(sinceYmd, -1);
  const prevSinceYmd = shiftYmdDays(prevUntilYmd, -(days - 1));
  return {
    current: windowFromYmdRange(
      sinceYmd,
      untilYmd,
      `Custom · ${ymdToShortLabel(sinceYmd)} → ${ymdToShortLabel(untilYmd)}`,
    ),
    previous: windowFromYmdRange(
      prevSinceYmd,
      prevUntilYmd,
      `Prior · ${ymdToShortLabel(prevSinceYmd)} → ${ymdToShortLabel(prevUntilYmd)}`,
    ),
  };
}

function periodBounds(
  period: LeaderboardPeriod,
  now: Date,
  custom?: LeaderboardCustomRange | null,
): {
  current: LeaderboardWindow;
  previous: LeaderboardWindow;
} {
  if (period === 'custom') {
    if (custom?.sinceYmd && custom?.untilYmd && custom.sinceYmd <= custom.untilYmd) {
      return customPeriodBounds(custom);
    }
    const todayYmd = torontoYmdFromDate(now);
    return customPeriodBounds({ sinceYmd: todayYmd, untilYmd: todayYmd });
  }

  const todayYmd = torontoYmdFromDate(now);

  if (period === 'last30') {
    const untilYmd = todayYmd;
    const sinceYmd = shiftYmdDays(untilYmd, -29);
    const prevUntilYmd = shiftYmdDays(sinceYmd, -1);
    const prevSinceYmd = shiftYmdDays(prevUntilYmd, -29);
    return {
      current: windowFromYmdRange(sinceYmd, untilYmd, 'Last 30 days'),
      previous: windowFromYmdRange(prevSinceYmd, prevUntilYmd, 'Previous 30 days'),
    };
  }

  if (period === 'thisMonth') {
    const monthStart = torontoMonthStartToday();
    const month = monthBoundsFromFirstYmd(monthStart);
    const prevMonth = monthBoundsFromFirstYmd(shiftMonthFirstYmd(monthStart, -1));
    return {
      current: windowFromYmdRange(month.since, month.until, month.title),
      previous: windowFromYmdRange(prevMonth.since, prevMonth.until, `Previous ${month.title}`),
    };
  }

  if (period === 'lastWeek') {
    const currentWeek = fridayWeekBoundsFromYmd(todayYmd);
    const lastWeek = fridayWeekBoundsFromYmd(shiftYmdDays(currentWeek.since, -7));
    const priorWeek = fridayWeekBoundsFromYmd(shiftYmdDays(lastWeek.since, -7));
    return {
      current: windowFromYmdRange(
        lastWeek.since,
        lastWeek.until,
        `Last week (Fri–Thu) · ${lastWeek.title}`,
      ),
      previous: windowFromYmdRange(
        priorWeek.since,
        priorWeek.until,
        `Two weeks ago (Fri–Thu) · ${priorWeek.title}`,
      ),
    };
  }

  const currentWeek = fridayWeekBoundsFromYmd(todayYmd);
  const previousWeek = fridayWeekBoundsFromYmd(shiftYmdDays(currentWeek.since, -7));
  return {
    current: windowFromYmdRange(
      currentWeek.since,
      currentWeek.until,
      `This week (Fri–Thu) · ${currentWeek.title}`,
    ),
    previous: windowFromYmdRange(
      previousWeek.since,
      previousWeek.until,
      `Prior week (Fri–Thu) · ${previousWeek.title}`,
    ),
  };
}

export function buildLeaderboardWindows(
  period: LeaderboardPeriod,
  now = new Date(),
  custom?: LeaderboardCustomRange | null,
): { current: LeaderboardWindow; previous: LeaderboardWindow } {
  return periodBounds(period, now, custom);
}

function filterWebinarRowsInWindow(rows: AnyRow[], window: LeaderboardWindow): AnyRow[] {
  const { sinceYmd, untilYmd } = window;
  return rows.filter((row) => {
    const key = fmtHrScheduledDateKey(row);
    if (key === 'unknown') return false;
    return key >= sinceYmd && key <= untilYmd;
  });
}

export function resolveLeaderboardBadgeWinners(rows: RecruiterLeaderboardRow[]): LeaderboardBadgeWinners {
  const topPerformer = rows.find((row) => row.rank === 1) ?? null;
  const fastClimber =
    [...rows]
      .filter((row) => row.badges.includes(LEADERBOARD_BADGE_FAST_CLIMBER))
      .sort((a, b) => b.rankDelta - a.rankDelta || a.rank - b.rank)[0] ?? null;
  const consistentCloser =
    [...rows]
      .filter((row) => row.badges.includes(LEADERBOARD_BADGE_CONSISTENT_CLOSER))
      .sort((a, b) => b.showRatioSmoothed - a.showRatioSmoothed || b.webinarBooked - a.webinarBooked)[0] ?? null;
  return { topPerformer, fastClimber, consistentCloser };
}

export function rowMatchesBadgeFilter(row: RecruiterLeaderboardRow, filters: Set<LeaderboardBadgeId>): boolean {
  if (filters.size === 0) return true;
  if (filters.has('topPerformer') && row.badges.includes(LEADERBOARD_BADGE_TOP_PERFORMER)) return true;
  if (filters.has('fastClimber') && row.badges.includes(LEADERBOARD_BADGE_FAST_CLIMBER)) return true;
  if (filters.has('consistentCloser') && row.badges.includes(LEADERBOARD_BADGE_CONSISTENT_CLOSER)) return true;
  return false;
}

function watchSecondsFromRow(row: AnyRow): number {
  const sec = Number(row.watch_duration || 0);
  return Number.isFinite(sec) && sec > 0 ? sec : 0;
}

function webinarShowedFromRow(row: AnyRow): boolean {
  if (row.watched === true) return true;
  return watchSecondsFromRow(row) >= HALF_WATCH_SECONDS;
}

function displayNameFromEmail(email: string): string | null {
  const local = String(email || '').trim().toLowerCase().split('@')[0] || '';
  if (!local) return null;
  const parts = local.split(/[._-]+/g).filter(Boolean);
  if (!parts.length) return null;
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

function displayNameForRecord(record: PipelineCallRecord, directory: RecruiterDirectory): string {
  const userId = String(record.recruiter_user_id || '').trim();
  if (userId && directory.has(userId)) {
    const row = directory.get(userId)!;
    const full = String(row.fullName || '').trim();
    if (full) return full;
    const fromEmail = row.email ? displayNameFromEmail(row.email) : null;
    return fromEmail || 'Unknown Recruiter';
  }
  const label = String(record.recruiter_label || '').trim();
  if (label && !label.includes('@')) return label;
  const fallbackEmail = label.includes('@') ? label : '';
  return (fallbackEmail ? displayNameFromEmail(fallbackEmail) : null) || 'Unknown Recruiter';
}

function recruiterKeyForRecord(record: PipelineCallRecord): { recruiterKey: string; recruiterUserId: string | null } | null {
  const userId = String(record.recruiter_user_id || '').trim() || null;
  if (userId) return { recruiterKey: `uid:${userId}`, recruiterUserId: userId };
  const label = String(record.recruiter_label || '').trim();
  if (!label) return null;
  const labelLower = label.toLowerCase();
  if (EXCLUDED_LEADERBOARD_NAMES.has(labelLower) || labelLower === 'administrator') return null;
  return { recruiterKey: `label:${labelLower}`, recruiterUserId: null };
}

/** Recruiter user id when inviter/file tag matches a seeded account (null if unmatched). */
export function resolveWebinarRowRecruiterUserId(
  row: AnyRow,
  seeds: LeaderboardRecruiterSeed[],
  directory: RecruiterDirectory,
): string | null {
  return ownerForWebinarRow(row, seeds, directory)?.recruiterUserId ?? null;
}

function ownerForWebinarRow(
  row: AnyRow,
  seeds: LeaderboardRecruiterSeed[],
  directory: RecruiterDirectory,
): { recruiterKey: string; recruiterUserId: string | null; displayName: string } | null {
  const key = nameKeyFromRow(row);
  if (!key) return null;

  for (const seed of seeds) {
    const profile = directory.get(seed.recruiterUserId);
    const tokens = buildRecruiterScopeTokens(profile?.email ?? null, profile?.fullName ?? seed.displayName);
    if (recruiterOwnsNameKey(key, tokens)) {
      return {
        recruiterKey: seed.recruiterKey,
        recruiterUserId: seed.recruiterUserId,
        displayName: seed.displayName,
      };
    }
  }

  const label = String(row.custom_field ?? '').trim();
  const displayName =
    label
      .replace(/^(cooper|rms)[_\-\s]+/i, '')
      .replace(/\.(pdf|docx?|rtf|txt|png|jpe?g|webp)$/i, '')
      .replace(/_/g, ' ')
      .trim() || key;

  return {
    recruiterKey: `name:${key}`,
    recruiterUserId: null,
    displayName: displayName
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' '),
  };
}

function emptyAggregate(
  recruiterKey: string,
  recruiterUserId: string | null,
  displayName: string,
): Aggregate {
  return {
    recruiterKey,
    recruiterUserId,
    displayName,
    calls: 0,
    booked: 0,
    webinarBooked: 0,
    webinarShowed: 0,
    liveSessionBooked: 0,
    liveSessionShowed: 0,
  };
}

function aggregateWebinarRows(
  rows: AnyRow[],
  seeds: LeaderboardRecruiterSeed[],
  directory: RecruiterDirectory,
): Map<string, Aggregate> {
  const map = new Map<string, Aggregate>();

  for (const seed of seeds) {
    map.set(seed.recruiterKey, emptyAggregate(seed.recruiterKey, seed.recruiterUserId, seed.displayName));
  }

  for (const row of rows) {
    const owner = ownerForWebinarRow(row, seeds, directory);
    if (!owner) continue;
    if (!map.has(owner.recruiterKey)) {
      map.set(owner.recruiterKey, emptyAggregate(owner.recruiterKey, owner.recruiterUserId, owner.displayName));
    }
    const agg = map.get(owner.recruiterKey)!;
    agg.webinarBooked += 1;
    if (webinarShowedFromRow(row)) agg.webinarShowed += 1;
    agg.booked = agg.webinarBooked + agg.liveSessionBooked;
  }

  return map;
}

function aggregateCallRecords(
  records: PipelineCallRecord[],
  directory: RecruiterDirectory,
  seeds: LeaderboardRecruiterSeed[],
  candidateEmailById: Map<string, string>,
  candidatePhoneById: Map<string, string>,
  candidateNameById: Map<string, string>,
  liveSessionByEmail: Map<string, LiveSessionRegistrantRow[]>,
  liveSessionByPhone: Map<string, LiveSessionRegistrantRow[]>,
  allLiveRegistrants: LiveSessionRegistrantRow[],
): Map<string, Aggregate> {
  const map = new Map<string, Aggregate>();

  for (const record of records) {
    const identity = recruiterKeyForRecord(record);
    if (!identity) continue;
    const { recruiterKey, recruiterUserId } = identity;
    if (!map.has(recruiterKey)) {
      const seed = seeds.find((s) => s.recruiterKey === recruiterKey);
      map.set(
        recruiterKey,
        emptyAggregate(
          recruiterKey,
          recruiterUserId,
          seed?.displayName || displayNameForRecord(record, directory),
        ),
      );
    }
    const agg = map.get(recruiterKey)!;
    agg.calls += 1;

    const disposition = String(record.disposition || '').trim().toLowerCase();
    if (disposition !== 'booked') continue;

    const meta = readCallRecordMeta(record);
    const bookedSubtype = String(record.booked_subtype || meta.bookedSubtype || '').trim().toLowerCase();
    if (bookedSubtype === 'live session') {
      agg.liveSessionBooked += 1;
      const persisted = readCallRecordLiveSessionOutcome(record);
      if (persisted.status === 'attended') {
        agg.liveSessionShowed += 1;
      } else if (!persisted.status || persisted.status === 'pending') {
        const disposedMs = Date.parse(record.disposed_at || record.created_at);
        const { registrant: match } = pickRegistrantForCallDisposition({
          email: candidateEmailById.get(record.candidate_id),
          candidatePhone: candidatePhoneById.get(record.candidate_id),
          candidateName: candidateNameById.get(record.candidate_id),
          dialedNumber: record.dialed_number,
          disposedAtMs: Number.isFinite(disposedMs) ? disposedMs : Date.now(),
          byEmail: liveSessionByEmail,
          byPhone: liveSessionByPhone,
          allRegistrants: allLiveRegistrants,
        });
        if (match && liveSessionAttendedFromRegistrant(match)) {
          agg.liveSessionShowed += 1;
        }
      }
      agg.booked = agg.webinarBooked + agg.liveSessionBooked;
    }
  }

  for (const seed of seeds) {
    if (!map.has(seed.recruiterKey)) {
      map.set(seed.recruiterKey, emptyAggregate(seed.recruiterKey, seed.recruiterUserId, seed.displayName));
    }
  }

  return map;
}

function mergeAggregates(webinarMap: Map<string, Aggregate>, callMap: Map<string, Aggregate>): Aggregate[] {
  const keys = new Set([...webinarMap.keys(), ...callMap.keys()]);
  const merged: Aggregate[] = [];

  for (const key of keys) {
    const webinar = webinarMap.get(key);
    const calls = callMap.get(key);
    if (webinar && calls) {
      merged.push({
        ...webinar,
        calls: calls.calls,
        liveSessionBooked: calls.liveSessionBooked,
        liveSessionShowed: calls.liveSessionShowed,
        booked: webinar.webinarBooked + calls.liveSessionBooked,
      });
      continue;
    }
    if (webinar) {
      merged.push({ ...webinar, booked: webinar.webinarBooked + webinar.liveSessionBooked });
      continue;
    }
    if (calls) {
      merged.push({ ...calls, booked: calls.webinarBooked + calls.liveSessionBooked });
    }
  }

  return merged;
}

function showRatioFromCounts(totalShowed: number, totalBooked: number): number {
  if (totalBooked <= 0) return 0;
  return totalShowed / totalBooked;
}

function showRatioSmoothed(totalShowed: number, totalBooked: number): number {
  if (totalBooked <= 0) return 0;
  return (totalShowed + 2) / (totalBooked + 4);
}

function toRows(aggregates: Aggregate[]): RecruiterLeaderboardRow[] {
  if (aggregates.length === 0) return [];

  const maxTotalBooked = Math.max(
    1,
    ...aggregates.map((a) => a.webinarBooked + a.liveSessionBooked),
  );
  const maxTotalShowed = Math.max(
    1,
    ...aggregates.map((a) => a.webinarShowed + a.liveSessionShowed),
  );

  const rows = aggregates.map((agg) => {
    const totalBooked = agg.webinarBooked + agg.liveSessionBooked;
    const totalShowed = agg.webinarShowed + agg.liveSessionShowed;
    const showRatio = showRatioFromCounts(totalShowed, totalBooked);
    const smoothed = showRatioSmoothed(totalShowed, totalBooked);
    const lowSampleFactor = Math.min(1, totalBooked / 8);
    const showQuality = smoothed * (0.55 + 0.45 * lowSampleFactor);
    const bookedNorm = totalBooked / maxTotalBooked;
    const showedNorm = totalShowed / maxTotalShowed;
    const score = 100 * (0.5 * showQuality + 0.3 * bookedNorm + 0.2 * showedNorm);
    const callsNorm = 0;

    return {
      recruiterKey: agg.recruiterKey,
      recruiterUserId: agg.recruiterUserId,
      displayName: agg.displayName,
      calls: agg.calls,
      booked: agg.booked,
      webinarBooked: agg.webinarBooked,
      webinarShowed: agg.webinarShowed,
      liveSessionBooked: agg.liveSessionBooked,
      liveSessionShowed: agg.liveSessionShowed,
      showRatio,
      showRatioSmoothed: smoothed,
      bookedNorm,
      callsNorm,
      lowSampleFactor,
      score,
      rank: 0,
      previousRank: null,
      rankDelta: 0,
      passedLabel: null,
      overtakenByLabel: null,
      badges: [],
    } satisfies RecruiterLeaderboardRow;
  });

  rows.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const bookedA = a.webinarBooked + a.liveSessionBooked;
    const bookedB = b.webinarBooked + b.liveSessionBooked;
    if (bookedB !== bookedA) return bookedB - bookedA;
    const showedA = a.webinarShowed + a.liveSessionShowed;
    const showedB = b.webinarShowed + b.liveSessionShowed;
    if (showedB !== showedA) return showedB - showedA;
    return a.displayName.localeCompare(b.displayName);
  });

  rows.forEach((row, index) => {
    row.rank = index + 1;
  });

  return rows;
}

function labelsForRow(row: RecruiterLeaderboardRow): string[] {
  const badges: string[] = [];
  if (row.rank === 1) badges.push(LEADERBOARD_BADGE_TOP_PERFORMER);
  if (row.rankDelta >= 2) badges.push(LEADERBOARD_BADGE_FAST_CLIMBER);
  const totalBooked = row.webinarBooked + row.liveSessionBooked;
  if (row.showRatioSmoothed >= 0.65 && totalBooked >= 8) badges.push(LEADERBOARD_BADGE_CONSISTENT_CLOSER);
  return badges;
}

function movementLabel(
  row: RecruiterLeaderboardRow,
  previousOrder: RecruiterLeaderboardRow[],
  currentOrder: RecruiterLeaderboardRow[],
): { passedLabel: string | null; overtakenByLabel: string | null } {
  if (!row.previousRank) return { passedLabel: null, overtakenByLabel: null };
  if (row.rank < row.previousRank) {
    const priorAbove = previousOrder[row.previousRank - 2];
    if (priorAbove && currentOrder.find((x) => x.recruiterKey === priorAbove.recruiterKey)?.rank! > row.rank) {
      return { passedLabel: priorAbove.displayName, overtakenByLabel: null };
    }
    return { passedLabel: null, overtakenByLabel: null };
  }
  if (row.rank > row.previousRank) {
    const priorBelow = previousOrder[row.previousRank];
    if (priorBelow && currentOrder.find((x) => x.recruiterKey === priorBelow.recruiterKey)?.rank! < row.rank) {
      return { passedLabel: null, overtakenByLabel: priorBelow.displayName };
    }
  }
  return { passedLabel: null, overtakenByLabel: null };
}

function applyMovement(currentRows: RecruiterLeaderboardRow[], previousRows: RecruiterLeaderboardRow[]): RecruiterLeaderboardRow[] {
  const previousRankByKey = new Map<string, number>();
  previousRows.forEach((row) => previousRankByKey.set(row.recruiterKey, row.rank));

  currentRows.forEach((row) => {
    row.previousRank = previousRankByKey.get(row.recruiterKey) ?? null;
    row.rankDelta = row.previousRank ? row.previousRank - row.rank : 0;
  });

  currentRows.forEach((row) => {
    const movement = movementLabel(row, previousRows, currentRows);
    row.passedLabel = movement.passedLabel;
    row.overtakenByLabel = movement.overtakenByLabel;
    row.badges = labelsForRow(row);
    row.score = Math.round(row.score * 100) / 100;
  });

  return currentRows;
}

export function buildCompositeLeaderboard(input: {
  webinarRows: AnyRow[];
  currentWindow: LeaderboardWindow;
  previousWindow: LeaderboardWindow;
  currentRecords: PipelineCallRecord[];
  previousRecords: PipelineCallRecord[];
  recruiterDirectory: RecruiterDirectory;
  recruiterSeeds?: LeaderboardRecruiterSeed[];
  candidateEmailById?: Map<string, string>;
  candidatePhoneById?: Map<string, string>;
  candidateNameById?: Map<string, string>;
  liveSessionByEmail?: Map<string, LiveSessionRegistrantRow[]>;
  liveSessionByPhone?: Map<string, LiveSessionRegistrantRow[]>;
  liveSessionRegistrants?: LiveSessionRegistrantRow[];
  /** When set, only these user ids are included (recruiter self-view). */
  restrictToUserIds?: string[] | null;
  excludedUserIds?: Set<string>;
}): RecruiterLeaderboardRow[] {
  const seeds = input.recruiterSeeds || [];
  const excludedUserIds = input.excludedUserIds ?? new Set<string>();
  const currentWebinar = filterWebinarRowsInWindow(input.webinarRows, input.currentWindow);
  const previousWebinar = filterWebinarRowsInWindow(input.webinarRows, input.previousWindow);

  const emailById = input.candidateEmailById ?? new Map<string, string>();
  const phoneById = input.candidatePhoneById ?? new Map<string, string>();
  const nameById = input.candidateNameById ?? new Map<string, string>();
  const liveByEmail = input.liveSessionByEmail ?? new Map<string, LiveSessionRegistrantRow[]>();
  const liveByPhone = input.liveSessionByPhone ?? new Map<string, LiveSessionRegistrantRow[]>();
  const allLiveRegistrants = input.liveSessionRegistrants ?? [];

  const currentMerged = mergeAggregates(
    aggregateWebinarRows(currentWebinar, seeds, input.recruiterDirectory),
    aggregateCallRecords(input.currentRecords, input.recruiterDirectory, seeds, emailById, phoneById, nameById, liveByEmail, liveByPhone, allLiveRegistrants),
  );
  const previousMerged = mergeAggregates(
    aggregateWebinarRows(previousWebinar, seeds, input.recruiterDirectory),
    aggregateCallRecords(input.previousRecords, input.recruiterDirectory, seeds, emailById, phoneById, nameById, liveByEmail, liveByPhone, allLiveRegistrants),
  );

  let currentRows = toRows(filterAggregates(currentMerged, excludedUserIds));
  let previousRows = toRows(filterAggregates(previousMerged, excludedUserIds));

  const restrict = input.restrictToUserIds?.filter(Boolean);
  if (restrict?.length) {
    const allowed = new Set(restrict);
    currentRows = currentRows.filter((row) => row.recruiterUserId && allowed.has(row.recruiterUserId));
    previousRows = previousRows.filter((row) => row.recruiterUserId && allowed.has(row.recruiterUserId));
  }

  return applyMovement(currentRows, previousRows);
}

export function seedsFromProfiles(profiles: UserProfile[]): LeaderboardRecruiterSeed[] {
  const excluded = excludedLeaderboardUserIds(profiles);
  return profiles
    .filter((item) => item.role === 'recruiter' || item.role === 'webinar' || item.role === 'leadership')
    .filter((item) => !excluded.has(item.user_id))
    .map((item) => {
      const displayName =
        String(item.full_name || '').trim() ||
        String(item.email || '').split('@')[0] ||
        'Team member';
      return {
        recruiterKey: `uid:${item.user_id}`,
        recruiterUserId: item.user_id,
        displayName: isExcludedLeaderboardParticipant(displayName, item.user_id, excluded) ? '' : displayName,
      };
    })
    .filter((item) => item.displayName.length > 0);
}
