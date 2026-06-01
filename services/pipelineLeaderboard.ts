import { buildRecruiterScopeTokens, recruiterOwnsNameKey, type UserProfile } from './accessControl';
import { readCallRecordMeta, type PipelineCallRecord } from './pipelineService';
import {
  fridayWeekBoundsFromYmd,
  monthBoundsFromFirstYmd,
  shiftMonthFirstYmd,
  shiftYmdDays,
  torontoMonthStartToday,
  torontoYmdFromDate,
  ymdToLocalDate,
} from './webinarGeekDates';
import { nameKeyFromRow } from './webinarGeekInviters';
import { fmtHrScheduledDateKey } from './webinarGeekRecruiterAnalytics';

type AnyRow = Record<string, unknown>;
type RecruiterDirectory = Map<string, { fullName: string | null; email: string | null }>;

const HALF_WATCH_SECONDS = Math.floor(47 * 60 * 0.5);

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

export type LeaderboardPeriod = 'last7' | 'last30' | 'thisMonth';

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

function periodBounds(
  period: LeaderboardPeriod,
  now: Date,
): {
  current: LeaderboardWindow;
  previous: LeaderboardWindow;
} {
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

export function buildLeaderboardWindows(period: LeaderboardPeriod, now = new Date()): { current: LeaderboardWindow; previous: LeaderboardWindow } {
  return periodBounds(period, now);
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

function recruiterKeyForRecord(record: PipelineCallRecord): { recruiterKey: string; recruiterUserId: string | null } {
  const userId = String(record.recruiter_user_id || '').trim() || null;
  if (userId) return { recruiterKey: `uid:${userId}`, recruiterUserId: userId };
  const label = String(record.recruiter_label || '').trim() || 'Unknown Recruiter';
  return { recruiterKey: `label:${label.toLowerCase()}`, recruiterUserId: null };
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
): Map<string, Aggregate> {
  const map = new Map<string, Aggregate>();

  for (const record of records) {
    const { recruiterKey, recruiterUserId } = recruiterKeyForRecord(record);
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

function showRatioFromCounts(webinarShowed: number, webinarBooked: number): number {
  if (webinarBooked <= 0) return 0;
  return webinarShowed / webinarBooked;
}

function showRatioSmoothed(webinarShowed: number, webinarBooked: number): number {
  if (webinarBooked <= 0) return 0;
  return (webinarShowed + 2) / (webinarBooked + 4);
}

function toRows(aggregates: Aggregate[]): RecruiterLeaderboardRow[] {
  if (aggregates.length === 0) return [];

  const maxWebinarBooked = Math.max(1, ...aggregates.map((a) => a.webinarBooked));
  const maxCalls = Math.max(1, ...aggregates.map((a) => a.calls));

  const rows = aggregates.map((agg) => {
    const showRatio = showRatioFromCounts(agg.webinarShowed, agg.webinarBooked);
    const smoothed = showRatioSmoothed(agg.webinarShowed, agg.webinarBooked);
    const lowSampleFactor = Math.min(1, agg.webinarBooked / 12);
    const qualityComponent = smoothed * (0.55 + 0.45 * lowSampleFactor);
    const bookedNorm = agg.webinarBooked / maxWebinarBooked;
    const callsNorm = agg.calls / maxCalls;
    const score = 100 * (0.55 * qualityComponent + 0.3 * bookedNorm + 0.15 * callsNorm);

    return {
      recruiterKey: agg.recruiterKey,
      recruiterUserId: agg.recruiterUserId,
      displayName: agg.displayName,
      calls: agg.calls,
      booked: agg.booked,
      webinarBooked: agg.webinarBooked,
      webinarShowed: agg.webinarShowed,
      liveSessionBooked: agg.liveSessionBooked,
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
    if (b.webinarBooked !== a.webinarBooked) return b.webinarBooked - a.webinarBooked;
    if (b.webinarShowed !== a.webinarShowed) return b.webinarShowed - a.webinarShowed;
    if (b.calls !== a.calls) return b.calls - a.calls;
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
  if (row.showRatioSmoothed >= 0.65 && row.webinarBooked >= 8) badges.push(LEADERBOARD_BADGE_CONSISTENT_CLOSER);
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
  /** When set, only these user ids are included (recruiter self-view). */
  restrictToUserIds?: string[] | null;
}): RecruiterLeaderboardRow[] {
  const seeds = input.recruiterSeeds || [];
  const currentWebinar = filterWebinarRowsInWindow(input.webinarRows, input.currentWindow);
  const previousWebinar = filterWebinarRowsInWindow(input.webinarRows, input.previousWindow);

  const currentMerged = mergeAggregates(
    aggregateWebinarRows(currentWebinar, seeds, input.recruiterDirectory),
    aggregateCallRecords(input.currentRecords, input.recruiterDirectory, seeds),
  );
  const previousMerged = mergeAggregates(
    aggregateWebinarRows(previousWebinar, seeds, input.recruiterDirectory),
    aggregateCallRecords(input.previousRecords, input.recruiterDirectory, seeds),
  );

  let currentRows = toRows(currentMerged);
  let previousRows = toRows(previousMerged);

  const restrict = input.restrictToUserIds?.filter(Boolean);
  if (restrict?.length) {
    const allowed = new Set(restrict);
    currentRows = currentRows.filter((row) => row.recruiterUserId && allowed.has(row.recruiterUserId));
    previousRows = previousRows.filter((row) => row.recruiterUserId && allowed.has(row.recruiterUserId));
  }

  return applyMovement(currentRows, previousRows);
}

export function seedsFromProfiles(profiles: UserProfile[]): LeaderboardRecruiterSeed[] {
  return profiles
    .filter((item) => item.role === 'recruiter' || item.role === 'webinar' || item.role === 'leadership')
    .map((item) => ({
      recruiterKey: `uid:${item.user_id}`,
      recruiterUserId: item.user_id,
      displayName: String(item.full_name || '').trim() || String(item.email || '').split('@')[0] || 'Unknown',
    }));
}
