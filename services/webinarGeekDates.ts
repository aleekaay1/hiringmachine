/** Shared Toronto calendar helpers for WebinarGeek dashboards. */

type AnyRow = Record<string, unknown>;

export function asUnixMs(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1e12 ? n : n * 1000;
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function torontoYmdFromDate(d = new Date()): string {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const y = p.find((x) => x.type === 'year')?.value ?? '1970';
  const mo = p.find((x) => x.type === 'month')?.value ?? '01';
  const da = p.find((x) => x.type === 'day')?.value ?? '01';
  return `${y}-${mo}-${da}`;
}

export function torontoMonthStartToday(): string {
  const t = torontoYmdFromDate();
  return `${t.slice(0, 7)}-01`;
}

export function shiftMonthFirstYmd(firstYmd: string, delta: number): string {
  const [y, m] = firstYmd.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-01`;
}

export function monthBoundsFromFirstYmd(firstYmd: string): { since: string; until: string; title: string } {
  const [y, m] = firstYmd.split('-').map(Number);
  const lastD = new Date(y, m, 0).getDate();
  const since = `${y}-${pad2(m)}-01`;
  const until = `${y}-${pad2(m)}-${pad2(lastD)}`;
  const title = new Date(y, m - 1, 7).toLocaleDateString('en-CA', { month: 'long', year: 'numeric' });
  return { since, until, title };
}

export function ymdToLocalDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function localDateToYmd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function shiftYmdDays(ymd: string, deltaDays: number): string {
  const d = ymdToLocalDate(ymd);
  d.setDate(d.getDate() + deltaDays);
  return localDateToYmd(d);
}

export function fridayWeekBoundsFromYmd(ymd: string): { since: string; until: string; title: string } {
  const d = ymdToLocalDate(ymd);
  const dow = d.getDay();
  const offsetToFriday = (dow + 2) % 7;
  const start = new Date(d);
  start.setDate(d.getDate() - offsetToFriday);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const since = localDateToYmd(start);
  const until = localDateToYmd(end);
  const title = `${ymdToShortLabel(since)} → ${ymdToShortLabel(until)}`;
  return { since, until, title };
}

export function fetchWindowBoundsWide(): { since: string; until: string; label: string } {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date());
  const y = Number(p.find((x) => x.type === 'year')?.value ?? '2026');
  const m = Number(p.find((x) => x.type === 'month')?.value ?? '1');
  const d = Number(p.find((x) => x.type === 'day')?.value ?? '1');
  const seasonYear = m > 4 || (m === 4 && d >= 15) ? y : y - 1;
  const since = `${seasonYear}-04-15`;
  const until = `${seasonYear + 1}-12-31`;
  return { since, until, label: `${since} → ${until}` };
}

export function eventMsToTorontoYmd(ms: number): string {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ms));
  const y = p.find((x) => x.type === 'year')?.value ?? '1970';
  const mo = p.find((x) => x.type === 'month')?.value ?? '01';
  const da = p.find((x) => x.type === 'day')?.value ?? '01';
  return `${y}-${mo}-${da}`;
}

export function ymdToShortLabel(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return ymd;
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
  });
}

export function shortCalendarDayLabel(viewYear: number, viewMonth0: number, day: number): string {
  return new Date(viewYear, viewMonth0, day).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
  });
}

export function pct(part: number, whole: number): string {
  if (!whole || whole <= 0) return '0';
  return `${Math.round((100 * part) / whole)}%`;
}
