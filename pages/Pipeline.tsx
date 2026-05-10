import React, { useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import { Button } from '../components/UI';
import { supabase } from '../services/supabaseClient';
import {
  addPipelineNote,
  bulkUploadPipelineResumes,
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
import { FileUp, Phone, RefreshCw, Search } from 'lucide-react';

const JOURNEY_OPTIONS = ['new', 'queued_for_call', 'attempted', 'connected', 'follow_up', 'qualified', 'not_interested', 'hired'];
const DISPOSITION_OPTIONS = ['Need callback', 'No answer', 'Connected', 'Not interested', 'Qualified', 'Close'];

function latestNoteText(bundle: PipelineCandidateBundle | null): string {
  const n = bundle?.notes?.[0];
  if (!n) return 'No notes yet';
  return n.body;
}

function safeName(candidate: PipelineCandidate): string {
  return candidate.full_name?.trim() || 'Unknown Candidate';
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
  const [targetExtension, setTargetExtension] = useState('');
  const [dtmfDigits, setDtmfDigits] = useState('');
  const [callActionRunning, setCallActionRunning] = useState(false);
  const [callActionMsg, setCallActionMsg] = useState<string | null>(null);

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

  const runCallAction = async (action: ThreeCxAction) => {
    if (!selectedBundle?.candidate.id) return;
    setCallActionRunning(true);
    setCallActionMsg(null);
    try {
      const payload = {
        action,
        extension: agentExtension.trim() || undefined,
        destination: dialTarget.trim() || undefined,
        callId: activeCallId.trim() || undefined,
        targetExtension: targetExtension.trim() || undefined,
        dtmfDigits: dtmfDigits.trim() || undefined,
      };
      const result = await runThreeCxAction(payload);
      if (!result.ok) {
        setCallActionMsg(result.error || 'Call action failed');
      } else {
        setCallActionMsg(`${action} OK`);
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
    const url = buildThreeCxWebclientUrl(dialTarget || selectedBundle?.candidate.phone || '');
    if (!url) {
      setCallActionMsg('Set VITE_3CX_WEBCLIENT_URL in environment for fallback.');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

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

        <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-4">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="p-3 border-b border-slate-100 space-y-2">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name, phone, email"
                  className="w-full rounded-lg border border-slate-200 pl-8 pr-3 py-2 text-xs"
                />
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
              <p className="text-[11px] text-slate-500">Showing {filteredCandidates.length} / {candidates.length}</p>
            </div>
            <div className="max-h-[calc(100vh-260px)] overflow-auto">
              {filteredCandidates.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedCandidateId(c.id)}
                  className={`w-full text-left px-3 py-2 border-b border-slate-100 hover:bg-slate-50 ${selectedCandidateId === c.id ? 'bg-slate-100' : ''}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-slate-900 truncate">{safeName(c)}</p>
                    <span className="text-[10px] rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">{c.journey_stage}</span>
                  </div>
                  <p className="text-xs text-slate-600 truncate">{c.phone || 'No phone'} {c.email ? `· ${c.email}` : ''}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {c.scheduled_for ? `Scheduled ${formatDateTimeCanadaEastern(c.scheduled_for)}` : 'No schedule'} · {c.status}
                  </p>
                </button>
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
              <div className="grid grid-cols-1 2xl:grid-cols-[minmax(420px,1fr)_420px] min-h-[calc(100vh-260px)]">
                <div className="border-b 2xl:border-b-0 2xl:border-r border-slate-200 flex flex-col min-h-0">
                  <div className="p-3 border-b border-slate-100 flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-slate-900 flex-1 truncate">{safeName(selectedBundle.candidate)}</p>
                    <select
                      value={selectedResume?.id || ''}
                      onChange={(e) => setSelectedResumeId(e.target.value)}
                      className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                    >
                      {selectedBundle.resumes.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.original_filename}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex-1 min-h-0 bg-slate-50">
                    {selectedResume ? (
                      (() => {
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
                          return <iframe title={selectedResume.original_filename} src={url} className="w-full h-full border-0" />;
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
                      })()
                    ) : (
                      <div className="p-4 text-sm text-slate-500">No resume uploaded for this candidate.</div>
                    )}
                  </div>
                </div>

                <div className="min-h-0 overflow-auto p-3 space-y-3 bg-white">
                  <section className="rounded-xl border border-slate-200 p-3 space-y-2">
                    <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Quick profile</h3>
                    <p className="text-sm text-slate-900">{safeName(selectedBundle.candidate)}</p>
                    <p className="text-xs text-slate-600">{selectedBundle.candidate.phone || 'No phone'} {selectedBundle.candidate.email ? `· ${selectedBundle.candidate.email}` : ''}</p>
                    <p className="text-xs text-slate-500">Latest note: {latestNoteText(selectedBundle)}</p>
                    <div className="grid grid-cols-2 gap-2 items-end">
                      <label className="text-xs text-slate-600">
                        Schedule
                        <input
                          type="datetime-local"
                          value={scheduledForInput}
                          onChange={(e) => setScheduledForInput(e.target.value)}
                          className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                        />
                      </label>
                      <Button onClick={() => void saveSchedule()} disabled={scheduleSaving}>
                        {scheduleSaving ? 'Saving…' : 'Save schedule'}
                      </Button>
                    </div>
                  </section>

                  <section className="rounded-xl border border-slate-200 p-3 space-y-2">
                    <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide flex items-center gap-1"><Phone size={13} /> 3CX call controls</h3>
                    <div className="grid grid-cols-2 gap-2">
                      <input value={agentExtension} onChange={(e) => setAgentExtension(e.target.value)} placeholder="Agent extension" className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs" />
                      <input value={dialTarget} onChange={(e) => setDialTarget(e.target.value)} placeholder="Dial target (phone)" className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs" />
                      <input value={activeCallId} onChange={(e) => setActiveCallId(e.target.value)} placeholder="Active call ID" className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs" />
                      <input value={targetExtension} onChange={(e) => setTargetExtension(e.target.value)} placeholder="Transfer extension" className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs" />
                      <input value={dtmfDigits} onChange={(e) => setDtmfDigits(e.target.value)} placeholder="DTMF digits" className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs" />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <Button onClick={() => void runCallAction('dial')} disabled={callActionRunning}>Dial</Button>
                      <Button variant="outline" onClick={() => void runCallAction('hangup')} disabled={callActionRunning}>Hangup</Button>
                      <Button variant="outline" onClick={() => void runCallAction('active_calls')} disabled={callActionRunning}>Active</Button>
                      <Button variant="outline" onClick={() => void runCallAction('hold')} disabled={callActionRunning}>Hold</Button>
                      <Button variant="outline" onClick={() => void runCallAction('resume')} disabled={callActionRunning}>Resume</Button>
                      <Button variant="outline" onClick={() => void runCallAction('transfer')} disabled={callActionRunning}>Transfer</Button>
                      <Button variant="outline" onClick={() => void runCallAction('mute')} disabled={callActionRunning}>Mute</Button>
                      <Button variant="outline" onClick={() => void runCallAction('unmute')} disabled={callActionRunning}>Unmute</Button>
                      <Button variant="outline" onClick={() => void runCallAction('dtmf')} disabled={callActionRunning}>DTMF</Button>
                    </div>
                    <Button variant="secondary" onClick={openWebClientFallback}>Open 3CX web client fallback</Button>
                    {callActionMsg && <p className="text-xs text-slate-600">{callActionMsg}</p>}
                  </section>

                  <section className="rounded-xl border border-slate-200 p-3 space-y-2">
                    <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Notes</h3>
                    <div className="space-y-2 max-h-36 overflow-auto">
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
                    <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Short evaluation</h3>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-xs text-slate-600">
                        Fit (1-10)
                        <input
                          type="number"
                          min={1}
                          max={10}
                          value={fitScore ?? ''}
                          onChange={(e) => setFitScore(e.target.value ? Number(e.target.value) : null)}
                          className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                        />
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
                        Next action
                        <input value={nextAction} onChange={(e) => setNextAction(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs" />
                      </label>
                      <label className="text-xs text-slate-600 col-span-2">
                        Comments
                        <textarea value={evaluationComments} onChange={(e) => setEvaluationComments(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs" />
                      </label>
                    </div>
                    <Button onClick={() => void saveEvaluation()} disabled={evalSaving}>
                      {evalSaving ? 'Saving…' : 'Save evaluation'}
                    </Button>
                  </section>

                  <section className="rounded-xl border border-slate-200 p-3 space-y-2">
                    <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Call stats</h3>
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
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default Pipeline;
