import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useStaffAuthenticated } from '../hooks/useStaffAuthenticated';
import { Link } from 'react-router-dom';
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
import PageGuidePanel from '../components/tour/PageGuidePanel';
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
  fmtHrScheduledDateKey,
  fmtWebinarSessionDateKey,
  pctRounded,
  profileInitials,
  rowMatchesNameKey,
  type RecruiterBookingProfile,
} from '../services/webinarGeekRecruiterAnalytics';
import { signInWithGoogle } from '../services/googleAuth';
import {
  candidateDisplayNameFromRow,
  hrScheduledMsFromRow,
  recruiterNameFromRow,
  recruiterTeamFromRow,
  webinarSessionMsFromRow,
} from '../services/webinarGeekInviters';
import { BarChart3, ChevronLeft, ChevronRight, Download, RefreshCw, Search, Users } from 'lucide-react';

type AnyRow = Record<string, unknown>;
type ScopeMode = 'month' | 'week' | 'day';

const glassCard =
  'rounded-2xl border border-white/40 bg-white/55 backdrop-blur-xl shadow-[0_8px_32px_rgba(15,40,80,0.08)]';

function watchSecondsFromRow(row: AnyRow): number {
  const sec = Number(row.watch_duration || 0);
  return Number.isFinite(sec) && sec > 0 ? sec : 0;
}

function phoneDisplay(row: AnyRow): string {
  const phone = String(row.phone ?? row.telephone ?? row.mobile ?? '').trim();
  return phone || '—';
}

function sourceDisplay(row: AnyRow): string {
  const customField = String(row.custom_field || '').trim();
  if (!customField) return 'registration_page';
  const prefix = customField.split('_')[0]?.trim().toLowerCase() || '';
  if (prefix === 'cooper' || prefix === 'rms') return 'file_tag';
  return customField.length > 28 ? `${customField.slice(0, 28)}...` : customField;
}

function subscriptionStatus(row: AnyRow): string {
  if (row.unsubscribed === true) return 'Unsubscribed';
  if (row.watched === true) return 'Watched';
  return 'Active';
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
    const isAuthenticated = useStaffAuthenticated();
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
  const [recruiterFilterQuery, setRecruiterFilterQuery] = useState('');
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
  const scopeDateKey = useMemo(
    () => (viewerRole === 'recruiter' ? fmtHrScheduledDateKey : fmtWebinarSessionDateKey),
    [viewerRole],
  );

  const rowsInViewMonth = useMemo(() => {
    if (!scopedSubscriptionCache) return [];
    const [vy, vm] = monthAnchorYmd.split('-').map(Number);
    const start = `${vy}-${String(vm).padStart(2, '0')}-01`;
    const lastD = new Date(vy, vm, 0).getDate();
    const end = `${vy}-${String(vm).padStart(2, '0')}-${String(lastD).padStart(2, '0')}`;
    return scopedSubscriptionCache.filter((row) => {
      const k = scopeDateKey(row);
      if (k === 'unknown') return false;
      return k >= start && k <= end;
    });
  }, [scopedSubscriptionCache, monthAnchorYmd, scopeDateKey]);

  const rowsInViewWeek = useMemo(() => {
    if (!scopedSubscriptionCache) return [];
    return scopedSubscriptionCache.filter((row) => {
      const k = scopeDateKey(row);
      if (k === 'unknown') return false;
      return k >= weekWindow.since && k <= weekWindow.until;
    });
  }, [scopedSubscriptionCache, weekWindow.since, weekWindow.until, scopeDateKey]);

  const rowsInViewMonthByDate = useMemo(() => {
    const map = new Map<string, AnyRow[]>();
    for (const row of rowsInViewMonth) {
      const key = scopeDateKey(row);
      if (key === 'unknown') continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    }
    return map;
  }, [rowsInViewMonth, scopeDateKey]);

  const rowsForScope = useMemo(() => {
    if (scopeMode === 'week') return rowsInViewWeek;
    if (scopeMode === 'day') {
      if (!selectedDayYmd) return [];
      return rowsInViewMonthByDate.get(selectedDayYmd) ?? [];
    }
    return rowsInViewMonth;
  }, [scopeMode, rowsInViewWeek, rowsInViewMonth, rowsInViewMonthByDate, selectedDayYmd]);

  useEffect(() => {
    if (!selectedRecruiterKey) return;
    const stillVisibleInScope = rowsForScope.some((row) => rowMatchesNameKey(row, selectedRecruiterKey));
    if (!stillVisibleInScope) setSelectedRecruiterKey(null);
  }, [rowsForScope, selectedRecruiterKey]);

  const recruiterProfiles = useMemo(
    () => buildRecruiterBookingProfiles(rowsForScope, watchSecondsFromRow),
    [rowsForScope],
  );

  const recruiterProfilesFiltered = useMemo(() => {
    const q = recruiterFilterQuery.trim().toLowerCase();
    if (!q) return recruiterProfiles;
    return recruiterProfiles.filter(
      (p) =>
        p.displayName.toLowerCase().includes(q) ||
        p.team.toLowerCase().includes(q) ||
        p.key.toLowerCase().includes(q),
    );
  }, [recruiterProfiles, recruiterFilterQuery]);

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

  const dayCounts = useMemo(() => {
    const map = new Map<string, { bookings: number; watched: number }>();
    for (const [key, rows] of rowsInViewMonthByDate.entries()) {
      const watched = rows.reduce((sum, row) => (row.watched === true ? sum + 1 : sum), 0);
      map.set(key, { bookings: rows.length, watched });
    }
    return map;
  }, [rowsInViewMonthByDate]);

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
      'source',
      'team',
      'status',
      'candidate_name',
      'email',
      'phone',
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
        csvScalar(sourceDisplay(row)),
        csvScalar(recruiterTeamFromRow(row)),
        csvScalar(subscriptionStatus(row)),
        csvScalar(candidateDisplayNameFromRow(row) || '0'),
        csvScalar(String(row.email ?? '')),
        csvScalar(phoneDisplay(row)),
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



  return (
      <div className="min-h-screen min-w-0 overflow-x-hidden bg-gradient-to-br from-[#e8f2fc] via-[#f0f6ff] to-[#e6eef8]">
        <CallsAnalyticsPage
          scopeTitle={scopeTitle}
          viewerRole={viewerRole}
          lastFetchAt={lastFetchAt}
          lastFetchRange={lastFetchRange}
          dataFromDatabase={dataFromDatabase}
          cacheNotice={cacheNotice}
          loading={loading}
          error={error}
          summary={summary}
          recruiterProfiles={recruiterProfilesFiltered}
          recruiterFilterQuery={recruiterFilterQuery}
          onRecruiterFilterQuery={setRecruiterFilterQuery}
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
  );
};

type PageProps = {
  scopeTitle: string;
  viewerRole: AppRole | null;
  lastFetchAt: string | null;
  lastFetchRange: string | null;
  dataFromDatabase: boolean;
  cacheNotice: string | null;
  loading: boolean;
  error: string | null;
  summary: { bookings: number; recruiters: number; showed: number; full: number };
  recruiterProfiles: RecruiterBookingProfile[];
  recruiterFilterQuery: string;
  onRecruiterFilterQuery: React.Dispatch<React.SetStateAction<string>>;
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
    <div className="w-full min-w-0 max-w-6xl mx-auto p-4 sm:p-5 space-y-5">
      <PageGuidePanel guideId="calls-analytics" />
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className={`${glassCard} px-5 py-4 flex-1 min-w-[16rem]`}>
          <CallsAnalyticsPageHeader
            lastFetchAt={p.lastFetchAt}
            lastFetchRange={p.lastFetchRange}
            dataFromDatabase={p.dataFromDatabase}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/calls-analytics/leaderboard"
            className="inline-flex items-center rounded-xl border border-[#c7dbf1] bg-white/70 px-3 py-2 text-xs font-semibold text-[#0B1B34] hover:bg-white"
          >
            Leadership Board
          </Link>
          <Button type="button" data-tour="analytics-fetch" onClick={p.onFetch} disabled={p.loading}>
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

      {p.subscriptionCache !== null && (
        <RecruiterFilterBar
          profiles={p.recruiterProfiles}
          filterQuery={p.recruiterFilterQuery}
          onFilterQuery={p.onRecruiterFilterQuery}
          selectedKey={p.selectedRecruiterKey}
          onSelect={p.onSelectRecruiter}
        />
      )}

      {p.subscriptionCache !== null && p.recruiterProfiles.length > 0 && (
        <RecruiterBookingsSummaryTable
          profiles={p.recruiterProfiles}
          selectedKey={p.selectedRecruiterKey}
          onSelect={p.onSelectRecruiter}
          scopeTitle={p.scopeTitle}
        />
      )}

      {p.subscriptionCache === null && !p.loading && (
        <div className={`${glassCard} px-4 py-8 text-center text-sm text-slate-600`}>
          Press <strong>Fetch data</strong> to load recruiter booking analytics.
        </div>
      )}

      <div className={`${glassCard} p-4 min-w-0 max-w-full overflow-hidden`} data-tour="analytics-calendar">
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
        <p className="text-[10px] text-slate-500 mb-2">
          {p.viewerRole === 'recruiter'
            ? 'Grouped by booking date. Click a day cell to switch to day scope and open invitee detail rows.'
            : 'Day counts = scheduled on date. Click a day cell to switch to day scope and open invitee detail rows.'}
        </p>
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

      <div className={`${glassCard} w-full min-w-0 max-w-full overflow-hidden`}>
        <BookingsTableHeader
          count={p.filteredRows.length}
          selectedDayYmd={p.scopeMode === 'day' ? p.selectedDayYmd : null}
          recruiterName={
            p.selectedRecruiterKey
              ? p.recruiterProfiles.find((r) => r.key === p.selectedRecruiterKey)?.displayName
              : undefined
          }
        />
        <BookingsTable rows={p.filteredRows} selectedDayYmd={p.scopeMode === 'day' ? p.selectedDayYmd : null} />
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

function RecruiterFilterBar({
  profiles,
  filterQuery,
  onFilterQuery,
  selectedKey,
  onSelect,
}: {
  profiles: RecruiterBookingProfile[];
  filterQuery: string;
  onFilterQuery: React.Dispatch<React.SetStateAction<string>>;
  selectedKey: string | null;
  onSelect: React.Dispatch<React.SetStateAction<string | null>>;
}) {
  const totalBookings = profiles.reduce((s, r) => s + r.bookings, 0);

  return (
    <div className={`${glassCard} p-4 space-y-3`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Users size={18} className="text-[#005EB8] shrink-0" />
          <div>
            <p className="text-sm font-semibold text-slate-800">Filter by recruiter</p>
            <p className="text-[11px] text-slate-500">
              Search or tap a recruiter to filter the booking log below.
            </p>
          </div>
        </div>
        <div className="relative w-full sm:w-64">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={filterQuery}
            onChange={(e) => onFilterQuery(e.target.value)}
            placeholder="Search recruiter or file tag…"
            className="w-full rounded-xl border border-white/60 bg-white/70 py-2 pl-9 pr-3 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#005EB8]/25"
          />
        </div>
      </div>
      <div className="flex gap-2.5 overflow-x-auto pb-1 snap-x">
        <RecruiterChip
          name="All recruiters"
          initials="All"
          bookings={totalBookings}
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
        {profiles.length === 0 && filterQuery.trim() && (
          <p className="text-xs text-slate-500 self-center px-2">No recruiters match your search.</p>
        )}
      </div>
    </div>
  );
}

function RecruiterBookingsSummaryTable({
  profiles,
  selectedKey,
  onSelect,
  scopeTitle,
}: {
  profiles: RecruiterBookingProfile[];
  selectedKey: string | null;
  onSelect: React.Dispatch<React.SetStateAction<string | null>>;
  scopeTitle: string;
}) {
  return (
      <div className={`${glassCard} w-full min-w-0 max-w-full overflow-hidden`}>
        <div className="px-4 py-2.5 border-b border-white/50 bg-white/30">
          <p className="text-sm font-semibold text-slate-800">Bookings by recruiter</p>
        <p className="text-[11px] text-slate-500">
          {scopeTitle} · Showed = marked watched · Less = not full watch · click a row to filter details
        </p>
      </div>
      <div className="w-full max-w-full overflow-x-auto max-h-[min(50vh,480px)]">
        <table className="w-full min-w-[640px] text-xs text-slate-800">
          <thead className="sticky top-0 z-10 border-b border-white/50 bg-white/75 backdrop-blur">
            <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2">Recruiter</th>
              <th className="px-3 py-2">Data file</th>
              <th className="px-3 py-2 text-right whitespace-nowrap">Booked</th>
              <th className="px-3 py-2 text-right whitespace-nowrap">Showed</th>
              <th className="px-3 py-2 text-right whitespace-nowrap">Full</th>
              <th className="px-3 py-2 text-right whitespace-nowrap hidden sm:table-cell">Less</th>
              <th className="px-3 py-2 text-right whitespace-nowrap">Showed %</th>
              <th className="px-3 py-2 text-right whitespace-nowrap hidden md:table-cell">Full %</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => {
              const watchedLess = p.half + p.notYet;
              const showedPct = pctRounded(p.watchedYes, p.bookings);
              const fullPct = pctRounded(p.full, p.bookings);
              return (
                <tr
                  key={p.key}
                  onClick={() => onSelect((prev) => (prev === p.key ? null : p.key))}
                  className={`border-b border-white/30 cursor-pointer transition ${
                    selectedKey === p.key ? 'bg-[#005EB8]/10' : 'hover:bg-white/45'
                  }`}
                >
                  <td className="px-3 py-2 font-medium">{p.displayName}</td>
                  <td className="px-3 py-2 text-slate-600">{p.team}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{p.bookings}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{p.watchedYes}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-800">{p.full}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600 hidden sm:table-cell">{watchedLess}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">{showedPct}%</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium hidden md:table-cell">{fullPct}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
      <div className="grid grid-cols-7 gap-1 sm:gap-1.5 text-center text-[10px] font-medium uppercase tracking-wide text-slate-500 mb-1.5 min-w-0">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <WeekdayLabel key={d} label={d} />
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1 sm:gap-1.5 min-w-0">
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
              className={`min-h-[56px] sm:min-h-[64px] rounded-lg sm:rounded-xl border text-left px-1.5 sm:px-2 py-1 transition min-w-0 ${
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
  selectedDayYmd,
}: {
  count: number;
  recruiterName?: string;
  selectedDayYmd?: string | null;
}) {
  return (
    <div className="px-4 py-2.5 border-b border-white/50 bg-white/30 text-xs text-slate-600">
      {count} booking{count === 1 ? '' : 's'}
      {recruiterName && <span className="text-[#005EB8] font-medium"> · {recruiterName}</span>}
      {selectedDayYmd && <span className="text-slate-500"> · Day {ymdToShortLabel(selectedDayYmd)}</span>}
    </div>
  );
}

function BookingsTable({ rows, selectedDayYmd }: { rows: AnyRow[]; selectedDayYmd?: string | null }) {
  return (
    <div className="w-full max-w-full overflow-x-auto max-h-[min(70vh,520px)]">
      <table className="w-full min-w-[720px] text-xs text-slate-800">
        <thead className="sticky top-0 z-10 border-b border-white/50 bg-white/70 backdrop-blur">
          <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500">
            <th className="px-3 py-2">Recruiter</th>
            <th className="px-3 py-2 hidden lg:table-cell">Source</th>
            <th className="px-3 py-2 hidden md:table-cell">Team</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Candidate</th>
            <th className="px-3 py-2 hidden sm:table-cell">Email</th>
            <th className="px-3 py-2 hidden xl:table-cell">Phone</th>
            <th className="px-3 py-2 whitespace-nowrap">Scheduled on</th>
            <th className="px-3 py-2 whitespace-nowrap">Scheduled for</th>
            <th className="px-3 py-2">Watched</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={10} className="px-3 py-8 text-center text-slate-500">
                {selectedDayYmd ? `No invitees found for ${ymdToShortLabel(selectedDayYmd)}.` : 'No rows in scope.'}
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const hrMs = hrScheduledMsFromRow(row);
              const sessionMs = webinarSessionMsFromRow(row);
              return (
                <tr key={String(row.id)} className="border-b border-white/30 hover:bg-white/40">
                  <td className="px-3 py-2 font-medium max-w-[8rem] truncate">{recruiterNameFromRow(row)}</td>
                  <td className="px-3 py-2 text-slate-600 hidden lg:table-cell">{sourceDisplay(row)}</td>
                  <td className="px-3 py-2 text-slate-600 hidden md:table-cell">{recruiterTeamFromRow(row)}</td>
                  <td className="px-3 py-2 text-slate-600">{subscriptionStatus(row)}</td>
                  <td className="px-3 py-2 max-w-[9rem] truncate">{candidateDisplayNameFromRow(row) || '—'}</td>
                  <td className="px-3 py-2 text-slate-600 max-w-[10rem] truncate hidden sm:table-cell">{String(row.email || '—')}</td>
                  <td className="px-3 py-2 text-slate-600 tabular-nums hidden xl:table-cell">{phoneDisplay(row)}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-600 whitespace-nowrap">
                    {hrMs ? formatDateTimeCanadaEastern(hrMs) : '—'}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-slate-600 whitespace-nowrap">
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
