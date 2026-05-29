import {
  eventMsToTorontoYmd,
  asUnixMs,
} from './webinarGeekDates';
import {
  getInviterAttributionFromRow,
  hrScheduledMsFromRow,
  inviteActionMsFromRow,
  nameKeyFromRow,
  normalizeNameKey,
  profileInitials,
  recruiterTeamFromRow,
  rowMatchesNameKey,
  watchBucketFromSeconds,
} from './webinarGeekInviters';

export { profileInitials, rowMatchesNameKey, normalizeNameKey };

type AnyRow = Record<string, unknown>;

export type RecruiterBookingProfile = {
  key: string;
  displayName: string;
  team: string;
  bookings: number;
  /** Marked watched on WebinarGeek */
  watchedYes: number;
  full: number;
  half: number;
  notYet: number;
  lastHrScheduledMs: number | null;
};

export type RecruiterLeaderboardEntry = RecruiterBookingProfile & {
  rank: number;
  /** Half+ or little / none (not full watch) */
  watchedLess: number;
  showedPct: number;
  fullPct: number;
};

/** Weekly scheduled-on target per recruiter (Friday–Thursday week). */
export const RECRUITER_WEEKLY_WEBINAR_TARGET = 30;

export type RecruiterWeeklyTargetEntry = RecruiterBookingProfile & {
  rank: number;
  target: number;
  /** Bookings as % of weekly target (can exceed 100). */
  targetPct: number;
  remaining: number;
  hitTarget: boolean;
};

export function buildRecruiterWeeklyTargetLeaderboard(
  profiles: RecruiterBookingProfile[],
  target: number = RECRUITER_WEEKLY_WEBINAR_TARGET,
): RecruiterWeeklyTargetEntry[] {
  const sorted = [...profiles].sort((a, b) => {
    const pctA = target > 0 ? a.bookings / target : 0;
    const pctB = target > 0 ? b.bookings / target : 0;
    if (pctB !== pctA) return pctB - pctA;
    if (b.bookings !== a.bookings) return b.bookings - a.bookings;
    return a.displayName.localeCompare(b.displayName);
  });
  return sorted.map((p, i) => ({
    ...p,
    rank: i + 1,
    target,
    targetPct: pctRounded(p.bookings, target),
    remaining: Math.max(0, target - p.bookings),
    hitTarget: p.bookings >= target,
  }));
}

export function pctRounded(part: number, whole: number): number {
  if (!whole || whole <= 0) return 0;
  return Math.round((100 * part) / whole);
}

/** Rank recruiters: most bookings first, then full watches, then showed. */
export function buildRecruiterLeaderboard(
  profiles: RecruiterBookingProfile[],
): RecruiterLeaderboardEntry[] {
  const sorted = [...profiles].sort((a, b) => {
    if (b.bookings !== a.bookings) return b.bookings - a.bookings;
    if (b.full !== a.full) return b.full - a.full;
    if (b.watchedYes !== a.watchedYes) return b.watchedYes - a.watchedYes;
    return a.displayName.localeCompare(b.displayName);
  });
  return sorted.map((p, i) => ({
    ...p,
    rank: i + 1,
    watchedLess: p.half + p.notYet,
    showedPct: pctRounded(p.watchedYes, p.bookings),
    fullPct: pctRounded(p.full, p.bookings),
  }));
}

/** Calendar / scope on WebinarGeek page — webinar session date. */
export function fmtWebinarSessionDateKey(row: AnyRow): string {
  const broadcast = row.broadcast && typeof row.broadcast === 'object' ? (row.broadcast as AnyRow) : null;
  const ms =
    asUnixMs(broadcast?.date) ??
    hrScheduledMsFromRow(row) ??
    asUnixMs(row.watched_true_set_at);
  if (!ms) return 'unknown';
  return eventMsToTorontoYmd(ms);
}

/** Recruiter analytics — when the invite was created (HR scheduled). */
export function fmtHrScheduledDateKey(row: AnyRow): string {
  const ms = inviteActionMsFromRow(row) ?? hrScheduledMsFromRow(row) ?? asUnixMs(row.watched_true_set_at);
  if (!ms) return 'unknown';
  return eventMsToTorontoYmd(ms);
}

export function buildRecruiterBookingProfiles(
  rows: AnyRow[],
  watchSeconds: (row: AnyRow) => number,
): RecruiterBookingProfile[] {
  const map = new Map<string, RecruiterBookingProfile & { teams: Set<string> }>();

  for (const row of rows) {
    const key = nameKeyFromRow(row);
    if (!key) continue;
    const displayName = getInviterAttributionFromRow(row).inviteeLabel!;
    const team = recruiterTeamFromRow(row);
    const hrMs = hrScheduledMsFromRow(row);

    if (!map.has(key)) {
      map.set(key, {
        key,
        displayName,
        team: team,
        bookings: 0,
        watchedYes: 0,
        full: 0,
        half: 0,
        notYet: 0,
        lastHrScheduledMs: null,
        teams: new Set(team !== '—' ? [team] : []),
      });
    }
    const p = map.get(key)!;
    if (team !== '—') p.teams.add(team);
    p.bookings += 1;
    if (row.watched === true) p.watchedYes += 1;
    const bucket = watchBucketFromSeconds(watchSeconds(row));
    if (bucket === 'full') p.full += 1;
    else if (bucket === 'half') p.half += 1;
    else p.notYet += 1;
    if (hrMs != null && (p.lastHrScheduledMs == null || hrMs > p.lastHrScheduledMs)) {
      p.lastHrScheduledMs = hrMs;
    }
  }

  return [...map.values()]
    .map(({ teams, ...rest }) => ({
      ...rest,
      team: teams.size > 1 ? 'Mixed' : rest.team,
    }))
    .sort((a, b) => {
      if (b.bookings !== a.bookings) return b.bookings - a.bookings;
      return a.displayName.localeCompare(b.displayName);
    });
}

export function dayBookingCountsByHrDate(
  rows: AnyRow[],
): Map<string, { bookings: number; watched: number }> {
  const map = new Map<string, { bookings: number; watched: number }>();
  for (const row of rows) {
    const key = fmtHrScheduledDateKey(row);
    if (key === 'unknown') continue;
    if (!map.has(key)) map.set(key, { bookings: 0, watched: 0 });
    const e = map.get(key)!;
    e.bookings += 1;
    if (row.watched === true) e.watched += 1;
  }
  return map;
}
