import React from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, ExternalLink, Phone, RefreshCw, Settings, Video } from 'lucide-react';
import CandidateResumeDetailsCard from '../components/pipeline/CandidateResumeDetailsCard';
import PipelineAuthShell from '../components/PipelineAuthShell';
import { Button } from '../components/UI';
import {
  stringifySupabaseError,
  getPipelineUserCallSettings,
  isPipelinePhoneInputClean,
  listPipelineCallRecords,
  listPipelineManualCandidates,
  listPipelineResumesForCandidates,
  logPipelineCallAction,
  normalizeDialDestination,
  readCallRecordMeta,
  readPipelineCandidateEmail,
  readPipelineCandidatePhone,
  savePipelineCallDisposition,
  savePipelineCandidateEmailOverride,
  savePipelineCandidatePhoneOverride,
  type PipelineCallRecord,
  type PipelineCandidate,
  type PipelineResume,
} from '../services/pipelineService';
import {
  PIPELINE_BOOKED_SUBTYPES,
  PIPELINE_CALL_DISPOSITIONS,
  journeyStageForCallDisposition,
  type PipelineBookedSubtype,
  type PipelineCallDisposition,
} from '../services/pipelineCallDispositions';
import { buildThreeCxWebclientUrl } from '../services/threeCxService';
import { supabase } from '../services/supabaseClient';
import { getCurrentUserProfile } from '../services/accessControl';
import {
  buildLiveSessionRowsByEmail,
  loadLiveSessionRegistrantsForMatching,
} from '../services/liveSessionBookedOutcomes';
import {
  buildWebinarRowsByEmail,
  classifyBookedOutcome,
  loadScopedWebinarRowsForViewer,
  type BookedOutcomeBucket,
} from '../services/pipelineBookedOutcomes';

type QueueFilter = 'all' | 'callbacks' | 'not_interested' | 'booked' | 'booked_no_show' | 'booked_didnt_watch';

type CandidateBookedOutcomeMap = Map<string, BookedOutcomeBucket>;

const AUTO_ADVANCE = true;

function webinarVerifyHref(candidate: PipelineCandidate): string {
  const params = new URLSearchParams();
  if (candidate.email?.trim()) params.set('email', candidate.email.trim());
  if (candidate.full_name?.trim()) params.set('name', candidate.full_name.trim());
  params.set('candidateId', candidate.id);
  const query = params.toString();
  return `/pipeline/webinar-verify${query ? `?${query}` : ''}`;
}

const TERMINAL_EXCLUDED_DISPOSITIONS = new Set(['not interested', 'do not call']);
const RETRY_PRIORITY_ORDER: Record<string, number> = {
  'callback requested': 0,
  'no answer': 1,
  'voicemail left': 2,
  'busy / line busy': 3,
};

function normalizeDispositionLabel(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase();
}

function dispositionIsRetry(label: string): boolean {
  return Object.prototype.hasOwnProperty.call(RETRY_PRIORITY_ORDER, label);
}

function latestRecordByCandidate(records: PipelineCallRecord[]): Map<string, PipelineCallRecord> {
  const map = new Map<string, PipelineCallRecord>();
  for (const row of records) {
    const current = map.get(row.candidate_id);
    if (!current || new Date(row.disposed_at).getTime() > new Date(current.disposed_at).getTime()) {
      map.set(row.candidate_id, row);
    }
  }
  return map;
}

const PipelineCallWorkspace: React.FC = () => {
  const [initialLoading, setInitialLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [savingDisposition, setSavingDisposition] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [actionMsg, setActionMsg] = React.useState<string | null>(null);
  const queueFilter: QueueFilter = 'all';
  const [agentExtension, setAgentExtension] = React.useState('');
  const [dailyUploadTarget, setDailyUploadTarget] = React.useState<number | ''>('');
  const [dailyWebinarBookingTarget, setDailyWebinarBookingTarget] = React.useState<number | ''>('');
  const [selectedCandidateId, setSelectedCandidateId] = React.useState<string | null>(null);
  const [disposition, setDisposition] = React.useState<PipelineCallDisposition | ''>('');
  const [bookedSubtype, setBookedSubtype] = React.useState<PipelineBookedSubtype | ''>('');
  const [callbackAtInput, setCallbackAtInput] = React.useState('');
  const [comment, setComment] = React.useState('');
  const [phoneInput, setPhoneInput] = React.useState('');
  const [savingPhone, setSavingPhone] = React.useState(false);
  const [phoneMsg, setPhoneMsg] = React.useState<string | null>(null);
  const [emailInput, setEmailInput] = React.useState('');
  const [savingEmail, setSavingEmail] = React.useState(false);
  const [emailMsg, setEmailMsg] = React.useState<string | null>(null);
  const [showDispositionModal, setShowDispositionModal] = React.useState(false);
  const [submitAttempted, setSubmitAttempted] = React.useState(false);
  const [candidates, setCandidates] = React.useState<PipelineCandidate[]>([]);
  const [resumesByCandidate, setResumesByCandidate] = React.useState<Map<string, PipelineResume[]>>(new Map());
  const [records, setRecords] = React.useState<PipelineCallRecord[]>([]);
  const [todaysCallCount, setTodaysCallCount] = React.useState(0);
  const [bookedOutcomeByCandidate, setBookedOutcomeByCandidate] = React.useState<CandidateBookedOutcomeMap>(new Map());
  const [currentUserId, setCurrentUserId] = React.useState<string | null>(null);
  const selectedCandidateIdRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    selectedCandidateIdRef.current = selectedCandidateId;
  }, [selectedCandidateId]);

  const loadWorkspace = React.useCallback(async (mode: 'initial' | 'refresh' | 'silent' = 'silent') => {
    if (mode === 'initial') setInitialLoading(true);
    if (mode === 'refresh') setRefreshing(true);
    setError(null);
    try {
      const [{ data: auth }, profile, settings, candidateRows] = await Promise.all([
        supabase.auth.getUser(),
        getCurrentUserProfile().catch(() => null),
        getPipelineUserCallSettings().catch(() => null),
        listPipelineManualCandidates(),
      ]);
      const uid = auth.user?.id ?? null;
      setCurrentUserId(uid);
      setAgentExtension(settings?.extension || '');
      setDailyUploadTarget(settings?.daily_upload_target ?? '');
      setDailyWebinarBookingTarget(settings?.daily_webinar_booking_target ?? '');
      const sortedCandidates = [...candidateRows].sort((a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime());
      setCandidates(sortedCandidates);

      const candidateIds = sortedCandidates.map((c) => c.id);
      if (candidateIds.length === 0) {
        setResumesByCandidate(new Map());
        setRecords([]);
        setSelectedCandidateId(null);
        setTodaysCallCount(0);
        setBookedOutcomeByCandidate(new Map());
        return;
      }

      const webinarRowsPromise = loadScopedWebinarRowsForViewer({
        role: profile?.role ?? null,
        viewerEmail: auth.user?.email ?? profile?.email ?? null,
        viewerFullName: profile?.full_name ?? null,
      }).catch(() => null);
      const liveRegistrantsPromise = loadLiveSessionRegistrantsForMatching().catch(() => []);

      const [resumeRows, callRecordRows, todayRows, webinarRows, liveRegistrants] = await Promise.all([
        listPipelineResumesForCandidates(candidateIds),
        listPipelineCallRecords({ candidateIds, limit: 5000 }),
        uid
          ? listPipelineCallRecords({
              recruiterUserId: uid,
              fromIso: new Date(new Date().setHours(0, 0, 0, 0)).toISOString(),
              toIso: new Date(new Date().setHours(23, 59, 59, 999)).toISOString(),
              limit: 5000,
            })
          : Promise.resolve([]),
        webinarRowsPromise,
        liveRegistrantsPromise,
      ]);
      const nextMap = new Map<string, PipelineResume[]>();
      for (const resume of resumeRows) {
        const list = nextMap.get(resume.candidate_id) || [];
        list.push(resume);
        nextMap.set(resume.candidate_id, list);
      }
      setResumesByCandidate(nextMap);
      setRecords(callRecordRows);
      setTodaysCallCount(todayRows.length);
      const rowsByEmail = webinarRows ? buildWebinarRowsByEmail(webinarRows) : new Map();
      const liveSessionByEmail = buildLiveSessionRowsByEmail(liveRegistrants);
      const latest = latestRecordByCandidate(callRecordRows);
      const bookedMap = new Map<string, BookedOutcomeBucket>();
      for (const candidate of sortedCandidates) {
        const latestRecord = latest.get(candidate.id);
        if (!latestRecord || String(latestRecord.disposition || '').toLowerCase() !== 'booked') continue;
        const meta = readCallRecordMeta(latestRecord);
        const disposedMs = Date.parse(latestRecord.disposed_at || latestRecord.created_at);
        const classification = classifyBookedOutcome({
          bookedSubtype: meta.bookedSubtype || latestRecord.booked_subtype,
          candidateEmail: candidate.email,
          rowsByEmail,
          liveSessionByEmail,
          disposedAtMs: Number.isFinite(disposedMs) ? disposedMs : null,
        });
        bookedMap.set(candidate.id, classification.bucket);
      }
      setBookedOutcomeByCandidate(bookedMap);
      const activeSelectedId = selectedCandidateIdRef.current;
      if (!activeSelectedId || !sortedCandidates.some((row) => row.id === activeSelectedId)) {
        setSelectedCandidateId(sortedCandidates[0]?.id ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setInitialLoading(false);
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    void loadWorkspace('initial');
  }, [loadWorkspace]);

  const latestByCandidate = React.useMemo(() => latestRecordByCandidate(records), [records]);

  const callbackAtByCandidate = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const candidate of candidates) {
      const latest = latestByCandidate.get(candidate.id);
      if (!latest) continue;
      const callbackAt = readCallRecordMeta(latest).callbackAt;
      if (callbackAt) map.set(candidate.id, callbackAt);
    }
    return map;
  }, [candidates, latestByCandidate]);

  const filteredCandidates = React.useMemo(() => {
    return candidates.filter((candidate) => {
      const latest = latestByCandidate.get(candidate.id);
      const d = normalizeDispositionLabel(latest?.disposition);
      if (queueFilter === 'callbacks') {
        return d === 'callback requested' || Boolean(callbackAtByCandidate.get(candidate.id));
      }
      if (queueFilter === 'not_interested') {
        return d === 'not interested' || d === 'do not call';
      }
      if (queueFilter === 'booked') {
        return d === 'booked';
      }
      if (queueFilter === 'booked_no_show') {
        return bookedOutcomeByCandidate.get(candidate.id) === 'booked_no_show';
      }
      if (queueFilter === 'booked_didnt_watch') {
        return bookedOutcomeByCandidate.get(candidate.id) === 'booked_didnt_watch';
      }
      return true;
    });
  }, [candidates, queueFilter, latestByCandidate, callbackAtByCandidate, bookedOutcomeByCandidate]);

  const undisposedQueue = React.useMemo(
    () =>
      filteredCandidates.filter(
        (candidate) =>
          !latestByCandidate.get(candidate.id) && normalizeDispositionLabel(candidate.status) !== 'closed',
      ),
    [filteredCandidates, latestByCandidate],
  );

  const retryQueue = React.useMemo(() => {
    return filteredCandidates
      .filter((candidate) => {
        if (normalizeDispositionLabel(candidate.status) === 'closed') return false;
        const latest = latestByCandidate.get(candidate.id);
        if (!latest) return false;
        return dispositionIsRetry(normalizeDispositionLabel(latest.disposition));
      })
      .sort((a, b) => {
        const aDisposition = normalizeDispositionLabel(latestByCandidate.get(a.id)?.disposition);
        const bDisposition = normalizeDispositionLabel(latestByCandidate.get(b.id)?.disposition);
        const aRank = RETRY_PRIORITY_ORDER[aDisposition] ?? 99;
        const bRank = RETRY_PRIORITY_ORDER[bDisposition] ?? 99;
        if (aRank !== bRank) return aRank - bRank;
        const aAt = new Date(callbackAtByCandidate.get(a.id) || '9999-12-31').getTime();
        const bAt = new Date(callbackAtByCandidate.get(b.id) || '9999-12-31').getTime();
        return aAt - bAt;
      });
  }, [filteredCandidates, latestByCandidate, callbackAtByCandidate]);

  const activeQueueRaw = React.useMemo(() => {
    if (queueFilter === 'all') {
      return undisposedQueue.length > 0 ? undisposedQueue : retryQueue;
    }
    if (queueFilter === 'callbacks') {
      return [...filteredCandidates]
        .filter((candidate) => normalizeDispositionLabel(candidate.status) !== 'closed')
        .sort((a, b) => {
        const aAt = new Date(callbackAtByCandidate.get(a.id) || '9999-12-31').getTime();
        const bAt = new Date(callbackAtByCandidate.get(b.id) || '9999-12-31').getTime();
        return aAt - bAt;
      });
    }
    return [];
  }, [queueFilter, undisposedQueue, retryQueue, filteredCandidates, callbackAtByCandidate]);

  const queueCap = React.useMemo(() => {
    if (dailyUploadTarget === '' || Number(dailyUploadTarget) <= 0) return null;
    return Math.max(0, Number(dailyUploadTarget) - todaysCallCount);
  }, [dailyUploadTarget, todaysCallCount]);

  const queueList = React.useMemo(() => {
    if (queueCap == null) return activeQueueRaw;
    return activeQueueRaw.slice(0, queueCap);
  }, [activeQueueRaw, queueCap]);

  const queueActiveIds = React.useMemo(() => new Set(queueList.map((c) => c.id)), [queueList]);

  const doneList = React.useMemo(() => {
    return filteredCandidates.filter((candidate) => {
      const latest = latestByCandidate.get(candidate.id);
      if (!latest) return false;
      if (queueActiveIds.has(candidate.id)) return false;
      const d = normalizeDispositionLabel(latest.disposition);
      if (queueFilter === 'all' && TERMINAL_EXCLUDED_DISPOSITIONS.has(d)) return true;
      return true;
    });
  }, [filteredCandidates, latestByCandidate, queueActiveIds, queueFilter]);

  const emptyQueueGuidance = React.useMemo(() => {
    if (queueFilter === 'booked_no_show' || queueFilter === 'booked_didnt_watch') {
      return 'No candidates matched this booked outcome bucket. Try Booked filter or refresh WebinarGeek cache.';
    }
    if (queueFilter === 'callbacks') {
      return 'No callback candidates queued. Save a "Callback requested" disposition to add one.';
    }
    if (queueCap != null && queueCap <= 0) {
      return 'Daily queue cap reached. Increase daily target or continue tomorrow.';
    }
    if (queueFilter === 'all' && undisposedQueue.length === 0 && retryQueue.length === 0) return 'Main pass and retry queue are complete.';
    return 'Queue is empty for selected filters/cap.';
  }, [queueFilter, queueCap, undisposedQueue.length, retryQueue.length]);

  const displayList = React.useMemo(() => {
    const out: PipelineCandidate[] = [];
    const seen = new Set<string>();
    for (const row of [...queueList, ...doneList]) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      out.push(row);
    }
    return out;
  }, [queueList, doneList]);

  const currentCandidate = React.useMemo(() => {
    if (selectedCandidateId) {
      const selected = candidates.find((c) => c.id === selectedCandidateId);
      if (selected) return selected;
    }
    if (!displayList.length) return null;
    return queueList[0] || displayList[0];
  }, [candidates, selectedCandidateId, displayList, queueList]);

  const currentPhoneInfo = React.useMemo(
    () => (currentCandidate ? readPipelineCandidatePhone(currentCandidate) : null),
    [currentCandidate],
  );
  const currentEmailInfo = React.useMemo(
    () => (currentCandidate ? readPipelineCandidateEmail(currentCandidate) : null),
    [currentCandidate],
  );

  React.useEffect(() => {
    if (!currentCandidate) {
      setPhoneInput('');
      setPhoneMsg(null);
      setEmailInput('');
      setEmailMsg(null);
      return;
    }
    setPhoneInput(currentPhoneInfo?.effectivePhone || '');
    setPhoneMsg(null);
    setEmailInput(currentEmailInfo?.effectiveEmail || '');
    setEmailMsg(null);
  }, [currentCandidate?.id, currentPhoneInfo?.effectivePhone, currentEmailInfo?.effectiveEmail]);

  const disposedInFilteredCount = React.useMemo(
    () => filteredCandidates.filter((candidate) => latestByCandidate.has(candidate.id)).length,
    [filteredCandidates, latestByCandidate],
  );

  const queueProgressPct = React.useMemo(() => {
    if (!filteredCandidates.length) return 0;
    return Math.min(100, Math.round((disposedInFilteredCount / filteredCandidates.length) * 100));
  }, [disposedInFilteredCount, filteredCandidates.length]);

  const kpiProgressPct = React.useMemo(() => {
    if (dailyUploadTarget === '' || Number(dailyUploadTarget) <= 0) return 0;
    return Math.min(100, Math.round((todaysCallCount / Number(dailyUploadTarget)) * 100));
  }, [dailyUploadTarget, todaysCallCount]);

  const bookedTodayCount = React.useMemo(() => {
    const todayKey = new Date().toDateString();
    return records.filter((row) => {
      if (normalizeDispositionLabel(row.disposition) !== 'booked') return false;
      return new Date(row.disposed_at).toDateString() === todayKey;
    }).length;
  }, [records]);

  const bookedKpiProgressPct = React.useMemo(() => {
    if (dailyWebinarBookingTarget === '' || Number(dailyWebinarBookingTarget) <= 0) return 0;
    return Math.min(100, Math.round((bookedTodayCount / Number(dailyWebinarBookingTarget)) * 100));
  }, [dailyWebinarBookingTarget, bookedTodayCount]);

  const selectedResumes = React.useMemo(
    () => (currentCandidate ? resumesByCandidate.get(currentCandidate.id) || [] : []),
    [resumesByCandidate, currentCandidate],
  );

  const dispositionError = submitAttempted && !disposition ? 'Disposition is required.' : null;
  const bookedSubtypeError =
    submitAttempted && disposition === 'Booked' && !bookedSubtype ? 'Booked subtype is required.' : null;
  const callbackAtError =
    submitAttempted && disposition === 'Callback requested' && !callbackAtInput ? 'Callback date/time is required.' : null;
  const dialNumberPreview = normalizeDialDestination(phoneInput || currentCandidate?.phone || '');
  const isDark = false;
  const showLoadingOverlay = initialLoading || refreshing;
  const loadingOverlayText = initialLoading ? 'Loading call workspace...' : 'Refreshing queue...';

  const tone = React.useMemo(
    () => ({
      page:
        'relative overflow-hidden rounded-[30px] border p-4 md:p-5 shadow-[0_35px_100px_-45px_rgba(0,0,0,0.7)]',
      pageTheme: isDark
        ? 'border-white/10 bg-[#070b18] text-slate-100'
        : 'border-[#d4e4f7]/70 bg-[#f4f8ff]/80 text-slate-900',
      orbA: isDark
        ? 'from-violet-500/30 via-indigo-500/10 to-transparent'
        : 'from-violet-300/35 via-indigo-200/20 to-transparent',
      orbB: isDark
        ? 'from-cyan-500/25 via-sky-500/10 to-transparent'
        : 'from-cyan-300/35 via-sky-200/25 to-transparent',
      orbC: isDark
        ? 'from-fuchsia-500/15 via-blue-500/10 to-transparent'
        : 'from-fuchsia-200/35 via-blue-200/20 to-transparent',
      glassPanel: isDark
        ? 'border-white/12 bg-white/[0.045] backdrop-blur-xl shadow-[0_24px_60px_-42px_rgba(16,24,40,0.9)]'
        : 'border-white/70 bg-white/70 backdrop-blur-xl shadow-[0_22px_48px_-38px_rgba(37,99,235,0.45)]',
      panelMuted: isDark ? 'text-slate-300' : 'text-[#365274]',
      panelLabel: isDark ? 'text-slate-400' : 'text-[#4b6d95]',
      panelTitle: isDark ? 'text-white' : 'text-[#0B1B34]',
      input: isDark
        ? 'border-white/15 bg-white/5 text-slate-100 placeholder:text-slate-500'
        : 'border-[#bfd6ee] bg-white/70 text-[#13243f] placeholder:text-[#7392b8]',
      subtle: isDark ? 'bg-white/5 border-white/10' : 'bg-white/80 border-[#cde0f4]',
      actionButton: isDark
        ? 'border-white/20 bg-white/10 text-white hover:bg-white/15'
        : 'border-[#bad4ee] bg-white/75 text-[#0B1B34] hover:bg-white',
      doneCard: isDark
        ? 'border-white/10 bg-white/[0.04] hover:bg-white/[0.08]'
        : 'border-[#d3e3f4] bg-white/85 hover:bg-white',
      recentRail: isDark
        ? 'border-cyan-300/20 bg-gradient-to-r from-cyan-500/10 via-indigo-500/10 to-fuchsia-500/10'
        : 'border-[#c6dff7] bg-gradient-to-r from-cyan-100/80 via-indigo-100/70 to-fuchsia-100/70',
      modalBackdrop: isDark ? 'bg-[#020617]/65' : 'bg-[#102645]/35',
      progressTrack: isDark ? 'bg-white/10' : 'bg-[#e8f1fb]',
    }),
    [isDark],
  );

  const placeCall = async (candidate: PipelineCandidate, destinationRaw?: string) => {
    const destination = normalizeDialDestination(destinationRaw || candidate.phone || '');
    if (!destination) {
      setError('Candidate has no valid phone number.');
      return;
    }
    const url = buildThreeCxWebclientUrl(destination);
    if (!url) {
      setError('Set VITE_3CX_WEBCLIENT_URL before using popup dialing.');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
    setActionMsg(`Opened 3CX popup for ${candidate.full_name || 'candidate'}.`);
    setSubmitAttempted(false);
    setShowDispositionModal(true);
    try {
      await logPipelineCallAction({
        candidateId: candidate.id,
        action: 'dial_workspace_call',
        outcome: 'ok',
        agentExtension: agentExtension.trim() || null,
        requestPayload: { destination, mode: 'phase2_call_workspace' },
      });
    } catch {
      // Call flow should continue even when log write fails.
    }
  };

  const saveCandidatePhoneOverride = async () => {
    if (!currentCandidate) return;
    if (!isPipelinePhoneInputClean(phoneInput)) {
      setError('Phone input can only include digits, spaces, parentheses, dashes, and optional +.');
      return;
    }
    setSavingPhone(true);
    setError(null);
    setPhoneMsg(null);
    try {
      const updated = await savePipelineCandidatePhoneOverride({
        candidateId: currentCandidate.id,
        phoneInput,
        source: 'call_workspace',
      });
      setCandidates((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
      setPhoneInput(String(updated.phone || '').trim());
      setPhoneMsg('Corrected number saved for this candidate.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingPhone(false);
    }
  };

  const saveCandidateEmailOverride = async () => {
    if (!currentCandidate) return;
    setSavingEmail(true);
    setError(null);
    setEmailMsg(null);
    try {
      const updated = await savePipelineCandidateEmailOverride({
        candidateId: currentCandidate.id,
        emailInput,
        source: 'call_workspace',
      });
      setCandidates((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
      setEmailInput(readPipelineCandidateEmail(updated).effectiveEmail);
      setEmailMsg('Corrected email saved for this candidate.');
    } catch (e) {
      setEmailMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingEmail(false);
    }
  };

  const saveDisposition = async () => {
    if (!currentCandidate) return;
    setSubmitAttempted(true);
    const dialedNumber = normalizeDialDestination(phoneInput || currentCandidate.phone || '');
    if (!dialedNumber) {
      setError('Current candidate has no dialable number.');
      return;
    }
    if (!disposition) {
      setError('Disposition is required.');
      return;
    }
    if (disposition === 'Booked' && !bookedSubtype) {
      setError('Booked subtype is required.');
      return;
    }
    if (disposition === 'Callback requested' && !callbackAtInput) {
      setError('Callback date and time is required.');
      return;
    }
    setSavingDisposition(true);
    setError(null);
    try {
      const nowIso = new Date().toISOString();
      const saved = await savePipelineCallDisposition({
        candidateId: currentCandidate.id,
        resumeId: selectedResumes[0]?.id ?? null,
        disposition,
        comment,
        dialedNumber,
        dialStartedAt: nowIso,
        actorLabel: null,
        callbackAt: callbackAtInput || null,
        bookedSubtype: bookedSubtype || null,
        threecxMetadata: {
          source: 'phase2_call_workspace',
          auto_mode: AUTO_ADVANCE,
          phone_input: phoneInput.trim() || null,
          phone_original_extracted: currentPhoneInfo?.originalExtractedPhone || null,
          phone_override_applied: Boolean(currentPhoneInfo?.overridePhone),
        },
      });
      const persistenceMode = String((saved.threecx_metadata as Record<string, unknown> | null)?.persistence_mode || '');
      setActionMsg(
        persistenceMode === 'pipeline_call_logs_fallback'
          ? 'Disposition saved.'
          : 'Disposition saved.',
      );
      setDisposition('');
      setBookedSubtype('');
      setCallbackAtInput('');
      setComment('');
      setSubmitAttempted(false);
      setShowDispositionModal(false);
      const latestSaved: PipelineCallRecord = {
        ...saved,
        threecx_metadata: (saved.threecx_metadata && typeof saved.threecx_metadata === 'object')
          ? (saved.threecx_metadata as Record<string, unknown>)
          : {},
      };
      setRecords((prev) => [latestSaved, ...prev.filter((row) => row.id !== latestSaved.id)]);
      setCandidates((prev) =>
        prev
          .map((row) => {
            if (row.id !== currentCandidate.id) return row;
            const nextStatus =
              disposition === 'Not interested' || disposition === 'Do not call'
                ? 'closed'
                : 'in_progress';
            return {
              ...row,
              journey_stage: journeyStageForCallDisposition(disposition),
              status: nextStatus,
              updated_at: nowIso,
            };
          })
          .filter((row) => String(row.status || '').toLowerCase() !== 'closed'),
      );
      if (disposition === 'Booked') {
        setBookedOutcomeByCandidate((prev) => new Map(prev).set(currentCandidate.id, 'booked'));
      } else {
        setBookedOutcomeByCandidate((prev) => {
          const next = new Map(prev);
          next.delete(currentCandidate.id);
          return next;
        });
      }
      const alreadyTracked = records.some((row) => row.id === latestSaved.id);
      const sameRecruiter = !currentUserId || latestSaved.recruiter_user_id === currentUserId;
      const disposedToday = new Date(latestSaved.disposed_at).toDateString() === new Date().toDateString();
      if (!alreadyTracked && sameRecruiter && disposedToday) {
        setTodaysCallCount((prev) => prev + 1);
      }
      if (AUTO_ADVANCE) {
        const idx = queueList.findIndex((c) => c.id === currentCandidate.id);
        if (idx >= 0 && idx < queueList.length - 1) {
          setSelectedCandidateId(queueList[idx + 1].id);
        } else {
          setSelectedCandidateId(queueList.find((c) => c.id !== currentCandidate.id)?.id ?? null);
        }
      }
    } catch (e) {
      setError(stringifySupabaseError(e));
    } finally {
      setSavingDisposition(false);
    }
  };

  return (
    <PipelineAuthShell
      title="Call Workspace"
      subtitle="Sign in to continue recruiter calling workflow"
      redirectPath="/pipeline/call"
    >
      <div className={`mx-auto w-full max-w-[1520px] ${tone.page} ${tone.pageTheme}`}>
        <div className={`pointer-events-none absolute -top-24 left-[-10%] h-72 w-72 rounded-full bg-gradient-to-br blur-3xl ${tone.orbA}`} />
        <div className={`pointer-events-none absolute top-40 right-[-8%] h-80 w-80 rounded-full bg-gradient-to-br blur-3xl ${tone.orbB}`} />
        <div className={`pointer-events-none absolute bottom-[-6rem] left-1/3 h-72 w-72 rounded-full bg-gradient-to-tr blur-3xl ${tone.orbC}`} />
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className={`relative rounded-3xl border p-4 ${tone.glassPanel}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className={`text-[10px] uppercase tracking-[0.22em] ${tone.panelLabel}`}>Call workspace</p>
              <h1 className={`text-xl font-semibold ${tone.panelTitle}`}>Recruiter Call Workspace</h1>
              <p className={`text-xs ${tone.panelMuted}`}>Pick a candidate, place the call, log the outcome.</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Link
                to="/pipeline-settings"
                className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold ${tone.actionButton}`}
              >
                <Settings size={14} />
                Settings
              </Link>
              <Button
                variant="outline"
                className="!min-h-0 h-9 px-3 text-xs"
                onClick={() => void loadWorkspace('refresh')}
                disabled={showLoadingOverlay}
              >
                <RefreshCw size={14} className={refreshing ? 'mr-1 animate-spin' : 'mr-1'} />
                Refresh
              </Button>
            </div>
          </div>
        </motion.div>

        {error && <div className={`rounded-xl border px-3 py-2 text-sm ${isDark ? 'border-red-300/40 bg-red-500/12 text-red-200' : 'border-red-200 bg-red-50 text-red-700'}`}>{error}</div>}
        {actionMsg && <div className={`rounded-xl border px-3 py-2 text-xs ${isDark ? 'border-emerald-300/40 bg-emerald-500/12 text-emerald-200' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>{actionMsg}</div>}

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05 }}
          className={`rounded-2xl border px-4 py-3 ${tone.glassPanel}`}
        >
          <div className="grid gap-3 md:grid-cols-3">
            <div className={`rounded-xl border p-2.5 ${tone.subtle}`}>
              <p className={`text-[11px] font-semibold uppercase tracking-wide ${tone.panelLabel}`}>Queue progress</p>
              <p className={`text-xs ${tone.panelMuted}`}>{disposedInFilteredCount} disposed / {filteredCandidates.length} total</p>
              <div className={`mt-1.5 h-2 overflow-hidden rounded-full ${tone.progressTrack}`}>
                <div className="h-full rounded-full bg-[#3182ce]" style={{ width: `${queueProgressPct}%` }} />
              </div>
            </div>
            <div className={`rounded-xl border p-2.5 ${tone.subtle}`}>
              <p className={`text-[11px] font-semibold uppercase tracking-wide ${tone.panelLabel}`}>Today calls KPI</p>
              <p className={`text-xs ${tone.panelMuted}`}>
                {todaysCallCount}
                {dailyUploadTarget === '' ? ' calls' : ` / ${dailyUploadTarget} target`}
              </p>
              <div className={`mt-1.5 h-2 overflow-hidden rounded-full ${tone.progressTrack}`}>
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${kpiProgressPct}%` }} />
              </div>
            </div>
            <div className={`rounded-xl border p-2.5 ${tone.subtle}`}>
              <p className={`text-[11px] font-semibold uppercase tracking-wide ${tone.panelLabel}`}>Booked KPI</p>
              <p className={`text-xs ${tone.panelMuted}`}>
                {bookedTodayCount}
                {dailyWebinarBookingTarget === '' ? ' booked today' : ` / ${dailyWebinarBookingTarget} target`}
              </p>
              <div className={`mt-1.5 h-2 overflow-hidden rounded-full ${tone.progressTrack}`}>
                <div className="h-full rounded-full bg-violet-500" style={{ width: `${bookedKpiProgressPct}%` }} />
              </div>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.1 }}
          className="grid gap-4 lg:grid-cols-[minmax(280px,340px)_1fr]"
        >
          <aside className={`rounded-2xl border p-4 ${tone.glassPanel}`}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <p className={`text-sm font-semibold ${tone.panelTitle}`}>To call</p>
                <p className={`text-xs ${tone.panelMuted}`}>{queueList.length} in queue</p>
              </div>
            </div>
            <div className="max-h-[min(70vh,640px)] space-y-2 overflow-y-auto pr-1">
              {queueList.map((candidate, index) => {
                const isSelected = candidate.id === currentCandidate?.id;
                const latest = latestByCandidate.get(candidate.id);
                const dispositionLabel = normalizeDispositionLabel(latest?.disposition);
                const phoneInfo = readPipelineCandidatePhone(candidate);
                const callbackAt = callbackAtByCandidate.get(candidate.id);
                const isCallbackDue = callbackAt && new Date(callbackAt).getTime() <= Date.now();
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() => setSelectedCandidateId(candidate.id)}
                    className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
                      isSelected
                        ? 'border-[#7eb3e7] bg-white shadow-[0_8px_24px_-16px_rgba(38,95,165,0.45)]'
                        : tone.doneCard
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className={`truncate text-sm font-semibold ${tone.panelTitle}`}>
                          {index + 1}. {candidate.full_name || 'Unknown Candidate'}
                        </p>
                        <p className={`mt-0.5 truncate text-xs ${tone.panelMuted}`}>
                          {phoneInfo.effectivePhone || 'No phone'}
                        </p>
                        {candidate.email && (
                          <p className={`truncate text-[11px] ${tone.panelLabel}`}>{candidate.email}</p>
                        )}
                      </div>
                      {dispositionLabel === 'callback requested' && (
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${isCallbackDue ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>
                          {isCallbackDue ? 'Due' : 'Callback'}
                        </span>
                      )}
                      {!latest && (
                        <span className="shrink-0 rounded-full bg-[#edf5ff] px-2 py-0.5 text-[10px] font-semibold text-[#285082]">
                          New
                        </span>
                      )}
                      {latest && dispositionIsRetry(dispositionLabel) && dispositionLabel !== 'callback requested' && (
                        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                          Retry
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
              {!queueList.length && (
                <p className={`rounded-xl border border-dashed p-4 text-center text-xs ${tone.panelMuted}`}>{emptyQueueGuidance}</p>
              )}
            </div>
          </aside>

          <section className="space-y-4">
            <div className={`rounded-2xl border p-5 md:p-6 ${tone.glassPanel}`}>
              {currentCandidate ? (
                <div className="space-y-5">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <p className={`text-[10px] uppercase tracking-[0.2em] ${tone.panelLabel}`}>Now calling</p>
                      <h2 className={`mt-1 text-2xl font-semibold ${tone.panelTitle}`}>
                        {currentCandidate.full_name || 'Unknown Candidate'}
                      </h2>
                      {currentCandidate.journey_stage && (
                        <p className={`mt-1 text-xs ${tone.panelLabel}`}>Stage: {currentCandidate.journey_stage}</p>
                      )}
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <Button
                        className="!min-h-0 h-12 shrink-0 px-6 text-base"
                        onClick={() => void placeCall(currentCandidate, phoneInput)}
                      >
                        <Phone size={18} className="mr-2" />
                        Place call
                      </Button>
                      <a
                        href={webinarVerifyHref(currentCandidate)}
                        target="_blank"
                        rel="noreferrer"
                        className={`inline-flex h-12 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-semibold ${tone.actionButton}`}
                      >
                        <Video size={16} />
                        Webinar verify
                        <ExternalLink size={13} className="opacity-70" />
                      </a>
                    </div>
                  </div>

                  <CandidateResumeDetailsCard
                    candidate={currentCandidate}
                    resumes={selectedResumes}
                    tone={tone}
                  />

                  <div className={`rounded-2xl border p-4 ${tone.subtle}`}>
                    <p className={`mb-2 text-xs font-semibold uppercase tracking-wide ${tone.panelLabel}`}>Phone number</p>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <input
                        value={phoneInput}
                        onChange={(e) => {
                          setPhoneInput(e.target.value);
                          setPhoneMsg(null);
                        }}
                        placeholder="e.g. +1 (555) 123-4567"
                        className={`min-w-0 flex-1 rounded-xl border px-3 py-2.5 text-sm ${tone.input}`}
                      />
                      <Button
                        variant="outline"
                        className="!min-h-0 h-10 shrink-0 px-4 text-sm"
                        onClick={() => void saveCandidatePhoneOverride()}
                        disabled={savingPhone || !currentCandidate}
                      >
                        {savingPhone ? 'Saving...' : 'Save number'}
                      </Button>
                    </div>
                    <p className={`mt-2 text-[11px] ${tone.panelLabel}`}>
                      Dial preview: {normalizeDialDestination(phoneInput) || '—'}
                    </p>
                    {currentPhoneInfo?.originalExtractedPhone && (
                      <p className={`mt-1 text-[11px] ${tone.panelLabel}`}>
                        OCR extracted phone: {currentPhoneInfo.originalExtractedPhone}
                      </p>
                    )}
                    {phoneMsg && <p className="mt-1 text-xs text-emerald-700">{phoneMsg}</p>}
                  </div>

                  <div className={`rounded-2xl border p-4 ${tone.subtle}`}>
                    <p className={`mb-2 text-xs font-semibold uppercase tracking-wide ${tone.panelLabel}`}>Email address</p>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <input
                        value={emailInput}
                        onChange={(e) => {
                          setEmailInput(e.target.value);
                          setEmailMsg(null);
                        }}
                        placeholder="candidate@example.com"
                        className={`min-w-0 flex-1 rounded-xl border px-3 py-2.5 text-sm ${tone.input}`}
                      />
                      <Button
                        variant="outline"
                        className="!min-h-0 h-10 shrink-0 px-4 text-sm"
                        onClick={() => void saveCandidateEmailOverride()}
                        disabled={savingEmail || !currentCandidate}
                      >
                        {savingEmail ? 'Saving...' : 'Save email'}
                      </Button>
                    </div>
                    {currentEmailInfo?.originalExtractedEmail && (
                      <p className={`mt-2 text-[11px] ${tone.panelLabel}`}>
                        OCR extracted email: {currentEmailInfo.originalExtractedEmail}
                      </p>
                    )}
                    <p className={`mt-1 text-[11px] ${tone.panelLabel}`}>
                      Used for inbox matching and outbound email to this resume.
                    </p>
                    {emailMsg && (
                      <p className={`mt-1 text-xs ${emailMsg.startsWith('Corrected') ? 'text-emerald-700' : 'text-red-600'}`}>
                        {emailMsg}
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <p className={`text-sm ${tone.panelMuted}`}>{emptyQueueGuidance}</p>
              )}
            </div>

            <div className={`rounded-2xl border p-4 ${tone.glassPanel}`}>
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <p className={`text-sm font-semibold ${tone.panelTitle}`}>Done</p>
                  <p className={`text-xs ${tone.panelMuted}`}>{doneList.length} completed</p>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {doneList.slice(0, 12).map((candidate) => {
                  const latest = latestByCandidate.get(candidate.id);
                  const isSelected = candidate.id === currentCandidate?.id;
                  return (
                    <button
                      key={candidate.id}
                      type="button"
                      onClick={() => setSelectedCandidateId(candidate.id)}
                      className={`flex items-center justify-between rounded-xl border px-3 py-2.5 text-left transition ${
                        isSelected ? 'border-[#9dc6ef] bg-[#e8f3ff]' : tone.doneCard
                      }`}
                    >
                      <div className="min-w-0 pr-2">
                        <p className={`truncate text-sm font-semibold ${tone.panelTitle}`}>
                          {candidate.full_name || 'Unknown Candidate'}
                        </p>
                        <p className={`truncate text-xs ${tone.panelMuted}`}>{latest?.disposition || 'Disposed'}</p>
                      </div>
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                        <CheckCircle2 size={11} />
                        Done
                      </span>
                    </button>
                  );
                })}
                {!doneList.length && (
                  <p className={`col-span-full rounded-xl border border-dashed p-4 text-center text-xs ${tone.panelMuted}`}>
                    Disposed candidates will appear here.
                  </p>
                )}
              </div>
            </div>
          </section>
        </motion.div>


        <AnimatePresence>
          {showLoadingOverlay && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className={`absolute inset-0 z-40 flex items-center justify-center rounded-[30px] backdrop-blur-md ${
                isDark ? 'bg-[#020617]/50' : 'bg-[#dbeafe]/55'
              }`}
            >
              <div
                className={`flex min-w-[240px] items-center justify-center gap-2 rounded-2xl border px-5 py-4 text-sm font-semibold ${
                  tone.glassPanel
                } ${isDark ? 'text-slate-100' : 'text-[#0B1B34]'}`}
              >
                <RefreshCw size={16} className="animate-spin" />
                <span>{loadingOverlayText}</span>
              </div>
            </motion.div>
          )}
          {showDispositionModal && currentCandidate && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className={`fixed inset-0 z-50 flex items-center justify-center p-4 ${tone.modalBackdrop}`}
            >
            <motion.div
              initial={{ opacity: 0, y: 14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              className={`w-full max-w-xl space-y-3 rounded-2xl border p-4 shadow-2xl ${tone.glassPanel}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className={`text-xs ${tone.panelLabel}`}>Post-call disposition</p>
                  <h3 className={`text-base font-semibold ${tone.panelTitle}`}>{currentCandidate.full_name || 'Candidate'}</h3>
                  <p className={`text-[11px] ${tone.panelLabel}`}>Dialed number: {dialNumberPreview || 'No dialable number'}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSubmitAttempted(false);
                    setShowDispositionModal(false);
                  }}
                  className={`rounded-lg border px-2 py-1 text-xs ${tone.actionButton}`}
                >
                  Close
                </button>
              </div>

              <label className={`block text-xs ${tone.panelMuted}`}>
                Disposition
                <select
                  value={disposition}
                  onChange={(e) => setDisposition(e.target.value as PipelineCallDisposition)}
                  className={`mt-1 w-full rounded-lg border px-2 py-2 text-xs ${tone.input}`}
                >
                  <option value="">Select disposition</option>
                  {PIPELINE_CALL_DISPOSITIONS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
                {dispositionError && <p className="mt-1 text-[11px] text-red-600">{dispositionError}</p>}
              </label>

              {disposition === 'Booked' && (
                <label className={`block text-xs ${tone.panelMuted}`}>
                  Booked subtype <span className="text-red-600">*</span>
                  <select
                    value={bookedSubtype}
                    onChange={(e) => setBookedSubtype(e.target.value as PipelineBookedSubtype)}
                    className={`mt-1 w-full rounded-lg border px-2 py-2 text-xs ${tone.input}`}
                  >
                    <option value="">Select subtype</option>
                    {PIPELINE_BOOKED_SUBTYPES.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                  {bookedSubtypeError && <p className="mt-1 text-[11px] text-red-600">{bookedSubtypeError}</p>}
                </label>
              )}

              {disposition === 'Callback requested' && (
                <label className={`block text-xs ${tone.panelMuted}`}>
                  Callback date/time <span className="text-red-600">*</span>
                  <input
                    type="datetime-local"
                    value={callbackAtInput}
                    onChange={(e) => setCallbackAtInput(e.target.value)}
                    className={`mt-1 w-full rounded-lg border px-2 py-2 text-xs ${tone.input}`}
                  />
                  {callbackAtError && <p className="mt-1 text-[11px] text-red-600">{callbackAtError}</p>}
                </label>
              )}

              <label className={`block text-xs ${tone.panelMuted}`}>
                Comment
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={3}
                  className={`mt-1 w-full rounded-lg border px-2 py-2 text-xs ${tone.input}`}
                  placeholder="Call notes..."
                />
              </label>

              <Button className="w-full" onClick={() => void saveDisposition()} disabled={savingDisposition || !currentCandidate}>
                {savingDisposition ? 'Saving...' : 'Save disposition'}
              </Button>
            </motion.div>
          </motion.div>
          )}
        </AnimatePresence>
      </div>
    </PipelineAuthShell>
  );
};

export default PipelineCallWorkspace;
