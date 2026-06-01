import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Crown,
  Flame,
  Medal,
  RefreshCw,
  Sparkles,
  Target,
  Trophy,
  Users,
} from 'lucide-react';
import PipelineAuthShell from '../components/PipelineAuthShell';
import { Button } from '../components/UI';
import { getCurrentUserProfile, listAllUserProfiles, type AppRole } from '../services/accessControl';
import { classifyBookedOutcome, loadScopedWebinarRowsForViewer } from '../services/pipelineBookedOutcomes';
import {
  buildCompositeLeaderboard,
  buildLeaderboardWindows,
  type LeaderboardPeriod,
  type RecruiterLeaderboardRow,
} from '../services/pipelineLeaderboard';
import { listPipelineCallRecords } from '../services/pipelineService';
import { supabase } from '../services/supabaseClient';

const PERIODS: Array<{ id: LeaderboardPeriod; label: string }> = [
  { id: 'last7', label: 'Last 7 days' },
  { id: 'last30', label: 'Last 30 days' },
  { id: 'thisMonth', label: 'This month' },
];

const GOALS = {
  calls: 40,
  booked: 12,
  showRate: 0.7,
};

function pct(value: number): number {
  return Math.round(value * 100);
}

function clamp(value: number, max = 100): number {
  return Math.max(0, Math.min(max, value));
}

function movementNode(delta: number) {
  if (delta > 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-1 text-[11px] font-semibold text-emerald-100">
        <ArrowUpRight size={12} /> +{delta}
      </span>
    );
  }
  if (delta < 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/20 px-2 py-1 text-[11px] font-semibold text-rose-100">
        <ArrowDownRight size={12} /> {delta}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-500/20 px-2 py-1 text-[11px] font-semibold text-slate-200">
      <ArrowRight size={12} /> 0
    </span>
  );
}

function overtakeMessage(row: RecruiterLeaderboardRow): string | null {
  if (row.passedLabel) return `You passed ${row.passedLabel}`;
  if (row.overtakenByLabel) return `${row.overtakenByLabel} passed you`;
  return null;
}

const LeadershipLeaderboard: React.FC = () => {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [period, setPeriod] = React.useState<LeaderboardPeriod>('last7');
  const [rows, setRows] = React.useState<RecruiterLeaderboardRow[]>([]);
  const [viewerRole, setViewerRole] = React.useState<AppRole | null>(null);
  const [viewerUserId, setViewerUserId] = React.useState<string | null>(null);
  const [selectedKey, setSelectedKey] = React.useState<string>('all');
  const [windowLabel, setWindowLabel] = React.useState('Last 7 days');
  const [lastUpdated, setLastUpdated] = React.useState<string | null>(null);

  const leadershipView = viewerRole === 'admin' || viewerRole === 'leadership';

  const loadLeaderboard = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ data: authData }, profile] = await Promise.all([
        supabase.auth.getUser(),
        getCurrentUserProfile(),
      ]);
      const userId = authData.user?.id || null;
      setViewerUserId(userId);
      setViewerRole(profile?.role ?? null);

      const windows = buildLeaderboardWindows(period);
      setWindowLabel(windows.current.label);
      const recruiterFilter = profile?.role === 'recruiter' ? userId : null;

      const [currentRecords, previousRecords] = await Promise.all([
        listPipelineCallRecords({
          fromIso: windows.current.fromIso,
          toIso: windows.current.toIso,
          recruiterUserId: recruiterFilter,
          limit: 6000,
        }),
        listPipelineCallRecords({
          fromIso: windows.previous.fromIso,
          toIso: windows.previous.toIso,
          recruiterUserId: recruiterFilter,
          limit: 6000,
        }),
      ]);
      const candidateIds = [...new Set([...currentRecords, ...previousRecords].map((r) => r.candidate_id).filter(Boolean))];

      const [scopedWebinarRows, candidateRows, profiles] = await Promise.all([
        loadScopedWebinarRowsForViewer({
          role: profile?.role ?? null,
          viewerEmail: authData.user?.email ?? profile?.email ?? null,
          viewerFullName: profile?.full_name ?? null,
        }),
        (async () => {
          if (!candidateIds.length) return [];
          const { data, error: candidateError } = await supabase
            .from('pipeline_candidates')
            .select('id,email')
            .in('id', candidateIds)
            .limit(7000);
          if (candidateError) throw candidateError;
          return (data || []) as Array<{ id: string; email: string | null }>;
        })(),
        listAllUserProfiles().catch(() => []),
      ]);

      const rowsByEmail = new Map<string, Array<Record<string, unknown>>>();
      for (const row of scopedWebinarRows as Array<Record<string, unknown>>) {
        const email = String(row.email || '').trim().toLowerCase();
        if (!email) continue;
        if (!rowsByEmail.has(email)) rowsByEmail.set(email, []);
        rowsByEmail.get(email)!.push(row);
      }
      const candidateEmailMap = new Map(candidateRows.map((row) => [row.id, String(row.email || '').trim().toLowerCase()]));
      const recruiterDirectory = new Map(
        profiles.map((item) => [item.user_id, { fullName: item.full_name, email: item.email ?? null }]),
      );

      const computed = buildCompositeLeaderboard({
        currentRecords,
        previousRecords,
        candidateEmailMap,
        recruiterDirectory,
        classifyWebinarShow: (bookedSubtype, candidateEmail) => {
          if (bookedSubtype !== 'webinar') return false;
          if (!candidateEmail) return false;
          const result = classifyBookedOutcome({
            bookedSubtype,
            candidateEmail,
            rowsByEmail,
          });
          return result.watchedSignal;
        },
      });
      setRows(computed);
      setLastUpdated(new Date().toISOString());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [period]);

  React.useEffect(() => {
    void loadLeaderboard();
  }, [loadLeaderboard]);

  React.useEffect(() => {
    if (selectedKey === 'all') return;
    if (rows.some((row) => row.recruiterKey === selectedKey)) return;
    setSelectedKey('all');
  }, [rows, selectedKey]);

  const viewerRow = React.useMemo(() => rows.find((row) => row.recruiterUserId && row.recruiterUserId === viewerUserId) || null, [rows, viewerUserId]);
  const shownRows = React.useMemo(() => {
    if (selectedKey === 'all') return rows;
    return rows.filter((row) => row.recruiterKey === selectedKey);
  }, [rows, selectedKey]);
  const topPerformer = rows[0] || null;
  const formulaCopy =
    'Score = 100 x (0.50 x quality + 0.30 x bookedNorm + 0.20 x callsNorm), with quality = smoothed show ratio x (0.55 + 0.45 x lowSampleFactor).';

  return (
    <PipelineAuthShell
      title="Leadership Leaderboard"
      subtitle="Sign in to view the performance leaderboard"
      redirectPath="/calls-analytics/leaderboard"
    >
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Outfit:wght@500;600;700;800&display=swap');`}</style>
      <div
        className="relative mx-auto w-full max-w-[1480px] overflow-hidden rounded-[36px] border border-white/15 bg-[#070b19] p-4 text-slate-100 shadow-[0_40px_120px_-56px_rgba(56,189,248,0.45)] md:p-6"
        style={{ fontFamily: 'Inter, system-ui, sans-serif' }}
      >
        <div className="pointer-events-none absolute -left-24 top-[-7rem] h-96 w-96 rounded-full bg-gradient-to-br from-fuchsia-500/35 via-indigo-500/15 to-transparent blur-3xl" />
        <div className="pointer-events-none absolute -right-28 top-16 h-96 w-96 rounded-full bg-gradient-to-br from-cyan-500/30 via-sky-500/10 to-transparent blur-3xl" />
        <div className="pointer-events-none absolute bottom-[-8rem] left-1/3 h-96 w-96 rounded-full bg-gradient-to-tr from-emerald-400/20 via-violet-400/15 to-transparent blur-3xl" />

        <div className="relative z-10 space-y-4">
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl border border-white/15 bg-white/[0.045] p-4 backdrop-blur-xl md:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.26em] text-cyan-100/80">Leadership arena</p>
                <h1 className="text-2xl font-semibold tracking-tight text-white" style={{ fontFamily: 'Outfit, Inter, system-ui, sans-serif' }}>
                  Calls Performance Leaderboard
                </h1>
                <p className="mt-1 max-w-3xl text-xs text-slate-300">
                  Composite ranking balances conversion quality, booked outcomes, and activity volume. Low sample sizes are soft-normalized before ranking.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" className="!min-h-0 h-9 border-white/25 !bg-white/10 !text-slate-100 hover:!bg-white/15" onClick={() => void loadLeaderboard()} disabled={loading}>
                  <RefreshCw size={14} className={loading ? 'mr-1 animate-spin' : 'mr-1'} />
                  Refresh
                </Button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {PERIODS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setPeriod(item.id)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    period === item.id
                      ? 'border-cyan-200/65 bg-cyan-300/20 text-cyan-100'
                      : 'border-white/20 bg-white/5 text-slate-300 hover:bg-white/10'
                  }`}
                >
                  {item.label}
                </button>
              ))}
              {leadershipView && (
                <select
                  value={selectedKey}
                  onChange={(e) => setSelectedKey(e.target.value)}
                  className="ml-auto rounded-xl border border-white/20 bg-white/10 px-2.5 py-1.5 text-xs text-slate-100"
                >
                  <option value="all">All recruiters</option>
                  {rows.map((row) => (
                    <option key={row.recruiterKey} value={row.recruiterKey}>
                      {row.displayName}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <p className="mt-2 text-[11px] text-slate-400">
              {windowLabel} {lastUpdated ? `· Updated ${new Date(lastUpdated).toLocaleString()}` : ''}
            </p>
          </motion.div>

          <div className="grid gap-3 lg:grid-cols-[1.35fr_1fr]">
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl border border-amber-300/30 bg-gradient-to-br from-amber-400/15 via-fuchsia-500/10 to-cyan-500/10 p-4 backdrop-blur-xl">
              <p className="text-[10px] uppercase tracking-[0.2em] text-amber-100/90">Top Performer</p>
              {topPerformer ? (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xl font-semibold text-white" style={{ fontFamily: 'Outfit, Inter, system-ui, sans-serif' }}>
                      {topPerformer.displayName}
                    </p>
                    <p className="text-xs text-amber-100/90">
                      Score {topPerformer.score.toFixed(2)} · Ratio {pct(topPerformer.showRatio)}% · Booked {topPerformer.booked} · Calls {topPerformer.calls}
                    </p>
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-amber-200/40 bg-amber-300/20 px-3 py-1.5 text-xs font-semibold text-amber-50">
                    <Crown size={14} />
                    Reigning Champion
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-sm text-slate-300">No records in this window yet.</p>
              )}
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl border border-white/15 bg-white/[0.045] p-4 backdrop-blur-xl">
              <p className="text-[10px] uppercase tracking-[0.2em] text-cyan-100">Scoring Formula</p>
              <p className="mt-2 text-xs text-slate-300">{formulaCopy}</p>
              <p className="mt-2 text-[11px] text-slate-400">
                Show-ratio quality uses Bayesian smoothing: webinar ratio = (showed + 2) / (webinar booked + 4), plus low-sample factor = min(1, calls/15).
              </p>
            </motion.div>
          </div>

          {viewerRow && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl border border-cyan-300/35 bg-gradient-to-r from-cyan-400/20 via-indigo-500/15 to-fuchsia-500/20 p-4 backdrop-blur-xl">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="inline-flex items-center gap-1 rounded-full border border-cyan-200/50 bg-cyan-200/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-50">
                    <Sparkles size={11} /> You are here
                  </p>
                  <h2 className="mt-2 text-xl font-semibold text-white" style={{ fontFamily: 'Outfit, Inter, system-ui, sans-serif' }}>
                    Rank #{viewerRow.rank} · {viewerRow.displayName}
                  </h2>
                  <p className="mt-1 text-xs text-cyan-50/90">
                    Score {viewerRow.score.toFixed(2)} · Ratio {pct(viewerRow.showRatio)}% · Booked {viewerRow.booked} · Calls {viewerRow.calls}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  {movementNode(viewerRow.rankDelta)}
                  {overtakeMessage(viewerRow) && (
                    <span className="rounded-full border border-white/30 bg-white/15 px-2 py-1 text-[11px] font-semibold text-white">
                      {overtakeMessage(viewerRow)}
                    </span>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          <div className="rounded-3xl border border-white/15 bg-white/[0.045] p-4 backdrop-blur-xl">
            <div className="mb-3 flex items-center gap-2">
              <Users size={16} className="text-cyan-200" />
              <h3 className="text-sm font-semibold text-white">Leadership Board</h3>
            </div>
            {loading ? (
              <div className="rounded-2xl border border-white/20 bg-white/5 px-4 py-6 text-center text-sm text-slate-300">
                Loading leaderboard...
              </div>
            ) : error ? (
              <div className="rounded-2xl border border-rose-300/40 bg-rose-500/15 px-4 py-3 text-sm text-rose-100">
                {error}
              </div>
            ) : (
              <div className="space-y-2">
                <AnimatePresence>
                  {shownRows.map((row, index) => {
                    const isViewer = viewerRow?.recruiterKey === row.recruiterKey;
                    const callProgress = clamp((row.calls / GOALS.calls) * 100);
                    const bookedProgress = clamp((row.booked / GOALS.booked) * 100);
                    const showRateProgress = clamp((row.showRatio / GOALS.showRate) * 100);
                    return (
                      <motion.article
                        key={row.recruiterKey}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.2, delay: index * 0.025 }}
                        className={`rounded-2xl border p-3 transition ${
                          isViewer
                            ? 'border-cyan-200/60 bg-cyan-400/15 shadow-[0_16px_36px_-24px_rgba(34,211,238,0.95)]'
                            : 'border-white/15 bg-white/5 hover:bg-white/10'
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="flex items-start gap-2">
                            <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
                              row.rank === 1 ? 'bg-amber-300/25 text-amber-100' :
                              row.rank === 2 ? 'bg-slate-300/20 text-slate-100' :
                              row.rank === 3 ? 'bg-orange-300/20 text-orange-100' : 'bg-slate-400/20 text-slate-200'
                            }`}>
                              {row.rank}
                            </span>
                            <div>
                              <p className="text-sm font-semibold text-white">
                                {row.displayName}
                              </p>
                              <p className="text-[11px] text-slate-300">
                                Ratio {pct(row.showRatio)}% · Booked {row.booked} · Calls {row.calls} · Score {row.score.toFixed(2)}
                              </p>
                              <div className="mt-1 flex flex-wrap gap-1">
                                {isViewer && (
                                  <span className="rounded-full border border-cyan-200/50 bg-cyan-200/20 px-2 py-0.5 text-[10px] font-semibold text-cyan-100">
                                    You are here
                                  </span>
                                )}
                                {row.badges.map((badge) => (
                                  <span key={badge} className="rounded-full border border-white/25 bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-slate-100">
                                    {badge}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {movementNode(row.rankDelta)}
                          </div>
                        </div>
                        <div className="mt-3 grid gap-2 md:grid-cols-3">
                          <div className="rounded-xl border border-white/15 bg-black/20 px-2.5 py-2">
                            <p className="text-[10px] uppercase tracking-wide text-slate-400">Call Goal</p>
                            <p className="text-[11px] text-slate-200">{row.calls}/{GOALS.calls}</p>
                            <div className="mt-1 h-1.5 rounded-full bg-slate-700/70">
                              <div className="h-full rounded-full bg-cyan-300" style={{ width: `${callProgress}%` }} />
                            </div>
                          </div>
                          <div className="rounded-xl border border-white/15 bg-black/20 px-2.5 py-2">
                            <p className="text-[10px] uppercase tracking-wide text-slate-400">Booked Goal</p>
                            <p className="text-[11px] text-slate-200">{row.booked}/{GOALS.booked}</p>
                            <div className="mt-1 h-1.5 rounded-full bg-slate-700/70">
                              <div className="h-full rounded-full bg-violet-300" style={{ width: `${bookedProgress}%` }} />
                            </div>
                          </div>
                          <div className="rounded-xl border border-white/15 bg-black/20 px-2.5 py-2">
                            <p className="text-[10px] uppercase tracking-wide text-slate-400">Show-Rate Goal</p>
                            <p className="text-[11px] text-slate-200">{pct(row.showRatio)}% / {pct(GOALS.showRate)}%</p>
                            <div className="mt-1 h-1.5 rounded-full bg-slate-700/70">
                              <div className="h-full rounded-full bg-emerald-300" style={{ width: `${showRateProgress}%` }} />
                            </div>
                          </div>
                        </div>
                      </motion.article>
                    );
                  })}
                </AnimatePresence>
              </div>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-white/15 bg-white/[0.045] p-3">
              <p className="inline-flex items-center gap-1 text-xs font-semibold text-amber-100"><Trophy size={14} /> Top Performer</p>
              <p className="mt-1 text-[11px] text-slate-300">Best weighted score in selected window.</p>
            </div>
            <div className="rounded-2xl border border-white/15 bg-white/[0.045] p-3">
              <p className="inline-flex items-center gap-1 text-xs font-semibold text-rose-100"><Flame size={14} /> Fast Climber</p>
              <p className="mt-1 text-[11px] text-slate-300">Moved up 2+ positions vs previous window.</p>
            </div>
            <div className="rounded-2xl border border-white/15 bg-white/[0.045] p-3">
              <p className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-100"><Medal size={14} /> Consistent Closer</p>
              <p className="mt-1 text-[11px] text-slate-300">Smoothed show ratio ≥ 65% with minimum volume.</p>
            </div>
          </div>

          <div className="rounded-2xl border border-white/15 bg-white/[0.045] p-3 text-[11px] text-slate-300">
            <p className="inline-flex items-center gap-1 font-semibold text-cyan-100"><Target size={13} /> Role-aware behavior</p>
            <p className="mt-1">
              Recruiters see a personal spotlight and leaderboard context under current visibility rules; leadership/admin can filter team-wide and compare movement by period.
            </p>
          </div>
        </div>
      </div>
    </PipelineAuthShell>
  );
};

export default LeadershipLeaderboard;
