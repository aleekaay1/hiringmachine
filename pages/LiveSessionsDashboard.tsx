import React, { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import IntegrationStatusLights from '../components/IntegrationStatusLights';
import { Button } from '../components/UI';
import { supabase } from '../services/supabaseClient';
import {
  fetchCalendlyProbe,
  fetchLiveSessionsDashboard,
  zoomMeetingStartMs,
  type CalendlyProbePayload,
  type LiveSessionsDashboardPayload,
  type PastMeetingRow,
  type UpcomingMeetingRow,
} from '../services/liveSessionsIntegrations';
import {
  collectLiveSessionInviteAndAttendEmails,
  syncLiveSessionPipeline,
} from '../services/liveSessionPipelineSync';
import { formatDateTimeCanadaEastern } from '../services/dateDisplay';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  RefreshCw,
  UserCheck,
  UserX,
  Users,
  Video,
  Wifi,
} from 'lucide-react';

type InviteeWithAttendance = {
  email: string;
  name: string;
  attended_zoom?: boolean;
  match_method?: 'email' | 'name' | null;
  join_time?: string | null;
  leave_time?: string | null;
  no_show?: boolean;
};

const LiveSessionsDashboard: React.FC = () => {
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
  const [calProbeLoading, setCalProbeLoading] = useState(false);
  const [calProbeNote, setCalProbeNote] = useState<string | null>(null);
  const [calDiag, setCalDiag] = useState<CalendlyProbePayload | null>(null);
  const [calDiagError, setCalDiagError] = useState<string | null>(null);

  const getFreshAccessToken = useCallback(async (): Promise<string | null> => {
    const { data: s } = await supabase.auth.getSession();
    if (s.session?.access_token) return s.session.access_token;
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

  const runCalendlyProbe = useCallback(async (token: string) => {
    setCalDiagError(null);
    setCalProbeLoading(true);
    const probe = await fetchCalendlyProbe(token);
    setCalProbeLoading(false);
    if (!probe.ok) {
      setCalDiag(null);
      setCalDiagError(probe.error);
      return null;
    }
    setCalDiag(probe.data);
    setCalProbeNote(
      `Calendly: ${probe.data.events_total_in_range} events in range, ${probe.data.events_matching_live_name} match live session name, ${probe.data.events_used_for_dashboard} paired to Zoom.`,
    );
    return probe.data;
  }, []);

  const load = useCallback(async () => {
    setFetchError(null);
    setSyncSummary(null);
    setSyncError(null);
    setCalDiagError(null);
    const token = await getFreshAccessToken();
    if (!token) { setFetchError('Not signed in.'); return; }
    setLoading(true);
    const result = await fetchLiveSessionsDashboard(token);
    setLoading(false);
    if (result.ok === false) { setData(null); setFetchError(result.error); return; }
    setData(result.data);
    if (result.data.calendly_configured) {
      void runCalendlyProbe(token);
    } else {
      setCalDiag(null);
      setCalProbeNote('Calendly token not visible to Edge Function — check CALENDLY_API_TOKEN secret and redeploy.');
    }
  }, [getFreshAccessToken, runCalendlyProbe]);

  useEffect(() => { if (isAuthenticated) void load(); }, [isAuthenticated, load]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setAuthError('Invalid email or password.'); return; }
    setIsAuthenticated(true);
  };

  const handleCalendlyProbe = async () => {
    setFetchError(null);
    const token = await getFreshAccessToken();
    if (!token) {
      setFetchError('Not signed in.');
      return;
    }
    await runCalendlyProbe(token);
  };

  const handleSyncPipeline = async () => {
    if (!data) return;
    setSyncError(null);
    setSyncSummary(null);
    const token = await getFreshAccessToken();
    if (!token) { setSyncError('Not signed in.'); return; }
    setSyncLoading(true);
    const sets = collectLiveSessionInviteAndAttendEmails(data);
    const result = await syncLiveSessionPipeline(token, sets);
    setSyncLoading(false);
    if (result.ok === false) { setSyncError(result.error); return; }
    const r = result.data;
    setSyncSummary([
      r.invited_stage_updated > 0 ? `${r.invited_stage_updated} moved to invited` : null,
      r.attended_rows_updated > 0 ? `${r.attended_rows_updated} marked attended` : null,
      r.assessment_stage_updated > 0 ? `${r.assessment_stage_updated} moved to assessment sent` : null,
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
    <Layout isAdmin>
      <div className="w-full p-5 lg:p-6 space-y-6 text-[#1A2942]">

        {/* Header bar */}
        <div className="rounded-2xl border border-[#d6deea] bg-white shadow-sm px-5 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-xl bg-[#005EB8]/10 flex items-center justify-center shrink-0">
              <Video size={20} className="text-[#005EB8]" />
            </div>
            <div>
              <h1 className="text-lg font-extrabold text-[#0B1B34]">Live Career Overview — Attendance</h1>
              <p className="text-xs text-[#73839b]">
                Tuesday 6–7 PM ET · Wednesday 11:30 AM–12:30 PM ET &nbsp;·&nbsp; Zoom + Calendly
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <IntegrationStatusLights />
            <Button
              type="button" variant="outline"
              className="text-sm" onClick={() => void load()} disabled={loading}
            >
              <RefreshCw size={15} className={`mr-1.5 inline ${loading ? 'animate-spin' : ''}`} /> Refresh
            </Button>
            <Button
              type="button"
              variant="outline"
              className="text-sm"
              onClick={() => void handleCalendlyProbe()}
              disabled={loading || calProbeLoading}
              title="Fetch all Calendly events in range and log invitees to the browser console"
            >
              <Wifi size={15} className={`mr-1.5 inline ${calProbeLoading ? 'animate-pulse' : ''}`} />
              Probe Calendly
            </Button>
            <Button
              type="button" variant="outline"
              className="text-sm" onClick={() => void handleSyncPipeline()} disabled={loading || syncLoading || !data}
            >
              <Users size={15} className={`mr-1.5 inline ${syncLoading ? 'animate-pulse' : ''}`} /> Sync pipeline
            </Button>
          </div>
        </div>

        {/* Alerts */}
        {fetchError  && <Alert tone="red">{fetchError}</Alert>}
        {syncError   && <Alert tone="red">{syncError}</Alert>}
        {syncSummary && <Alert tone="green">{syncSummary}</Alert>}
        {calProbeNote && <Alert tone="green">{calProbeNote}</Alert>}
        {calDiagError && <Alert tone="red">{calDiagError}</Alert>}

        {(calDiag || data?.calendly_fetch) && (
          <CalendlyDiagnosticsPanel probe={calDiag} dashboardFetch={data?.calendly_fetch} configured={!!data?.calendly_configured} />
        )}

        {/* Summary stats */}
        {data && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatBadge label="Past sessions"     value={data.past_meetings.length}     />
            <StatBadge label="Upcoming"          value={data.upcoming_meetings.length}  />
            <StatBadge
              label="Total invited"
              value={data.past_meetings.reduce((s, r) => s + (r.stats?.invited_count ?? 0), 0)}
            />
            <StatBadge
              label="Confirmed attended"
              value={data.past_meetings.reduce((s, r) => s + (r.stats?.attended_matched_count ?? 0), 0)}
              highlight
            />
          </div>
        )}

        {data && <p className="text-[11px] text-[#9ba8ba]">Last refreshed: {formatDateTimeCanadaEastern(data.generated_at)} (ET)</p>}

        {/* ── PAST SESSIONS ── */}
        <section className="space-y-3">
          <SectionHeading icon={<Video size={15} />} label="Past sessions" />
          {loading && <EmptyState text="Loading sessions…" />}
          {!loading && (data?.past_meetings.length ?? 0) === 0 && (
            <EmptyState text="No past sessions found. Ensure your Zoom meetings are within the Tuesday / Wednesday time slots." />
          )}
          {data?.past_meetings.map((row) => {
            const key = `${row.zoom.uuid}|${row.zoom.start_time}`;
            return (
              <PastSessionCard
                key={key}
                row={row}
                calendlyConfigured={data.calendly_configured}
                expanded={expandedPast === key}
                onToggle={() => setExpandedPast((e) => (e === key ? null : key))}
              />
            );
          })}
        </section>

        {/* ── UPCOMING SESSIONS ── */}
        <section className="space-y-3">
          <SectionHeading icon={<Clock size={15} />} label="Upcoming sessions" />
          {!loading && (data?.upcoming_meetings.length ?? 0) === 0 && (
            <EmptyState text="No upcoming sessions scheduled." />
          )}
          {data?.upcoming_meetings.map((row) => {
            const key = `${row.zoom.uuid}|${row.zoom.start_time}`;
            return (
              <UpcomingSessionCard
                key={key}
                row={row}
                calendlyConfigured={data.calendly_configured}
                expanded={expandedUpcoming === key}
                onToggle={() => setExpandedUpcoming((e) => (e === key ? null : key))}
              />
            );
          })}
        </section>
      </div>
    </Layout>
  );
};

// ─── Past session card ────────────────────────────────────────────────────────
function PastSessionCard({ row, calendlyConfigured, expanded, onToggle }: {
  row: PastMeetingRow; calendlyConfigured: boolean; expanded: boolean; onToggle: () => void;
}) {
  const z = row.zoom;
  const stats = row.stats;
  const startLabel = z.start_time ? formatDateTimeCanadaEastern(zoomMeetingStartMs(z) ?? z.start_time) : '—';
  const sessionType = (row as unknown as Record<string, unknown>).session_type as string | null | undefined;
  const rate = stats?.attendance_rate_pct != null ? stats.attendance_rate_pct : (
    stats?.invited_count ? Math.round((stats.attended_matched_count / stats.invited_count) * 100) : null
  );

  return (
    <div className="rounded-2xl border border-[#d6e6f9] bg-white overflow-hidden shadow-sm">
      <button
        type="button" onClick={onToggle}
        className="w-full text-left px-5 py-4 flex flex-wrap items-start justify-between gap-3 hover:bg-[#f5f9ff] transition-colors"
      >
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <span className="mt-1 text-[#9bafc9] shrink-0">
            {expanded ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-bold text-[#0B1B34] text-sm leading-snug">{z.topic || 'Live Career Overview Session'}</p>
              {sessionType && <SessionTypePill label={sessionType} />}
            </div>
            <p className="text-xs text-[#7a8fa8] mt-1">
              {startLabel} ET &nbsp;·&nbsp; {z.duration_minutes} min &nbsp;·&nbsp; Host: {z.host_email}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <AttendancePill
            invited={stats?.invited_count ?? 0}
            attended={stats?.attended_matched_count ?? 0}
            rate={rate}
          />
        </div>
      </button>

      {expanded && (
        <div className="border-t border-[#e5edf9] px-5 py-5 space-y-5">
          {/* Attendance rate bar */}
          {(stats?.invited_count ?? 0) > 0 && (
            <div>
              <div className="flex justify-between text-xs text-[#7a8fa8] mb-1">
                <span>Attendance rate</span>
                <span className="font-semibold text-[#0B1B34]">{rate ?? 0}%</span>
              </div>
              <div className="h-2 bg-[#e9f0fb] rounded-full overflow-hidden">
                <div className="h-full bg-[#005EB8] rounded-full transition-all" style={{ width: `${rate ?? 0}%` }} />
              </div>
            </div>
          )}

          {!calendlyConfigured && (
            <p className="text-sm text-[#9bafc9]">Calendly not connected — invitee data unavailable.</p>
          )}

          {calendlyConfigured && (row.invitees.length === 0) && (stats?.zoom_participant_count ?? 0) === 0 && (
            <p className="text-sm text-[#9bafc9]">No invitees or Zoom participants found for this session.</p>
          )}

          {/* Attended */}
          {calendlyConfigured && (row.invitees as InviteeWithAttendance[]).filter((i) => i.attended_zoom).length > 0 && (
            <AttendanceGroup
              icon={<UserCheck size={14} className="text-green-600" />}
              label="Attended"
              tone="green"
              people={(row.invitees as InviteeWithAttendance[]).filter((i) => i.attended_zoom)}
            />
          )}

          {/* No-show */}
          {calendlyConfigured && (row.invitees as InviteeWithAttendance[]).filter((i) => !i.attended_zoom).length > 0 && (
            <AttendanceGroup
              icon={<UserX size={14} className="text-red-500" />}
              label="Invited — did not attend"
              tone="red"
              people={(row.invitees as InviteeWithAttendance[]).filter((i) => !i.attended_zoom)}
            />
          )}

          {/* Walk-ins (joined Zoom but not on Calendly) */}
          {((row as unknown as Record<string, unknown>).walkin_emails as string[] | undefined)?.length ? (
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <Wifi size={14} className="text-amber-600" />
                <p className="text-xs font-bold uppercase tracking-wide text-amber-600">Joined directly (not via Calendly)</p>
              </div>
              <div className="space-y-1">
                {((row as unknown as Record<string, unknown>).walkin_emails as string[]).map((em) => (
                  <div key={em} className="text-xs text-[#5a6f8a] bg-amber-50 border border-amber-200 rounded-xl px-3 py-1.5">
                    {em}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ─── Upcoming session card ────────────────────────────────────────────────────
function UpcomingSessionCard({ row, calendlyConfigured, expanded, onToggle }: {
  row: UpcomingMeetingRow; calendlyConfigured: boolean; expanded: boolean; onToggle: () => void;
}) {
  const z = row.zoom;
  const startLabel = z.start_time ? formatDateTimeCanadaEastern(zoomMeetingStartMs(z) ?? z.start_time) : '—';
  const sessionType = (row as unknown as Record<string, unknown>).session_type as string | null | undefined;

  return (
    <div className="rounded-2xl border border-[#d6e6f9] bg-white overflow-hidden shadow-sm">
      <button
        type="button" onClick={onToggle}
        className="w-full text-left px-5 py-4 flex flex-wrap items-start justify-between gap-3 hover:bg-[#f5f9ff] transition-colors"
      >
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <span className="mt-1 text-[#9bafc9] shrink-0">
            {expanded ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-bold text-[#0B1B34] text-sm">{z.topic || 'Live Career Overview Session'}</p>
              {sessionType && <SessionTypePill label={sessionType} />}
              <span className="text-[10px] font-semibold uppercase tracking-wide bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full">Upcoming</span>
            </div>
            <p className="text-xs text-[#7a8fa8] mt-1">{startLabel} ET &nbsp;·&nbsp; {z.duration_minutes} min</p>
          </div>
        </div>
        <div className="shrink-0 text-xs">
          {calendlyConfigured && row.invitees.length > 0
            ? <span className="rounded-full bg-blue-50 border border-blue-200 px-3 py-1 text-blue-700 font-semibold">{row.invitees.length} invited</span>
            : <span className="rounded-full bg-[#f3f6fb] px-3 py-1 text-[#8a9cb8]">No registrations yet</span>}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-[#e5edf9] px-5 py-5">
          {!calendlyConfigured && <p className="text-sm text-[#9bafc9]">Calendly not connected.</p>}
          {calendlyConfigured && !row.calendly && (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              No Calendly event matched this Zoom date — check Calendly diagnostics above (event name must include &quot;Live Online Career Session&quot;).
            </p>
          )}
          {calendlyConfigured && row.calendly && row.invitees.length === 0 && (
            <p className="text-sm text-[#9bafc9]">
              Calendly event matched ({row.calendly.name ?? 'session'}) but no active invitees yet.
            </p>
          )}
          {calendlyConfigured && row.invitees.length > 0 && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-[#7a8fa8] mb-3">Registrants</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {row.invitees.map((inv) => (
                  <div key={`${inv.email}`} className="flex items-center gap-2 rounded-xl border border-[#e0eaf8] bg-[#f8fbff] px-3 py-2">
                    <div className="h-7 w-7 rounded-full bg-[#005EB8]/10 flex items-center justify-center shrink-0 text-[10px] font-bold text-[#005EB8]">
                      {(inv.name || inv.email).charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-[#0B1B34] truncate">{inv.name || inv.email}</p>
                      {inv.name && <p className="text-[10px] text-[#7a8fa8] truncate">{inv.email}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Attendance group ─────────────────────────────────────────────────────────
function AttendanceGroup({ icon, label, tone, people }: {
  icon: React.ReactNode;
  label: string;
  tone: 'green' | 'red';
  people: InviteeWithAttendance[];
}) {
  const bgTone   = tone === 'green' ? 'bg-green-50 border-green-200'   : 'bg-red-50 border-red-200';
  const textTone = tone === 'green' ? 'text-green-700'                 : 'text-red-600';
  const labelTone = tone === 'green' ? 'text-green-700' : 'text-red-600';
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        {icon}
        <p className={`text-xs font-bold uppercase tracking-wide ${labelTone}`}>{label} ({people.length})</p>
      </div>
      <div className="space-y-2">
        {people.map((p) => (
          <div key={p.email} className={`flex flex-wrap items-start gap-3 rounded-xl border px-3 py-2.5 ${bgTone}`}>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-semibold ${textTone}`}>{p.name || p.email}</p>
              {p.name && <p className="text-xs text-[#7a8fa8]">{p.email}</p>}
            </div>
            {p.attended_zoom && p.join_time && (
              <div className="text-[10px] text-green-700 font-medium whitespace-nowrap">
                <span>Joined</span> {new Date(p.join_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                {p.leave_time && <> <span className="text-green-500">→</span> {new Date(p.leave_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</>}
              </div>
            )}
            {p.attended_zoom && p.match_method === 'name' && (
              <span className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">matched by name</span>
            )}
            {!p.attended_zoom && <NoShowBadge />}
            {p.attended_zoom && <CheckCircle2 size={14} className="text-green-500 shrink-0 mt-0.5" />}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Minor UI helpers ─────────────────────────────────────────────────────────
function SessionTypePill({ label }: { label: string }) {
  const isTue = label.toLowerCase().includes('tue');
  return (
    <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${
      isTue
        ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
        : 'bg-violet-50 text-violet-700 border-violet-200'
    }`}>
      {label}
    </span>
  );
}

function AttendancePill({ invited, attended, rate }: { invited: number; attended: number; rate: number | null }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="rounded-full bg-[#edf4ff] px-2.5 py-1 text-[#355c8a] font-medium">
        {invited} invited
      </span>
      <span className="rounded-full bg-green-50 border border-green-200 px-2.5 py-1 text-green-700 font-semibold">
        {attended} attended {rate != null ? `(${rate}%)` : ''}
      </span>
    </div>
  );
}

function NoShowBadge() {
  return (
    <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-red-100 text-red-600 border border-red-200">
      No-show
    </span>
  );
}

function StatBadge({ label, value, highlight = false }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 ${highlight ? 'bg-[#005EB8]/5 border-[#005EB8]/25' : 'bg-white border-[#d6e6f9]'} shadow-sm`}>
      <p className="text-xs uppercase tracking-wide text-[#7a8ba1]">{label}</p>
      <p className={`text-2xl font-extrabold mt-1 ${highlight ? 'text-[#005EB8]' : 'text-[#0B1B34]'}`}>{value}</p>
    </div>
  );
}

function SectionHeading({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <h2 className="text-xs font-bold uppercase tracking-widest text-[#7a8fa8] flex items-center gap-2">
      {icon} {label}
    </h2>
  );
}

function CalendlyDiagnosticsPanel({
  probe,
  dashboardFetch,
  configured,
}: {
  probe: CalendlyProbePayload | null;
  dashboardFetch?: LiveSessionsDashboardPayload['calendly_fetch'];
  configured: boolean;
}) {
  const stats = probe?.fetch_stats ?? dashboardFetch?.fetch_stats;
  const eventTypes = probe?.event_types ?? dashboardFetch?.event_types ?? [];
  const liveEvents = probe?.events.filter((e) => e.matches_live_name) ?? [];

  return (
    <div className="rounded-2xl border border-[#d6e6f9] bg-[#f8fbff] px-4 py-4 space-y-3 text-sm">
      <p className="font-bold text-[#0B1B34]">Calendly diagnostics</p>
      {!configured && (
        <p className="text-amber-800">Edge Function reports Calendly not configured (no token).</p>
      )}
      {stats && (
        <p className="text-[#5a6f8a]">
          API fetch: <strong>{stats.user_scope_count}</strong> user-scoped +{' '}
          <strong>{stats.organization_scope_count}</strong> org-scoped →{' '}
          <strong>{stats.deduped_count}</strong> unique events
          {probe?.organization_uri ? ' (team org connected)' : ''}.
        </p>
      )}
      {probe && (
        <p className="text-[#5a6f8a]">
          Live session name match: <strong>{probe.events_matching_live_name}</strong> · paired to Zoom:{' '}
          <strong>{probe.events_used_for_dashboard}</strong>
        </p>
      )}
      {eventTypes.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-[#7a8fa8] mb-1">Event types on account</p>
          <ul className="list-disc pl-5 text-[#5a6f8a] space-y-0.5 max-h-28 overflow-y-auto">
            {eventTypes.map((t) => (
              <li key={t.uri || t.name}>{t.name}</li>
            ))}
          </ul>
        </div>
      )}
      {liveEvents.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="text-left text-[#7a8fa8]">
                <th className="pr-3 py-1">Date</th>
                <th className="pr-3 py-1">Event</th>
                <th className="pr-3 py-1 text-right">Invitees</th>
              </tr>
            </thead>
            <tbody>
              {liveEvents.slice(0, 15).map((e) => (
                <tr key={e.uri} className="border-t border-[#e5edf9]">
                  <td className="pr-3 py-1.5 tabular-nums">{e.toronto_date}</td>
                  <td className="pr-3 py-1.5">{e.name}</td>
                  <td className="pr-3 py-1.5 text-right tabular-nums font-semibold">{e.invitee_count_active}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {probe && liveEvents.length === 0 && stats && stats.deduped_count > 0 && (
        <p className="text-amber-800">
          Calendly returned events but none matched the live session name. Event types on your account are listed above — adjust{' '}
          <code className="text-xs">CALENDLY_EVENT_NAME_KEYWORDS</code> in Supabase if needed.
        </p>
      )}
      {probe && stats?.deduped_count === 0 && (
        <p className="text-amber-800">
          Zero scheduled events returned. Confirm the PAT is for the calendar that owns &quot;Live Online Career Session&quot; bookings.
        </p>
      )}
    </div>
  );
}

function Alert({ tone, children }: { tone: 'red' | 'green'; children: React.ReactNode }) {
  const cls = tone === 'red'
    ? 'border-red-200 bg-red-50 text-red-700'
    : 'border-green-200 bg-green-50 text-green-700';
  return <div className={`rounded-2xl border px-4 py-3 text-sm ${cls}`}>{children}</div>;
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-[#c8d9ef] bg-white p-10 text-center text-sm text-[#8fa3be]">
      {text}
    </div>
  );
}

export default LiveSessionsDashboard;
