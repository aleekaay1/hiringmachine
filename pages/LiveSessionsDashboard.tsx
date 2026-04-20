import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import IntegrationStatusLights from '../components/IntegrationStatusLights';
import { Button } from '../components/UI';
import { supabase } from '../services/supabaseClient';
import {
  fetchLiveSessionsDashboard,
  type LiveSessionsDashboardPayload,
  type PastMeetingRow,
  type UpcomingMeetingRow,
} from '../services/liveSessionsIntegrations';
import {
  RefreshCw,
  Video,
  Calendar,
  Users,
  ChevronDown,
  ChevronRight,
  ArrowLeft,
  Mail,
} from 'lucide-react';

const LiveSessionsDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [email, setEmail] = useState('admin@globelife-paz.com');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<LiveSessionsDashboardPayload | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [expandedPast, setExpandedPast] = useState<string | null>(null);
  const [expandedUpcoming, setExpandedUpcoming] = useState<string | null>(null);

  useEffect(() => {
    const check = async () => {
      const { data: s } = await supabase.auth.getSession();
      if (s.session) setIsAuthenticated(true);
    };
    check();
  }, []);

  const load = useCallback(async () => {
    setFetchError(null);
    const { data: s } = await supabase.auth.getSession();
    const token = s.session?.access_token;
    if (!token) {
      setFetchError('Not signed in.');
      return;
    }
    setLoading(true);
    const result = await fetchLiveSessionsDashboard(token);
    setLoading(false);
    if (result.ok) {
      setData(result.data);
    } else {
      setData(null);
      setFetchError(result.error);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) void load();
  }, [isAuthenticated, load]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setAuthError('Invalid email or password.');
      return;
    }
    setIsAuthenticated(true);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setIsAuthenticated(false);
    setData(null);
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="bg-slate-900 border border-slate-800 p-8 rounded-2xl shadow-xl w-full max-w-sm">
          <h2 className="text-xl font-bold text-white mb-1 text-center">Sessions</h2>
          <p className="text-sm text-slate-400 text-center mb-6">Sign in with your admin account</p>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm text-slate-300 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white focus:ring-2 focus:ring-[#005EB8]"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white focus:ring-2 focus:ring-[#005EB8]"
              />
            </div>
            <Button fullWidth type="submit">
              Sign in
            </Button>
            {authError && <p className="text-sm text-red-400 text-center">{authError}</p>}
          </form>
        </div>
      </div>
    );
  }

  return (
    <Layout hideHeader>
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
        <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-20">
          <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => navigate('/admin')}
                className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white shrink-0"
              >
                <ArrowLeft size={18} /> Admin
              </button>
              <div className="h-6 w-px bg-slate-700 hidden sm:block" />
              <div className="flex items-center gap-2 min-w-0">
                <Video className="text-[#37B06D] shrink-0" size={22} />
                <div className="min-w-0">
                  <h1 className="text-lg sm:text-xl font-bold text-white truncate">Online career sessions</h1>
                  <p className="text-xs text-slate-500 truncate">Zoom & Calendly</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <IntegrationStatusLights dark />
              <Button
                type="button"
                variant="outline"
                className="text-sm border-slate-600 text-slate-200 hover:bg-slate-800"
                onClick={() => void load()}
                disabled={loading}
              >
                <RefreshCw size={16} className={`mr-2 inline ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              <Button
                type="button"
                variant="outline"
                className="text-sm border-slate-600 text-slate-200 hover:bg-slate-800"
                onClick={() => void handleLogout()}
              >
                Sign out
              </Button>
            </div>
          </div>
        </header>

        <div className="flex-grow max-w-[1600px] w-full mx-auto px-4 sm:px-6 py-6 space-y-8">
          {fetchError && (
            <div className="rounded-xl border border-amber-700/50 bg-amber-950/40 px-4 py-3 text-sm text-amber-100">
              <p className="font-semibold">Could not load integrations</p>
              <p className="text-amber-200/90 mt-1">{fetchError}</p>
            </div>
          )}

          {data && (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Zoom host</p>
                  <p className="text-sm font-semibold text-white mt-1 truncate">{data.zoom_user.email}</p>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Calendly</p>
                  <p className="text-sm font-semibold text-white mt-1 truncate">
                    {data.calendly_configured
                      ? data.calendly_user?.email || '—'
                      : 'Not connected (Zoom-only)'}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Past</p>
                  <p className="text-2xl font-extrabold text-[#37B06D]">{data.past_meetings.length}</p>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Upcoming</p>
                  <p className="text-2xl font-extrabold text-[#005EB8]">{data.upcoming_meetings.length}</p>
                </div>
              </div>
              <p className="text-xs text-slate-500">
                Updated {new Date(data.generated_at).toLocaleString()}
              </p>
            </>
          )}

          <section>
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500 mb-3 flex items-center gap-2">
              <Calendar size={16} /> Past meetings
            </h2>
            <div className="space-y-3">
              {!data && !fetchError && loading && (
                <p className="text-slate-500 text-sm">Loading…</p>
              )}
              {data?.past_meetings.length === 0 && !loading && (
                <p className="text-slate-500 text-sm border border-dashed border-slate-800 rounded-xl p-8 text-center">
                  {data.zoom_topic_filter ? 'No past meetings match the filter.' : 'No past meetings.'}
                </p>
              )}
              {data?.past_meetings.map((row) => (
                <PastMeetingCard
                  key={row.zoom.uuid + row.zoom.start_time}
                  row={row}
                  calendlyConfigured={data.calendly_configured}
                  expanded={expandedPast === row.zoom.uuid}
                  onToggle={() =>
                    setExpandedPast((e) => (e === row.zoom.uuid ? null : row.zoom.uuid))
                  }
                />
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500 mb-3 flex items-center gap-2">
              <Video size={16} /> Upcoming schedule
            </h2>
            <div className="space-y-3">
              {!data && !fetchError && loading && (
                <p className="text-slate-500 text-sm">Loading schedule…</p>
              )}
              {data?.upcoming_meetings.length === 0 && !loading && (
                <p className="text-slate-500 text-sm border border-dashed border-slate-800 rounded-xl p-8 text-center">
                  {data?.zoom_topic_filter
                    ? 'No upcoming meetings matched the topic filter.'
                    : 'No upcoming meetings'}
                </p>
              )}
              {data?.upcoming_meetings.map((row) => {
                const key = `${row.zoom.uuid}|${row.zoom.start_time}`;
                return (
                  <UpcomingMeetingCard
                    key={key}
                    row={row}
                    calendlyConfigured={data.calendly_configured}
                    expanded={expandedUpcoming === key}
                    onToggle={() =>
                      setExpandedUpcoming((e) => (e === key ? null : key))
                    }
                  />
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </Layout>
  );
};

function PastMeetingCard({
  row,
  calendlyConfigured,
  expanded,
  onToggle,
}: {
  row: PastMeetingRow;
  calendlyConfigured: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const z = row.zoom;
  const st = z.start_time ? new Date(z.start_time).toLocaleString() : '—';
  const key = z.uuid + z.start_time;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left px-4 py-4 flex flex-wrap items-start justify-between gap-3 hover:bg-slate-800/30"
      >
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <span className="text-slate-500 mt-0.5">
            {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          </span>
          <div className="min-w-0">
            <p className="font-semibold text-white text-base leading-snug">{z.topic}</p>
            <p className="text-xs text-slate-500 mt-1">{st} · {z.duration_minutes} min · Host: {z.host_email}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-300">
            <Mail size={12} /> Invited {row.stats.invited_count}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-950/60 border border-emerald-800/50 px-2.5 py-1 text-xs text-emerald-300">
            <Users size={12} /> Joined (match) {row.stats.attended_matched_count}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-950/40 border border-amber-800/40 px-2.5 py-1 text-xs text-amber-200">
            Absent / no Zoom {row.stats.no_show_or_absent_count}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-400">
            Zoom participants {row.stats.zoom_participant_count}
          </span>
        </div>
      </button>
      {expanded && (
        <div className="border-t border-slate-800 px-4 py-4 grid md:grid-cols-2 gap-6 text-sm">
          <div>
            <h4 className="text-xs font-bold uppercase text-slate-500 mb-2">Invitees (Calendly)</h4>
            <ul className="space-y-1.5 max-h-56 overflow-y-auto">
              {calendlyConfigured === false && <li className="text-slate-500">Calendly not connected.</li>}
              {calendlyConfigured !== false && row.invitees.length === 0 && (
                <li className="text-slate-500">None</li>
              )}
              {row.invitees.map((i) => (
                <li
                  key={key + i.email}
                  className={`flex justify-between gap-2 ${i.attended_zoom ? 'text-emerald-300' : 'text-slate-400'}`}
                >
                  <span className="truncate">{i.name || i.email}</span>
                  <span className="shrink-0 text-xs">
                    {i.attended_zoom ? 'Joined Zoom' : 'Not in Zoom'}
                    {i.no_show ? ' · calendly no-show' : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="text-xs font-bold uppercase text-slate-500 mb-2">Zoom participants</h4>
            <ul className="space-y-1.5 max-h-56 overflow-y-auto">
              {row.participants.length === 0 && <li className="text-slate-500">No participant report</li>}
              {row.participants.map((p, idx) => (
                <li key={key + (p.email || '') + idx} className="text-slate-300">
                  <span className="text-white">{p.name || '—'}</span>
                  {p.email && <span className="text-slate-500 ml-2">{p.email}</span>}
                </li>
              ))}
            </ul>
            {calendlyConfigured && row.stats.zoom_only_emails.length > 0 && (
              <p className="text-xs text-slate-500 mt-2">
                On Zoom but not on Calendly invite list: {row.stats.zoom_only_emails.join(', ')}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function UpcomingMeetingCard({
  row,
  calendlyConfigured,
  expanded,
  onToggle,
}: {
  row: UpcomingMeetingRow;
  calendlyConfigured: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const z = row.zoom;
  const st = z.start_time ? new Date(z.start_time).toLocaleString() : '—';
  const listKey = z.uuid + z.start_time;
  const invited = row.invitees.length;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left px-4 py-4 flex flex-wrap items-start justify-between gap-3 hover:bg-slate-800/30"
      >
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <span className="text-slate-500 mt-0.5 shrink-0">
            {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          </span>
          <div className="min-w-0">
            <p className="font-semibold text-white text-base leading-snug">{z.topic}</p>
            <p className="text-xs text-slate-500 mt-1">
              {st} · {z.duration_minutes} min · {z.host_email}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0 justify-end">
          {calendlyConfigured && row.calendly && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-950/50 border border-emerald-800/40 px-2.5 py-1 text-xs text-emerald-300">
              <Mail size={12} /> {invited} invited
            </span>
          )}
          {calendlyConfigured && row.calendly && (
            <span className="inline-flex max-w-[14rem] truncate rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-300" title={row.calendly.name}>
              {row.calendly.name || 'Calendly'}
            </span>
          )}
          {calendlyConfigured && !row.calendly && (
            <span className="inline-flex items-center rounded-full bg-slate-800/80 px-2.5 py-1 text-xs text-slate-500">
              No Calendly match
            </span>
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-800 px-4 py-4 text-sm">
          <h4 className="text-xs font-bold uppercase text-slate-500 mb-3">Invited via Calendly</h4>
          {calendlyConfigured === false && <p className="text-slate-500 text-sm">Calendly not connected.</p>}
          {calendlyConfigured && !row.calendly && (
            <p className="text-slate-500 text-sm">No Calendly match for this time.</p>
          )}
          {calendlyConfigured && row.calendly && row.invitees.length === 0 && (
            <p className="text-slate-500 text-sm">No invitees listed yet for this event.</p>
          )}
          {calendlyConfigured && row.calendly && row.invitees.length > 0 && (
            <ul className="space-y-2">
              {row.invitees.map((i) => (
                <li key={listKey + i.email} className="text-slate-200">
                  <span className="font-medium text-white">{i.name?.trim() || i.email}</span>
                  {i.name?.trim() ? (
                    <span className="block text-xs text-slate-500">{i.email}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default LiveSessionsDashboard;
