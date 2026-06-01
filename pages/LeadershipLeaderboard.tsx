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
  RefreshCw,
  Star,
  Target,
  TrendingUp,
  Trophy,
  UserCheck,
  Users,
} from 'lucide-react';
import PipelineAuthShell from '../components/PipelineAuthShell';
import { LeaderboardPodium } from '../components/leaderboard/LeaderboardPodium';
import {
  LeaderboardRefreshProgress,
  type LeaderboardProgressState,
} from '../components/leaderboard/LeaderboardRefreshProgress';
import { LeaderboardWeekCountdown } from '../components/leaderboard/LeaderboardWeekCountdown';
import { LeaderboardCoinChip } from '../components/dashboard/LeaderboardCoinChip';
import { currentFridayWeekEndDate, endOfYmdLocal } from '../services/leaderboardCountdown';
import {
  coinBalanceForLeaderboardRow,
  loadLeaderboardCoinLookup,
  type LeaderboardCoinLookup,
} from '../services/recruiterCoinService';
import { Button } from '../components/UI';
import { getCurrentUserProfile, listAllUserProfiles, type AppRole } from '../services/accessControl';
import { loadScopedWebinarRowsForViewer } from '../services/pipelineBookedOutcomes';
import {
  buildLiveSessionRowsByEmail,
  loadCandidateEmailsById,
  loadLiveSessionRegistrantsForMatching,
} from '../services/liveSessionBookedOutcomes';
import { loadLeaderboardSnapshot, saveLeaderboardSnapshot } from '../services/pipelineLeaderboardCache';
import {
  buildCompositeLeaderboard,
  buildLeaderboardWindows,
  defaultLeaderboardCustomRange,
  excludedLeaderboardUserIds,
  filterLeaderboardRows,
  isValidYmd,
  leaderboardSnapshotKey,
  resolveLeaderboardBadgeWinners,
  rowMatchesBadgeFilter,
  seedsFromProfiles,
  type LeaderboardBadgeId,
  type LeaderboardCustomRange,
  type LeaderboardPeriod,
  type RecruiterLeaderboardRow,
} from '../services/pipelineLeaderboard';
import { listPipelineCallRecords } from '../services/pipelineService';
import { supabase } from '../services/supabaseClient';

const PERIODS: Array<{ id: LeaderboardPeriod; label: string }> = [
  { id: 'last7', label: 'This week (Fri–Thu)' },
  { id: 'last30', label: '30 Days' },
  { id: 'thisMonth', label: 'Monthly' },
  { id: 'custom', label: 'Custom range' },
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
    description: 'Moved up two or more places vs the previous week.',
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

function pct(value: number): number {
  return Math.round(value * 100);
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
  pazCoins = 0,
}: {
  row: RecruiterLeaderboardRow;
  tone?: 'default' | 'gold' | 'highlight';
  champion?: boolean;
  pazCoins?: number;
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
          <StatChip
            icon={CalendarCheck}
            label="Webinar booked"
            value={row.webinarBooked}
            tone={tone === 'gold' ? 'gold' : 'default'}
          />
          <StatChip icon={UserCheck} label="Webinar shows" value={row.webinarShowed} tone={tone === 'gold' ? 'gold' : 'default'} />
          <StatChip icon={CalendarCheck} label="Live booked" value={row.liveSessionBooked} tone="muted" />
          <StatChip icon={UserCheck} label="Live shows" value={row.liveSessionShowed} tone="muted" />
          <span title="Paz Coins balance">
            <LeaderboardCoinChip balance={pazCoins} compact />
          </span>
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
  const [refreshProgress, setRefreshProgress] = React.useState<LeaderboardProgressState | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [period, setPeriod] = React.useState<LeaderboardPeriod>('last7');
  const [customRange, setCustomRange] = React.useState<LeaderboardCustomRange>(() => defaultLeaderboardCustomRange());
  const [rows, setRows] = React.useState<RecruiterLeaderboardRow[]>([]);
  const [previousRows, setPreviousRows] = React.useState<RecruiterLeaderboardRow[]>([]);
  const [viewerRole, setViewerRole] = React.useState<AppRole | null>(null);
  const [viewerUserId, setViewerUserId] = React.useState<string | null>(null);
  const [selectedKey, setSelectedKey] = React.useState<string>('all');
  const [windowLabel, setWindowLabel] = React.useState('Last 7 days');
  const [lastUpdated, setLastUpdated] = React.useState<string | null>(null);
  const [cacheReady, setCacheReady] = React.useState(false);
  const [badgeFilters, setBadgeFilters] = React.useState<Set<LeaderboardBadgeId>>(new Set());
  const [coinLookup, setCoinLookup] = React.useState<LeaderboardCoinLookup>({
    byUserId: new Map(),
    displayNameToUserId: new Map(),
    byDisplayLabel: new Map(),
  });

  const leadershipView = viewerRole === 'admin' || viewerRole === 'leadership';

  const activeCustomRange = period === 'custom' ? customRange : null;
  const snapshotKey = React.useMemo(
    () => leaderboardSnapshotKey(period, activeCustomRange),
    [period, activeCustomRange?.sinceYmd, activeCustomRange?.untilYmd],
  );
  const customRangeInvalid =
    period === 'custom' &&
    (!isValidYmd(customRange.sinceYmd) ||
      !isValidYmd(customRange.untilYmd) ||
      customRange.sinceYmd > customRange.untilYmd);

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

  const loadFromDatabase = React.useCallback(async (key: string, range: LeaderboardCustomRange | null, targetPeriod: LeaderboardPeriod) => {
    if (targetPeriod === 'custom' && range && (!isValidYmd(range.sinceYmd) || !isValidYmd(range.untilYmd) || range.sinceYmd > range.untilYmd)) {
      setCacheReady(true);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data: authData } = await supabase.auth.getUser();
      setViewerUserId(authData.user?.id || null);
      const profile = await getCurrentUserProfile();
      setViewerRole(profile?.role ?? null);

      const [snapshotResult, profiles] = await Promise.all([
        loadLeaderboardSnapshot(key),
        listAllUserProfiles().catch(() => []),
      ]);
      const { data, error: cacheError, tableMissing } = snapshotResult;
      const excludedUserIds = excludedLeaderboardUserIds(profiles);
      if (cacheError) throw new Error(cacheError);
      if (tableMissing) {
        setError('Leaderboard storage is not set up yet. Ask an admin to run the database script.');
        setRows([]);
        setPreviousRows([]);
        setLastUpdated(null);
        return;
      }
      if (data) {
        applySnapshot({
          ...data,
          rows: filterLeaderboardRows(data.rows, excludedUserIds),
          previousRows: filterLeaderboardRows(data.previousRows, excludedUserIds),
        });
      } else {
        setRows([]);
        setPreviousRows([]);
        const windows = buildLeaderboardWindows(targetPeriod, new Date(), range);
        setWindowLabel(windows.current.label);
        setLastUpdated(null);
      }

      void loadLeaderboardCoinLookup(profiles)
        .then(setCoinLookup)
        .catch(() => undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setCacheReady(true);
    }
  }, [applySnapshot]);

  const refreshLeaderboard = React.useCallback(async () => {
    if (customRangeInvalid) {
      setError('Choose a valid start and end date (start must be on or before end).');
      return;
    }
    setRefreshing(true);
    setRefreshProgress({ pct: 2, label: 'Starting refresh…' });
    setError(null);
    try {
      setRefreshProgress({ pct: 8, label: 'Checking session…' });
      const [{ data: authData }, profile] = await Promise.all([
        supabase.auth.getUser(),
        getCurrentUserProfile(),
      ]);
      setViewerUserId(authData.user?.id || null);
      setViewerRole(profile?.role ?? null);

      const windows = buildLeaderboardWindows(period, new Date(), activeCustomRange);
      const recruiterFilter = null;

      setRefreshProgress({ pct: 18, label: 'Loading call records…' });
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

      const candidateIds = [
        ...new Set(
          [...currentRecords, ...previousRecords].map((r) => r.candidate_id).filter(Boolean),
        ),
      ];

      setRefreshProgress({ pct: 38, label: 'Loading webinar & live session data…' });
      const [scopedWebinarRows, profiles, liveRegistrants, candidateEmailById] = await Promise.all([
        loadScopedWebinarRowsForViewer({
          role: 'admin',
          viewerEmail: null,
          viewerFullName: null,
        }),
        listAllUserProfiles().catch(() => []),
        loadLiveSessionRegistrantsForMatching().catch(() => []),
        loadCandidateEmailsById(candidateIds).catch(() => new Map<string, string>()),
      ]);
      const liveSessionByEmail = buildLiveSessionRowsByEmail(liveRegistrants);

      const recruiterDirectory = new Map<string, { fullName: string | null; email: string | null }>(
        profiles.map((item) => [item.user_id, { fullName: item.full_name, email: item.email ?? null }]),
      );
      const recruiterSeeds = seedsFromProfiles(profiles);
      const excludedUserIds = excludedLeaderboardUserIds(profiles);

      setRefreshProgress({ pct: 58, label: 'Calculating rankings…' });
      const computed = buildCompositeLeaderboard({
        webinarRows: scopedWebinarRows as Array<Record<string, unknown>>,
        currentWindow: windows.current,
        previousWindow: windows.previous,
        currentRecords,
        previousRecords,
        recruiterDirectory,
        recruiterSeeds,
        candidateEmailById,
        liveSessionByEmail,
        excludedUserIds,
      });
      const previousComputed = buildCompositeLeaderboard({
        webinarRows: scopedWebinarRows as Array<Record<string, unknown>>,
        currentWindow: windows.previous,
        previousWindow: {
          ...windows.previous,
          toIso: windows.previous.fromIso,
        },
        currentRecords: previousRecords,
        previousRecords: [],
        recruiterDirectory,
        recruiterSeeds,
        candidateEmailById,
        liveSessionByEmail,
        excludedUserIds,
      });

      const payload = {
        rows: computed,
        previousRows: previousComputed,
        windowLabel: windows.current.label,
      };

      setRefreshProgress({ pct: 78, label: 'Saving rankings…' });
      const saved = await saveLeaderboardSnapshot({ periodKey: snapshotKey, payload });
      if (saved.error) throw new Error(saved.error);
      if (saved.tableMissing) {
        throw new Error('Leaderboard storage is not set up yet. Ask an admin to run the database script.');
      }

      setRefreshProgress({ pct: 92, label: 'Updating display…' });
      applySnapshot({
        ...payload,
        fetchedAt: new Date().toISOString(),
      });

      setRefreshProgress({ pct: 96, label: 'Loading Paz Coins…' });
      const lookup = await loadLeaderboardCoinLookup(profiles).catch(() => ({
        byUserId: new Map<string, number>(),
        displayNameToUserId: new Map<string, string>(),
        byDisplayLabel: new Map<string, number>(),
      }));
      setCoinLookup(lookup);
      setRefreshProgress({ pct: 100, label: 'Complete' });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
      window.setTimeout(() => setRefreshProgress(null), 500);
    }
  }, [period, activeCustomRange, snapshotKey, customRangeInvalid, applySnapshot]);

  React.useEffect(() => {
    setCacheReady(false);
    void loadFromDatabase(snapshotKey, activeCustomRange, period);
  }, [snapshotKey, period, loadFromDatabase]);

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

  const previousTopPerformer = previousRows[0] || null;
  const busy = loading || refreshing;

  const periodWindowLabels = React.useMemo(() => {
    const w = buildLeaderboardWindows(period, new Date(), activeCustomRange);
    return { current: w.current.label, previous: w.previous.label };
  }, [period, activeCustomRange?.sinceYmd, activeCustomRange?.untilYmd]);

  const periodEndAt = React.useMemo(() => {
    if (period === 'last7') return currentFridayWeekEndDate();
    const w = buildLeaderboardWindows(period, new Date(), activeCustomRange);
    return endOfYmdLocal(w.current.untilYmd);
  }, [period, activeCustomRange?.sinceYmd, activeCustomRange?.untilYmd]);

  const countdownCopy = React.useMemo(() => {
    if (period === 'last7') {
      return {
        label: 'This week ends Thursday night',
        sublabel: 'Fri–Thu competition week · climb the board before time runs out',
      };
    }
    if (period === 'thisMonth') {
      return {
        label: 'This month ends in',
        sublabel: 'Rankings use the selected monthly window',
      };
    }
    if (period === 'custom') {
      return {
        label: 'Selected range ends in',
        sublabel: 'Custom date range countdown',
      };
    }
    return {
      label: 'Current period ends in',
      sublabel: '30-day rolling window',
    };
  }, [period]);

  const podiumSlots = React.useMemo(() => {
    const sorted = [...shownRows].sort((a, b) => a.rank - b.rank);
    return {
      first: sorted.find((r) => r.rank === 1) ?? null,
      second: sorted.find((r) => r.rank === 2) ?? null,
      third: sorted.find((r) => r.rank === 3) ?? null,
      rest: sorted.filter((r) => r.rank > 3),
    };
  }, [shownRows]);

  const previousLeaderTitle =
    period === 'last7' ? 'Previous week' : period === 'thisMonth' ? 'Last month' : period === 'custom' ? 'Prior range' : 'Previous window';

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
              <div className="flex w-full max-w-sm flex-col items-end gap-2 sm:w-auto">
                <Button
                  variant="outline"
                  className="!min-h-0 h-9 border-[#c3d8f2] !bg-white !text-[#0B1B34] hover:!bg-[#eef6ff]"
                  onClick={() => void refreshLeaderboard()}
                  disabled={busy || customRangeInvalid}
                >
                  <RefreshCw size={14} className={refreshing ? 'mr-1 animate-spin' : 'mr-1'} />
                  Refresh
                </Button>
                {refreshing && refreshProgress ? (
                  <LeaderboardRefreshProgress progress={refreshProgress} variant="compact" />
                ) : null}
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
              {period === 'custom' && (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#d2e1f5] bg-white px-2.5 py-1.5">
                  <label className="flex items-center gap-1.5 text-[11px] font-medium text-[#4f6886]">
                    From
                    <input
                      type="date"
                      value={customRange.sinceYmd}
                      onChange={(e) => setCustomRange((prev) => ({ ...prev, sinceYmd: e.target.value }))}
                      className="rounded-lg border border-[#d2e1f5] px-2 py-1 text-xs text-[#0B1B34]"
                    />
                  </label>
                  <label className="flex items-center gap-1.5 text-[11px] font-medium text-[#4f6886]">
                    To
                    <input
                      type="date"
                      value={customRange.untilYmd}
                      onChange={(e) => setCustomRange((prev) => ({ ...prev, untilYmd: e.target.value }))}
                      className="rounded-lg border border-[#d2e1f5] px-2 py-1 text-xs text-[#0B1B34]"
                    />
                  </label>
                  {customRangeInvalid && (
                    <span className="text-[11px] font-medium text-rose-600">Pick valid dates (start ≤ end).</span>
                  )}
                </div>
              )}
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

          {!loading && !error && shownRows.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
              <LeaderboardWeekCountdown
                endAt={periodEndAt}
                label={countdownCopy.label}
                sublabel={countdownCopy.sublabel}
              />
              <LeaderboardPodium
                first={podiumSlots.first}
                second={podiumSlots.second}
                third={podiumSlots.third}
              />
            </motion.div>
          )}

          {previousTopPerformer && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl border border-[#d9e5f6] bg-white/80 px-4 py-3 backdrop-blur-xl"
            >
              <p className="text-[10px] uppercase tracking-[0.2em] text-[#2f6ea8]">{previousLeaderTitle}</p>
              <p className="mt-0.5 text-[11px] text-[#5c7594]">{periodWindowLabels.previous}</p>
              <p className="mt-1 text-sm font-semibold text-[#0B1B34]">
                {previousTopPerformer.displayName}
                <span className="ml-2 font-medium text-[#5c7594]">· Score {previousTopPerformer.score.toFixed(1)}</span>
              </p>
            </motion.div>
          )}

          {refreshing && refreshProgress ? (
            <LeaderboardRefreshProgress progress={refreshProgress} />
          ) : null}

          <section className="rounded-3xl border border-[#d8e3ef] bg-[#f3f7fb] p-4 md:p-5">
            <div className="mb-3 flex items-center gap-2 border-b border-[#dde5f0] pb-3">
              <Users size={16} className="text-[#2f6ea8]" aria-hidden />
              <div>
                <h3 className="text-sm font-semibold text-[#0B1B34]">
                  {podiumSlots.rest.length > 0 ? 'Rest of the board' : 'Full rankings'}
                </h3>
                <p className="text-[11px] text-[#5c7594]">
                  {podiumSlots.rest.length > 0
                    ? 'Ranks 4 and below · top three are on the podium above'
                    : 'Team standings for the selected period'}
                </p>
              </div>
            </div>
            {loading && rows.length === 0 ? (
              <div className="rounded-2xl border border-[#dfeaf8] bg-[#f9fcff] px-4 py-6 text-center text-sm text-[#4f6886]">
                <p>Loading saved rankings…</p>
                <p className="mt-2 text-xs text-[#8aa3be]">Reading from the database — no full recalculation.</p>
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
            ) : podiumSlots.rest.length === 0 && shownRows.length > 0 ? (
              <div className="rounded-2xl border border-[#dfeaf8] bg-[#f9fcff] px-4 py-5 text-center text-sm text-[#4f6886]">
                Top three are on the podium above. No additional ranks in this view.
              </div>
            ) : (
              <div className="space-y-2">
                <AnimatePresence>
                  {(podiumSlots.rest.length > 0 ? podiumSlots.rest : shownRows).map((row, index) => {
                    const isViewer = viewerRow?.recruiterKey === row.recruiterKey;
                    return (
                      <motion.article
                        key={row.recruiterKey}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.2, delay: index * 0.025 }}
                        className={`rounded-2xl border p-3 transition ${
                          isViewer
                            ? 'border-[#7eb3ea] bg-white shadow-[0_12px_28px_-18px_rgba(0,94,184,0.4)] ring-2 ring-[#9bc8f6]/60'
                            : 'border-[#c5d9ee] bg-white shadow-sm hover:border-[#9bc8f6]/50 hover:shadow-md'
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#f1f6fd] text-xs font-bold text-[#4f6886]">
                            {row.rank}
                          </span>
                          <div className="min-w-0 flex-1">
                            <PersonPerformanceBlock
                              row={row}
                              pazCoins={coinBalanceForLeaderboardRow(row, coinLookup)}
                            />
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
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          <div className="rounded-xl border border-[#dfeaf8] bg-[#f9fcff] px-2.5 py-2">
                            <p className="text-[10px] uppercase tracking-wide text-[#6d86a3]">Webinar booked / shows</p>
                            <p className="text-lg font-semibold tabular-nums text-[#0B1B34]">
                              {row.webinarBooked} / {row.webinarShowed}
                            </p>
                          </div>
                          <div className="rounded-xl border border-[#dfeaf8] bg-[#f9fcff] px-2.5 py-2">
                            <p className="text-[10px] uppercase tracking-wide text-[#6d86a3]">Live booked / shows</p>
                            <p className="text-lg font-semibold tabular-nums text-[#0B1B34]">
                              {row.liveSessionBooked} / {row.liveSessionShowed}
                              <span className="ml-1.5 text-xs font-medium text-[#5c7594]">({pct(row.showRatio)}% combined)</span>
                            </p>
                          </div>
                        </div>
                      </motion.article>
                    );
                  })}
                </AnimatePresence>
              </div>
            )}
          </section>

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
              Rankings are scored from webinar bookings, attendance, and show rate only. Data updates when you press Refresh.
            </p>
          </div>
        </div>
      </div>
    </PipelineAuthShell>
  );
};

export default LeadershipLeaderboard;
