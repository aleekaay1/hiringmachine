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
  previewLiveSessionAssessmentEmails,
  sendLiveSessionAssessmentEmails,
  syncLiveSessionPipeline,
  type LiveSessionAssessmentPreviewRow,
  type LiveSessionAttendeeMatch,
} from '../services/liveSessionPipelineSync';
import { formatDateTimeCanadaEastern } from '../services/dateDisplay';
import { listUnmatchedZoomParticipants } from '../services/liveSessionAttendanceMatch';
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, Mail, RefreshCw, Users, Video, X } from 'lucide-react';
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
  assessmentSentAt?: string | null;
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
    assessmentSentAt: i.assessment_email_sent_at ?? null,
  };
}

function showedInviteesForSession(row: LiveSessionScheduleRow): InviteeRow[] {
  return calendlyInviteesForSession(row).filter(
    (inv) => inv.attended === true && inv.email && inv.email !== EM_DASH,
  );
}

function formatAssessmentSentAt(iso: string | null | undefined): string {
  if (!iso) return '';
  return formatDateTimeCanadaEastern(iso);
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
    const attendeeProfiles = collectLiveSessionAttendeeProfiles(data);
    const result = await sendLiveSessionAssessmentEmails(token, toSend, attendeeProfiles);
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
          subtitle="Calendly registrations (blue) + unique Zoom attendees who showed (green). Select who showed to send leadership assessments."
          sessions={pastSessions}
          loading={loading}
          emptyText="No past sessions in the database. Click Refresh from Zoom + Calendly to fetch and save."
          expandedKey={expandedKey}
          onToggle={(key) => setExpandedKey((k) => (k === key ? null : key))}
          getFreshAccessToken={getFreshAccessToken}
          onSessionAssessmentsSent={() => void load(false)}
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
  getFreshAccessToken,
  onSessionAssessmentsSent,
}: {
  title: string;
  subtitle: string;
  sessions: LiveSessionScheduleRow[];
  loading: boolean;
  emptyText: string;
  expandedKey: string | null;
  onToggle: (key: string) => void;
  getFreshAccessToken?: () => Promise<string | null>;
  onSessionAssessmentsSent?: () => void;
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
                  getFreshAccessToken={getFreshAccessToken}
                  onSessionAssessmentsSent={onSessionAssessmentsSent}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

type SessionAssessmentModalPhase = 'checking' | 'review' | 'sending';

function SessionAssessmentSendModal({
  sessionLabel,
  phase,
  preview,
  selected,
  sendError,
  onToggle,
  onSelectEligible,
  onClose,
  onSend,
}: {
  sessionLabel: string;
  phase: SessionAssessmentModalPhase;
  preview: LiveSessionAssessmentPreviewRow[];
  selected: string[];
  sendError: string | null;
  onToggle: (email: string, checked: boolean) => void;
  onSelectEligible: () => void;
  onClose: () => void;
  onSend: () => void;
}) {
  const selectedSet = new Set(selected);
  const duplicateCount = preview.filter((r) => r.alreadySent).length;
  const eligibleCount = preview.filter((r) => r.canSendAssessment).length;
  const sendCount = selected.filter((email) => preview.find((r) => r.email === email)?.canSendAssessment).length;
  const busy = phase === 'checking' || phase === 'sending';

  return (
    <div
      className="fixed inset-0 z-[130] bg-[#0B1B34]/45 backdrop-blur-sm flex items-center justify-center p-4"
      role="presentation"
    >
      <div
        className="bg-white rounded-2xl border border-[#d6e6f9] shadow-2xl w-full max-w-3xl max-h-[88vh] flex flex-col relative overflow-hidden"
        role="dialog"
        aria-labelledby="session-assessment-title"
        onClick={(e) => e.stopPropagation()}
      >
        {(phase === 'checking' || phase === 'sending') && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/92 backdrop-blur-[2px] px-8 text-center">
            <div className="h-14 w-14 rounded-2xl bg-violet-100 flex items-center justify-center mb-4">
              <Loader2 size={28} className="text-violet-700 animate-spin" />
            </div>
            <p className="text-base font-bold text-[#0B1B34]">
              {phase === 'checking' ? 'Checking for duplicate sends…' : `Sending ${sendCount} assessment email${sendCount === 1 ? '' : 's'}…`}
            </p>
            <p className="text-sm text-[#6f7b8d] mt-2 max-w-md">
              {phase === 'checking'
                ? 'Comparing against this session, candidate portal history, and email send logs so no one receives the link twice.'
                : 'Please wait while leadership assessment links are delivered.'}
            </p>
            <div className="flex gap-1.5 mt-5">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-2 w-2 rounded-full bg-violet-400 animate-pulse"
                  style={{ animationDelay: `${i * 180}ms` }}
                />
              ))}
            </div>
          </div>
        )}

        <div className="px-5 py-4 border-b border-[#e5edf9] flex items-start justify-between gap-3">
          <div>
            <h2 id="session-assessment-title" className="text-base font-bold text-[#0B1B34]">
              Send leadership assessments
            </h2>
            <p className="text-xs text-[#7a8fa8] mt-1">{sessionLabel}</p>
          </div>
          <button
            type="button"
            className="p-1.5 rounded-lg text-[#7a8fa8] hover:bg-[#f0f6ff] disabled:opacity-50"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {duplicateCount > 0 && phase === 'review' && (
          <div className="mx-5 mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-900">
            <AlertTriangle size={16} className="shrink-0 mt-0.5 text-red-600" />
            <p>
              <strong>{duplicateCount}</strong> attendee{duplicateCount === 1 ? '' : 's'} already received the assessment link
              (highlighted in red). They are unchecked by default — remove any you do not want to email again, then send to the rest.
            </p>
          </div>
        )}

        {sendError && (
          <div className="mx-5 mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            {sendError}
          </div>
        )}

        <div className="flex-1 overflow-auto px-5 py-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-[#7a8fa8] border-b border-[#e5edf9]">
                <th className="py-2 pr-2 w-8" />
                <th className="py-2 pr-2">Name</th>
                <th className="py-2 pr-2">Email</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((row) => {
                const checked = selectedSet.has(row.email);
                const isDuplicate = row.alreadySent;
                return (
                  <tr
                    key={row.email}
                    className={`border-b last:border-0 ${
                      isDuplicate ? 'bg-red-50 border-red-100' : 'border-[#f0f4fa]'
                    }`}
                  >
                    <td className="py-2.5 pr-2 align-top">
                      <input
                        type="checkbox"
                        className="rounded border-[#cfe3f9]"
                        checked={checked}
                        disabled={busy}
                        onChange={(e) => onToggle(row.email, e.target.checked)}
                        aria-label={`Select ${row.displayName}`}
                      />
                    </td>
                    <td className={`py-2.5 pr-2 align-top font-medium ${isDuplicate ? 'text-red-950' : 'text-[#0B1B34]'}`}>
                      {row.displayName}
                    </td>
                    <td className={`py-2.5 pr-2 align-top text-xs break-all ${isDuplicate ? 'text-red-800' : 'text-[#4a5d78]'}`}>
                      {row.email}
                    </td>
                    <td className="py-2.5 align-top text-xs">
                      {isDuplicate ? (
                        <div className="text-red-800">
                          <span className="font-semibold">Already sent</span>
                          {row.sentAt && (
                            <div className="text-[11px] mt-0.5 text-red-700">
                              {formatAssessmentSentAt(row.sentAt)}
                            </div>
                          )}
                          {row.duplicateSources.length > 0 && (
                            <ul className="mt-1 text-[10px] text-red-600/90 space-y-0.5">
                              {row.duplicateSources.map((src) => (
                                <li key={`${row.email}-${src.source}`}>
                                  {src.label}
                                  {src.sentAt ? ` · ${formatAssessmentSentAt(src.sentAt)}` : ''}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ) : row.canSendAssessment ? (
                        <span className="text-green-700 font-medium">Ready to send</span>
                      ) : (
                        <span className="text-[#6f7b8d]">{row.skipReason || 'Cannot send'}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="px-5 py-4 border-t border-[#e5edf9] flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-[#7a8fa8]">
            {eligibleCount} eligible {MIDDLE_DOT} {sendCount} selected to send
            {duplicateCount > 0 && ` ${MIDDLE_DOT} ${duplicateCount} duplicate${duplicateCount === 1 ? '' : 's'}`}
          </p>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" className="text-sm" onClick={onSelectEligible} disabled={busy || eligibleCount === 0}>
              Select eligible only
            </Button>
            <Button type="button" variant="outline" className="text-sm" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" className="text-sm" onClick={onSend} disabled={busy || sendCount === 0}>
              <Mail size={15} className={`mr-1.5 inline ${busy ? 'animate-pulse' : ''}`} />
              {phase === 'sending' ? 'Sending…' : `Send (${sendCount})`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SessionTableRow({
  session,
  expanded,
  onToggle,
  getFreshAccessToken,
  onSessionAssessmentsSent,
}: {
  session: LiveSessionScheduleRow;
  expanded: boolean;
  onToggle: () => void;
  getFreshAccessToken?: () => Promise<string | null>;
  onSessionAssessmentsSent?: () => void;
}) {
  const invitees = calendlyInviteesForSession(session);
  const showedInvitees = showedInviteesForSession(session);
  const unmatchedZoom = unmatchedZoomRowsForSession(session);
  const pastStats = session.past?.stats;
  const showedCount = pastSessionShowedCount(pastStats, session.past);
  const matchedCount = pastStats?.attended_matched_count ?? session.past?.invitees.filter((i) => i.attended_zoom).length ?? 0;
  const unmatchedCount = unmatchedZoom.length > 0
    ? unmatchedZoom.length
    : pastStats?.walkin_count ?? session.past?.walkin_emails?.length ?? 0;

  const [rowSelected, setRowSelected] = useState<Set<string>>(new Set());
  const [assessmentModalOpen, setAssessmentModalOpen] = useState(false);
  const [assessmentPhase, setAssessmentPhase] = useState<SessionAssessmentModalPhase>('checking');
  const [assessmentPreview, setAssessmentPreview] = useState<LiveSessionAssessmentPreviewRow[]>([]);
  const [assessmentSelected, setAssessmentSelected] = useState<string[]>([]);
  const [assessmentSendError, setAssessmentSendError] = useState<string | null>(null);

  const toggleRowEmail = (email: string, checked: boolean) => {
    setRowSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(email);
      else next.delete(email);
      return next;
    });
  };

  const selectAllShowed = () => {
    setRowSelected(new Set(showedInvitees.map((i) => i.email)));
  };

  const openAssessmentSend = async () => {
    if (!getFreshAccessToken || rowSelected.size === 0) return;
    const emails = [...rowSelected];
    setAssessmentSendError(null);
    setAssessmentModalOpen(true);
    setAssessmentPhase('checking');
    const token = await getFreshAccessToken();
    if (!token) {
      setAssessmentSendError('Not signed in.');
      setAssessmentPhase('review');
      setAssessmentPreview([]);
      return;
    }
    const attendeeProfiles = emails.map((email) => {
      const inv = showedInvitees.find((i) => i.email === email);
      return {
        email,
        displayName: inv?.name && inv.name !== EM_DASH ? inv.name : email,
        sessionDateKey: session.dateKey,
      };
    });
    const result = await previewLiveSessionAssessmentEmails(token, {
      sessionDate: session.dateKey,
      emails,
      attendeeProfiles,
    });
    if (!result.ok) {
      setAssessmentSendError(result.error);
      setAssessmentPreview([]);
      setAssessmentSelected([]);
      setAssessmentPhase('review');
      return;
    }
    setAssessmentPreview(result.preview);
    setAssessmentSelected(result.preview.filter((r) => r.canSendAssessment).map((r) => r.email));
    setAssessmentPhase('review');
  };

  const handleAssessmentToggle = (email: string, checked: boolean) => {
    setAssessmentSelected((prev) => {
      if (checked) return prev.includes(email) ? prev : [...prev, email];
      return prev.filter((e) => e !== email);
    });
  };

  const handleSelectEligibleOnly = () => {
    setAssessmentSelected(assessmentPreview.filter((r) => r.canSendAssessment).map((r) => r.email));
  };

  const handleSendAssessments = async () => {
    if (!getFreshAccessToken) return;
    const toSend = assessmentSelected.filter((email) => {
      const row = assessmentPreview.find((r) => r.email === email);
      return row?.canSendAssessment;
    });
    if (toSend.length === 0) {
      setAssessmentSendError('Select at least one eligible attendee who has not already received the email.');
      return;
    }
    setAssessmentSendError(null);
    setAssessmentPhase('sending');
    const token = await getFreshAccessToken();
    if (!token) {
      setAssessmentSendError('Not signed in.');
      setAssessmentPhase('review');
      return;
    }
    const attendeeProfiles = toSend.map((email) => {
      const row = assessmentPreview.find((r) => r.email === email);
      return {
        email,
        displayName: row?.displayName || email,
        sessionDateKey: session.dateKey,
      };
    });
    const result = await sendLiveSessionAssessmentEmails(token, toSend, attendeeProfiles);
    if (!result.ok) {
      setAssessmentSendError(result.error);
      setAssessmentPhase('review');
      return;
    }
    if (result.failed.length > 0) {
      setAssessmentSendError(
        result.failed.map((f) => `${f.email}: ${f.error}`).join(' · '),
      );
      setAssessmentPhase('review');
      if (result.assessment_emails_sent > 0) {
        onSessionAssessmentsSent?.();
      }
      return;
    }
    setAssessmentModalOpen(false);
    setRowSelected(new Set());
    onSessionAssessmentsSent?.();
  };

  const rowSelectedCount = rowSelected.size;
  const canSendAssessments = session.isPast && showedInvitees.length > 0 && !!getFreshAccessToken;

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

              {canSendAssessments && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-violet-200 bg-violet-50/60 px-3 py-2.5">
                  <p className="text-xs text-violet-950">
                    <strong>{showedInvitees.length}</strong> Zoom attendee{showedInvitees.length === 1 ? '' : 's'} matched on Calendly
                    {rowSelectedCount > 0 && (
                      <>
                        {MIDDLE_DOT} <strong>{rowSelectedCount}</strong> selected
                      </>
                    )}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="text-xs h-8"
                      onClick={selectAllShowed}
                      disabled={showedInvitees.length === 0}
                    >
                      Select all who showed
                    </Button>
                    <Button
                      type="button"
                      className="text-xs h-8"
                      onClick={() => void openAssessmentSend()}
                      disabled={rowSelectedCount === 0}
                    >
                      <Mail size={14} className="mr-1 inline" />
                      Send assessments ({rowSelectedCount})
                    </Button>
                  </div>
                </div>
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
                        {canSendAssessments && <th className={`px-3 py-2 w-8 ${CAL_HEAD}`} />}
                        <th className={`px-3 py-2 ${CAL_HEAD}`}>Name</th>
                        <th className={`px-3 py-2 ${CAL_HEAD}`}>Email</th>
                        <th className={`px-3 py-2 ${CAL_HEAD}`}>Phone</th>
                        {session.isPast && <th className={`px-3 py-2 ${ZOOM_HEAD}`}>Showed</th>}
                        {session.isPast && <th className={`px-3 py-2 ${ZOOM_HEAD}`}>Join / leave</th>}
                        {session.isPast && <th className="px-3 py-2 bg-violet-100/90 text-violet-900">Assessment</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {invitees.map((inv) => {
                        const showCheckbox = canSendAssessments && inv.attended === true;
                        const alreadySent = inv.assessmentStatus === 'sent';
                        return (
                          <tr
                            key={inv.email}
                            className={`border-b border-[#eef3fa] last:border-0 ${
                              alreadySent && inv.attended === true ? 'bg-red-50/40' : ''
                            }`}
                          >
                            {canSendAssessments && (
                              <td className={`px-3 py-2 ${CAL_CELL}`}>
                                {showCheckbox ? (
                                  <input
                                    type="checkbox"
                                    className="rounded border-[#cfe3f9]"
                                    checked={rowSelected.has(inv.email)}
                                    onChange={(e) => toggleRowEmail(inv.email, e.target.checked)}
                                    aria-label={`Select ${inv.name}`}
                                  />
                                ) : null}
                              </td>
                            )}
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
                                  <span className={alreadySent ? 'font-semibold text-red-800' : ''}>
                                    {assessmentStatusLabel(inv.assessmentStatus)}
                                    {inv.assessmentMode && alreadySent && (
                                      <span className="ml-1 text-[10px] font-normal opacity-80">({inv.assessmentMode})</span>
                                    )}
                                    {inv.assessmentSentAt && alreadySent && (
                                      <div className="text-[10px] font-normal text-red-700 mt-0.5">
                                        Sent {formatAssessmentSentAt(inv.assessmentSentAt)}
                                      </div>
                                    )}
                                  </span>
                                ) : (
                                  EM_DASH
                                )}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {assessmentModalOpen && (
                <SessionAssessmentSendModal
                  sessionLabel={`${session.dateLabel} · ${session.sessionTimeLabel}`}
                  phase={assessmentPhase}
                  preview={assessmentPreview}
                  selected={assessmentSelected}
                  sendError={assessmentSendError}
                  onToggle={handleAssessmentToggle}
                  onSelectEligible={handleSelectEligibleOnly}
                  onClose={() => {
                    if (assessmentPhase !== 'sending' && assessmentPhase !== 'checking') {
                      setAssessmentModalOpen(false);
                    }
                  }}
                  onSend={() => void handleSendAssessments()}
                />
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
