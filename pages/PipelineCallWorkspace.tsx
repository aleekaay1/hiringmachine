import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, ExternalLink, Phone, RefreshCw, Search, Settings, Video } from 'lucide-react';
import CandidateResumeDetailsCard from '../components/pipeline/CandidateResumeDetailsCard';
import LeadBatchAccordion from '../components/pipeline/LeadBatchAccordion';
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
} from '../services/liveSessionBookedOutcomes';
import {
  buildWebinarRowsByEmail,
  classifyBookedOutcome,
  loadScopedWebinarRowsForViewer,
  type BookedOutcomeBucket,
} from '../services/pipelineBookedOutcomes';
import {
  defaultExpandedGroupKeys,
  groupPipelineCandidatesByBatch,
} from '../services/pipelineLeadGrouping';
import {
  candidateInBatchGroup,
  type DialQueueStartMode,
  type LoadedDialQueue,
  applyDialQueueStartMode,
} from '../services/pipelineDialQueue';
import { consumeDialQueueIntent } from '../services/recruiterLeadPackAnalytics';

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

function matchesDoneLaneSearch(
  candidate: PipelineCandidate,
  disposition: string,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const qDigits = q.replace(/\D/g, '');
  const { effectivePhone } = readPipelineCandidatePhone(candidate);
  const phoneDigits = effectivePhone.replace(/\D/g, '');
  const name = String(candidate.full_name || '').toLowerCase();
  const disp = disposition.toLowerCase();
  const email = String(candidate.email || '').toLowerCase();
  return (
    name.includes(q) ||
    disp.includes(q) ||
    email.includes(q) ||
    effectivePhone.toLowerCase().includes(q) ||
    (qDigits.length >= 3 && phoneDigits.includes(qDigits))
  );
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

const PipelineCallWorkspace: React.FC = () => {
  const [searchParams] = useSearchParams();
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
  const [expandedQueueBatchKeys, setExpandedQueueBatchKeys] = React.useState<Set<string>>(() => new Set());
  const [expandedDoneBatchKeys, setExpandedDoneBatchKeys] = React.useState<Set<string>>(() => new Set());
  const [doneSearch, setDoneSearch] = React.useState('');
  const selectedCandidateIdRef = React.useRef<string | null>(null);
  const appliedDialIntentRef = React.useRef(false);

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

  const queueBatchGroups = React.useMemo(
    () =>
      groupPipelineCandidatesByBatch(queueList, {
        isNew: isCandidateNew,
        isInProgress: (candidate) => !isCandidateNew(candidate),
      }),
    [queueList, isCandidateNew],
  );

  const filteredDoneList = React.useMemo(() => {
    if (!doneSearch.trim()) return doneList;
    return doneList.filter((candidate) => {
      const latest = latestByCandidate.get(candidate.id);
      const disposition = latest?.disposition || 'Disposed';
      return matchesDoneLaneSearch(candidate, disposition, doneSearch);
    });
  }, [doneList, doneSearch, latestByCandidate]);

  const doneBatchGroups = React.useMemo(
    () =>
      groupPipelineCandidatesByBatch(filteredDoneList, {
        isDone: () => true,
      }),
    [filteredDoneList],
  );

  const visibleQueueBatchGroups = React.useMemo(() => {
    if (activeBatchKey === 'all') return queueBatchGroups;
    return queueBatchGroups.filter((group) => group.key === activeBatchKey);
  }, [queueBatchGroups, activeBatchKey]);

  React.useEffect(() => {
    if (!queueBatchGroups.length) return;
    setExpandedQueueBatchKeys((prev) => (prev.size ? prev : defaultExpandedGroupKeys(queueBatchGroups)));
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

  React.useEffect(() => {
    if (!doneBatchGroups.length) return;
    setExpandedDoneBatchKeys((prev) => {
      if (prev.size) return prev;
      const keys = defaultExpandedGroupKeys(doneBatchGroups);
      if (doneBatchGroups.length > 2) keys.clear();
      return keys;
    });
  }, [doneBatchGroups]);

  const toggleQueueBatch = (key: string) => {
    setExpandedQueueBatchKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

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
    setActionMsg(`Loaded ${group.title} into the dial queue.`);
  };

  const resetDialQueue = () => {
    setLoadedDialQueue(null);
    setActiveBatchKey('all');
    setActionMsg('Dial queue reset — showing all batches again.');
  };

  const toggleDoneBatch = (key: string) => {
    setExpandedDoneBatchKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
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

  const batchAccordionTone = React.useMemo(
    () => ({
      header: tone.panelTitle,
      headerMuted: tone.panelMuted,
      panel: tone.subtle,
      badgeNew: 'bg-[#edf5ff] text-[#285082]',
      badgeMuted: isDark ? 'bg-white/10 text-slate-300' : 'bg-slate-100 text-slate-600',
    }),
    [tone, isDark],
  );

  const renderQueueCandidate = (candidate: PipelineCandidate, indexInGroup: number) => {
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
              {indexInGroup + 1}. {candidate.full_name || 'Unknown Candidate'}
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
              <p className={`text-xs ${tone.panelMuted}`}>Pick a candidate, place the call, log the outcome.</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
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
          className="grid gap-4 lg:grid-cols-[minmax(280px,340px)_1fr]"
        >
          <aside className={`rounded-2xl border p-4 ${tone.glassPanel}`} data-tour="call-queue">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <p className={`text-sm font-semibold ${tone.panelTitle}`}>To call</p>
                <p className={`text-xs ${tone.panelMuted}`}>
                  {queueList.length} in queue · {queueBatchGroups.length} batch{queueBatchGroups.length === 1 ? '' : 'es'}
                </p>
              </div>
            </div>
            {loadableBatchGroups.length > 0 && (
              <div className={`mb-3 rounded-xl border p-3 ${tone.subtle}`} data-tour="call-dial-queue-loader">
                <p className={`text-xs font-semibold ${tone.panelTitle}`}>Auto-dial queue</p>
                {loadedDialQueue ? (
                  <div className="mt-2 space-y-2">
                    <p className={`text-[11px] ${tone.panelMuted}`}>
                      Loaded <span className="font-semibold text-[#285082]">{loadedDialQueue.batchTitle}</span>
                      {' · '}
                      {queueList.length} lead{queueList.length === 1 ? '' : 's'}
                      {' · '}
                      {loadedDialQueue.startMode === 'resume' ? 'Resuming after last disposed' : 'Starting from first'}
                    </p>
                    <Button variant="outline" className="!min-h-0 h-8 w-full text-xs" onClick={resetDialQueue}>
                      Reset queue
                    </Button>
                  </div>
                ) : (
                  <div className="mt-2 space-y-2">
                    <select
                      value={selectedLoadBatchKey}
                      onChange={(e) => setSelectedLoadBatchKey(e.target.value)}
                      className={`w-full rounded-lg border px-2.5 py-2 text-xs ${tone.input}`}
                    >
                      <option value="">Select batch…</option>
                      {loadableBatchGroups.map((group) => (
                        <option key={group.key} value={group.key}>
                          {group.title} ({group.items.length})
                        </option>
                      ))}
                    </select>
                    <div className="grid grid-cols-1 gap-1.5">
                      <label className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-[11px] ${dialStartMode === 'first' ? 'border-[#7eb3e7] bg-[#e8f3ff]' : tone.input}`}>
                        <input
                          type="radio"
                          name="dial-start-mode"
                          checked={dialStartMode === 'first'}
                          onChange={() => setDialStartMode('first')}
                        />
                        Start from first lead
                      </label>
                      <label className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-[11px] ${dialStartMode === 'resume' ? 'border-[#7eb3e7] bg-[#e8f3ff]' : tone.input}`}>
                        <input
                          type="radio"
                          name="dial-start-mode"
                          checked={dialStartMode === 'resume'}
                          onChange={() => setDialStartMode('resume')}
                        />
                        Resume after last disposed
                      </label>
                    </div>
                    <Button className="!min-h-0 h-8 w-full text-xs" onClick={loadDialQueue} disabled={!selectedLoadBatchKey}>
                      Load queue
                    </Button>
                  </div>
                )}
              </div>
            )}
            {queueBatchGroups.length > 1 && (
              <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
                <button
                  type="button"
                  onClick={() => setActiveBatchKey('all')}
                  className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
                    activeBatchKey === 'all' ? 'border-[#7eb3e7] bg-[#e8f3ff] text-[#285082]' : tone.actionButton
                  }`}
                >
                  All batches
                </button>
                {queueBatchGroups.map((group) => (
                  <button
                    key={group.key}
                    type="button"
                    onClick={() => setActiveBatchKey(group.key)}
                    className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
                      activeBatchKey === group.key ? 'border-[#7eb3e7] bg-[#e8f3ff] text-[#285082]' : tone.actionButton
                    }`}
                  >
                    {group.batchNumber ? `#${group.batchNumber}` : group.title}
                    {group.newCount > 0 ? ` · ${group.newCount} new` : ''}
                  </button>
                ))}
              </div>
            )}
            <div className="max-h-[min(70vh,640px)] overflow-y-auto pr-1">
              <LeadBatchAccordion
                groups={visibleQueueBatchGroups}
                expandedKeys={expandedQueueBatchKeys}
                onToggle={toggleQueueBatch}
                renderItem={renderQueueCandidate}
                emptyMessage={emptyQueueGuidance}
                tone={batchAccordionTone}
              />
            </div>

            <div className={`mt-4 rounded-xl border p-3 ${tone.subtle}`}>
              <p className={`text-xs font-semibold ${tone.panelTitle}`}>Add your own lead</p>
              <p className={`mt-0.5 text-[11px] ${tone.panelMuted}`}>LinkedIn, referral, or any candidate you found yourself.</p>
              <div className="mt-2 space-y-2">
                <input
                  value={selfLeadName}
                  onChange={(e) => setSelfLeadName(e.target.value)}
                  placeholder="Full name *"
                  className={`w-full rounded-lg border px-2.5 py-2 text-xs ${tone.input}`}
                />
                <input
                  value={selfLeadEmail}
                  onChange={(e) => setSelfLeadEmail(e.target.value)}
                  placeholder="Email"
                  className={`w-full rounded-lg border px-2.5 py-2 text-xs ${tone.input}`}
                />
                <input
                  value={selfLeadPhone}
                  onChange={(e) => setSelfLeadPhone(e.target.value)}
                  placeholder="Phone"
                  className={`w-full rounded-lg border px-2.5 py-2 text-xs ${tone.input}`}
                />
                <select
                  value={selfLeadSource}
                  onChange={(e) => setSelfLeadSource(e.target.value)}
                  className={`w-full rounded-lg border px-2.5 py-2 text-xs ${tone.input}`}
                >
                  <option value="LinkedIn">LinkedIn</option>
                  <option value="Referral">Referral</option>
                  <option value="Indeed">Indeed</option>
                  <option value="Other">Other</option>
                </select>
                <textarea
                  value={selfLeadNotes}
                  onChange={(e) => setSelfLeadNotes(e.target.value)}
                  placeholder="Notes (optional)"
                  rows={2}
                  className={`w-full rounded-lg border px-2.5 py-2 text-xs ${tone.input}`}
                />
                <Button
                  variant="outline"
                  className="!min-h-0 h-8 w-full text-xs"
                  onClick={() => void submitSelfLead()}
                  disabled={savingSelfLead || !selfLeadName.trim()}
                >
                  {savingSelfLead ? 'Adding...' : 'Add to my queue'}
                </Button>
                {selfLeadMsg && (
                  <p className={`text-[11px] ${selfLeadMsg.includes('Added') ? 'text-emerald-700' : 'text-red-600'}`}>
                    {selfLeadMsg}
                  </p>
                )}
              </div>
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
                        data-tour="call-place-button"
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

                  <div className={`rounded-2xl border p-4 ${tone.subtle}`} data-tour="call-phone-field">
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

            <div className={`rounded-2xl border p-4 ${tone.glassPanel}`} data-tour="call-done-panel">
              <div className="mb-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className={`text-sm font-semibold ${tone.panelTitle}`}>Done</p>
                    <p className={`text-xs ${tone.panelMuted}`}>
                      {doneSearch.trim()
                        ? `${filteredDoneList.length} of ${doneList.length} completed`
                        : `${doneList.length} completed`}
                    </p>
                  </div>
                </div>
                <div className="relative">
                  <Search size={13} className={`absolute left-2.5 top-1/2 -translate-y-1/2 ${tone.panelLabel}`} />
                  <input
                    value={doneSearch}
                    onChange={(e) => setDoneSearch(e.target.value)}
                    placeholder="Search name, phone, or disposition"
                    className={`w-full rounded-lg border py-2 pl-8 pr-2 text-xs ${tone.input}`}
                  />
                </div>
              </div>
              <LeadBatchAccordion
                groups={doneBatchGroups}
                expandedKeys={expandedDoneBatchKeys}
                onToggle={toggleDoneBatch}
                compact
                emptyMessage={
                  doneSearch.trim()
                    ? 'No done leads match your search.'
                    : 'Disposed candidates will appear here grouped by batch.'
                }
                tone={batchAccordionTone}
                renderItem={(candidate) => {
                  const latest = latestByCandidate.get(candidate.id);
                  const disposition = latest?.disposition || 'Disposed';
                  const phone = readPipelineCandidatePhone(candidate).effectivePhone || '—';
                  const isSelected = candidate.id === currentCandidate?.id;
                  return (
                    <div
                      key={candidate.id}
                      className={`flex items-center gap-1.5 rounded-xl border px-2 py-1.5 transition ${
                        isSelected ? 'border-[#9dc6ef] bg-[#e8f3ff]' : tone.doneCard
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedCandidateId(candidate.id)}
                        className="min-w-0 flex-1 px-1 py-1 text-left"
                      >
                        <p className={`truncate text-xs font-semibold ${tone.panelTitle}`}>
                          {candidate.full_name || 'Unknown Candidate'}
                          <span className={`ml-1.5 font-normal ${tone.panelMuted}`}>{phone}</span>
                        </p>
                        <p className={`truncate text-[10px] ${tone.panelMuted}`}>{disposition}</p>
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditDispositionModal(candidate)}
                        className={`shrink-0 rounded-lg border px-2 py-1 text-[10px] font-semibold ${tone.actionButton}`}
                        title="Edit disposition"
                      >
                        Edit
                      </button>
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                        <CheckCircle2 size={11} />
                        Done
                      </span>
                    </div>
                  );
                }}
              />
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
