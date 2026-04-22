import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import { Button } from '../components/UI';
import { supabase } from '../services/supabaseClient';
import {
  fetchWebinarGeekDashboard,
  fetchWebinarGeekHealth,
  syncWebinarGeekCandidates,
} from '../services/webinarGeekIntegrations';
import {
  CalendarClock,
  CheckCircle2,
  Clock3,
  Database,
  Eye,
  Mail,
  RefreshCw,
  Search,
  ShieldCheck,
  UserX,
  Video,
} from 'lucide-react';

type AnyRow = Record<string, unknown>;
type DashboardData = Record<string, unknown>;

function unixToLabel(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const ms = n > 1e12 ? n : n * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

function durationLabel(value: unknown): string {
  const sec = Number(value);
  if (!Number.isFinite(sec) || sec <= 0) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function normalizeSubscriptions(data: DashboardData | null): AnyRow[] {
  const payload = data?.subscriptions as Record<string, unknown> | undefined;
  if (!payload) return [];
  const rows = payload.subscriptions;
  return Array.isArray(rows) ? (rows as AnyRow[]) : [];
}

function normalizeWebinars(data: DashboardData | null): AnyRow[] {
  const payload = data?.webinars as Record<string, unknown> | undefined;
  if (!payload) return [];
  const rows = payload.webinars;
  return Array.isArray(rows) ? (rows as AnyRow[]) : [];
}

function normalizeBroadcasts(data: DashboardData | null): AnyRow[] {
  const payload = data?.broadcasts as Record<string, unknown> | undefined;
  if (!payload) return [];
  const rows = payload.broadcasts;
  return Array.isArray(rows) ? (rows as AnyRow[]) : [];
}

const WebinarGeekDashboard: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [email, setEmail] = useState('admin@globelife-paz.com');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [healthLoading, setHealthLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);

  const [webinarId, setWebinarId] = useState('');
  const [broadcastId, setBroadcastId] = useState('');
  const [watchedFilter, setWatchedFilter] = useState<'all' | 'watched' | 'unwatched'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncResult, setSyncResult] = useState<Record<string, unknown> | null>(null);

  const webinars = useMemo(() => normalizeWebinars(data), [data]);
  const broadcasts = useMemo(() => normalizeBroadcasts(data), [data]);
  const subscriptions = useMemo(() => normalizeSubscriptions(data), [data]);
  const filteredSubscriptions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return subscriptions;
    return subscriptions.filter((row) => {
      const name = `${String(row.firstname || '').trim()} ${String(row.surname || '').trim()}`.toLowerCase();
      const emailText = String(row.email || '').toLowerCase();
      const ipText = String(row.registration_ip || '').toLowerCase();
      return name.includes(q) || emailText.includes(q) || ipText.includes(q);
    });
  }, [subscriptions, searchQuery]);

  const metrics = useMemo(() => {
    const invited = filteredSubscriptions.length;
    const watched = filteredSubscriptions.filter((s) => s.watched === true).length;
    const watchedLive = filteredSubscriptions.filter((s) => s.watched_live === true).length;
    const watchedReplay = filteredSubscriptions.filter((s) => s.watched_replay === true).length;
    const unsubscribed = filteredSubscriptions.filter((s) => s.unsubscribed === true).length;
    return { invited, watched, watchedLive, watchedReplay, unsubscribed };
  }, [filteredSubscriptions]);

  const grouped = useMemo(() => {
    const map = new Map<string, { broadcast: AnyRow | null; webinar: AnyRow | null; rows: AnyRow[] }>();
    for (const row of filteredSubscriptions) {
      const b = (row.broadcast && typeof row.broadcast === 'object') ? (row.broadcast as AnyRow) : null;
      const w = (row.webinar && typeof row.webinar === 'object') ? (row.webinar as AnyRow) : null;
      const key = b?.id ? `b-${String(b.id)}` : `no-b-${String(row.id ?? Math.random())}`;
      if (!map.has(key)) map.set(key, { broadcast: b, webinar: w, rows: [] });
      map.get(key)!.rows.push(row);
    }
    return [...map.values()].sort((a, b) => Number(b.broadcast?.date ?? 0) - Number(a.broadcast?.date ?? 0));
  }, [filteredSubscriptions]);

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
        watchedWebinar: watchedFilter === 'all' ? undefined : watchedFilter === 'watched',
        perPage: 100,
      });
      if (!r.ok && r.error.toLowerCase().includes('unauthorized')) return null;
      return r;
    });
    setLoading(false);
    if (!result) {
      setError('Session unauthorized for WebinarGeek API. Please sign out and sign in again.');
      setData(null);
      return;
    }
    if (!result.ok) {
      setError(result.error);
      setData(null);
      return;
    }
    setData(result.data);
  }, [broadcastId, webinarId, watchedFilter, withAuthRetry]);

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
      setError('Session unauthorized for WebinarGeek health check. Please sign out and sign in again.');
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

  useEffect(() => {
    const check = async () => {
      const { data: s } = await supabase.auth.getSession();
      if (s.session) setIsAuthenticated(true);
    };
    void check();
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      void loadHealth();
      void loadDashboard();
    }
  }, [isAuthenticated, loadDashboard, loadHealth]);

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

  const runSync = useCallback(async () => {
    setError(null);
    setSyncLoading(true);
    const result = await withAuthRetry(async (token) => {
      const r = await syncWebinarGeekCandidates(token, {
        webinarId: webinarId.trim() || undefined,
        broadcastId: broadcastId.trim() || undefined,
        perPage: 250,
      });
      if (!r.ok && r.error.toLowerCase().includes('unauthorized')) return null;
      return r;
    });
    setSyncLoading(false);
    if (!result) {
      setError('Session unauthorized for WebinarGeek sync. Please sign out and sign in again.');
      return;
    }
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSyncResult(result.data);
    await loadDashboard();
  }, [broadcastId, loadDashboard, webinarId, withAuthRetry]);

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#f7fbff] to-[#eef6ff] flex items-center justify-center p-4">
        <div className="bg-white border border-[#d9e9fb] p-8 rounded-[28px] shadow-[0_18px_50px_-24px_rgba(0,94,184,0.35)] w-full max-w-sm">
          <h2 className="text-xl font-bold text-[#0B1B34] mb-1 text-center">WebinarGeek dashboard</h2>
          <p className="text-sm text-[#6f7b8d] text-center mb-6">Sign in with your admin account</p>
          <form onSubmit={handleLogin} className="space-y-4">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-4 py-2.5 rounded-2xl border border-[#cfe3f9] text-[#0B1B34]" />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-4 py-2.5 rounded-2xl border border-[#cfe3f9] text-[#0B1B34]" />
            <Button fullWidth type="submit">Sign in</Button>
            {authError && <p className="text-sm text-red-600 text-center">{authError}</p>}
          </form>
        </div>
      </div>
    );
  }

  return (
    <Layout isAdmin>
      <div className="w-full p-5 lg:p-6 space-y-5 text-[#1A2942]">
        <div className="rounded-2xl border border-[#d6deea] bg-white shadow-sm px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Database className="text-[#005EB8] shrink-0" size={22} />
              <div className="min-w-0">
                <h1 className="text-lg sm:text-xl font-extrabold text-[#0B1B34] truncate">WebinarGeek Attendance Hub</h1>
                <p className="text-xs text-[#73839b] truncate">Invitees and attendance insights, fully formatted</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button type="button" variant="outline" onClick={() => void loadHealth()} disabled={healthLoading}>
                <ShieldCheck size={16} className={`mr-2 inline ${healthLoading ? 'animate-pulse' : ''}`} /> Health
              </Button>
              <Button type="button" onClick={() => void runSync()} disabled={syncLoading}>
                <Database size={16} className={`mr-2 inline ${syncLoading ? 'animate-pulse' : ''}`} />
                {syncLoading ? 'Syncing...' : 'Sync to candidates'}
              </Button>
              <Button type="button" variant="outline" onClick={() => void loadDashboard()} disabled={loading}>
                <RefreshCw size={16} className={`mr-2 inline ${loading ? 'animate-spin' : ''}`} /> Refresh
              </Button>
            </div>
          </div>
          {health && (
            <p className="text-xs mt-3 text-[#6f7f96]">
              Connection: <span className={health.connected ? 'text-green-700 font-semibold' : 'text-red-700 font-semibold'}>{health.connected ? 'Connected' : 'Not connected'}</span>
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-[#d6deea] bg-white shadow-sm p-4">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <input value={webinarId} onChange={(e) => setWebinarId(e.target.value)} placeholder="Filter webinar_id" className="px-3 py-2 rounded-xl border border-[#cfe3f9]" />
            <input value={broadcastId} onChange={(e) => setBroadcastId(e.target.value)} placeholder="Filter broadcast_id" className="px-3 py-2 rounded-xl border border-[#cfe3f9]" />
            <select value={watchedFilter} onChange={(e) => setWatchedFilter(e.target.value as 'all' | 'watched' | 'unwatched')} className="px-3 py-2 rounded-xl border border-[#cfe3f9]">
              <option value="all">All invitees</option>
              <option value="watched">Watched only</option>
              <option value="unwatched">Did not watch</option>
            </select>
            <label className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#7488a6]" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search candidates/invitees/email/IP"
                className="w-full pl-9 pr-3 py-2 rounded-xl border border-[#cfe3f9]"
              />
            </label>
            <Button type="button" onClick={() => void loadDashboard()} disabled={loading}>Apply filters</Button>
          </div>
        </div>

        {syncResult && (
          <div className="rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 grid grid-cols-1 md:grid-cols-3 gap-2">
            <p><span className="font-semibold">Synced:</span> {String(syncResult.total_subscriptions ?? 0)} subscriptions</p>
            <p><span className="font-semibold">Matched:</span> {String(syncResult.matched_subscriptions ?? 0)} ({String(syncResult.matched_candidates ?? 0)} candidates)</p>
            <p><span className="font-semibold">Unmatched:</span> {String(syncResult.unmatched_subscriptions ?? 0)}</p>
          </div>
        )}

        {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Metric icon={<Mail size={15} />} label="Invitees" value={metrics.invited} />
          <Metric icon={<Eye size={15} />} label="Watched" value={metrics.watched} />
          <Metric icon={<Video size={15} />} label="Live watched" value={metrics.watchedLive} />
          <Metric icon={<Clock3 size={15} />} label="Replay watched" value={metrics.watchedReplay} />
          <Metric icon={<UserX size={15} />} label="Unsubscribed" value={metrics.unsubscribed} />
        </div>

        {grouped.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#d3e2f5] bg-white p-10 text-center text-[#7a8ca3]">
            No invitee / attendance records found for current filters.
          </div>
        ) : (
          <div className="space-y-4">
            {grouped.map((group, idx) => (
              <section key={`g-${idx}`} className="rounded-2xl border border-[#d6deea] bg-white shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-[#e7eef8] bg-[#f8fbff] flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[#0B1B34] truncate">
                      {String(group.webinar?.title || group.broadcast?.id || 'Session')}
                    </p>
                    <p className="text-xs text-[#6f7f96] flex flex-wrap items-center gap-3">
                      <span className="inline-flex items-center gap-1"><CalendarClock size={12} /> {unixToLabel(group.broadcast?.date)}</span>
                      <span>Broadcast #{String(group.broadcast?.id || '—')}</span>
                      <span>{group.rows.length} invitees</span>
                    </p>
                  </div>
                  <div className="text-xs text-[#60728c]">
                    Live viewers: <span className="font-semibold">{String(group.broadcast?.live_viewers_count ?? '—')}</span> · Replay viewers: <span className="font-semibold">{String(group.broadcast?.replay_viewers_count ?? '—')}</span>
                  </div>
                </div>
                <div className="divide-y divide-[#edf2fb]">
                  {group.rows.map((row) => {
                    const name = `${String(row.firstname || '').trim()} ${String(row.surname || '').trim()}`.trim() || 'Unnamed invitee';
                    const watched = row.watched === true;
                    const watchedLive = row.watched_live === true;
                    const watchedReplay = row.watched_replay === true;
                    return (
                      <article key={String(row.id)} className="p-4 grid grid-cols-1 xl:grid-cols-3 gap-4">
                        <div>
                          <p className="font-semibold text-[#0B1B34]">{name}</p>
                          <p className="text-sm text-[#546b89]">{String(row.email || '—')}</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Badge tone={watched ? 'green' : 'gray'} icon={watched ? <CheckCircle2 size={12} /> : <UserX size={12} />}>
                              {watched ? 'Watched' : 'No watch'}
                            </Badge>
                            {watchedLive && <Badge tone="blue" icon={<Video size={12} />}>Live</Badge>}
                            {watchedReplay && <Badge tone="amber" icon={<Clock3 size={12} />}>Replay</Badge>}
                            {row.unsubscribed === true && <Badge tone="red" icon={<UserX size={12} />}>Unsubscribed</Badge>}
                          </div>
                        </div>

                        <div className="text-xs text-[#5f748f] space-y-1">
                          <p><span className="font-semibold text-[#334a69]">First watched:</span> {unixToLabel(row.watched_true_set_at)}</p>
                          <p><span className="font-semibold text-[#334a69]">Watch start:</span> {unixToLabel(row.watch_start)}</p>
                          <p><span className="font-semibold text-[#334a69]">Watch end:</span> {unixToLabel(row.watch_end)}</p>
                          <p><span className="font-semibold text-[#334a69]">Total watch:</span> {durationLabel(row.watch_duration)}</p>
                          <p><span className="font-semibold text-[#334a69]">Live watch:</span> {durationLabel(row.watch_duration_live)}</p>
                          <p><span className="font-semibold text-[#334a69]">Replay watch:</span> {durationLabel(row.watch_duration_replay)}</p>
                        </div>

                        <div className="text-xs text-[#5f748f] space-y-1">
                          <p><span className="font-semibold text-[#334a69]">Source:</span> {String(row.registration_source || '—')}</p>
                          <p><span className="font-semibold text-[#334a69]">IP:</span> {String(row.registration_ip || '—')}</p>
                          <p><span className="font-semibold text-[#334a69]">Created:</span> {unixToLabel(row.created_at)}</p>
                          <p><span className="font-semibold text-[#334a69]">Watch link:</span> {row.watch_link ? <a className="text-[#005EB8] underline" href={String(row.watch_link)} target="_blank" rel="noopener noreferrer">Open</a> : '—'}</p>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}

        <section className="rounded-2xl border border-[#d6deea] bg-white shadow-sm p-4">
          <h3 className="font-bold text-[#0B1B34] mb-3">Webinars in account</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {webinars.slice(0, 12).map((w) => (
              <div key={String(w.id)} className="rounded-xl border border-[#e7eef8] p-3">
                <p className="font-semibold text-sm text-[#0B1B34]">{String(w.title || `Webinar #${String(w.id)}`)}</p>
                <p className="text-xs text-[#60728c] mt-1">ID: {String(w.id || '—')} · Subs: {String(w.subscriptions_count ?? '—')}</p>
              </div>
            ))}
            {webinars.length === 0 && <p className="text-sm text-[#7a8ca3]">No webinars returned.</p>}
          </div>
        </section>
      </div>
    </Layout>
  );
};

const Metric = ({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) => (
  <div className="rounded-[20px] border border-[#d6e6f9] bg-white p-3 shadow-sm">
    <p className="text-xs uppercase tracking-wide text-[#7a8ba1] inline-flex items-center gap-1">{icon}{label}</p>
    <p className="text-sm font-semibold mt-1 truncate text-[#0B1B34]">{String(value)}</p>
  </div>
);

const Badge = ({ children, tone, icon }: { children: React.ReactNode; tone: 'green' | 'blue' | 'amber' | 'red' | 'gray'; icon?: React.ReactNode }) => {
  const cls =
    tone === 'green' ? 'bg-green-50 text-green-700 border-green-200'
      : tone === 'blue' ? 'bg-blue-50 text-blue-700 border-blue-200'
        : tone === 'amber' ? 'bg-amber-50 text-amber-700 border-amber-200'
          : tone === 'red' ? 'bg-red-50 text-red-700 border-red-200'
            : 'bg-gray-50 text-gray-700 border-gray-200';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded-full border ${cls}`}>
      {icon}
      {children}
    </span>
  );
};

export default WebinarGeekDashboard;
