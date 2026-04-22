import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import { Button } from '../components/UI';
import { supabase } from '../services/supabaseClient';
import {
  fetchWebinarGeekDashboard,
  fetchWebinarGeekHealth,
} from '../services/webinarGeekIntegrations';
import { Database, RefreshCw, ShieldCheck } from 'lucide-react';

type AnyRow = Record<string, unknown>;

function asArray(value: unknown): AnyRow[] {
  if (Array.isArray(value)) return value as AnyRow[];
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const firstArrayKey = ['webinars', 'broadcasts', 'subscriptions', 'questions', 'messages']
      .find((k) => Array.isArray(obj[k]));
    if (firstArrayKey) return obj[firstArrayKey] as AnyRow[];
  }
  return [];
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
  const [data, setData] = useState<Record<string, unknown> | null>(null);

  const [webinarId, setWebinarId] = useState('');
  const [broadcastId, setBroadcastId] = useState('');
  const [watchedFilter, setWatchedFilter] = useState<'all' | 'watched' | 'unwatched'>('all');

  const webinars = useMemo(() => asArray(data?.webinars), [data]);
  const broadcasts = useMemo(() => asArray(data?.broadcasts), [data]);
  const subscriptions = useMemo(() => asArray(data?.subscriptions), [data]);
  const questions = useMemo(() => asArray(data?.questions), [data]);
  const messages = useMemo(() => asArray(data?.messages), [data]);

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

  const loadDashboard = useCallback(async () => {
    setError(null);
    const token = await getFreshAccessToken();
    if (!token) {
      setError('Not signed in. Please sign in again.');
      setIsAuthenticated(false);
      return;
    }
    setLoading(true);
    const result = await fetchWebinarGeekDashboard(token, {
      webinarId: webinarId.trim() || undefined,
      broadcastId: broadcastId.trim() || undefined,
      watchedWebinar:
        watchedFilter === 'all' ? undefined : watchedFilter === 'watched',
      perPage: 100,
    });
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      setData(null);
      if (result.error.toLowerCase().includes('unauthorized')) {
        setIsAuthenticated(false);
        await supabase.auth.signOut();
      }
      return;
    }
    setData(result.data);
  }, [broadcastId, getFreshAccessToken, webinarId, watchedFilter]);

  const loadHealth = useCallback(async () => {
    setError(null);
    const token = await getFreshAccessToken();
    if (!token) {
      setError('Not signed in. Please sign in again.');
      setIsAuthenticated(false);
      return;
    }
    setHealthLoading(true);
    const result = await fetchWebinarGeekHealth(token);
    setHealthLoading(false);
    if (!result.ok) {
      setError(result.error);
      setHealth(null);
      if (result.error.toLowerCase().includes('unauthorized')) {
        setIsAuthenticated(false);
        await supabase.auth.signOut();
      }
      return;
    }
    setHealth(result.data);
  }, [getFreshAccessToken]);

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
                <h1 className="text-lg sm:text-xl font-extrabold text-[#0B1B34] truncate">WebinarGeek</h1>
                <p className="text-xs text-[#73839b] truncate">Webinars, broadcasts, invitees, attendance, questions, messages</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button type="button" variant="outline" onClick={() => void loadHealth()} disabled={healthLoading}>
                <ShieldCheck size={16} className={`mr-2 inline ${healthLoading ? 'animate-pulse' : ''}`} /> Health
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
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <input value={webinarId} onChange={(e) => setWebinarId(e.target.value)} placeholder="Filter webinar_id" className="px-3 py-2 rounded-xl border border-[#cfe3f9]" />
            <input value={broadcastId} onChange={(e) => setBroadcastId(e.target.value)} placeholder="Filter broadcast_id" className="px-3 py-2 rounded-xl border border-[#cfe3f9]" />
            <select value={watchedFilter} onChange={(e) => setWatchedFilter(e.target.value as 'all' | 'watched' | 'unwatched')} className="px-3 py-2 rounded-xl border border-[#cfe3f9]">
              <option value="all">All subscriptions</option>
              <option value="watched">Watched only</option>
              <option value="unwatched">Unwatched only</option>
            </select>
            <Button type="button" onClick={() => void loadDashboard()} disabled={loading}>Apply filters</Button>
          </div>
        </div>

        {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Stat label="Webinars" value={String(webinars.length)} />
          <Stat label="Broadcasts" value={String(broadcasts.length)} />
          <Stat label="Subscriptions" value={String(subscriptions.length)} />
          <Stat label="Questions" value={String(questions.length)} />
          <Stat label="Messages" value={String(messages.length)} />
        </div>

        <DataTable title="Webinars" rows={webinars} columns={['id', 'title', 'url', 'status', 'type', 'subscriptions_count', 'created_at']} />
        <DataTable title="Broadcasts" rows={broadcasts} columns={['id', 'date', 'has_ended', 'cancelled', 'duration', 'viewers_count', 'replay_viewers_count', 'webinar']} />
        <DataTable title="Subscriptions / Invitees / Attendance" rows={subscriptions} columns={['id', 'firstname', 'surname', 'email', 'watched', 'watched_live', 'watched_replay', 'watched_true_set_at', 'watch_start', 'watch_end', 'watch_duration', 'watch_duration_live', 'watch_duration_replay', 'registration_source', 'registration_ip', 'unsubscribed', 'broadcast', 'episode', 'webinar', 'created_at']} />
        <DataTable title="Questions" rows={questions} columns={['id', 'type', 'question', 'subscription_id', 'created_at']} />
        <DataTable title="Messages" rows={messages} columns={['id', 'type', 'subject', 'status', 'created_at']} />
      </div>
    </Layout>
  );
};

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-[20px] border border-[#d6e6f9] bg-white p-3 shadow-sm">
    <p className="text-xs uppercase tracking-wide text-[#7a8ba1]">{label}</p>
    <p className="text-sm font-semibold mt-1 truncate text-[#0B1B34]">{value}</p>
  </div>
);

const DataTable = ({ title, rows, columns }: { title: string; rows: AnyRow[]; columns: string[] }) => (
  <section className="rounded-2xl border border-[#d6deea] bg-white shadow-sm overflow-hidden">
    <div className="px-4 py-3 border-b border-[#e6edf7]">
      <h3 className="font-bold text-[#0B1B34]">{title}</h3>
    </div>
    <div className="overflow-auto">
      <table className="min-w-full text-xs">
        <thead className="bg-[#f6f9ff]">
          <tr>
            {columns.map((c) => (
              <th key={c} className="text-left font-semibold text-[#5f748f] px-3 py-2 whitespace-nowrap">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-3 py-6 text-center text-[#7b8aa0]">No data</td>
            </tr>
          )}
          {rows.map((row, idx) => (
            <tr key={`${title}-${idx}`} className="border-t border-[#edf2fb]">
              {columns.map((c) => (
                <td key={`${idx}-${c}`} className="px-3 py-2 align-top whitespace-pre-wrap">
                  {formatCell(row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </section>
);

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export default WebinarGeekDashboard;
