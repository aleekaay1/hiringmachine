import React, { useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import { Button } from '../components/UI';
import { supabase } from '../services/supabaseClient';
import { signInWithGoogle } from '../services/googleAuth';
import { fetchHrDashboard, runHrAutomation, runHrRollup, type HrDashboardPayload } from '../services/hrDashboardService';

type CandidateLite = {
  id: string;
  timestamp: string;
  status: string;
  admin_data: Record<string, unknown> | null;
};

type PipelineLite = {
  id: string;
  status: string;
  journey_stage: string;
  created_at: string;
  scheduled_for: string | null;
};

type CallLite = {
  id: string;
  action: string;
  outcome: string | null;
  created_at: string;
  request_payload: Record<string, unknown> | null;
  created_by_label: string | null;
  candidate_id: string;
};

type SnapshotStatus = {
  running: boolean;
  message: string | null;
  error: string | null;
  updatedAt: string | null;
};

function normalizeErrorText(error: unknown): string {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (typeof error === 'object') {
    const msg = (error as Record<string, unknown>).message;
    if (typeof msg === 'string' && msg.trim()) return msg;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

function toPercent(numerator: number, denominator: number): string {
  if (!denominator) return '0%';
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function formatDayLabel(key: string): string {
  const d = new Date(`${key}T00:00:00Z`);
  return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
}

function getDialedNumber(payload: Record<string, unknown> | null): string {
  const raw = String(payload?.destination ?? '').trim();
  return raw || '—';
}

const SuperDashboard: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [email, setEmail] = useState('admin@globelife-paz.com');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hrData, setHrData] = useState<HrDashboardPayload | null>(null);
  const [candidates, setCandidates] = useState<CandidateLite[]>([]);
  const [pipelineRows, setPipelineRows] = useState<PipelineLite[]>([]);
  const [portalCalls, setPortalCalls] = useState<CallLite[]>([]);
  const [snapshotStatus, setSnapshotStatus] = useState<SnapshotStatus>({
    running: false,
    message: null,
    error: null,
    updatedAt: null,
  });

  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700;800&family=Sora:wght@500;600;700&display=swap';
    link.id = 'superdashboard-fonts';
    if (!document.getElementById(link.id)) document.head.appendChild(link);
    return () => {
      const existing = document.getElementById(link.id);
      if (existing) existing.remove();
    };
  }, []);

  const getAccessToken = async () => {
    const { data: s } = await supabase.auth.getSession();
    if (s.session?.access_token) return s.session.access_token;
    const { data: refreshed } = await supabase.auth.refreshSession();
    return refreshed.session?.access_token ?? null;
  };

  const needsSnapshotRefresh = (data: HrDashboardPayload | null, candidateCount: number): boolean => {
    if (!data) return candidateCount > 0;
    const summary = (data.summary || {}) as Record<string, unknown>;
    const webinar = (data.webinar_metrics || {}) as Record<string, unknown>;
    const live = (data.live_metrics || {}) as Record<string, unknown>;
    const summaryCandidates = Number(summary.total_candidates || 0);
    const invited30 = Number(webinar.invited_30d || 0);
    const sessions = Number(live.sessions_count || 0);
    const hasFunnel = Array.isArray(data.funnel_daily) && data.funnel_daily.length > 0;
    if (candidateCount === 0) return false;
    return summaryCandidates === 0 || (!hasFunnel && invited30 === 0 && sessions === 0);
  };

  const refreshHrOnly = async (token: string): Promise<HrDashboardPayload | null> => {
    const res = await fetchHrDashboard(token);
    if (!res.ok) {
      setSnapshotStatus((prev) => ({ ...prev, error: normalizeErrorText(res.error), running: false }));
      return null;
    }
    setHrData(res.data);
    return res.data;
  };

  const runSnapshotPipeline = async (token: string, candidateCount: number) => {
    if (candidateCount === 0) return;
    try {
      let automationWarning: string | null = null;
      setSnapshotStatus({
        running: true,
        message: 'Refreshing analytics snapshot (rollup + automation)...',
        error: null,
        updatedAt: null,
      });
      const rollup = await runHrRollup(token, false);
      if (!rollup.ok) {
        setSnapshotStatus({
          running: false,
          message: null,
          error: normalizeErrorText(rollup.error),
          updatedAt: null,
        });
        return;
      }
      const automation = await runHrAutomation(token, false);
      if (!automation.ok) {
        // Keep snapshot flow alive when automation fails.
        automationWarning = normalizeErrorText(automation.error);
      }

      // Poll briefly so page stays loaded while snapshot catches up.
      for (let i = 0; i < 6; i += 1) {
        if (i > 0) {
          await new Promise((r) => window.setTimeout(r, 1500));
        }
        const latest = await refreshHrOnly(token);
        const stillNeedsRefresh = needsSnapshotRefresh(latest, candidateCount);
        if (!stillNeedsRefresh) {
          setSnapshotStatus({
            running: false,
            message: automationWarning
              ? `Snapshot data loaded (automation warning: ${automationWarning}).`
              : 'Snapshot data loaded.',
            error: null,
            updatedAt: new Date().toISOString(),
          });
          return;
        }
        if (i === 5) {
          setSnapshotStatus({
            running: false,
            message: null,
            error: automationWarning
              ? `Snapshot still stale after refresh. Automation warning: ${automationWarning}`
              : 'Snapshot still stale after refresh. Try again in a few seconds.',
            updatedAt: null,
          });
          return;
        }
        setSnapshotStatus((prev) => ({
          ...prev,
          message: `Processing snapshot... (${i + 1}/6)`,
        }));
      }
    } catch (error) {
      setSnapshotStatus({
        running: false,
        message: null,
        error: normalizeErrorText(error),
        updatedAt: null,
      });
    }
  };

  const runSnapshotRecovery = async (token: string, candidateCount: number) => {
    if (candidateCount === 0) return;
    await runSnapshotPipeline(token, candidateCount);
    const latest = await refreshHrOnly(token);
    if (latest && !needsSnapshotRefresh(latest, candidateCount)) {
      setError(null);
      return;
    }
    setError((prev) => {
      if (prev?.trim()) return prev;
      return 'Analytics snapshot is still processing. Retry in a few seconds.';
    });
  };

  const load = async (autoProcess = true) => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) {
        setError('Not signed in.');
        return;
      }

      const [hrRes, cRes, pRes, callRes] = await Promise.all([
        fetchHrDashboard(token),
        supabase.from('candidates').select('id,timestamp,status,admin_data').order('timestamp', { ascending: false }).limit(5000),
        supabase.from('pipeline_candidates').select('id,status,journey_stage,created_at,scheduled_for').order('created_at', { ascending: false }).limit(5000),
        supabase.from('pipeline_call_logs').select('id,action,outcome,created_at,request_payload,created_by_label,candidate_id').order('created_at', { ascending: false }).limit(5000),
      ]);

      if (!hrRes.ok) {
        setError(normalizeErrorText(hrRes.error));
      } else {
        setHrData(hrRes.data);
      }
      if (cRes.error) throw cRes.error;
      if (pRes.error) throw pRes.error;
      if (callRes.error) throw callRes.error;

      const candidateRows = (cRes.data || []) as CandidateLite[];
      setCandidates(candidateRows);
      setPipelineRows((pRes.data || []) as PipelineLite[]);
      const onlyPortal = ((callRes.data || []) as CallLite[]).filter((r) => r.action === 'dial_webclient_popup');
      setPortalCalls(onlyPortal);

      if (autoProcess && (!hrRes.ok || needsSnapshotRefresh(hrRes.ok ? hrRes.data : null, candidateRows.length))) {
        void runSnapshotRecovery(token, candidateRows.length);
      }
    } catch (e) {
      setError(normalizeErrorText(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setIsAuthenticated(true);
        void load();
      }
    });
  }, []);

  const webinarMetrics = (hrData?.webinar_metrics || {}) as Record<string, unknown>;
  const liveMetrics = (hrData?.live_metrics || {}) as Record<string, unknown>;
  const summary = (hrData?.summary || {}) as Record<string, unknown>;

  const stageCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of candidates) {
      const stage = String((c.admin_data || {}).pipelineStage || 'Checked In');
      map.set(stage, (map.get(stage) || 0) + 1);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  }, [candidates]);

  const callByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of portalCalls) {
      const k = dayKey(row.created_at);
      if (!k) continue;
      map.set(k, (map.get(k) || 0) + 1);
    }
    const keys = Array.from(map.keys()).sort().slice(-14);
    return keys.map((k) => ({ key: k, value: map.get(k) || 0 }));
  }, [portalCalls]);

  const applicationsByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of candidates) {
      const k = dayKey(row.timestamp);
      if (!k) continue;
      map.set(k, (map.get(k) || 0) + 1);
    }
    const keys = Array.from(map.keys()).sort().slice(-14);
    return keys.map((k) => ({ key: k, value: map.get(k) || 0 }));
  }, [candidates]);

  const topDialedNumbers = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of portalCalls) {
      const n = getDialedNumber(row.request_payload);
      if (n === '—') continue;
      map.set(n, (map.get(n) || 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [portalCalls]);

  const hiredCount = useMemo(() => {
    return candidates.filter((c) => {
      const admin = c.admin_data || {};
      return String(admin.finalDecision || '').toLowerCase() === 'hired';
    }).length;
  }, [candidates]);

  const appliedCount = candidates.length;
  const openPipelineCount = pipelineRows.filter((p) => p.status !== 'closed').length;
  const scheduledCount = pipelineRows.filter((p) => !!p.scheduled_for).length;
  const portalCalls7d = portalCalls.filter((c) => {
    const t = new Date(c.created_at).getTime();
    return t >= Date.now() - 7 * 24 * 60 * 60 * 1000;
  }).length;
  const uniqueDialed = new Set(portalCalls.map((c) => getDialedNumber(c.request_payload)).filter((n) => n !== '—')).size;
  const webinarInvited30 = Number(webinarMetrics.invited_30d || 0);
  const webinarWatched30 = Number(webinarMetrics.watched_30d || 0);
  const liveAttendanceRate = Number(liveMetrics.attendance_rate_pct || 0);
  const openTasks = Number(summary.open_tasks || 0);
  const activeRisks = Number(summary.active_risks || 0);

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#f5f9ff] to-[#edf5ff] flex items-center justify-center p-4" style={{ fontFamily: 'Manrope, sans-serif' }}>
        <div className="bg-white border border-[#d9e9fb] p-8 rounded-[24px] shadow w-full max-w-sm">
          <h2 className="text-xl font-bold text-[#0B1B34] mb-1 text-center" style={{ fontFamily: 'Sora, sans-serif' }}>Super Dashboard</h2>
          <p className="text-sm text-[#6f7b8d] text-center mb-6">Sign in with admin account</p>
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
              await load();
            }}
            className="space-y-4"
          >
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-4 py-2.5 rounded-xl border border-[#cfe3f9]" />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-4 py-2.5 rounded-xl border border-[#cfe3f9]" />
            <Button fullWidth type="submit">Sign in</Button>
            <div className="relative py-1">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-[#d9e9fb]" />
              </div>
              <div className="relative flex justify-center text-[10px] uppercase tracking-wide text-[#95a6bd]">
                <span className="bg-white px-2">or</span>
              </div>
            </div>
            <Button
              fullWidth
              type="button"
              variant="outline"
              onClick={async () => {
                setAuthError(null);
                setGoogleLoading(true);
                const { error } = await signInWithGoogle('/super-dashboard');
                if (error) setAuthError(error);
                setGoogleLoading(false);
              }}
              disabled={googleLoading}
            >
              {googleLoading ? 'Redirecting...' : 'Continue with Google'}
            </Button>
            {authError && <p className="text-sm text-red-600 text-center">{authError}</p>}
          </form>
        </div>
      </div>
    );
  }

  return (
    <Layout isAdmin>
      <div className="w-full max-w-[1500px] mx-auto p-4 sm:p-6 space-y-5 text-slate-800" style={{ fontFamily: 'Manrope, sans-serif' }}>
        <div className="rounded-[24px] border border-[#dce7ff] bg-gradient-to-r from-[#ffffff] via-[#f6faff] to-[#f1f8ff] px-5 py-4 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-[#102344]" style={{ fontFamily: 'Sora, sans-serif' }}>Super Dashboard</h1>
            <p className="text-xs sm:text-sm text-slate-500">Global hiring intelligence for this portal, with portal-only call tracking and clean operational insights.</p>
          </div>
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh data'}
          </Button>
        </div>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
        {snapshotStatus.running && (
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm text-indigo-700">
            {snapshotStatus.message || 'Processing snapshot data...'}
          </div>
        )}
        {!snapshotStatus.running && snapshotStatus.error && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700">
            Snapshot refresh failed: {snapshotStatus.error}
          </div>
        )}
        {!snapshotStatus.running && snapshotStatus.message && snapshotStatus.updatedAt && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
            {snapshotStatus.message} Updated {new Date(snapshotStatus.updatedAt).toLocaleTimeString()}.
          </div>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-3">
          <Kpi title="Applicants" value={String(appliedCount)} tone="blue" />
          <Kpi title="Hired" value={String(hiredCount)} tone="green" />
          <Kpi title="Hire Rate" value={toPercent(hiredCount, appliedCount)} tone="emerald" />
          <Kpi title="Open Pipeline" value={String(openPipelineCount)} tone="indigo" />
          <Kpi title="Scheduled Calls" value={String(scheduledCount)} tone="violet" />
          <Kpi title="Portal Calls (7d)" value={String(portalCalls7d)} tone="orange" />
          <Kpi title="Dialed Numbers" value={String(uniqueDialed)} tone="amber" />
          <Kpi title="Webinar Show (30d)" value={toPercent(webinarWatched30, webinarInvited30)} tone="pink" />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <Card title="Application Trend (14d)" subtitle="New candidate check-ins">
            <MiniBars data={applicationsByDay} />
          </Card>
          <Card title="Portal Hiring Calls (14d)" subtitle="Calls dialed from /pipeline popup">
            <MiniBars data={callByDay} />
          </Card>
          <Card title="App Health Snapshot" subtitle="Live + webinar + risk posture">
            <div className="space-y-2 text-sm">
              <MetricRow label="Live attendance rate" value={`${liveAttendanceRate.toFixed(1)}%`} />
              <MetricRow label="Webinar invited (30d)" value={String(webinarInvited30)} />
              <MetricRow label="Webinar watched (30d)" value={String(webinarWatched30)} />
              <MetricRow label="Open tasks" value={String(openTasks)} />
              <MetricRow label="Active risks" value={String(activeRisks)} />
            </div>
          </Card>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <Card title="Top Pipeline Stages" subtitle="Current candidate distribution">
            <div className="space-y-2">
              {stageCounts.map(([stage, count]) => (
                <div key={stage} className="flex items-center gap-3">
                  <div className="w-[180px] truncate text-xs text-slate-600">{stage}</div>
                  <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-2 rounded-full bg-gradient-to-r from-[#5b8cff] to-[#58d6ff]" style={{ width: `${Math.max(6, (count / Math.max(1, appliedCount)) * 100)}%` }} />
                  </div>
                  <div className="text-xs font-semibold text-slate-700 w-10 text-right">{count}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Portal Dialed Numbers" subtitle="Only numbers dialed from this portal">
            <div className="max-h-52 overflow-auto rounded-lg border border-slate-100">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-50 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold text-slate-600">Number</th>
                    <th className="text-right px-3 py-2 font-semibold text-slate-600">Calls</th>
                  </tr>
                </thead>
                <tbody>
                  {topDialedNumbers.length === 0 ? (
                    <tr><td colSpan={2} className="px-3 py-5 text-center text-slate-400">No portal call logs yet.</td></tr>
                  ) : topDialedNumbers.map(([num, count]) => (
                    <tr key={num} className="border-t border-slate-100">
                      <td className="px-3 py-2 text-slate-700">{num}</td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-800">{count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <Card title="Recent Portal Calls" subtitle="Hiring calls initiated from popup dial flow only">
          <div className="overflow-auto rounded-lg border border-slate-100">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold text-slate-600">When</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-600">Dialed Number</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-600">Outcome</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-600">Actor</th>
                </tr>
              </thead>
              <tbody>
                {portalCalls.slice(0, 12).map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 text-slate-600">{new Date(r.created_at).toLocaleString()}</td>
                    <td className="px-3 py-2 text-slate-800 font-medium">{getDialedNumber(r.request_payload)}</td>
                    <td className="px-3 py-2 text-slate-600">{r.outcome || 'ok'}</td>
                    <td className="px-3 py-2 text-slate-600">{r.created_by_label || '—'}</td>
                  </tr>
                ))}
                {portalCalls.length === 0 && (
                  <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-400">No portal call records yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </Layout>
  );
};

const Card: React.FC<{ title: string; subtitle?: string; children: React.ReactNode }> = ({ title, subtitle, children }) => (
  <section className="rounded-[20px] border border-[#e1e9fa] bg-white p-4 shadow-[0_8px_24px_-18px_rgba(16,35,68,0.35)]">
    <h3 className="text-sm font-bold text-[#102344]" style={{ fontFamily: 'Sora, sans-serif' }}>{title}</h3>
    {subtitle && <p className="text-[11px] text-slate-500 mb-3">{subtitle}</p>}
    {children}
  </section>
);

const Kpi: React.FC<{ title: string; value: string; tone: 'blue' | 'green' | 'emerald' | 'indigo' | 'violet' | 'orange' | 'amber' | 'pink' }> = ({ title, value, tone }) => {
  const toneMap: Record<string, string> = {
    blue: 'from-[#e9f2ff] to-[#f7fbff] text-[#1b4b9b]',
    green: 'from-[#eafaf1] to-[#f7fffb] text-[#1a7f4a]',
    emerald: 'from-[#e6f8f1] to-[#f6fffc] text-[#0f7f63]',
    indigo: 'from-[#eff1ff] to-[#fafbff] text-[#3b4bb3]',
    violet: 'from-[#f3eeff] to-[#fbf9ff] text-[#6842b2]',
    orange: 'from-[#fff3e8] to-[#fffaf5] text-[#b85a11]',
    amber: 'from-[#fff8e8] to-[#fffdf5] text-[#9b6c13]',
    pink: 'from-[#ffedf5] to-[#fff8fb] text-[#ab2c64]',
  };
  return (
    <div className={`rounded-2xl border border-white/60 bg-gradient-to-br ${toneMap[tone]} px-3 py-3`}>
      <p className="text-[11px] uppercase tracking-wide opacity-80">{title}</p>
      <p className="text-xl font-extrabold mt-1" style={{ fontFamily: 'Sora, sans-serif' }}>{value}</p>
    </div>
  );
};

const MetricRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
    <span className="text-slate-600">{label}</span>
    <span className="font-semibold text-slate-800">{value}</span>
  </div>
);

const MiniBars: React.FC<{ data: Array<{ key: string; value: number }> }> = ({ data }) => {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="space-y-2">
      {data.length === 0 && <p className="text-xs text-slate-400">No trend data yet.</p>}
      {data.map((d) => (
        <div key={d.key} className="grid grid-cols-[54px_1fr_34px] items-center gap-2">
          <span className="text-[11px] text-slate-500">{formatDayLabel(d.key)}</span>
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-2 rounded-full bg-gradient-to-r from-[#4b8fff] to-[#63d8ff]" style={{ width: `${Math.max(8, (d.value / max) * 100)}%` }} />
          </div>
          <span className="text-[11px] text-right font-semibold text-slate-700">{d.value}</span>
        </div>
      ))}
    </div>
  );
};

export default SuperDashboard;
