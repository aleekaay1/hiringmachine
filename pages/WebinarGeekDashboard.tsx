import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import { Button } from '../components/UI';
import { supabase } from '../services/supabaseClient';
import {
  fetchWebinarGeekDashboard,
  fetchWebinarGeekHealth,
  syncWebinarGeekCandidates,
} from '../services/webinarGeekIntegrations';
import { ChevronLeft, ChevronRight, Download, RefreshCw, Search, ShieldCheck, X } from 'lucide-react';
import { formatDateCanadaEastern, formatDateTimeCanadaEastern } from '../services/dateDisplay';

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

function durationLabel(value: unknown): string {
  const sec = Number(value);
  if (!Number.isFinite(sec) || sec <= 0) return '0m 0s';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}

function watchBucket(seconds: number): 'full' | 'half' | 'under_half' | 'no_watch' {
  if (seconds >= FULL_WATCH_SECONDS) return 'full';
  if (seconds >= HALF_WATCH_SECONDS) return 'half';
  if (seconds > 0) return 'under_half';
  return 'no_watch';
}

function normalizeSubscriptions(data: DashboardData | null): AnyRow[] {
  const payload = data?.subscriptions as Record<string, unknown> | undefined;
  const rows = payload?.subscriptions;
  return Array.isArray(rows) ? (rows as AnyRow[]) : [];
}

function normalizeHealth(data: DashboardData | null): { connected: boolean; note?: string } {
  const h = data?.health as Record<string, unknown> | undefined;
  const connected = Boolean(h?.subscriptions_ok);
  return { connected, note: connected ? undefined : 'One or more API calls failed' };
}

function toCsvValue(value: unknown): string {
  const raw = String(value ?? '');
  return `"${raw.replace(/"/g, '""')}"`;
}

function getInviterName(row: AnyRow): string {
  const extraFields = row.extra_fields && typeof row.extra_fields === 'object'
    ? row.extra_fields as AnyRow
    : null;
  const options = [
    row.inviter_signal,
    row.inviter_name,
    row.invited_by,
    row.invited_by_name,
    row.utm_source,
    row.utm_term,
    row.utm_content,
    row.custom_field,
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
  return 'Unknown inviter';
}

function getAttributionDebug(row: AnyRow): string {
  const parts: string[] = [];
  const source = String(row.registration_source ?? '').trim();
  if (source) parts.push(`source=${source}`);
  const custom = String(row.custom_field ?? '').trim();
  if (custom) parts.push(`custom_field=${custom}`);
  const signal = String(row.inviter_signal ?? '').trim();
  if (signal) parts.push(`inviter_signal=${signal}`);
  const utmSource = String(row.utm_source ?? '').trim();
  if (utmSource) parts.push(`utm_source=${utmSource}`);
  const utmTerm = String(row.utm_term ?? '').trim();
  if (utmTerm) parts.push(`utm_term=${utmTerm}`);
  const utmContent = String(row.utm_content ?? '').trim();
  if (utmContent) parts.push(`utm_content=${utmContent}`);
  const extra = row.extra_fields && typeof row.extra_fields === 'object'
    ? JSON.stringify(row.extra_fields)
    : '';
  if (extra) parts.push(`extra_fields=${extra}`);
  return parts.length > 0 ? parts.join(' | ') : 'No attribution fields in payload';
}

const WebinarGeekDashboard: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [email, setEmail] = useState('admin@globelife-paz.com');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [healthLoading, setHealthLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [syncResult, setSyncResult] = useState<Record<string, unknown> | null>(null);

  const [webinarId, setWebinarId] = useState('');
  const [broadcastId, setBroadcastId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  /** First day of the month being viewed (YYYY-MM-01), Toronto wall month via local month arithmetic. */
  const [monthAnchorYmd, setMonthAnchorYmd] = useState(torontoMonthStartToday);
  /** When set, table shows only that Toronto calendar day; null = whole month window. */
  const [selectedDayYmd, setSelectedDayYmd] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState<AnyRow | null>(null);
  const [includeCatalog, setIncludeCatalog] = useState(false);

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

  const daySummary = useMemo(() => {
    const rows = filteredRows;
    const invited = rows.length;
    const watched = rows.filter((r) => r.watched === true).length;
    const fullWatched = rows.filter((r) => watchBucket(Number(r.watch_duration || 0)) === 'full').length;
    const unsubscribed = rows.filter((r) => r.unsubscribed === true).length;
    return { invited, watched, fullWatched, unsubscribed };
  }, [filteredRows]);

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
        webinarId: webinarId.trim() || undefined,
        broadcastId: broadcastId.trim() || undefined,
        perPage: 250,
        since,
        until,
        includeCatalog,
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
  }, [broadcastId, webinarId, withAuthRetry, monthWindow, includeCatalog]);

  const loadHealth = useCallback(async () => {
    setError(null);
    setHealthLoading(true);
    const result = await withAuthRetry(async (token) => {
      const r = await fetchWebinarGeekHealth(token);
      if (!r.ok && r.error.toLowerCase().includes('unauthorized')) return null;
      return r;
    });
    setHealthLoading(false);
    if (!result) {
      setError('Session unauthorized for health check.');
      setHealth(null);
      return;
    }
    if (!result.ok) {
      setError(result.error);
      setHealth(null);
      return;
    }
    setHealth(result.data);
  }, [withAuthRetry]);

  const runSync = useCallback(async () => {
    setError(null);
    setSyncLoading(true);
    const result = await withAuthRetry(async (token) => {
      const { since, until } = monthWindow;
      const r = await syncWebinarGeekCandidates(token, {
        webinarId: webinarId.trim() || undefined,
        broadcastId: broadcastId.trim() || undefined,
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
    setSyncResult(result.data);
    await loadDashboard();
  }, [broadcastId, webinarId, withAuthRetry, loadDashboard, monthWindow]);

  const handleCsvExport = useCallback(() => {
    const headers = [
      'candidate_name',
      'email',
      'inviter',
      'date',
      'time',
      'watched',
      'watch_type',
      'watch_duration',
      'subscribed_status',
      'webinar',
      'broadcast_id',
    ];
    const rows = filteredRows.map((row) => {
      const name = `${String(row.firstname || '').trim()} ${String(row.surname || '').trim()}`.trim();
      const ms =
        asUnixMs((row.broadcast as AnyRow | undefined)?.date) ??
        asUnixMs(row.created_at) ??
        asUnixMs(row.watched_true_set_at);
      const watched = row.watched === true ? 'Yes' : 'No';
      const dateLabel = ms ? formatDateCanadaEastern(ms) : '—';
      const timeOnly =
        ms
          ? new Intl.DateTimeFormat('en-CA', {
              timeZone: 'America/Toronto',
              timeStyle: 'short',
            }).format(new Date(ms))
          : '—';
      const watchType =
        row.watched_live === true ? 'Live'
        : row.watched_replay === true ? 'Replay'
        : 'None';
      const status = row.unsubscribed === true ? 'Unsubscribed' : 'Subscribed';
      return [
        name || '—',
        String(row.email || '—'),
        getInviterName(row),
        dateLabel,
        timeOnly,
        watched,
        watchType,
        durationLabel(row.watch_duration),
        status,
        String((row.webinar as AnyRow | undefined)?.title || '—'),
        String((row.broadcast as AnyRow | undefined)?.id || '—'),
      ];
    });
    const csv = [headers.map(toCsvValue).join(','), ...rows.map((r) => r.map(toCsvValue).join(','))].join('\n');
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
  }, [monthAnchorYmd, webinarId, broadcastId]);

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
      <div className="w-full p-6 space-y-4">
        <div className="rounded-xl border border-[#d6deea] bg-white p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-[#0B1B34]">WebinarGeek — month calendar</h1>
            <p className="text-xs text-[#60728c]">
              Loads subscriptions for <strong>{monthWindow.title}</strong> ({monthWindow.since} → {monthWindow.until}, Toronto dates). Use arrows to change month; click a day to filter the table.
            </p>
            {data && (
              <p className="text-[11px] text-[#60728c] mt-1">
                Rows in window: {subscriptions.length} · Shown: {filteredRows.length}
                {includeCatalog ? ' · Full webinar/broadcast catalog loaded' : ''}
              </p>
            )}
            {health && (() => {
              const status = normalizeHealth(health);
              return (
                <p className={`text-[11px] mt-1 ${status.connected ? 'text-green-700' : 'text-amber-700'}`}>
                  API status: {status.connected ? 'connected' : status.note || 'degraded'}
                </p>
              );
            })()}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={() => void loadHealth()} disabled={healthLoading}>
              <ShieldCheck size={15} className="mr-1" /> Health
            </Button>
            <Button type="button" onClick={() => void runSync()} disabled={syncLoading}>
              {syncLoading ? 'Syncing...' : 'Sync DB'}
            </Button>
            <Button type="button" variant="outline" onClick={handleCsvExport}>
              <Download size={15} className="mr-1" /> Clean CSV
            </Button>
            <Button type="button" variant="outline" onClick={() => void loadDashboard()} disabled={loading}>
              <RefreshCw size={15} className={`mr-1 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </Button>
          </div>
        </div>

        <div className="rounded-xl border border-[#d6deea] bg-white p-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={() => setMonthAnchorYmd((m) => shiftMonthFirstYmd(m, -1))} aria-label="Previous month">
                <ChevronLeft size={18} />
              </Button>
              <span className="text-sm font-semibold text-[#0B1B34] min-w-[10rem] text-center">{monthWindow.title}</span>
              <Button type="button" variant="outline" onClick={() => setMonthAnchorYmd((m) => shiftMonthFirstYmd(m, 1))} aria-label="Next month">
                <ChevronRight size={18} />
              </Button>
              <Button type="button" variant="outline" onClick={() => setMonthAnchorYmd(torontoMonthStartToday())}>
                This month
              </Button>
            </div>
            <label className="flex items-center gap-2 text-xs text-[#4f6787] cursor-pointer select-none">
              <input type="checkbox" checked={includeCatalog} onChange={(e) => setIncludeCatalog(e.target.checked)} className="rounded border-[#cfe3f9]" />
              Load webinar &amp; broadcast lists (slower)
            </label>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
            <input value={webinarId} onChange={(e) => setWebinarId(e.target.value)} placeholder="webinar_id (optional)" className="px-3 py-2 rounded-lg border border-[#cfe3f9]" />
            <input value={broadcastId} onChange={(e) => setBroadcastId(e.target.value)} placeholder="broadcast_id (optional)" className="px-3 py-2 rounded-lg border border-[#cfe3f9]" />
            <label className="relative md:col-span-1">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#789]" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search name / email / inviter"
                className="w-full pl-8 pr-3 py-2 rounded-lg border border-[#cfe3f9]"
              />
            </label>
            <Button type="button" onClick={() => void loadDashboard()} disabled={loading}>Reload data</Button>
          </div>
        </div>

        {syncResult && (
          <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">
            Synced subscriptions: {String(syncResult.total_subscriptions ?? 0)} | matched: {String(syncResult.matched_subscriptions ?? 0)} | unmatched: {String(syncResult.unmatched_subscriptions ?? 0)}
            {Number(syncResult.estimated_unverified_or_pending ?? 0) > 0 && (
              <span> | not-yet-verified/pending (estimated): {String(syncResult.estimated_unverified_or_pending)}</span>
            )}
          </div>
        )}
        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

        <div className="rounded-xl border border-[#d6deea] bg-white p-4">
          <p className="text-sm font-semibold text-[#0B1B34] mb-3">Calendar (Toronto) — click a day to filter</p>
          <div className="flex flex-wrap gap-2 mb-3">
            <button
              type="button"
              onClick={() => setSelectedDayYmd(null)}
              className={`px-3 py-1.5 rounded-full text-xs border ${selectedDayYmd == null ? 'bg-[#005EB8] text-white border-[#005EB8]' : 'bg-white text-[#4f6787] border-[#cfe3f9]'}`}
            >
              Whole month
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-[#60728c] mb-1">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
              <div key={d} className="py-1">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {calendarCells.map((day, idx) => {
              if (day == null) {
                return <div key={`e-${idx}`} className="min-h-[52px] rounded-lg bg-[#f4f7fb]" />;
              }
              const ymd = `${viewYear}-${pad2(viewMonth0 + 1)}-${pad2(day)}`;
              const counts = dayCounts.get(ymd);
              const invited = counts?.invited ?? 0;
              const watched = counts?.watched ?? 0;
              const active = selectedDayYmd === ymd;
              return (
                <button
                  key={ymd}
                  type="button"
                  onClick={() => setSelectedDayYmd((prev) => (prev === ymd ? null : ymd))}
                  className={`min-h-[52px] rounded-lg border text-left p-1.5 flex flex-col justify-between transition ${
                    active
                      ? 'border-[#005EB8] bg-[#e8f2fc] ring-1 ring-[#005EB8]'
                      : 'border-[#e2eaf5] bg-white hover:border-[#9db7dc]'
                  }`}
                >
                  <span className="text-sm font-bold text-[#0B1B34]">{day}</span>
                  <span className="text-[10px] text-[#5a6d86] leading-tight">
                    {invited ? `${invited} reg` : '—'}
                    {watched ? ` · ${watched} watched` : ''}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-[#d6deea] bg-white p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <InfoStat label="Invited" value={daySummary.invited} />
          <InfoStat label="Watched" value={daySummary.watched} />
          <InfoStat label="Fully Watched" value={daySummary.fullWatched} />
          <InfoStat label="Unsubscribed" value={daySummary.unsubscribed} />
        </div>

        <div className="rounded-xl border border-[#d6deea] bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-[#e7eef8] bg-[#f8fbff]">
            <p className="text-sm font-semibold text-[#0B1B34]">
              {selectedDayYmd == null
                ? `All days in ${monthWindow.title}`
                : `Records for ${selectedDayYmd} (Toronto calendar day)`}
            </p>
          </div>
          <div className="overflow-auto max-h-[60vh]">
            <table className="min-w-full text-xs">
              <thead className="bg-[#f7fbff] sticky top-0 z-10">
                <tr>
                  <th className="text-left px-3 py-2">Candidate</th>
                  <th className="text-left px-3 py-2">Email</th>
                  <th className="text-left px-3 py-2">Inviter</th>
                  <th className="text-left px-3 py-2">When (Toronto)</th>
                  <th className="text-left px-3 py-2">Watched</th>
                  <th className="text-left px-3 py-2">Watch Details</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-left px-3 py-2">Webinar</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr><td colSpan={8} className="px-3 py-6 text-center text-[#7b8aa0]">No records for this filter.</td></tr>
                ) : filteredRows.map((row) => {
                  const name = `${String(row.firstname || '').trim()} ${String(row.surname || '').trim()}`.trim() || 'Unnamed';
                  const durationSec = Number(row.watch_duration || 0);
                  const bucket = watchBucket(durationSec);
                  const ms =
                    asUnixMs((row.broadcast as AnyRow | undefined)?.date) ??
                    asUnixMs(row.created_at) ??
                    asUnixMs(row.watched_true_set_at);
                  return (
                    <tr
                      key={String(row.id)}
                      className="border-t border-[#edf2fb] hover:bg-[#f8fbff] cursor-pointer"
                      onClick={() => setSelectedRow(row)}
                    >
                      <td className="px-3 py-2">{name}</td>
                      <td className="px-3 py-2">{String(row.email || '—')}</td>
                      <td className="px-3 py-2">{getInviterName(row)}</td>
                      <td className="px-3 py-2">{ms ? formatDateTimeCanadaEastern(ms) : '—'}</td>
                      <td className="px-3 py-2">{row.watched === true ? 'Yes' : 'No'}</td>
                      <td className="px-3 py-2">{durationLabel(durationSec)} ({bucket})</td>
                      <td className="px-3 py-2">{row.unsubscribed === true ? 'Unsubscribed' : 'Subscribed'}</td>
                      <td className="px-3 py-2">{String((row.webinar as AnyRow | undefined)?.title || '—')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {selectedRow && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl border border-[#d6deea] w-full max-w-2xl max-h-[85vh] overflow-auto">
              <div className="px-4 py-3 border-b border-[#e7eef8] flex items-center justify-between">
                <p className="font-semibold text-[#0B1B34]">Webinar candidate details</p>
                <button type="button" onClick={() => setSelectedRow(null)} className="text-gray-500 hover:text-gray-800">
                  <X size={18} />
                </button>
              </div>
              <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <Detail label="Name" value={`${String(selectedRow.firstname || '').trim()} ${String(selectedRow.surname || '').trim()}`.trim() || '—'} />
                <Detail label="Email" value={String(selectedRow.email || '—')} />
                <Detail label="Inviter" value={getInviterName(selectedRow)} />
                <Detail label="Registration source" value={String(selectedRow.registration_source || '—')} />
                <Detail
                  label="Created"
                  value={(() => {
                    const t = asUnixMs(selectedRow.created_at);
                    return t ? formatDateTimeCanadaEastern(t) : '—';
                  })()}
                />
                <Detail label="Watched" value={selectedRow.watched === true ? 'Yes' : 'No'} />
                <Detail
                  label="Watch start"
                  value={(() => {
                    const t = asUnixMs(selectedRow.watch_start);
                    return t ? formatDateTimeCanadaEastern(t) : '—';
                  })()}
                />
                <Detail
                  label="Watch end"
                  value={(() => {
                    const t = asUnixMs(selectedRow.watch_end);
                    return t ? formatDateTimeCanadaEastern(t) : '—';
                  })()}
                />
                <Detail label="Watch duration" value={durationLabel(selectedRow.watch_duration)} />
                <Detail label="Live watch duration" value={durationLabel(selectedRow.watch_duration_live)} />
                <Detail label="Replay watch duration" value={durationLabel(selectedRow.watch_duration_replay)} />
                <Detail label="Subscription status" value={selectedRow.unsubscribed === true ? 'Unsubscribed' : 'Subscribed'} />
                <div className="md:col-span-2">
                  <p className="text-xs text-[#60728c] mb-1">Attribution debug</p>
                  <p className="text-xs text-[#334a69] break-words rounded-md border border-[#e7eef8] bg-[#f8fbff] px-2 py-2">
                    {getAttributionDebug(selectedRow)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
};

const InfoStat = ({ label, value }: { label: string; value: number }) => (
  <div className="rounded-lg border border-[#e7eef8] bg-[#f8fbff] px-3 py-2">
    <p className="text-[11px] uppercase tracking-wide text-[#6d7f98]">{label}</p>
    <p className="text-lg font-bold text-[#0B1B34]">{value}</p>
  </div>
);

const Detail = ({ label, value }: { label: string; value: string }) => (
  <div>
    <p className="text-xs text-[#60728c]">{label}</p>
    <p className="text-sm text-[#0B1B34]">{value || '—'}</p>
  </div>
);

export default WebinarGeekDashboard;
