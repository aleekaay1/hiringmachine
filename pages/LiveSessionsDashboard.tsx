import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useStaffAuthenticated } from '../hooks/useStaffAuthenticated';
import { Button } from '../components/UI';
import { supabase } from '../services/supabaseClient';
import {
  buildLiveSessionScheduleRows,
  fetchLiveSessionsDashboard,
  pastSessionShowedCount,
  type LiveSessionScheduleRow,
  type LiveSessionsDashboardPayload,
  type PastMeetingInvitee,
  type UpcomingMeetingInvitee,
} from '../services/liveSessionsIntegrations';
import {
  collectLiveSessionAttendeeProfiles,
  collectLiveSessionInviteAndAttendEmails,
  sendLiveSessionAssessmentEmails,
  syncLiveSessionPipeline,
  type LiveSessionAttendeeMatch,
} from '../services/liveSessionPipelineSync';
import { formatDateTimeCanadaEastern } from '../services/dateDisplay';
import { listUnmatchedZoomParticipants } from '../services/liveSessionAttendanceMatch';
import { ChevronDown, ChevronRight, Mail, RefreshCw, Users, Video, X } from 'lucide-react';
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
  matchMethod?: 'email' | 'hybrid' | 'name' | null;
  assessmentStatus?: string | null;
  assessmentMode?: 'auto' | 'manual' | null;
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
    matchMethod: i.match_method ?? null,
    assessmentStatus: i.assessment_email_status ?? null,
    assessmentMode: i.assessment_email_mode ?? null,
  };
}

function assessmentStatusLabel(status: string | null | undefined): string {
  if (!status) return '—';
  if (status === 'sent') return 'Sent';
  if (status === 'pending') return 'Pending';
  if (status === 'failed') return 'Failed';
  if (status.startsWith('skipped_')) return status.replace(/^skipped_/, '').replace(/_/g, ' ');
  return status;
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

/** Calendly registrations only — no Zoom-only duplicate rows. */
function calendlyInviteesForSession(row: LiveSessionScheduleRow): InviteeRow[] {
  const seen = new Set<string>();
  const out: InviteeRow[] = [];
  for (const i of row.past?.invitees ?? []) {
    const email = String(i.email ?? '').trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push(mapPastInvitee(i));
  }
  for (const i of row.upcoming?.invitees ?? []) {
    const email = String(i.email ?? '').trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push(mapUpcomingInvitee(i));
  }
  return out;
}

function unmatchedZoomRowsForSession(row: LiveSessionScheduleRow): InviteeRow[] {
  const past = row.past;
  if (!past?.participants?.length) return [];
  const rawInvitees = past.invitees.map((i) => ({
    email: String(i.email ?? '').trim(),
    name: String(i.name ?? '').trim(),
  }));
  const zoomParticipants = past.participants.map((p) => ({
    name: p.name,
    user_email: p.email,
    join_time: p.join_time,
    leave_time: p.leave_time,
  }));
  return listUnmatchedZoomParticipants(rawInvitees, zoomParticipants).map((p) => ({
    name: String(p.name || '').trim() || EM_DASH,
    email: String(p.user_email || '').trim() || EM_DASH,
    phone: EM_DASH,
    status: 'zoom only',
    attended: true,
    joinTime: p.join_time ?? null,
    leaveTime: p.leave_time ?? null,
  }));
}

const LiveSessionsDashboard: React.FC = () => {
  const isAuthenticated = useStaffAuthenticated();
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
  const [pipelineModalOpen, setPipelineModalOpen] = useState(false);
  const [pipelineMatches, setPipelineMatches] = useState<LiveSessionAttendeeMatch[]>([]);
  const [pipelineSelected, setPipelineSelected] = useState<string[]>([]);
  const [sendAssessmentsLoading, setSendAssessmentsLoading] = useState(false);

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
      const matched = past.reduce((n, r) => n + (r.stats?.attended_matched_count ?? 0), 0);
      const showed = past.reduce((n, r) => n + pastSessionShowedCount(r.stats, r), 0);
      const withInvitees = past.filter((r) => (r.stats?.invited_count ?? r.invitees.length) > 0).length;
      if (withInvitees > 0 && showed === 0) {
        setFetchError(
          'Calendly registrations loaded but Zoom returned no attendees. Confirm Zoom scopes are saved on the Server-to-Server app, then sync again.',
        );
      } else if (showed > 0 || matched > 0) {
        setSyncSummary(
          `Zoom attendance loaded: ${showed} unique attendee${showed === 1 ? '' : 's'} across ${past.length} past session${past.length === 1 ? '' : 's'} (${matched} matched to Calendly registrations).`,
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
    const { invitedEmails, attendedEmails } = collectLiveSessionInviteAndAttendEmails(data);
    const attendeeProfiles = collectLiveSessionAttendeeProfiles(data);
    setSyncLoading(true);
    const result = await syncLiveSessionPipeline(token, {
      invitedEmails,
      attendedEmails,
      attendeeProfiles,
    });
    setSyncLoading(false);
    if (!result.ok) {
      setSyncError(result.error);
      return;
    }
    const r = result.data;
    const stageParts = [
      r.invited_stage_updated > 0 ? `${r.invited_stage_updated} moved to invited` : null,
      r.attended_rows_updated > 0 ? `${r.attended_rows_updated} marked attended` : null,
    ].filter(Boolean);
    if (stageParts.length > 0) {
      setSyncSummary(stageParts.join(` ${MIDDLE_DOT} `));
    }
    const matches = r.matched_attendees ?? [];
    setPipelineMatches(matches);
    setPipelineSelected(matches.filter((m) => m.canSendAssessment).map((m) => m.email));
    setPipelineModalOpen(true);
  };

  const handleSendSelectedAssessments = async () => {
    const toSend = pipelineSelected.filter((email) => {
      const row = pipelineMatches.find((m) => m.email === email);
      return row?.canSendAssessment;
    });
    if (toSend.length === 0) {
      setSyncError('Select at least one eligible attendee to email.');
      return;
    }
    setSyncError(null);
    const token = await getFreshAccessToken();
    if (!token) {
      setSyncError('Not signed in.');
      return;
    }
    setSendAssessmentsLoading(true);
    const result = await sendLiveSessionAssessmentEmails(token, toSend);
    setSendAssessmentsLoading(false);
    if (!result.ok) {
      setSyncError(result.error);
      return;
    }
    setPipelineModalOpen(false);
    const parts = [
      syncSummary,
      result.assessment_emails_sent > 0
        ? `${result.assessment_emails_sent} leadership assessment email${result.assessment_emails_sent === 1 ? '' : 's'} sent`
        : null,
      result.assessment_email_send_failed > 0
        ? `${result.assessment_email_send_failed} email send failed`
        : null,
    ].filter(Boolean);
    setSyncSummary(parts.join(` ${MIDDLE_DOT} `) || 'Done.');
    if (result.failed.length > 0) {
      setSyncError(result.failed.map((f) => `${f.email}: ${f.error}`).join(' '));
    }
  };

  const togglePipelineEmail = (email: string, checked: boolean) => {
    setPipelineSelected((prev) => {
      if (checked) return prev.includes(email) ? prev : [...prev, email];
      return prev.filter((e) => e !== email);
    });
  };

  const selectAllEligiblePipeline = () => {
    setPipelineSelected(pipelineMatches.filter((m) => m.canSendAssessment).map((m) => m.email));
  };


  return (
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
              title="Update candidate stages, then review Zoom attendees matched in the portal and send leadership emails manually"
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
          <StatCard label="Total showed (past)" value={totals.attended} highlight />
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
          subtitle="Calendly registrations (blue) + unique Zoom attendees who showed (green)."
          sessions={pastSessions}
          loading={loading}
          emptyText="No past sessions in the database. Click Refresh from Zoom + Calendly to fetch and save."
          expandedKey={expandedKey}
          onToggle={(key) => setExpandedKey((k) => (k === key ? null : key))}
        />

        {pipelineModalOpen && (
          <LiveSessionPipelineReviewModal
            matches={pipelineMatches}
            selected={pipelineSelected}
            sending={sendAssessmentsLoading}
            onToggle={togglePipelineEmail}
            onSelectAllEligible={selectAllEligiblePipeline}
            onClose={() => !sendAssessmentsLoading && setPipelineModalOpen(false)}
            onSend={() => void handleSendSelectedAssessments()}
          />
        )}
      </div>
  );
};

function LiveSessionPipelineReviewModal({
  matches,
  selected,
  sending,
  onToggle,
  onSelectAllEligible,
  onClose,
  onSend,
}: {
  matches: LiveSessionAttendeeMatch[];
  selected: string[];
  sending: boolean;
  onToggle: (email: string, checked: boolean) => void;
  onSelectAllEligible: () => void;
  onClose: () => void;
  onSend: () => void;
}) {
  const selectedSet = new Set(selected);
  const eligibleCount = matches.filter((m) => m.canSendAssessment).length;
  const sendCount = selected.filter((email) => matches.find((m) => m.email === email)?.canSendAssessment).length;

  return (
    <div
      className="fixed inset-0 z-[120] bg-[#0B1B34]/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="bg-white rounded-2xl border border-[#d6e6f9] shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="pipeline-review-title"
      >
        <div className="px-5 py-4 border-b border-[#e5edf9] flex items-start justify-between gap-3">
          <div>
            <h2 id="pipeline-review-title" className="text-base font-bold text-[#0B1B34]">
              Matched Zoom attendees
            </h2>
            <p className="text-xs text-[#7a8fa8] mt-1">
              Pipeline stages were updated. Select who should receive the leadership assessment email.
            </p>
          </div>
          <button
            type="button"
            className="p-1.5 rounded-lg text-[#7a8fa8] hover:bg-[#f0f6ff] disabled:opacity-50"
            onClick={onClose}
            disabled={sending}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-auto px-5 py-3">
          {matches.length === 0 ? (
            <p className="text-sm text-[#7a8fa8] py-6 text-center">
              No Zoom-confirmed attendees in past sessions. Refresh from Zoom + Calendly first.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-[#7a8fa8] border-b border-[#e5edf9]">
                  <th className="py-2 pr-2 w-8" />
                  <th className="py-2 pr-2">Name</th>
                  <th className="py-2 pr-2">Email</th>
                  <th className="py-2 pr-2">Portal</th>
                  <th className="py-2">Assessment email</th>
                </tr>
              </thead>
              <tbody>
                {matches.map((m) => {
                  const checked = selectedSet.has(m.email);
                  return (
                    <tr key={m.email} className="border-b border-[#f0f4fa] last:border-0">
                      <td className="py-2.5 pr-2 align-top">
                        <input
                          type="checkbox"
                          className="rounded border-[#cfe3f9]"
                          checked={checked}
                          disabled={!m.canSendAssessment || sending}
                          onChange={(e) => onToggle(m.email, e.target.checked)}
                          aria-label={`Select ${m.displayName}`}
                        />
                      </td>
                      <td className="py-2.5 pr-2 align-top font-medium text-[#0B1B34]">{m.displayName}</td>
                      <td className="py-2.5 pr-2 align-top text-[#4a5d78] text-xs break-all">{m.email}</td>
                      <td className="py-2.5 pr-2 align-top">
                        {m.inPortal ? (
                          <span className="text-[11px] text-green-700 bg-green-50 border border-green-100 rounded-full px-2 py-0.5">
                            Matched
                          </span>
                        ) : (
                          <span className="text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded-full px-2 py-0.5">
                            Not in portal
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 align-top text-xs text-[#6f7b8d]">
                        {m.canSendAssessment ? (
                          <span className="text-green-700">Ready to send</span>
                        ) : (
                          <span>{m.skipReason || 'Cannot send'}</span>
                        )}
                        {m.pipelineStage && m.inPortal && (
                          <div className="text-[10px] text-[#9ba8ba] mt-0.5 truncate max-w-[180px]" title={m.pipelineStage}>
                            {m.pipelineStage}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-5 py-4 border-t border-[#e5edf9] flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-[#7a8fa8]">
            {eligibleCount} eligible {MIDDLE_DOT} {sendCount} selected to send
          </p>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" className="text-sm" onClick={onSelectAllEligible} disabled={sending || eligibleCount === 0}>
              Select all eligible
            </Button>
            <Button type="button" variant="outline" className="text-sm" onClick={onClose} disabled={sending}>
              Cancel
            </Button>
            <Button type="button" className="text-sm" onClick={onSend} disabled={sending || sendCount === 0}>
              <Mail size={15} className={`mr-1.5 inline ${sending ? 'animate-pulse' : ''}`} />
              {sending ? 'Sending…' : `Send leadership email (${sendCount})`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

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
                <th className={`px-2 py-2.5 text-right ${ZOOM_HEAD}`}>Showed</th>
                <th className={`px-2 py-2.5 text-right bg-violet-100/90 text-violet-900`}>Assessment</th>
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
  const invitees = calendlyInviteesForSession(session);
  const unmatchedZoom = unmatchedZoomRowsForSession(session);
  const pastStats = session.past?.stats;
  const showedCount = pastSessionShowedCount(pastStats, session.past);
  const matchedCount = pastStats?.attended_matched_count ?? session.past?.invitees.filter((i) => i.attended_zoom).length ?? 0;
  const unmatchedCount = unmatchedZoom.length > 0
    ? unmatchedZoom.length
    : pastStats?.walkin_count ?? session.past?.walkin_emails?.length ?? 0;

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
        <td className={`px-2 py-3 text-right font-semibold ${session.isPast ? 'bg-violet-50 text-violet-950' : 'text-[#9ba8ba]'}`}>
          {session.isPast ? (session.assessmentSentCount ?? 0) : EM_DASH}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-[#f8fbff]">
          <td colSpan={6} className="px-4 py-4">
            <div className="space-y-3">
              <p className="text-xs text-[#5a6f8a]">
                <span className={`inline-block rounded px-1.5 py-0.5 mr-1 ${CAL_HEAD}`}>
                  {session.scheduledCount} scheduled — Calendly
                </span>
                {session.isPast && (
                  <span className={`inline-block rounded px-1.5 py-0.5 ${ZOOM_HEAD}`}>
                    {showedCount} showed on Zoom
                    {session.past?.zoom?.uuid ? '' : ' (Zoom occurrence not linked)'}
                  </span>
                )}
              </p>
              {session.isPast && (
                <p className="text-xs text-[#5a6f8a]">
                  <strong className="text-[#0B1B34]">{matchedCount}</strong> of {session.scheduledCount} Calendly registration
                  {session.scheduledCount === 1 ? '' : 's'} matched on Zoom
                  {unmatchedCount > 0 && (
                    <>
                      {MIDDLE_DOT} <strong className="text-amber-900">{unmatchedCount}</strong> Zoom joiner
                      {unmatchedCount === 1 ? '' : 's'} not on Calendly
                    </>
                  )}
                  {MIDDLE_DOT} assessments sent:{' '}
                  <strong className="text-violet-900">{session.assessmentSentCount ?? 0}</strong>
                </p>
              )}

              {invitees.length === 0 ? (
                <p className="text-sm text-[#9bafc9]">No Calendly registrations for this session.</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-[#e0eaf8] bg-white">
                  <p className={`border-b border-[#e0eaf8] px-3 py-2 text-[10px] font-semibold uppercase tracking-wide ${CAL_HEAD}`}>
                    Calendly registrations
                  </p>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wide border-b border-[#e0eaf8]">
                        <th className={`px-3 py-2 ${CAL_HEAD}`}>Name</th>
                        <th className={`px-3 py-2 ${CAL_HEAD}`}>Email</th>
                        <th className={`px-3 py-2 ${CAL_HEAD}`}>Phone</th>
                        {session.isPast && <th className={`px-3 py-2 ${ZOOM_HEAD}`}>Showed</th>}
                        {session.isPast && <th className={`px-3 py-2 ${ZOOM_HEAD}`}>Join / leave</th>}
                        {session.isPast && <th className="px-3 py-2 bg-violet-100/90 text-violet-900">Assessment</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {invitees.map((inv) => (
                        <tr key={inv.email} className="border-b border-[#eef3fa] last:border-0">
                          <td className={`px-3 py-2 font-medium ${CAL_CELL}`}>{inv.name}</td>
                          <td className={`px-3 py-2 ${CAL_CELL}`}>{inv.email}</td>
                          <td className={`px-3 py-2 whitespace-nowrap ${CAL_CELL}`}>{inv.phone}</td>
                          {session.isPast && (
                            <td className={`px-3 py-2 ${ZOOM_CELL}`}>
                              {inv.attended === true ? (
                                <span className="font-semibold text-green-900">Yes</span>
                              ) : inv.attended === false ? (
                                <span className="font-semibold text-slate-600">No-show</span>
                              ) : (
                                EM_DASH
                              )}
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
                          {session.isPast && (
                            <td className="px-3 py-2 bg-violet-50 text-violet-950">
                              {inv.attended === true ? (
                                <span className={inv.assessmentStatus === 'sent' ? 'font-semibold text-violet-900' : ''}>
                                  {assessmentStatusLabel(inv.assessmentStatus)}
                                  {inv.assessmentMode && inv.assessmentStatus === 'sent' && (
                                    <span className="ml-1 text-[10px] font-normal opacity-80">({inv.assessmentMode})</span>
                                  )}
                                </span>
                              ) : (
                                EM_DASH
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {session.isPast && unmatchedZoom.length > 0 && (
                <div className="overflow-x-auto rounded-xl border border-amber-200 bg-amber-50/40">
                  <p className="border-b border-amber-200 bg-amber-100/80 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-amber-950">
                    Zoom joiners not on Calendly ({unmatchedZoom.length})
                  </p>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wide border-b border-amber-200 text-amber-900">
                        <th className="px-3 py-2">Zoom name</th>
                        <th className="px-3 py-2">Email (if any)</th>
                        <th className="px-3 py-2">Join / leave</th>
                      </tr>
                    </thead>
                    <tbody>
                      {unmatchedZoom.map((inv, idx) => (
                        <tr key={`${inv.name}-${inv.email}-${idx}`} className="border-b border-amber-100 last:border-0">
                          <td className="px-3 py-2 font-medium text-amber-950">{inv.name}</td>
                          <td className="px-3 py-2 text-amber-900">{inv.email}</td>
                          <td className="px-3 py-2 whitespace-nowrap text-amber-900">
                            {inv.joinTime
                              ? `${new Date(inv.joinTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${
                                  inv.leaveTime
                                    ? ` ${EM_DASH} ${new Date(inv.leaveTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                                    : ''
                                }`
                              : EM_DASH}
                          </td>
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
