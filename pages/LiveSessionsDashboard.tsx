import React, { useState, useEffect, useCallback, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import IntegrationStatusLights from '../components/IntegrationStatusLights';
import { Button } from '../components/UI';
import { supabase } from '../services/supabaseClient';
import {
  fetchLiveSessionsDashboard,
  zoomMeetingStartMs,
  type LiveSessionsDashboardPayload,
  type PastMeetingRow,
  type UpcomingMeetingRow,
} from '../services/liveSessionsIntegrations';
import {
  collectLiveSessionInviteAndAttendEmails,
  syncLiveSessionPipeline,
} from '../services/liveSessionPipelineSync';
import { formatDateTimeCanadaEastern } from '../services/dateDisplay';
import { RefreshCw, Video, Calendar, Users, ChevronDown, ChevronRight, ArrowLeft, Mail } from 'lucide-react';

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
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncSummary, setSyncSummary] = useState<string | null>(null);

  const getFreshAccessToken = useCallback(async (): Promise<string | null> => {
    const { data: s } = await supabase.auth.getSession();
    const token = s.session?.access_token;
    if (token) return token;
    const { data: refreshed, error } = await supabase.auth.refreshSession();
    if (error) return null;
    return refreshed.session?.access_token ?? null;
  }, []);

  useEffect(() => {
    const check = async () => {
      const { data: s } = await supabase.auth.getSession();
      if (s.session) setIsAuthenticated(true);
    };
    check();
  }, []);

  const load = useCallback(async () => {
    setFetchError(null);
    setSyncSummary(null);
    setSyncError(null);
    const token = await getFreshAccessToken();
    if (!token) {
      setFetchError('Not signed in.');
      return;
    }
    setLoading(true);
    const result = await fetchLiveSessionsDashboard(token);
    setLoading(false);
    if (result.ok === false) {
      setData(null);
      setFetchError(result.error);
      return;
    }
    setData(result.data);
  }, [getFreshAccessToken]);

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

  const handleSyncPipeline = async () => {
    if (!data) return;
    setSyncError(null);
    setSyncSummary(null);
    const token = await getFreshAccessToken();
    if (!token) {
      setSyncError('Not signed in.');
      return;
    }
    setSyncLoading(true);
    const sets = collectLiveSessionInviteAndAttendEmails(data);
    const result = await syncLiveSessionPipeline(token, sets);
    setSyncLoading(false);
    if (result.ok === false) {
      setSyncError(result.error);
      return;
    }
    const r = result.data;
    setSyncSummary([
      r.tagged_invite > 0 ? `${r.tagged_invite} tagged invited` : null,
      r.attended_rows_updated > 0 ? `${r.attended_rows_updated} marked attended` : null,
      r.assessment_emails_sent > 0 ? `${r.assessment_emails_sent} leadership emails sent` : null,
    ].filter(Boolean).join(' · ') || 'No new pipeline changes.');
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#f7fbff] to-[#eef6ff] flex items-center justify-center p-4">
        <div className="bg-white border border-[#d9e9fb] p-8 rounded-[28px] shadow-[0_18px_50px_-24px_rgba(0,94,184,0.35)] w-full max-w-sm">
          <h2 className="text-xl font-bold text-[#0B1B34] mb-1 text-center">Online career sessions</h2>
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
    <Layout hideHeader>
      <div className="min-h-screen bg-gradient-to-b from-[#f8fbff] via-white to-[#f1f7ff] text-[#1A2942] flex flex-col">
        <header className="border-b border-[#d5e6fa] bg-white/85 backdrop-blur sticky top-0 z-20">
          <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <button type="button" onClick={() => navigate('/admin')} className="inline-flex items-center gap-1.5 text-sm text-[#6d7f95] hover:text-[#005EB8] shrink-0"><ArrowLeft size={18} /> Admin</button>
              <div className="h-6 w-px bg-[#d9e7f9] hidden sm:block" />
              <div className="flex items-center gap-2 min-w-0">
                <Video className="text-[#37B06D] shrink-0" size={22} />
                <div className="min-w-0">
                  <h1 className="text-lg sm:text-xl font-extrabold text-[#0B1B34] truncate">Online career sessions</h1>
                  <p className="text-xs text-[#73839b] truncate">Zoom + Calendly · Eastern Time (Canada)</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <IntegrationStatusLights />
              <Button type="button" variant="outline" className="text-sm border-[#c8def7] text-[#1c3b66] hover:bg-[#eef5ff]" onClick={() => void load()} disabled={loading}><RefreshCw size={16} className={`mr-2 inline ${loading ? 'animate-spin' : ''}`} /> Refresh</Button>
              <Button type="button" variant="outline" className="text-sm border-[#bde8d2] text-[#1b6f46] hover:bg-[#ecfaf2]" onClick={() => void handleSyncPipeline()} disabled={loading || syncLoading || !data}><Users size={16} className={`mr-2 inline ${syncLoading ? 'animate-pulse' : ''}`} /> Sync pipeline</Button>
              <Button type="button" variant="outline" className="text-sm border-[#c8def7] text-[#1c3b66] hover:bg-[#eef5ff]" onClick={() => void handleLogout()}>Sign out</Button>
            </div>
          </div>
        </header>

        <div className="flex-grow max-w-[1600px] w-full mx-auto px-4 sm:px-6 py-6 space-y-8">
          {fetchError && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{fetchError}</div>}
          {syncError && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{syncError}</div>}
          {syncSummary && <div className="rounded-2xl border border-[#bde8d2] bg-[#ecfaf2] px-4 py-3 text-sm text-[#165c3a]">{syncSummary}</div>}

          {data && (<>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard label="Zoom host" value={data.zoom_user.email} />
              <StatCard label="Calendly" value={data.calendly_configured ? data.calendly_user?.email || 'Connected' : 'Not connected'} />
              <StatCard label="Past" value={String(data.past_meetings.length)} strongColor="text-[#37B06D]" />
              <StatCard label="Upcoming" value={String(data.upcoming_meetings.length)} strongColor="text-[#005EB8]" />
            </div>
            <p className="text-xs text-[#7b8aa0]">Updated {formatDateTimeCanadaEastern(data.generated_at)} (ET)</p>
          </>)}

          <section>
            <h2 className="text-sm font-bold uppercase tracking-wide text-[#6f7f96] mb-3 flex items-center gap-2"><Calendar size={16} /> Past meetings</h2>
            <div className="space-y-3">
              {data?.past_meetings.length === 0 && !loading && <p className="text-[#7c8ca1] text-sm border border-dashed border-[#d4e4f7] rounded-2xl p-8 text-center">No past meetings.</p>}
              {data && data.past_meetings.map((row) => (<Fragment key={String(row.zoom.uuid) + String(row.zoom.start_time)}><PastMeetingCard row={row} calendlyConfigured={data.calendly_configured} expanded={expandedPast === row.zoom.uuid} onToggle={() => setExpandedPast((e) => (e === row.zoom.uuid ? null : row.zoom.uuid))} /></Fragment>))}
            </div>
          </section>

          <section>
            <h2 className="text-sm font-bold uppercase tracking-wide text-[#6f7f96] mb-3 flex items-center gap-2"><Video size={16} /> Upcoming schedule</h2>
            <div className="space-y-3">
              {data?.upcoming_meetings.length === 0 && !loading && <p className="text-[#7c8ca1] text-sm border border-dashed border-[#d4e4f7] rounded-2xl p-8 text-center">No upcoming meetings.</p>}
              {data && data.upcoming_meetings.map((row) => {
                const rowKey = `${row.zoom.uuid}|${row.zoom.start_time}`;
                return <Fragment key={rowKey}><UpcomingMeetingCard row={row} calendlyConfigured={data.calendly_configured} expanded={expandedUpcoming === rowKey} onToggle={() => setExpandedUpcoming((e) => (e === rowKey ? null : rowKey))} /></Fragment>;
              })}
            </div>
          </section>
        </div>
      </div>
    </Layout>
  );
};

const StatCard = ({ label, value, strongColor = 'text-[#0B1B34]' }: { label: string; value: string; strongColor?: string }) => (
  <div className="rounded-[24px] border border-[#d6e6f9] bg-white p-4 shadow-[0_8px_24px_-18px_rgba(0,94,184,0.45)]">
    <p className="text-xs uppercase tracking-wide text-[#7a8ba1]">{label}</p>
    <p className={`text-sm font-semibold mt-1 truncate ${strongColor}`}>{value}</p>
  </div>
);

function PastMeetingCard({ row, calendlyConfigured, expanded, onToggle }: { row: PastMeetingRow; calendlyConfigured: boolean; expanded: boolean; onToggle: () => void; }) {
  const z = row.zoom;
  const st = z.start_time ? formatDateTimeCanadaEastern(zoomMeetingStartMs(z) ?? z.start_time) : '—';
  const key = z.uuid + z.start_time;
  return (
    <div className="rounded-[24px] border border-[#d5e6fa] bg-white overflow-hidden shadow-[0_12px_28px_-22px_rgba(0,94,184,0.55)]">
      <button type="button" onClick={onToggle} className="w-full text-left px-4 py-4 flex flex-wrap items-start justify-between gap-3 hover:bg-[#f7fbff]">
        <div className="flex items-start gap-3 min-w-0 flex-1"><span className="text-[#7f90a6] mt-0.5">{expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}</span><div className="min-w-0"><p className="font-bold text-[#0B1B34] text-base leading-snug">{z.topic}</p><p className="text-xs text-[#72839a] mt-1">{st} (ET) · {z.duration_minutes} min · Host: {z.host_email}</p></div></div>
        <div className="flex flex-wrap gap-2 shrink-0 text-xs"><span className="rounded-full bg-[#edf4ff] px-2.5 py-1 text-[#355c8a]">Invited {row.stats.invited_count}</span><span className="rounded-full bg-[#ecfaf2] border border-[#c6ebd7] px-2.5 py-1 text-[#1f7d4e]">Joined {row.stats.attended_matched_count}</span></div>
      </button>
      {expanded && <InviteeList keyPrefix={key} calendlyConfigured={calendlyConfigured} invitees={row.invitees} />}
    </div>
  );
}

function UpcomingMeetingCard({ row, calendlyConfigured, expanded, onToggle }: { row: UpcomingMeetingRow; calendlyConfigured: boolean; expanded: boolean; onToggle: () => void; }) {
  const z = row.zoom;
  const st = z.start_time ? formatDateTimeCanadaEastern(zoomMeetingStartMs(z) ?? z.start_time) : '—';
  const listKey = z.uuid + z.start_time;
  return (
    <div className="rounded-[24px] border border-[#d5e6fa] bg-white overflow-hidden shadow-[0_12px_28px_-22px_rgba(0,94,184,0.55)]">
      <button type="button" onClick={onToggle} className="w-full text-left px-4 py-4 flex flex-wrap items-start justify-between gap-3 hover:bg-[#f7fbff]">
        <div className="flex items-start gap-3 min-w-0 flex-1"><span className="text-[#7f90a6] mt-0.5">{expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}</span><div className="min-w-0"><p className="font-bold text-[#0B1B34] text-base leading-snug">{z.topic}</p><p className="text-xs text-[#72839a] mt-1">{st} (ET) · {z.duration_minutes} min · Host: {z.host_email}</p></div></div>
        <div className="flex flex-wrap gap-2 shrink-0 text-xs">{calendlyConfigured && row.calendly ? <span className="rounded-full bg-[#ecfaf2] border border-[#c6ebd7] px-2.5 py-1 text-[#1f7d4e]"><Mail size={12} className="inline mr-1" />{row.invitees.length} invited</span> : <span className="rounded-full bg-[#edf4ff] px-2.5 py-1 text-[#607a9a]">No Calendly match</span>}</div>
      </button>
      {expanded && <InviteeList keyPrefix={listKey} calendlyConfigured={calendlyConfigured} invitees={row.invitees} />}
    </div>
  );
}

function InviteeList({ keyPrefix, calendlyConfigured, invitees }: { keyPrefix: string; calendlyConfigured: boolean; invitees: Array<{ email: string; name?: string }> }) {
  return (
    <div className="border-t border-[#e2ecf8] px-4 py-4 text-sm">
      <h4 className="text-xs font-bold uppercase text-[#7a8ca3] mb-3">Invitees</h4>
      {calendlyConfigured === false && <p className="text-[#7c8ca1]">Calendly not connected.</p>}
      {calendlyConfigured && invitees.length === 0 && <p className="text-[#7c8ca1]">No invitees listed yet.</p>}
      {calendlyConfigured && invitees.length > 0 && <ul className="space-y-2">{invitees.map((i) => (<li key={keyPrefix + i.email} className="rounded-2xl border border-[#e4edf9] px-3 py-2 bg-[#fbfdff]"><p className="font-semibold text-[#0B1B34]">{(i.name || '').trim() || i.email}</p><p className="text-xs text-[#6f8198]">{i.email}</p></li>))}</ul>}
    </div>
  );
}

export default LiveSessionsDashboard;
