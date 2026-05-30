import React from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Phone, RefreshCw } from 'lucide-react';
import PipelineAuthShell from '../components/PipelineAuthShell';
import { Button } from '../components/UI';
import {
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
  const [loading, setLoading] = React.useState(false);
  const [savingSettings, setSavingSettings] = React.useState(false);
  const [savingDisposition, setSavingDisposition] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [actionMsg, setActionMsg] = React.useState<string | null>(null);
  const [autoMode, setAutoMode] = React.useState(true);
  const [queueFilter, setQueueFilter] = React.useState<QueueFilter>('all');
  const [agentExtension, setAgentExtension] = React.useState('');
  const [dailyUploadTarget, setDailyUploadTarget] = React.useState<number | ''>('');
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

  const [candidates, setCandidates] = React.useState<PipelineCandidate[]>([]);
  const [resumesByCandidate, setResumesByCandidate] = React.useState<Map<string, PipelineResume[]>>(new Map());
  const [records, setRecords] = React.useState<PipelineCallRecord[]>([]);
  const [todaysCallCount, setTodaysCallCount] = React.useState(0);
  const [bookedOutcomeByCandidate, setBookedOutcomeByCandidate] = React.useState<CandidateBookedOutcomeMap>(new Map());
  const [passSkippedCandidateIds, setPassSkippedCandidateIds] = React.useState<string[]>([]);

  const loadWorkspace = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ data: auth }, profile, settings, candidateRows] = await Promise.all([
        supabase.auth.getUser(),
        getCurrentUserProfile().catch(() => null),
        getPipelineUserCallSettings().catch(() => null),
        listPipelineManualCandidates(),
      ]);
      const uid = auth.user?.id ?? null;
      setAgentExtension(settings?.extension || '');
      setDailyUploadTarget(settings?.daily_upload_target ?? '');
      const openRows = candidateRows
        .filter((c) => String(c.status || '').toLowerCase() !== 'closed')
        .sort((a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime());
      setCandidates(openRows);

      const candidateIds = openRows.map((c) => c.id);
      if (candidateIds.length === 0) {
        setResumesByCandidate(new Map());
        setRecords([]);
        setSelectedCandidateId(null);
        setTodaysCallCount(0);
        setBookedOutcomeByCandidate(new Map());
        return;
      }

      const [resumeRows, callRecordRows, todayRows] = await Promise.all([
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
      try {
        const scopedRows = await loadScopedWebinarRowsForViewer({
          role: profile?.role ?? null,
          viewerEmail: auth.user?.email ?? profile?.email ?? null,
          viewerFullName: profile?.full_name ?? null,
        });
        const rowsByEmail = buildWebinarRowsByEmail(scopedRows);
        const latest = latestRecordByCandidate(callRecordRows);
        const bookedMap = new Map<string, BookedOutcomeBucket>();
        for (const candidate of openRows) {
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
      } catch {
        setBookedOutcomeByCandidate(new Map());
      }
      if (!selectedCandidateId || !openRows.some((row) => row.id === selectedCandidateId)) {
        setSelectedCandidateId(openRows[0]?.id ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [selectedCandidateId]);

  React.useEffect(() => {
    void loadWorkspace();
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

  const baseQueue = React.useMemo(() => {
    const now = Date.now();
    const skipped = new Set(passSkippedCandidateIds);
    const visible = candidates.filter((candidate) => {
      if (queueFilter !== 'callbacks' && queueFilter !== 'booked_no_show' && queueFilter !== 'booked_didnt_watch' && skipped.has(candidate.id)) {
        return false;
      }
      const latest = latestByCandidate.get(candidate.id);
      if (!latest) return queueFilter === 'all';
      const d = String(latest.disposition || '').toLowerCase();
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

    if (queueFilter === 'callbacks') {
      return [...visible].sort((a, b) => {
        const aAt = new Date(callbackAtByCandidate.get(a.id) || '9999-12-31').getTime();
        const bAt = new Date(callbackAtByCandidate.get(b.id) || '9999-12-31').getTime();
        return aAt - bAt;
      });
    }

    if (queueFilter !== 'all') return visible;

    const dueCallbacks: PipelineCandidate[] = [];
    const remaining: PipelineCandidate[] = [];
    for (const candidate of visible) {
      const callbackAt = callbackAtByCandidate.get(candidate.id);
      if (callbackAt && new Date(callbackAt).getTime() <= now) dueCallbacks.push(candidate);
      else remaining.push(candidate);
    }
    return [...dueCallbacks, ...remaining];
  }, [candidates, queueFilter, latestByCandidate, passSkippedCandidateIds, callbackAtByCandidate, bookedOutcomeByCandidate]);

  const queueCap = React.useMemo(() => {
    if (dailyUploadTarget === '' || Number(dailyUploadTarget) <= 0) return null;
    return Math.max(0, Number(dailyUploadTarget) - todaysCallCount);
  }, [dailyUploadTarget, todaysCallCount]);

  const queueList = React.useMemo(() => {
    if (queueCap == null) return baseQueue;
    return baseQueue.slice(0, queueCap);
  }, [baseQueue, queueCap]);

  const queueStateLabel = React.useMemo(() => {
    if (queueFilter === 'all') return 'All queue (callbacks due first)';
    if (queueFilter === 'callbacks') return 'Callback queue';
    if (queueFilter === 'booked_no_show') return 'Booked no show (best-effort)';
    if (queueFilter === 'booked_didnt_watch') return "Booked didn't watch (best-effort)";
    if (queueFilter === 'booked') return 'Booked outcomes';
    if (queueFilter === 'not_interested') return 'Not interested / do not call';
    return 'Queue';
  }, [queueFilter]);

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
    if (passSkippedCandidateIds.length > 0) {
      return 'Current pass is complete for this queue. Use "Reset pass" to review skipped candidates again.';
    }
    return 'Queue is empty for selected filters/cap.';
  }, [queueFilter, queueCap, passSkippedCandidateIds.length]);

  const currentCandidate = React.useMemo(() => {
    if (!queueList.length) return null;
    return queueList.find((c) => c.id === selectedCandidateId) || queueList[0];
  }, [queueList, selectedCandidateId]);
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

  const nextUp = React.useMemo(
    () => queueList.filter((c) => c.id !== currentCandidate?.id).slice(0, 4),
    [queueList, currentCandidate?.id],
  );

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

  const saveSettings = async () => {
    setSavingSettings(true);
    setActionMsg(null);
    try {
      await savePipelineUserCallSettings({
        extension: agentExtension,
        dailyUploadTarget: dailyUploadTarget === '' ? null : Number(dailyUploadTarget),
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
      await savePipelineCallDisposition({
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
      setActionMsg('Disposition saved.');
      setDisposition('');
      setBookedSubtype('');
      setCallbackAtInput('');
      setComment('');
      setSubmitAttempted(false);
      setShowDispositionModal(false);
      const currentId = currentCandidate.id;
      setPassSkippedCandidateIds((prev) => (prev.includes(currentId) ? prev : [...prev, currentId]));
      await loadWorkspace();
      if (autoMode) {
        setSelectedCandidateId(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
      <div className="mx-auto w-full max-w-[1520px] p-4 space-y-4">
        <div className="rounded-3xl border border-[#d5e5f8] bg-white/80 backdrop-blur-xl p-4 shadow-[0_18px_45px_-28px_rgba(11,27,52,0.35)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold text-[#0B1B34]">Recruiter Call Workspace</h1>
              <p className="text-xs text-[#365274]">Call, then disposition in the popup. Keep moving through queue.</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setAutoMode((v) => !v)}
                className={`rounded-xl px-3 py-2 text-xs font-semibold border ${
                  autoMode
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                    : 'border-slate-300 bg-white text-slate-700'
                }`}
              >
                {autoMode ? 'Auto mode: ON' : 'Auto mode: OFF'}
              </button>
              <Button variant="outline" className="!min-h-0 h-9 px-3 text-xs" onClick={() => void loadWorkspace()} disabled={loading}>
                <RefreshCw size={14} className={loading ? 'mr-1 animate-spin' : 'mr-1'} />
                Refresh queue
              </Button>
            </div>
          </div>
        </div>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        {actionMsg && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{actionMsg}</div>}

        <div className="rounded-2xl border border-[#d8e8fa] bg-white/85 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-[#2f4f76]">
            <span className="rounded-full bg-[#edf5ff] px-2.5 py-1 font-semibold text-[#0B1B34]">Queue: {queueList.length}</span>
            <span className="rounded-full border border-[#c7ddf5] bg-white px-2.5 py-1">Filter: {queueStateLabel}</span>
            <span className="rounded-full border border-[#c7ddf5] bg-white px-2.5 py-1">Mode: {autoMode ? 'Auto advance' : 'Manual select'}</span>
            <span className="rounded-full border border-[#c7ddf5] bg-white px-2.5 py-1">Cap: {queueCapStatus}</span>
            {currentCandidate && (
              <span className="rounded-full border border-[#c7ddf5] bg-white px-2.5 py-1">Current: {currentCandidate.full_name || 'Unknown Candidate'}</span>
            )}
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[260px_1fr]">
          <aside className="rounded-2xl border border-[#d8e8fa] bg-white/80 p-3 space-y-3">
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#42658d]">Queue filters</p>
              <button
                type="button"
                onClick={() => setQueueFilter('all')}
                className={`mb-1 w-full rounded-lg border px-2 py-2 text-left text-xs ${
                  queueFilter === 'all' ? 'border-[#9dc6ef] bg-[#e8f3ff] text-[#0B1B34]' : 'border-slate-200 bg-white text-slate-600'
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
                    queueFilter === item.id ? 'border-[#9dc6ef] bg-[#e8f3ff] text-[#0B1B34]' : 'border-slate-200 bg-white text-slate-600'
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
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#42658d]">Callbacks</p>
              <div className="max-h-[320px] space-y-1.5 overflow-auto">
                {callbackRows.map((row) => {
                  const isDue = new Date(row.callbackAt).getTime() <= Date.now();
                  return (
                    <button
                      key={`${row.candidateId}-${row.callbackAt}`}
                      type="button"
                      onClick={() => setSelectedCandidateId(row.candidateId)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-left hover:bg-slate-50"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-xs font-semibold text-slate-800">{row.candidateName}</p>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            isDue ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {isDue ? 'Due' : 'Upcoming'}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-500">{formatDateTimeCanadaEastern(row.callbackAt)}</p>
                    </button>
                  );
                })}
                {!callbackRows.length && (
                  <p className="rounded-lg border border-dashed border-slate-300 p-2 text-[11px] text-slate-500">No callbacks logged yet.</p>
                )}
              </div>
            </div>

            <details className="rounded-xl border border-[#dce9f8] bg-[#f8fbff] p-2.5" open>
              <summary className="cursor-pointer text-[11px] font-semibold text-[#0B1B34]">Settings</summary>
              <div className="mt-2 space-y-2">
                <label className="block text-[11px] text-[#365274]">
                  Daily target
                  <input
                    type="number"
                    min={0}
                    value={dailyUploadTarget}
                    onChange={(e) => setDailyUploadTarget(e.target.value ? Number(e.target.value) : '')}
                    className="mt-1 w-full rounded-lg border border-[#c7ddf5] px-2 py-1.5 text-xs"
                  />
                </label>
                <label className="block text-[11px] text-[#365274]">
                  Extension
                  <input
                    value={agentExtension}
                    onChange={(e) => setAgentExtension(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[#c7ddf5] px-2 py-1.5 text-xs"
                  />
                </label>
                <Button variant="outline" className="!min-h-0 h-8 w-full text-xs" onClick={() => void saveSettings()} disabled={savingSettings}>
                  {savingSettings ? 'Saving...' : 'Save settings'}
                </Button>
                <p className="text-[10px] text-[#4b6f98]">Today calls: {todaysCallCount}</p>
              </div>
            </details>

            <details className="rounded-xl border border-[#dce9f8] bg-white p-2.5">
              <summary className="cursor-pointer text-[11px] font-semibold text-[#0B1B34]">Utilities</summary>
              <div className="mt-2 space-y-2">
                <Link
                  to="/pipeline"
                  className="block rounded-lg border border-[#b8d2ef] bg-white px-3 py-2 text-center text-xs text-[#0B1B34] hover:bg-[#f2f8ff]"
                >
                  Open legacy mode
                </Link>
                <Button
                  variant="outline"
                  className="!min-h-0 h-9 w-full px-3 text-xs"
                  onClick={() => setPassSkippedCandidateIds([])}
                  disabled={!passSkippedCandidateIds.length}
                >
                  Reset pass
                </Button>
              </div>
            </details>
          </aside>

          <section className="rounded-2xl border border-[#d8e8fa] bg-white/85 p-4 space-y-3">
            <div className="rounded-xl border border-[#deebf9] bg-[#f8fbff] p-3">
              {currentCandidate ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-semibold text-[#0B1B34]">{currentCandidate.full_name || 'Unknown Candidate'}</h2>
                      <p className="text-xs text-[#4c6c92]">
                        {currentPhoneInfo?.effectivePhone || 'No phone'} {currentCandidate.email ? `· ${currentCandidate.email}` : ''}
                      </p>
                    </div>
                    <Button className="!min-h-0 h-10 px-4 text-sm" onClick={() => void placeCall(currentCandidate, phoneInput)}>
                      <Phone size={14} className="mr-1" />
                      Place call
                    </Button>
                  </div>

                  <details className="mt-3 rounded-xl border border-[#dbe9f8] bg-white p-3">
                    <summary className="cursor-pointer text-[11px] font-semibold text-[#43658e]">Phone override</summary>
                    <div className="mt-2">
                      <p className="mb-1 text-[11px] text-[#43658e]">Save once for future calls.</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          value={phoneInput}
                          onChange={(e) => {
                            setPhoneInput(e.target.value);
                            setPhoneMsg(null);
                          }}
                          placeholder="e.g. +1 (555) 123-4567"
                          className="min-w-[220px] flex-1 rounded-lg border border-[#c7ddf5] px-2.5 py-2 text-xs"
                        />
                        <Button
                          variant="outline"
                          className="!min-h-0 h-9 px-3 text-xs"
                          onClick={() => void saveCandidatePhoneOverride()}
                          disabled={savingPhone || !currentCandidate}
                        >
                          {savingPhone ? 'Saving...' : 'Save number'}
                        </Button>
                      </div>
                      <p className="mt-1 text-[10px] text-[#5b7fa7]">Normalized for dial: {normalizeDialDestination(phoneInput) || '—'}</p>
                      {currentPhoneInfo?.originalExtractedPhone && (
                        <p className="mt-1 text-[10px] text-slate-500">OCR extracted originally: {currentPhoneInfo.originalExtractedPhone}</p>
                      )}
                      {phoneMsg && <p className="mt-1 text-[10px] text-emerald-700">{phoneMsg}</p>}
                    </div>
                  </details>

                  <details className="mt-2 rounded-xl border border-[#dbe9f8] bg-white p-3">
                    <summary className="cursor-pointer text-[11px] font-semibold text-[#43658e]">Resume links</summary>
                    <div className="mt-2">
                      {selectedResumes.length ? (
                        <div className="space-y-1">
                          {selectedResumes.slice(0, 3).map((resume) => (
                            <a
                              key={resume.id}
                              href={getPipelineResumeOpenInNewTabUrl(resume) || '#'}
                              target="_blank"
                              rel="noreferrer"
                              className="mr-2 inline-flex items-center gap-1 rounded-lg border border-[#c7ddf5] bg-white px-2 py-1 text-xs text-[#0B1B34]"
                            >
                              <ExternalLink size={12} />
                              {resume.original_filename}
                            </a>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500">No resume uploaded yet.</p>
                      )}
                    </div>
                  </details>

                  <details className="mt-2 rounded-xl border border-[#dbe9f8] bg-white p-3">
                    <summary className="cursor-pointer text-[11px] font-semibold text-[#43658e]">Manual disposition (fallback)</summary>
                    <div className="mt-2 space-y-2">
                      <label className="block text-xs text-[#365274]">
                        Disposition
                        <select
                          value={disposition}
                          onChange={(e) => setDisposition(e.target.value as PipelineCallDisposition)}
                          className="mt-1 w-full rounded-lg border border-[#c7ddf5] px-2 py-2 text-xs"
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
                        <label className="block text-xs text-[#365274]">
                          Booked subtype <span className="text-red-600">*</span>
                          <select
                            value={bookedSubtype}
                            onChange={(e) => setBookedSubtype(e.target.value as PipelineBookedSubtype)}
                            className="mt-1 w-full rounded-lg border border-[#c7ddf5] px-2 py-2 text-xs"
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
                        <label className="block text-xs text-[#365274]">
                          Callback date/time <span className="text-red-600">*</span>
                          <input
                            type="datetime-local"
                            value={callbackAtInput}
                            onChange={(e) => setCallbackAtInput(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-[#c7ddf5] px-2 py-2 text-xs"
                          />
                          {callbackAtError && <p className="mt-1 text-[11px] text-red-600">{callbackAtError}</p>}
                        </label>
                      )}

                      <label className="block text-xs text-[#365274]">
                        Comment
                        <textarea
                          value={comment}
                          onChange={(e) => setComment(e.target.value)}
                          rows={3}
                          className="mt-1 w-full rounded-lg border border-[#c7ddf5] px-2 py-2 text-xs"
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
                <p className="text-sm text-slate-600">{emptyQueueGuidance}</p>
              )}
            </div>

            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#42658d]">Up next</p>
              <div className="grid gap-1.5 md:grid-cols-2">
                {nextUp.map((candidate, idx) => (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() => setSelectedCandidateId(candidate.id)}
                    className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-left hover:bg-slate-50"
                  >
                    <p className="truncate text-xs font-semibold text-slate-800">{candidate.full_name || 'Unknown Candidate'}</p>
                    <span className="ml-2 text-[10px] text-slate-500">#{idx + 1}</span>
                  </button>
                ))}
                {!nextUp.length && <p className="text-xs text-slate-500">No next candidates queued.</p>}
              </div>
            </div>

            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#42658d]">Recent call history</p>
              <div className="space-y-2">
                {selectedHistory.map((row) => {
                  const meta = readCallRecordMeta(row);
                  return (
                    <div key={row.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold text-slate-800">{row.disposition}</p>
                        <span className="text-[10px] text-slate-500">{formatDateTimeCanadaEastern(row.disposed_at)}</span>
                      </div>
                      <p className="text-[10px] text-slate-600">
                        {row.dialed_number}
                        {meta.bookedSubtype ? ` · Booked subtype: ${meta.bookedSubtype}` : ''}
                        {meta.callbackAt ? ` · Callback: ${formatDateTimeCanadaEastern(meta.callbackAt)}` : ''}
                      </p>
                    </div>
                  );
                })}
                {!selectedHistory.length && <p className="text-xs text-slate-500">No call history yet.</p>}
              </div>
            </div>
          </section>
        </div>

        {showDispositionModal && currentCandidate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b1f3a]/45 p-4">
            <div className="w-full max-w-xl space-y-3 rounded-2xl border border-[#c7ddf5] bg-white p-4 shadow-2xl">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs text-[#4c6c92]">Post-call disposition</p>
                  <h3 className="text-base font-semibold text-[#0B1B34]">{currentCandidate.full_name || 'Candidate'}</h3>
                  <p className="text-[11px] text-[#4c6c92]">Dialed number: {dialNumberPreview || 'No dialable number'}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSubmitAttempted(false);
                    setShowDispositionModal(false);
                  }}
                  className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                >
                  Close
                </button>
              </div>

              <label className="block text-xs text-[#365274]">
                Disposition
                <select
                  value={disposition}
                  onChange={(e) => setDisposition(e.target.value as PipelineCallDisposition)}
                  className="mt-1 w-full rounded-lg border border-[#c7ddf5] px-2 py-2 text-xs"
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
                <label className="block text-xs text-[#365274]">
                  Booked subtype <span className="text-red-600">*</span>
                  <select
                    value={bookedSubtype}
                    onChange={(e) => setBookedSubtype(e.target.value as PipelineBookedSubtype)}
                    className="mt-1 w-full rounded-lg border border-[#c7ddf5] px-2 py-2 text-xs"
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
                <label className="block text-xs text-[#365274]">
                  Callback date/time <span className="text-red-600">*</span>
                  <input
                    type="datetime-local"
                    value={callbackAtInput}
                    onChange={(e) => setCallbackAtInput(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[#c7ddf5] px-2 py-2 text-xs"
                  />
                  {callbackAtError && <p className="mt-1 text-[11px] text-red-600">{callbackAtError}</p>}
                </label>
              )}

              <label className="block text-xs text-[#365274]">
                Comment
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-[#c7ddf5] px-2 py-2 text-xs"
                  placeholder="Call notes..."
                />
              </label>

              <Button className="w-full" onClick={() => void saveDisposition()} disabled={savingDisposition || !currentCandidate}>
                {savingDisposition ? 'Saving...' : autoMode ? 'Save + auto advance' : 'Save disposition'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </PipelineAuthShell>
  );
};

export default PipelineCallWorkspace;
