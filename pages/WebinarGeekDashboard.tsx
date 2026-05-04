import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Layout from '../components/Layout';
import { Button } from '../components/UI';
import { supabase } from '../services/supabaseClient';
import {
  fetchWebinarGeekDashboard,
  fetchWebinarGeekHealth,
  syncWebinarGeekCandidates,
} from '../services/webinarGeekIntegrations';
import { Download, RefreshCw, Search, ShieldCheck, X } from 'lucide-react';

type AnyRow = Record<string, unknown>;
type DashboardData = Record<string, unknown>;

const FULL_WATCH_SECONDS = 45 * 60;
const HALF_WATCH_SECONDS = Math.floor(47 * 60 * 0.5);

function asUnixMs(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1e12 ? n : n * 1000;
}

function fmtDateTime(value: unknown): string {
  const ms = asUnixMs(value);
  if (!ms) return '—';
  return new Date(ms).toLocaleString();
}

function fmtDateKey(row: AnyRow): string {
  const ms =
    asUnixMs((row.broadcast as AnyRow | undefined)?.date) ??
    asUnixMs(row.created_at) ??
    asUnixMs(row.watched_true_set_at);
  if (!ms) return 'Unknown date';
  return new Date(ms).toISOString().slice(0, 10);
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
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDate, setSelectedDate] = useState<string>('all');
  const [selectedRow, setSelectedRow] = useState<AnyRow | null>(null);

  const hasInitializedRef = useRef(false);

  const subscriptions = useMemo(() => normalizeSubscriptions(data), [data]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return subscriptions.filter((row) => {
      const key = fmtDateKey(row);
      if (selectedDate !== 'all' && key !== selectedDate) return false;

      const ms =
        asUnixMs((row.broadcast as AnyRow | undefined)?.date) ??
        asUnixMs(row.created_at) ??
        asUnixMs(row.watched_true_set_at);
      if (dateFrom && ms) {
        const from = new Date(`${dateFrom}T00:00:00`).getTime();
        if (ms < from) return false;
      }
      if (dateTo && ms) {
        const to = new Date(`${dateTo}T23:59:59`).getTime();
        if (ms > to) return false;
      }
      if (!q) return true;
      const name = `${String(row.firstname ?? '').trim()} ${String(row.surname ?? '').trim()}`.toLowerCase();
      const emailText = String(row.email ?? '').toLowerCase();
      const inviter = getInviterName(row).toLowerCase();
      return name.includes(q) || emailText.includes(q) || inviter.includes(q);
    });
  }, [subscriptions, selectedDate, dateFrom, dateTo, searchQuery]);

  const dateRows = useMemo(() => {
    const map = new Map<string, { date: string; invited: number; watched: number; unsubscribed: number }>();
    for (const row of subscriptions) {
      const key = fmtDateKey(row);
      if (!map.has(key)) map.set(key, { date: key, invited: 0, watched: 0, unsubscribed: 0 });
      const entry = map.get(key)!;
      entry.invited += 1;
      if (row.watched === true) entry.watched += 1;
      if (row.unsubscribed === true) entry.unsubscribed += 1;
    }
    return [...map.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [subscriptions]);

  const daySummary = useMemo(() => {
    const rows = selectedDate === 'all' ? filteredRows : filteredRows;
    const invited = rows.length;
    const watched = rows.filter((r) => r.watched === true).length;
    const fullWatched = rows.filter((r) => watchBucket(Number(r.watch_duration || 0)) === 'full').length;
    const unsubscribed = rows.filter((r) => r.unsubscribed === true).length;
    return { invited, watched, fullWatched, unsubscribed };
  }, [filteredRows, selectedDate]);

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
    const result = await withAuthRetry(async (token) => {
      const r = await fetchWebinarGeekDashboard(token, {
        webinarId: webinarId.trim() || undefined,
        broadcastId: broadcastId.trim() || undefined,
        perPage: 1000,
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
  }, [broadcastId, webinarId, withAuthRetry]);

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
      const r = await syncWebinarGeekCandidates(token, {
        webinarId: webinarId.trim() || undefined,
        broadcastId: broadcastId.trim() || undefined,
        perPage: 1000,
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
  }, [broadcastId, webinarId, withAuthRetry, loadDashboard]);

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
      const dt = ms ? new Date(ms) : null;
      const watched = row.watched === true ? 'Yes' : 'No';
      const watchType =
        row.watched_live === true ? 'Live'
        : row.watched_replay === true ? 'Replay'
        : 'None';
      const status = row.unsubscribed === true ? 'Unsubscribed' : 'Subscribed';
      return [
        name || '—',
        String(row.email || '—'),
        getInviterName(row),
        dt ? dt.toISOString().slice(0, 10) : '—',
        dt ? dt.toLocaleTimeString() : '—',
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
    if (!isAuthenticated || hasInitializedRef.current) return;
    hasInitializedRef.current = true;
    void loadDashboard();
  }, [isAuthenticated, loadDashboard]);

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
            <h1 className="text-xl font-bold text-[#0B1B34]">WebinarGeek Overview (Sheet View)</h1>
            <p className="text-xs text-[#60728c]">Date-first overview + clean spreadsheet table + candidate detail popup.</p>
            {data && (
              <p className="text-[11px] text-[#60728c] mt-1">
                Total fetched records: {String((data?.subscriptions as AnyRow | undefined)?.total_count ?? subscriptions.length)} (after filters on page: {filteredRows.length})
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

        <div className="rounded-xl border border-[#d6deea] bg-white p-4 grid grid-cols-1 md:grid-cols-6 gap-2">
          <input value={webinarId} onChange={(e) => setWebinarId(e.target.value)} placeholder="webinar_id" className="px-3 py-2 rounded-lg border border-[#cfe3f9]" />
          <input value={broadcastId} onChange={(e) => setBroadcastId(e.target.value)} placeholder="broadcast_id" className="px-3 py-2 rounded-lg border border-[#cfe3f9]" />
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="px-3 py-2 rounded-lg border border-[#cfe3f9]" />
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="px-3 py-2 rounded-lg border border-[#cfe3f9]" />
          <label className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#789]" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="search name/email/inviter"
              className="w-full pl-8 pr-3 py-2 rounded-lg border border-[#cfe3f9]"
            />
          </label>
          <Button type="button" onClick={() => void loadDashboard()} disabled={loading}>Apply</Button>
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
          <p className="text-sm font-semibold text-[#0B1B34] mb-2">Available dates</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSelectedDate('all')}
              className={`px-3 py-1.5 rounded-full text-xs border ${selectedDate === 'all' ? 'bg-[#005EB8] text-white border-[#005EB8]' : 'bg-white text-[#4f6787] border-[#cfe3f9]'}`}
            >
              All dates
            </button>
            {dateRows.map((d) => (
              <button
                key={d.date}
                type="button"
                onClick={() => setSelectedDate(d.date)}
                className={`px-3 py-1.5 rounded-full text-xs border ${selectedDate === d.date ? 'bg-[#005EB8] text-white border-[#005EB8]' : 'bg-white text-[#4f6787] border-[#cfe3f9]'}`}
              >
                {d.date} ({d.invited})
              </button>
            ))}
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
              {selectedDate === 'all' ? 'All records (spreadsheet view)' : `Records for ${selectedDate}`}
            </p>
          </div>
          <div className="overflow-auto max-h-[60vh]">
            <table className="min-w-full text-xs">
              <thead className="bg-[#f7fbff] sticky top-0 z-10">
                <tr>
                  <th className="text-left px-3 py-2">Candidate</th>
                  <th className="text-left px-3 py-2">Email</th>
                  <th className="text-left px-3 py-2">Inviter</th>
                  <th className="text-left px-3 py-2">Date / Time</th>
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
                  const dt = ms ? new Date(ms) : null;
                  return (
                    <tr
                      key={String(row.id)}
                      className="border-t border-[#edf2fb] hover:bg-[#f8fbff] cursor-pointer"
                      onClick={() => setSelectedRow(row)}
                    >
                      <td className="px-3 py-2">{name}</td>
                      <td className="px-3 py-2">{String(row.email || '—')}</td>
                      <td className="px-3 py-2">{getInviterName(row)}</td>
                      <td className="px-3 py-2">{dt ? dt.toLocaleString() : '—'}</td>
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
                <Detail label="Created" value={fmtDateTime(selectedRow.created_at)} />
                <Detail label="Watched" value={selectedRow.watched === true ? 'Yes' : 'No'} />
                <Detail label="Watch start" value={fmtDateTime(selectedRow.watch_start)} />
                <Detail label="Watch end" value={fmtDateTime(selectedRow.watch_end)} />
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
