import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import { Button } from '../components/UI';
import { supabase } from '../services/supabaseClient';
import { fetchHrDashboard, hrDashboardAction, runHrAutomation, runHrRollup, type HrDashboardPayload } from '../services/hrDashboardService';
import { AlertTriangle, BarChart3, Clock3, RefreshCw, Sparkles, Target, Users } from 'lucide-react';

const HRDashboard: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [email, setEmail] = useState('admin@globelife-paz.com');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [data, setData] = useState<HrDashboardPayload | null>(null);

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
    if (isAuthenticated) void load();
  }, [isAuthenticated, load]);

  const stats = useMemo(() => {
    return {
      total: Number(data?.summary?.total_candidates ?? 0),
      hot: Number(data?.summary?.hot_candidates ?? 0),
      overdue: Number(data?.summary?.overdue_candidates ?? 0),
      openTasks: Number(data?.summary?.open_tasks ?? 0),
      activeRisks: Number(data?.summary?.active_risks ?? 0),
    };
  }, [data]);

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

  const handleRollup = async (dryRun: boolean) => {
    setError(null);
    setBanner(null);
    const token = await getAccessToken();
    if (!token) {
      setError('Not signed in.');
      return;
    }
    setRunning(true);
    const res = await runHrRollup(token, dryRun);
    setRunning(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setBanner(dryRun ? 'Preview completed (no changes saved).' : 'Candidate analytics refreshed and saved.');
    await load();
  };

  const handleAutomation = async (dryRun: boolean) => {
    setError(null);
    setBanner(null);
    const token = await getAccessToken();
    if (!token) {
      setError('Not signed in.');
      return;
    }
    setRunning(true);
    const res = await runHrAutomation(token, dryRun);
    setRunning(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setBanner(dryRun ? 'Preview completed (no changes saved).' : 'Recommended actions refreshed and saved.');
    await load();
  };

  const handleResolveTask = async (taskId: number) => {
    const token = await getAccessToken();
    if (!token) return;
    setRunning(true);
    const res = await hrDashboardAction(token, 'resolve_task', { task_id: taskId });
    setRunning(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setBanner('Task marked as done.');
    await load();
  };

  const handleResolveRisk = async (riskId: number) => {
    const token = await getAccessToken();
    if (!token) return;
    setRunning(true);
    const res = await hrDashboardAction(token, 'resolve_risk', { risk_id: riskId });
    setRunning(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setBanner('Risk marked as resolved.');
    await load();
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#f7fbff] to-[#eef6ff] flex items-center justify-center p-4">
        <div className="bg-white border border-[#d9e9fb] p-8 rounded-[28px] shadow-[0_18px_50px_-24px_rgba(0,94,184,0.35)] w-full max-w-sm">
          <h2 className="text-xl font-bold text-[#0B1B34] mb-1 text-center">HR Dashboard</h2>
          <p className="text-sm text-[#6f7b8d] text-center mb-6">Hidden beta · admin access only</p>
          <form onSubmit={handleLogin} className="space-y-4">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-4 py-2.5 rounded-2xl border border-[#cfe3f9] text-[#0B1B34]" />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-4 py-2.5 rounded-2xl border border-[#cfe3f9] text-[#0B1B34]" />
            <Button fullWidth type="submit">Sign in</Button>
            {authError && <p className="text-sm text-red-600 text-center">{authError}</p>}
          </form>
        </div>
      </div>
    );
  }

  return (
    <Layout isAdmin>
      <div className="w-full p-5 lg:p-6 space-y-5 text-[#1A2942]">
        <div className="rounded-2xl border border-[#d6deea] bg-white shadow-sm px-5 py-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg sm:text-xl font-extrabold text-[#0B1B34]">HR Dashboard</h1>
            <p className="text-xs text-[#73839b]">Hidden beta dashboard for operations, risk and conversion control.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button type="button" variant="outline" disabled={loading} onClick={() => void load()}>
              <RefreshCw size={16} className={`mr-2 inline ${loading ? 'animate-spin' : ''}`} /> Refresh
            </Button>
            <Button type="button" variant="outline" disabled={running} onClick={() => void handleRollup(true)}>
              <BarChart3 size={16} className="mr-2 inline" /> Preview Numbers
            </Button>
            <Button type="button" variant="outline" disabled={running} onClick={() => void handleAutomation(true)}>
              <Sparkles size={16} className="mr-2 inline" /> Preview Actions
            </Button>
            <Button type="button" disabled={running} onClick={() => void handleRollup(false)}>
              <BarChart3 size={16} className="mr-2 inline" /> Recalculate & Save
            </Button>
            <Button type="button" variant="outline" disabled={running} onClick={() => void handleAutomation(false)}>
              <Sparkles size={16} className="mr-2 inline" /> Save Recommended Actions
            </Button>
          </div>
        </div>
        <p className="text-xs text-[#73839b] px-1">
          Preview checks results only. Recalculate & Save writes updated scores, risks, and queues so the dashboard is fully populated.
        </p>

        {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {banner && <div className="rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{banner}</div>}

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Stat icon={<Users size={15} />} label="Candidates" value={stats.total} />
          <Stat icon={<Target size={15} />} label="Hot" value={stats.hot} />
          <Stat icon={<Clock3 size={15} />} label="Overdue" value={stats.overdue} />
          <Stat icon={<BarChart3 size={15} />} label="Open Tasks" value={stats.openTasks} />
          <Stat icon={<AlertTriangle size={15} />} label="Active Risks" value={stats.activeRisks} />
        </div>

        <section className="rounded-2xl border border-[#d6deea] bg-white shadow-sm p-4">
          <h3 className="font-bold text-[#0B1B34] mb-3">Needs Attention Now</h3>
          <QueueTable rows={data?.candidates ?? []} mode="overdue" />
        </section>

        <section className="rounded-2xl border border-[#d6deea] bg-white shadow-sm p-4">
          <h3 className="font-bold text-[#0B1B34] mb-3">Strong Candidates to Prioritize</h3>
          <QueueTable rows={data?.candidates ?? []} mode="top" />
        </section>

        <section className="rounded-2xl border border-[#d6deea] bg-white shadow-sm p-4">
          <h3 className="font-bold text-[#0B1B34] mb-3">Recruiter Action List</h3>
          <SimpleTable
            rows={data?.open_tasks ?? []}
            columns={['candidate_name', 'candidate_date', 'task_type', 'priority', 'status', 'owner_email', 'due_at']}
            onResolve={(row) => {
              const taskId = Number(row.id);
              if (!Number.isFinite(taskId)) return;
              void handleResolveTask(taskId);
            }}
            resolveLabel="Mark done"
          />
        </section>

        <section className="rounded-2xl border border-[#d6deea] bg-white shadow-sm p-4">
          <h3 className="font-bold text-[#0B1B34] mb-3">Follow-up Risks</h3>
          <SimpleTable
            rows={data?.active_risks ?? []}
            columns={['candidate_name', 'candidate_date', 'risk_type', 'confidence', 'reason', 'detected_at']}
            onResolve={(row) => {
              const riskId = Number(row.id);
              if (!Number.isFinite(riskId)) return;
              void handleResolveRisk(riskId);
            }}
            resolveLabel="Resolve"
          />
        </section>
      </div>
    </Layout>
  );
};

const Stat = ({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) => (
  <div className="rounded-[22px] border border-[#d6e6f9] bg-white p-4 shadow-sm">
    <p className="text-xs uppercase tracking-wide text-[#7a8ba1] inline-flex items-center gap-1">{icon}{label}</p>
    <p className="text-xl font-bold mt-1 text-[#0B1B34]">{value}</p>
  </div>
);

const QueueTable = ({ rows, mode }: { rows: Array<Record<string, unknown>>; mode: 'overdue' | 'top' }) => {
  const filtered = (rows || [])
    .filter((r) => (mode === 'overdue' ? Boolean(r.is_overdue) : true))
    .sort((a, b) => {
      if (mode === 'overdue') return Number(b.overdue_minutes ?? 0) - Number(a.overdue_minutes ?? 0);
      return Number(b.readiness_score ?? 0) - Number(a.readiness_score ?? 0);
    })
    .slice(0, 12);

  return (
    <SimpleTable
      rows={filtered}
      columns={
        mode === 'overdue'
          ? ['candidate_name', 'candidate_date', 'pipeline_stage', 'readiness_band', 'readiness_score', 'overdue_minutes']
          : ['candidate_name', 'candidate_date', 'pipeline_stage', 'readiness_band', 'readiness_score', 'active_risk_count']
      }
    />
  );
};

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
            <td colSpan={columns.length + (onResolve ? 1 : 0)} className="px-3 py-6 text-center text-[#7b8aa0]">No rows yet. Click Recalculate & Save to populate data.</td>
          </tr>
        ) : rows.map((row, i) => (
          <tr key={`${i}-${String(row.candidate_id ?? i)}`} className="border-t border-[#edf2fb]">
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

