import {
  fridayWeekBoundsFromYmd,
  shiftYmdDays,
  torontoYmdFromDate,
  ymdToLocalDate,
} from './webinarGeekDates';

/** End of the current Fri–Thu competition week (Thursday 23:59:59 local). */
export function currentFridayWeekEndDate(now = new Date()): Date {
  const { until } = fridayWeekBoundsFromYmd(torontoYmdFromDate(now));
  return endOfYmdLocal(until);
}

/** End of the prior Fri–Thu week (completed last week). */
export function lastFridayWeekEndDate(now = new Date()): Date {
  const todayYmd = torontoYmdFromDate(now);
  const currentWeek = fridayWeekBoundsFromYmd(todayYmd);
  const lastWeek = fridayWeekBoundsFromYmd(shiftYmdDays(currentWeek.since, -7));
  return endOfYmdLocal(lastWeek.until);
}

export function endOfYmdLocal(ymd: string): Date {
  const end = ymdToLocalDate(ymd);
  end.setHours(23, 59, 59, 999);
  return end;
}

export function formatCountdownRemaining(ms: number): string {
  if (ms <= 0) return 'Period ended';
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m ${seconds}s`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  return `${minutes}m ${seconds}s`;
}
