import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStaffAuthenticated } from '../hooks/useStaffAuthenticated';
import { Button } from '../components/UI';
import { supabase } from '../services/supabaseClient';
import { formatDateTimeCanadaEastern } from '../services/dateDisplay';
import { getCandidates } from '../services/storageService';
import { sendEmail } from '../services/emailService';
import { mergeTemplate } from '../services/emailTemplates';
import { getSiteOriginForEmail } from '../services/emailSignature';
import { fetchLiveSessionsDashboard, type PastMeetingRow, type UpcomingMeetingRow } from '../services/liveSessionsIntegrations';
import { sessionLabelsFromStartIso } from '../services/liveSessionOccurrences';
import {
  createWednesdayCampaignRunSnapshot,
  finalizeWednesdayCampaignRunCounts,
  listWednesdayCampaignRuns,
  prepareWednesdayCampaignRunForSend,
  recordWednesdayCampaignRecipientSendResult,
  type WednesdayCampaignRunSnapshotRecipientInput,
  type WednesdayCampaignRunWithRecipients,
} from '../services/wednesdayCampaignRuns';
import { Candidate } from '../types';
import { Download, Mail, RefreshCw, Search } from 'lucide-react';
import { signInWithGoogle } from '../services/googleAuth';
import {
  categorizeEmailLog,
  type EmailLogCategory,
  type EmailLogMode,
} from '../services/emailLogCategories';

type EmailSendLogRow = {
  id: string;
  created_at: string;
  source: string;
  trigger_label: string | null;
  from_email: string;
  to_email: string;
  cc_email: string | null;
  subject: string;
  candidate_id: string | null;
  sent_by_user_id: string | null;
  status: string;
  error_message: string | null;
  metadata?: Record<string, unknown> | null;
};

type WednesdaySendStatus = 'sent' | 'failed';

type WednesdaySendResultRow = {
  recipientKey: string;
  candidateId: string | null;
  recipientName: string;
  to: string;
  status: WednesdaySendStatus;
  error?: string;
};

type WednesdaySendResult = {
  attempted: number;
  sent: number;
  failed: number;
  completedAt: string;
  rows: WednesdaySendResultRow[];
};

type CalendlyInviteeLite = {
  key: string;
  name: string;
  email: string;
  status: string;
  inviteeUri: string | null;
  eventUri: string | null;
};

type WednesdaySessionOption = {
  key: string;
  title: string;
  startTimeIso: string;
  sessionDateKey: string;
  durationMinutes: number;
  label: string;
  invitees: CalendlyInviteeLite[];
};

type WednesdayCampaignRecipient = {
  key: string;
  name: string;
  email: string;
  status: string;
  candidateId: string | null;
  mergeCandidate: { firstName: string; lastName: string; email: string; phone: string };
};

type WednesdaySentTracking = {
  candidateIds: Set<string>;
  recipientEmails: Set<string>;
};

const WEDNESDAY_MANUAL_TRIGGER = 'manual_wednesday_live_overview';
const EMAIL_SEND_LOGS_PAGE_SIZE = 1000;
const TARGET_SESSION_TITLE = 'Live Online Career Session';
const SESSION_PICKER_PAST_DAYS = 7;
const SESSION_PICKER_FUTURE_DAYS = 90;
const WEDNESDAY_REMINDER_SUBJECT_DEFAULT = 'Reminder: Live Overview Session Starts in 30 Minutes';
const WEDNESDAY_REMINDER_BODY_DEFAULT = `
<p>Hi {{firstName}},</p>
<p>This is a reminder that your Live Overview Session begins in about 30 minutes.</p>
<p><strong>Date:</strong> {{sessionDate}}<br/><strong>Time:</strong> {{sessionTime}}</p>
<p><strong>Join link:</strong> <a href="{{Zoom Link}}" target="_blank" rel="noopener noreferrer">{{Zoom Link}}</a></p>
<p>Please join a few minutes early so we can begin on time.</p>
<p>Best regards,</p>
{{emailSignature}}
`.trim();

function csvEscape(s: string): string {
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function candidateName(candidate: { firstName?: string; lastName?: string }): string {
  const full = `${candidate.firstName || ''} ${candidate.lastName || ''}`.trim();
  return full || '(No name)';
}

function ensureEmailSignaturePlaceholder(bodyHtml: string): string {
  if (bodyHtml.includes('{{emailSignature}}')) return bodyHtml;
  return `${bodyHtml.trim()}\n\n<p>Best regards,</p>\n{{emailSignature}}`;
}

function normalizeEmail(input: string | null | undefined): string {
  return String(input || '')
    .trim()
    .toLowerCase();
}

function parseFirstEmailAddress(input: string | null | undefined): string {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const first = raw.split(',')[0] ?? '';
  const bracketMatch = first.match(/<([^>]+)>/);
  return normalizeEmail(bracketMatch?.[1] || first);
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const cleaned = fullName.trim().replace(/\s+/g, ' ');
  if (!cleaned) return { firstName: 'Candidate', lastName: '' };
  const parts = cleaned.split(' ');
  const firstName = parts.shift() || 'Candidate';
  return { firstName, lastName: parts.join(' ') };
}

function easternDateKey(iso: string): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(parsed));
}

function deriveSessionOptions(rows: Array<PastMeetingRow | UpcomingMeetingRow>): WednesdaySessionOption[] {
  const nowMs = Date.now();
  const minMs = nowMs - SESSION_PICKER_PAST_DAYS * 24 * 60 * 60 * 1000;
  const maxMs = nowMs + SESSION_PICKER_FUTURE_DAYS * 24 * 60 * 60 * 1000;
  const byKey = new Map<string, WednesdaySessionOption>();
  for (const row of rows) {
    const title = String(row.calendly?.name || row.zoom.topic || '').trim();
    const startTimeIso = String(row.calendly?.start_time || row.zoom.start_time || '').trim();
    if (!title || !startTimeIso) continue;
    if (!title.toLowerCase().includes(TARGET_SESSION_TITLE.toLowerCase())) continue;
    const startMs = Date.parse(startTimeIso);
    if (!Number.isFinite(startMs) || startMs < minMs || startMs > maxMs) continue;

    const sessionDateKey = easternDateKey(startTimeIso);
    const durationMinutes =
      typeof row.zoom?.duration_minutes === 'number' && row.zoom.duration_minutes > 0
        ? row.zoom.duration_minutes
        : 30;
    const key = `${title}|${startTimeIso}|${row.calendly?.uri || row.zoom.uuid || 'session'}`;
    const inviteesRaw = row.invitees || [];
    const invitees = inviteesRaw
      .map((inv, idx) => {
        const email = normalizeEmail((inv as { email?: string }).email);
        const name = String((inv as { name?: string }).name || '').trim() || '(No name)';
        if (!email) return null;
        const inviteeUri = (inv as { invitee_uri?: string }).invitee_uri ?? null;
        const eventUri = (inv as { event_uri?: string }).event_uri ?? row.calendly?.uri ?? null;
        return {
          key: inviteeUri || `${email}|${idx}`,
          email,
          name,
          status: String((inv as { status?: string }).status || 'active'),
          inviteeUri,
          eventUri,
        } as CalendlyInviteeLite;
      })
      .filter((inv): inv is CalendlyInviteeLite => Boolean(inv));
    const dateLabel = sessionLabelsFromStartIso(startTimeIso, durationMinutes);
    const shortDate = dateLabel?.date || sessionDateKey;
    byKey.set(key, {
      key,
      title,
      startTimeIso,
      sessionDateKey,
      durationMinutes,
      label: `${shortDate} · ${title} · ${formatDateTimeCanadaEastern(startTimeIso)}`,
      invitees,
    });
  }

  return [...byKey.values()].sort((a, b) => a.startTimeIso.localeCompare(b.startTimeIso));
}

function buildSessionManualMergeExtras(sessionStartIso?: string, durationMinutes = 30): Record<string, string> {
  const labels = sessionStartIso ? sessionLabelsFromStartIso(sessionStartIso, durationMinutes) : null;
  const sessionDate = labels?.date ?? '—';
  const sessionTime = labels?.time ?? '—';
  return {
    '{{Date}}': sessionDate,
    '{{sessionDate}}': sessionDate,
    '{{Time}}': sessionTime,
    '{{sessionTime}}': sessionTime,
  };
}

function buildWednesdayRunSnapshotRecipients(input: {
  session: WednesdaySessionOption;
  candidates: Candidate[];
  sentTracking: WednesdaySentTracking;
}): WednesdayCampaignRunSnapshotRecipientInput[] {
  const candidatesByEmail = new Map<string, Candidate>();
  for (const candidate of input.candidates) {
    const key = normalizeEmail(candidate.email);
    if (!key || candidatesByEmail.has(key)) continue;
    candidatesByEmail.set(key, candidate);
  }

  const recipients: WednesdayCampaignRunSnapshotRecipientInput[] = [];
  const seen = new Set<string>();
  for (const invitee of input.session.invitees) {
    const email = normalizeEmail(invitee.email);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    const candidate = candidatesByEmail.get(email) ?? null;
    const candidateId = candidate?.id ?? null;
    const deduped =
      input.sentTracking.recipientEmails.has(email) ||
      (candidateId ? input.sentTracking.candidateIds.has(candidateId) : false);
    recipients.push({
      recipientKey: invitee.key || email,
      inviteeName: invitee.name || '(No name)',
      inviteeEmail: email,
      inviteeStatus: invitee.status || 'active',
      selected: !deduped,
      sendStatus: deduped ? 'skipped' : 'pending',
      candidateId,
      errorMessage: deduped ? 'Skipped by dedupe (already sent in prior Wednesday run).' : null,
      inviteeUri: invitee.inviteeUri,
      eventUri: invitee.eventUri,
    });
  }
  return recipients;
}

const EmailLog: React.FC = () => {
  const isAuthenticated = useStaffAuthenticated();
  const [email, setEmail] = useState('admin@globelife-paz.com');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [rows, setRows] = useState<EmailSendLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<EmailLogCategory | 'all'>('all');
  const [modeFilter, setModeFilter] = useState<EmailLogMode | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'sent' | 'failed'>('all');
  const [candidateRows, setCandidateRows] = useState<Candidate[]>([]);
  const [campaignSourceLoading, setCampaignSourceLoading] = useState(false);
  const [campaignSourceError, setCampaignSourceError] = useState<string | null>(null);
  const [sessionOptions, setSessionOptions] = useState<WednesdaySessionOption[]>([]);
  const [selectedSessionKey, setSelectedSessionKey] = useState<string>('');
  const [selectedRecipientKeys, setSelectedRecipientKeys] = useState<Set<string>>(new Set());
  const [campaignSending, setCampaignSending] = useState(false);
  const [campaignProgress, setCampaignProgress] = useState<{ current: number; total: number } | null>(null);
  const [campaignError, setCampaignError] = useState<string | null>(null);
  const [campaignResult, setCampaignResult] = useState<WednesdaySendResult | null>(null);
  const [campaignPersistenceError, setCampaignPersistenceError] = useState<string | null>(null);
  const [currentCampaignRunId, setCurrentCampaignRunId] = useState<string | null>(null);
  const [currentCampaignRunSessionKey, setCurrentCampaignRunSessionKey] = useState<string | null>(null);
  const [previousRuns, setPreviousRuns] = useState<WednesdayCampaignRunWithRecipients[]>([]);
  const [previousRunsLoading, setPreviousRunsLoading] = useState(false);
  const [previousRunsError, setPreviousRunsError] = useState<string | null>(null);
  const [previousRunsStorageReady, setPreviousRunsStorageReady] = useState(true);
  const [selectedPreviousRunId, setSelectedPreviousRunId] = useState<string>('');
  const [wednesdaySentCandidateIds, setWednesdaySentCandidateIds] = useState<Set<string>>(new Set());
  const [wednesdaySentEmails, setWednesdaySentEmails] = useState<Set<string>>(new Set());
  const [sentTrackingReady, setSentTrackingReady] = useState(false);
  const [campaignSubjectDraft, setCampaignSubjectDraft] = useState(WEDNESDAY_REMINDER_SUBJECT_DEFAULT);
  const [campaignBodyDraft, setCampaignBodyDraft] = useState(WEDNESDAY_REMINDER_BODY_DEFAULT);
  const selectedSessionKeyRef = useRef('');

  useEffect(() => {
    void supabase.auth.getSession().then(({ data: s }) => {
      if (s.session) setIsAuthenticated(true);
    });
  }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    setLoading(true);
    const { data, error } = await supabase
      .from('email_send_logs')
      .select(
        'id, created_at, source, trigger_label, from_email, to_email, cc_email, subject, candidate_id, sent_by_user_id, status, error_message, metadata'
      )
      .order('created_at', { ascending: false })
      .limit(2500);
    setLoading(false);
    if (error) {
      setRows([]);
      const msg = error.message || 'Failed to load.';
      const code = (error as { code?: string }).code;
      const missingEmailLogs =
        code === 'PGRST205' ||
        (/relation|does not exist|schema cache/i.test(msg) && /email_send_logs/i.test(msg));
      setLoadError(
        missingEmailLogs
          ? 'The email_send_logs table is not visible to the API (often a 404 / PGRST205). In the Supabase SQL editor for this project, run the repo migration that creates public.email_send_logs and its "authenticated users can read email send logs" policy, then refresh the app.'
          : msg
      );
      return;
    }
    setRows((data as EmailSendLogRow[]) ?? []);
  }, []);

  useEffect(() => {
    if (isAuthenticated) void load();
  }, [isAuthenticated, load]);

  useEffect(() => {
    selectedSessionKeyRef.current = selectedSessionKey;
  }, [selectedSessionKey]);

  const loadPreviousRuns = useCallback(async (preferredRunId?: string) => {
    setPreviousRunsError(null);
    setPreviousRunsLoading(true);
    try {
      const runs = await listWednesdayCampaignRuns(60);
      setPreviousRunsStorageReady(true);
      setPreviousRuns(runs);
      setSelectedPreviousRunId((prev) => {
        const target = preferredRunId || prev;
        if (target && runs.some((r) => r.run.id === target)) return target;
        return runs[0]?.run.id || '';
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load previous runs.';
      if (/not set up on this Supabase project/i.test(msg)) {
        setPreviousRunsStorageReady(false);
        setPreviousRuns([]);
        setPreviousRunsError(null);
      } else {
        setPreviousRunsError(msg);
      }
    } finally {
      setPreviousRunsLoading(false);
    }
  }, []);

  const getFreshAccessToken = useCallback(async (): Promise<string | null> => {
    const { data: s } = await supabase.auth.getSession();
    if (s.session?.access_token) return s.session.access_token;
    const { data: refreshed, error } = await supabase.auth.refreshSession();
    if (error) return null;
    return refreshed.session?.access_token ?? null;
  }, []);

  const loadWednesdaySentTracking = useCallback(async (): Promise<{
    candidateIds: Set<string>;
    recipientEmails: Set<string>;
  }> => {
    const sentCandidateIds = new Set<string>();
    const sentRecipientEmails = new Set<string>();
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from('email_send_logs')
        .select('candidate_id, to_email')
        .eq('trigger_label', WEDNESDAY_MANUAL_TRIGGER)
        .eq('status', 'sent')
        .order('created_at', { ascending: false })
        .range(from, from + EMAIL_SEND_LOGS_PAGE_SIZE - 1);

      if (error) {
        throw error;
      }

      const page =
        (data as Array<{ candidate_id: string | null; to_email: string | null }> | null) ?? [];
      for (const row of page) {
        if (row.candidate_id) {
          sentCandidateIds.add(row.candidate_id);
        }
        const recipientEmail = parseFirstEmailAddress(row.to_email);
        if (recipientEmail) {
          sentRecipientEmails.add(recipientEmail);
        }
      }

      if (page.length < EMAIL_SEND_LOGS_PAGE_SIZE) break;
      from += EMAIL_SEND_LOGS_PAGE_SIZE;
    }

    return { candidateIds: sentCandidateIds, recipientEmails: sentRecipientEmails };
  }, []);

  const loadCampaignRecipients = useCallback(async (sync: boolean = false) => {
    setCampaignSourceError(null);
    setCampaignSourceLoading(true);
    setSentTrackingReady(false);
    try {
      const [allCandidates, sentTracking] = await Promise.all([getCandidates(), loadWednesdaySentTracking()]);
      const token = await getFreshAccessToken();
      if (!token) {
        throw new Error('Your session expired. Please sign in again.');
      }
      const dashboard = await fetchLiveSessionsDashboard(token, sync ? { sync: true } : undefined);
      if (!dashboard.ok) {
        throw new Error(dashboard.error || 'Failed to load Calendly sessions.');
      }

      const rowsCombined: Array<PastMeetingRow | UpcomingMeetingRow> = [
        ...dashboard.data.upcoming_meetings,
        ...dashboard.data.past_meetings,
      ];
      const nextSessionOptions = deriveSessionOptions(rowsCombined);
      const selectedKeyFromState = selectedSessionKeyRef.current;
      const resolvedSelectedKey =
        selectedKeyFromState && nextSessionOptions.some((option) => option.key === selectedKeyFromState)
          ? selectedKeyFromState
          : nextSessionOptions[0]?.key || '';
      const selectedOptionForRun = nextSessionOptions.find((option) => option.key === resolvedSelectedKey) || null;

      setCandidateRows(allCandidates);
      setSessionOptions(nextSessionOptions);
      setSentTrackingReady(true);
      setWednesdaySentCandidateIds(sentTracking.candidateIds);
      setWednesdaySentEmails(sentTracking.recipientEmails);
      setSelectedSessionKey(resolvedSelectedKey);

      if (selectedOptionForRun) {
        try {
          const snapshotRecipients = buildWednesdayRunSnapshotRecipients({
            session: selectedOptionForRun,
            candidates: allCandidates,
            sentTracking,
          });
          const run = await createWednesdayCampaignRunSnapshot({
            sessionTitle: selectedOptionForRun.title,
            sessionStartAt: selectedOptionForRun.startTimeIso,
            sessionLabel: selectedOptionForRun.label,
            source: sync ? 'email_log_manual_fetch' : 'email_log_autoload',
            recipients: snapshotRecipients,
            metadata: {
              session_key: selectedOptionForRun.key,
              invitees_raw_count: selectedOptionForRun.invitees.length,
            },
          });
          setCurrentCampaignRunId(run.id);
          setCurrentCampaignRunSessionKey(selectedOptionForRun.key);
          setCampaignPersistenceError(null);
          void loadPreviousRuns(run.id);
        } catch (persistErr) {
          setCurrentCampaignRunId(null);
          setCurrentCampaignRunSessionKey(null);
          setCampaignPersistenceError(
            persistErr instanceof Error
              ? `Fetched invitees but could not persist run snapshot: ${persistErr.message}`
              : 'Fetched invitees but could not persist run snapshot.'
          );
        }
      } else {
        setCurrentCampaignRunId(null);
        setCurrentCampaignRunSessionKey(null);
      }
    } catch (err) {
      setSessionOptions([]);
      setSelectedSessionKey('');
      setCurrentCampaignRunId(null);
      setCurrentCampaignRunSessionKey(null);
      setWednesdaySentCandidateIds(new Set());
      setWednesdaySentEmails(new Set());
      setSentTrackingReady(false);
      setCampaignSourceError(err instanceof Error ? err.message : 'Failed to load session invitees.');
    } finally {
      setCampaignSourceLoading(false);
    }
  }, [getFreshAccessToken, loadPreviousRuns, loadWednesdaySentTracking]);

  useEffect(() => {
    if (isAuthenticated) void loadCampaignRecipients(false);
  }, [isAuthenticated, loadCampaignRecipients]);

  useEffect(() => {
    if (isAuthenticated) void loadPreviousRuns();
  }, [isAuthenticated, loadPreviousRuns]);

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
    const { error } = await signInWithGoogle('/email-log');
    if (error) setAuthError(error);
    setGoogleLoading(false);
  };

  const enriched = useMemo(
    () => rows.map((r) => ({ row: r, ...categorizeEmailLog(r) })),
    [rows],
  );

  const summary = useMemo(() => {
    const leadership = enriched.filter((e) => e.category === 'leadership_assessment');
    return {
      total: enriched.length,
      leadership: leadership.length,
      leadershipSent: leadership.filter((e) => e.row.status === 'sent').length,
      leadershipAuto: leadership.filter((e) => e.mode === 'auto').length,
      failed: enriched.filter((e) => e.row.status === 'failed').length,
    };
  }, [enriched]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enriched.filter((e) => {
      if (categoryFilter !== 'all' && e.category !== categoryFilter) return false;
      if (modeFilter !== 'all' && e.mode !== modeFilter) return false;
      if (statusFilter !== 'all' && e.row.status !== statusFilter) return false;
      if (!q) return true;
      const hay = [
        e.row.from_email,
        e.row.to_email,
        e.row.cc_email ?? '',
        e.row.subject,
        e.row.source,
        e.row.trigger_label ?? '',
        e.row.candidate_id ?? '',
        e.row.sent_by_user_id ?? '',
        e.row.status,
        e.row.error_message ?? '',
        e.categoryLabel,
        e.modeLabel,
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [enriched, search, categoryFilter, modeFilter, statusFilter]);

  const selectedSession = useMemo(
    () => sessionOptions.find((option) => option.key === selectedSessionKey) || null,
    [sessionOptions, selectedSessionKey]
  );

  const selectedPreviousRun = useMemo(
    () => previousRuns.find((entry) => entry.run.id === selectedPreviousRunId) || null,
    [previousRuns, selectedPreviousRunId]
  );

  const candidatesByEmail = useMemo(() => {
    const map = new Map<string, Candidate>();
    for (const candidate of candidateRows) {
      const key = normalizeEmail(candidate.email);
      if (!key || map.has(key)) continue;
      map.set(key, candidate);
    }
    return map;
  }, [candidateRows]);

  const recipientRows = useMemo<WednesdayCampaignRecipient[]>(() => {
    const seen = new Set<string>();
    const rowsOut: WednesdayCampaignRecipient[] = [];
    for (const invitee of selectedSession?.invitees ?? []) {
      const emailKey = normalizeEmail(invitee.email);
      if (!emailKey || seen.has(emailKey)) continue;
      seen.add(emailKey);

      const candidate = candidatesByEmail.get(emailKey) ?? null;
      const candidateId = candidate?.id ?? null;
      if (wednesdaySentEmails.has(emailKey)) continue;
      if (candidateId && wednesdaySentCandidateIds.has(candidateId)) continue;

      const nameForMerge = invitee.name || candidateName(candidate ?? { firstName: '', lastName: '' });
      const { firstName, lastName } = splitName(nameForMerge);
      rowsOut.push({
        key: invitee.key || `${emailKey}|${candidateId || 'invitee'}`,
        name: nameForMerge,
        email: emailKey,
        status: invitee.status,
        candidateId,
        mergeCandidate: {
          firstName: candidate?.firstName || firstName,
          lastName: candidate?.lastName || lastName,
          email: emailKey,
          phone: candidate?.phone || '',
        },
      });
    }
    return rowsOut.sort((a, b) => a.email.localeCompare(b.email));
  }, [candidatesByEmail, selectedSession, wednesdaySentCandidateIds, wednesdaySentEmails]);

  const excludedAlreadySentCount = useMemo(() => {
    const total = selectedSession?.invitees.length ?? 0;
    return Math.max(0, total - recipientRows.length);
  }, [selectedSession, recipientRows.length]);

  const recipientSelectionKey = useMemo(
    () => recipientRows.map((r) => r.key).join('|'),
    [recipientRows]
  );

  useEffect(() => {
    setSelectedRecipientKeys(new Set(recipientRows.map((r) => r.key)));
  }, [recipientSelectionKey]);

  const selectedRecipients = useMemo(
    () => recipientRows.filter((r) => selectedRecipientKeys.has(r.key)),
    [recipientRows, selectedRecipientKeys]
  );

  const previewRecipient = selectedRecipients[0] ?? recipientRows[0] ?? null;

  const previewEmail = useMemo(() => {
    const fallback = {
      firstName: 'Candidate',
      lastName: '',
      email: 'candidate@example.com',
      phone: '',
    };
    return mergeTemplate(
      campaignSubjectDraft,
      ensureEmailSignaturePlaceholder(campaignBodyDraft),
      previewRecipient?.mergeCandidate || fallback,
      buildSessionManualMergeExtras(selectedSession?.startTimeIso, selectedSession?.durationMinutes),
      { siteOrigin: getSiteOriginForEmail() }
    );
  }, [campaignBodyDraft, campaignSubjectDraft, previewRecipient, selectedSession?.startTimeIso]);

  const toggleRecipientSelection = (key: string) => {
    setSelectedRecipientKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAllRecipients = () => {
    setSelectedRecipientKeys(new Set(recipientRows.map((r) => r.key)));
  };

  const deselectAllRecipients = () => {
    setSelectedRecipientKeys(new Set());
  };

  const sendWednesdayCampaign = async () => {
    if (campaignSending) return;
    const draftSubject = campaignSubjectDraft.trim();
    if (!draftSubject) {
      setCampaignError('Subject is required.');
      return;
    }
    const draftBody = campaignBodyDraft.trim();
    if (!draftBody) {
      setCampaignError('Body is required.');
      return;
    }
    if (selectedRecipients.length === 0) {
      setCampaignError('Select at least one Calendly invitee.');
      return;
    }
    const { data: s } = await supabase.auth.getSession();
    const token = s.session?.access_token;
    if (!token) {
      setCampaignError('Your session expired. Please sign in again.');
      return;
    }

    setCampaignSending(true);
    setCampaignError(null);
    setCampaignResult(null);
    setCampaignProgress({ current: 0, total: selectedRecipients.length });

    let activeRunId: string | null = currentCampaignRunId;
    let runFetchedCount = selectedSession?.invitees.length ?? selectedRecipients.length;

    if (selectedSession) {
      const snapshotRecipients = buildWednesdayRunSnapshotRecipients({
        session: selectedSession,
        candidates: candidateRows,
        sentTracking: {
          candidateIds: wednesdaySentCandidateIds,
          recipientEmails: wednesdaySentEmails,
        },
      });
      runFetchedCount = snapshotRecipients.length;
      const runSessionMismatch = !activeRunId || currentCampaignRunSessionKey !== selectedSession.key;
      if (runSessionMismatch) {
        try {
          const run = await createWednesdayCampaignRunSnapshot({
            sessionTitle: selectedSession.title,
            sessionStartAt: selectedSession.startTimeIso,
            sessionLabel: selectedSession.label,
            source: 'email_log_send_autocreate',
            recipients: snapshotRecipients,
            metadata: {
              session_key: selectedSession.key,
              invitees_raw_count: selectedSession.invitees.length,
              reason: 'autocreated_before_send',
            },
          });
          activeRunId = run.id;
          setCurrentCampaignRunId(run.id);
          setCurrentCampaignRunSessionKey(selectedSession.key);
          setCampaignPersistenceError(null);
          void loadPreviousRuns(run.id);
        } catch (persistErr) {
          setCampaignPersistenceError(
            persistErr instanceof Error
              ? `Could not create persistent run before send: ${persistErr.message}`
              : 'Could not create persistent run before send.'
          );
          activeRunId = null;
        }
      }
    }

    if (activeRunId) {
      try {
        await prepareWednesdayCampaignRunForSend({
          runId: activeRunId,
          selectedRecipientKeys: selectedRecipients.map((recipient) => recipient.key),
        });
      } catch (prepareErr) {
        setCampaignPersistenceError(
          prepareErr instanceof Error
            ? `Emails are still sending, but failed to prepare run status persistence: ${prepareErr.message}`
            : 'Emails are still sending, but failed to prepare run status persistence.'
        );
      }
    }

    const resultRows: WednesdaySendResultRow[] = [];
    let sent = 0;
    let failed = 0;

    for (let i = 0; i < selectedRecipients.length; i += 1) {
      const recipient = selectedRecipients[i];
      setCampaignProgress({ current: i + 1, total: selectedRecipients.length });
      const merged = mergeTemplate(
        draftSubject,
        ensureEmailSignaturePlaceholder(draftBody),
        recipient.mergeCandidate,
        buildSessionManualMergeExtras(selectedSession?.startTimeIso, selectedSession?.durationMinutes),
        { siteOrigin: getSiteOriginForEmail() }
      );
      const response = await sendEmail(token, {
        to: recipient.email,
        subject: merged.subject,
        bodyHtml: merged.bodyHtml,
        trigger: WEDNESDAY_MANUAL_TRIGGER,
        candidateId: recipient.candidateId || undefined,
      });
      if ('ok' in response && response.ok) {
        sent += 1;
        setWednesdaySentEmails((prev) => {
          if (prev.has(recipient.email)) return prev;
          const next = new Set(prev);
          next.add(recipient.email);
          return next;
        });
        if (recipient.candidateId) {
          const candidateId = recipient.candidateId;
          setWednesdaySentCandidateIds((prev) => {
            if (prev.has(candidateId)) return prev;
            const next = new Set(prev);
            next.add(candidateId);
            return next;
          });
        }
        resultRows.push({
          recipientKey: recipient.key,
          candidateId: recipient.candidateId,
          recipientName: recipient.name,
          to: recipient.email,
          status: 'sent',
        });
        if (activeRunId) {
          try {
            await recordWednesdayCampaignRecipientSendResult({
              runId: activeRunId,
              recipientKey: recipient.key,
              inviteeEmail: recipient.email,
              sendStatus: 'sent',
              candidateId: recipient.candidateId,
            });
          } catch (persistErr) {
            setCampaignPersistenceError(
              persistErr instanceof Error
                ? `Email sent but result persistence failed for ${recipient.email}: ${persistErr.message}`
                : `Email sent but result persistence failed for ${recipient.email}.`
            );
          }
        }
      } else {
        failed += 1;
        const errorMessage = ('error' in response ? response.error : '') || 'Failed to send email.';
        resultRows.push({
          recipientKey: recipient.key,
          candidateId: recipient.candidateId,
          recipientName: recipient.name,
          to: recipient.email,
          status: 'failed',
          error: errorMessage,
        });
        if (activeRunId) {
          try {
            await recordWednesdayCampaignRecipientSendResult({
              runId: activeRunId,
              recipientKey: recipient.key,
              inviteeEmail: recipient.email,
              sendStatus: 'failed',
              candidateId: recipient.candidateId,
              errorMessage,
            });
          } catch (persistErr) {
            setCampaignPersistenceError(
              persistErr instanceof Error
                ? `Failed-send persistence issue for ${recipient.email}: ${persistErr.message}`
                : `Failed-send persistence issue for ${recipient.email}.`
            );
          }
        }
      }
      if (i < selectedRecipients.length - 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 150));
      }
    }

    setCampaignSending(false);
    setCampaignProgress(null);
    setCampaignResult({
      attempted: selectedRecipients.length,
      sent,
      failed,
      completedAt: new Date().toISOString(),
      rows: resultRows,
    });
    if (activeRunId) {
      const skippedCount = Math.max(0, runFetchedCount - selectedRecipients.length);
      try {
        await finalizeWednesdayCampaignRunCounts({
          runId: activeRunId,
          selectedCount: selectedRecipients.length,
          sentCount: sent,
          failedCount: failed,
          skippedCount,
        });
        void loadPreviousRuns(activeRunId);
      } catch (persistErr) {
        setCampaignPersistenceError(
          persistErr instanceof Error
            ? `Send completed, but failed to finalize persisted run counts: ${persistErr.message}`
            : 'Send completed, but failed to finalize persisted run counts.'
        );
      }
    }
    void Promise.all([load(), loadCampaignRecipients(false), loadPreviousRuns(activeRunId || undefined)]);
  };

  const downloadCsv = () => {
    const header = [
      'When (UTC raw)',
      'When (display)',
      'From',
      'To',
      'CC',
      'Subject',
      'Category',
      'Mode',
      'Source',
      'Trigger',
      'Candidate ID',
      'Sent by user ID',
      'Status',
      'Error',
    ];
    const lines = [
      header.map(csvEscape).join(','),
      ...filtered.map(({ row: r, categoryLabel, modeLabel }) =>
        [
          r.created_at,
          formatDateTimeCanadaEastern(r.created_at),
          r.from_email,
          r.to_email,
          r.cc_email ?? '',
          r.subject,
          categoryLabel,
          modeLabel,
          r.source,
          r.trigger_label ?? '',
          r.candidate_id ?? '',
          r.sent_by_user_id ?? '',
          r.status,
          r.error_message ?? '',
        ]
          .map((c) => csvEscape(String(c)))
          .join(',')
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `email-send-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };


  return (
      <div className="w-full p-5 lg:p-6 space-y-5 text-[#1A2942]">
        <div className="rounded-2xl border border-[#d6deea] bg-white shadow-sm px-5 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-xl bg-[#005EB8]/10 flex items-center justify-center shrink-0">
              <Mail size={20} className="text-[#005EB8]" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-[#0B1B34] truncate">Email send log</h1>
              <p className="text-sm text-[#5c6b82]">
                Outbound mail from CRM and automations — search by address, subject, trigger, or candidate.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" onClick={() => void load()} disabled={loading}>
              <RefreshCw size={16} className={loading ? 'animate-spin inline mr-1.5' : 'inline mr-1.5'} />
              Refresh
            </Button>
            <Button type="button" variant="secondary" data-tour="email-log-export" onClick={downloadCsv} disabled={filtered.length === 0}>
              <Download size={16} className="inline mr-1.5" />
              Export CSV
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="rounded-xl border border-[#d6deea] bg-white p-3">
            <p className="text-[10px] uppercase tracking-wide text-[#7a8ba1]">Total logged</p>
            <p className="text-xl font-bold text-[#0B1B34]">{summary.total}</p>
          </div>
          <div className="rounded-xl border border-[#d6deea] bg-white p-3">
            <p className="text-[10px] uppercase tracking-wide text-[#7a8ba1]">Leadership assessment</p>
            <p className="text-xl font-bold text-[#005EB8]">{summary.leadership}</p>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
            <p className="text-[10px] uppercase tracking-wide text-emerald-800">Assessment sent</p>
            <p className="text-xl font-bold text-emerald-900">{summary.leadershipSent}</p>
          </div>
          <div className="rounded-xl border border-[#d6deea] bg-white p-3">
            <p className="text-[10px] uppercase tracking-wide text-[#7a8ba1]">Auto-sent</p>
            <p className="text-xl font-bold text-[#0B1B34]">{summary.leadershipAuto}</p>
          </div>
          <div className="rounded-xl border border-red-200 bg-red-50/40 p-3">
            <p className="text-[10px] uppercase tracking-wide text-red-800">Failed</p>
            <p className="text-xl font-bold text-red-900">{summary.failed}</p>
          </div>
        </div>

        <div className="rounded-2xl border border-[#d6deea] bg-white shadow-sm p-4 flex flex-col gap-3" data-tour="email-log-search">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a9ab0]" size={18} />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search to, from, subject, trigger, source, candidate ID…"
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-[#cfe3f9] text-sm text-[#0B1B34] focus:outline-none focus:ring-2 focus:ring-[#005EB8]/30"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as EmailLogCategory | 'all')}
              className="rounded-lg border border-[#cfe3f9] px-2.5 py-1.5 text-sm"
            >
              <option value="all">All categories</option>
              <option value="leadership_assessment">Leadership assessment</option>
              <option value="wednesday_live">Wednesday live</option>
              <option value="pipeline_crm">CRM / pipeline</option>
              <option value="reminder">Reminders</option>
              <option value="other">Other</option>
            </select>
            <select
              value={modeFilter}
              onChange={(e) => setModeFilter(e.target.value as EmailLogMode | 'all')}
              className="rounded-lg border border-[#cfe3f9] px-2.5 py-1.5 text-sm"
            >
              <option value="all">Auto + manual</option>
              <option value="auto">Automated only</option>
              <option value="manual">Manual only</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | 'sent' | 'failed')}
              className="rounded-lg border border-[#cfe3f9] px-2.5 py-1.5 text-sm"
            >
              <option value="all">All statuses</option>
              <option value="sent">Sent</option>
              <option value="failed">Failed</option>
            </select>
            <span className="text-[#5c6b82] shrink-0">
              Showing <strong>{filtered.length}</strong> of {rows.length} loaded
            </span>
          </div>
        </div>

        <div className="rounded-2xl border border-[#d6deea] bg-white shadow-sm p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-[#0B1B34]">Wednesday Live Overview Send</h2>
              <p className="text-sm text-[#5c6b82]">
                Manual campaign: fetch Calendly invitees and choose which session date to use in reminder emails.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => void loadCampaignRecipients(true)}
                disabled={campaignSourceLoading || campaignSending}
              >
                <RefreshCw size={16} className={campaignSourceLoading ? 'animate-spin inline mr-1.5' : 'inline mr-1.5'} />
                Fetch Calendly sessions
              </Button>
            </div>
          </div>

          {campaignSourceError && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-sm px-4 py-3">{campaignSourceError}</div>
          )}

          {campaignPersistenceError && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-sm px-4 py-3">
              {campaignPersistenceError}
            </div>
          )}

          {!campaignSourceError && sessionOptions.length === 0 && !campaignSourceLoading && (
            <div className="rounded-xl border border-[#d6deea] bg-[#f8fbff] text-[#334155] text-sm px-4 py-3">
              No matching Calendly sessions found for &quot;{TARGET_SESSION_TITLE}&quot; in the next {SESSION_PICKER_FUTURE_DAYS} days.
            </div>
          )}

          {sessionOptions.length > 0 && (
            <div className="rounded-xl border border-[#d6deea] p-3 bg-[#fcfdff] space-y-2">
              <div className="text-xs font-semibold text-[#5c6b82]">Session date (Calendly occurrence)</div>
              <select
                value={selectedSessionKey}
                onChange={(e) => setSelectedSessionKey(e.target.value)}
                disabled={campaignSending}
                className="w-full px-3 py-2 rounded-lg border border-[#cfe3f9] bg-white text-sm text-[#0B1B34] focus:outline-none focus:ring-2 focus:ring-[#005EB8]/25"
              >
                {sessionOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
              {sessionOptions.length > 1 && (
                <div className="text-xs text-[#6f7b8d]">
                  Multiple close matches found. Select the exact occurrence to message.
                </div>
              )}
            </div>
          )}

          {previousRunsStorageReady && (
          <div className="rounded-xl border border-[#d6deea] p-3 bg-[#fcfdff] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-semibold text-[#5c6b82]">Previous runs</div>
                <div className="text-xs text-[#6f7b8d]">Each fetch and send is persisted with recipient-level history.</div>
              </div>
              <Button type="button" variant="secondary" onClick={() => void loadPreviousRuns()} disabled={previousRunsLoading || campaignSending}>
                <RefreshCw size={14} className={previousRunsLoading ? 'animate-spin inline mr-1.5' : 'inline mr-1.5'} />
                Refresh runs
              </Button>
            </div>
            {previousRunsError && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-900 text-xs px-3 py-2">{previousRunsError}</div>
            )}
            <select
              value={selectedPreviousRunId}
              onChange={(e) => setSelectedPreviousRunId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[#cfe3f9] bg-white text-sm text-[#0B1B34] focus:outline-none focus:ring-2 focus:ring-[#005EB8]/25"
              disabled={previousRunsLoading || previousRuns.length === 0}
            >
              {previousRuns.length === 0 ? (
                <option value="">No saved runs yet</option>
              ) : (
                previousRuns.map(({ run }) => (
                  <option key={run.id} value={run.id}>
                    {formatDateTimeCanadaEastern(run.created_at)} - {run.session_label} - fetched {run.fetched_invitee_count}, sent {run.sent_count}, failed {run.failed_count}, skipped {run.skipped_count}
                  </option>
                ))
              )}
            </select>
            {selectedPreviousRun && (
              <details className="rounded-lg border border-[#d6deea] bg-white" open>
                <summary className="cursor-pointer px-3 py-2 text-xs text-[#334155]">
                  Run details: {formatDateTimeCanadaEastern(selectedPreviousRun.run.created_at)} - {selectedPreviousRun.run.session_label}
                </summary>
                <div className="px-3 pb-3 space-y-2">
                  <div className="text-xs text-[#5c6b82]">
                    Trigger: {selectedPreviousRun.run.trigger_label} · Fetched: <strong>{selectedPreviousRun.run.fetched_invitee_count}</strong> · Selected:{' '}
                    <strong>{selectedPreviousRun.run.selected_count}</strong> · Sent: <strong className="text-emerald-700">{selectedPreviousRun.run.sent_count}</strong> · Failed:{' '}
                    <strong className="text-red-700">{selectedPreviousRun.run.failed_count}</strong> · Skipped: <strong>{selectedPreviousRun.run.skipped_count}</strong>
                  </div>
                  <div className="max-h-56 overflow-auto rounded border border-[#e5eaf3]">
                    <table className="min-w-full text-left text-xs border-collapse">
                      <thead className="sticky top-0 z-10 bg-[#eef2f7] text-[#0B1B34] font-semibold border-b border-[#d6deea]">
                        <tr>
                          <th className="px-2 py-2 border-r border-[#d6deea]">Invitee</th>
                          <th className="px-2 py-2 border-r border-[#d6deea]">Email</th>
                          <th className="px-2 py-2 border-r border-[#d6deea]">Selected</th>
                          <th className="px-2 py-2 border-r border-[#d6deea]">Send status</th>
                          <th className="px-2 py-2 border-r border-[#d6deea]">Email log</th>
                          <th className="px-2 py-2">Error</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedPreviousRun.recipients.map((recipient) => (
                          <tr key={recipient.id} className="border-b border-[#e8edf4] align-top">
                            <td className="px-2 py-1.5 border-r border-[#eef2f7]">{recipient.invitee_name}</td>
                            <td className="px-2 py-1.5 border-r border-[#eef2f7] break-all">{recipient.invitee_email}</td>
                            <td className="px-2 py-1.5 border-r border-[#eef2f7]">{recipient.selected ? 'yes' : 'no'}</td>
                            <td className="px-2 py-1.5 border-r border-[#eef2f7]">{recipient.send_status}</td>
                            <td className="px-2 py-1.5 border-r border-[#eef2f7] break-all">{recipient.email_send_log_id || '—'}</td>
                            <td className="px-2 py-1.5 text-red-700">{recipient.error_message || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </details>
            )}
          </div>
          )}

          <div className="rounded-xl border border-[#d6deea] overflow-hidden">
            <div className="px-4 py-3 bg-[#f8fbff] border-b border-[#d6deea] flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm text-[#334155]">
                Invitees fetched: <strong>{selectedSession?.invitees.length ?? 0}</strong> · Already sent (deduped):{' '}
                <strong>{excludedAlreadySentCount}</strong> · Selected: <strong>{selectedRecipients.length}</strong>
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" variant="secondary" onClick={selectAllRecipients} disabled={recipientRows.length === 0 || campaignSending}>
                  Select all
                </Button>
                <Button type="button" variant="secondary" onClick={deselectAllRecipients} disabled={selectedRecipients.length === 0 || campaignSending}>
                  Deselect all
                </Button>
              </div>
            </div>
            <div className="max-h-64 overflow-auto">
              <table className="min-w-full text-left text-xs border-collapse">
                <thead className="sticky top-0 z-10 bg-[#eef2f7] text-[#0B1B34] font-semibold border-b border-[#d6deea]">
                  <tr>
                    <th className="px-3 py-2 border-r border-[#d6deea] w-10">Sel</th>
                    <th className="px-3 py-2 border-r border-[#d6deea]">Invitee</th>
                    <th className="px-3 py-2 border-r border-[#d6deea]">Email</th>
                    <th className="px-3 py-2 border-r border-[#d6deea]">Status</th>
                    <th className="px-3 py-2 whitespace-nowrap">Candidate ID</th>
                  </tr>
                </thead>
                <tbody className="text-[12px] text-[#1A2942]">
                  {recipientRows.map((recipient) => {
                    const checked = selectedRecipientKeys.has(recipient.key);
                    return (
                      <tr key={recipient.key} className="border-b border-[#e8edf4] hover:bg-[#f8fafc]">
                        <td className="px-3 py-2 border-r border-[#eef2f7]">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleRecipientSelection(recipient.key)}
                            disabled={campaignSending}
                            className="h-4 w-4 rounded border-[#b8c8df] text-[#005EB8] focus:ring-[#005EB8]/30"
                          />
                        </td>
                        <td className="px-3 py-2 border-r border-[#eef2f7]">{recipient.name}</td>
                        <td className="px-3 py-2 border-r border-[#eef2f7] break-all">{recipient.email}</td>
                        <td className="px-3 py-2 border-r border-[#eef2f7]">{recipient.status}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{recipient.candidateId || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!campaignSourceLoading && recipientRows.length === 0 && (
                <div className="p-6 text-center text-sm text-[#6f7b8d]">
                  {selectedSession
                    ? 'No unsent invitees available for this session.'
                    : 'Fetch Calendly sessions to load invitees.'}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-[#d6deea] p-4 bg-[#fcfdff] space-y-3">
            <div className="text-sm text-[#334155]">
              <strong>Reminder draft preview:</strong> Wednesday Live Overview manual campaign
              {previewRecipient ? ` · Previewing ${previewRecipient.name}` : ''}
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#5c6b82] mb-1">Subject</label>
              <input
                type="text"
                value={campaignSubjectDraft}
                onChange={(e) => setCampaignSubjectDraft(e.target.value)}
                disabled={campaignSending}
                className="w-full px-3 py-2 rounded-lg border border-[#cfe3f9] bg-white text-sm text-[#0B1B34] focus:outline-none focus:ring-2 focus:ring-[#005EB8]/25"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#5c6b82] mb-1">Body HTML (editable)</label>
              <textarea
                value={campaignBodyDraft}
                onChange={(e) => setCampaignBodyDraft(e.target.value)}
                disabled={campaignSending}
                rows={8}
                className="w-full px-3 py-2 rounded-lg border border-[#cfe3f9] bg-white text-sm text-[#0B1B34] font-mono focus:outline-none focus:ring-2 focus:ring-[#005EB8]/25"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#5c6b82] mb-1">Body preview (rendered)</label>
              <div
                className="rounded-lg border border-[#cfe3f9] bg-white p-4 text-sm text-[#1A2942] max-h-56 overflow-auto prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{ __html: previewEmail?.bodyHtml || '<p class="text-gray-400">No preview available.</p>' }}
              />
            </div>
          </div>

          {campaignError && (
            <div className="rounded-xl border border-red-200 bg-red-50 text-red-800 text-sm px-4 py-3">{campaignError}</div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-[#5c6b82]">
              {campaignProgress
                ? `Sending ${campaignProgress.current} / ${campaignProgress.total}...`
                : 'Bulk send runs sequentially to reduce provider spikes.'}
            </div>
            <Button
              type="button"
              onClick={() => void sendWednesdayCampaign()}
              disabled={
                campaignSending ||
                campaignSourceLoading ||
                selectedRecipients.length === 0 ||
                !campaignSubjectDraft.trim() ||
                !campaignBodyDraft.trim() ||
                !sentTrackingReady
              }
            >
              {campaignSending ? 'Sending...' : `Send to selected (${selectedRecipients.length})`}
            </Button>
          </div>

          {campaignResult && (
            <div className="rounded-xl border border-[#d6deea] overflow-hidden">
              <div className="px-4 py-3 bg-[#f8fbff] border-b border-[#d6deea] text-sm text-[#334155]">
                Run completed {formatDateTimeCanadaEastern(campaignResult.completedAt)} · Attempted <strong>{campaignResult.attempted}</strong> · Sent{' '}
                <strong className="text-emerald-700">{campaignResult.sent}</strong> · Failed{' '}
                <strong className="text-red-700">{campaignResult.failed}</strong>
              </div>
              <div className="max-h-56 overflow-auto">
                <table className="min-w-full text-left text-xs border-collapse">
                  <thead className="sticky top-0 z-10 bg-[#eef2f7] text-[#0B1B34] font-semibold border-b border-[#d6deea]">
                    <tr>
                      <th className="px-3 py-2 border-r border-[#d6deea]">Recipient</th>
                      <th className="px-3 py-2 border-r border-[#d6deea]">Candidate</th>
                      <th className="px-3 py-2 border-r border-[#d6deea]">Status</th>
                      <th className="px-3 py-2">Error</th>
                    </tr>
                  </thead>
                  <tbody className="text-[12px] text-[#1A2942]">
                    {campaignResult.rows.map((r) => (
                      <tr key={`${r.recipientKey}-${r.to}`} className="border-b border-[#e8edf4] hover:bg-[#f8fafc] align-top">
                        <td className="px-3 py-2 border-r border-[#eef2f7] break-all">{r.to}</td>
                        <td className="px-3 py-2 border-r border-[#eef2f7]">{r.recipientName}</td>
                        <td className="px-3 py-2 border-r border-[#eef2f7]">
                          <span className={r.status === 'failed' ? 'text-red-700 font-semibold' : 'text-emerald-700 font-semibold'}>
                            {r.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-red-700">{r.error || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {loadError && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-sm px-4 py-3">{loadError}</div>
        )}

        <div className="rounded-2xl border border-[#d6deea] bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto max-h-[calc(100vh-280px)] overflow-y-auto">
            <table className="min-w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 z-10 bg-[#eef2f7] text-[#0B1B34] font-semibold border-b border-[#d6deea]">
                <tr>
                  <th className="px-2 py-2 border-r border-[#d6deea] whitespace-nowrap">When</th>
                  <th className="px-2 py-2 border-r border-[#d6deea] whitespace-nowrap">From</th>
                  <th className="px-2 py-2 border-r border-[#d6deea] whitespace-nowrap">To</th>
                  <th className="px-2 py-2 border-r border-[#d6deea] whitespace-nowrap">CC</th>
                  <th className="px-2 py-2 border-r border-[#d6deea] min-w-[140px]">Subject</th>
                  <th className="px-2 py-2 border-r border-[#d6deea] whitespace-nowrap">Category</th>
                  <th className="px-2 py-2 border-r border-[#d6deea] whitespace-nowrap">Mode</th>
                  <th className="px-2 py-2 border-r border-[#d6deea] whitespace-nowrap">Source</th>
                  <th className="px-2 py-2 border-r border-[#d6deea] whitespace-nowrap">Trigger</th>
                  <th className="px-2 py-2 border-r border-[#d6deea] whitespace-nowrap">Candidate</th>
                  <th className="px-2 py-2 border-r border-[#d6deea] whitespace-nowrap">Sent by</th>
                  <th className="px-2 py-2 whitespace-nowrap">Status</th>
                </tr>
              </thead>
              <tbody className="font-mono text-[11px] text-[#1A2942]">
                {filtered.map(({ row: r, categoryLabel, modeLabel }) => (
                  <tr key={r.id} className="border-b border-[#e8edf4] hover:bg-[#f8fafc] align-top">
                    <td className="px-2 py-1.5 border-r border-[#eef2f7] whitespace-nowrap text-[#334155]">
                      {formatDateTimeCanadaEastern(r.created_at)}
                    </td>
                    <td className="px-2 py-1.5 border-r border-[#eef2f7] max-w-[200px] break-all">{r.from_email}</td>
                    <td className="px-2 py-1.5 border-r border-[#eef2f7] max-w-[220px] break-all">{r.to_email}</td>
                    <td className="px-2 py-1.5 border-r border-[#eef2f7] max-w-[160px] break-all">{r.cc_email || '—'}</td>
                    <td className="px-2 py-1.5 border-r border-[#eef2f7] max-w-[280px] break-words">{r.subject}</td>
                    <td className="px-2 py-1.5 border-r border-[#eef2f7] whitespace-nowrap font-sans text-[10px]">{categoryLabel}</td>
                    <td className="px-2 py-1.5 border-r border-[#eef2f7] whitespace-nowrap font-sans text-[10px]">{modeLabel}</td>
                    <td className="px-2 py-1.5 border-r border-[#eef2f7] whitespace-nowrap">{r.source}</td>
                    <td className="px-2 py-1.5 border-r border-[#eef2f7] max-w-[200px] break-words">
                      {r.trigger_label || '—'}
                    </td>
                    <td className="px-2 py-1.5 border-r border-[#eef2f7] break-all max-w-[120px]">{r.candidate_id || '—'}</td>
                    <td className="px-2 py-1.5 border-r border-[#eef2f7] break-all max-w-[120px]">{r.sent_by_user_id || '—'}</td>
                    <td className="px-2 py-1.5">
                      <span
                        className={
                          r.status === 'failed' ? 'text-red-700 font-semibold' : 'text-emerald-800'
                        }
                      >
                        {r.status}
                      </span>
                      {r.error_message ? (
                        <div className="text-red-600 font-sans normal-case mt-0.5 max-w-[240px]">{r.error_message}</div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && filtered.length === 0 && !loadError && (
              <div className="p-8 text-center text-sm text-[#6f7b8d]">No rows match your search, or the log is empty.</div>
            )}
          </div>
        </div>
      </div>
  );
};

export default EmailLog;
