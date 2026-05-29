import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import { Button } from '../components/UI';
import { supabase } from '../services/supabaseClient';
import { getCurrentUserProfile, type AppRole } from '../services/accessControl';
import { filterRowsForRecruiterOwnership } from '../services/recruiterDataScope';
import { fetchWebinarGeekDashboard } from '../services/webinarGeekIntegrations';
import {
  loadWebinarGeekDashboardCache,
  saveWebinarGeekDashboardCache,
  subscriptionsFromDashboardData,
} from '../services/webinarGeekDashboardCache';
import { formatDateTimeCanadaEastern } from '../services/dateDisplay';
import {
  fetchWindowBoundsWide,
  fridayWeekBoundsFromYmd,
  monthBoundsFromFirstYmd,
  pct,
  shiftMonthFirstYmd,
  shiftYmdDays,
  torontoMonthStartToday,
  torontoYmdFromDate,
  ymdToShortLabel,
} from '../services/webinarGeekDates';
import {
  buildRecruiterBookingProfiles,
  buildRecruiterLeaderboard,
  buildRecruiterWeeklyTargetLeaderboard,
  dayBookingCountsByHrDate,
  fmtHrScheduledDateKey,
  profileInitials,
  RECRUITER_WEEKLY_WEBINAR_TARGET,
  rowMatchesNameKey,
  type RecruiterLeaderboardEntry,
  type RecruiterWeeklyTargetEntry,
} from '../services/webinarGeekRecruiterAnalytics';
import { signInWithGoogle } from '../services/googleAuth';
import {
  candidateDisplayNameFromRow,
  hrScheduledMsFromRow,
  recruiterNameFromRow,
  recruiterTeamFromRow,
  webinarSessionMsFromRow,
} from '../services/webinarGeekInviters';
import { BarChart3, ChevronLeft, ChevronRight, Download, RefreshCw, Target, Trophy, Users } from 'lucide-react';

type LeaderboardTab = 'performance' | 'weeklyTarget';

type AnyRow = Record<string, unknown>;
type ScopeMode = 'month' | 'week' | 'day';

const glassCard =
  'rounded-2xl border border-white/40 bg-white/55 backdrop-blur-xl shadow-[0_8px_32px_rgba(15,40,80,0.08)]';

function watchSecondsFromRow(row: AnyRow): number {
  const sec = Number(row.watch_duration || 0);
  return Number.isFinite(sec) && sec > 0 ? sec : 0;
}

function csvScalar(value: string | number): string {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '0';
  const t = value.replace(/\u2014/g, '-').trim();
  if (!t || t === '-') return '0';
  return t;
}

function toCsvCell(value: unknown): string {
  return `"${csvScalar(String(value ?? '')).replace(/"/g, '""')}"`;
}

const CallsAnalytics: React.FC = () => {
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [email, setEmail] = useState('admin@globelife-paz.com');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subscriptionCache, setSubscriptionCache] = useState<AnyRow[] | null>(null);
  const [lastFetchAt, setLastFetchAt] = useState<string | null>(null);
  const [lastFetchRange, setLastFetchRange] = useState<string | null>(null);
  const [dataFromDatabase, setDataFromDatabase] = useState(false);
  const [cacheNotice, setCacheNotice] = useState<string | null>(null);

  const [monthAnchorYmd, setMonthAnchorYmd] = useState(torontoMonthStartToday);
  const [selectedDayYmd, setSelectedDayYmd] = useState<string | null>(null);
  const [scopeMode, setScopeMode] = useState<ScopeMode>('month');
  const [weekAnchorYmd, setWeekAnchorYmd] = useState(() => torontoYmdFromDate());
  const [selectedRecruiterKey, setSelectedRecruiterKey] = useState<string | null>(null);
  const [leaderboardTab, setLeaderboardTab] = useState<LeaderboardTab>('performance');
  const [viewerRole, setViewerRole] = useState<AppRole | null>(null);
  const [viewerEmail, setViewerEmail] = useState<string | null>(null);
  const [viewerFullName, setViewerFullName] = useState<string | null>(null);
  const [viewerContextReady, setViewerContextReady] = useState(false);

  const scopedSubscriptionCache = useMemo(() => {
    if (subscriptionCache === null) return null;
    if (!viewerContextReady) return [];
    if (viewerRole !== 'recruiter') return subscriptionCache;
    return filterRowsForRecruiterOwnership(subscriptionCache, viewerEmail, viewerFullName);
  }, [subscriptionCache, viewerContextReady, viewerRole, viewerEmail, viewerFullName]);

  const monthWindow = useMemo(() => monthBoundsFromFirstYmd(monthAnchorYmd), [monthAnchorYmd]);
  const weekWindow = useMemo(() => fridayWeekBoundsFromYmd(weekAnchorYmd), [weekAnchorYmd]);

  const rowsInViewMonth = useMemo(() => {
    if (!scopedSubscriptionCache) return [];
    const [vy, vm] = monthAnchorYmd.split('-').map(Number);
    const start = `${vy}-${String(vm).padStart(2, '0')}-01`;
    const lastD = new Date(vy, vm, 0).getDate();
    const end = `${vy}-${String(vm).padStart(2, '0')}-${String(lastD).padStart(2, '0')}`;
    return scopedSubscriptionCache.filter((row) => {
      const k = fmtHrScheduledDateKey(row);
      if (k === 'unknown') return false;
      return k >= start && k <= end;
    });
  }, [scopedSubscriptionCache, monthAnchorYmd]);

  const rowsInViewWeek = useMemo(() => {
    if (!scopedSubscriptionCache) return [];
    return scopedSubscriptionCache.filter((row) => {
      const k = fmtHrScheduledDateKey(row);
      if (k === 'unknown') return false;
      return k >= weekWindow.since && k <= weekWindow.until;
    });
  }, [scopedSubscriptionCache, weekWindow.since, weekWindow.until]);

  const rowsForScope = useMemo(() => {
    if (scopeMode === 'week') return rowsInViewWeek;
    if (scopeMode === 'day') {
      if (!selectedDayYmd) return [];
      return rowsInViewMonth.filter((r) => fmtHrScheduledDateKey(r) === selectedDayYmd);
    }
    return rowsInViewMonth;
  }, [scopeMode, rowsInViewWeek, rowsInViewMonth, selectedDayYmd]);

  const recruiterProfiles = useMemo(
    () => buildRecruiterBookingProfiles(rowsForScope, watchSecondsFromRow),
    [rowsForScope],
  );

  const leaderboard = useMemo(
    () => buildRecruiterLeaderboard(recruiterProfiles),
    [recruiterProfiles],
  );

  const weeklyRecruiterProfiles = useMemo(
    () => buildRecruiterBookingProfiles(rowsInViewWeek, watchSecondsFromRow),
    [rowsInViewWeek],
  );

  const weeklyTargetLeaderboard = useMemo(
    () => buildRecruiterWeeklyTargetLeaderboard(weeklyRecruiterProfiles),
    [weeklyRecruiterProfiles],
  );

  const filteredRows = useMemo(() => {
    if (!selectedRecruiterKey) return rowsForScope;
    return rowsForScope.filter((row) => rowMatchesNameKey(row, selectedRecruiterKey));
  }, [rowsForScope, selectedRecruiterKey]);

  const scopeTitle = useMemo(() => {
    if (scopeMode === 'week') return `Week · ${weekWindow.title}`;
    if (scopeMode === 'day' && selectedDayYmd) return `Day · ${ymdToShortLabel(selectedDayYmd)}`;
    return `Month · ${monthWindow.title}`;
  }, [scopeMode, weekWindow.title, selectedDayYmd, monthWindow.title]);

  const [viewYear, viewMonth0] = useMemo(() => {
    const [y, m] = monthAnchorYmd.split('-').map(Number);
    return [y, m - 1] as const;
  }, [monthAnchorYmd]);

  const calendarCells = useMemo(() => {
    const firstDow = new Date(viewYear, viewMonth0, 1).getDay();
    const lastDay = new Date(viewYear, viewMonth0 + 1, 0).getDate();
    const cells: (number | null)[] = [];
    for (let i = 0; i < firstDow; i++) cells.push(null);
    for (let d = 1; d <= lastDay; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [viewYear, viewMonth0]);

  const dayCounts = useMemo(() => dayBookingCountsByHrDate(rowsInViewMonth), [rowsInViewMonth]);

  const summary = useMemo(() => {
    const bookings = rowsForScope.length;
    const recruiters = recruiterProfiles.length;
    const showed = rowsForScope.filter((r) => r.watched === true).length;
    const full = recruiterProfiles.reduce((s, p) => s + p.full, 0);
    return { bookings, recruiters, showed, full };
  }, [rowsForScope, recruiterProfiles]);

  const getFreshAccessToken = useCallback(async (): Promise<string | null> => {
    const { data: s } = await supabase.auth.getSession();
    const session = s.session;
    if (!session) return null;
    const expiresAtMs = (session.expires_at || 0) * 1000;
    if (expiresAtMs > Date.now() + 60_000 && session.access_token) return session.access_token;
    const { data: refreshed } = await supabase.auth.refreshSession();
    return refreshed.session?.access_token ?? null;
  }, []);

  const fetchDashboardData = useCallback(async () => {
    setError(null);
    setLoading(true);
    const { since, until, label } = fetchWindowBoundsWide();
    const token = await getFreshAccessToken();
    if (!token) {
      setLoading(false);
      setError('Session unauthorized. Sign in again.');
      return;
    }
    const result = await fetchWebinarGeekDashboard(token, {
      perPage: 250,
      since,
      until,
      includeCatalog: false,
      maxPages: 36,
    });
    setLoading(false);
    if (!result.ok) {
      setError('error' in result ? result.error : 'Fetch failed');
      return;
    }
    const rows = subscriptionsFromDashboardData(result.data);
    setSubscriptionCache(rows);
    setLastFetchAt(new Date().toISOString());
    setLastFetchRange(label);
    setDataFromDatabase(false);

    const saved = await saveWebinarGeekDashboardCache({
      subscriptions: rows,
      fetchSince: since,
      fetchUntil: until,
      fetchLabel: label,
    });
    if (saved.tableMissing) {
      setCacheNotice('Snapshot table missing. Run supabase/sql/paste_webinar_geek_dashboard_cache.sql in Supabase.');
    } else if (!saved.ok && saved.error) {
      setCacheNotice(`Saved locally but database save failed: ${saved.error}`);
    } else {
      setCacheNotice(null);
    }
  }, [getFreshAccessToken]);

  const handleCsvExport = useCallback(() => {
    const headers = [
      'subscription_id',
      'recruiter',
      'team',
      'candidate_name',
      'email',
      'scheduled_on',
      'scheduled_for',
      'watched',
      'watch_minutes',
    ];
    const lines = filteredRows.map((row) => {
      const hrMs = hrScheduledMsFromRow(row);
      const sessionMs = webinarSessionMsFromRow(row);
      const hr =
        hrMs != null ? new Date(hrMs).toISOString().slice(0, 16).replace('T', ' ') : '0';
      const session =
        sessionMs != null ? new Date(sessionMs).toISOString().slice(0, 16).replace('T', ' ') : '0';
      return [
        String(row.id ?? '0'),
        csvScalar(recruiterNameFromRow(row)),
        csvScalar(recruiterTeamFromRow(row)),
        csvScalar(candidateDisplayNameFromRow(row) || '0'),
        csvScalar(String(row.email ?? '')),
        hr,
        session,
        row.watched === true ? 'Yes' : 'No',
        String(Math.round(watchSecondsFromRow(row) / 60)),
      ];
    });
    const line = (cells: string[]) => cells.map(toCsvCell).join(',');
    const csv = `\uFEFF${line(headers)}\r\n${lines.map((r) => line(r)).join('\r\n')}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `recruiter-analytics-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filteredRows]);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data: s }) => {
      if (s.session) setIsAuthenticated(true);
      setAuthChecked(true);
    });
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    void (async () => {
      const [{ data: authData }, profile] = await Promise.all([
        supabase.auth.getUser(),
        getCurrentUserProfile(),
      ]);
      if (cancelled) return;
      setViewerRole(profile?.role ?? null);
      setViewerEmail(authData.user?.email ?? profile?.email ?? null);
      setViewerFullName(profile?.full_name ?? null);
      setViewerContextReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    void (async () => {
      const { data, error, tableMissing } = await loadWebinarGeekDashboardCache();
      if (tableMissing) {
        setCacheNotice('Run supabase/sql/paste_webinar_geek_dashboard_cache.sql to save snapshots in Supabase.');
        return;
      }
      if (error) {
        setCacheNotice(error);
        return;
      }
      if (!data) return;
      setSubscriptionCache(data.subscriptions);
      setLastFetchAt(data.fetchedAt);
      setLastFetchRange(data.fetchLabel);
      setDataFromDatabase(true);
    })();
  }, [isAuthenticated]);

  useEffect(() => {
    setSelectedDayYmd(null);
  }, [monthAnchorYmd]);

  useEffect(() => {
    if (leaderboardTab === 'weeklyTarget' && scopeMode !== 'week') {
      setScopeMode('week');
    }
  }, [leaderboardTab, scopeMode]);

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#e8f2fc] via-[#f0f6ff] to-[#e6eef8] flex items-center justify-center">
        <p className="text-sm text-slate-500">Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <CallsAnalyticsLogin
        email={email}
        password={password}
        authError={authError}
        googleLoading={googleLoading}
        onEmail={setEmail}
        onPassword={setPassword}
        onGoogle={async () => {
          setAuthError(null);
          setGoogleLoading(true);
          const { error } = await signInWithGoogle('/calls-analytics');
          if (error) setAuthError(error);
          setGoogleLoading(false);
        }}
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
      />
    );
  }

  return (
    <Layout isAdmin>
      <div className="min-h-screen bg-gradient-to-br from-[#e8f2fc] via-[#f0f6ff] to-[#e6eef8]">
        <CallsAnalyticsPage
          scopeTitle={scopeTitle}
          lastFetchAt={lastFetchAt}
          lastFetchRange={lastFetchRange}
          dataFromDatabase={dataFromDatabase}
          cacheNotice={cacheNotice}
          loading={loading}
          error={error}
          summary={summary}
          recruiterProfiles={recruiterProfiles}
          leaderboard={leaderboard}
          leaderboardTab={leaderboardTab}
          onLeaderboardTab={setLeaderboardTab}
          weeklyTargetLeaderboard={weeklyTargetLeaderboard}
          selectedRecruiterKey={selectedRecruiterKey}
          onSelectRecruiter={setSelectedRecruiterKey}
          subscriptionCache={scopedSubscriptionCache}
          scopeMode={scopeMode}
          setScopeMode={setScopeMode}
          monthAnchorYmd={monthAnchorYmd}
          setMonthAnchorYmd={setMonthAnchorYmd}
          weekAnchorYmd={weekAnchorYmd}
          setWeekAnchorYmd={setWeekAnchorYmd}
          selectedDayYmd={selectedDayYmd}
          setSelectedDayYmd={setSelectedDayYmd}
          weekWindow={weekWindow}
          monthWindow={monthWindow}
          calendarCells={calendarCells}
          viewYear={viewYear}
          viewMonth0={viewMonth0}
          dayCounts={dayCounts}
          filteredRows={filteredRows}
          onFetch={() => void fetchDashboardData()}
          onCsv={handleCsvExport}
        />
      </div>
    </Layout>
  );
};

function CallsAnalyticsLogin(props: {
  email: string;
  password: string;
  authError: string | null;
  googleLoading: boolean;
  onEmail: (v: string) => void;
  onPassword: (v: string) => void;
  onGoogle: () => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <CallsAnalyticsLoginShell>
      <CallsAnalyticsLoginCard {...props} />
    </CallsAnalyticsLoginShell>
  );
}

function CallsAnalyticsLoginShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#e8f2fc] via-[#f0f6ff] to-[#e6eef8] flex items-center justify-center p-4">
      {children}
    </div>
  );
}

function CallsAnalyticsLoginCard(props: {
  email: string;
  password: string;
  authError: string | null;
  googleLoading: boolean;
  onEmail: (v: string) => void;
  onPassword: (v: string) => void;
  onGoogle: () => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <div className={`${glassCard} w-full max-w-sm p-8`}>
      <h2 className="text-xl font-semibold text-slate-800 mb-1 text-center">Recruiter Analytics</h2>
      <p className="text-sm text-slate-500 text-center mb-6">Staff sign-in</p>
      <form onSubmit={props.onSubmit} className="space-y-4">
        <input
          type="email"
          value={props.email}
          onChange={(e) => props.onEmail(e.target.value)}
          className="w-full px-4 py-2.5 rounded-xl border border-white/60 bg-white/70"
        />
        <input
          type="password"
          value={props.password}
          onChange={(e) => props.onPassword(e.target.value)}
          className="w-full px-4 py-2.5 rounded-xl border border-white/60 bg-white/70"
        />
        <Button fullWidth type="submit">
          Sign in
        </Button>
        <div className="relative py-1">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-slate-200" />
          </div>
          <div className="relative flex justify-center text-[10px] uppercase tracking-wide text-slate-400">
            <span className="bg-white/70 px-2">or</span>
          </div>
        </div>
        <Button fullWidth type="button" variant="outline" onClick={props.onGoogle} disabled={props.googleLoading}>
          {props.googleLoading ? 'Redirecting...' : 'Continue with Google'}
        </Button>
        {props.authError && <p className="text-sm text-red-600 text-center">{props.authError}</p>}
      </form>
    </div>
  );
}

type PageProps = {
  scopeTitle: string;
  lastFetchAt: string | null;
  lastFetchRange: string | null;
  dataFromDatabase: boolean;
  cacheNotice: string | null;
  loading: boolean;
  error: string | null;
  summary: { bookings: number; recruiters: number; showed: number; full: number };
  recruiterProfiles: ReturnType<typeof buildRecruiterBookingProfiles>;
  leaderboard: RecruiterLeaderboardEntry[];
  leaderboardTab: LeaderboardTab;
  onLeaderboardTab: React.Dispatch<React.SetStateAction<LeaderboardTab>>;
  weeklyTargetLeaderboard: RecruiterWeeklyTargetEntry[];
  selectedRecruiterKey: string | null;
  onSelectRecruiter: React.Dispatch<React.SetStateAction<string | null>>;
  subscriptionCache: AnyRow[] | null;
  scopeMode: ScopeMode;
  setScopeMode: React.Dispatch<React.SetStateAction<ScopeMode>>;
  monthAnchorYmd: string;
  setMonthAnchorYmd: React.Dispatch<React.SetStateAction<string>>;
  weekAnchorYmd: string;
  setWeekAnchorYmd: React.Dispatch<React.SetStateAction<string>>;
  selectedDayYmd: string | null;
  setSelectedDayYmd: React.Dispatch<React.SetStateAction<string | null>>;
  weekWindow: { since: string; until: string; title: string };
  monthWindow: { title: string };
  calendarCells: (number | null)[];
  viewYear: number;
  viewMonth0: number;
  dayCounts: Map<string, { bookings: number; watched: number }>;
  filteredRows: AnyRow[];
  onFetch: () => void;
  onCsv: () => void;
};

function CallsAnalyticsPage(p: PageProps) {
  return (
    <div className="w-full max-w-6xl mx-auto p-5 space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className={`${glassCard} px-5 py-4 flex-1 min-w-[16rem]`}>
          <CallsAnalyticsPageHeader
            lastFetchAt={p.lastFetchAt}
            lastFetchRange={p.lastFetchRange}
            dataFromDatabase={p.dataFromDatabase}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={p.onFetch} disabled={p.loading}>
            {p.loading ? (
              <>
                <RefreshCw size={15} className="mr-1 animate-spin" /> Fetching...
              </>
            ) : (
              'Fetch data'
            )}
          </Button>
          <Button type="button" variant="outline" onClick={p.onCsv} disabled={!p.filteredRows.length}>
            <Download size={15} className="mr-1" /> CSV
          </Button>
        </div>
      </header>

      {p.subscriptionCache !== null && (
        <SummaryTiles summary={p.summary} scopeTitle={p.scopeTitle} />
      )}

      {p.subscriptionCache !== null &&
        (p.leaderboard.length > 0 || p.weeklyTargetLeaderboard.length > 0) && (
          <RecruiterLeaderboardPanel
            tab={p.leaderboardTab}
            onTab={p.onLeaderboardTab}
            performanceEntries={p.leaderboard}
            targetEntries={p.weeklyTargetLeaderboard}
            scopeTitle={p.scopeTitle}
            weekTitle={p.weekWindow.title}
            scopeMode={p.scopeMode}
            selectedKey={p.selectedRecruiterKey}
            onSelect={p.onSelectRecruiter}
          />
        )}

      {p.subscriptionCache !== null &&
        (p.leaderboard.length > 0 || p.weeklyTargetLeaderboard.length > 0) && (
          <RecruiterStatsTable
            tab={p.leaderboardTab}
            performanceEntries={p.leaderboard}
            targetEntries={p.weeklyTargetLeaderboard}
            selectedKey={p.selectedRecruiterKey}
            onSelect={p.onSelectRecruiter}
          />
        )}

      {p.subscriptionCache !== null && p.recruiterProfiles.length > 0 && (
        <RecruiterSection
          profiles={p.recruiterProfiles}
          selectedKey={p.selectedRecruiterKey}
          onSelect={p.onSelectRecruiter}
        />
      )}

      {p.subscriptionCache === null && !p.loading && (
        <div className={`${glassCard} px-4 py-8 text-center text-sm text-slate-600`}>
          Press <strong>Fetch data</strong> to load recruiter booking analytics.
        </div>
      )}

      <div className={`${glassCard} p-4`}>
        <CalendarNav
          scopeMode={p.scopeMode}
          setScopeMode={p.setScopeMode}
          monthAnchorYmd={p.monthAnchorYmd}
          setMonthAnchorYmd={p.setMonthAnchorYmd}
          weekAnchorYmd={p.weekAnchorYmd}
          setWeekAnchorYmd={p.setWeekAnchorYmd}
          selectedDayYmd={p.selectedDayYmd}
          setSelectedDayYmd={p.setSelectedDayYmd}
          weekWindow={p.weekWindow}
          monthWindow={p.monthWindow}
        />
        <p className="text-[10px] text-slate-500 mb-2">Day counts = scheduled on date</p>
        <CalendarGrid
          calendarCells={p.calendarCells}
          viewYear={p.viewYear}
          viewMonth0={p.viewMonth0}
          dayCounts={p.dayCounts}
          scopeMode={p.scopeMode}
          selectedDayYmd={p.selectedDayYmd}
          setSelectedDayYmd={p.setSelectedDayYmd}
          setScopeMode={p.setScopeMode}
          weekWindow={p.weekWindow}
        />
      </div>

      {p.cacheNotice && (
        <div className="rounded-xl border border-amber-200/80 bg-amber-50/80 backdrop-blur px-4 py-2 text-sm text-amber-950">
          {p.cacheNotice}
        </div>
      )}

      {p.error && (
        <div className="rounded-xl border border-red-200/80 bg-red-50/80 backdrop-blur px-4 py-2 text-sm text-red-800">
          {p.error}
          {p.subscriptionCache != null && (
            <span className="block mt-1 text-xs text-red-700/90">Showing last saved data from database.</span>
          )}
        </div>
      )}

      <div className={`${glassCard} overflow-hidden`}>
        <BookingsTableHeader
          count={p.filteredRows.length}
          recruiterName={
            p.selectedRecruiterKey
              ? p.recruiterProfiles.find((r) => r.key === p.selectedRecruiterKey)?.displayName
              : undefined
          }
        />
        <BookingsTable rows={p.filteredRows} />
      </div>
    </div>
  );
}

function CallsAnalyticsPageHeader({
  lastFetchAt,
  lastFetchRange,
  dataFromDatabase,
}: {
  lastFetchAt: string | null;
  lastFetchRange: string | null;
  dataFromDatabase: boolean;
}) {
  return (
    <CallsAnalyticsPageHeaderInner
      lastFetchAt={lastFetchAt}
      lastFetchRange={lastFetchRange}
      dataFromDatabase={dataFromDatabase}
    />
  );
}

function CallsAnalyticsPageHeaderInner({
  lastFetchAt,
  lastFetchRange,
  dataFromDatabase,
}: {
  lastFetchAt: string | null;
  lastFetchRange: string | null;
  dataFromDatabase: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#005EB8]/10 text-[#005EB8]">
        <BarChart3 size={22} />
      </span>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-[#005EB8]/80">
          Webinar bookings & watch rates
        </p>
        <h1 className="text-xl font-semibold text-slate-800 tracking-tight">Recruiter Analytics</h1>
        {lastFetchAt && (
          <p className="text-[11px] text-slate-500 mt-0.5">
            {dataFromDatabase ? 'Saved in database' : 'Fetched from WebinarGeek'} ·{' '}
            {new Date(lastFetchAt).toLocaleString()} · {lastFetchRange}
          </p>
        )}
      </div>
    </div>
  );
}

function SummaryTiles({
  summary,
  scopeTitle,
}: {
  summary: { bookings: number; recruiters: number; showed: number; full: number };
  scopeTitle: string;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {[
        { label: 'Bookings in scope', value: summary.bookings, sub: scopeTitle },
        { label: 'Active recruiters', value: summary.recruiters, sub: 'with file tags' },
        {
          label: 'Showed',
          value: pct(summary.showed, summary.bookings || 1),
          sub: `${summary.showed} marked`,
        },
        {
          label: 'Full watch',
          value: pct(summary.full, summary.bookings || 1),
          sub: `${summary.full} full`,
        },
      ].map((t) => (
        <SummaryTile key={t.label} label={t.label} value={t.value} sub={t.sub} />
      ))}
    </div>
  );
}

function SummaryTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub: string;
}) {
  return (
    <div className={`${glassCard} px-4 py-3`}>
      <p className="text-[10px] uppercase tracking-wide text-slate-500 font-medium">{label}</p>
      <p className="text-2xl font-semibold text-slate-800 tabular-nums mt-0.5">{value}</p>
      <p className="text-[10px] text-slate-400 mt-0.5">{sub}</p>
    </div>
  );
}

function RecruiterSection({
  profiles,
  selectedKey,
  onSelect,
}: {
  profiles: ReturnType<typeof buildRecruiterBookingProfiles>;
  selectedKey: string | null;
  onSelect: React.Dispatch<React.SetStateAction<string | null>>;
}) {
  return (
    <div className={`${glassCard} p-4 space-y-3`}>
      <div className="flex items-center gap-2">
        <Users size={18} className="text-[#005EB8]" />
        <RecruiterSectionCopy />
      </div>
      <div className="flex gap-2.5 overflow-x-auto pb-1 snap-x">
        <RecruiterChip
          name="All recruiters"
          initials="All"
          bookings={profiles.reduce((s, r) => s + r.bookings, 0)}
          team=""
          active={selectedKey === null}
          onSelect={() => onSelect(null)}
        />
        {profiles.map((r) => (
          <RecruiterChip
            key={r.key}
            name={r.displayName}
            initials={profileInitials(r.displayName)}
            bookings={r.bookings}
            team={r.team}
            active={selectedKey === r.key}
            onSelect={() => onSelect((prev) => (prev === r.key ? null : r.key))}
          />
        ))}
      </div>
    </div>
  );
}

function RecruiterSectionCopy() {
  return (
    <div>
      <p className="text-sm font-semibold text-slate-800">Filter by recruiter</p>
      <p className="text-[11px] text-slate-500">Tap a recruiter to filter the booking log below.</p>
    </div>
  );
}

function rankBadgeClass(rank: number): string {
  if (rank === 1) return 'bg-amber-100 text-amber-950 border-amber-300/80';
  if (rank === 2) return 'bg-slate-200 text-slate-800 border-slate-300/80';
  if (rank === 3) return 'bg-orange-100 text-orange-950 border-orange-300/80';
  return 'bg-white/70 text-slate-600 border-white/60';
}

function RecruiterLeaderboardPanel({
  tab,
  onTab,
  performanceEntries,
  targetEntries,
  scopeTitle,
  weekTitle,
  scopeMode,
  selectedKey,
  onSelect,
}: {
  tab: LeaderboardTab;
  onTab: React.Dispatch<React.SetStateAction<LeaderboardTab>>;
  performanceEntries: RecruiterLeaderboardEntry[];
  targetEntries: RecruiterWeeklyTargetEntry[];
  scopeTitle: string;
  weekTitle: string;
  scopeMode: ScopeMode;
  selectedKey: string | null;
  onSelect: React.Dispatch<React.SetStateAction<string | null>>;
}) {
  const isTarget = tab === 'weeklyTarget';

  return (
    <div className={`${glassCard} p-4 space-y-4`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {isTarget ? (
            <Target size={18} className="text-[#005EB8] shrink-0" />
          ) : (
            <Trophy size={18} className="text-amber-600 shrink-0" />
          )}
          <div>
            <p className="text-sm font-semibold text-slate-800">
              {isTarget ? 'Weekly target race' : 'Leaderboard'}
            </p>
            <p className="text-[11px] text-slate-500">
              {isTarget
                ? `Week · ${weekTitle} · ${RECRUITER_WEEKLY_WEBINAR_TARGET} scheduled-on target`
                : `${scopeMode === 'day' ? scopeTitle : scopeTitle} · ranked by bookings`}
            </p>
          </div>
        </div>
        <LeaderboardTabBar tab={tab} onTab={onTab} />
      </div>
      {isTarget ? (
        <>
          <WeeklyTargetRaceTrack
            entries={targetEntries}
            weekTitle={weekTitle}
            selectedKey={selectedKey}
            onSelect={onSelect}
          />
          <TargetLeaderboardList
            entries={targetEntries}
            selectedKey={selectedKey}
            onSelect={onSelect}
          />
        </>
      ) : (
        <LeaderboardList
          entries={performanceEntries}
          selectedKey={selectedKey}
          onSelect={onSelect}
        />
      )}
    </div>
  );
}

function targetBarTone(pct: number, hit: boolean): string {
  if (hit) return 'bg-emerald-500';
  if (pct >= 80) return 'bg-amber-500';
  if (pct >= 50) return 'bg-[#005EB8]';
  return 'bg-slate-400';
}

function LeaderboardTabBar({
  tab,
  onTab,
}: {
  tab: LeaderboardTab;
  onTab: React.Dispatch<React.SetStateAction<LeaderboardTab>>;
}) {
  const tabClass = (active: boolean) =>
    `flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
      active
        ? 'bg-[#005EB8] text-white shadow-sm'
        : 'text-slate-600 hover:bg-white/70 hover:text-slate-800'
    }`;

  return (
    <div className="inline-flex rounded-xl border border-white/60 bg-white/50 p-1 gap-0.5 shrink-0">
      <button type="button" className={tabClass(tab === 'performance')} onClick={() => onTab('performance')}>
        <Trophy size={14} /> Performance
      </button>
      <button type="button" className={tabClass(tab === 'weeklyTarget')} onClick={() => onTab('weeklyTarget')}>
        <Target size={14} /> Weekly target
      </button>
    </div>
  );
}

function WeeklyTargetRaceTrack({
  entries,
  weekTitle,
  selectedKey,
  onSelect,
}: {
  entries: RecruiterWeeklyTargetEntry[];
  weekTitle: string;
  selectedKey: string | null;
  onSelect: React.Dispatch<React.SetStateAction<string | null>>;
}) {
  const target = RECRUITER_WEEKLY_WEBINAR_TARGET;

  return (
    <div className="rounded-xl border border-white/50 bg-white/35 p-3 space-y-3">
      <p className="text-[11px] font-medium text-slate-600">
        Race to {target} scheduled this week · {weekTitle}
      </p>
      <div className="space-y-2.5 max-h-[min(360px,45vh)] overflow-y-auto pr-1">
        {entries.map((e) => {
          const fillPct = Math.min(100, (e.bookings / target) * 100);
          const active = selectedKey === e.key;
          return (
            <button
              key={e.key}
              type="button"
              onClick={() => onSelect((prev) => (prev === e.key ? null : e.key))}
              className={`w-full text-left rounded-lg border px-2.5 py-2 transition ${
                active
                  ? 'border-[#005EB8]/45 bg-[#005EB8]/8 ring-1 ring-[#005EB8]/20'
                  : 'border-white/40 bg-white/30 hover:bg-white/55'
              }`}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold border ${rankBadgeClass(e.rank)}`}
                >
                  {e.rank}
                </span>
                <span className="text-xs font-semibold text-slate-800 truncate flex-1">{e.displayName}</span>
                <span className="text-[10px] tabular-nums text-slate-600 shrink-0">
                  {e.bookings}/{target}
                </span>
                <span
                  className={`text-[10px] font-bold tabular-nums shrink-0 ${
                    e.hitTarget ? 'text-emerald-700' : 'text-slate-700'
                  }`}
                >
                  {e.targetPct}%
                </span>
              </div>
              <div className="relative h-2.5 rounded-full bg-slate-200/80 overflow-hidden">
                <div
                  className={`absolute inset-y-0 left-0 rounded-full transition-all ${targetBarTone(e.targetPct, e.hitTarget)}`}
                  style={{ width: `${fillPct}%` }}
                />
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-slate-700/70 z-10"
                  style={{ left: '100%', transform: 'translateX(-1px)' }}
                  title={`Target: ${target}`}
                />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TargetLeaderboardList({
  entries,
  selectedKey,
  onSelect,
}: {
  entries: RecruiterWeeklyTargetEntry[];
  selectedKey: string | null;
  onSelect: React.Dispatch<React.SetStateAction<string | null>>;
}) {
  const target = RECRUITER_WEEKLY_WEBINAR_TARGET;

  return (
    <div className="space-y-2 max-h-[min(280px,35vh)] overflow-y-auto pr-1 border-t border-white/40 pt-3">
      <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold px-0.5">
        Ranked by % of weekly target
      </p>
      {entries.map((e) => (
        <button
          key={e.key}
          type="button"
          onClick={() => onSelect((prev) => (prev === e.key ? null : e.key))}
          className={`w-full flex items-center gap-3 rounded-xl border px-3 py-2 text-left transition ${
            selectedKey === e.key
              ? 'border-[#005EB8]/50 bg-[#005EB8]/8 ring-1 ring-[#005EB8]/25'
              : 'border-white/50 bg-white/40 hover:bg-white/65'
          }`}
        >
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold border ${rankBadgeClass(e.rank)}`}
          >
            {e.rank}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-800 truncate">{e.displayName}</p>
            <p className="text-[10px] text-slate-500 tabular-nums">
              {e.bookings} of {target} scheduled · {e.remaining} to go
            </p>
          </div>
          <div className="shrink-0 text-right tabular-nums">
            <p className={`text-xs font-bold ${e.hitTarget ? 'text-emerald-700' : 'text-slate-800'}`}>
              {e.targetPct}%
            </p>
            {e.hitTarget && <p className="text-[9px] text-emerald-600 font-medium">Target hit</p>}
          </div>
        </button>
      ))}
    </div>
  );
}

function LeaderboardPanelShell({
  scopeTitle,
  scopeMode,
  children,
}: {
  scopeTitle: string;
  scopeMode: ScopeMode;
  children: React.ReactNode;
}) {
  return (
    <div className={`${glassCard} p-4 space-y-3`}>
      <div className="flex items-center gap-2">
        <Trophy size={18} className="text-amber-600 shrink-0" />
        <div>
          <p className="text-sm font-semibold text-slate-800">Leaderboard</p>
          <p className="text-[11px] text-slate-500">
            {scopeMode === 'day' ? scopeTitle : scopeTitle} · ranked by bookings
          </p>
        </div>
      </div>
      {children}
    </div>
  );
}

function LeaderboardList({
  entries,
  selectedKey,
  onSelect,
}: {
  entries: RecruiterLeaderboardEntry[];
  selectedKey: string | null;
  onSelect: React.Dispatch<React.SetStateAction<string | null>>;
}) {
  return (
    <div className="space-y-2 max-h-[min(420px,50vh)] overflow-y-auto pr-1">
      {entries.map((e) => (
        <LeaderboardRow
          key={e.key}
          entry={e}
          active={selectedKey === e.key}
          onSelect={() => onSelect((prev) => (prev === e.key ? null : e.key))}
        />
      ))}
    </div>
  );
}

function LeaderboardRow({
  entry,
  active,
  onSelect,
}: {
  entry: RecruiterLeaderboardEntry;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
        active
          ? 'border-[#005EB8]/50 bg-[#005EB8]/8 ring-1 ring-[#005EB8]/25'
          : 'border-white/50 bg-white/40 hover:bg-white/65'
      }`}
    >
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold border ${rankBadgeClass(entry.rank)}`}
      >
        {entry.rank}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-800 truncate">{entry.displayName}</p>
        <p className="text-[10px] text-slate-500 tabular-nums">
          {entry.bookings} booked · {entry.watchedYes} showed · {entry.full} full · {entry.watchedLess} less
        </p>
      </div>
      <div className="shrink-0 text-right tabular-nums">
        <p className="text-xs font-semibold text-emerald-800">{entry.showedPct}% showed</p>
        <p className="text-[10px] text-slate-500">{entry.fullPct}% full</p>
      </div>
    </button>
  );
}

function RecruiterStatsTable({
  tab,
  performanceEntries,
  targetEntries,
  selectedKey,
  onSelect,
}: {
  tab: LeaderboardTab;
  performanceEntries: RecruiterLeaderboardEntry[];
  targetEntries: RecruiterWeeklyTargetEntry[];
  selectedKey: string | null;
  onSelect: React.Dispatch<React.SetStateAction<string | null>>;
}) {
  const isTarget = tab === 'weeklyTarget';
  const target = RECRUITER_WEEKLY_WEBINAR_TARGET;

  return (
    <div className={`${glassCard} overflow-hidden`}>
      <div className="px-4 py-2.5 border-b border-white/50 bg-white/30">
        <p className="text-sm font-semibold text-slate-800">Recruiter detail</p>
        <p className="text-[11px] text-slate-500">
          {isTarget
            ? `${target} scheduled-on webinars per week · target % = booked ÷ ${target}`
            : 'Showed = marked watched · Less = not full watch'}
        </p>
      </div>
      <div className="overflow-auto max-h-[min(50vh,480px)]">
        <table className="min-w-full text-xs text-slate-800">
          <thead className="sticky top-0 z-10 border-b border-white/50 bg-white/75 backdrop-blur">
            <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2 w-10">#</th>
              <th className="px-3 py-2">Recruiter</th>
              <th className="px-3 py-2">Data file</th>
              <th className="px-3 py-2 text-right">Booked</th>
              {isTarget ? (
                <>
                  <th className="px-3 py-2 text-right">Target</th>
                  <th className="px-3 py-2 text-right">Target %</th>
                  <th className="px-3 py-2 text-right">To go</th>
                </>
              ) : (
                <>
                  <th className="px-3 py-2 text-right">Showed</th>
                  <th className="px-3 py-2 text-right">Full</th>
                  <th className="px-3 py-2 text-right">Less</th>
                  <th className="px-3 py-2 text-right">Showed %</th>
                  <th className="px-3 py-2 text-right">Full %</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {isTarget
              ? targetEntries.map((e) => (
                  <tr
                    key={e.key}
                    onClick={() => onSelect((prev) => (prev === e.key ? null : e.key))}
                    className={`border-b border-white/30 cursor-pointer transition ${
                      selectedKey === e.key ? 'bg-[#005EB8]/10' : 'hover:bg-white/45'
                    }`}
                  >
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold border ${rankBadgeClass(e.rank)}`}
                      >
                        {e.rank}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-medium">{e.displayName}</td>
                    <td className="px-3 py-2 text-slate-600">{e.team}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{e.bookings}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{target}</td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums font-semibold ${
                        e.hitTarget ? 'text-emerald-700' : ''
                      }`}
                    >
                      {e.targetPct}%
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{e.remaining}</td>
                  </tr>
                ))
              : performanceEntries.map((e) => (
                  <tr
                    key={e.key}
                    onClick={() => onSelect((prev) => (prev === e.key ? null : e.key))}
                    className={`border-b border-white/30 cursor-pointer transition ${
                      selectedKey === e.key ? 'bg-[#005EB8]/10' : 'hover:bg-white/45'
                    }`}
                  >
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold border ${rankBadgeClass(e.rank)}`}
                      >
                        {e.rank}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-medium">{e.displayName}</td>
                    <td className="px-3 py-2 text-slate-600">{e.team}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{e.bookings}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{e.watchedYes}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-800">{e.full}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{e.watchedLess}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{e.showedPct}%</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{e.fullPct}%</td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EmptyFetchCard() {
  return (
    <div className={`${glassCard} px-4 py-8 text-center text-sm text-slate-600`}>
      Press <strong>Fetch data</strong> to load recruiter booking analytics.
    </div>
  );
}

function RecruiterChip({
  name,
  initials,
  bookings,
  team,
  active,
  onSelect,
}: {
  name: string;
  initials: string;
  bookings: number;
  team: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`snap-start shrink-0 w-[11rem] rounded-xl border px-3 py-2.5 text-left transition backdrop-blur ${
        active
          ? 'border-[#005EB8]/50 bg-[#005EB8]/10 shadow-md ring-1 ring-[#005EB8]/25'
          : 'border-white/50 bg-white/40 hover:bg-white/60'
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
            active ? 'bg-[#005EB8] text-white' : 'bg-slate-200/80 text-slate-700'
          }`}
        >
          {initials}
        </span>
        <p className="text-xs font-semibold text-slate-800 truncate">{name}</p>
      </div>
      <p className="text-[10px] text-slate-500 tabular-nums pl-10">{bookings} bookings</p>
      {team && team !== '—' && <p className="text-[9px] text-slate-400 pl-10">{team}</p>}
    </button>
  );
}

function CalendarNav({
  scopeMode,
  setScopeMode,
  monthAnchorYmd,
  setMonthAnchorYmd,
  weekAnchorYmd,
  setWeekAnchorYmd,
  selectedDayYmd,
  setSelectedDayYmd,
  weekWindow,
  monthWindow,
}: {
  scopeMode: ScopeMode;
  setScopeMode: React.Dispatch<React.SetStateAction<ScopeMode>>;
  monthAnchorYmd: string;
  setMonthAnchorYmd: React.Dispatch<React.SetStateAction<string>>;
  weekAnchorYmd: string;
  setWeekAnchorYmd: React.Dispatch<React.SetStateAction<string>>;
  selectedDayYmd: string | null;
  setSelectedDayYmd: React.Dispatch<React.SetStateAction<string | null>>;
  weekWindow: { title: string };
  monthWindow: { title: string };
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 mb-4">
      <button
        type="button"
        onClick={() => {
          if (scopeMode === 'week') setWeekAnchorYmd((v) => shiftYmdDays(v, -7));
          else if (scopeMode === 'day') setSelectedDayYmd((v) => shiftYmdDays(v || torontoYmdFromDate(), -1));
          else setMonthAnchorYmd((m) => shiftMonthFirstYmd(m, -1));
        }}
        className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/60 bg-white/50"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <span className="text-sm font-medium text-slate-700 min-w-[10rem] text-center px-2">
        {scopeMode === 'week'
          ? weekWindow.title
          : scopeMode === 'day' && selectedDayYmd
            ? ymdToShortLabel(selectedDayYmd)
            : monthWindow.title}
      </span>
      <button
        type="button"
        onClick={() => {
          if (scopeMode === 'week') setWeekAnchorYmd((v) => shiftYmdDays(v, 7));
          else if (scopeMode === 'day') setSelectedDayYmd((v) => shiftYmdDays(v || torontoYmdFromDate(), 1));
          else setMonthAnchorYmd((m) => shiftMonthFirstYmd(m, 1));
        }}
        className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/60 bg-white/50"
      >
        <ChevronRight className="h-5 w-5" />
      </button>
      <ScopeModeToggleWrapper scopeMode={scopeMode} setScopeMode={setScopeMode} setSelectedDayYmd={setSelectedDayYmd} selectedDayYmd={selectedDayYmd} />
    </div>
  );
}

function ScopeModeToggleWrapper({
  scopeMode,
  setScopeMode,
  setSelectedDayYmd,
  selectedDayYmd,
}: {
  scopeMode: ScopeMode;
  setScopeMode: React.Dispatch<React.SetStateAction<ScopeMode>>;
  setSelectedDayYmd: React.Dispatch<React.SetStateAction<string | null>>;
  selectedDayYmd: string | null;
}) {
  return (
    <ScopeModeToggleInner
      scopeMode={scopeMode}
      setScopeMode={setScopeMode}
      setSelectedDayYmd={setSelectedDayYmd}
      selectedDayYmd={selectedDayYmd}
    />
  );
}

function ScopeModeToggleInner({
  scopeMode,
  setScopeMode,
  setSelectedDayYmd,
  selectedDayYmd,
}: {
  scopeMode: ScopeMode;
  setScopeMode: React.Dispatch<React.SetStateAction<ScopeMode>>;
  setSelectedDayYmd: React.Dispatch<React.SetStateAction<string | null>>;
  selectedDayYmd: string | null;
}) {
  return (
    <ScopeModeToggle
      scopeMode={scopeMode}
      setScopeMode={setScopeMode}
      setSelectedDayYmd={setSelectedDayYmd}
      selectedDayYmd={selectedDayYmd}
    />
  );
}

function ScopeModeToggle({
  scopeMode,
  setScopeMode,
  setSelectedDayYmd,
  selectedDayYmd,
}: {
  scopeMode: ScopeMode;
  setScopeMode: React.Dispatch<React.SetStateAction<ScopeMode>>;
  setSelectedDayYmd: React.Dispatch<React.SetStateAction<string | null>>;
  selectedDayYmd: string | null;
}) {
  return (
    <div className="ml-2 inline-flex rounded-xl border border-white/50 bg-white/40 p-0.5 text-[11px]">
      {(['month', 'week', 'day'] as ScopeMode[]).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => {
            setScopeMode(m);
            if (m === 'day' && !selectedDayYmd) setSelectedDayYmd(torontoYmdFromDate());
          }}
          className={`px-2.5 py-1 rounded-lg capitalize ${
            scopeMode === m ? 'bg-white/90 text-slate-900 shadow-sm' : 'text-slate-600'
          }`}
        >
          {m}
        </button>
      ))}
    </div>
  );
}

function CalendarGrid({
  calendarCells,
  viewYear,
  viewMonth0,
  dayCounts,
  scopeMode,
  selectedDayYmd,
  setSelectedDayYmd,
  setScopeMode,
  weekWindow,
}: {
  calendarCells: (number | null)[];
  viewYear: number;
  viewMonth0: number;
  dayCounts: Map<string, { bookings: number; watched: number }>;
  scopeMode: ScopeMode;
  selectedDayYmd: string | null;
  setSelectedDayYmd: React.Dispatch<React.SetStateAction<string | null>>;
  setScopeMode: React.Dispatch<React.SetStateAction<ScopeMode>>;
  weekWindow: { since: string; until: string };
}) {
  return (
    <>
      <div className="grid grid-cols-7 gap-1.5 text-center text-[10px] font-medium uppercase tracking-wide text-slate-500 mb-1.5">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <WeekdayLabel key={d} label={d} />
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {calendarCells.map((day, idx) => {
          if (day == null) {
            return <CalendarEmptyCell key={`e-${idx}`} />;
          }
          const ymd = `${viewYear}-${String(viewMonth0 + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const counts = dayCounts.get(ymd);
          const active = selectedDayYmd === ymd;
          const inWeek = scopeMode === 'week' && ymd >= weekWindow.since && ymd <= weekWindow.until;
          return (
            <button
              key={ymd}
              type="button"
              onClick={() => {
                setScopeMode('day');
                setSelectedDayYmd(ymd);
              }}
              className={`min-h-[64px] rounded-xl border text-left px-2 py-1 transition ${
                active || inWeek
                  ? 'border-[#005EB8]/40 bg-[#005EB8]/8'
                  : 'border-white/40 bg-white/30 hover:bg-white/50'
              }`}
            >
              <span className="text-[11px] font-semibold text-slate-800">{day}</span>
              {counts && (
                <span className="block text-[9px] text-slate-600 tabular-nums mt-0.5">
                  {counts.bookings} booked
                </span>
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}

function WeekdayLabel({ label }: { label: string }) {
  return <div className="py-1">{label}</div>;
}

function CalendarEmptyCell() {
  return <div className="min-h-[64px] rounded-xl bg-white/20" />;
}

function BookingsTableHeader({
  count,
  recruiterName,
}: {
  count: number;
  recruiterName?: string;
}) {
  return (
    <div className="px-4 py-2.5 border-b border-white/50 bg-white/30 text-xs text-slate-600">
      {count} booking{count === 1 ? '' : 's'}
      {recruiterName && <span className="text-[#005EB8] font-medium"> · {recruiterName}</span>}
    </div>
  );
}

function BookingsTable({ rows }: { rows: AnyRow[] }) {
  return (
    <div className="overflow-auto max-h-[min(70vh,520px)]">
      <table className="min-w-full text-xs text-slate-800">
        <thead className="sticky top-0 z-10 border-b border-white/50 bg-white/70 backdrop-blur">
          <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500">
            <th className="px-3 py-2">Recruiter</th>
            <th className="px-3 py-2">Team</th>
            <th className="px-3 py-2">Candidate</th>
            <th className="px-3 py-2">Email</th>
            <th className="px-3 py-2">Scheduled on</th>
            <th className="px-3 py-2">Scheduled for</th>
            <th className="px-3 py-2">Watched</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-3 py-8 text-center text-slate-500">
                No rows in scope
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const hrMs = hrScheduledMsFromRow(row);
              const sessionMs = webinarSessionMsFromRow(row);
              return (
                <tr key={String(row.id)} className="border-b border-white/30 hover:bg-white/40">
                  <td className="px-3 py-2 font-medium">{recruiterNameFromRow(row)}</td>
                  <td className="px-3 py-2 text-slate-600">{recruiterTeamFromRow(row)}</td>
                  <td className="px-3 py-2">{candidateDisplayNameFromRow(row) || '—'}</td>
                  <td className="px-3 py-2 text-slate-600">{String(row.email || '—')}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-600">
                    {hrMs ? formatDateTimeCanadaEastern(hrMs) : '—'}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-slate-600">
                    {sessionMs ? formatDateTimeCanadaEastern(sessionMs) : '—'}
                  </td>
                  <td className="px-3 py-2">{row.watched === true ? 'Yes' : 'No'}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

export default CallsAnalytics;
