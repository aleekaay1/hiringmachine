import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarCheck,
  Crown,
  Flame,
  Medal,
  Minus,
  Phone,
  RefreshCw,
  Star,
  Target,
  TrendingUp,
  Trophy,
  UserCheck,
  Users,
} from 'lucide-react';
import PipelineAuthShell from '../components/PipelineAuthShell';
import { Button } from '../components/UI';
import { getCurrentUserProfile, listAllUserProfiles, type AppRole } from '../services/accessControl';
import { loadScopedWebinarRowsForViewer } from '../services/pipelineBookedOutcomes';
import { loadLeaderboardSnapshot, saveLeaderboardSnapshot } from '../services/pipelineLeaderboardCache';
import {
  buildCompositeLeaderboard,
  buildLeaderboardWindows,
  resolveLeaderboardBadgeWinners,
  rowMatchesBadgeFilter,
  seedsFromProfiles,
  type LeaderboardBadgeId,
  type LeaderboardPeriod,
  type RecruiterLeaderboardRow,
} from '../services/pipelineLeaderboard';
import { listPipelineCallRecords } from '../services/pipelineService';
import { supabase } from '../services/supabaseClient';

const PERIODS: Array<{ id: LeaderboardPeriod; label: string }> = [
  { id: 'last7', label: 'This week (Fri–Thu)' },
  { id: 'last30', label: '30 Days' },
  { id: 'thisMonth', label: 'Monthly' },
];

const BADGE_FILTERS: Array<{
  id: LeaderboardBadgeId;
  label: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  accent: string;
}> = [
  {
    id: 'topPerformer',
    label: 'Top Performer',
    description: 'Best overall score in the selected period.',
    icon: Trophy,
    accent: 'border-[#f0ce8f] bg-[#fff8ea] text-[#7e5400]',
  },
  {
    id: 'fastClimber',
    label: 'Fast Climber',
    description: 'Moved up two or more places vs the prior period.',
    icon: Flame,
    accent: 'border-[#f5c4c4] bg-[#fff5f5] text-[#a84a4a]',
  },
  {
    id: 'consistentCloser',
    label: 'Consistent Closer',
    description: 'Strong attendance with steady booking volume.',
    icon: Medal,
    accent: 'border-[#b8e6cf] bg-[#f0faf4] text-[#2c8a62]',
  },
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

function formatRefreshedAt(iso: string | null): string {
  if (!iso) return 'Not refreshed yet';
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function MovementBadge({ delta }: { delta: number }) {
  if (delta > 0) {
    return (
      <span
        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-bold text-emerald-800 shadow-sm"
        title="Positions gained since last period"
      >
        <ArrowUpRight size={14} strokeWidth={2.5} aria-hidden />
        <span>+{delta}</span>
      </span>
    );
  }
  if (delta < 0) {
    return (
      <span
        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-bold text-rose-800 shadow-sm"
        title="Positions lost since last period"
      >
        <ArrowDownRight size={14} strokeWidth={2.5} aria-hidden />
        <span>{delta}</span>
      </span>
    );
  }
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-bold text-slate-700 shadow-sm"
      title="No change in rank"
    >
      <Minus size={14} strokeWidth={2.5} aria-hidden />
      <span>0</span>
    </span>
  );
}

function StatChip({
  icon: Icon,
  label,
  value,
  tone = 'default',
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string | number;
  tone?: 'default' | 'gold' | 'muted';
}) {
  const toneClass =
    tone === 'gold'
      ? 'border-[#f0ce8f] bg-white/90 text-[#5c4a1f]'
      : tone === 'muted'
        ? 'border-[#d9e5f6] bg-white text-[#4f6886]'
        : 'border-[#d4e3f6] bg-[#f8fbff] text-[#35567a]';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-medium ${toneClass}`}
      title={label}
    >
      <Icon size={13} className="shrink-0 opacity-80" aria-hidden />
      <span className="sr-only">{label}</span>
      <span className="font-semibold tabular-nums text-[#0B1B34]">{value}</span>
    </span>
  );
}

function PersonPerformanceBlock({
  row,
  tone = 'default',
  champion = false,
}: {
  row: RecruiterLeaderboardRow;
  tone?: 'default' | 'gold' | 'highlight';
  champion?: boolean;
}) {
  const nameClass =
    tone === 'gold'
      ? 'text-[#0B1B34]'
      : tone === 'highlight'
        ? 'text-[#0B1B34]'
        : 'text-[#0B1B34]';
  const subClass = tone === 'gold' ? 'text-[#6d5a39]' : 'text-[#5c7594]';

  return (
    <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p
          className={`truncate text-xl font-semibold tracking-tight ${nameClass}`}
          style={{ fontFamily: 'Outfit, Inter, system-ui, sans-serif' }}
        >
          {row.displayName}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <StatChip icon={TrendingUp} label="Show rate" value={`${pct(row.showRatio)}%`} tone={tone === 'gold' ? 'gold' : 'default'} />
          <StatChip icon={CalendarCheck} label="Booked" value={row.webinarBooked} tone={tone === 'gold' ? 'gold' : 'default'} />
          <StatChip icon={UserCheck} label="Attended" value={row.webinarShowed} tone={tone === 'gold' ? 'gold' : 'default'} />
          <StatChip icon={Phone} label="Calls" value={row.calls} tone="muted" />
        </div>
        <p className={`mt-2 inline-flex items-center gap-1 text-sm font-semibold ${subClass}`}>
          <Star size={14} className={tone === 'gold' ? 'text-[#9b6b00]' : 'text-[#2f6ea8]'} aria-hidden />
          Score {row.score.toFixed(1)}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        {champion && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#f0ce8f] bg-[#ffecc5] px-3 py-1 text-xs font-semibold text-[#7e5400]">
            <Crown size={14} aria-hidden />
            Top performer
          </span>
        )}
        <MovementBadge delta={row.rankDelta} />
      </div>
    </div>
  );
}

function overtakeMessage(row: RecruiterLeaderboardRow): string | null {
  if (row.passedLabel) return `You moved ahead of ${row.passedLabel}`;
  if (row.overtakenByLabel) return `${row.overtakenByLabel} moved ahead of you`;
  return null;
}

const LeadershipLeaderboard: React.FC = () => {
  const [loading, setLoading] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [period, setPeriod] = React.useState<LeaderboardPeriod>('last7');
  const [rows, setRows] = React.useState<RecruiterLeaderboardRow[]>([]);
  const [previousRows, setPreviousRows] = React.useState<RecruiterLeaderboardRow[]>([]);
  const [viewerRole, setViewerRole] = React.useState<AppRole | null>(null);
  const [viewerUserId, setViewerUserId] = React.useState<string | null>(null);
  const [selectedKey, setSelectedKey] = React.useState<string>('all');
  const [windowLabel, setWindowLabel] = React.useState('Last 7 days');
  const [lastUpdated, setLastUpdated] = React.useState<string | null>(null);
  const [cacheReady, setCacheReady] = React.useState(false);
  const [badgeFilters, setBadgeFilters] = React.useState<Set<LeaderboardBadgeId>>(new Set());

  const leadershipView = viewerRole === 'admin' || viewerRole === 'leadership';

  const toggleBadgeFilter = (id: LeaderboardBadgeId) => {
    setBadgeFilters((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const applySnapshot = React.useCallback(
    (snapshot: { rows: RecruiterLeaderboardRow[]; previousRows: RecruiterLeaderboardRow[]; windowLabel: string; fetchedAt: string }) => {
      setRows(snapshot.rows);
      setPreviousRows(snapshot.previousRows);
      setWindowLabel(snapshot.windowLabel);
      setLastUpdated(snapshot.fetchedAt);
    },
    [],
  );

  const loadFromDatabase = React.useCallback(async (targetPeriod: LeaderboardPeriod) => {
    setLoading(true);
    setError(null);
    try {
      const { data: authData } = await supabase.auth.getUser();
      setViewerUserId(authData.user?.id || null);
      const profile = await getCurrentUserProfile();
      setViewerRole(profile?.role ?? null);

      const { data, error: cacheError, tableMissing } = await loadLeaderboardSnapshot(targetPeriod);
      if (cacheError) throw new Error(cacheError);
      if (tableMissing) {
        setError('Leaderboard storage is not set up yet. Ask an admin to run the database script.');
        setRows([]);
        setPreviousRows([]);
        setLastUpdated(null);
        return;
      }
      if (data) {
        applySnapshot(data);
      } else {
        setRows([]);
        setPreviousRows([]);
        const windows = buildLeaderboardWindows(targetPeriod);
        setWindowLabel(windows.current.label);
        setLastUpdated(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setCacheReady(true);
    }
  }, [applySnapshot]);

  const refreshLeaderboard = React.useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const [{ data: authData }, profile] = await Promise.all([
        supabase.auth.getUser(),
        getCurrentUserProfile(),
      ]);
      setViewerUserId(authData.user?.id || null);
      setViewerRole(profile?.role ?? null);

      const windows = buildLeaderboardWindows(period);
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

      const [scopedWebinarRows, profiles] = await Promise.all([
        loadScopedWebinarRowsForViewer({
          role: 'admin',
          viewerEmail: null,
          viewerFullName: null,
        }),
        listAllUserProfiles().catch(() => []),
      ]);

      const recruiterDirectory = new Map<string, { fullName: string | null; email: string | null }>(
        profiles.map((item) => [item.user_id, { fullName: item.full_name, email: item.email ?? null }]),
      );
      const recruiterSeeds = seedsFromProfiles(profiles);

      const computed = buildCompositeLeaderboard({
        webinarRows: scopedWebinarRows as Array<Record<string, unknown>>,
        currentWindow: windows.current,
        previousWindow: windows.previous,
        currentRecords,
        previousRecords,
        recruiterDirectory,
        recruiterSeeds,
      });
      const previousComputed = buildCompositeLeaderboard({
        webinarRows: scopedWebinarRows as Array<Record<string, unknown>>,
        currentWindow: windows.previous,
        previousWindow: {
          fromIso: windows.previous.fromIso,
          toIso: windows.previous.fromIso,
          label: windows.previous.label,
        },
        currentRecords: previousRecords,
        previousRecords: [],
        recruiterDirectory,
        recruiterSeeds,
      });

      const payload = {
        rows: computed,
        previousRows: previousComputed,
        windowLabel: windows.current.label,
      };

      const saved = await saveLeaderboardSnapshot({ period, payload });
      if (saved.error) throw new Error(saved.error);
      if (saved.tableMissing) {
        throw new Error('Leaderboard storage is not set up yet. Ask an admin to run the database script.');
      }

      applySnapshot({
        ...payload,
        fetchedAt: new Date().toISOString(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }, [period, applySnapshot]);

  React.useEffect(() => {
    setCacheReady(false);
    void loadFromDatabase(period);
  }, [period, loadFromDatabase]);

  React.useEffect(() => {
    if (selectedKey === 'all') return;
    if (rows.some((row) => row.recruiterKey === selectedKey)) return;
    setSelectedKey('all');
  }, [rows, selectedKey]);

  const viewerRow = React.useMemo(
    () => rows.find((row) => row.recruiterUserId && row.recruiterUserId === viewerUserId) || null,
    [rows, viewerUserId],
  );
  const shownRows = React.useMemo(() => {
    let list = rows;
    if (selectedKey !== 'all') {
      list = list.filter((row) => row.recruiterKey === selectedKey);
    }
    if (badgeFilters.size > 0) {
      list = list.filter((row) => rowMatchesBadgeFilter(row, badgeFilters));
    }
    return list;
  }, [rows, selectedKey, badgeFilters]);

  const badgeWinners = React.useMemo(() => resolveLeaderboardBadgeWinners(rows), [rows]);

  const winnerForBadge = (id: LeaderboardBadgeId) => {
    if (id === 'topPerformer') return badgeWinners.topPerformer;
    if (id === 'fastClimber') return badgeWinners.fastClimber;
    return badgeWinners.consistentCloser;
  };

  const topPerformer = rows[0] || null;
  const previousTopPerformer = previousRows[0] || null;
  const busy = loading || refreshing;

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
                <p className="text-[11px] uppercase tracking-[0.26em] text-[#4e79a9]">Team performance</p>
                <h1 className="text-2xl font-semibold tracking-tight text-[#0B1B34]" style={{ fontFamily: 'Outfit, Inter, system-ui, sans-serif' }}>
                  Leadership Leaderboard
                </h1>
                <p className="mt-1 max-w-3xl text-xs text-[#4f6886]">
                  Rankings reflect webinar bookings, attendance, and outreach activity for the selected period. Use Refresh when you want the latest numbers.
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Button
                  variant="outline"
                  className="!min-h-0 h-9 border-[#c3d8f2] !bg-white !text-[#0B1B34] hover:!bg-[#eef6ff]"
                  onClick={() => void refreshLeaderboard()}
                  disabled={busy}
                >
                  <RefreshCw size={14} className={busy ? 'mr-1 animate-spin' : 'mr-1'} />
                  Refresh
                </Button>
                <p className="text-[10px] text-[#6a839f]">Last updated: {formatRefreshedAt(lastUpdated)}</p>
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
                  <option value="all">All team members</option>
                  {rows.map((row) => (
                    <option key={row.recruiterKey} value={row.recruiterKey}>
                      {row.displayName}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <p className="mt-2 text-[11px] text-[#5c7594]">{windowLabel}</p>
          </motion.div>

          <div className="grid gap-3 lg:grid-cols-2">
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl border border-[#f2d9aa] bg-gradient-to-br from-[#fff8ea] via-[#fffaf2] to-[#f2f7ff] p-4 backdrop-blur-xl">
              <p className="text-[10px] uppercase tracking-[0.2em] text-[#9b6b00]">Current period leader</p>
              {topPerformer ? (
                <div className="mt-2">
                  <PersonPerformanceBlock row={topPerformer} tone="gold" champion />
                </div>
              ) : (
                <p className="mt-2 text-sm text-[#6d5a39]">
                  {cacheReady && !loading ? 'No results for this period yet. Click Refresh to load rankings.' : 'Loading…'}
                </p>
              )}
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl border border-[#d9e5f6] bg-white/80 p-4 backdrop-blur-xl">
              <p className="text-[10px] uppercase tracking-[0.2em] text-[#2f6ea8]">Previous period leader</p>
              {previousTopPerformer ? (
                <div className="mt-2">
                  <PersonPerformanceBlock row={previousTopPerformer} />
                </div>
              ) : (
                <p className="mt-2 text-sm text-[#4f6886]">No prior-period leader on record.</p>
              )}
            </motion.div>
          </div>

          <div className="rounded-3xl border border-[#d9e5f6] bg-white/80 p-4 backdrop-blur-xl">
            <div className="mb-3 flex items-center gap-2">
              <Users size={16} className="text-[#2f6ea8]" aria-hidden />
              <h3 className="text-sm font-semibold text-[#0B1B34]">Full rankings</h3>
            </div>
            {loading ? (
              <div className="rounded-2xl border border-[#dfeaf8] bg-[#f9fcff] px-4 py-6 text-center text-sm text-[#4f6886]">
                Loading saved rankings…
              </div>
            ) : error ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
                {error}
              </div>
            ) : shownRows.length === 0 ? (
              <div className="rounded-2xl border border-[#dfeaf8] bg-[#f9fcff] px-4 py-6 text-center text-sm text-[#4f6886]">
                {rows.length > 0 && badgeFilters.size > 0 ? (
                  <>
                    No one matches the selected recognition filters.{' '}
                    <button type="button" onClick={() => setBadgeFilters(new Set())} className="font-semibold text-[#2f6ea8] hover:underline">
                      Clear filters
                    </button>
                  </>
                ) : (
                  <>
                    No rankings saved for this period. Click <strong>Refresh</strong> to calculate and store the latest board.
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <AnimatePresence>
                  {shownRows.map((row, index) => {
                    const isViewer = viewerRow?.recruiterKey === row.recruiterKey;
                    const callProgress = clamp((row.calls / GOALS.calls) * 100);
                    const bookedProgress = clamp((row.webinarBooked / GOALS.booked) * 100);
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
                        <div className="flex items-start gap-2">
                          <span
                            className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                              row.rank === 1
                                ? 'bg-[#ffe9b8] text-[#7e5400]'
                                : row.rank === 2
                                  ? 'bg-[#edf2f8] text-[#3f556e]'
                                  : row.rank === 3
                                    ? 'bg-[#ffe6d1] text-[#8a4f16]'
                                    : 'bg-[#f1f6fd] text-[#4f6886]'
                            }`}
                          >
                            {row.rank}
                          </span>
                          <div className="min-w-0 flex-1">
                            <PersonPerformanceBlock row={row} />
                            {isViewer && overtakeMessage(row) && (
                              <p className="mt-1 text-[11px] font-medium text-[#35567a]">{overtakeMessage(row)}</p>
                            )}
                            <div className="mt-1 flex flex-wrap gap-1">
                              {row.badges.map((badge) => (
                                <span
                                  key={badge}
                                  className="rounded-full border border-[#d4e3f6] bg-[#f4f9ff] px-2 py-0.5 text-[10px] font-semibold text-[#35567a]"
                                >
                                  {badge}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                        <div className="mt-3 grid gap-2 md:grid-cols-3">
                          <div className="rounded-xl border border-[#dfeaf8] bg-[#f9fcff] px-2.5 py-2">
                            <p className="text-[10px] uppercase tracking-wide text-[#6d86a3]">Calls</p>
                            <p className="text-[11px] text-[#35567a]">
                              {row.calls}/{GOALS.calls}
                            </p>
                            <div className="mt-1 h-1.5 rounded-full bg-[#dfeaf8]">
                              <div className="h-full rounded-full bg-[#67b5ff]" style={{ width: `${callProgress}%` }} />
                            </div>
                          </div>
                          <div className="rounded-xl border border-[#dfeaf8] bg-[#f9fcff] px-2.5 py-2">
                            <p className="text-[10px] uppercase tracking-wide text-[#6d86a3]">Booked</p>
                            <p className="text-[11px] text-[#35567a]">
                              {row.webinarBooked}/{GOALS.booked}
                            </p>
                            <div className="mt-1 h-1.5 rounded-full bg-[#dfeaf8]">
                              <div className="h-full rounded-full bg-[#ad8cff]" style={{ width: `${bookedProgress}%` }} />
                            </div>
                          </div>
                          <div className="rounded-xl border border-[#dfeaf8] bg-[#f9fcff] px-2.5 py-2">
                            <p className="text-[10px] uppercase tracking-wide text-[#6d86a3]">Show rate</p>
                            <p className="text-[11px] text-[#35567a]">
                              {pct(row.showRatio)}% / {pct(GOALS.showRate)}%
                            </p>
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

          <div className="rounded-3xl border border-[#d9e5f6] bg-white/80 p-4 backdrop-blur-xl">
            <p className="text-[10px] uppercase tracking-[0.2em] text-[#4e79a9]">Recognition this period</p>
            <p className="mt-1 text-xs text-[#5c7594]">
              One standout per category. Check a box to filter the board to that group.
            </p>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              {BADGE_FILTERS.map((badge) => {
                const Icon = badge.icon;
                const winner = winnerForBadge(badge.id);
                const checked = badgeFilters.has(badge.id);
                return (
                  <label
                    key={badge.id}
                    className={`cursor-pointer rounded-2xl border p-3 transition ${
                      checked ? `${badge.accent} ring-2 ring-[#8bc3ff]/50` : 'border-[#d9e5f6] bg-white hover:bg-[#f7fbff]'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleBadgeFilter(badge.id)}
                        className="mt-1 h-4 w-4 rounded border-[#c3d8f2] text-[#2f6ea8] focus:ring-[#8bc3ff]"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="inline-flex items-center gap-1 text-xs font-semibold">
                          <Icon size={14} aria-hidden />
                          {badge.label}
                        </p>
                        <p className="mt-1 text-[11px] opacity-90">{badge.description}</p>
                        <p className="mt-2 text-sm font-semibold text-[#0B1B34]">
                          {winner ? winner.displayName : '—'}
                        </p>
                        {winner && badge.id === 'fastClimber' && winner.rankDelta > 0 && (
                          <p className="text-[11px] text-[#5c7594]">Up {winner.rankDelta} places</p>
                        )}
                        {winner && badge.id === 'consistentCloser' && (
                          <p className="text-[11px] text-[#5c7594]">
                            {pct(winner.showRatio)}% show rate · {winner.webinarBooked} booked
                          </p>
                        )}
                        {winner && badge.id === 'topPerformer' && (
                          <p className="text-[11px] text-[#5c7594]">Score {winner.score.toFixed(1)}</p>
                        )}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
            {badgeFilters.size > 0 && (
              <button
                type="button"
                onClick={() => setBadgeFilters(new Set())}
                className="mt-3 text-xs font-semibold text-[#2f6ea8] hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>

          <div className="rounded-2xl border border-[#d9e5f6] bg-white/80 p-3 text-[11px] text-[#5c7594]">
            <p className="inline-flex items-center gap-1 font-semibold text-[#2f6ea8]">
              <Target size={13} aria-hidden /> How to read this board
            </p>
            <p className="mt-1">
              Everyone sees the same rankings. Rank change badges on the right show movement since the previous period. Data updates only when you press Refresh.
            </p>
          </div>
        </div>
      </div>
    </PipelineAuthShell>
  );
};

export default LeadershipLeaderboard;
