import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Layout from '../components/Layout';
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
import { signInWithGoogle } from '../services/googleAuth';

const EM_DASH = '\u2014';
const MIDDLE_DOT = '\u00B7';
const CAL_CELL = 'bg-blue-50 text-blue-950 border-blue-100';
const CAL_HEAD = 'bg-blue-100/90 text-blue-900';
const ZOOM_CELL = 'bg-green-50 text-green-950 border-green-100';
const ZOOM_HEAD = 'bg-green-100/90 text-green-900';

type InviteeRow = {
  name: string;
  email: string;
  phone: string;
  status: string;
  attended: boolean | null;
  joinTime: string | null;
  leaveTime: string | null;
};

function mapPastInvitee(i: PastMeetingInvitee): InviteeRow {
  return {
    name: i.name || EM_DASH,
    email: i.email || EM_DASH,
    phone: i.phone_number || EM_DASH,
    status: i.status || (i.attended_zoom ? 'attended' : 'invited'),
    attended: i.attended_zoom,
    joinTime: i.join_time ?? null,
    leaveTime: i.leave_time ?? null,
  };
}

function mapUpcomingInvitee(i: UpcomingMeetingInvitee): InviteeRow {
  return {
    name: i.name || EM_DASH,
    email: i.email || EM_DASH,
    phone: i.phone_number || EM_DASH,
    status: i.status || 'active',
    attended: null,
    joinTime: null,
    leaveTime: null,
  };
}

function inviteesForSession(row: LiveSessionScheduleRow): InviteeRow[] {
  const seen = new Set<string>();
  const out: InviteeRow[] = [];
  const add = (inv: InviteeRow) => {
    const key = inv.email !== EM_DASH ? inv.email.toLowerCase() : inv.name.toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(inv);
  };
  for (const i of row.past?.invitees ?? []) add(mapPastInvitee(i));
  for (const i of row.upcoming?.invitees ?? []) add(mapUpcomingInvitee(i));
  return out;
}

const LiveSessionsDashboard: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [email, setEmail] = useState('admin@globelife-paz.com');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);
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

  const load = useCallback(async (sync: boolean) => {
    setFetchError(null);
    if (sync) {
      setSyncSummary(null);
      setSyncError(null);
    }
    const token = await getFreshAccessToken();
    if (!token) {
      setFetchError('Not signed in.');
      return;
    }
    setLoading(true);
    const result = await fetchLiveSessionsDashboard(token, sync ? { sync: true } : undefined);
    setLoading(false);
    if (!result.ok) {
      setData(null);
      setFetchError(result.error);
      return;
    }
    setData(result.data);
    if (sync && result.data && !result.data.from_cache) {
      const past = result.data.past_meetings;
      const attended = past.reduce((n, r) => n + (r.stats?.attended_matched_count ?? 0), 0);
      const zoomJoiners = past.reduce((n, r) => n + (r.stats?.zoom_participant_count ?? 0), 0);
      const withInvitees = past.filter((r) => (r.stats?.invited_count ?? r.invitees.length) > 0).length;
      if (withInvitees > 0 && zoomJoiners === 0) {
        setFetchError(
          'Calendly registrations loaded but Zoom returned no attendees. Confirm Zoom scopes are saved on the Server-to-Server app, then sync again.',
        );
      } else if (attended > 0 || zoomJoiners > 0) {
        setSyncSummary(
          `Zoom attendance loaded: ${zoomJoiners} joiner${zoomJoiners === 1 ? '' : 's'} across ${past.length} past session${past.length === 1 ? '' : 's'} (${attended} matched to Calendly).`,
        );
      }
    }
  }, [getFreshAccessToken]);

  useEffect(() => {
    if (isAuthenticated) void load(false);
  }, [isAuthenticated, load]);

  const sessions = useMemo(
    () => (data ? buildLiveSessionScheduleRows(data) : []),
    [data],
  );

  const upcomingSessions = useMemo(
    () => sessions.filter((s) => !s.isPast).sort((a, b) => a.dateKey.localeCompare(b.dateKey)),
    [sessions],
  );
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

  const handleGoogleLogin = async () => {
    setAuthError(null);
    setGoogleLoading(true);
    const { error } = await signInWithGoogle('/live-sessions');
    if (error) setAuthError(error);
    setGoogleLoading(false);
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
            <div className="relative py-1">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-[#d9e9fb]" />
              </div>
              <div className="relative flex justify-center text-[10px] uppercase tracking-wide text-[#95a6bd]">
                <span className="bg-white px-2">or</span>
              </div>
            </div>
            <Button fullWidth type="button" variant="outline" onClick={() => void handleGoogleLogin()} disabled={googleLoading}>
              {googleLoading ? 'Redirecting...' : 'Continue with Google'}
            </Button>
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
                30-minute webinar {MIDDLE_DOT} Wednesdays 11:30 AM Eastern
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button type="button" variant="outline" className="text-sm" onClick={() => void load(true)} disabled={loading}>
              <RefreshCw size={15} className={`mr-1.5 inline ${loading ? 'animate-spin' : ''}`} />
              Refresh from Zoom + Calendly
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

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Wednesday sessions" value={totals.sessionDates} />
          <StatCard label="Upcoming" value={upcomingSessions.length} />
          <StatCard label="Total scheduled" value={totals.scheduled} />
          <StatCard label="Confirmed attended (past)" value={totals.attended} highlight />
        </div>

        <div className="flex flex-wrap items-center gap-3 text-[11px]">
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${CAL_HEAD}`}>
            <span className="h-2 w-2 rounded-full bg-blue-500" /> Calendly (registrations)
          </span>
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${ZOOM_HEAD}`}>
            <span className="h-2 w-2 rounded-full bg-green-600" /> Zoom (attendance)
          </span>
          {data && (
            <span className="text-[#9ba8ba]">
              {data.from_cache ? 'Loaded from database' : 'Full refresh saved to database'}
              {MIDDLE_DOT} {data.from_cache ? 'last saved' : 'synced'}{' '}
              {formatDateTimeCanadaEastern(data.generated_at)}
              {!data.from_cache ? ` ${MIDDLE_DOT} replaces all past & upcoming sessions` : ''}
            </span>
          )}
        </div>

        <SessionsBlock
          title="Upcoming sessions"
          subtitle="Scheduled on Calendly (blue)."
          sessions={upcomingSessions}
          loading={loading}
          emptyText="No upcoming sessions in the database. Click Refresh from Zoom + Calendly to fetch and save."
          expandedKey={expandedKey}
          onToggle={(key) => setExpandedKey((k) => (k === key ? null : key))}
        />

        <SessionsBlock
          title="Past sessions"
          subtitle="Calendly registrations (blue) + Zoom attendance (green)."
          sessions={pastSessions}
          loading={loading}
          emptyText="No past sessions in the database. Click Refresh from Zoom + Calendly to fetch and save."
          expandedKey={expandedKey}
          onToggle={(key) => setExpandedKey((k) => (k === key ? null : key))}
        />

      </div>
    </Layout>
  );
};

function SessionsBlock({
  title,
  subtitle,
  sessions,
  loading,
  emptyText,
  expandedKey,
  onToggle,
}: {
  title: string;
  subtitle: string;
  sessions: LiveSessionScheduleRow[];
  loading: boolean;
  emptyText: string;
  expandedKey: string | null;
  onToggle: (key: string) => void;
}) {
  return (
    <section className="rounded-2xl border border-[#d6e6f9] bg-white shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-[#e5edf9] bg-[#f8fbff]">
        <h2 className="text-sm font-bold text-[#0B1B34]">{title}</h2>
        <p className="text-[11px] text-[#7a8fa8] mt-0.5">{subtitle}</p>
      </div>
      {loading && <p className="p-6 text-sm text-[#7a8fa8]">Loading…</p>}
      {!loading && sessions.length === 0 && (
        <p className="p-6 text-sm text-[#7a8fa8]">{emptyText}</p>
      )}
      {!loading && sessions.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-[#7a8fa8] border-b border-[#e5edf9]">
                <th className="px-4 py-2.5 w-8" />
                <th className="px-2 py-2.5">Date</th>
                <th className="px-2 py-2.5">Session time (ET)</th>
                <th className={`px-2 py-2.5 text-right ${CAL_HEAD}`}>Scheduled</th>
                <th className={`px-2 py-2.5 text-right ${ZOOM_HEAD}`}>Attended</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <SessionTableRow
                  key={session.key}
                  session={session}
                  expanded={expandedKey === session.key}
                  onToggle={() => onToggle(session.key)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

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
        <td className={`px-2 py-3 text-right font-bold ${CAL_CELL}`}>{session.scheduledCount}</td>
        <td className={`px-2 py-3 text-right font-semibold ${session.isPast ? ZOOM_CELL : 'text-[#9ba8ba]'}`}>
          {session.isPast ? (session.attendedCount ?? 0) : EM_DASH}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-[#f8fbff]">
          <td colSpan={5} className="px-4 py-4">
            <div className="space-y-3">
              <p className="text-xs text-[#5a6f8a]">
                <span className={`inline-block rounded px-1.5 py-0.5 mr-1 ${CAL_HEAD}`}>
                  {session.scheduledCount} scheduled — Calendly
                </span>
                {session.isPast && (
                  <span className={`inline-block rounded px-1.5 py-0.5 ${ZOOM_HEAD}`}>
                    {session.past?.stats?.zoom_participant_count ?? 0} Zoom joiners
                    {session.past?.zoom?.uuid ? '' : ' (Zoom occurrence not linked)'}
                  </span>
                )}
              </p>
              {session.isPast && session.attendanceRatePct != null && (
                <p className="text-xs text-[#5a6f8a]">
                  Attendance: <strong className="text-[#0B1B34]">{session.attendanceRatePct}%</strong>
                  {' '}({session.attendedCount ?? 0} of {session.scheduledCount} matched)
                </p>
              )}

              {invitees.length === 0 ? (
                <p className="text-sm text-[#9bafc9]">No registrations for this session.</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-[#e0eaf8] bg-white">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wide border-b border-[#e0eaf8]">
                        <th className={`px-3 py-2 ${CAL_HEAD}`}>Name</th>
                        <th className={`px-3 py-2 ${CAL_HEAD}`}>Email</th>
                        <th className={`px-3 py-2 ${CAL_HEAD}`}>Phone</th>
                        <th className={`px-3 py-2 ${CAL_HEAD}`}>Status</th>
                        {session.isPast && <th className={`px-3 py-2 ${ZOOM_HEAD}`}>Attended</th>}
                        {session.isPast && <th className={`px-3 py-2 ${ZOOM_HEAD}`}>Join / leave</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {invitees.map((inv) => (
                        <tr key={`${inv.email}-${inv.name}`} className="border-b border-[#eef3fa] last:border-0">
                          <td className={`px-3 py-2 font-medium ${CAL_CELL}`}>{inv.name}</td>
                          <td className={`px-3 py-2 ${CAL_CELL}`}>{inv.email}</td>
                          <td className={`px-3 py-2 whitespace-nowrap ${CAL_CELL}`}>{inv.phone}</td>
                          <td className={`px-3 py-2 capitalize ${CAL_CELL}`}>{inv.status}</td>
                          {session.isPast && (
                            <td className={`px-3 py-2 ${ZOOM_CELL}`}>
                              {inv.attended === true && (
                                <span className="font-semibold">Attended</span>
                              )}
                              {inv.attended === false && (
                                <span className="font-semibold">No-show</span>
                              )}
                              {inv.attended == null && <span>{EM_DASH}</span>}
                            </td>
                          )}
                          {session.isPast && (
                            <td className={`px-3 py-2 whitespace-nowrap ${ZOOM_CELL}`}>
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
