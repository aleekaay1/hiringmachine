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
    () => queueList.filter((c) => c.id !== currentCandidate?.id).slice(0, 5),
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
              <p className="text-xs text-[#365274]">
                Auto queue + callback loop. Legacy manual flow remains available in `/pipeline`.
              </p>
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
              <Link to="/pipeline" className="rounded-xl border border-[#b8d2ef] bg-white px-3 py-2 text-xs text-[#0B1B34] hover:bg-[#f2f8ff]">
                Legacy mode
              </Link>
              <Button variant="outline" className="!min-h-0 h-9 px-3 text-xs" onClick={() => void loadWorkspace()} disabled={loading}>
                <RefreshCw size={14} className={loading ? 'mr-1 animate-spin' : 'mr-1'} />
                Refresh queue
              </Button>
              <Button
                variant="outline"
                className="!min-h-0 h-9 px-3 text-xs"
                onClick={() => setPassSkippedCandidateIds([])}
                disabled={!passSkippedCandidateIds.length}
              >
                Reset pass
              </Button>
            </div>
          </div>
        </div>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        {actionMsg && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{actionMsg}</div>}

        <div className="grid gap-4 xl:grid-cols-[250px_1fr_390px]">
          <aside className="rounded-2xl border border-[#d8e8fa] bg-white/80 p-3 space-y-3">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-[#42658d] font-semibold mb-2">Quick disposition filters</p>
              <button
                type="button"
                onClick={() => setQueueFilter('all')}
                className={`w-full mb-1 rounded-lg px-2 py-2 text-xs text-left border ${
                  queueFilter === 'all' ? 'bg-[#e8f3ff] border-[#9dc6ef] text-[#0B1B34]' : 'bg-white border-slate-200 text-slate-600'
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
                  className={`w-full mb-1 rounded-lg px-2 py-2 text-xs text-left border ${
                    queueFilter === item.id ? 'bg-[#e8f3ff] border-[#9dc6ef] text-[#0B1B34]' : 'bg-white border-slate-200 text-slate-600'
                  }`}
                >
                  {item.label}
                  {(item.id === 'booked_no_show' || item.id === 'booked_didnt_watch') && (
                    <span className="ml-2 text-[10px] text-slate-400">(email-matched)</span>
                  )}
                </button>
              ))}
              <p className="mt-1 text-[10px] text-[#5b7fa7]" title={BOOKED_OUTCOME_RULE_LABEL}>
                Booked no-show / didn&apos;t watch use deterministic email-to-WebinarGeek best-effort mapping.
              </p>
            </div>

            <div className="rounded-xl border border-[#dce9f8] bg-[#f8fbff] p-2.5 space-y-2">
              <p className="text-[11px] font-semibold text-[#0B1B34]">Queue cap controls</p>
              <label className="text-[11px] text-[#365274] block">
                Daily target
                <input
                  type="number"
                  min={0}
                  value={dailyUploadTarget}
                  onChange={(e) => setDailyUploadTarget(e.target.value ? Number(e.target.value) : '')}
                  className="mt-1 w-full rounded-lg border border-[#c7ddf5] px-2 py-1.5 text-xs"
                />
              </label>
              <label className="text-[11px] text-[#365274] block">
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
              <p className="text-[10px] text-[#4b6f98]">
                Today calls: {todaysCallCount}
                {queueCap != null ? ` · Remaining queue cap: ${queueCap}` : ''}
              </p>
            </div>

            <div>
              <p className="text-[11px] uppercase tracking-wide text-[#42658d] font-semibold mb-1">Callback loop</p>
              <div className="space-y-1.5 max-h-[360px] overflow-auto">
                {callbackRows.map((row) => (
                  <button
                    key={`${row.candidateId}-${row.callbackAt}`}
                    type="button"
                    onClick={() => setSelectedCandidateId(row.candidateId)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-left hover:bg-slate-50"
                  >
                    <p className="text-xs font-semibold text-slate-800 truncate">{row.candidateName}</p>
                    <p className="text-[10px] text-slate-500">{formatDateTimeCanadaEastern(row.callbackAt)}</p>
                  </button>
                ))}
                {!callbackRows.length && (
                  <p className="text-[11px] text-slate-500 rounded-lg border border-dashed border-slate-300 p-2">No callbacks logged yet.</p>
                )}
              </div>
            </div>
          </aside>

          <section className="rounded-2xl border border-[#d8e8fa] bg-white/85 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs text-[#4c6c92]">{queueStateLabel}</p>
                <p className="text-base font-semibold text-[#0B1B34]">{queueList.length}</p>
              </div>
              <div className="text-xs text-[#365274]">
                <p>Current: {currentCandidate?.full_name || 'No candidate selected'}</p>
                <p>Mode: {autoMode ? 'Auto (save -> next)' : 'Manual selection'}</p>
                {queueCap != null && <p>Queue cap applied: {Math.max(queueCap, 0)}</p>}
              </div>
            </div>

            <div className="rounded-xl border border-[#deebf9] bg-[#f8fbff] p-3">
              {currentCandidate ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="text-lg font-semibold text-[#0B1B34]">{currentCandidate.full_name || 'Unknown Candidate'}</h2>
                      <p className="text-xs text-[#4c6c92]">
                        {currentPhoneInfo?.effectivePhone || 'No phone'} {currentCandidate.email ? `· ${currentCandidate.email}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button className="!min-h-0 h-9 text-xs px-3" onClick={() => void placeCall(currentCandidate, phoneInput)}>
                        <Phone size={13} className="mr-1" />
                        Place call
                      </Button>
                    </div>
                  </div>
                  <div className="mt-3 rounded-xl border border-[#dbe9f8] bg-white p-3">
                    <p className="text-[11px] text-[#43658e] mb-1">Dial number override (save once for future calls)</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        value={phoneInput}
                        onChange={(e) => {
                          setPhoneInput(e.target.value);
                          setPhoneMsg(null);
                        }}
                        placeholder="e.g. +1 (555) 123-4567"
                        className="flex-1 min-w-[220px] rounded-lg border border-[#c7ddf5] px-2.5 py-2 text-xs"
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
                    <p className="mt-1 text-[10px] text-[#5b7fa7]">
                      Normalized for dial: {normalizeDialDestination(phoneInput) || '—'}
                    </p>
                    {currentPhoneInfo?.originalExtractedPhone && (
                      <p className="mt-1 text-[10px] text-slate-500">
                        OCR extracted originally: {currentPhoneInfo.originalExtractedPhone}
                      </p>
                    )}
                    {phoneMsg && <p className="mt-1 text-[10px] text-emerald-700">{phoneMsg}</p>}
                  </div>
                  <div className="mt-3">
                    <p className="text-[11px] text-[#43658e] mb-1">Resume preview controls</p>
                    {selectedResumes.length ? (
                      <div className="space-y-1">
                        {selectedResumes.slice(0, 3).map((resume) => (
                          <a
                            key={resume.id}
                            href={getPipelineResumeOpenInNewTabUrl(resume) || '#'}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-lg border border-[#c7ddf5] bg-white px-2 py-1 text-xs text-[#0B1B34] mr-2"
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
                </>
              ) : (
                <p className="text-sm text-slate-600">{emptyQueueGuidance}</p>
              )}
            </div>

            <div>
              <p className="text-[11px] uppercase tracking-wide text-[#42658d] font-semibold mb-1">Next up</p>
              <div className="grid gap-2 md:grid-cols-2">
                {nextUp.map((candidate) => (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() => setSelectedCandidateId(candidate.id)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-left hover:bg-slate-50"
                  >
                    <p className="text-xs font-semibold text-slate-800 truncate">{candidate.full_name || 'Unknown Candidate'}</p>
                    <p className="text-[10px] text-slate-500">{candidate.phone || 'No phone'}</p>
                  </button>
                ))}
                {!nextUp.length && <p className="text-xs text-slate-500">No next candidates queued.</p>}
              </div>
            </div>

            <div>
              <p className="text-[11px] uppercase tracking-wide text-[#42658d] font-semibold mb-1">Recent call history</p>
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

          <section className="rounded-2xl border border-[#d8e8fa] bg-white/85 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-[#0B1B34]">Disposition</h3>
            <label className="text-xs text-[#365274] block">
              Disposition
              <select
                value={disposition}
                onChange={(e) => setDisposition(e.target.value as PipelineCallDisposition)}
                className="mt-1 w-full rounded-lg border border-[#c7ddf5] px-2 py-2 text-xs"
              >
                <option value="">Select disposition</option>
                {PIPELINE_CALL_DISPOSITIONS.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </label>

            {disposition === 'Booked' && (
              <label className="text-xs text-[#365274] block">
                Booked subtype (required)
                <select
                  value={bookedSubtype}
                  onChange={(e) => setBookedSubtype(e.target.value as PipelineBookedSubtype)}
                  className="mt-1 w-full rounded-lg border border-[#c7ddf5] px-2 py-2 text-xs"
                >
                  <option value="">Select subtype</option>
                  {PIPELINE_BOOKED_SUBTYPES.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </label>
            )}

            {disposition === 'Callback requested' && (
              <label className="text-xs text-[#365274] block">
                Callback date/time (required)
                <input
                  type="datetime-local"
                  value={callbackAtInput}
                  onChange={(e) => setCallbackAtInput(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[#c7ddf5] px-2 py-2 text-xs"
                />
              </label>
            )}

            <label className="text-xs text-[#365274] block">
              Comment
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={4}
                className="mt-1 w-full rounded-lg border border-[#c7ddf5] px-2 py-2 text-xs"
                placeholder="Call notes..."
              />
            </label>

            <Button className="w-full" onClick={() => void saveDisposition()} disabled={savingDisposition || !currentCandidate}>
              {savingDisposition ? 'Saving...' : autoMode ? 'Save + auto advance' : 'Save disposition'}
            </Button>
          </section>
        </div>
      </div>
    </PipelineAuthShell>
  );
};

export default PipelineCallWorkspace;
