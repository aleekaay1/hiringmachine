import React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  History,
  Mail,
  Phone,
  RefreshCw,
  ScrollText,
  Settings,
  Video,
} from 'lucide-react';
import CallHistorySheet from '../components/pipeline/CallHistorySheet';
import CandidateDispositionHistory from '../components/pipeline/CandidateDispositionHistory';
import CallScriptsDrawer from '../components/pipeline/CallScriptsDrawer';
import CallScriptViewerModal from '../components/pipeline/CallScriptViewerModal';
import CandidateResumeDetailsCard from '../components/pipeline/CandidateResumeDetailsCard';
import CandidateActivityStatsPanel from '../components/pipeline/CandidateActivityStatsPanel';
import PostDispositionEmailModal from '../components/pipeline/PostDispositionEmailModal';
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
  readCallRecordLiveSessionOutcome,
  readPipelineCandidateEmail,
  readPipelineCandidatePhone,
  savePipelineCallDisposition,
  savePipelineCandidateEmailOverride,
  savePipelineCandidatePhoneOverride,
  createPipelineSelfLead,
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
  type LiveSessionRegistrantRow,
} from '../services/liveSessionBookedOutcomes';
import { matchAndPersistLiveSessionForRecord } from '../services/liveSessionOutcomeService';
import {
  buildWebinarRowsByEmail,
  classifyBookedOutcome,
  loadScopedWebinarRowsForViewer,
  type BookedOutcomeBucket,
} from '../services/pipelineBookedOutcomes';
import {
  groupPipelineCandidatesByBatch,
} from '../services/pipelineLeadGrouping';
import {
  candidateInBatchGroup,
  type DialQueueStartMode,
  type LoadedDialQueue,
  applyDialQueueStartMode,
} from '../services/pipelineDialQueue';
import { consumeDialQueueIntent } from '../services/recruiterLeadPackAnalytics';
import { buildCallHistoryRows } from '../services/callHistoryRows';
import {
  listPipelineCallScripts,
  loadOrSeedPipelineCallScripts,
  pickActiveCallScript,
  saveLastUsedCallScriptId,
  type PipelineCallScript,
} from '../services/pipelineCallScripts';

type QueueFilter = 'all' | 'callbacks' | 'not_interested' | 'booked' | 'booked_no_show' | 'booked_didnt_watch';

type CandidateBookedOutcomeMap = Map<string, BookedOutcomeBucket>;

const AUTO_ADVANCE = true;

const WEBINAR_VERIFY_PATH = '/pipeline/webinar-verify';

function sanitizeWebinarQueryValue(value: string, maxLength = 200): string {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]+/g, '')
    .trim()
    .slice(0, maxLength);
}

function webinarVerifyHref(
  candidate: PipelineCandidate,
  overrides?: { email?: string; fullName?: string },
): string {
  const params = new URLSearchParams();
  const email = sanitizeWebinarQueryValue(overrides?.email ?? candidate.email ?? '');
  const fullName = sanitizeWebinarQueryValue(overrides?.fullName ?? candidate.full_name ?? '');
  if (email) params.set('email', email);
  if (fullName) {
    params.set('name', fullName);
    const parts = fullName.split(/\s+/).filter(Boolean);
    if (parts[0]) params.set('first', parts[0]);
    if (parts.length > 1) params.set('last', parts.slice(1).join(' '));
  }
  if (candidate.id) params.set('candidateId', candidate.id);
  const phone = sanitizeWebinarQueryValue(candidate.phone ?? '');
  if (phone) params.set('phone', phone);
  const query = params.toString();
  return `${WEBINAR_VERIFY_PATH}${query ? `?${query}` : ''}`;
}

function openWebinarVerifyTab(
  candidate: PipelineCandidate,
  overrides?: { email?: string; fullName?: string },
): boolean {
  const href = webinarVerifyHref(candidate, overrides);
  if (!href.startsWith(WEBINAR_VERIFY_PATH) || href.includes('://')) return false;
  const opened = window.open(href, '_blank', 'noopener,noreferrer');
  if (!opened) return false;
  try {
    opened.opener = null;
  } catch {
    // noopener feature policy may already detach opener
  }
  return true;
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

function toDatetimeLocalValue(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
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

const SKIP_EMAIL_DISPOSITIONS = new Set(['not interested', 'do not call', 'wrong number']);

const PipelineCallWorkspace: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
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
  const [dispositionModalMode, setDispositionModalMode] = React.useState<'call' | 'edit'>('call');
  const [submitAttempted, setSubmitAttempted] = React.useState(false);
  const [candidates, setCandidates] = React.useState<PipelineCandidate[]>([]);
  const [resumesByCandidate, setResumesByCandidate] = React.useState<Map<string, PipelineResume[]>>(new Map());
  const [records, setRecords] = React.useState<PipelineCallRecord[]>([]);
  const [todaysCallCount, setTodaysCallCount] = React.useState(0);
  const [bookedOutcomeByCandidate, setBookedOutcomeByCandidate] = React.useState<CandidateBookedOutcomeMap>(new Map());
  const [liveRegistrants, setLiveRegistrants] = React.useState<LiveSessionRegistrantRow[]>([]);
  const [currentUserId, setCurrentUserId] = React.useState<string | null>(null);
  const [selfLeadName, setSelfLeadName] = React.useState('');
  const [selfLeadEmail, setSelfLeadEmail] = React.useState('');
  const [selfLeadPhone, setSelfLeadPhone] = React.useState('');
  const [selfLeadSource, setSelfLeadSource] = React.useState('LinkedIn');
  const [selfLeadNotes, setSelfLeadNotes] = React.useState('');
  const [savingSelfLead, setSavingSelfLead] = React.useState(false);
  const [selfLeadMsg, setSelfLeadMsg] = React.useState<string | null>(null);
  const [activeBatchKey, setActiveBatchKey] = React.useState<string | 'all'>('all');
  const [selectedLoadBatchKey, setSelectedLoadBatchKey] = React.useState('');
  const [dialStartMode, setDialStartMode] = React.useState<DialQueueStartMode>('first');
  const [loadedDialQueue, setLoadedDialQueue] = React.useState<LoadedDialQueue | null>(null);
  const [showCallHistory, setShowCallHistory] = React.useState(false);
  const [showCallScriptsDrawer, setShowCallScriptsDrawer] = React.useState(false);
  const [showCallScriptViewer, setShowCallScriptViewer] = React.useState(false);
  const [callScripts, setCallScripts] = React.useState<PipelineCallScript[]>([]);
  const [callScriptsTableMissing, setCallScriptsTableMissing] = React.useState(false);
  const [selectedCallScriptId, setSelectedCallScriptId] = React.useState<string | null>(null);
  const [showQueueSetup, setShowQueueSetup] = React.useState(false);
  const [postEmailCandidate, setPostEmailCandidate] = React.useState<PipelineCandidate | null>(null);
  const [postEmailTo, setPostEmailTo] = React.useState('');
  const [postEmailDisposition, setPostEmailDisposition] = React.useState('');
  const selectedCandidateIdRef = React.useRef<string | null>(null);
  const appliedDialIntentRef = React.useRef(false);
  /** When Place call opens 3CX — used as dial_started_at (not disposition save time). */
  const callPlacedAtRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    selectedCandidateIdRef.current = selectedCandidateId;
  }, [selectedCandidateId]);

  React.useEffect(() => {
    if (!currentUserId) return;
    let cancelled = false;
    void loadOrSeedPipelineCallScripts(currentUserId)
      .then(({ scripts, tableMissing }) => {
        if (cancelled) return;
        setCallScripts(scripts);
        setCallScriptsTableMissing(tableMissing);
        const active = pickActiveCallScript(scripts, currentUserId);
        setSelectedCallScriptId(active?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) {
          setCallScripts([]);
          setSelectedCallScriptId(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [currentUserId]);

  const openCallScriptViewer = React.useCallback(() => {
    if (!callScripts.length) {
      setShowCallScriptsDrawer(true);
      return;
    }
    const active = pickActiveCallScript(callScripts, currentUserId || '') ?? callScripts[0];
    if (active) {
      setSelectedCallScriptId(active.id);
      saveLastUsedCallScriptId(currentUserId || '', active.id);
    }
    setShowCallScriptViewer(true);
  }, [callScripts, currentUserId]);

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
      const liveRegistrantsPromise = loadLiveSessionRegistrantsForMatching().catch(() => [] as LiveSessionRegistrantRow[]);

      const [resumeRows, callRecordRows, todayRows, webinarRows, liveRegRows] = await Promise.all([
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
      setLiveRegistrants(liveRegRows);
      setTodaysCallCount(todayRows.length);
      const rowsByEmail = webinarRows ? buildWebinarRowsByEmail(webinarRows) : new Map();
      const liveSessionByEmail = buildLiveSessionRowsByEmail(liveRegRows);
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

  const dialScopeCandidates = React.useMemo(() => {
    if (!loadedDialQueue) return candidates;
    return candidates.filter((candidate) => candidateInBatchGroup(candidate, loadedDialQueue.batchKey));
  }, [candidates, loadedDialQueue]);

  const filteredCandidates = React.useMemo(() => {
    return dialScopeCandidates.filter((candidate) => {
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
  }, [dialScopeCandidates, queueFilter, latestByCandidate, callbackAtByCandidate, bookedOutcomeByCandidate]);

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
    let queue: PipelineCandidate[];
    if (queueFilter === 'all') {
      queue = undisposedQueue.length > 0 ? undisposedQueue : retryQueue;
    } else if (queueFilter === 'callbacks') {
      queue = [...filteredCandidates]
        .filter((candidate) => normalizeDispositionLabel(candidate.status) !== 'closed')
        .sort((a, b) => {
          const aAt = new Date(callbackAtByCandidate.get(a.id) || '9999-12-31').getTime();
          const bAt = new Date(callbackAtByCandidate.get(b.id) || '9999-12-31').getTime();
          return aAt - bAt;
        });
    } else {
      queue = [];
    }

    if (loadedDialQueue && queue.length) {
      const orderedBatch = [...dialScopeCandidates].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
      queue = applyDialQueueStartMode(queue, orderedBatch, loadedDialQueue.startMode, latestByCandidate);
    }
    return queue;
  }, [
    queueFilter,
    undisposedQueue,
    retryQueue,
    filteredCandidates,
    callbackAtByCandidate,
    loadedDialQueue,
    dialScopeCandidates,
    latestByCandidate,
  ]);

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

  const isCandidateNew = React.useCallback(
    (candidate: PipelineCandidate) => !latestByCandidate.get(candidate.id),
    [latestByCandidate],
  );

  const loadableBatchGroups = React.useMemo(
    () =>
      groupPipelineCandidatesByBatch(candidates, {
        isNew: isCandidateNew,
        isInProgress: (candidate) => !isCandidateNew(candidate),
      }),
    [candidates, isCandidateNew],
  );

  const focusNavigationList = React.useMemo(() => {
    const scope = loadedDialQueue ? dialScopeCandidates : filteredCandidates;
    const ordered = [...scope].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    if (loadedDialQueue && ordered.length) {
      return applyDialQueueStartMode(ordered, ordered, loadedDialQueue.startMode, latestByCandidate);
    }
    const seen = new Set<string>();
    const merged: PipelineCandidate[] = [];
    for (const candidate of [...queueList, ...doneList]) {
      if (seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      merged.push(candidate);
    }
    return merged.length ? merged : ordered;
  }, [
    loadedDialQueue,
    dialScopeCandidates,
    filteredCandidates,
    queueList,
    doneList,
    latestByCandidate,
  ]);

  const currentFocusIndex = React.useMemo(() => {
    if (!selectedCandidateId) return -1;
    return focusNavigationList.findIndex((c) => c.id === selectedCandidateId);
  }, [focusNavigationList, selectedCandidateId]);

  const goToFocusIndex = React.useCallback(
    (index: number) => {
      const target = focusNavigationList[index];
      if (target) setSelectedCandidateId(target.id);
    },
    [focusNavigationList],
  );

  const goToPreviousLead = React.useCallback(() => {
    if (currentFocusIndex > 0) goToFocusIndex(currentFocusIndex - 1);
  }, [currentFocusIndex, goToFocusIndex]);

  const goToNextLead = React.useCallback(() => {
    if (currentFocusIndex >= 0 && currentFocusIndex < focusNavigationList.length - 1) {
      goToFocusIndex(currentFocusIndex + 1);
    }
  }, [currentFocusIndex, focusNavigationList.length, goToFocusIndex]);

  const batchTitleByKey = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const group of loadableBatchGroups) {
      map.set(group.key, group.title);
    }
    return map;
  }, [loadableBatchGroups]);

  const myCallRecords = React.useMemo(() => {
    if (!currentUserId) return records;
    return records.filter((row) => !row.recruiter_user_id || row.recruiter_user_id === currentUserId);
  }, [records, currentUserId]);

  const callHistoryRows = React.useMemo(
    () =>
      buildCallHistoryRows({
        records: myCallRecords,
        candidates,
        resumesByCandidate,
        batchTitleByKey,
      }),
    [myCallRecords, candidates, resumesByCandidate, batchTitleByKey],
  );

  const openLeadFromHistory = React.useCallback(
    (candidateId: string) => {
      setSelectedCandidateId(candidateId);
      setShowCallHistory(false);
    },
    [],
  );

  const openEmailForLead = React.useCallback(
    (candidateId: string) => {
      navigate(`/pipeline/email?candidateId=${encodeURIComponent(candidateId)}`);
    },
    [navigate],
  );

  React.useEffect(() => {
    if (!loadableBatchGroups.length) return;
    if (!selectedLoadBatchKey && loadableBatchGroups[0]) {
      setSelectedLoadBatchKey(loadableBatchGroups[0].key);
    }
  }, [loadableBatchGroups, selectedLoadBatchKey]);

  React.useEffect(() => {
    if (!loadedDialQueue) return;
    const targetId = loadedDialQueue.candidateId?.trim();
    if (targetId) {
      const found = candidates.find((c) => c.id === targetId);
      if (found) {
        setSelectedCandidateId(found.id);
        return;
      }
    }
    if (!queueList.length) return;
    setSelectedCandidateId(queueList[0].id);
  }, [loadedDialQueue?.batchKey, loadedDialQueue?.startMode, loadedDialQueue?.candidateId, queueList, candidates]);

  React.useEffect(() => {
    if (appliedDialIntentRef.current || initialLoading || !loadableBatchGroups.length) return;

    const intent = consumeDialQueueIntent();
    const batchKey = searchParams.get('batch') || intent?.batchKey || '';
    const modeParam = searchParams.get('mode');
    const candidateId =
      searchParams.get('candidateId') || searchParams.get('candidate') || intent?.candidateId || '';
    const startMode: DialQueueStartMode =
      modeParam === 'resume' || intent?.startMode === 'resume' ? 'resume' : 'first';

    if (!batchKey) return;
    const group =
      loadableBatchGroups.find((row) => row.key === batchKey) ||
      (intent?.batchTitle
        ? loadableBatchGroups.find((row) => row.title === intent.batchTitle)
        : undefined);
    if (!group) return;

    appliedDialIntentRef.current = true;
    setLoadedDialQueue({
      batchKey: group.key,
      batchTitle: group.title,
      startMode,
      ...(candidateId.trim() ? { candidateId: candidateId.trim() } : {}),
    });
    setSelectedLoadBatchKey(group.key);
    setActiveBatchKey(group.key);
    setDialStartMode(startMode);
    setActionMsg(
      candidateId.trim()
        ? `Loaded ${group.title} from Lead Manager — selected lead ready to call.`
        : `Loaded ${group.title} from Lead Manager.`,
    );
  }, [initialLoading, loadableBatchGroups, searchParams]);

  const loadDialQueue = () => {
    const group = loadableBatchGroups.find((row) => row.key === selectedLoadBatchKey);
    if (!group) {
      setError('Select a batch to load into the dialer.');
      return;
    }
    setError(null);
    setLoadedDialQueue({
      batchKey: group.key,
      batchTitle: group.title,
      startMode: dialStartMode,
    });
    setActiveBatchKey(group.key);
    setShowQueueSetup(false);
    setActionMsg(`Loaded ${group.title} into the dial queue.`);
  };

  const resetDialQueue = () => {
    setLoadedDialQueue(null);
    setActiveBatchKey('all');
    setActionMsg('Dial queue reset — showing all batches again.');
  };

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
    if (queueFilter === 'all' && undisposedQueue.length === 0 && retryQueue.length === 0) {
      return 'No leads in queue. HR-assigned leads appear here automatically, or add your own below.';
    }
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

  const openEmailForCurrentLead = React.useCallback(() => {
    if (!currentCandidate) return;
    navigate(`/pipeline/email?candidateId=${encodeURIComponent(currentCandidate.id)}`);
  }, [currentCandidate, navigate]);

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
    callPlacedAtRef.current = new Date().toISOString();
    setActionMsg(`Opened 3CX popup for ${candidate.full_name || 'candidate'}.`);
    setSubmitAttempted(false);
    setDispositionModalMode('call');
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

  const openEditDispositionModal = (candidate: PipelineCandidate) => {
    setSelectedCandidateId(candidate.id);
    const latest = latestByCandidate.get(candidate.id);
    setDisposition('');
    setBookedSubtype('');
    setCallbackAtInput('');
    setComment('');
    if (latest) {
      const dispositionLabel = String(latest.disposition || '').trim();
      if (PIPELINE_CALL_DISPOSITIONS.includes(dispositionLabel as PipelineCallDisposition)) {
        setDisposition(dispositionLabel as PipelineCallDisposition);
      }
      setComment(latest.comment || '');
      const meta = readCallRecordMeta(latest);
      const subtype = meta.bookedSubtype || latest.booked_subtype || '';
      if (PIPELINE_BOOKED_SUBTYPES.includes(subtype as PipelineBookedSubtype)) {
        setBookedSubtype(subtype as PipelineBookedSubtype);
      }
      const callbackAt = meta.callbackAt || latest.callback_at;
      if (callbackAt) setCallbackAtInput(toDatetimeLocalValue(callbackAt));
    }
    setSubmitAttempted(false);
    setDispositionModalMode('edit');
    setShowDispositionModal(true);
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

  const submitSelfLead = async () => {
    setSavingSelfLead(true);
    setSelfLeadMsg(null);
    setError(null);
    try {
      const created = await createPipelineSelfLead({
        fullName: selfLeadName,
        email: selfLeadEmail || null,
        phone: selfLeadPhone || null,
        notes: selfLeadNotes || null,
        sourceLabel: selfLeadSource || 'manual',
      });
      setSelfLeadName('');
      setSelfLeadEmail('');
      setSelfLeadPhone('');
      setSelfLeadNotes('');
      setSelfLeadMsg(`Added ${created.full_name || 'lead'} to your queue.`);
      await loadWorkspace('refresh');
      setSelectedCandidateId(created.id);
    } catch (e) {
      setSelfLeadMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingSelfLead(false);
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
    const savedDisposition = disposition;
    const savedCandidate = currentCandidate;
    const savedEmail = emailInput.trim() || currentEmailInfo?.effectiveEmail || '';
    try {
      const nowIso = new Date().toISOString();
      const dialStartedAt = callPlacedAtRef.current || nowIso;
      const saved = await savePipelineCallDisposition({
        candidateId: currentCandidate.id,
        resumeId: selectedResumes[0]?.id ?? null,
        disposition,
        comment,
        dialedNumber,
        dialStartedAt,
        actorLabel: null,
        callbackAt: callbackAtInput || null,
        bookedSubtype: bookedSubtype || null,
        candidateName: currentCandidate.full_name || null,
        candidateEmail: currentCandidate.email || null,
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
      callPlacedAtRef.current = null;
      const latestSaved: PipelineCallRecord = {
        ...saved,
        threecx_metadata: (saved.threecx_metadata && typeof saved.threecx_metadata === 'object')
          ? (saved.threecx_metadata as Record<string, unknown>)
          : {},
      };
      setRecords((prev) => [latestSaved, ...prev.filter((row) => row.id !== latestSaved.id)]);
      setCandidates((prev) =>
        prev.map((row) => {
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
        }),
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
          goToNextLead();
        }
      }
      if (
        dispositionModalMode === 'call' &&
        !SKIP_EMAIL_DISPOSITIONS.has(normalizeDispositionLabel(savedDisposition))
      ) {
        setPostEmailCandidate(savedCandidate);
        setPostEmailTo(savedEmail);
        setPostEmailDisposition(savedDisposition);
      }
      if (savedDisposition === 'Booked' && bookedSubtype === 'Live Session') {
        void matchAndPersistLiveSessionForRecord({
          record: latestSaved,
          candidate: savedCandidate,
          emailOverride: savedEmail,
          registrants: liveRegistrants,
        }).then((outcome) => {
          if (!outcome || outcome.status === 'pending') return;
          setRecords((prev) =>
            prev.map((row) =>
              row.id === latestSaved.id
                ? {
                    ...row,
                    threecx_metadata: {
                      ...(row.threecx_metadata && typeof row.threecx_metadata === 'object'
                        ? (row.threecx_metadata as Record<string, unknown>)
                        : {}),
                      live_session_outcome: outcome.status,
                      live_session_date: outcome.sessionDate,
                      live_session_match_method: outcome.matchMethod,
                      live_session_matched_at: new Date().toISOString(),
                      live_session_attended_zoom: outcome.status === 'attended',
                    },
                  }
                : row,
            ),
          );
        });
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
      <div className={`mx-auto w-full max-w-[1520px] space-y-3 ${tone.page} ${tone.pageTheme}`}>
        <div className={`pointer-events-none absolute -top-24 left-[-10%] h-72 w-72 rounded-full bg-gradient-to-br blur-3xl ${tone.orbA}`} />
        <div className={`pointer-events-none absolute top-40 right-[-8%] h-80 w-80 rounded-full bg-gradient-to-br blur-3xl ${tone.orbB}`} />
        <div className={`pointer-events-none absolute bottom-[-6rem] left-1/3 h-72 w-72 rounded-full bg-gradient-to-tr blur-3xl ${tone.orbC}`} />
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className={`relative rounded-3xl border p-4 ${tone.glassPanel}`}
          data-tour="call-workspace-header"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className={`text-[10px] uppercase tracking-[0.22em] ${tone.panelLabel}`}>Call workspace</p>
              <h1 className={`text-xl font-semibold ${tone.panelTitle}`}>Recruiter Call Workspace</h1>
              <p className={`text-xs ${tone.panelMuted}`}>One lead at a time — place call, save disposition, move to next.</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                data-tour="call-scripts-button"
                onClick={() => setShowCallScriptsDrawer(true)}
                className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold ${tone.actionButton}`}
              >
                <ScrollText size={14} />
                Scripts
                {callScripts.length > 0 && (
                  <span className="rounded-full bg-[#e8f3ff] px-1.5 py-0.5 text-[10px] tabular-nums text-[#285082]">
                    {callScripts.length}
                  </span>
                )}
              </button>
              <button
                type="button"
                data-tour="call-history-button"
                onClick={() => setShowCallHistory(true)}
                className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold ${tone.actionButton}`}
              >
                <History size={14} />
                Call history
                {callHistoryRows.length > 0 && (
                  <span className="rounded-full bg-[#e8f3ff] px-1.5 py-0.5 text-[10px] tabular-nums text-[#285082]">
                    {callHistoryRows.length}
                  </span>
                )}
              </button>
              <Link
                to="/account#recruiter-call-settings"
                data-tour="call-settings-link"
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

        <button
          type="button"
          onClick={() => setShowCallScriptsDrawer(true)}
          className={`fixed right-0 top-[42%] z-20 hidden -translate-y-1/2 flex-col items-center gap-1 rounded-l-2xl border border-r-0 px-2 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] shadow-lg sm:flex ${tone.actionButton}`}
          aria-label="Open call scripts"
        >
          <ScrollText size={16} />
          Script
        </button>

        <p
          data-tour="call-disposition-guide"
          className={`rounded-xl border px-3 py-2 text-xs ${isDark ? 'border-white/10 bg-white/5 text-slate-300' : 'border-[#cfe0f5] bg-[#f0f7ff] text-[#365274]'}`}
        >
          After each call, the disposition window opens — use Open webinar page to register them while on the call, then save disposition when you are done.
        </p>

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
          className="space-y-4"
        >
          <div className={`rounded-2xl border px-4 py-3 ${tone.glassPanel}`} data-tour="call-queue">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className={`text-sm font-semibold ${tone.panelTitle}`}>
                  {loadedDialQueue ? loadedDialQueue.batchTitle : 'Dial queue'}
                </p>
                <p className={`text-xs ${tone.panelMuted}`}>
                  {queueList.length} to call · {doneList.length} done
                  {currentFocusIndex >= 0 && focusNavigationList.length > 0
                    ? ` · lead ${currentFocusIndex + 1} of ${focusNavigationList.length}`
                    : ''}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {loadedDialQueue ? (
                  <Button variant="outline" className="!min-h-0 h-8 px-3 text-xs" onClick={resetDialQueue}>
                    Reset queue
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    className="!min-h-0 h-8 px-3 text-xs"
                    onClick={() => setShowQueueSetup((v) => !v)}
                  >
                    {showQueueSetup ? 'Hide setup' : 'Load batch'}
                  </Button>
                )}
              </div>
            </div>

            {showQueueSetup && !loadedDialQueue && loadableBatchGroups.length > 0 && (
              <div className={`mt-3 rounded-xl border p-3 ${tone.subtle}`} data-tour="call-dial-queue-loader">
                <div className="grid gap-2 md:grid-cols-[1fr_auto_auto] md:items-end">
                  <div>
                    <label className={`text-[11px] font-semibold ${tone.panelLabel}`}>Batch</label>
                    <select
                      value={selectedLoadBatchKey}
                      onChange={(e) => setSelectedLoadBatchKey(e.target.value)}
                      className={`mt-1 w-full rounded-lg border px-2.5 py-2 text-xs ${tone.input}`}
                    >
                      <option value="">Select batch…</option>
                      {loadableBatchGroups.map((group) => (
                        <option key={group.key} value={group.key}>
                          {group.title} ({group.items.length})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <label className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-[11px] ${dialStartMode === 'first' ? 'border-[#7eb3e7] bg-[#e8f3ff]' : tone.input}`}>
                      <input type="radio" name="dial-start-mode" checked={dialStartMode === 'first'} onChange={() => setDialStartMode('first')} />
                      First
                    </label>
                    <label className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-[11px] ${dialStartMode === 'resume' ? 'border-[#7eb3e7] bg-[#e8f3ff]' : tone.input}`}>
                      <input type="radio" name="dial-start-mode" checked={dialStartMode === 'resume'} onChange={() => setDialStartMode('resume')} />
                      Resume
                    </label>
                  </div>
                  <Button className="!min-h-0 h-9 px-4 text-xs" onClick={loadDialQueue} disabled={!selectedLoadBatchKey}>
                    Load queue
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-stretch gap-2 md:gap-3">
            <button
              type="button"
              onClick={goToPreviousLead}
              disabled={currentFocusIndex <= 0}
              className={`hidden shrink-0 self-center rounded-2xl border p-3 transition sm:inline-flex sm:flex-col sm:items-center sm:justify-center sm:min-h-[120px] ${
                currentFocusIndex <= 0 ? 'cursor-not-allowed opacity-40' : tone.actionButton
              }`}
              aria-label="Previous lead"
            >
              <ChevronLeft size={28} />
              <span className="mt-1 text-[10px] font-semibold uppercase tracking-wide">Prev</span>
            </button>

            <div className={`min-w-0 flex-1 rounded-2xl border p-5 md:p-6 ${tone.glassPanel}`}>
              {currentCandidate ? (
                <div className="space-y-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className={`text-[10px] uppercase tracking-[0.2em] ${tone.panelLabel}`}>Current lead</p>
                        {currentFocusIndex >= 0 && (
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${tone.subtle}`}>
                            {currentFocusIndex + 1} / {focusNavigationList.length}
                          </span>
                        )}
                        {latestByCandidate.get(currentCandidate.id) && (
                          <button
                            type="button"
                            onClick={() => openEditDispositionModal(currentCandidate)}
                            className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${tone.actionButton}`}
                          >
                            Edit disposition
                          </button>
                        )}
                      </div>
                      <h2 className={`mt-1 text-2xl font-semibold ${tone.panelTitle}`}>
                        {currentCandidate.full_name || 'Unknown Candidate'}
                      </h2>
                      {currentCandidate.journey_stage && (
                        <p className={`mt-1 text-xs ${tone.panelLabel}`}>Stage: {currentCandidate.journey_stage}</p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        className="!min-h-0 h-11 px-5"
                        data-tour="call-place-button"
                        onClick={() => void placeCall(currentCandidate, phoneInput)}
                      >
                        <Phone size={17} className="mr-2" />
                        Place call
                      </Button>
                      <button
                        type="button"
                        onClick={openEmailForCurrentLead}
                        className={`inline-flex h-11 items-center gap-2 rounded-xl border px-4 text-sm font-semibold ${tone.actionButton}`}
                        title="Open email workspace"
                      >
                        <Mail size={16} />
                        Email
                      </button>
                      <a
                        href={webinarVerifyHref(currentCandidate, { email: emailInput, fullName: currentCandidate.full_name || '' })}
                        target="_blank"
                        rel="noreferrer"
                        className={`inline-flex h-11 items-center gap-2 rounded-xl border px-4 text-sm font-semibold ${tone.actionButton}`}
                      >
                        <Video size={16} />
                        Webinar
                        <ExternalLink size={12} className="opacity-70" />
                      </a>
                    </div>
                  </div>

                  <div className="flex gap-2 sm:hidden">
                    <button type="button" onClick={goToPreviousLead} disabled={currentFocusIndex <= 0} className={`flex-1 rounded-xl border py-2 text-xs font-semibold ${tone.actionButton} ${currentFocusIndex <= 0 ? 'opacity-40' : ''}`}>
                      ← Previous
                    </button>
                    <button type="button" onClick={goToNextLead} disabled={currentFocusIndex >= focusNavigationList.length - 1} className={`flex-1 rounded-xl border py-2 text-xs font-semibold ${tone.actionButton} ${currentFocusIndex >= focusNavigationList.length - 1 ? 'opacity-40' : ''}`}>
                      Next →
                    </button>
                  </div>

                  <CandidateResumeDetailsCard candidate={currentCandidate} resumes={selectedResumes} tone={tone} />

                  <CandidateActivityStatsPanel
                    candidate={currentCandidate}
                    records={records}
                    registrants={liveRegistrants}
                    tone={tone}
                  />

                  <CandidateDispositionHistory
                    candidateId={currentCandidate.id}
                    records={myCallRecords}
                    tone={tone}
                  />

                  {latestByCandidate.get(currentCandidate.id) && (
                    (() => {
                      const latest = latestByCandidate.get(currentCandidate.id)!;
                      const liveOutcome = readCallRecordLiveSessionOutcome(latest);
                      if (!liveOutcome.isLiveSessionBooked) return null;
                      const statusLabel =
                        liveOutcome.status === 'attended'
                          ? 'Live session show'
                          : liveOutcome.status === 'scheduled'
                            ? 'Live session booked'
                            : liveOutcome.status === 'no_show'
                              ? 'Live session no-show'
                              : 'Matching live session…';
                      return (
                        <p className={`rounded-xl border px-3 py-2 text-xs ${tone.subtle} ${tone.panelMuted}`}>
                          {statusLabel}
                          {liveOutcome.sessionDate ? ` · ${liveOutcome.sessionDate}` : ''}
                          {liveOutcome.matchMethod ? ` · matched by ${liveOutcome.matchMethod}` : ''}
                        </p>
                      );
                    })()
                  )}

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className={`rounded-2xl border p-4 ${tone.subtle}`} data-tour="call-phone-field">
                      <p className={`mb-2 text-xs font-semibold uppercase tracking-wide ${tone.panelLabel}`}>Phone</p>
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
                        <Button variant="outline" className="!min-h-0 h-10 shrink-0 px-4 text-sm" onClick={() => void saveCandidatePhoneOverride()} disabled={savingPhone}>
                          {savingPhone ? 'Saving…' : 'Save'}
                        </Button>
                      </div>
                      <p className={`mt-2 text-[11px] ${tone.panelLabel}`}>Dial: {normalizeDialDestination(phoneInput) || '—'}</p>
                      {phoneMsg && <p className="mt-1 text-xs text-emerald-700">{phoneMsg}</p>}
                    </div>

                    <div className={`rounded-2xl border p-4 ${tone.subtle}`}>
                      <p className={`mb-2 text-xs font-semibold uppercase tracking-wide ${tone.panelLabel}`}>Email</p>
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
                        <Button variant="outline" className="!min-h-0 h-10 shrink-0 px-4 text-sm" onClick={() => void saveCandidateEmailOverride()} disabled={savingEmail}>
                          {savingEmail ? 'Saving…' : 'Save'}
                        </Button>
                      </div>
                      {emailMsg && <p className={`mt-1 text-xs ${emailMsg.startsWith('Corrected') ? 'text-emerald-700' : 'text-red-600'}`}>{emailMsg}</p>}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="py-8 text-center">
                  <p className={`text-sm ${tone.panelMuted}`}>{emptyQueueGuidance}</p>
                  {loadableBatchGroups.length > 0 && !loadedDialQueue && (
                    <Button className="mt-4" onClick={() => setShowQueueSetup(true)}>
                      Load a batch to start
                    </Button>
                  )}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={goToNextLead}
              disabled={currentFocusIndex < 0 || currentFocusIndex >= focusNavigationList.length - 1}
              className={`hidden shrink-0 self-center rounded-2xl border p-3 transition sm:inline-flex sm:flex-col sm:items-center sm:justify-center sm:min-h-[120px] ${
                currentFocusIndex < 0 || currentFocusIndex >= focusNavigationList.length - 1
                  ? 'cursor-not-allowed opacity-40'
                  : tone.actionButton
              }`}
              aria-label="Next lead"
            >
              <ChevronRight size={28} />
              <span className="mt-1 text-[10px] font-semibold uppercase tracking-wide">Next</span>
            </button>
          </div>

          <details className={`rounded-2xl border ${tone.glassPanel}`}>
            <summary className={`cursor-pointer list-none px-4 py-3 text-sm font-semibold ${tone.panelTitle}`}>
              Add your own lead
            </summary>
            <div className={`border-t px-4 py-3 ${tone.subtle}`}>
              <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                <input value={selfLeadName} onChange={(e) => setSelfLeadName(e.target.value)} placeholder="Full name *" className={`rounded-lg border px-2.5 py-2 text-xs ${tone.input}`} />
                <input value={selfLeadEmail} onChange={(e) => setSelfLeadEmail(e.target.value)} placeholder="Email" className={`rounded-lg border px-2.5 py-2 text-xs ${tone.input}`} />
                <input value={selfLeadPhone} onChange={(e) => setSelfLeadPhone(e.target.value)} placeholder="Phone" className={`rounded-lg border px-2.5 py-2 text-xs ${tone.input}`} />
                <select value={selfLeadSource} onChange={(e) => setSelfLeadSource(e.target.value)} className={`rounded-lg border px-2.5 py-2 text-xs ${tone.input}`}>
                  <option value="LinkedIn">LinkedIn</option>
                  <option value="Referral">Referral</option>
                  <option value="Indeed">Indeed</option>
                  <option value="Other">Other</option>
                </select>
                <textarea value={selfLeadNotes} onChange={(e) => setSelfLeadNotes(e.target.value)} placeholder="Notes" rows={1} className={`rounded-lg border px-2.5 py-2 text-xs md:col-span-2 ${tone.input}`} />
                <Button variant="outline" className="!min-h-0 h-9 text-xs" onClick={() => void submitSelfLead()} disabled={savingSelfLead || !selfLeadName.trim()}>
                  {savingSelfLead ? 'Adding…' : 'Add to queue'}
                </Button>
              </div>
              {selfLeadMsg && <p className={`mt-2 text-[11px] ${selfLeadMsg.includes('Added') ? 'text-emerald-700' : 'text-red-600'}`}>{selfLeadMsg}</p>}
            </div>
          </details>
        </motion.div>

        <CallHistorySheet
          open={showCallHistory}
          rows={callHistoryRows}
          registrants={liveRegistrants}
          candidates={candidates}
          onClose={() => setShowCallHistory(false)}
          onCallLead={openLeadFromHistory}
          onEmailLead={openEmailForLead}
          tone={tone}
        />

        {currentUserId && (
          <CallScriptsDrawer
            open={showCallScriptsDrawer}
            userId={currentUserId}
            scripts={callScripts}
            selectedScriptId={selectedCallScriptId}
            tableMissing={callScriptsTableMissing}
            onClose={() => setShowCallScriptsDrawer(false)}
            onScriptsChange={(scripts, selectedId) => {
              setCallScripts(scripts);
              setSelectedCallScriptId(selectedId);
            }}
            tone={tone}
          />
        )}

        <CallScriptViewerModal
          open={showCallScriptViewer}
          scripts={callScripts}
          activeScriptId={selectedCallScriptId}
          onSelectScript={(scriptId) => {
            setSelectedCallScriptId(scriptId);
            if (currentUserId) saveLastUsedCallScriptId(currentUserId, scriptId);
          }}
          onClose={() => setShowCallScriptViewer(false)}
          tone={tone}
        />

        {postEmailCandidate && (
          <PostDispositionEmailModal
            open={Boolean(postEmailCandidate)}
            candidate={postEmailCandidate}
            toEmail={postEmailTo}
            disposition={postEmailDisposition}
            onClose={() => setPostEmailCandidate(null)}
          />
        )}

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
              role="presentation"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) event.preventDefault();
              }}
            >
            <motion.div
              initial={{ opacity: 0, y: 14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              className={`w-full max-w-xl space-y-3 rounded-2xl border p-4 shadow-2xl ${tone.glassPanel}`}
              data-tour="call-disposition-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="call-disposition-modal-title"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className={`text-xs ${tone.panelLabel}`}>
                    {dispositionModalMode === 'edit' ? 'Update disposition' : 'Post-call disposition'}
                  </p>
                  <h3 id="call-disposition-modal-title" className={`text-base font-semibold ${tone.panelTitle}`}>
                    {currentCandidate.full_name || 'Candidate'}
                  </h3>
                  <p className={`text-[11px] ${tone.panelLabel}`}>Dialed number: {dialNumberPreview || 'No dialable number'}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    data-tour="call-disposition-script"
                    onClick={openCallScriptViewer}
                    title="Open your call script"
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${tone.actionButton}`}
                  >
                    <ScrollText size={14} />
                    Script
                  </button>
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

              <div className="flex items-stretch gap-2 pt-1" data-tour="call-disposition-webinar">
                <Button
                  className="min-w-0 flex-1"
                  onClick={() => void saveDisposition()}
                  disabled={savingDisposition || !currentCandidate}
                >
                  {savingDisposition ? 'Saving...' : dispositionModalMode === 'edit' ? 'Update disposition' : 'Save disposition'}
                </Button>
                <button
                  type="button"
                  title="Open webinar verify in a new tab (this window stays open)"
                  onClick={() => {
                    const opened = openWebinarVerifyTab(currentCandidate, {
                      email: emailInput,
                      fullName: currentCandidate.full_name || '',
                    });
                    if (!opened) {
                      setError('Pop-up blocked. Allow pop-ups for this site to open webinar verify.');
                    }
                  }}
                  className="inline-flex w-[9.5rem] shrink-0 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                >
                  <Video size={14} />
                  Webinar
                  <ExternalLink size={11} className="opacity-80" />
                </button>
              </div>
              <p className={`text-center text-[10px] ${tone.panelMuted}`}>
                Webinar opens in a new tab — keep this window open to save disposition when done.
              </p>
            </motion.div>
          </motion.div>
          )}
        </AnimatePresence>
      </div>
    </PipelineAuthShell>
  );
};

export default PipelineCallWorkspace;
