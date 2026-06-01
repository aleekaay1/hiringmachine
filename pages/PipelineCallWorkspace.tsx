import React from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, ChevronLeft, ChevronRight, ExternalLink, History, Moon, Phone, RefreshCw, Sun } from 'lucide-react';
import CandidateProfileEditor from '../components/pipeline/CandidateProfileEditor';
import PipelineAuthShell from '../components/PipelineAuthShell';
import { Button } from '../components/UI';
import {
  stringifySupabaseError,
  getPipelineUserCallSettings,
  getPipelineResumeOpenInNewTabUrl,
  isPipelinePhoneInputClean,
  listPipelineCallRecords,
  listPipelineManualCandidates,
  listPipelineResumesForCandidates,
  logPipelineCallAction,
  normalizeDialDestination,
  readCallRecordMeta,
  readPipelineCandidatePhone,
  savePipelineCallDisposition,
  savePipelineCandidatePhoneOverride,
  savePipelineUserCallSettings,
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
import { formatDateTimeCanadaEastern } from '../services/dateDisplay';
import { buildThreeCxWebclientUrl } from '../services/threeCxService';
import { supabase } from '../services/supabaseClient';
import { getCurrentUserProfile } from '../services/accessControl';
import {
  BOOKED_OUTCOME_RULE_LABEL,
  buildWebinarRowsByEmail,
  classifyBookedOutcome,
  loadScopedWebinarRowsForViewer,
  type BookedOutcomeBucket,
} from '../services/pipelineBookedOutcomes';

type QueueFilter = 'all' | 'callbacks' | 'not_interested' | 'booked' | 'booked_no_show' | 'booked_didnt_watch';

type CallbackRow = {
  candidateId: string;
  candidateName: string;
  callbackAt: string;
  phone: string;
  latestRecord: PipelineCallRecord;
};

type CandidateBookedOutcomeMap = Map<string, BookedOutcomeBucket>;
type WorkspaceThemeMode = 'dark' | 'light';

const WORKSPACE_THEME_STORAGE_KEY = 'pipeline-call-workspace-theme';

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

const QUICK_FILTERS: Array<{ id: QueueFilter; label: string }> = [
  { id: 'callbacks', label: 'Callbacks' },
  { id: 'not_interested', label: 'Not interested' },
  { id: 'booked', label: 'Booked' },
  { id: 'booked_no_show', label: 'Booked no show' },
  { id: 'booked_didnt_watch', label: "Booked didn't watch" },
];

const PipelineCallWorkspace: React.FC = () => {
  const [initialLoading, setInitialLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [savingSettings, setSavingSettings] = React.useState(false);
  const [savingDisposition, setSavingDisposition] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [actionMsg, setActionMsg] = React.useState<string | null>(null);
  const [autoMode, setAutoMode] = React.useState(true);
  const [queueFilter, setQueueFilter] = React.useState<QueueFilter>('all');
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
  const [showDispositionModal, setShowDispositionModal] = React.useState(false);
  const [submitAttempted, setSubmitAttempted] = React.useState(false);
  const [themeMode, setThemeMode] = React.useState<WorkspaceThemeMode>('dark');

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

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(WORKSPACE_THEME_STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') {
      setThemeMode(stored);
    }
  }, []);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(WORKSPACE_THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

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

      const [resumeRows, callRecordRows, todayRows, webinarRows] = await Promise.all([
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
      if (webinarRows) {
        const rowsByEmail = buildWebinarRowsByEmail(webinarRows);
        const latest = latestRecordByCandidate(callRecordRows);
        const bookedMap = new Map<string, BookedOutcomeBucket>();
        for (const candidate of sortedCandidates) {
          const latestRecord = latest.get(candidate.id);
          if (!latestRecord || String(latestRecord.disposition || '').toLowerCase() !== 'booked') continue;
          const meta = readCallRecordMeta(latestRecord);
          const classification = classifyBookedOutcome({
            bookedSubtype: meta.bookedSubtype,
            candidateEmail: candidate.email,
            rowsByEmail,
          });
          bookedMap.set(candidate.id, classification.bucket);
        }
        setBookedOutcomeByCandidate(bookedMap);
      } else {
        setBookedOutcomeByCandidate(new Map());
      }
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

  const isRetryPass = queueFilter === 'all' && undisposedQueue.length === 0 && retryQueue.length > 0;

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

  const queueStateLabel = React.useMemo(() => {
    if (queueFilter === 'all') return isRetryPass ? 'Retry queue (callbacks/no answer first)' : 'Main pass queue';
    if (queueFilter === 'callbacks') return 'Callback queue';
    if (queueFilter === 'booked_no_show') return 'Booked no show (best-effort)';
    if (queueFilter === 'booked_didnt_watch') return "Booked didn't watch (best-effort)";
    if (queueFilter === 'booked') return 'Booked outcomes';
    if (queueFilter === 'not_interested') return 'Not interested / do not call';
    return 'Queue';
  }, [queueFilter, isRetryPass]);

  const queueCapStatus = React.useMemo(() => {
    if (queueCap == null) return 'No cap';
    if (queueCap <= 0) return 'Cap reached';
    return `${queueCap} left`;
  }, [queueCap]);

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
    if (!displayList.length) return null;
    return displayList.find((c) => c.id === selectedCandidateId) || queueList[0] || displayList[0];
  }, [displayList, queueList, selectedCandidateId]);
  const currentPhoneInfo = React.useMemo(
    () => (currentCandidate ? readPipelineCandidatePhone(currentCandidate) : null),
    [currentCandidate],
  );

  React.useEffect(() => {
    if (!currentCandidate) {
      setPhoneInput('');
      setPhoneMsg(null);
      return;
    }
    setPhoneInput(currentPhoneInfo?.effectivePhone || '');
    setPhoneMsg(null);
  }, [currentCandidate?.id, currentPhoneInfo?.effectivePhone]);

  const currentQueueIndex = React.useMemo(
    () => queueList.findIndex((candidate) => candidate.id === currentCandidate?.id),
    [queueList, currentCandidate?.id],
  );

  const carouselCards = React.useMemo(() => {
    if (!queueList.length) return [];
    const fallbackIndex = currentQueueIndex >= 0 ? currentQueueIndex : 0;
    const start = Math.max(0, fallbackIndex - 1);
    return queueList.slice(start, start + 4);
  }, [queueList, currentQueueIndex]);

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

  const callbackRows = React.useMemo<CallbackRow[]>(() => {
    const byCandidate = new Map<string, CallbackRow>();
    for (const row of records) {
      const callbackAt = readCallRecordMeta(row).callbackAt;
      if (!callbackAt) continue;
      const candidate = candidates.find((c) => c.id === row.candidate_id);
      if (!candidate) continue;
      const existing = byCandidate.get(row.candidate_id);
      const candidateName = candidate.full_name || 'Unknown Candidate';
      const phone = normalizeDialDestination(candidate.phone || '');
      if (!phone) continue;
      if (!existing || new Date(callbackAt).getTime() < new Date(existing.callbackAt).getTime()) {
        byCandidate.set(row.candidate_id, {
          candidateId: row.candidate_id,
          candidateName,
          callbackAt,
          phone,
          latestRecord: row,
        });
      }
    }
    return [...byCandidate.values()].sort((a, b) => new Date(a.callbackAt).getTime() - new Date(b.callbackAt).getTime());
  }, [records, candidates]);

  const selectedResumes = React.useMemo(
    () => (currentCandidate ? resumesByCandidate.get(currentCandidate.id) || [] : []),
    [resumesByCandidate, currentCandidate],
  );

  const selectedHistory = React.useMemo(() => {
    if (!currentCandidate) return [];
    return records
      .filter((r) => r.candidate_id === currentCandidate.id)
      .sort((a, b) => new Date(b.disposed_at).getTime() - new Date(a.disposed_at).getTime())
      .slice(0, 8);
  }, [records, currentCandidate]);

  const dispositionError = submitAttempted && !disposition ? 'Disposition is required.' : null;
  const bookedSubtypeError =
    submitAttempted && disposition === 'Booked' && !bookedSubtype ? 'Booked subtype is required.' : null;
  const callbackAtError =
    submitAttempted && disposition === 'Callback requested' && !callbackAtInput ? 'Callback date/time is required.' : null;
  const dialNumberPreview = normalizeDialDestination(phoneInput || currentCandidate?.phone || '');
  const isDark = themeMode === 'dark';
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

  const handleProfileSaved = React.useCallback((updated: PipelineCandidate) => {
    setCandidates((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
    setPhoneInput(String(updated.phone || '').trim());
    setPhoneMsg(null);
  }, []);

  const goToNextCandidate = () => {
    if (!queueList.length) {
      setActionMsg('No candidates left in the active queue.');
      return;
    }
    if (currentQueueIndex < 0) {
      setSelectedCandidateId(queueList[0].id);
      return;
    }
    if (currentQueueIndex >= queueList.length - 1) {
      setActionMsg('You are on the last candidate in the active queue.');
      return;
    }
    setSelectedCandidateId(queueList[currentQueueIndex + 1].id);
    setActionMsg(null);
  };

  const saveSettings = async () => {
    setSavingSettings(true);
    setActionMsg(null);
    try {
      await savePipelineUserCallSettings({
        extension: agentExtension,
        dailyUploadTarget: dailyUploadTarget === '' ? null : Number(dailyUploadTarget),
        dailyWebinarBookingTarget: dailyWebinarBookingTarget === '' ? null : Number(dailyWebinarBookingTarget),
      });
      setActionMsg('Call workspace settings saved.');
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingSettings(false);
    }
  };

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
          auto_mode: autoMode,
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
      if (autoMode) {
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
              <p className={`text-[10px] uppercase tracking-[0.22em] ${tone.panelLabel}`}>Pipeline recruiter studio</p>
              <h1 className={`text-lg font-semibold ${tone.panelTitle}`}>Recruiter Call Workspace</h1>
              <p className={`text-xs ${tone.panelMuted}`}>Call, disposition in popup, and move through queue with clean chronology.</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setThemeMode((prev) => (prev === 'dark' ? 'light' : 'dark'))}
                className={`inline-flex items-center gap-1 rounded-xl border px-3 py-2 text-xs font-semibold ${tone.actionButton}`}
                aria-label="Toggle dark and light mode"
              >
                {isDark ? <Sun size={13} /> : <Moon size={13} />}
                {isDark ? 'Light mode' : 'Dark mode'}
              </button>
              <button
                type="button"
                onClick={() => setAutoMode((v) => !v)}
                className={`rounded-xl px-3 py-2 text-xs font-semibold border ${
                  autoMode
                    ? (isDark ? 'border-emerald-300/40 bg-emerald-400/15 text-emerald-100' : 'border-emerald-300 bg-emerald-50 text-emerald-800')
                    : tone.actionButton
                }`}
              >
                {autoMode ? 'Auto mode: ON' : 'Auto mode: OFF'}
              </button>
              <Button
                variant="outline"
                className={`!min-h-0 h-9 px-3 text-xs ${isDark ? '!border-white/20 !bg-white/10 !text-slate-100 hover:!bg-white/15' : ''}`}
                onClick={() => void loadWorkspace('refresh')}
                disabled={showLoadingOverlay}
              >
                <RefreshCw size={14} className={refreshing ? 'mr-1 animate-spin' : 'mr-1'} />
                Refresh queue
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
          <div className={`mt-3 flex flex-wrap items-center gap-2 text-xs ${tone.panelMuted}`}>
            <span className={`rounded-full px-2.5 py-1 font-semibold ${isDark ? 'bg-white/10 text-white' : 'bg-[#edf5ff] text-[#0B1B34]'}`}>Active queue: {queueList.length}</span>
            <span className={`rounded-full px-2.5 py-1 ${isDark ? 'bg-white/5 text-slate-200' : 'bg-[#f2f6fb] text-slate-700'}`}>Done lane: {doneList.length}</span>
            <span className={`rounded-full border px-2.5 py-1 ${tone.input}`}>Filter: {queueStateLabel}</span>
            <span className={`rounded-full border px-2.5 py-1 ${tone.input}`}>Mode: {autoMode ? 'Auto advance' : 'Manual select'}</span>
            <span className={`rounded-full border px-2.5 py-1 ${tone.input}`}>Cap: {queueCapStatus}</span>
            {currentCandidate && (
              <span className={`rounded-full border px-2.5 py-1 ${tone.input}`}>Current: {currentCandidate.full_name || 'Unknown Candidate'}</span>
            )}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.1 }}
          className="grid gap-4 xl:grid-cols-[260px_1fr]"
        >
          <aside className={`rounded-2xl border p-3 space-y-3 ${tone.glassPanel}`}>
            <div>
              <p className={`mb-2 text-[11px] font-semibold uppercase tracking-wide ${tone.panelLabel}`}>Queue filters</p>
              <button
                type="button"
                onClick={() => setQueueFilter('all')}
                className={`mb-1 w-full rounded-lg border px-2 py-2 text-left text-xs ${
                  queueFilter === 'all'
                    ? (isDark ? 'border-cyan-300/45 bg-cyan-300/18 text-cyan-100' : 'border-[#9dc6ef] bg-[#e8f3ff] text-[#0B1B34]')
                    : `${tone.input}`
                }`}
              >
                All queue
              </button>
              {QUICK_FILTERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setQueueFilter(item.id)}
                  title={item.id === 'booked_no_show' || item.id === 'booked_didnt_watch' ? BOOKED_OUTCOME_RULE_LABEL : undefined}
                  className={`mb-1 w-full rounded-lg border px-2 py-2 text-left text-xs ${
                    queueFilter === item.id
                      ? (isDark ? 'border-cyan-300/45 bg-cyan-300/18 text-cyan-100' : 'border-[#9dc6ef] bg-[#e8f3ff] text-[#0B1B34]')
                      : `${tone.input}`
                  }`}
                >
                  {item.label}
                  {(item.id === 'booked_no_show' || item.id === 'booked_didnt_watch') && (
                    <span className="ml-2 text-[10px] text-slate-400">(email match)</span>
                  )}
                </button>
              ))}
            </div>

            <div>
              <p className={`mb-1 text-[11px] font-semibold uppercase tracking-wide ${tone.panelLabel}`}>Callbacks</p>
              <div className="max-h-[320px] space-y-1.5 overflow-auto">
                {callbackRows.map((row) => {
                  const isDue = new Date(row.callbackAt).getTime() <= Date.now();
                  return (
                    <button
                      key={`${row.candidateId}-${row.callbackAt}`}
                      type="button"
                      onClick={() => setSelectedCandidateId(row.candidateId)}
                      className={`w-full rounded-lg border px-2 py-2 text-left transition ${tone.doneCard}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className={`truncate text-xs font-semibold ${tone.panelTitle}`}>{row.candidateName}</p>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            isDue
                              ? (isDark ? 'bg-amber-300/20 text-amber-100' : 'bg-amber-100 text-amber-800')
                              : (isDark ? 'bg-white/10 text-slate-300' : 'bg-slate-100 text-slate-600')
                          }`}
                        >
                          {isDue ? 'Due' : 'Upcoming'}
                        </span>
                      </div>
                      <p className={`text-[10px] ${tone.panelLabel}`}>{formatDateTimeCanadaEastern(row.callbackAt)}</p>
                    </button>
                  );
                })}
                {!callbackRows.length && (
                  <p className={`rounded-lg border border-dashed p-2 text-[11px] ${tone.input}`}>No callbacks logged yet.</p>
                )}
              </div>
            </div>

            <details className={`rounded-xl border p-2.5 ${tone.subtle}`} open>
              <summary className={`cursor-pointer text-[11px] font-semibold ${tone.panelTitle}`}>Settings</summary>
              <div className="mt-2 space-y-2">
                <label className={`block text-[11px] ${tone.panelMuted}`}>
                  Daily target
                  <input
                    type="number"
                    min={0}
                    value={dailyUploadTarget}
                    onChange={(e) => setDailyUploadTarget(e.target.value ? Number(e.target.value) : '')}
                    className={`mt-1 w-full rounded-lg border px-2 py-1.5 text-xs ${tone.input}`}
                  />
                </label>
                <label className={`block text-[11px] ${tone.panelMuted}`}>
                  Daily booked target
                  <input
                    type="number"
                    min={0}
                    value={dailyWebinarBookingTarget}
                    onChange={(e) => setDailyWebinarBookingTarget(e.target.value ? Number(e.target.value) : '')}
                    className={`mt-1 w-full rounded-lg border px-2 py-1.5 text-xs ${tone.input}`}
                  />
                </label>
                <label className={`block text-[11px] ${tone.panelMuted}`}>
                  Extension
                  <input
                    value={agentExtension}
                    onChange={(e) => setAgentExtension(e.target.value)}
                    className={`mt-1 w-full rounded-lg border px-2 py-1.5 text-xs ${tone.input}`}
                  />
                </label>
                <Button variant="outline" className={`!min-h-0 h-8 w-full text-xs ${isDark ? '!border-white/20 !bg-white/10 !text-slate-100 hover:!bg-white/15' : ''}`} onClick={() => void saveSettings()} disabled={savingSettings}>
                  {savingSettings ? 'Saving...' : 'Save settings'}
                </Button>
                <p className={`text-[10px] ${tone.panelLabel}`}>Today calls: {todaysCallCount}</p>
              </div>
            </details>

            <details className={`rounded-xl border p-2.5 ${tone.subtle}`}>
              <summary className={`cursor-pointer text-[11px] font-semibold ${tone.panelTitle}`}>Utilities</summary>
              <div className="mt-2 space-y-2">
                <Link
                  to="/pipeline"
                  className={`block rounded-lg border px-3 py-2 text-center text-xs ${tone.actionButton}`}
                >
                  Open legacy mode
                </Link>
                <Button
                  variant="outline"
                  className={`!min-h-0 h-9 w-full px-3 text-xs ${isDark ? '!border-white/20 !bg-white/10 !text-slate-100 hover:!bg-white/15' : ''}`}
                  onClick={() => setSelectedCandidateId(queueList[0]?.id ?? doneList[0]?.id ?? null)}
                  disabled={!queueList.length && !doneList.length}
                >
                  Focus first card
                </Button>
              </div>
            </details>
          </aside>

          <section className={`rounded-2xl border p-4 space-y-3 ${tone.glassPanel}`}>
            <div className={`rounded-xl border p-3 ${tone.subtle}`}>
              {currentCandidate ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className={`text-[10px] uppercase tracking-[0.2em] ${tone.panelLabel}`}>Current candidate</p>
                      <h2 className={`text-xl font-semibold ${tone.panelTitle}`}>{currentCandidate.full_name || 'Unknown Candidate'}</h2>
                      <p className={`text-xs ${tone.panelMuted}`}>
                        {currentPhoneInfo?.effectivePhone || 'No phone'} {currentCandidate.email ? `· ${currentCandidate.email}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="outline"
                        className={`!min-h-0 h-10 px-3 text-sm ${isDark ? '!border-white/20 !bg-white/10 !text-slate-100 hover:!bg-white/15' : ''}`}
                        onClick={goToNextCandidate}
                        disabled={!queueList.length}
                      >
                        <ChevronRight size={14} className="mr-1" />
                        Next candidate
                      </Button>
                      <Button
                        className={`!min-h-0 h-10 px-4 text-sm ${isDark ? '!bg-cyan-400/20 !text-cyan-100 hover:!bg-cyan-400/30 !border !border-cyan-200/35' : ''}`}
                        onClick={() => void placeCall(currentCandidate, phoneInput)}
                      >
                        <Phone size={14} className="mr-1" />
                        Place call
                      </Button>
                    </div>
                  </div>

                  <div className="mt-3">
                    <CandidateProfileEditor
                      candidate={currentCandidate}
                      tone={tone}
                      isDark={isDark}
                      onSaved={handleProfileSaved}
                    />
                  </div>

                  <details className={`mt-3 rounded-xl border p-3 ${tone.subtle}`}>
                    <summary className={`cursor-pointer text-[11px] font-semibold ${tone.panelMuted}`}>Phone override</summary>
                    <div className="mt-2">
                      <p className={`mb-1 text-[11px] ${tone.panelLabel}`}>Save once for future calls.</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          value={phoneInput}
                          onChange={(e) => {
                            setPhoneInput(e.target.value);
                            setPhoneMsg(null);
                          }}
                          placeholder="e.g. +1 (555) 123-4567"
                          className={`min-w-[220px] flex-1 rounded-lg border px-2.5 py-2 text-xs ${tone.input}`}
                        />
                        <Button
                          variant="outline"
                          className={`!min-h-0 h-9 px-3 text-xs ${isDark ? '!border-white/20 !bg-white/10 !text-slate-100 hover:!bg-white/15' : ''}`}
                          onClick={() => void saveCandidatePhoneOverride()}
                          disabled={savingPhone || !currentCandidate}
                        >
                          {savingPhone ? 'Saving...' : 'Save number'}
                        </Button>
                      </div>
                      <p className={`mt-1 text-[10px] ${tone.panelLabel}`}>Normalized for dial: {normalizeDialDestination(phoneInput) || '—'}</p>
                      {currentPhoneInfo?.originalExtractedPhone && (
                        <p className={`mt-1 text-[10px] ${tone.panelLabel}`}>OCR extracted originally: {currentPhoneInfo.originalExtractedPhone}</p>
                      )}
                      {phoneMsg && <p className="mt-1 text-[10px] text-emerald-700">{phoneMsg}</p>}
                    </div>
                  </details>

                  <details className={`mt-2 rounded-xl border p-3 ${tone.subtle}`}>
                    <summary className={`cursor-pointer text-[11px] font-semibold ${tone.panelMuted}`}>Resume links</summary>
                    <div className="mt-2">
                      {selectedResumes.length ? (
                        <div className="space-y-1">
                          {selectedResumes.slice(0, 3).map((resume) => (
                            <a
                              key={resume.id}
                              href={getPipelineResumeOpenInNewTabUrl(resume) || '#'}
                              target="_blank"
                              rel="noreferrer"
                              className={`mr-2 inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs ${tone.actionButton}`}
                            >
                              <ExternalLink size={12} />
                              {resume.original_filename}
                            </a>
                          ))}
                        </div>
                      ) : (
                        <p className={`text-xs ${tone.panelLabel}`}>No resume uploaded yet.</p>
                      )}
                    </div>
                  </details>

                  <details className={`mt-2 rounded-xl border p-3 ${tone.subtle}`}>
                    <summary className={`cursor-pointer text-[11px] font-semibold ${tone.panelMuted}`}>Manual disposition (fallback)</summary>
                    <div className="mt-2 space-y-2">
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
                        {savingDisposition ? 'Saving...' : autoMode ? 'Save + auto advance' : 'Save disposition'}
                      </Button>
                    </div>
                  </details>
                </>
              ) : (
                <p className={`text-sm ${tone.panelMuted}`}>{emptyQueueGuidance}</p>
              )}
            </div>

            <div className={`rounded-xl border p-3 ${tone.subtle}`}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className={`text-[11px] font-semibold uppercase tracking-wide ${tone.panelLabel}`}>Queue carousel</p>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      if (!queueList.length) return;
                      const index = currentQueueIndex <= 0 ? 0 : currentQueueIndex - 1;
                      setSelectedCandidateId(queueList[index]?.id || null);
                    }}
                    className={`rounded-lg border p-1.5 disabled:cursor-not-allowed disabled:opacity-40 ${tone.actionButton}`}
                    disabled={!queueList.length || currentQueueIndex <= 0}
                    aria-label="Previous queue card"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!queueList.length) return;
                      const index = currentQueueIndex < 0 ? 1 : currentQueueIndex + 1;
                      setSelectedCandidateId(queueList[index]?.id || null);
                    }}
                    className={`rounded-lg border p-1.5 disabled:cursor-not-allowed disabled:opacity-40 ${tone.actionButton}`}
                    disabled={!queueList.length || currentQueueIndex >= queueList.length - 1}
                    aria-label="Next queue card"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
              <div className="grid gap-2 md:grid-cols-4">
                {carouselCards.map((candidate) => {
                  const isCenter = candidate.id === currentCandidate?.id;
                  const latest = latestByCandidate.get(candidate.id);
                  const dispositionLabel = latest?.disposition || 'Undisposed';
                  const cardPhoneInfo = readPipelineCandidatePhone(candidate);
                  return (
                    <button
                      key={candidate.id}
                      type="button"
                      onClick={() => setSelectedCandidateId(candidate.id)}
                      className={`rounded-xl border px-3 py-2 text-left transition ${
                        isCenter
                          ? (isDark ? 'border-cyan-300/40 bg-cyan-300/15 shadow-[0_10px_26px_-16px_rgba(56,189,248,0.65)]' : 'border-[#7eb3e7] bg-white shadow-[0_8px_22px_-14px_rgba(38,95,165,0.55)]')
                          : `${tone.doneCard}`
                      }`}
                    >
                      <p className={`truncate text-xs font-semibold ${tone.panelTitle}`}>{candidate.full_name || 'Unknown Candidate'}</p>
                      <p className={`mt-1 text-[10px] ${tone.panelLabel}`}>{cardPhoneInfo.effectivePhone || 'No phone'}</p>
                      <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${isDark ? 'bg-white/10 text-cyan-100' : 'bg-[#edf5ff] text-[#285082]'}`}>
                        {dispositionLabel}
                      </span>
                    </button>
                  );
                })}
                {!carouselCards.length && <p className={`text-xs ${tone.panelLabel}`}>No active queue candidates.</p>}
              </div>
            </div>

            <div>
              <p className={`mb-1 text-[11px] font-semibold uppercase tracking-wide ${tone.panelLabel}`}>Done lane / history</p>
              <div className="grid gap-1.5 md:grid-cols-2">
                {doneList.slice(0, 8).map((candidate) => {
                  const latest = latestByCandidate.get(candidate.id);
                  return (
                    <button
                      key={candidate.id}
                      type="button"
                      onClick={() => setSelectedCandidateId(candidate.id)}
                      className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left transition ${tone.doneCard}`}
                    >
                      <div className="min-w-0 pr-2">
                        <p className={`truncate text-xs font-semibold blur-[0.2px] ${tone.panelTitle}`}>{candidate.full_name || 'Unknown Candidate'}</p>
                        <p className={`truncate text-[10px] ${tone.panelLabel}`}>{latest?.disposition || 'Disposed'}</p>
                      </div>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${isDark ? 'bg-white/12 text-slate-200' : 'bg-slate-100 text-slate-700'}`}>
                        <CheckCircle2 size={11} />
                        Done
                      </span>
                    </button>
                  );
                })}
                {!doneList.length && <p className={`text-xs ${tone.panelLabel}`}>No disposed cards in this lane yet.</p>}
              </div>
            </div>

            <div className={`rounded-2xl border p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] ${tone.recentRail}`}>
              <div className="mb-2 flex items-start justify-between gap-3">
                <div>
                  <p className={`text-[11px] font-semibold uppercase tracking-wide ${tone.panelTitle}`}>Recent call history</p>
                  <p className={`text-[10px] ${tone.panelLabel}`}>Chronological event log for selected candidate</p>
                </div>
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold ${tone.input}`}>
                  <History size={11} />
                  Newest → Older
                </span>
              </div>
              {selectedHistory.length ? (
                <div className="overflow-x-auto pb-1">
                  <div className="inline-flex min-w-full items-stretch gap-2 pr-1">
                    {selectedHistory.map((row, index) => {
                      const meta = readCallRecordMeta(row);
                      return (
                        <motion.article
                          key={row.id}
                          initial={{ opacity: 0, x: 16 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.22, delay: index * 0.03 }}
                          className={`group relative min-h-[132px] w-[250px] shrink-0 rounded-xl border p-3 text-xs backdrop-blur-sm ${
                            isDark
                              ? 'border-cyan-200/20 bg-white/[0.06] shadow-[0_12px_28px_-24px_rgba(56,189,248,0.9)]'
                              : 'border-[#c8def4] bg-white/85 shadow-[0_10px_24px_-22px_rgba(22,76,138,0.7)]'
                          }`}
                        >
                          {index < selectedHistory.length - 1 && (
                            <span className={`pointer-events-none absolute right-[-10px] top-7 h-[2px] w-4 rounded-full ${isDark ? 'bg-cyan-200/45' : 'bg-[#b7d0ec]'}`} aria-hidden="true" />
                          )}
                          <div className="mb-1.5 flex items-center justify-between gap-2">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${isDark ? 'bg-cyan-300/18 text-cyan-100' : 'bg-[#eaf3ff] text-[#24558a]'}`}>{row.disposition}</span>
                            <span className={`text-[10px] ${tone.panelLabel}`}>{formatDateTimeCanadaEastern(row.disposed_at)}</span>
                          </div>
                          <p className={`truncate text-[11px] font-medium ${tone.panelMuted}`}>{row.dialed_number || 'No dialed number logged'}</p>
                          <div className={`mt-2 space-y-1 text-[10px] ${tone.panelLabel}`}>
                            {meta.bookedSubtype && <p>Booked subtype: {meta.bookedSubtype}</p>}
                            {meta.callbackAt && <p>Callback: {formatDateTimeCanadaEastern(meta.callbackAt)}</p>}
                            {!meta.bookedSubtype && !meta.callbackAt && <p>No additional metadata on this call.</p>}
                          </div>
                        </motion.article>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <p className={`rounded-xl border border-dashed px-3 py-2 text-xs ${tone.input}`}>No call history yet.</p>
              )}
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
                {savingDisposition ? 'Saving...' : autoMode ? 'Save + auto advance' : 'Save disposition'}
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
