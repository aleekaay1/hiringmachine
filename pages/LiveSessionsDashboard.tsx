import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Layout from '../components/Layout';
import IntegrationStatusLights from '../components/IntegrationStatusLights';
import { Button } from '../components/UI';
import { supabase } from '../services/supabaseClient';
import {
  buildLiveSessionScheduleRows,
  fetchLiveSessionsDashboard,
  type LiveSessionScheduleRow,
  type LiveSessionsDashboardPayload,
  type PastMeetingInvitee,
  type UpcomingMeetingInvitee,
} from '../services/liveSessionsIntegrations';
import {
  collectLiveSessionInviteAndAttendEmails,
  syncLiveSessionPipeline,
} from '../services/liveSessionPipelineSync';
import { formatDateTimeCanadaEastern } from '../services/dateDisplay';
import { ChevronDown, ChevronRight, RefreshCw, Users, Video } from 'lucide-react';

const EM_DASH = '\u2014';
const MIDDLE_DOT = '\u00B7';

type InviteeRow = {
  name: string;
  email: string;
  phone: string;
  status: string;
  attended: boolean | null;
  joinTime: string | null;
  leaveTime: string | null;
};

function inviteesForSession(row: LiveSessionScheduleRow): InviteeRow[] {
  if (row.past) {
    return row.past.invitees.map((i: PastMeetingInvitee) => ({
      name: i.name || EM_DASH,
      email: i.email || EM_DASH,
      phone: i.phone_number || EM_DASH,
      status: i.status || (i.attended_zoom ? 'attended' : 'invited'),
      attended: i.attended_zoom,
      joinTime: i.join_time ?? null,
      leaveTime: i.leave_time ?? null,
    }));
  }
  if (row.upcoming) {
    return row.upcoming.invitees.map((i: UpcomingMeetingInvitee) => ({
      name: i.name || EM_DASH,
      email: i.email || EM_DASH,
      phone: i.phone_number || EM_DASH,
      status: i.status || 'active',
      attended: null,
      joinTime: null,
      leaveTime: null,
    }));
  }
  return [];
}

const LiveSessionsDashboard: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [email, setEmail] = useState('admin@globelife-paz.com');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<LiveSessionsDashboardPayload | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncSummary, setSyncSummary] = useState<string | null>(null);

  const getFreshAccessToken = useCallback(async (): Promise<string | null> => {
    const { data: s } = await supabase.auth.getSession();
    if (s.session?.access_token) return s.session.access_token;
    const { data: refreshed, error } = await supabase.auth.refreshSession();
    if (error) return null;
    return refreshed.session?.access_token ?? null;
  }, []);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data: s }) => {
      if (s.session) setIsAuthenticated(true);
    });
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
    if (!result.ok) {
      setData(null);
      setFetchError(result.error);
      return;
    }
    setData(result.data);
  }, [getFreshAccessToken]);

  useEffect(() => {
    if (isAuthenticated) void load();
  }, [isAuthenticated, load]);

  const sessions = useMemo(
    () => (data ? buildLiveSessionScheduleRows(data) : []),
    [data],
  );

  const upcomingSessions = useMemo(() => sessions.filter((s) => !s.isPast), [sessions]);
  const pastSessions = useMemo(() => sessions.filter((s) => s.isPast), [sessions]);

  const totals = useMemo(() => {
    const scheduled = sessions.reduce((n, s) => n + s.scheduledCount, 0);
    const attended = pastSessions.reduce((n, s) => n + (s.attendedCount ?? 0), 0);
    return { scheduled, attended, sessionDates: sessions.length };
  }, [sessions, pastSessions]);

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
    const result = await syncLiveSessionPipeline(token, collectLiveSessionInviteAndAttendEmails(data));
    setSyncLoading(false);
    if (!result.ok) {
      setSyncError(result.error);
      return;
    }
    const r = result.data;
    setSyncSummary(
      [
        r.invited_stage_updated > 0 ? `${r.invited_stage_updated} moved to invited` : null,
        r.attended_rows_updated > 0 ? `${r.attended_rows_updated} marked attended` : null,
        r.assessment_stage_updated > 0 ? `${r.assessment_stage_updated} moved to assessment sent` : null,
        r.assessment_emails_sent > 0 ? `${r.assessment_emails_sent} leadership emails sent` : null,
      ]
        .filter(Boolean)
        .join(` ${MIDDLE_DOT} `) || 'No new pipeline changes.',
    );
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#f7fbff] to-[#eef6ff] flex items-center justify-center p-4">
        <div className="bg-white border border-[#d9e9fb] p-8 rounded-[28px] shadow w-full max-w-sm">
          <h2 className="text-xl font-bold text-[#0B1B34] mb-1 text-center">Live Online Career Session</h2>
          <p className="text-sm text-[#6f7b8d] text-center mb-6">Sign in with your admin account</p>
          <form onSubmit={handleLogin} className="space-y-4">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2.5 rounded-2xl border border-[#cfe3f9]"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2.5 rounded-2xl border border-[#cfe3f9]"
            />
            <Button fullWidth type="submit">Sign in</Button>
            {authError && <p className="text-sm text-red-600 text-center">{authError}</p>}
          </form>
        </div>
      </div>
    );
  }

  return (
    <Layout isAdmin>
      <div className="w-full max-w-[1200px] mx-auto p-5 lg:p-6 space-y-5 text-[#1A2942]">
        <header className="rounded-2xl border border-[#d6deea] bg-white shadow-sm px-5 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-xl bg-[#005EB8]/10 flex items-center justify-center shrink-0">
              <Video size={20} className="text-[#005EB8]" />
            </div>
            <div>
              <h1 className="text-lg font-extrabold text-[#0B1B34]">Live Online Career Session</h1>
              <p className="text-xs text-[#73839b]">
                Every Wednesday {MIDDLE_DOT} 11:30 AM{EM_DASH}12:30 PM Eastern {MIDDLE_DOT} Calendly + Zoom
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <IntegrationStatusLights />
            <Button type="button" variant="outline" className="text-sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw size={15} className={`mr-1.5 inline ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button
              type="button"
              variant="outline"
              className="text-sm"
              onClick={() => void handleSyncPipeline()}
              disabled={loading || syncLoading || !data}
            >
              <Users size={15} className={`mr-1.5 inline ${syncLoading ? 'animate-pulse' : ''}`} />
              Sync pipeline
            </Button>
          </div>
        </header>

        {fetchError && <Alert tone="red">{fetchError}</Alert>}
        {syncError && <Alert tone="red">{syncError}</Alert>}
        {syncSummary && <Alert tone="green">{syncSummary}</Alert>}
        {!data?.calendly_configured && data && (
          <Alert tone="amber">
            Calendly is not connected on the server. Invitee names and phones stay empty until CALENDLY_API_TOKEN is set and integrations-zoom-calendly is redeployed.
          </Alert>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Wednesday sessions" value={totals.sessionDates} />
          <StatCard label="Upcoming" value={upcomingSessions.length} />
          <StatCard label="Total scheduled" value={totals.scheduled} />
          <StatCard label="Confirmed attended (past)" value={totals.attended} highlight />
        </div>

        {data && (
          <p className="text-[11px] text-[#9ba8ba]">
            Last refreshed {formatDateTimeCanadaEastern(data.generated_at)} {MIDDLE_DOT} Zoom host{' '}
            {data.zoom_user?.email ?? EM_DASH}
            {data.calendly_user?.email ? ` ${MIDDLE_DOT} Calendly ${data.calendly_user.email}` : ''}
          </p>
        )}

        <section className="rounded-2xl border border-[#d6e6f9] bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-[#e5edf9] bg-[#f8fbff]">
            <h2 className="text-sm font-bold text-[#0B1B34]">Sessions by date</h2>
            <p className="text-[11px] text-[#7a8fa8] mt-0.5">
              Click a row for full invitee list: name, email, phone, and Zoom attendance (past sessions).
            </p>
          </div>
          {loading && <p className="p-6 text-sm text-[#7a8fa8]">Loading Calendly + Zoom...</p>}
          {!loading && sessions.length === 0 && (
            <p className="p-6 text-sm text-[#7a8fa8]">
              No Wednesday 11:30 AM sessions in range. Redeploy integrations-zoom-calendly after pulling latest code.
            </p>
          )}
          {!loading && sessions.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-[#7a8fa8] border-b border-[#e5edf9]">
                    <th className="px-4 py-2.5 w-8" />
                    <th className="px-2 py-2.5">Date</th>
                    <th className="px-2 py-2.5">Session time (ET)</th>
                    <th className="px-2 py-2.5 text-right">Scheduled</th>
                    <th className="px-2 py-2.5 text-right">Attended</th>
                    <th className="px-4 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((session) => (
                    <SessionTableRow
                      key={session.key}
                      session={session}
                      expanded={expandedKey === session.key}
                      onToggle={() => setExpandedKey((k) => (k === session.key ? null : session.key))}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </Layout>
  );
};

function SessionTableRow({
  session,
  expanded,
  onToggle,
}: {
  session: LiveSessionScheduleRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const invitees = inviteesForSession(session);
  const calOk = Boolean(session.past?.calendly || session.upcoming?.calendly);
  const zoomOk = Boolean(session.past?.zoom || session.upcoming?.zoom);

  return (
    <>
      <tr className="border-b border-[#eef3fa] hover:bg-[#f8fbff]">
        <td className="px-4 py-3 text-[#9bafc9]">
          <button type="button" onClick={onToggle} className="p-0.5" aria-expanded={expanded}>
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        </td>
        <td className="px-2 py-3 font-semibold text-[#0B1B34] whitespace-nowrap">{session.dateLabel}</td>
        <td className="px-2 py-3 text-[#5a6f8a] text-xs whitespace-nowrap">{session.sessionTimeLabel}</td>
        <td className="px-2 py-3 text-right font-bold text-[#0B1B34]">{session.scheduledCount}</td>
        <td className="px-2 py-3 text-right font-semibold text-[#005EB8]">
          {session.isPast ? (session.attendedCount ?? 0) : EM_DASH}
        </td>
        <td className="px-4 py-3">
          <span
            className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${
              session.isPast
                ? 'bg-slate-50 text-slate-600 border-slate-200'
                : 'bg-blue-50 text-blue-700 border-blue-200'
            }`}
          >
            {session.isPast ? 'Past' : 'Upcoming'}
          </span>
          {!calOk && <span className="ml-1 text-[10px] text-amber-700">no Calendly</span>}
          {calOk && !zoomOk && <span className="ml-1 text-[10px] text-amber-700">no Zoom</span>}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-[#f8fbff]">
          <td colSpan={6} className="px-4 py-4">
            <div className="space-y-3">
              <div className="flex flex-wrap gap-3 text-xs text-[#5a6f8a]">
                <span>
                  <strong className="text-[#0B1B34]">Calendly:</strong> {session.calendlyName ?? EM_DASH}
                </span>
                <span>
                  <strong className="text-[#0B1B34]">Zoom:</strong> {session.zoomTopic}
                </span>
                {session.attendanceRatePct != null && (
                  <span>
                    <strong className="text-[#0B1B34]">Attendance:</strong> {session.attendanceRatePct}%
                  </span>
                )}
                {session.zoomJoinUrl && (
                  <a
                    href={session.zoomJoinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#005EB8] underline"
                  >
                    Zoom join link
                  </a>
                )}
              </div>

              {invitees.length === 0 ? (
                <p className="text-sm text-[#9bafc9]">
                  No active invitees for this Wednesday session.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-[#e0eaf8] bg-white">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wide text-[#7a8fa8] bg-[#f3f7fc] border-b border-[#e0eaf8]">
                        <th className="px-3 py-2">Name</th>
                        <th className="px-3 py-2">Email</th>
                        <th className="px-3 py-2">Phone</th>
                        <th className="px-3 py-2">Status</th>
                        {session.isPast && <th className="px-3 py-2">Zoom</th>}
                        {session.isPast && <th className="px-3 py-2">Join / leave</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {invitees.map((inv) => (
                        <tr key={`${inv.email}-${inv.name}`} className="border-b border-[#eef3fa] last:border-0">
                          <td className="px-3 py-2 font-medium text-[#0B1B34]">{inv.name}</td>
                          <td className="px-3 py-2 text-[#5a6f8a]">{inv.email}</td>
                          <td className="px-3 py-2 text-[#5a6f8a] whitespace-nowrap">{inv.phone}</td>
                          <td className="px-3 py-2 capitalize text-[#5a6f8a]">{inv.status}</td>
                          {session.isPast && (
                            <td className="px-3 py-2">
                              {inv.attended === true && (
                                <span className="text-green-700 font-semibold">Attended</span>
                              )}
                              {inv.attended === false && (
                                <span className="text-red-600 font-semibold">No-show</span>
                              )}
                              {inv.attended == null && <span>{EM_DASH}</span>}
                            </td>
                          )}
                          {session.isPast && (
                            <td className="px-3 py-2 text-[#7a8fa8] whitespace-nowrap">
                              {inv.joinTime
                                ? `${new Date(inv.joinTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${
                                    inv.leaveTime
                                      ? ` ${EM_DASH} ${new Date(inv.leaveTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                                      : ''
                                  }`
                                : EM_DASH}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function StatCard({ label, value, highlight = false }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div
      className={`rounded-2xl border p-4 shadow-sm ${
        highlight ? 'bg-[#005EB8]/5 border-[#005EB8]/25' : 'bg-white border-[#d6e6f9]'
      }`}
    >
      <p className="text-xs uppercase tracking-wide text-[#7a8ba1]">{label}</p>
      <p className={`text-2xl font-extrabold mt-1 ${highlight ? 'text-[#005EB8]' : 'text-[#0B1B34]'}`}>{value}</p>
    </div>
  );
}

function Alert({ tone, children }: { tone: 'red' | 'green' | 'amber'; children: React.ReactNode }) {
  const cls =
    tone === 'red'
      ? 'bg-red-50 border-red-200 text-red-800'
      : tone === 'green'
        ? 'bg-green-50 border-green-200 text-green-800'
        : 'bg-amber-50 border-amber-200 text-amber-900';
  return <div className={`rounded-xl border px-4 py-3 text-sm ${cls}`}>{children}</div>;
}

export default LiveSessionsDashboard;
