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
  const [data, setData] = useState<DashboardData | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  /** First day of the month being viewed (YYYY-MM-01), Toronto wall month via local month arithmetic. */
  const [monthAnchorYmd, setMonthAnchorYmd] = useState(torontoMonthStartToday);
  /** When set, table shows only that Toronto calendar day; null = whole month window. */
  const [selectedDayYmd, setSelectedDayYmd] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState<AnyRow | null>(null);
  const monthWindow = useMemo(() => monthBoundsFromFirstYmd(monthAnchorYmd), [monthAnchorYmd]);

  const subscriptions = useMemo(() => normalizeSubscriptions(data), [data]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return subscriptions.filter((row) => {
      const key = fmtDateKey(row);
      if (selectedDayYmd && key !== selectedDayYmd) return false;
      if (!q) return true;
      const name = `${String(row.firstname ?? '').trim()} ${String(row.surname ?? '').trim()}`.toLowerCase();
      const emailText = String(row.email ?? '').toLowerCase();
      const inviter = getInviterName(row).toLowerCase();
      return name.includes(q) || emailText.includes(q) || inviter.includes(q);
    });
  }, [subscriptions, selectedDayYmd, searchQuery]);

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
    for (const row of subscriptions) {
      const key = fmtDateKey(row);
      if (key === 'unknown') continue;
      if (!map.has(key)) map.set(key, { invited: 0, watched: 0 });
      const e = map.get(key)!;
      e.invited += 1;
      if (row.watched === true) e.watched += 1;
    }
    return map;
  }, [subscriptions]);

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

  const loadDashboard = useCallback(async () => {
    setError(null);
    setLoading(true);
    const { since, until } = monthWindow;
    const result = await withAuthRetry(async (token) => {
      const r = await fetchWebinarGeekDashboard(token, {
        perPage: 250,
        since,
        until,
        includeCatalog: false,
        maxPages: 22,
      });
      if (!r.ok && r.error.toLowerCase().includes('unauthorized')) return null;
      return r;
    });
    setLoading(false);
    if (!result) {
      setError('Session unauthorized. Sign out and sign in again.');
      setData(null);
      return;
    }
    if (!result.ok) {
      setError(result.error);
      setData(null);
      return;
    }
    setData(result.data);
  }, [withAuthRetry, monthWindow]);

  const runSync = useCallback(async () => {
    setError(null);
    setSyncLoading(true);
    const result = await withAuthRetry(async (token) => {
      const { since, until } = monthWindow;
      const r = await syncWebinarGeekCandidates(token, {
        perPage: 250,
        since,
        until,
        maxPages: 22,
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
    await loadDashboard();
  }, [withAuthRetry, loadDashboard, monthWindow]);

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
    if (!isAuthenticated) return;
    void loadDashboard();
  }, [isAuthenticated, loadDashboard]);

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
          <h1 className="text-lg font-semibold text-[#0B1B34] tracking-tight">WebinarGeek</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={() => void runSync()} disabled={syncLoading}>
              {syncLoading ? 'Syncing…' : 'Sync'}
            </Button>
            <Button type="button" variant="outline" onClick={handleCsvExport}>
              <Download size={15} className="mr-1" /> CSV
            </Button>
            <Button type="button" variant="outline" onClick={() => void loadDashboard()} disabled={loading}>
              <RefreshCw size={15} className={`mr-1 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-1">
              <Button type="button" variant="outline" className="h-9 w-9 p-0" onClick={() => setMonthAnchorYmd((m) => shiftMonthFirstYmd(m, -1))} aria-label="Previous month">
                <ChevronLeft size={18} />
              </Button>
              <span className="text-sm font-medium text-slate-800 min-w-[9rem] text-center px-2">{monthWindow.title}</span>
              <Button type="button" variant="outline" className="h-9 w-9 p-0" onClick={() => setMonthAnchorYmd((m) => shiftMonthFirstYmd(m, 1))} aria-label="Next month">
                <ChevronRight size={18} />
              </Button>
              <Button type="button" variant="outline" className="h-9 text-xs ml-1" onClick={() => setMonthAnchorYmd(torontoMonthStartToday())}>
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
                return <div key={`e-${idx}`} className="min-h-[56px] rounded-xl bg-slate-50/80" />;
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
                  className={`min-h-[56px] rounded-xl border text-left px-2 py-1.5 flex flex-col justify-center gap-0.5 transition ${
                    active ? 'border-slate-800 bg-slate-100 shadow-inner' : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <span className="text-[11px] font-semibold text-slate-900 leading-tight">{label}</span>
                  <span className="text-[10px] text-slate-500 tabular-nums">
                    {invited} · {watched} watched
                  </span>
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
            </p>
            <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-600">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-6 rounded bg-emerald-100 border border-emerald-200/80" /> Full watch
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-6 rounded bg-sky-100 border border-sky-200/80" /> Half+
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-6 rounded bg-rose-100 border border-rose-200/80" /> Little / none
              </span>
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
