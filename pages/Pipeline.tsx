import React, { useEffect, useMemo, useRef, useState } from 'react';
import Layout from '../components/Layout';
import { Button } from '../components/UI';
import { supabase } from '../services/supabaseClient';
import {
  addPipelineNote,
  bulkDeletePipelineCandidates,
  bulkUploadPipelineResumes,
  deletePipelineCandidate,
  getPipelineCandidateBundle,
  getPipelineResumeDisplayUrl,
  getPipelineResumeViewerKind,
  listPipelineCandidates,
  logPipelineCallAction,
  savePipelineEvaluation,
  triggerPipelineResumeConversion,
  type PipelineCandidate,
  type PipelineCandidateBundle,
  type PipelineResume,
  updatePipelineCandidateSchedule,
} from '../services/pipelineService';
import { buildThreeCxWebclientUrl, runThreeCxAction, type ThreeCxAction } from '../services/threeCxService';
import { formatDateTimeCanadaEastern } from '../services/dateDisplay';
import { ExternalLink, FileUp, Mic, MicOff, MonitorSmartphone, Phone, PhoneOff, RefreshCw, Search, Trash2, Volume2 } from 'lucide-react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

const JOURNEY_OPTIONS = ['new', 'queued_for_call', 'attempted', 'connected', 'follow_up', 'qualified', 'not_interested', 'hired'];
const DISPOSITION_OPTIONS = ['Need callback', 'No answer', 'Connected', 'Not interested', 'Qualified', 'Close'];
const DIAL_PAD = [
  { d: '1', s: '' },
  { d: '2', s: 'ABC' },
  { d: '3', s: 'DEF' },
  { d: '4', s: 'GHI' },
  { d: '5', s: 'JKL' },
  { d: '6', s: 'MNO' },
  { d: '7', s: 'PQRS' },
  { d: '8', s: 'TUV' },
  { d: '9', s: 'WXYZ' },
  { d: '*', s: '' },
  { d: '0', s: '+' },
  { d: '#', s: '' },
];

function latestNoteText(bundle: PipelineCandidateBundle | null): string {
  const n = bundle?.notes?.[0];
  if (!n) return 'No notes yet';
  return n.body;
}

function safeName(candidate: PipelineCandidate): string {
  return candidate.full_name?.trim() || 'Unknown Candidate';
}

function normalizeDialDestination(raw: string): string {
  const cleaned = raw.replace(/[^\d+]/g, '').trim();
  if (!cleaned) return '';
  if (cleaned.startsWith('+1')) return cleaned.slice(1);
  if (cleaned.startsWith('+')) return cleaned.slice(1);
  return cleaned;
}

function extractCallIdCandidate(payload: unknown): string | null {
  const walk = (node: unknown): string | null => {
    if (!node) return null;
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = walk(item);
        if (found) return found;
      }
      return null;
    }
    if (typeof node !== 'object') return null;
    const obj = node as Record<string, unknown>;
    const own = obj.callid ?? obj.callId ?? obj.id;
    if (own != null && String(own).trim()) return String(own).trim();
    for (const value of Object.values(obj)) {
      const found = walk(value);
      if (found) return found;
    }
    return null;
  };
  return walk(payload);
}

const Pipeline: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [email, setEmail] = useState('admin@globelife-paz.com');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [candidates, setCandidates] = useState<PipelineCandidate[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [selectedBundle, setSelectedBundle] = useState<PipelineCandidateBundle | null>(null);
  const [selectedResumeId, setSelectedResumeId] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [newNote, setNewNote] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);

  const [fitScore, setFitScore] = useState<number | null>(null);
  const [disposition, setDisposition] = useState('');
  const [nextAction, setNextAction] = useState('');
  const [journeyStage, setJourneyStage] = useState('new');
  const [evaluationComments, setEvaluationComments] = useState('');
  const [evalSaving, setEvalSaving] = useState(false);

  const [scheduledForInput, setScheduledForInput] = useState('');
  const [scheduleSaving, setScheduleSaving] = useState(false);

  const [agentExtension, setAgentExtension] = useState('');
  const [dialTarget, setDialTarget] = useState('');
  const [activeCallId, setActiveCallId] = useState('');
  const [callActionRunning, setCallActionRunning] = useState(false);
  const [callActionMsg, setCallActionMsg] = useState<string | null>(null);
  const [mediaPanelVisible, setMediaPanelVisible] = useState(false);
  const [mediaPanelLoaded, setMediaPanelLoaded] = useState(false);
  const [mediaEmbedBlocked, setMediaEmbedBlocked] = useState(false);
  const [mediaAutoPopOpened, setMediaAutoPopOpened] = useState(false);
  const [mediaPanelRequested, setMediaPanelRequested] = useState(false);
  const [toneEnabled, setToneEnabled] = useState(true);
  const [numPdfPages, setNumPdfPages] = useState<number>(0);
  const toneCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    const ext = localStorage.getItem('pipeline_3cx_ext');
    if (ext) setAgentExtension(ext);
  }, []);

  useEffect(() => {
    if (agentExtension.trim()) localStorage.setItem('pipeline_3cx_ext', agentExtension.trim());
  }, [agentExtension]);

  const loadCandidates = async () => {
    setError(null);
    setLoading(true);
    try {
      const rows = await listPipelineCandidates();
      setCandidates(rows);
      if (!selectedCandidateId && rows.length > 0) setSelectedCandidateId(rows[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const loadSelectedBundle = async (candidateId: string) => {
    setError(null);
    setLoading(true);
    try {
      const bundle = await getPipelineCandidateBundle(candidateId);
      setSelectedBundle(bundle);
      if (bundle?.resumes?.length) setSelectedResumeId((prev) => prev ?? bundle.resumes[0].id);
      setJourneyStage(bundle?.candidate.journey_stage || 'new');
      setScheduledForInput(
        bundle?.candidate.scheduled_for ? new Date(bundle.candidate.scheduled_for).toISOString().slice(0, 16) : ''
      );
      setDialTarget(bundle?.candidate.phone || '');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) setIsAuthenticated(true);
    });
  }, []);

  useEffect(() => {
    if (isAuthenticated) void loadCandidates();
  }, [isAuthenticated]);

  useEffect(() => {
    if (selectedCandidateId && isAuthenticated) void loadSelectedBundle(selectedCandidateId);
  }, [selectedCandidateId, isAuthenticated]);

  const filteredCandidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return candidates.filter((c) => {
      if (stageFilter && c.journey_stage !== stageFilter) return false;
      if (statusFilter && c.status !== statusFilter) return false;
      if (!q) return true;
      return (
        safeName(c).toLowerCase().includes(q) ||
        String(c.phone || '').toLowerCase().includes(q) ||
        String(c.email || '').toLowerCase().includes(q)
      );
    });
  }, [candidates, search, stageFilter, statusFilter]);

  const selectedResume: PipelineResume | null = useMemo(() => {
    if (!selectedBundle?.resumes?.length) return null;
    return selectedBundle.resumes.find((r) => r.id === selectedResumeId) || selectedBundle.resumes[0];
  }, [selectedBundle, selectedResumeId]);

  const uploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getUser();
      const actorLabel = String(data.user?.user_metadata?.full_name || data.user?.user_metadata?.name || data.user?.email || '').trim() || undefined;
      const result = await bulkUploadPipelineResumes(Array.from(files), actorLabel);
      if (result.failed.length > 0) {
        setError(`Uploaded ${result.created.length}, failed ${result.failed.length}. First error: ${result.failed[0].error}`);
      }
      await loadCandidates();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  const toggleSelectedId = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const deleteCurrentCandidate = async () => {
    if (!selectedBundle?.candidate.id) return;
    const ok = window.confirm(`Delete ${safeName(selectedBundle.candidate)} and all related resume/call/note data?`);
    if (!ok) return;
    try {
      setLoading(true);
      await deletePipelineCandidate(selectedBundle.candidate.id);
      setSelectedBundle(null);
      setSelectedCandidateId(null);
      setSelectedResumeId(null);
      setSelectedIds(new Set());
      await loadCandidates();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const bulkDeleteSelected = async () => {
    if (!selectedIds.size) return;
    const ok = window.confirm(`Delete ${selectedIds.size} selected candidate(s) and related data?`);
    if (!ok) return;
    try {
      setLoading(true);
      await bulkDeletePipelineCandidates(Array.from(selectedIds));
      if (selectedCandidateId && selectedIds.has(selectedCandidateId)) {
        setSelectedBundle(null);
        setSelectedCandidateId(null);
        setSelectedResumeId(null);
      }
      setSelectedIds(new Set());
      await loadCandidates();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const addNote = async () => {
    if (!selectedBundle?.candidate.id || !newNote.trim()) return;
    setNoteSaving(true);
    try {
      const { data } = await supabase.auth.getUser();
      const actorLabel = String(data.user?.user_metadata?.full_name || data.user?.user_metadata?.name || data.user?.email || '').trim() || undefined;
      await addPipelineNote(selectedBundle.candidate.id, newNote, actorLabel);
      setNewNote('');
      await loadSelectedBundle(selectedBundle.candidate.id);
      await loadCandidates();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setNoteSaving(false);
    }
  };

  const saveEvaluation = async () => {
    if (!selectedBundle?.candidate.id) return;
    setEvalSaving(true);
    try {
      const { data } = await supabase.auth.getUser();
      const actorLabel = String(data.user?.user_metadata?.full_name || data.user?.user_metadata?.name || data.user?.email || '').trim() || undefined;
      await savePipelineEvaluation({
        candidateId: selectedBundle.candidate.id,
        fitScore,
        disposition,
        nextAction,
        journeyStage,
        comments: evaluationComments,
        actorLabel,
      });
      await loadSelectedBundle(selectedBundle.candidate.id);
      await loadCandidates();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEvalSaving(false);
    }
  };

  const saveSchedule = async () => {
    if (!selectedBundle?.candidate.id) return;
    setScheduleSaving(true);
    try {
      await updatePipelineCandidateSchedule(
        selectedBundle.candidate.id,
        scheduledForInput ? new Date(scheduledForInput).toISOString() : null
      );
      await loadSelectedBundle(selectedBundle.candidate.id);
      await loadCandidates();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScheduleSaving(false);
    }
  };

  const mediaSessionUrl = useMemo(
    () => buildThreeCxWebclientUrl(dialTarget || selectedBundle?.candidate.phone || ''),
    [dialTarget, selectedBundle?.candidate.phone],
  );

  const playDialTone = () => {
    if (!toneEnabled || typeof window === 'undefined') return;
    const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    if (!toneCtxRef.current) toneCtxRef.current = new Ctx();
    const ctx = toneCtxRef.current;
    if (ctx.state === 'suspended') void ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.value = 0.03;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.06);
  };

  const openMediaSession = (mode: 'embedded' | 'popup') => {
    if (!mediaSessionUrl) {
      setCallActionMsg('Set VITE_3CX_WEBCLIENT_URL to enable media session panel.');
      return;
    }
    if (mode === 'popup' || mediaEmbedBlocked) {
      window.open(mediaSessionUrl, '_blank', 'noopener,noreferrer');
      setCallActionMsg('Media session opened in 3CX webclient tab.');
      return;
    }
    setMediaPanelRequested(true);
    setMediaPanelVisible(true);
    setMediaPanelLoaded(false);
    setMediaAutoPopOpened(false);
    setCallActionMsg('Embedded media panel opened. If blocked, use Pop out.');
  };

  const resolveActiveCallId = async (): Promise<string | null> => {
    if (activeCallId.trim()) return activeCallId.trim();
    const result = await runThreeCxAction({
      action: 'active_calls',
      extension: agentExtension.trim() || undefined,
    });
    if (!result.ok) return null;
    const found = extractCallIdCandidate(result.data ?? null);
    if (found) setActiveCallId(found);
    return found;
  };

  const runCallAction = async (action: ThreeCxAction) => {
    if (!selectedBundle?.candidate.id) return;
    const normalizedDestination = normalizeDialDestination(dialTarget.trim());
    if (action === 'dial' && !agentExtension.trim()) {
      setCallActionMsg('Enter your 3CX extension before dialing.');
      return;
    }
    if (action === 'dial' && !normalizedDestination) {
      setCallActionMsg('Enter a destination number to dial.');
      return;
    }
    const requiresCallId = action === 'hangup' || action === 'hold' || action === 'resume' || action === 'mute' || action === 'unmute' || action === 'transfer' || action === 'dtmf';
    setCallActionRunning(true);
    setCallActionMsg(null);
    try {
      const resolvedCallId = requiresCallId ? await resolveActiveCallId() : null;
      if (requiresCallId && !resolvedCallId) {
        setCallActionMsg('No active call found yet. Dial first, then try this control.');
        return;
      }
      const payload = {
        action,
        extension: agentExtension.trim() || undefined,
        destination: action === 'dial' ? normalizedDestination || undefined : dialTarget.trim() || undefined,
        callId: resolvedCallId || activeCallId.trim() || undefined,
      };
      const result = await runThreeCxAction(payload);
      if (!result.ok) {
        if (action === 'dial') {
          openMediaSession('popup');
          setCallActionMsg(`API dial failed, opened webclient dialer: ${result.error || 'Call action failed'}`);
        } else {
          setCallActionMsg(result.error || 'Call action failed');
        }
      } else {
        setCallActionMsg(`${action} OK`);
        const callIdMaybe = extractCallIdCandidate(result.data ?? null);
        if ((action === 'dial' || action === 'active_calls') && callIdMaybe != null) {
          setActiveCallId(String(callIdMaybe));
        }
        if (action === 'dial') {
          setDialTarget(normalizedDestination || dialTarget);
          openMediaSession('embedded');
        }
      }
      const { data } = await supabase.auth.getUser();
      const actorLabel = String(data.user?.user_metadata?.full_name || data.user?.user_metadata?.name || data.user?.email || '').trim() || undefined;
      await logPipelineCallAction({
        candidateId: selectedBundle.candidate.id,
        resumeId: selectedResume?.id ?? null,
        action,
        outcome: result.ok ? 'ok' : 'failed',
        agentExtension: agentExtension.trim() || null,
        requestPayload: payload,
        responsePayload: result.data ?? (result.error ? { error: result.error } : null),
        actorLabel,
      });
      await loadSelectedBundle(selectedBundle.candidate.id);
    } catch (e) {
      setCallActionMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setCallActionRunning(false);
    }
  };

  const openWebClientFallback = () => {
    openMediaSession('popup');
  };

  const keypadPress = (digit: string) => {
    playDialTone();
    setDialTarget((prev) => `${prev}${digit}`);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isTypingField = tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable;
      if (isTypingField) return;
      if (event.key >= '0' && event.key <= '9') {
        event.preventDefault();
        keypadPress(event.key);
        return;
      }
      if (event.key === '*' || event.key === '#') {
        event.preventDefault();
        keypadPress(event.key);
        return;
      }
      if (event.key === 'Backspace') {
        event.preventDefault();
        setDialTarget((prev) => prev.slice(0, -1));
        return;
      }
      if (event.key === 'Enter' && selectedBundle?.candidate.id && !callActionRunning) {
        event.preventDefault();
        void runCallAction('dial');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedBundle?.candidate.id, callActionRunning]);

  useEffect(() => () => {
    if (toneCtxRef.current) {
      void toneCtxRef.current.close();
      toneCtxRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!mediaPanelRequested || !mediaPanelVisible || mediaPanelLoaded || !mediaSessionUrl || mediaEmbedBlocked || mediaAutoPopOpened) return;
    const timeout = window.setTimeout(() => {
      setMediaEmbedBlocked(true);
      setCallActionMsg('3CX blocks embedded panel (CSP). Opened pop out for audio session.');
      window.open(mediaSessionUrl, '_blank', 'noopener,noreferrer');
      setMediaAutoPopOpened(true);
    }, 2200);
    return () => window.clearTimeout(timeout);
  }, [mediaPanelRequested, mediaPanelVisible, mediaPanelLoaded, mediaSessionUrl, mediaEmbedBlocked, mediaAutoPopOpened]);

  const refreshConversion = async () => {
    if (!selectedResume) return;
    try {
      await triggerPipelineResumeConversion(selectedResume.id);
      if (selectedBundle?.candidate.id) await loadSelectedBundle(selectedBundle.candidate.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#f7fbff] to-[#eef6ff] flex items-center justify-center p-4">
        <div className="bg-white border border-[#d9e9fb] p-8 rounded-[24px] shadow w-full max-w-sm">
          <h2 className="text-xl font-bold text-[#0B1B34] mb-1 text-center">Pipeline</h2>
          <p className="text-sm text-[#6f7b8d] text-center mb-6">Sign in with your admin account</p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setAuthError(null);
              const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
              if (signInError) {
                setAuthError('Invalid email or password.');
                return;
              }
              setIsAuthenticated(true);
            }}
            className="space-y-4"
          >
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-4 py-2.5 rounded-xl border border-[#cfe3f9]" />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-4 py-2.5 rounded-xl border border-[#cfe3f9]" />
            <Button fullWidth type="submit">Sign in</Button>
            {authError && <p className="text-sm text-red-600 text-center">{authError}</p>}
          </form>
        </div>
      </div>
    );
  }

  return (
    <Layout isAdmin>
      <div className="w-full max-w-[1400px] mx-auto p-4 space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Pipeline</h1>
            <p className="text-xs text-slate-500">Bulk resume intake, inline review, 3CX call controls, and candidate progression.</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-xs cursor-pointer hover:bg-slate-50">
              <FileUp size={14} />
              {uploading ? 'Uploading…' : 'Bulk upload resumes'}
              <input
                type="file"
                className="hidden"
                multiple
                accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.rtf,.txt"
                onChange={(e) => void uploadFiles(e.target.files)}
                disabled={uploading}
              />
            </label>
            <Button variant="outline" onClick={() => void loadCandidates()} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'mr-1 animate-spin' : 'mr-1'} />
              Refresh
            </Button>
          </div>
        </div>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">{error}</div>}

        <div className="grid grid-cols-1 xl:grid-cols-[340px_1fr] gap-4">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="p-3 border-b border-slate-100 space-y-2">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, phone, email" className="w-full rounded-lg border border-slate-200 pl-8 pr-3 py-2 text-xs" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-2 text-xs">
                  <option value="">All stages</option>
                  {JOURNEY_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-2 text-xs">
                  <option value="">All status</option>
                  <option value="open">open</option>
                  <option value="in_progress">in_progress</option>
                  <option value="closed">closed</option>
                </select>
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-slate-500">Showing {filteredCandidates.length} / {candidates.length}</p>
                <Button variant="outline" className="!min-h-0 h-7 px-2 text-[11px]" onClick={() => void bulkDeleteSelected()} disabled={!selectedIds.size || loading}>
                  <Trash2 size={12} className="mr-1" /> Delete {selectedIds.size || ''}
                </Button>
              </div>
            </div>
            <div className="max-h-[calc(100vh-250px)] overflow-auto">
              {filteredCandidates.map((c) => (
                <div key={c.id} className={`w-full px-3 py-2 border-b border-slate-100 ${selectedCandidateId === c.id ? 'bg-slate-100' : 'hover:bg-slate-50'}`}>
                  <div className="flex items-start gap-2">
                    <input type="checkbox" checked={selectedIds.has(c.id)} onChange={() => toggleSelectedId(c.id)} className="mt-1 rounded border-slate-300" />
                    <button type="button" onClick={() => setSelectedCandidateId(c.id)} className="flex-1 text-left min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-slate-900 truncate">{safeName(c)}</p>
                        <span className="text-[10px] rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">{c.journey_stage}</span>
                      </div>
                      <p className="text-xs text-slate-600 truncate">{c.phone || 'No phone'} {c.email ? `· ${c.email}` : ''}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {c.scheduled_for ? `Scheduled ${formatDateTimeCanadaEastern(c.scheduled_for)}` : 'No schedule'} · {c.status}
                      </p>
                    </button>
                  </div>
                </div>
              ))}
              {!loading && filteredCandidates.length === 0 && (
                <div className="p-6 text-center text-sm text-slate-500">No pipeline candidates yet.</div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            {!selectedBundle ? (
              <div className="p-8 text-sm text-slate-500">Select a candidate to open resume + call controls.</div>
            ) : (
              <div className="min-h-[calc(100vh-250px)] flex flex-col">
                <div className="px-3 py-2.5 border-b border-slate-100 flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-slate-900 flex-1 truncate">{safeName(selectedBundle.candidate)}</p>
                  <select value={selectedResume?.id || ''} onChange={(e) => setSelectedResumeId(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs">
                    {selectedBundle.resumes.map((r) => (
                      <option key={r.id} value={r.id}>{r.original_filename}</option>
                    ))}
                  </select>
                  {selectedResume && (
                    <span className="text-[11px] rounded-full px-2 py-0.5 bg-slate-100 text-slate-700">
                      {selectedResume.conversion_status}
                    </span>
                  )}
                  <Button variant="outline" className="!min-h-0 h-8 px-2 text-xs" onClick={() => void deleteCurrentCandidate()} disabled={loading}>
                    <Trash2 size={13} className="mr-1" /> Delete
                  </Button>
                </div>

                <div className="flex-1 min-h-[62vh] bg-slate-50 border-b border-slate-200">
                  {selectedResume ? (() => {
                    const kind = getPipelineResumeViewerKind(selectedResume);
                    const url = getPipelineResumeDisplayUrl(selectedResume);
                    if (!url) {
                      return (
                        <div className="p-4 text-sm text-slate-600">
                          <p>No display URL available.</p>
                          {selectedResume.conversion_status !== 'ready' && selectedResume.conversion_status !== 'not_required' && (
                            <Button className="mt-2" onClick={() => void refreshConversion()} variant="outline">Retry conversion</Button>
                          )}
                        </div>
                      );
                    }
                    if (kind === 'image') {
                      return <img src={url} alt={selectedResume.original_filename} className="w-full h-full object-contain" />;
                    }
                    if (kind === 'pdf') {
                      return (
                        <div className="h-full overflow-auto px-2 py-2">
                          <Document file={url} onLoadSuccess={(d) => setNumPdfPages(d.numPages)} loading={<div className="p-4 text-sm">Loading PDF…</div>}>
                            {Array.from({ length: numPdfPages || 1 }, (_, i) => (
                              <div key={`p-${i + 1}`} className="mb-2 flex justify-center">
                                <Page pageNumber={i + 1} width={Math.min(window.innerWidth - 460, 920)} renderTextLayer renderAnnotationLayer />
                              </div>
                            ))}
                          </Document>
                        </div>
                      );
                    }
                    return (
                      <div className="p-4 text-sm text-slate-600 space-y-2">
                        <p>This document type needs conversion before inline viewing.</p>
                        <p>Status: <strong>{selectedResume.conversion_status}</strong></p>
                        {selectedResume.conversion_error && <p className="text-red-600">{selectedResume.conversion_error}</p>}
                        <Button onClick={() => void refreshConversion()} variant="outline">Convert / Retry</Button>
                        <a href={url} target="_blank" rel="noreferrer" className="block text-blue-700 underline">Open source file</a>
                      </div>
                    );
                  })() : (
                    <div className="p-4 text-sm text-slate-500">No resume uploaded for this candidate.</div>
                  )}
                </div>

                <div className="p-3 space-y-3">
                  <section className="rounded-xl border border-slate-200 p-3 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide flex items-center gap-1"><Phone size={13} /> Softphone + call controls</h3>
                      <div className="flex items-center gap-1.5">
                        <button type="button" onClick={() => setToneEnabled((v) => !v)} className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] ${toneEnabled ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-500'}`}>
                          <Volume2 size={12} /> Key tones
                        </button>
                        <Button variant="outline" className="!min-h-0 h-7 px-2 text-[11px]" onClick={() => openMediaSession('embedded')}>
                          <MonitorSmartphone size={12} className="mr-1" /> Open panel
                        </Button>
                        <Button variant="outline" className="!min-h-0 h-7 px-2 text-[11px]" onClick={openWebClientFallback}>
                          <ExternalLink size={12} className="mr-1" /> Pop out
                        </Button>
                      </div>
                    </div>

                    {mediaPanelVisible && (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
                        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-200">
                          <div className="flex items-center gap-2 text-[11px] text-slate-600">
                            <Mic size={12} className={mediaPanelLoaded ? 'text-emerald-600' : 'text-slate-400'} />
                            <span>
                              {mediaEmbedBlocked
                                ? 'Embedded panel blocked by 3CX CSP'
                                : (mediaPanelLoaded ? 'Media panel connected' : 'Loading media panel...')}
                            </span>
                          </div>
                          <button type="button" onClick={() => setMediaPanelVisible(false)} className="text-[11px] text-slate-500 hover:text-slate-700">Hide</button>
                        </div>
                        {mediaEmbedBlocked ? (
                          <div className="px-3 py-4 bg-white space-y-2">
                            <p className="text-xs text-slate-700">
                              3CX does not allow embedding on this domain. Use pop-out media session for mic/speaker.
                            </p>
                            <Button variant="outline" className="!min-h-0 h-8 text-xs" onClick={openWebClientFallback}>
                              <ExternalLink size={12} className="mr-1" /> Open 3CX media window
                            </Button>
                          </div>
                        ) : mediaSessionUrl ? (
                          <iframe
                            key={mediaSessionUrl}
                            src={mediaSessionUrl}
                            title="3CX Media Session"
                            className="w-full h-[240px] bg-white"
                            allow="microphone; camera; autoplay; clipboard-read; clipboard-write"
                            onLoad={() => setMediaPanelLoaded(true)}
                            onError={() => {
                              setMediaEmbedBlocked(true);
                              setCallActionMsg('Embedded panel blocked. Use pop out media session.');
                            }}
                          />
                        ) : (
                          <div className="px-3 py-4 text-xs text-slate-500">
                            Set <code>VITE_3CX_WEBCLIENT_URL</code> to use embedded media. Until then, use Pop out fallback.
                          </div>
                        )}
                        <div className="px-3 py-2 bg-white text-[11px] text-slate-500 border-t border-slate-200">
                          If embedded panel is blocked by browser policy, use <span className="font-medium text-slate-700">Pop out</span> and keep the tab open during calls.
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap items-start gap-3">
                      <div className="w-[220px] rounded-2xl border border-slate-300 bg-gradient-to-b from-slate-100 to-slate-50 p-3 shadow-inner">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Dialer</p>
                        <input
                          value={dialTarget}
                          onChange={(e) => setDialTarget(e.target.value)}
                          placeholder="10/11 digit number"
                          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold tracking-wide text-slate-900 mb-2"
                        />
                        <div className="text-[10px] text-slate-500 mb-1">Normalized: <span className="font-semibold text-slate-700">{normalizeDialDestination(dialTarget) || '—'}</span></div>
                        <div className="grid grid-cols-3 gap-1.5">
                          {DIAL_PAD.map((k) => (
                            <button key={k.d} type="button" onClick={() => keypadPress(k.d)} className="rounded-xl border border-slate-300 bg-white py-2 hover:bg-slate-50 transition">
                              <p className="text-sm font-semibold text-slate-900 leading-tight">{k.d}</p>
                              <p className="text-[9px] text-slate-500 leading-tight min-h-[10px]">{k.s}</p>
                            </button>
                          ))}
                        </div>
                        <div className="grid grid-cols-2 gap-1.5 mt-2">
                          <button type="button" onClick={() => setDialTarget((prev) => prev.slice(0, -1))} className="rounded-lg border border-slate-300 bg-white py-1.5 text-xs hover:bg-slate-50">Backspace</button>
                          <Button className="!min-h-0 h-8 text-xs" onClick={() => void runCallAction('dial')} disabled={callActionRunning}>Dial</Button>
                        </div>
                        <p className="text-[10px] text-slate-500 mt-2">Keyboard: 0-9, *, #, Backspace, Enter</p>
                      </div>

                      <div className="flex-1 min-w-[260px] space-y-2">
                        <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-2 items-center">
                          <input value={agentExtension} onChange={(e) => setAgentExtension(e.target.value)} placeholder="Agent extension" className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs" />
                          <div className="text-[11px] text-slate-500">
                            Active call: <span className="font-medium text-slate-700">{activeCallId || 'Auto-detected after dial'}</span>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                          <button type="button" onClick={() => void runCallAction('hold')} disabled={callActionRunning} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs hover:bg-slate-50 inline-flex items-center justify-center gap-1.5 disabled:opacity-60">
                            <Phone size={13} className="text-amber-600" /> Hold
                          </button>
                          <button type="button" onClick={() => void runCallAction('mute')} disabled={callActionRunning} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs hover:bg-slate-50 inline-flex items-center justify-center gap-1.5 disabled:opacity-60">
                            <MicOff size={13} className="text-slate-700" /> Mute
                          </button>
                          <button type="button" onClick={() => void runCallAction('unmute')} disabled={callActionRunning} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs hover:bg-slate-50 inline-flex items-center justify-center gap-1.5 disabled:opacity-60">
                            <Mic size={13} className="text-emerald-600" /> Unmute
                          </button>
                          <button type="button" onClick={() => void runCallAction('hangup')} disabled={callActionRunning} className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 hover:bg-red-100 inline-flex items-center justify-center gap-1.5 disabled:opacity-60">
                            <PhoneOff size={13} /> Hangup
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant="secondary" onClick={openWebClientFallback}>Open 3CX web client fallback</Button>
                      <Button variant="outline" onClick={() => void runCallAction('active_calls')} disabled={callActionRunning}>Refresh active calls</Button>
                      {callActionMsg && <p className="text-xs text-slate-600">{callActionMsg}</p>}
                    </div>
                  </section>

                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                    <section className="rounded-xl border border-slate-200 p-3 space-y-2">
                      <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Notes</h3>
                      <div className="space-y-2 max-h-40 overflow-auto">
                        {selectedBundle.notes.map((n) => (
                          <div key={n.id} className="rounded-lg bg-slate-50 border border-slate-100 p-2">
                            <p className="text-xs text-slate-800 whitespace-pre-wrap">{n.body}</p>
                            <p className="text-[10px] text-slate-500 mt-1">{formatDateTimeCanadaEastern(n.created_at)}{n.author_label ? ` · ${n.author_label}` : ''}</p>
                          </div>
                        ))}
                        {selectedBundle.notes.length === 0 && <p className="text-xs text-slate-400">No notes yet.</p>}
                      </div>
                      <textarea value={newNote} onChange={(e) => setNewNote(e.target.value)} rows={3} placeholder="Write note…" className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs" />
                      <Button onClick={() => void addNote()} disabled={!newNote.trim() || noteSaving}>
                        {noteSaving ? 'Saving…' : 'Add note'}
                      </Button>
                    </section>

                    <section className="rounded-xl border border-slate-200 p-3 space-y-2">
                      <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Evaluation + schedule</h3>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="text-xs text-slate-600">
                          Fit (1-10)
                          <input type="number" min={1} max={10} value={fitScore ?? ''} onChange={(e) => setFitScore(e.target.value ? Number(e.target.value) : null)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs" />
                        </label>
                        <label className="text-xs text-slate-600">
                          Journey stage
                          <select value={journeyStage} onChange={(e) => setJourneyStage(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs">
                            {JOURNEY_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </label>
                        <label className="text-xs text-slate-600 col-span-2">
                          Disposition
                          <select value={disposition} onChange={(e) => setDisposition(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs">
                            <option value="">Select</option>
                            {DISPOSITION_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                          </select>
                        </label>
                        <label className="text-xs text-slate-600 col-span-2">
                          Schedule
                          <input type="datetime-local" value={scheduledForInput} onChange={(e) => setScheduledForInput(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs" />
                        </label>
                        <label className="text-xs text-slate-600 col-span-2">
                          Next action
                          <input value={nextAction} onChange={(e) => setNextAction(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs" />
                        </label>
                        <label className="text-xs text-slate-600 col-span-2">
                          Comments
                          <textarea value={evaluationComments} onChange={(e) => setEvaluationComments(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs" />
                        </label>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button onClick={() => void saveEvaluation()} disabled={evalSaving}>{evalSaving ? 'Saving…' : 'Save evaluation'}</Button>
                        <Button variant="outline" onClick={() => void saveSchedule()} disabled={scheduleSaving}>{scheduleSaving ? 'Saving…' : 'Save schedule'}</Button>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div className="rounded-lg bg-slate-50 border border-slate-100 p-2">
                          <p className="text-slate-500">Total logs</p>
                          <p className="font-semibold text-slate-900">{selectedBundle.callLogs.length}</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 border border-slate-100 p-2">
                          <p className="text-slate-500">Successful</p>
                          <p className="font-semibold text-slate-900">{selectedBundle.callLogs.filter((x) => x.outcome === 'ok').length}</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 border border-slate-100 p-2">
                          <p className="text-slate-500">Failed</p>
                          <p className="font-semibold text-slate-900">{selectedBundle.callLogs.filter((x) => x.outcome === 'failed').length}</p>
                        </div>
                      </div>
                    </section>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default Pipeline;
