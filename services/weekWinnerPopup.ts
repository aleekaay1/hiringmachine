import type { RecruiterLeaderboardRow } from './pipelineLeaderboard';
import { COINS_PER_LIVE_SESSION_SHOW, COINS_PER_SHOW } from './recruiterCoins';
import {
  fridayWeekBoundsFromYmd,
  shiftYmdDays,
  torontoYmdFromDate,
  ymdToLocalDate,
  ymdToShortLabel,
} from './webinarGeekDates';

const DISMISS_PREFIX = 'pohiring_week_winner_dismissed:';
const SESSION_PREFIX = 'pohiring_week_winner_session:';

/** Show Fri–Sat Toronto after each Fri–Thu competition week ends. */
const ANNOUNCEMENT_DAYS = 2;

export type LastWeekWinnerContext = {
  weekSinceYmd: string;
  weekUntilYmd: string;
  windowLabel: string;
  winner: RecruiterLeaderboardRow;
  weekPazCoins: number;
};

export function lastCompletedCompetitionWeek(now = new Date()): {
  since: string;
  until: string;
  title: string;
} {
  const todayYmd = torontoYmdFromDate(now);
  const currentWeek = fridayWeekBoundsFromYmd(todayYmd);
  return fridayWeekBoundsFromYmd(shiftYmdDays(currentWeek.since, -7));
}

export function isWeekWinnerAnnouncementOpen(now = new Date()): boolean {
  const lastWeek = lastCompletedCompetitionWeek(now);
  const announceStartYmd = shiftYmdDays(lastWeek.until, 1);
  const start = ymdToLocalDate(announceStartYmd);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + ANNOUNCEMENT_DAYS);
  const nowMs = now.getTime();
  return nowMs >= start.getTime() && nowMs < end.getTime();
}

function dismissStorageKey(userId: string, weekSinceYmd: string): string {
  return `${DISMISS_PREFIX}${userId}:${weekSinceYmd}`;
}

function sessionStorageKey(userId: string, weekSinceYmd: string): string {
  return `${SESSION_PREFIX}${userId}:${weekSinceYmd}`;
}

export function isWeekWinnerDismissed(userId: string, weekSinceYmd: string): boolean {
  if (typeof window === 'undefined' || !userId || !weekSinceYmd) return true;
  try {
    return window.localStorage.getItem(dismissStorageKey(userId, weekSinceYmd)) === '1';
  } catch {
    return false;
  }
}

export function dismissWeekWinnerAnnouncement(userId: string, weekSinceYmd: string): void {
  if (typeof window === 'undefined' || !userId || !weekSinceYmd) return;
  try {
    window.localStorage.setItem(dismissStorageKey(userId, weekSinceYmd), '1');
  } catch {
    // ignore quota errors
  }
}

export function markWeekWinnerShownThisSession(userId: string, weekSinceYmd: string): void {
  if (typeof window === 'undefined' || !userId || !weekSinceYmd) return;
  try {
    window.sessionStorage.setItem(sessionStorageKey(userId, weekSinceYmd), '1');
  } catch {
    // ignore
  }
}

export function wasWeekWinnerShownThisSession(userId: string, weekSinceYmd: string): boolean {
  if (typeof window === 'undefined' || !userId || !weekSinceYmd) return false;
  try {
    return window.sessionStorage.getItem(sessionStorageKey(userId, weekSinceYmd)) === '1';
  } catch {
    return false;
  }
}

export function estimateWeekPazCoinsFromLeaderboardRow(row: RecruiterLeaderboardRow): number {
  return row.webinarShowed * COINS_PER_SHOW + row.liveSessionShowed * COINS_PER_LIVE_SESSION_SHOW;
}

export function pickWeekWinner(rows: RecruiterLeaderboardRow[]): RecruiterLeaderboardRow | null {
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => a.rank - b.rank);
  return sorted[0] ?? null;
}

export function formatWeekWinnerPeriodLabel(sinceYmd: string, untilYmd: string): string {
  return `${ymdToShortLabel(sinceYmd)} → ${ymdToShortLabel(untilYmd)}`;
}
