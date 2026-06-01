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
  type LeaderboardRecruiterSeed,
  type LeaderboardPeriod,
  type RecruiterLeaderboardRow,
} from '../services/pipelineLeaderboard';
import { listPipelineCallRecords } from '../services/pipelineService';
import { supabase } from '../services/supabaseClient';

const PERIODS: Array<{ id: LeaderboardPeriod; label: string }> = [
  { id: 'last7', label: 'Weekly' },
  { id: 'last30', label: '30 Days' },
  { id: 'thisMonth', label: 'Monthly' },
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
  const [previousRows, setPreviousRows] = React.useState<RecruiterLeaderboardRow[]>([]);
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
      // Global board: always include all recruiters regardless of viewer role.
      const recruiterFilter = null;

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
          role: 'admin',
          viewerEmail: null,
          viewerFullName: null,
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
      const recruiterSeeds: LeaderboardRecruiterSeed[] = profiles
        .filter((item) => item.role === 'recruiter')
        .map((item) => ({
          recruiterKey: `uid:${item.user_id}`,
          recruiterUserId: item.user_id,
          displayName: String(item.full_name || '').trim() || 'Unknown Recruiter',
        }));

      const computed = buildCompositeLeaderboard({
        currentRecords,
        previousRecords,
        candidateEmailMap,
        recruiterDirectory,
        recruiterSeeds,
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
      const previousComputed = buildCompositeLeaderboard({
        currentRecords: previousRecords,
        previousRecords: [],
        candidateEmailMap,
        recruiterDirectory,
        recruiterSeeds,
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
      setPreviousRows(previousComputed);
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
    const id = window.setInterval(() => {
      void loadLeaderboard();
    }, 60000);
    return () => window.clearInterval(id);
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
  const previousTopPerformer = previousRows[0] || null;
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
        className="relative mx-auto w-full max-w-[1480px] overflow-hidden rounded-[36px] border border-[#d7e4f5] bg-[#f7fbff] p-4 text-[#102344] shadow-[0_34px_95px_-60px_rgba(0,94,184,0.4)] md:p-6"
        style={{ fontFamily: 'Inter, system-ui, sans-serif' }}
      >
        <div className="pointer-events-none absolute -left-24 top-[-7rem] h-96 w-96 rounded-full bg-gradient-to-br from-indigo-500/18 via-sky-400/12 to-transparent blur-3xl" />
        <div className="pointer-events-none absolute -right-28 top-16 h-96 w-96 rounded-full bg-gradient-to-br from-amber-300/25 via-rose-300/10 to-transparent blur-3xl" />
        <div className="pointer-events-none absolute bottom-[-8rem] left-1/3 h-96 w-96 rounded-full bg-gradient-to-tr from-emerald-300/18 via-cyan-300/10 to-transparent blur-3xl" />

        <div className="relative z-10 space-y-4">
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl border border-[#d9e5f6] bg-white/80 p-4 backdrop-blur-xl md:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.26em] text-[#4e79a9]">Leadership arena</p>
                <h1 className="text-2xl font-semibold tracking-tight text-[#0B1B34]" style={{ fontFamily: 'Outfit, Inter, system-ui, sans-serif' }}>
                  Calls Performance Leaderboard
                </h1>
                <p className="mt-1 max-w-3xl text-xs text-[#4f6886]">
                  Composite ranking balances conversion quality, booked outcomes, and activity volume. Low sample sizes are soft-normalized before ranking.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" className="!min-h-0 h-9 border-[#c3d8f2] !bg-white !text-[#0B1B34] hover:!bg-[#eef6ff]" onClick={() => void loadLeaderboard()} disabled={loading}>
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
                      ? 'border-[#8bc3ff] bg-[#dff0ff] text-[#0B1B34]'
                      : 'border-[#d2e1f5] bg-white text-[#446181] hover:bg-[#f4f9ff]'
                  }`}
                >
                  {item.label}
                </button>
              ))}
              {leadershipView && (
                <select
                  value={selectedKey}
                  onChange={(e) => setSelectedKey(e.target.value)}
                  className="ml-auto rounded-xl border border-[#d2e1f5] bg-white px-2.5 py-1.5 text-xs text-[#0B1B34]"
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
            <p className="mt-2 text-[11px] text-[#5c7594]">
              {windowLabel} {lastUpdated ? `· Updated ${new Date(lastUpdated).toLocaleString()}` : ''}
            </p>
          </motion.div>

          <div className="grid gap-3 lg:grid-cols-[1.1fr_1.1fr_1fr]">
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl border border-[#f2d9aa] bg-gradient-to-br from-[#fff8ea] via-[#fffaf2] to-[#f2f7ff] p-4 backdrop-blur-xl">
              <p className="text-[10px] uppercase tracking-[0.2em] text-[#9b6b00]">Top Performer (Current)</p>
              {topPerformer ? (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xl font-semibold text-[#0B1B34]" style={{ fontFamily: 'Outfit, Inter, system-ui, sans-serif' }}>
                      {topPerformer.displayName}
                    </p>
                    <p className="text-xs text-[#6d5a39]">
                      Score {topPerformer.score.toFixed(2)} · Ratio {pct(topPerformer.showRatio)}% · Booked {topPerformer.booked} · Calls {topPerformer.calls}
                    </p>
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-[#f0ce8f] bg-[#ffecc5] px-3 py-1.5 text-xs font-semibold text-[#7e5400]">
                    <Crown size={14} />
                    Reigning Champion
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-sm text-slate-300">No records in this window yet.</p>
              )}
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl border border-[#d9e5f6] bg-white/80 p-4 backdrop-blur-xl">
              <p className="text-[10px] uppercase tracking-[0.2em] text-[#2f6ea8]">Top Performer (Previous Window)</p>
              {previousTopPerformer ? (
                <div className="mt-2">
                  <p className="text-lg font-semibold text-[#0B1B34]" style={{ fontFamily: 'Outfit, Inter, system-ui, sans-serif' }}>
                    {previousTopPerformer.displayName}
                  </p>
                  <p className="text-xs text-[#4f6886]">
                    Score {previousTopPerformer.score.toFixed(2)} · Ratio {pct(previousTopPerformer.showRatio)}% · Booked {previousTopPerformer.booked} · Calls {previousTopPerformer.calls}
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-sm text-[#4f6886]">No previous-window records available.</p>
              )}
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl border border-[#d9e5f6] bg-white/80 p-4 backdrop-blur-xl">
              <p className="text-[10px] uppercase tracking-[0.2em] text-[#2f6ea8]">Scoring Formula</p>
              <p className="mt-2 text-xs text-[#4f6886]">{formulaCopy}</p>
              <p className="mt-2 text-[11px] text-[#6a839f]">
                Show-ratio quality uses Bayesian smoothing: webinar ratio = (showed + 2) / (webinar booked + 4), plus low-sample factor = min(1, calls/15).
              </p>
            </motion.div>
          </div>

          {viewerRow && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl border border-[#9bc8f6] bg-gradient-to-r from-[#e7f4ff] via-[#eef6ff] to-[#f8f2ff] p-4 backdrop-blur-xl">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="inline-flex items-center gap-1 rounded-full border border-[#9bc8f6] bg-[#dff0ff] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#0B1B34]">
                    <Sparkles size={11} /> You are here
                  </p>
                  <h2 className="mt-2 text-xl font-semibold text-[#0B1B34]" style={{ fontFamily: 'Outfit, Inter, system-ui, sans-serif' }}>
                    Rank #{viewerRow.rank} · {viewerRow.displayName}
                  </h2>
                  <p className="mt-1 text-xs text-[#4f6886]">
                    Score {viewerRow.score.toFixed(2)} · Ratio {pct(viewerRow.showRatio)}% · Booked {viewerRow.booked} · Calls {viewerRow.calls}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  {movementNode(viewerRow.rankDelta)}
                  {overtakeMessage(viewerRow) && (
                    <span className="rounded-full border border-[#bfd8f5] bg-white px-2 py-1 text-[11px] font-semibold text-[#0B1B34]">
                      {overtakeMessage(viewerRow)}
                    </span>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          <div className="rounded-3xl border border-[#d9e5f6] bg-white/80 p-4 backdrop-blur-xl">
            <div className="mb-3 flex items-center gap-2">
              <Users size={16} className="text-[#2f6ea8]" />
              <h3 className="text-sm font-semibold text-[#0B1B34]">Leadership Board</h3>
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
                            ? 'border-[#9bc8f6] bg-[#e7f4ff] shadow-[0_16px_36px_-24px_rgba(0,94,184,0.35)]'
                            : 'border-[#d9e5f6] bg-white hover:bg-[#f7fbff]'
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="flex items-start gap-2">
                            <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
                              row.rank === 1 ? 'bg-[#ffe9b8] text-[#7e5400]' :
                              row.rank === 2 ? 'bg-[#edf2f8] text-[#3f556e]' :
                              row.rank === 3 ? 'bg-[#ffe6d1] text-[#8a4f16]' : 'bg-[#f1f6fd] text-[#4f6886]'
                            }`}>
                              {row.rank}
                            </span>
                            <div>
                              <p className="text-sm font-semibold text-[#0B1B34]">
                                {row.displayName}
                              </p>
                              <p className="text-[11px] text-[#5c7594]">
                                Ratio {pct(row.showRatio)}% · Booked {row.booked} · Calls {row.calls} · Score {row.score.toFixed(2)}
                              </p>
                              <div className="mt-1 flex flex-wrap gap-1">
                                {isViewer && (
                                  <span className="rounded-full border border-[#9bc8f6] bg-[#dff0ff] px-2 py-0.5 text-[10px] font-semibold text-[#0B1B34]">
                                    You are here
                                  </span>
                                )}
                                {row.badges.map((badge) => (
                                  <span key={badge} className="rounded-full border border-[#d4e3f6] bg-[#f4f9ff] px-2 py-0.5 text-[10px] font-semibold text-[#35567a]">
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
                          <div className="rounded-xl border border-[#dfeaf8] bg-[#f9fcff] px-2.5 py-2">
                            <p className="text-[10px] uppercase tracking-wide text-[#6d86a3]">Call Goal</p>
                            <p className="text-[11px] text-[#35567a]">{row.calls}/{GOALS.calls}</p>
                            <div className="mt-1 h-1.5 rounded-full bg-[#dfeaf8]">
                              <div className="h-full rounded-full bg-[#67b5ff]" style={{ width: `${callProgress}%` }} />
                            </div>
                          </div>
                          <div className="rounded-xl border border-[#dfeaf8] bg-[#f9fcff] px-2.5 py-2">
                            <p className="text-[10px] uppercase tracking-wide text-[#6d86a3]">Booked Goal</p>
                            <p className="text-[11px] text-[#35567a]">{row.booked}/{GOALS.booked}</p>
                            <div className="mt-1 h-1.5 rounded-full bg-[#dfeaf8]">
                              <div className="h-full rounded-full bg-[#ad8cff]" style={{ width: `${bookedProgress}%` }} />
                            </div>
                          </div>
                          <div className="rounded-xl border border-[#dfeaf8] bg-[#f9fcff] px-2.5 py-2">
                            <p className="text-[10px] uppercase tracking-wide text-[#6d86a3]">Show-Rate Goal</p>
                            <p className="text-[11px] text-[#35567a]">{pct(row.showRatio)}% / {pct(GOALS.showRate)}%</p>
                            <div className="mt-1 h-1.5 rounded-full bg-[#dfeaf8]">
                              <div className="h-full rounded-full bg-[#53c78b]" style={{ width: `${showRateProgress}%` }} />
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
            <div className="rounded-2xl border border-[#d9e5f6] bg-white/80 p-3">
              <p className="inline-flex items-center gap-1 text-xs font-semibold text-[#7e5400]"><Trophy size={14} /> Top Performer</p>
              <p className="mt-1 text-[11px] text-[#5c7594]">Best weighted score in selected window.</p>
            </div>
            <div className="rounded-2xl border border-[#d9e5f6] bg-white/80 p-3">
              <p className="inline-flex items-center gap-1 text-xs font-semibold text-[#a84a4a]"><Flame size={14} /> Fast Climber</p>
              <p className="mt-1 text-[11px] text-[#5c7594]">Moved up 2+ positions vs previous window.</p>
            </div>
            <div className="rounded-2xl border border-[#d9e5f6] bg-white/80 p-3">
              <p className="inline-flex items-center gap-1 text-xs font-semibold text-[#2c8a62]"><Medal size={14} /> Consistent Closer</p>
              <p className="mt-1 text-[11px] text-[#5c7594]">Smoothed show ratio ≥ 65% with minimum volume.</p>
            </div>
          </div>

          <div className="rounded-2xl border border-[#d9e5f6] bg-white/80 p-3 text-[11px] text-[#5c7594]">
            <p className="inline-flex items-center gap-1 font-semibold text-[#2f6ea8]"><Target size={13} /> Global + personal context</p>
            <p className="mt-1">
              Everyone sees the global leaderboard. Your own row is highlighted with movement and overtake cues.
            </p>
          </div>
        </div>
      </div>
    </PipelineAuthShell>
  );
};

export default LeadershipLeaderboard;
