import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart3,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  Coins,
  RefreshCw,
  Search,
  UserCheck,
  UserX,
  Video,
  X,
} from 'lucide-react';
import { Button } from '../components/UI';
import StaffAvatar from '../components/StaffAvatar';
import { useStaffAuthenticated } from '../hooks/useStaffAuthenticated';
import { useStaffAvatarLookup } from '../hooks/useStaffAvatarLookup';
import { getCurrentUserProfile, listAllUserProfiles, type AppRole } from '../services/accessControl';
import { formatDateTimeCanadaEastern } from '../services/dateDisplay';
import {
  loadCandidateEmailsById,
  loadCandidateNamesById,
  loadCandidatePhonesById,
  loadLiveSessionRegistrantsForMatching,
  LIVE_SESSION_BOOKED_OUTCOME_RULE_LABEL,
} from '../services/liveSessionBookedOutcomes';
import {
  buildLiveSessionBookingRows,
  buildRecruiterProfilesFromBookingRows,
  buildSessionSummariesFromBookingRows,
  isoWindowFromYmd,
  matchesSearch,
  recruiterDirectoryFromProfiles,
  rowInScope,
  scopeBounds,
  shiftMonthFirstYmd,
  torontoMonthStartToday,
  torontoYmdFromDate,
  type LiveSessionBookingRow,
  type LiveSessionDateGrouping,
  type LiveSessionOutcomeStatus,
  type LiveSessionScopeMode,
  ymdToShortLabel,
} from '../services/liveSessionRecruiterAnalytics';
import { refreshLiveSessionsAndMatchOutcomes } from '../services/liveSessionOutcomeService';
import { listPipelineCallRecords } from '../services/pipelineService';
import { COINS_PER_LIVE_SESSION_SHOW, coinEarnWindow } from '../services/recruiterCoins';
import { signInWithGoogle } from '../services/googleAuth';
import { shiftYmdDays } from '../services/webinarGeekDates';
import type { StaffAvatarLookup } from '../services/staffAvatarLookup';

const OUTCOME_LABEL: Record<LiveSessionOutcomeStatus, string> = {
  attended: 'Showed',
  no_show: 'No show',
  scheduled: 'Scheduled',
  pending: 'Pending',
};

const OUTCOME_TONE: Record<LiveSessionOutcomeStatus, string> = {
  attended: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  no_show: 'bg-red-50 text-red-800 border-red-200',
  scheduled: 'bg-sky-50 text-sky-800 border-sky-200',
  pending: 'bg-slate-50 text-slate-700 border-slate-200',
};

const LiveSessionsAnalyticsPage: React.FC = () => {
  const isAuthenticated = useStaffAuthenticated();
  const avatarLookup = useStaffAvatarLookup();
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [allRows, setAllRows] = useState<LiveSessionBookingRow[]>([]);
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);

  const [viewerRole, setViewerRole] = useState<AppRole | null>(null);
  const [viewerUserId, setViewerUserId] = useState<string | null>(null);
  const [viewerReady, setViewerReady] = useState(false);

  const [scopeMode, setScopeMode] = useState<LiveSessionScopeMode>('month');
  const [monthAnchorYmd, setMonthAnchorYmd] = useState(torontoMonthStartToday);
  const [weekAnchorYmd, setWeekAnchorYmd] = useState(() => torontoYmdFromDate());
  const [dateGrouping, setDateGrouping] = useState<LiveSessionDateGrouping>('booked');
  const [selectedRecruiterKey, setSelectedRecruiterKey] = useState<string | null>(null);
  const [outcomeFilter, setOutcomeFilter] = useState<LiveSessionOutcomeStatus | 'all'>('all');
  const [sessionDateFilter, setSessionDateFilter] = useState<string | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'bookings' | 'sessions' | 'recruiters'>('bookings');

  const earnWindow = useMemo(() => coinEarnWindow(), []);

  useEffect(() => {
    let cancelled = false;
    void getCurrentUserProfile().then((profile) => {
      if (cancelled) return;
      setViewerRole(profile?.role ?? null);
      setViewerUserId(profile?.user_id ?? null);
      setViewerReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  const loadData = useCallback(async (options?: { syncFirst?: boolean }) => {
    if (!isAuthenticated) return;
    setError(null);
    if (options?.syncFirst) {
      setSyncing(true);
      const syncResult = await refreshLiveSessionsAndMatchOutcomes({ syncCoins: true }).catch((err) => ({
        ok: false as const,
        error: err instanceof Error ? err.message : 'Sync failed',
      }));
      setSyncing(false);
      if (!syncResult.ok && syncResult.error) {
        setSyncNotice(`Sync warning: ${syncResult.error}. Showing cached data.`);
      } else if (syncResult.ok && syncResult.message) {
        setSyncNotice(syncResult.message);
      } else {
        setSyncNotice(null);
      }
    }

    setLoading(true);
    try {
      const { fromIso, toIso } = isoWindowFromYmd(earnWindow.sinceYmd, earnWindow.untilYmd);
      const [records, registrants, profiles] = await Promise.all([
        listPipelineCallRecords({ fromIso, toIso, limit: 12000 }),
        loadLiveSessionRegistrantsForMatching(),
        listAllUserProfiles().catch(() => []),
      ]);

      const candidateIds = [...new Set(records.map((r) => r.candidate_id).filter(Boolean))];
      const [candidateEmailById, candidatePhoneById, candidateNameById] = await Promise.all([
        loadCandidateEmailsById(candidateIds),
        loadCandidatePhonesById(candidateIds),
        loadCandidateNamesById(candidateIds),
      ]);

      const rows = buildLiveSessionBookingRows({
        records,
        candidateEmailById,
        candidatePhoneById,
        candidateNameById,
        registrants,
        recruiterDirectory: recruiterDirectoryFromProfiles(profiles),
      });

      setAllRows(rows);
      setLastLoadedAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load live session analytics');
    } finally {
      setLoading(false);
    }
  }, [earnWindow.sinceYmd, earnWindow.untilYmd, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || !viewerReady) return;
    void loadData({ syncFirst: false });
  }, [isAuthenticated, viewerReady, loadData]);

  const scopedRows = useMemo(() => {
    if (viewerRole === 'recruiter' && viewerUserId) {
      return allRows.filter((r) => r.recruiterUserId === viewerUserId);
    }
    return allRows;
  }, [allRows, viewerRole, viewerUserId]);

  const scope = useMemo(
    () =>
      scopeBounds({
        mode: scopeMode,
        monthAnchorYmd,
        weekAnchorYmd,
        allSinceYmd: earnWindow.sinceYmd,
        allUntilYmd: earnWindow.untilYmd,
      }),
    [scopeMode, monthAnchorYmd, weekAnchorYmd, earnWindow.sinceYmd, earnWindow.untilYmd],
  );

  const periodRows = useMemo(
    () => scopedRows.filter((row) => rowInScope(row, scope.sinceYmd, scope.untilYmd, dateGrouping)),
    [scopedRows, scope.sinceYmd, scope.untilYmd, dateGrouping],
  );

  const recruiterProfiles = useMemo(
    () => buildRecruiterProfilesFromBookingRows(periodRows),
    [periodRows],
  );

  const sessionSummaries = useMemo(
    () => buildSessionSummariesFromBookingRows(periodRows),
    [periodRows],
  );

  const recruiterChips = useMemo(() => {
    return recruiterProfiles.map((p) => ({
      key: p.userId || p.displayName,
      userId: p.userId,
      label: p.displayName,
      booked: p.booked,
      showed: p.showed,
    }));
  }, [recruiterProfiles]);

  const filteredRows = useMemo(() => {
    let rows = periodRows;
    if (selectedRecruiterKey) {
      rows = rows.filter((r) => (r.recruiterUserId || r.recruiterName) === selectedRecruiterKey);
    }
    if (outcomeFilter !== 'all') {
      rows = rows.filter((r) => r.outcome === outcomeFilter);
    }
    if (sessionDateFilter !== 'all') {
      rows = rows.filter((r) => (r.sessionDate || 'unknown') === sessionDateFilter);
    }
    if (searchQuery.trim()) {
      rows = rows.filter((r) => matchesSearch(r, searchQuery));
    }
    return rows;
  }, [periodRows, selectedRecruiterKey, outcomeFilter, sessionDateFilter, searchQuery]);

  const totals = useMemo(() => {
    const booked = periodRows.length;
    const showed = periodRows.filter((r) => r.outcome === 'attended').length;
    const noShow = periodRows.filter((r) => r.outcome === 'no_show').length;
    const scheduled = periodRows.filter((r) => r.outcome === 'scheduled').length;
    const pending = periodRows.filter((r) => r.outcome === 'pending').length;
    const showRate = booked > 0 ? Math.round((100 * showed) / booked) : 0;
    const coins = showed * COINS_PER_LIVE_SESSION_SHOW;
    return { booked, showed, noShow, scheduled, pending, showRate, coins };
  }, [periodRows]);

  const sessionDateOptions = useMemo(() => {
    const dates = new Set(periodRows.map((r) => r.sessionDate || 'unknown'));
    return [...dates]
      .sort((a, b) => b.localeCompare(a))
      .map((d) => ({
        value: d,
        label: d === 'unknown' ? 'Unmatched' : ymdToShortLabel(d),
      }));
  }, [periodRows]);

  const handleGoogleSignIn = async () => {
    setError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed');
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="max-w-md mx-auto mt-16 p-6 rounded-2xl border border-[#d6deea] bg-white shadow-sm text-center space-y-4">
        <BarChart3 className="mx-auto text-[#005EB8]" size={32} />
        <h1 className="text-lg font-bold text-[#0B1B34]">Live session performance</h1>
        <p className="text-sm text-[#5c7594]">Sign in with your staff Google account to view caller stats.</p>
        <Button onClick={() => void handleGoogleSignIn()}>Sign in with Google</Button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="w-full max-w-[1280px] mx-auto p-5 lg:p-6 space-y-5 text-[#1A2942]">
      <header className="rounded-2xl border border-[#d6deea] bg-white shadow-sm px-5 py-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-xl bg-[#005EB8]/10 flex items-center justify-center shrink-0">
            <BarChart3 size={20} className="text-[#005EB8]" />
          </div>
          <div>
            <h1 className="text-lg font-extrabold text-[#0B1B34]">Live session performance</h1>
            <p className="text-xs text-[#5c7594]">
              Caller bookings vs Calendly/Zoom shows · counts toward leaderboard &amp; Paz Coins (+{COINS_PER_LIVE_SESSION_SHOW}/show)
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/live-sessions"
            className="text-xs font-semibold text-[#2f6ea8] hover:underline inline-flex items-center gap-1"
          >
            <Video size={14} /> Operations dashboard
          </Link>
          <Link
            to="/calls-analytics/leaderboard"
            className="text-xs font-semibold text-[#2f6ea8] hover:underline"
          >
            Leaderboard
          </Link>
          <Button
            variant="secondary"
            size="sm"
            disabled={loading || syncing}
            onClick={() => void loadData({ syncFirst: true })}
          >
            <RefreshCw size={14} className={syncing || loading ? 'animate-spin' : ''} />
            {syncing ? 'Syncing…' : 'Refresh'}
          </Button>
        </div>
      </header>

      {syncNotice && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">{syncNotice}</div>
      )}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800">{error}</div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard icon={CalendarCheck} label="Booked" value={totals.booked} />
        <KpiCard icon={UserCheck} label="Showed" value={totals.showed} highlight />
        <KpiCard icon={UserX} label="No show" value={totals.noShow} />
        <KpiCard label="Scheduled" value={totals.scheduled} />
        <KpiCard label="Show rate" value={`${totals.showRate}%`} />
        <KpiCard icon={Coins} label="Paz Coins" value={totals.coins} highlight />
      </div>

      <div className="rounded-2xl border border-[#d6deea] bg-white shadow-sm p-4 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <ScopeButton active={scopeMode === 'month'} onClick={() => setScopeMode('month')}>
            Month
          </ScopeButton>
          <ScopeButton active={scopeMode === 'week'} onClick={() => setScopeMode('week')}>
            Fri–Thu week
          </ScopeButton>
          <ScopeButton active={scopeMode === 'all'} onClick={() => setScopeMode('all')}>
            90 days
          </ScopeButton>

          {scopeMode === 'month' && (
            <div className="inline-flex items-center gap-1 ml-2">
              <button
                type="button"
                className="p-1 rounded hover:bg-slate-100"
                onClick={() => setMonthAnchorYmd(shiftMonthFirstYmd(monthAnchorYmd, -1))}
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-sm font-semibold min-w-[120px] text-center">{scope.title}</span>
              <button
                type="button"
                className="p-1 rounded hover:bg-slate-100"
                onClick={() => setMonthAnchorYmd(shiftMonthFirstYmd(monthAnchorYmd, 1))}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}

          {scopeMode === 'week' && (
            <div className="inline-flex items-center gap-1 ml-2">
              <button
                type="button"
                className="p-1 rounded hover:bg-slate-100"
                onClick={() => setWeekAnchorYmd((d) => shiftYmdDays(d, -7))}
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-sm font-semibold">{scope.title}</span>
              <button
                type="button"
                className="p-1 rounded hover:bg-slate-100"
                onClick={() => setWeekAnchorYmd((d) => shiftYmdDays(d, 7))}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}

          {scopeMode === 'all' && (
            <span className="text-sm font-semibold text-[#5c7594] ml-2">{scope.title}</span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs font-semibold text-[#5c7594]">
            Date by
            <select
              className="ml-2 rounded-lg border border-[#d6deea] px-2 py-1 text-sm"
              value={dateGrouping}
              onChange={(e) => setDateGrouping(e.target.value as LiveSessionDateGrouping)}
            >
              <option value="booked">Booking date (call disposition)</option>
              <option value="session">Session date (Calendly)</option>
            </select>
          </label>

          <label className="text-xs font-semibold text-[#5c7594]">
            Session
            <select
              className="ml-2 rounded-lg border border-[#d6deea] px-2 py-1 text-sm max-w-[160px]"
              value={sessionDateFilter}
              onChange={(e) => setSessionDateFilter(e.target.value)}
            >
              <option value="all">All sessions</option>
              {sessionDateOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-semibold text-[#5c7594]">
            Outcome
            <select
              className="ml-2 rounded-lg border border-[#d6deea] px-2 py-1 text-sm"
              value={outcomeFilter}
              onChange={(e) => setOutcomeFilter(e.target.value as LiveSessionOutcomeStatus | 'all')}
            >
              <option value="all">All outcomes</option>
              <option value="attended">Showed</option>
              <option value="no_show">No show</option>
              <option value="scheduled">Scheduled</option>
              <option value="pending">Pending</option>
            </select>
          </label>

          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8aa0bc]" />
            <input
              type="search"
              placeholder="Search recruiter, candidate, email, phone…"
              className="w-full rounded-lg border border-[#d6deea] pl-8 pr-8 py-1.5 text-sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8aa0bc] hover:text-[#0B1B34]"
                onClick={() => setSearchQuery('')}
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {viewerRole !== 'recruiter' && recruiterChips.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <RecruiterChip
              active={!selectedRecruiterKey}
              label="All callers"
              sub={`${periodRows.length} booked`}
              onClick={() => setSelectedRecruiterKey(null)}
            />
            {recruiterChips.map((chip) => (
              <RecruiterChip
                key={chip.key}
                active={selectedRecruiterKey === chip.key}
                label={chip.label}
                sub={`${chip.showed}/${chip.booked} showed`}
                userId={chip.userId}
                avatarLookup={avatarLookup}
                onClick={() =>
                  setSelectedRecruiterKey((prev) => (prev === chip.key ? null : chip.key))
                }
              />
            ))}
          </div>
        )}

        <div className="flex gap-2 border-b border-[#e8eef5]">
          {(['bookings', 'sessions', 'recruiters'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px ${
                activeTab === tab
                  ? 'border-[#005EB8] text-[#005EB8]'
                  : 'border-transparent text-[#5c7594] hover:text-[#0B1B34]'
              }`}
              onClick={() => setActiveTab(tab)}
            >
              {tab === 'bookings' ? `Bookings (${filteredRows.length})` : tab === 'sessions' ? 'By session' : 'By caller'}
            </button>
          ))}
        </div>

        {loading && allRows.length === 0 ? (
          <p className="text-sm text-[#5c7594] py-8 text-center">Loading live session data…</p>
        ) : activeTab === 'bookings' ? (
          <BookingsTable rows={filteredRows} avatarLookup={avatarLookup} />
        ) : activeTab === 'sessions' ? (
          <SessionsTable rows={sessionSummaries} onSelectSession={(d) => {
            setSessionDateFilter(d);
            setActiveTab('bookings');
          }} />
        ) : (
          <RecruitersTable
            profiles={recruiterProfiles}
            avatarLookup={avatarLookup}
            onSelect={(key) => {
              setSelectedRecruiterKey(key);
              setActiveTab('bookings');
            }}
          />
        )}

        {lastLoadedAt && (
          <p className="text-[10px] text-[#8aa0bc]">
            Data window {earnWindow.sinceYmd} → {earnWindow.untilYmd}
            {lastLoadedAt ? ` · loaded ${formatDateTimeCanadaEastern(lastLoadedAt)}` : ''}
          </p>
        )}
      </div>

      <div className="rounded-xl border border-[#d9e5f6] bg-white/80 p-3 text-[11px] text-[#5c7594]">
        <p className="font-semibold text-[#2f6ea8]">Matching rules</p>
        <p className="mt-1">{LIVE_SESSION_BOOKED_OUTCOME_RULE_LABEL}</p>
      </div>
    </div>
  );
};

function KpiCard({
  label,
  value,
  highlight = false,
  icon: Icon,
}: {
  label: string;
  value: number | string;
  highlight?: boolean;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
}) {
  return (
    <div
      className={`rounded-2xl border p-3 shadow-sm ${
        highlight ? 'bg-[#005EB8]/5 border-[#005EB8]/25' : 'bg-white border-[#d6e6f9]'
      }`}
    >
      <p className="text-[10px] uppercase tracking-wide text-[#7a8ba1] flex items-center gap-1">
        {Icon && <Icon size={12} />}
        {label}
      </p>
      <p className={`text-xl font-extrabold mt-0.5 ${highlight ? 'text-[#005EB8]' : 'text-[#0B1B34]'}`}>
        {value}
      </p>
    </div>
  );
}

function ScopeButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-xs font-semibold border ${
        active
          ? 'bg-[#005EB8] text-white border-[#005EB8]'
          : 'bg-white text-[#5c7594] border-[#d6deea] hover:border-[#005EB8]/40'
      }`}
    >
      {children}
    </button>
  );
}

function RecruiterChip({
  active,
  label,
  sub,
  userId,
  avatarLookup,
  onClick,
}: {
  active: boolean;
  label: string;
  sub: string;
  userId?: string | null;
  avatarLookup?: StaffAvatarLookup;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-left transition ${
        active ? 'border-[#005EB8] bg-[#005EB8]/8' : 'border-[#d6deea] bg-white hover:border-[#005EB8]/30'
      }`}
    >
      <StaffAvatar name={label} userId={userId} lookup={avatarLookup} size="xs" active={active} />
      <span>
        <span className="block text-xs font-semibold text-[#0B1B34]">{label}</span>
        <span className="block text-[10px] text-[#5c7594]">{sub}</span>
      </span>
    </button>
  );
}

function OutcomeBadge({ outcome }: { outcome: LiveSessionOutcomeStatus }) {
  return (
    <span className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] font-semibold ${OUTCOME_TONE[outcome]}`}>
      {OUTCOME_LABEL[outcome]}
    </span>
  );
}

function BookingsTable({
  rows,
  avatarLookup,
}: {
  rows: LiveSessionBookingRow[];
  avatarLookup?: StaffAvatarLookup;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-[#5c7594] py-6 text-center">No bookings match your filters.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-[#e8eef5]">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wide border-b border-[#e8eef5] bg-[#f8fafc] text-[#5c7594]">
            <th className="px-3 py-2">Caller</th>
            <th className="px-3 py-2">Candidate</th>
            <th className="px-3 py-2">Booked</th>
            <th className="px-3 py-2">Session</th>
            <th className="px-3 py-2">Outcome</th>
            <th className="px-3 py-2">Match</th>
            <th className="px-3 py-2">Coins</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.callRecordId} className="border-b border-[#f0f4f8] last:border-0 hover:bg-[#fafcff]">
              <td className="px-3 py-2 font-medium text-[#0B1B34] whitespace-nowrap">
                <span className="inline-flex items-center gap-2">
                  <StaffAvatar
                    name={row.recruiterName}
                    userId={row.recruiterUserId}
                    lookup={avatarLookup}
                    size="xs"
                  />
                  {row.recruiterName}
                </span>
              </td>
              <td className="px-3 py-2">
                <div className="font-medium text-[#0B1B34]">{row.candidateName}</div>
                <div className="text-[10px] text-[#5c7594]">{row.candidateEmail || row.candidatePhone || '—'}</div>
              </td>
              <td className="px-3 py-2 whitespace-nowrap text-[#5c7594]">
                {formatDateTimeCanadaEastern(row.bookedAt)}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">{row.sessionDateLabel}</td>
              <td className="px-3 py-2">
                <OutcomeBadge outcome={row.outcome} />
              </td>
              <td className="px-3 py-2 text-[#5c7594]">{row.matchMethod || '—'}</td>
              <td className="px-3 py-2 font-semibold text-[#005EB8]">
                {row.coinsEarned > 0 ? `+${row.coinsEarned}` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SessionsTable({
  rows,
  onSelectSession,
}: {
  rows: ReturnType<typeof buildSessionSummariesFromBookingRows>;
  onSelectSession: (sessionDate: string) => void;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-[#5c7594] py-6 text-center">No sessions in this period.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-[#e8eef5]">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wide border-b border-[#e8eef5] bg-[#f8fafc] text-[#5c7594]">
            <th className="px-3 py-2">Session date</th>
            <th className="px-3 py-2">Booked</th>
            <th className="px-3 py-2">Showed</th>
            <th className="px-3 py-2">No show</th>
            <th className="px-3 py-2">Scheduled</th>
            <th className="px-3 py-2">Show rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.sessionDate}
              className="border-b border-[#f0f4f8] last:border-0 hover:bg-[#fafcff] cursor-pointer"
              onClick={() => onSelectSession(row.sessionDate)}
            >
              <td className="px-3 py-2 font-medium text-[#0B1B34]">{row.sessionDateLabel}</td>
              <td className="px-3 py-2">{row.booked}</td>
              <td className="px-3 py-2 text-emerald-700 font-semibold">{row.showed}</td>
              <td className="px-3 py-2 text-red-700">{row.noShow}</td>
              <td className="px-3 py-2">{row.scheduled}</td>
              <td className="px-3 py-2 font-semibold">{row.showRatePct}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecruitersTable({
  profiles,
  avatarLookup,
  onSelect,
}: {
  profiles: ReturnType<typeof buildRecruiterProfilesFromBookingRows>;
  avatarLookup?: StaffAvatarLookup;
  onSelect: (key: string) => void;
}) {
  if (profiles.length === 0) {
    return <p className="text-sm text-[#5c7594] py-6 text-center">No caller data in this period.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-[#e8eef5]">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wide border-b border-[#e8eef5] bg-[#f8fafc] text-[#5c7594]">
            <th className="px-3 py-2">Caller</th>
            <th className="px-3 py-2">Booked</th>
            <th className="px-3 py-2">Showed</th>
            <th className="px-3 py-2">No show</th>
            <th className="px-3 py-2">Scheduled</th>
            <th className="px-3 py-2">Show rate</th>
            <th className="px-3 py-2">Paz Coins</th>
          </tr>
        </thead>
        <tbody>
          {profiles.map((p) => (
            <tr
              key={p.userId || p.displayName}
              className="border-b border-[#f0f4f8] last:border-0 hover:bg-[#fafcff] cursor-pointer"
              onClick={() => onSelect(p.userId || p.displayName)}
            >
              <td className="px-3 py-2 font-medium text-[#0B1B34]">
                <span className="inline-flex items-center gap-2">
                  <StaffAvatar
                    name={p.displayName}
                    userId={p.userId}
                    lookup={avatarLookup}
                    size="xs"
                  />
                  {p.displayName}
                </span>
              </td>
              <td className="px-3 py-2">{p.booked}</td>
              <td className="px-3 py-2 text-emerald-700 font-semibold">{p.showed}</td>
              <td className="px-3 py-2 text-red-700">{p.noShow}</td>
              <td className="px-3 py-2">{p.scheduled}</td>
              <td className="px-3 py-2 font-semibold">{p.showRatePct}%</td>
              <td className="px-3 py-2 font-semibold text-[#005EB8]">{p.coinsEarned}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default LiveSessionsAnalyticsPage;
