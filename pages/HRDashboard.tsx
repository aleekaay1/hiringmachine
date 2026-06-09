import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStaffAuthenticated } from '../hooks/useStaffAuthenticated';
import { Button } from '../components/UI';
import { supabase } from '../services/supabaseClient';
import { signInWithGoogle } from '../services/googleAuth';
import { fetchHrDashboard, hrDashboardAction, runHrAutomation, runHrRollup, type HrDashboardPayload } from '../services/hrDashboardService';
import { AlertTriangle, BarChart3, CheckCircle2, Clock3, RefreshCw, Sparkles, Users, X } from 'lucide-react';

type QueueRow = Record<string, unknown>;
const PIPELINE_FLOW = [
  'Checked In',
  'Invited to Live Career Overview Session',
  'Live Career Overview Session Attended',
  'Leadership assessment form sent',
  'Leadership form submitted, awaiting evaluation',
  'Evaluation Done',
  'Interview scheduled',
  'Final decision',
] as const;
const STAGE_ORDER: string[] = [...PIPELINE_FLOW];

const HRDashboard: React.FC = () => {
  const isAuthenticated = useStaffAuthenticated();
  const [email, setEmail] = useState('admin@globelife-paz.com');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [data, setData] = useState<HrDashboardPayload | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<QueueRow | null>(null);
  const [interviewAt, setInterviewAt] = useState('');
  const [interviewComment, setInterviewComment] = useState('');
  const [draggingCandidateId, setDraggingCandidateId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const hasLoadedOnceRef = useRef(false);

  const getAccessToken = useCallback(async () => {
    const { data: s } = await supabase.auth.getSession();
    if (s.session?.access_token) return s.session.access_token;
    const { data: refreshed } = await supabase.auth.refreshSession();
    return refreshed.session?.access_token ?? null;
  }, []);

  const load = useCallback(async () => {
    setError(null);
    const token = await getAccessToken();
    if (!token) {
      setError('Not signed in.');
      return;
    }
    setLoading(true);
    const res = await fetchHrDashboard(token);
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setData(res.data);
  }, [getAccessToken]);

  useEffect(() => {
    void (async () => {
      const { data: s } = await supabase.auth.getSession();
      if (s.session) setIsAuthenticated(true);
    })();
  }, []);

  useEffect(() => {
    if (!isAuthenticated || hasLoadedOnceRef.current) return;
    hasLoadedOnceRef.current = true;
    void (async () => {
      await load();
    })();
  }, [isAuthenticated, load]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setAuthError('Invalid email or password.');
      return;
    }
    setIsAuthenticated(true);
  };

  const handleGoogleLogin = async () => {
    setAuthError(null);
    setGoogleLoading(true);
    const { error } = await signInWithGoogle('/hr-dashboard');
    if (error) setAuthError(error);
    setGoogleLoading(false);
  };

  const runPipeline = async () => {
    setError(null);
    setBanner(null);
    const token = await getAccessToken();
    if (!token) {
      setError('Not signed in.');
      return;
    }
    setRunning(true);
    const rollupRes = await runHrRollup(token, false);
    const automationRes = rollupRes.ok ? await runHrAutomation(token, false) : rollupRes;
    setRunning(false);
    if (!rollupRes.ok) {
      setError(rollupRes.error);
      return;
    }
    if (!automationRes.ok) {
      setError(automationRes.error);
      return;
    }
    setBanner('Data refreshed: readiness, risk flags, and recommendations updated.');
    await load();
  };

  const executeAction = async (action: 'resolve_task' | 'resolve_risk' | 'set_candidate_stage' | 'create_task' | 'set_candidate_interview', payload: Record<string, unknown>, successMsg: string) => {
    const token = await getAccessToken();
    if (!token) return;
    setRunning(true);
    const res = await hrDashboardAction(token, action, payload);
    setRunning(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setBanner(successMsg);
    await load();
  };

  const moveCandidateToStage = useCallback(async (candidateId: string, stage: string) => {
    if (!candidateId || !stage) return;
    await executeAction('set_candidate_stage', { candidate_id: candidateId, stage }, `Moved candidate to ${stage}.`);
  }, [executeAction]);

  const summary = data?.summary ?? {};
  const stageBreakdown = (data?.stage_breakdown ?? []) as Array<Record<string, unknown>>;
  const queue = (data?.action_queue ?? []) as QueueRow[];
  const liveMetrics = data?.live_metrics ?? {};
  const webinarMetrics = data?.webinar_metrics ?? {};

  const executiveCards = useMemo(() => ([
    { label: 'Total Candidates', value: Number(summary.total_candidates ?? 0), icon: <Users size={15} /> },
    { label: 'In Pipeline', value: Number(summary.in_pipeline ?? 0), icon: <BarChart3 size={15} /> },
    { label: 'New (7 Days)', value: Number(summary.new_last_7d ?? 0), icon: <Clock3 size={15} /> },
    { label: 'Assessment Complete', value: Number(summary.assessment_completed ?? 0), icon: <CheckCircle2 size={15} /> },
    { label: 'Open Tasks', value: Number(summary.open_tasks ?? 0), icon: <Clock3 size={15} /> },
    { label: 'Active Risks', value: Number(summary.active_risks ?? 0), icon: <AlertTriangle size={15} /> },
  ]), [summary]);

  const selectedCandidateTasks = useMemo(() => {
    if (!selectedCandidate) return [];
    const cid = String(selectedCandidate.candidate_id || '');
    return (data?.open_tasks ?? []).filter((r) => String(r.candidate_id || '') === cid);
  }, [data?.open_tasks, selectedCandidate]);

  const selectedCandidateRisks = useMemo(() => {
    if (!selectedCandidate) return [];
    const cid = String(selectedCandidate.candidate_id || '');
    return (data?.active_risks ?? []).filter((r) => String(r.candidate_id || '') === cid);
  }, [data?.active_risks, selectedCandidate]);

  const selectedStage = String(selectedCandidate?.pipeline_stage || '');
  const nextStage = useMemo(() => {
    const idx = PIPELINE_FLOW.indexOf(selectedStage as (typeof PIPELINE_FLOW)[number]);
    if (idx === -1 || idx >= PIPELINE_FLOW.length - 1) return null;
    return PIPELINE_FLOW[idx + 1];
  }, [selectedStage]);

  const queueByStage = useMemo(() => {
    const map = new Map<string, QueueRow[]>();
    for (const stage of STAGE_ORDER) map.set(stage, []);
    for (const row of queue) {
      const stage = String(row.pipeline_stage || 'Checked In');
      if (!map.has(stage)) map.set(stage, []);
      map.get(stage)!.push(row);
    }
    return map;
  }, [queue]);

  useEffect(() => {
    if (!selectedCandidate) {
      setInterviewAt('');
      setInterviewComment('');
      return;
    }
    const existing = String(selectedCandidate.interview_scheduled_at || '');
    if (existing) {
      const d = new Date(existing);
      if (!Number.isNaN(d.getTime())) {
        const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        setInterviewAt(local);
      } else {
        setInterviewAt('');
      }
    } else {
      setInterviewAt('');
    }
    setInterviewComment(String(selectedCandidate.next_step || ''));
  }, [selectedCandidate]);


  return (
      <div className="w-full p-5 lg:p-6 space-y-5 text-[#1A2942]">
        <div className="rounded-2xl border border-[#d6deea] bg-white shadow-sm px-5 py-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg sm:text-xl font-extrabold text-[#0B1B34]">HR Executive Command Center</h1>
            <p className="text-xs text-[#73839b]">Pipeline health, live/webinar analytics, and candidate actions in one place.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button type="button" variant="outline" disabled={loading} onClick={() => void load()}>
              <RefreshCw size={16} className={`mr-2 inline ${loading ? 'animate-spin' : ''}`} /> Refresh
            </Button>
            <Button type="button" disabled={running} onClick={() => void runPipeline()}>
              <Sparkles size={16} className="mr-2 inline" /> Rebuild Data
            </Button>
          </div>
        </div>

        {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {banner && <div className="rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{banner}</div>}

        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          {executiveCards.map((card) => (
            <div key={card.label} className="rounded-[18px] border border-[#d6e6f9] bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-[#7a8ba1] inline-flex items-center gap-1">{card.icon}{card.label}</p>
              <p className="text-xl font-bold mt-1 text-[#0B1B34]">{card.value}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <section className="rounded-2xl border border-[#d6deea] bg-white shadow-sm p-4 xl:col-span-1">
            <h3 className="font-bold text-[#0B1B34] mb-3">Pipeline Breakdown</h3>
            <SimpleTable rows={stageBreakdown} columns={['stage', 'count']} />
          </section>
          <section className="rounded-2xl border border-[#d6deea] bg-white shadow-sm p-4 xl:col-span-1">
            <h3 className="font-bold text-[#0B1B34] mb-3">Live Session Analytics</h3>
            <SimpleTable rows={[liveMetrics]} columns={['sessions_count', 'invited_total', 'attended_total', 'attendance_rate_pct', 'latest_generated_at']} />
          </section>
          <section className="rounded-2xl border border-[#d6deea] bg-white shadow-sm p-4 xl:col-span-1">
            <h3 className="font-bold text-[#0B1B34] mb-3">Webinar Analytics (30d)</h3>
            <SimpleTable rows={[webinarMetrics]} columns={['cohorts_30d', 'invited_30d', 'watched_30d', 'watched_live_30d', 'watched_replay_30d']} />
          </section>
        </div>

        <section className="rounded-2xl border border-[#d6deea] bg-white shadow-sm p-4">
          <h3 className="font-bold text-[#0B1B34] mb-1">Candidates by Stage</h3>
          <p className="text-xs text-[#6f7b8d] mb-3">
            Drag candidates between stage columns to update status instantly, or use quick actions inside each card.
          </p>
          {queue.length === 0 ? (
            <div className="text-sm text-[#7b8aa0]">No action queue available yet. Click Rebuild Data.</div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-4 gap-3">
              {STAGE_ORDER.map((stage) => {
                const rows = queueByStage.get(stage) || [];
                const idx = PIPELINE_FLOW.indexOf(stage as (typeof PIPELINE_FLOW)[number]);
                const next = idx >= 0 && idx < PIPELINE_FLOW.length - 1 ? PIPELINE_FLOW[idx + 1] : null;
                return (
                  <div
                    key={stage}
                    className={`rounded-xl border p-3 min-h-[180px] transition ${
                      dragOverStage === stage
                        ? 'border-[#005EB8] bg-[#eef6ff]'
                        : 'border-[#e1eaf8] bg-white'
                    }`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverStage(stage);
                    }}
                    onDragLeave={() => {
                      if (dragOverStage === stage) setDragOverStage(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOverStage(null);
                      const candidateId = e.dataTransfer.getData('text/candidate-id');
                      const sourceStage = e.dataTransfer.getData('text/source-stage');
                      if (!candidateId || sourceStage === stage) return;
                      void moveCandidateToStage(candidateId, stage);
                    }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-bold text-[#0B1B34]">{stage}</h4>
                      <span className="text-[11px] text-[#6f7b8d]">{rows.length} candidate(s)</span>
                    </div>
                    {rows.length === 0 ? (
                      <p className="text-xs text-[#9aa8bb]">No candidates in this stage.</p>
                    ) : (
                      <div className="space-y-2">
                        {rows.map((row, i) => (
                          <div
                            key={`${row.candidate_id as string}-${i}`}
                            draggable
                            onDragStart={(e) => {
                              const candidateId = String(row.candidate_id || '');
                              setDraggingCandidateId(candidateId);
                              e.dataTransfer.setData('text/candidate-id', candidateId);
                              e.dataTransfer.setData('text/source-stage', stage);
                              e.dataTransfer.effectAllowed = 'move';
                            }}
                            onDragEnd={() => {
                              setDraggingCandidateId(null);
                              setDragOverStage(null);
                            }}
                            className={`rounded-lg border p-2.5 bg-[#fbfdff] cursor-grab active:cursor-grabbing ${
                              draggingCandidateId === String(row.candidate_id || '')
                                ? 'border-[#005EB8] ring-2 ring-[#bfdbff]'
                                : 'border-[#edf2fb]'
                            }`}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <button
                                  type="button"
                                  className="font-semibold text-[#0B1B34] hover:underline text-sm"
                                  onClick={() => setSelectedCandidate(row)}
                                >
                                  {formatCell(row.candidate_name)}
                                </button>
                                <p className="text-[11px] text-[#6f7b8d]">
                                  Readiness: {formatCell(row.readiness_band)} ({formatCell(row.readiness_score)}) · Risks: {formatCell(row.active_risk_count)}
                                </p>
                                <p className="text-[11px] text-[#4d5f78] mt-0.5">{formatCell(row.recommended_action)}</p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {next && (
                                  <button
                                    type="button"
                                    className="rounded-lg border border-[#cfe3f9] px-2 py-1 text-[11px] font-semibold text-[#005EB8] hover:bg-[#edf6ff]"
                                    onClick={() => void executeAction('set_candidate_stage', { candidate_id: row.candidate_id, stage: next }, `Moved candidate to ${next}.`)}
                                  >
                                    Move to {next}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="rounded-lg border border-[#f2d8d8] px-2 py-1 text-[11px] font-semibold text-[#b42318] hover:bg-[#fff1f1]"
                                  onClick={() => void executeAction('create_task', { candidate_id: row.candidate_id, task_type: 'call_now', priority: 'high', title: 'Immediate follow-up call', details: 'Manual follow-up from stage board' }, 'Follow-up task created: recruiter should call this candidate.')}
                                >
                                  Create call follow-up
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <section className="rounded-2xl border border-[#d6deea] bg-white shadow-sm p-4">
            <h3 className="font-bold text-[#0B1B34] mb-3">Open Tasks</h3>
            <SimpleTable
              rows={data?.open_tasks ?? []}
              columns={['candidate_name', 'task_type', 'priority', 'status', 'owner_email', 'due_at']}
              onResolve={(row) => {
                const taskId = Number(row.id);
                if (!Number.isFinite(taskId)) return;
                void executeAction('resolve_task', { task_id: taskId }, 'Task marked done.');
              }}
              resolveLabel="Done"
            />
          </section>
          <section className="rounded-2xl border border-[#d6deea] bg-white shadow-sm p-4">
            <h3 className="font-bold text-[#0B1B34] mb-3">Active Risks</h3>
            <SimpleTable
              rows={data?.active_risks ?? []}
              columns={['candidate_name', 'risk_type', 'confidence', 'reason', 'detected_at']}
              onResolve={(row) => {
                const riskId = Number(row.id);
                if (!Number.isFinite(riskId)) return;
                void executeAction('resolve_risk', { risk_id: riskId }, 'Risk marked resolved.');
              }}
              resolveLabel="Resolve"
            />
          </section>
        </div>

        {selectedCandidate && (
          <div className="fixed inset-0 z-50 bg-black/30 flex justify-end">
            <div className="h-full w-full max-w-xl bg-white shadow-2xl border-l border-[#d6deea] overflow-y-auto p-5 space-y-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-[#7a8ba1]">Candidate Profile</p>
                  <h3 className="text-lg font-extrabold text-[#0B1B34]">{formatCell(selectedCandidate.candidate_name)}</h3>
                  <p className="text-xs text-[#6f7b8d]">{formatCell(selectedCandidate.email)}</p>
                </div>
                <button type="button" className="p-2 rounded-lg hover:bg-[#f3f6fb]" onClick={() => setSelectedCandidate(null)}>
                  <X size={16} />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <MiniField label="Stage" value={selectedCandidate.pipeline_stage} />
                <MiniField label="Readiness" value={`${formatCell(selectedCandidate.readiness_band)} (${formatCell(selectedCandidate.readiness_score)})`} />
                <MiniField label="Risks" value={selectedCandidate.active_risk_count} />
                <MiniField label="Priority" value={selectedCandidate.priority} />
              </div>

              <div className="rounded-xl border border-[#dce8f8] p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-[#5f748f] mb-1">Recommended next step</p>
                <p className="text-sm text-[#1A2942]">{formatCell(selectedCandidate.recommended_action)}</p>
              </div>

              <div className="rounded-xl border border-[#dce8f8] p-3 space-y-2">
                <p className="text-xs font-bold uppercase tracking-wide text-[#5f748f]">Quick actions</p>
                <div className="flex flex-wrap gap-2">
                  {nextStage && (
                    <button
                      type="button"
                      className="rounded-lg border border-[#cfe3f9] px-2.5 py-1 text-[11px] font-semibold text-[#005EB8] hover:bg-[#edf6ff]"
                      onClick={() => void executeAction('set_candidate_stage', { candidate_id: selectedCandidate.candidate_id, stage: nextStage }, `Candidate moved to ${nextStage}.`)}
                    >
                      Move to {nextStage}
                    </button>
                  )}
                  <button
                    type="button"
                    className="rounded-lg border border-[#f2d8d8] px-2.5 py-1 text-[11px] font-semibold text-[#b42318] hover:bg-[#fff1f1]"
                    onClick={() => void executeAction('create_task', { candidate_id: selectedCandidate.candidate_id, task_type: 'call_now', priority: 'high', title: 'Immediate follow-up call' }, 'Follow-up task created.')}
                  >
                    Add call task
                  </button>
                </div>
              </div>

              {(selectedStage === 'Leadership form submitted, awaiting evaluation' || selectedStage === 'Evaluation Done') && (
                <div className="rounded-xl border border-[#dce8f8] p-3 space-y-2">
                  <p className="text-xs font-bold uppercase tracking-wide text-[#5f748f]">Interview setup</p>
                  <input
                    type="datetime-local"
                    value={interviewAt}
                    onChange={(e) => setInterviewAt(e.target.value)}
                    className="w-full rounded-lg border border-[#d6deea] px-3 py-2 text-sm"
                  />
                  <textarea
                    value={interviewComment}
                    onChange={(e) => setInterviewComment(e.target.value)}
                    className="w-full rounded-lg border border-[#d6deea] px-3 py-2 text-sm"
                    rows={3}
                    placeholder="Interview notes / instructions for recruiter"
                  />
                  <button
                    type="button"
                    disabled={!interviewAt}
                    className="rounded-lg border border-[#cfe3f9] px-2.5 py-1 text-[11px] font-semibold text-[#005EB8] hover:bg-[#edf6ff] disabled:opacity-50"
                    onClick={() => void executeAction(
                      'set_candidate_interview',
                      {
                        candidate_id: selectedCandidate.candidate_id,
                        interview_at: new Date(interviewAt).toISOString(),
                        interview_comment: interviewComment,
                      },
                      'Interview scheduled and notes saved.',
                    )}
                  >
                    Move to interview & save schedule
                  </button>
                </div>
              )}

              <div className="rounded-xl border border-[#dce8f8] p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-[#5f748f] mb-2">Open tasks for this candidate</p>
                <SimpleTable
                  rows={selectedCandidateTasks}
                  columns={['task_type', 'priority', 'status', 'due_at']}
                  onResolve={(row) => {
                    const taskId = Number(row.id);
                    if (!Number.isFinite(taskId)) return;
                    void executeAction('resolve_task', { task_id: taskId }, 'Task marked done.');
                  }}
                  resolveLabel="Done"
                />
              </div>

              <div className="rounded-xl border border-[#dce8f8] p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-[#5f748f] mb-2">Active risks for this candidate</p>
                <SimpleTable
                  rows={selectedCandidateRisks}
                  columns={['risk_type', 'confidence', 'reason', 'detected_at']}
                  onResolve={(row) => {
                    const riskId = Number(row.id);
                    if (!Number.isFinite(riskId)) return;
                    void executeAction('resolve_risk', { risk_id: riskId }, 'Risk marked resolved.');
                  }}
                  resolveLabel="Resolve"
                />
              </div>
            </div>
          </div>
        )}
      </div>
  );
};

const MiniField = ({ label, value }: { label: string; value: unknown }) => (
  <div className="rounded-lg border border-[#e2ecf9] bg-[#f8fbff] px-3 py-2">
    <p className="text-[10px] uppercase tracking-wide text-[#7a8ba1]">{label}</p>
    <p className="text-sm font-semibold text-[#0B1B34]">{formatCell(value)}</p>
  </div>
);

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  const text = String(value);
  if (text.includes('T') && (text.endsWith('Z') || text.includes('+'))) {
    const d = new Date(text);
    if (!Number.isNaN(d.getTime())) return d.toLocaleString();
  }
  return text;
}

const SimpleTable = ({
  rows,
  columns,
  onResolve,
  resolveLabel,
}: {
  rows: Array<Record<string, unknown>>;
  columns: string[];
  onResolve?: (row: Record<string, unknown>) => void;
  resolveLabel?: string;
}) => (
  <div className="overflow-auto">
    <table className="min-w-full text-xs">
      <thead className="bg-[#f6f9ff]">
        <tr>
          {columns.map((c) => <th key={c} className="text-left font-semibold text-[#5f748f] px-3 py-2 whitespace-nowrap">{c}</th>)}
          {onResolve && <th className="text-left font-semibold text-[#5f748f] px-3 py-2 whitespace-nowrap">action</th>}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={columns.length + (onResolve ? 1 : 0)} className="px-3 py-6 text-center text-[#7b8aa0]">No rows available.</td>
          </tr>
        ) : rows.map((row, i) => (
          <tr key={`${i}-${String(row.id ?? row.candidate_id ?? i)}`} className="border-t border-[#edf2fb]">
            {columns.map((c) => <td key={c} className="px-3 py-2 max-w-xs truncate">{formatCell(row[c])}</td>)}
            {onResolve && (
              <td className="px-3 py-2">
                <button
                  type="button"
                  onClick={() => onResolve(row)}
                  className="rounded-lg border border-[#cfe3f9] px-2 py-1 text-[11px] font-semibold text-[#005EB8] hover:bg-[#edf6ff]"
                >
                  {resolveLabel || 'Resolve'}
                </button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export default HRDashboard;

