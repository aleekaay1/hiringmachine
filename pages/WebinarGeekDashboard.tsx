import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import { Button } from '../components/UI';
import { supabase } from '../services/supabaseClient';
import { fetchWebinarGeekDashboard, syncWebinarGeekCandidates } from '../services/webinarGeekIntegrations';
import { ChevronLeft, ChevronRight, Download, RefreshCw, Search, X } from 'lucide-react';
import { formatDateTimeCanadaEastern } from '../services/dateDisplay';

type AnyRow = Record<string, unknown>;
type DashboardData = Record<string, unknown>;

const FULL_WATCH_SECONDS = 45 * 60;
const HALF_WATCH_SECONDS = Math.floor(47 * 60 * 0.5);

function asUnixMs(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1e12 ? n : n * 1000;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Toronto calendar YYYY-MM-DD for "today" (wall clock). */
function torontoYmdFromDate(d = new Date()): string {
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

function torontoMonthStartToday(): string {
  const t = torontoYmdFromDate();
  return `${t.slice(0, 7)}-01`;
}

function shiftMonthFirstYmd(firstYmd: string, delta: number): string {
  const [y, m] = firstYmd.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-01`;
}

function monthBoundsFromFirstYmd(firstYmd: string): { since: string; until: string; title: string } {
  const [y, m] = firstYmd.split('-').map(Number);
  const lastD = new Date(y, m, 0).getDate();
  const since = `${y}-${pad2(m)}-01`;
  const until = `${y}-${pad2(m)}-${pad2(lastD)}`;
  const title = new Date(y, m - 1, 7).toLocaleDateString('en-CA', { month: 'long', year: 'numeric' });
  return { since, until, title };
}

/** One API pull: April 15 (Toronto season) through end of next calendar year — all months filter client-side. */
function fetchWindowBoundsWide(): { since: string; until: string; label: string } {
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

function pct(part: number, whole: number): string {
  if (!whole || whole <= 0) return '0';
  return `${Math.round((100 * part) / whole)}%`;
}

function eventMsToTorontoYmd(ms: number): string {
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

function fmtDateKey(row: AnyRow): string {
  const ms =
    asUnixMs((row.broadcast as AnyRow | undefined)?.date) ??
    asUnixMs(row.created_at) ??
    asUnixMs(row.watched_true_set_at);
  if (!ms) return 'unknown';
  return eventMsToTorontoYmd(ms);
}

/** Whole minutes from watch_duration seconds (0 if none). */
function watchMinutes(value: unknown): number {
  const sec = Number(value);
  if (!Number.isFinite(sec) || sec <= 0) return 0;
  return Math.round(sec / 60);
}

function shortCalendarDayLabel(viewYear: number, viewMonth0: number, day: number): string {
  return new Date(viewYear, viewMonth0, day).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
  });
}

function ymdToShortLabel(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return ymd;
  return shortCalendarDayLabel(y, m - 1, d);
}

/** Prefer WebinarGeek custom_field (inviter name), then other attribution fields. */
function getInvitedByDisplay(row: AnyRow): string {
  const custom = String(row.custom_field ?? '').trim();
  if (custom && custom.toLowerCase() !== 'registration_page') return custom;
  const extraFields = row.extra_fields && typeof row.extra_fields === 'object'
    ? row.extra_fields as AnyRow
    : null;
  const options = [
    row.inviter_name,
    row.invited_by,
    row.invited_by_name,
    row.inviter_signal,
    row.utm_source,
    row.utm_term,
    row.utm_content,
    row.registration_page_name,
    row.referrer_name,
    row.affiliate_name,
  ];
  for (const option of options) {
    const s = String(option ?? '').trim();
    if (s && s.toLowerCase() !== 'registration_page') return s;
  }
  const source = String(row.registration_source ?? '').trim();
  if (source && source.toLowerCase() !== 'registration_page') return source;
  if (extraFields) {
    for (const v of Object.values(extraFields)) {
      const s = String(v ?? '').trim();
      if (s && s.toLowerCase() !== 'registration_page') return s;
    }
  }
  return '';
}

/** CSV / Excel: no em-dash mojibake — use 0 when missing. */
function csvScalar(value: string | number): string {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '0';
  const t = value
    .replace(/\u2014/g, '-')
    .replace(/\u2013/g, '-')
    .replace(/\u2212/g, '-')
    .trim();
  if (!t || t === '-' || t === '—') return '0';
  return t;
}

function toCsvCell(value: unknown): string {
  const s = csvScalar(String(value ?? ''));
  return `"${s.replace(/"/g, '""')}"`;
}

function watchBucket(seconds: number): 'full' | 'half' | 'under_half' | 'no_watch' {
  if (seconds >= FULL_WATCH_SECONDS) return 'full';
  if (seconds >= HALF_WATCH_SECONDS) return 'half';
  if (seconds > 0) return 'under_half';
  return 'no_watch';
}

function watchRowToneClass(seconds: number): string {
  const b = watchBucket(seconds);
  if (b === 'full') return 'bg-emerald-50 hover:bg-emerald-100/90';
  if (b === 'half') return 'bg-sky-50 hover:bg-sky-100/90';
  return 'bg-rose-50 hover:bg-rose-100/90';
}

/** Table filter: matches legend rows (full / half+ / little·none). */
type WatchToneFilter = 'full' | 'half' | 'low';

function rowMatchesWatchToneFilter(row: AnyRow, filter: WatchToneFilter): boolean {
  const sec = Number(row.watch_duration || 0);
  const b = watchBucket(sec);
  if (filter === 'full') return b === 'full';
  if (filter === 'half') return b === 'half';
  return b === 'under_half' || b === 'no_watch';
}

function normalizeSubscriptions(data: DashboardData | null): AnyRow[] {
  const payload = data?.subscriptions as Record<string, unknown> | undefined;
  const rows = payload?.subscriptions;
  return Array.isArray(rows) ? (rows as AnyRow[]) : [];
}

function getInviterName(row: AnyRow): string {
  const v = getInvitedByDisplay(row);
  return v || '0';
}

const WebinarGeekDashboard: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [email, setEmail] = useState('admin@globelife-paz.com');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** null = never fetched; array = last fetch result (client-side only until next fetch). */
  const [subscriptionCache, setSubscriptionCache] = useState<AnyRow[] | null>(null);
  const [lastFetchAt, setLastFetchAt] = useState<string | null>(null);
  const [lastFetchRange, setLastFetchRange] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  /** First day of the month being viewed (YYYY-MM-01), Toronto wall month via local month arithmetic. */
  const [monthAnchorYmd, setMonthAnchorYmd] = useState(torontoMonthStartToday);
  /** When set, table shows only that Toronto calendar day; null = whole month window. */
  const [selectedDayYmd, setSelectedDayYmd] = useState<string | null>(null);
  /** Click legend to filter table; click same legend again to clear (null). */
  const [watchToneFilter, setWatchToneFilter] = useState<WatchToneFilter | null>(null);
  const [selectedRow, setSelectedRow] = useState<AnyRow | null>(null);
  const monthWindow = useMemo(() => monthBoundsFromFirstYmd(monthAnchorYmd), [monthAnchorYmd]);

  /** Rows whose event date falls in the calendar month being viewed (no API). */
  const rowsInViewMonth = useMemo(() => {
    if (!subscriptionCache) return [];
    const [vy, vm] = monthAnchorYmd.split('-').map(Number);
    const start = `${vy}-${pad2(vm)}-01`;
    const lastD = new Date(vy, vm, 0).getDate();
    const end = `${vy}-${pad2(vm)}-${pad2(lastD)}`;
    return subscriptionCache.filter((row) => {
      const k = fmtDateKey(row);
      if (k === 'unknown') return false;
      return k >= start && k <= end;
    });
  }, [subscriptionCache, monthAnchorYmd]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rowsInViewMonth.filter((row) => {
      const key = fmtDateKey(row);
      if (selectedDayYmd && key !== selectedDayYmd) return false;
      if (watchToneFilter && !rowMatchesWatchToneFilter(row, watchToneFilter)) return false;
      if (!q) return true;
      const name = `${String(row.firstname ?? '').trim()} ${String(row.surname ?? '').trim()}`.toLowerCase();
      const emailText = String(row.email ?? '').toLowerCase();
      const inviter = getInviterName(row).toLowerCase();
      return name.includes(q) || emailText.includes(q) || inviter.includes(q);
    });
  }, [rowsInViewMonth, selectedDayYmd, searchQuery, watchToneFilter]);

  const toggleWatchToneFilter = useCallback((tone: WatchToneFilter) => {
    setWatchToneFilter((prev) => (prev === tone ? null : tone));
  }, []);

  const monthOverview = useMemo(() => {
    const rows = rowsInViewMonth;
    const n = rows.length;
    let watched = 0;
    let full = 0;
    let half = 0;
    let low = 0;
    for (const r of rows) {
      if (r.watched === true) watched += 1;
      const sec = Number(r.watch_duration || 0);
      const b = watchBucket(sec);
      if (b === 'full') full += 1;
      else if (b === 'half') half += 1;
      else low += 1;
    }
    return { n, watched, full, half, low, ymd: null as string | null };
  }, [rowsInViewMonth]);

  const selectedDayOverview = useMemo(() => {
    if (!selectedDayYmd) return null;
    const rows = rowsInViewMonth.filter((r) => fmtDateKey(r) === selectedDayYmd);
    const n = rows.length;
    let watched = 0;
    let full = 0;
    let half = 0;
    let low = 0;
    for (const r of rows) {
      if (r.watched === true) watched += 1;
      const sec = Number(r.watch_duration || 0);
      const b = watchBucket(sec);
      if (b === 'full') full += 1;
      else if (b === 'half') half += 1;
      else low += 1;
    }
    return { n, watched, full, half, low, ymd: selectedDayYmd };
  }, [rowsInViewMonth, selectedDayYmd]);

  const overviewForUi = selectedDayOverview ?? monthOverview;

  const statTiles = useMemo(() => {
    const { n, watched, full, half, low } = overviewForUi;
    const fullOfWatched = watched > 0 ? Math.round((100 * full) / watched) : 0;
    return [
      { k: 'Registrations', v: String(n), sub: 'in scope' },
      { k: 'Watched', v: pct(watched, n), sub: `${watched} marked yes` },
      { k: 'Full watch', v: pct(full, n), sub: `${full} rows` },
      { k: 'Half+', v: pct(half, n), sub: `${half} rows` },
      { k: 'Little / none', v: pct(low, n), sub: `${low} rows` },
      { k: 'Full of watched', v: `${fullOfWatched}%`, sub: watched ? `${full} / ${watched}` : '—' },
    ];
  }, [overviewForUi]);

  const [viewYear, viewMonth0] = useMemo(() => {
    const [y, m] = monthAnchorYmd.split('-').map(Number);
    return [y, m - 1] as const;
  }, [monthAnchorYmd]);

  const calendarCells = useMemo(() => {
    const firstDow = new Date(viewYear, viewMonth0, 1).getDay();
    const lastDay = new Date(viewYear, viewMonth0 + 1, 0).getDate();
    const cells: (number | null)[] = [];
    for (let i = 0; i < firstDow; i++) cells.push(null);
    for (let d = 1; d <= lastDay; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [viewYear, viewMonth0]);

  const dayCounts = useMemo(() => {
    const map = new Map<string, { invited: number; watched: number }>();
    for (const row of rowsInViewMonth) {
      const key = fmtDateKey(row);
      if (key === 'unknown') continue;
      if (!map.has(key)) map.set(key, { invited: 0, watched: 0 });
      const e = map.get(key)!;
      e.invited += 1;
      if (row.watched === true) e.watched += 1;
    }
    return map;
  }, [rowsInViewMonth]);

  const getFreshAccessToken = useCallback(async (): Promise<string | null> => {
    const { data: s } = await supabase.auth.getSession();
    const session = s.session;
    if (!session) return null;
    const expiresAtMs = (session.expires_at || 0) * 1000;
    if (expiresAtMs > Date.now() + 60_000 && session.access_token) return session.access_token;
    const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
    if (refreshErr) return null;
    return refreshed.session?.access_token ?? null;
  }, []);

  const withAuthRetry = useCallback(
    async <T,>(run: (token: string) => Promise<T | null>): Promise<T | null> => {
      const firstToken = await getFreshAccessToken();
      if (!firstToken) return null;
      const first = await run(firstToken);
      if (first !== null) return first;
      const { data: refreshed } = await supabase.auth.refreshSession();
      const retryToken = refreshed.session?.access_token;
      if (!retryToken) return null;
      return run(retryToken);
    },
    [getFreshAccessToken]
  );

  const fetchDashboardData = useCallback(async () => {
    setError(null);
    setLoading(true);
    const { since, until, label } = fetchWindowBoundsWide();
    const result = await withAuthRetry(async (token) => {
      const r = await fetchWebinarGeekDashboard(token, {
        perPage: 250,
        since,
        until,
        includeCatalog: false,
        maxPages: 36,
      });
      if (!r.ok && r.error.toLowerCase().includes('unauthorized')) return null;
      return r;
    });
    setLoading(false);
    if (!result) {
      setError('Session unauthorized. Sign out and sign in again.');
      return;
    }
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const rows = normalizeSubscriptions(result.data);
    setSubscriptionCache(rows);
    setLastFetchAt(new Date().toISOString());
    setLastFetchRange(label);
  }, [withAuthRetry]);

  const runSync = useCallback(async () => {
    setError(null);
    setSyncLoading(true);
    const { since, until } = fetchWindowBoundsWide();
    const result = await withAuthRetry(async (token) => {
      const r = await syncWebinarGeekCandidates(token, {
        perPage: 250,
        since,
        until,
        maxPages: 36,
      });
      if (!r.ok && r.error.toLowerCase().includes('unauthorized')) return null;
      return r;
    });
    setSyncLoading(false);
    if (!result) {
      setError('Session unauthorized for sync.');
      return;
    }
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await fetchDashboardData();
  }, [withAuthRetry, fetchDashboardData]);

  const handleCsvExport = useCallback(() => {
    const headers = [
      'subscription_id',
      'first_name',
      'last_name',
      'email',
      'invited_by',
      'registration',
      'watch_minutes',
      'watched',
    ];
    const rows = filteredRows.map((row) => {
      const first = csvScalar(String(row.firstname ?? '').trim());
      const last = csvScalar(String(row.surname ?? '').trim());
      const email = csvScalar(String(row.email ?? '').trim());
      const invited = csvScalar(getInvitedByDisplay(row) || '0');
      const regMs = asUnixMs(row.created_at);
      const registration =
        regMs != null ? new Date(regMs).toISOString().slice(0, 16).replace('T', ' ') : '0';
      const mins = watchMinutes(row.watch_duration);
      const watched = row.watched === true ? 'Yes' : 'No';
      return [
        String(row.id ?? '0'),
        first,
        last,
        email,
        invited,
        registration,
        String(mins),
        watched,
      ];
    });
    const line = (cells: string[]) => cells.map(toCsvCell).join(',');
    const csvBody = [line(headers), ...rows.map((r) => line(r))].join('\r\n');
    const csv = `\uFEFF${csvBody}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `webinar-clean-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filteredRows]);

  useEffect(() => {
    const check = async () => {
      const { data: s } = await supabase.auth.getSession();
      if (s.session) setIsAuthenticated(true);
    };
    void check();
  }, []);

  useEffect(() => {
    setSelectedDayYmd(null);
  }, [monthAnchorYmd]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setAuthError('Invalid email or password.');
      return;
    }
    setIsAuthenticated(true);
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#f7fbff] to-[#eef6ff] flex items-center justify-center p-4">
        <div className="bg-white border border-[#d9e9fb] p-8 rounded-[24px] shadow w-full max-w-sm">
          <h2 className="text-xl font-bold text-[#0B1B34] mb-1 text-center">WebinarGeek dashboard</h2>
          <p className="text-sm text-[#6f7b8d] text-center mb-6">Sign in with your admin account</p>
          <form onSubmit={handleLogin} className="space-y-4">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-4 py-2.5 rounded-xl border border-[#cfe3f9]" />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-4 py-2.5 rounded-xl border border-[#cfe3f9]" />
            <Button fullWidth type="submit">Sign in</Button>
            {authError && <p className="text-sm text-red-600 text-center">{authError}</p>}
          </form>
        </div>
      </div>
    );
  }

  return (
    <Layout isAdmin>
      <div className="w-full max-w-6xl mx-auto p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-[#0B1B34] tracking-tight">WebinarGeek</h1>
            {lastFetchAt && (
              <p className="text-[11px] text-slate-500 mt-0.5">
                Loaded {new Date(lastFetchAt).toLocaleString()} · range {lastFetchRange}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={() => void fetchDashboardData()} disabled={loading}>
              {loading ? (
                <>
                  <RefreshCw size={15} className="mr-1 animate-spin" /> Fetching…
                </>
              ) : (
                'Fetch data'
              )}
            </Button>
            <Button type="button" variant="outline" onClick={() => void runSync()} disabled={syncLoading || loading}>
              {syncLoading ? 'Syncing…' : 'Sync'}
            </Button>
            <Button type="button" variant="outline" onClick={handleCsvExport} disabled={!filteredRows.length}>
              <Download size={15} className="mr-1" /> CSV
            </Button>
          </div>
        </div>

        {subscriptionCache !== null && (
          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-3">
              {overviewForUi.ymd ? `Day · ${ymdToShortLabel(overviewForUi.ymd)}` : `Month · ${monthWindow.title}`}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
              {statTiles.map((c) => (
                <div key={c.k} className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2">
                  <p className="text-[10px] text-slate-500 font-medium">{c.k}</p>
                  <p className="text-lg font-semibold text-slate-900 tabular-nums">{c.v}</p>
                  <p className="text-[10px] text-slate-400">{c.sub}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {subscriptionCache === null && !loading && (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-6 text-center text-sm text-slate-600">
            Press <strong>Fetch data</strong> to load a snapshot. Month and day views are local only until you fetch again or reload the page.
          </div>
        )}

        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setMonthAnchorYmd((m) => shiftMonthFirstYmd(m, -1))}
                aria-label="Previous month"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-800 shadow-sm hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              >
                <ChevronLeft className="h-5 w-5" strokeWidth={2.5} aria-hidden />
              </button>
              <span className="text-sm font-medium text-slate-800 min-w-[9rem] text-center px-2">{monthWindow.title}</span>
              <button
                type="button"
                onClick={() => setMonthAnchorYmd((m) => shiftMonthFirstYmd(m, 1))}
                aria-label="Next month"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-800 shadow-sm hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              >
                <ChevronRight className="h-5 w-5" strokeWidth={2.5} aria-hidden />
              </button>
              <Button type="button" variant="outline" className="!min-h-0 h-9 px-3 py-0 text-xs ml-1" onClick={() => setMonthAnchorYmd(torontoMonthStartToday())}>
                Current
              </Button>
            </div>
            <label className="relative flex-1 min-w-[12rem] max-w-md">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Name, email, or inviter"
                className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-slate-200 bg-slate-50/50 focus:outline-none focus:ring-2 focus:ring-slate-300/80"
              />
            </label>
          </div>

          <div className="grid grid-cols-7 gap-1.5 text-center text-[10px] font-medium uppercase tracking-wide text-slate-500 mb-1.5">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
              <div key={d} className="py-1">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {calendarCells.map((day, idx) => {
              if (day == null) {
                return <div key={`e-${idx}`} className="min-h-[64px] rounded-xl bg-slate-50/80" />;
              }
              const ymd = `${viewYear}-${pad2(viewMonth0 + 1)}-${pad2(day)}`;
              const counts = dayCounts.get(ymd);
              const invited = counts?.invited ?? 0;
              const watched = counts?.watched ?? 0;
              const active = selectedDayYmd === ymd;
              const label = shortCalendarDayLabel(viewYear, viewMonth0, day);
              return (
                <button
                  key={ymd}
                  type="button"
                  onClick={() => setSelectedDayYmd((prev) => (prev === ymd ? null : ymd))}
                  className={`min-h-[64px] rounded-xl border text-left px-2 py-1 flex flex-col justify-center gap-0.5 transition ${
                    active ? 'border-slate-800 bg-slate-100 shadow-inner' : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <span className="text-[11px] font-semibold text-slate-900 leading-tight">{label}</span>
                  <span className="text-[10px] text-slate-500 tabular-nums leading-tight">
                    {invited === 0 ? '—' : `${invited} invited`}
                  </span>
                  {invited > 0 && (
                    <span className="text-[9px] text-slate-600 tabular-nums font-medium leading-tight">{pct(watched, invited)} watched</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">{error}</div>}

        <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-100 bg-slate-50/60">
            <p className="text-xs font-medium text-slate-600">
              {selectedDayYmd == null ? monthWindow.title : ymdToShortLabel(selectedDayYmd)}
              {watchToneFilter === 'full' && (
                <span className="text-emerald-800 font-semibold"> · Full watch only</span>
              )}
              {watchToneFilter === 'half' && (
                <span className="text-sky-800 font-semibold"> · Half+ only</span>
              )}
              {watchToneFilter === 'low' && (
                <span className="text-rose-800 font-semibold"> · Little / none only</span>
              )}
            </p>
            <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-600">
              <button
                type="button"
                onClick={() => toggleWatchToneFilter('full')}
                aria-pressed={watchToneFilter === 'full'}
                title="Show only full-watch rows. Click again to clear."
                className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/80 ${
                  watchToneFilter === 'full'
                    ? 'border-emerald-500 bg-emerald-100/90 text-emerald-950 shadow-sm'
                    : 'border-transparent hover:bg-emerald-50/80 hover:border-emerald-200/80'
                }`}
              >
                <span className="h-2.5 w-6 shrink-0 rounded bg-emerald-100 border border-emerald-200/80" aria-hidden />
                Full watch
              </button>
              <button
                type="button"
                onClick={() => toggleWatchToneFilter('half')}
                aria-pressed={watchToneFilter === 'half'}
                title="Show only half+ watch rows. Click again to clear."
                className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/80 ${
                  watchToneFilter === 'half'
                    ? 'border-sky-500 bg-sky-100/90 text-sky-950 shadow-sm'
                    : 'border-transparent hover:bg-sky-50/80 hover:border-sky-200/80'
                }`}
              >
                <span className="h-2.5 w-6 shrink-0 rounded bg-sky-100 border border-sky-200/80" aria-hidden />
                Half+
              </button>
              <button
                type="button"
                onClick={() => toggleWatchToneFilter('low')}
                aria-pressed={watchToneFilter === 'low'}
                title="Show only little / none watch rows. Click again to clear."
                className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/80 ${
                  watchToneFilter === 'low'
                    ? 'border-rose-500 bg-rose-100/90 text-rose-950 shadow-sm'
                    : 'border-transparent hover:bg-rose-50/80 hover:border-rose-200/80'
                }`}
              >
                <span className="h-2.5 w-6 shrink-0 rounded bg-rose-100 border border-rose-200/80" aria-hidden />
                Little / none
              </button>
            </div>
          </div>
          <div className="overflow-auto max-h-[min(70vh,560px)]">
            <table className="min-w-full text-xs text-slate-800">
              <thead className="bg-white sticky top-0 z-10 border-b border-slate-200">
                <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Email</th>
                  <th className="px-3 py-2 font-medium">Invited by</th>
                  <th className="px-3 py-2 font-medium">Registered</th>
                  <th className="px-3 py-2 font-medium">Watched</th>
                  <th className="px-3 py-2 font-medium">Watch (min)</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-slate-500">
                      No rows
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => {
                    const name = `${String(row.firstname || '').trim()} ${String(row.surname || '').trim()}`.trim() || '0';
                    const durationSec = Number(row.watch_duration || 0);
                    const regMs = asUnixMs(row.created_at);
                    const tone = watchRowToneClass(durationSec);
                    return (
                      <tr
                        key={String(row.id)}
                        className={`border-b border-slate-100/90 cursor-pointer ${tone}`}
                        onClick={() => setSelectedRow(row)}
                      >
                        <td className="px-3 py-2 font-medium text-slate-900">{name}</td>
                        <td className="px-3 py-2 text-slate-700">{String(row.email || '0')}</td>
                        <td className="px-3 py-2 text-slate-700">{getInviterName(row)}</td>
                        <td className="px-3 py-2 text-slate-600 tabular-nums">
                          {regMs ? formatDateTimeCanadaEastern(regMs) : '0'}
                        </td>
                        <td className="px-3 py-2">{row.watched === true ? 'Yes' : 'No'}</td>
                        <td className="px-3 py-2 tabular-nums">{watchMinutes(row.watch_duration)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {selectedRow && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-lg max-h-[85vh] overflow-auto shadow-xl">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <p className="font-semibold text-slate-900">Details</p>
                <button type="button" onClick={() => setSelectedRow(null)} className="text-slate-400 hover:text-slate-700 p-1" aria-label="Close">
                  <X size={18} />
                </button>
              </div>
              <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <Detail label="Name" value={`${String(selectedRow.firstname || '').trim()} ${String(selectedRow.surname || '').trim()}`.trim() || '0'} />
                <Detail label="Email" value={String(selectedRow.email || '0')} />
                <Detail label="Invited by" value={getInviterName(selectedRow)} />
                <Detail
                  label="Registered"
                  value={(() => {
                    const t = asUnixMs(selectedRow.created_at);
                    return t ? formatDateTimeCanadaEastern(t) : '0';
                  })()}
                />
                <Detail label="Watched" value={selectedRow.watched === true ? 'Yes' : 'No'} />
                <Detail label="Watch (min)" value={String(watchMinutes(selectedRow.watch_duration))} />
                <Detail label="Subscription" value={selectedRow.unsubscribed === true ? 'Unsubscribed' : 'Active'} />
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
};

const Detail = ({ label, value }: { label: string; value: string }) => (
  <div>
    <p className="text-xs text-[#60728c]">{label}</p>
    <p className="text-sm text-[#0B1B34]">{value?.trim() ? value : '0'}</p>
  </div>
);

export default WebinarGeekDashboard;
