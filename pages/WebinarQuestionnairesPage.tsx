import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ClipboardList, Database, RefreshCw, Search } from 'lucide-react';
import { Button } from '../components/UI';
import { useStaffAuthenticated } from '../hooks/useStaffAuthenticated';
import { getCurrentUserProfile, type AppRole } from '../services/accessControl';
import { formatDateTimeCanadaEastern } from '../services/dateDisplay';
import {
  backfillWebinarQuestionnairesFromCache,
  defaultQuestionnaireDateFrom,
  displayNameFromSubmission,
  fetchDashboardCacheMetaForQuestionnaires,
  fetchLatestQuestionnaireSyncRun,
  fetchWebinarQuestionnaireDetail,
  fetchWebinarQuestionnairePage,
  fetchWebinarQuestionnaireSummary,
  fetchWebinarQuestionnaireWebinarTitles,
  hiringStageLabel,
  sourceTypeLabel,
  syncWebinarGeekQuestionnaires,
  todayYmd,
  watchMinutesFromSubmission,
  type QuestionnaireViewFilter,
  type WebinarQuestionnaireSubmission,
} from '../services/webinarGeekQuestionnaires';

const SEARCH_DEBOUNCE_MS = 300;
const BACKFILL_SESSION_KEY = 'wg_questionnaire_backfill_attempted';

function canAccessWebinarQuestionnaires(role: AppRole | null): boolean {
  return role === 'admin' || role === 'leadership' || role === 'hr' || role === 'webinar' || role === 'recruiter';
}

function stageTone(stage: string): string {
  if (stage === 'ready_for_followup') return 'bg-violet-100 text-violet-900';
  if (stage === 'questionnaire_submitted') return 'bg-emerald-100 text-emerald-900';
  if (stage === 'attended_only') return 'bg-sky-100 text-sky-900';
  return 'bg-slate-100 text-slate-700';
}

const VIEW_FILTERS: Array<{ id: QuestionnaireViewFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'with_answers', label: 'With questionnaire' },
  { id: 'attended_only', label: 'Attended only' },
  { id: 'matched_pipeline', label: 'Matched to pipeline' },
];

const WebinarQuestionnairesPage: React.FC = () => {
  const isAuthenticated = useStaffAuthenticated();
  const [role, setRole] = React.useState<AppRole | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [syncing, setSyncing] = React.useState(false);
  const [backfilling, setBackfilling] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<WebinarQuestionnaireSubmission[]>([]);
  const [hasMore, setHasMore] = React.useState(false);
  const [nextOffset, setNextOffset] = React.useState(0);
  const [search, setSearch] = React.useState('');
  const [debouncedSearch, setDebouncedSearch] = React.useState('');
  const [dateFrom, setDateFrom] = React.useState(defaultQuestionnaireDateFrom());
  const [dateTo, setDateTo] = React.useState(todayYmd());
  const [webinarTitle, setWebinarTitle] = React.useState('all');
  const [sourceType, setSourceType] = React.useState('all');
  const [viewFilter, setViewFilter] = React.useState<QuestionnaireViewFilter>('all');
  const [webinarTitles, setWebinarTitles] = React.useState<string[]>([]);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [expandedDetail, setExpandedDetail] = React.useState<WebinarQuestionnaireSubmission | null>(null);
  const [detailLoadingId, setDetailLoadingId] = React.useState<string | null>(null);
  const [summary, setSummary] = React.useState({ total: 0, withAnswers: 0, attendedOnly: 0, matchedPipeline: 0 });
  const [lastSync, setLastSync] = React.useState<Awaited<ReturnType<typeof fetchLatestQuestionnaireSyncRun>>>(null);
  const [cacheMeta, setCacheMeta] = React.useState<Awaited<ReturnType<typeof fetchDashboardCacheMetaForQuestionnaires>>>(null);

  React.useEffect(() => {
    if (!isAuthenticated) return;
    void getCurrentUserProfile().then((profile) => setRole(profile?.role ?? null));
  }, [isAuthenticated]);

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search]);

  React.useEffect(() => {
    if (!isAuthenticated || !canAccessWebinarQuestionnaires(role)) return;
    void fetchDashboardCacheMetaForQuestionnaires().then(setCacheMeta);
    void fetchWebinarQuestionnaireWebinarTitles().then(setWebinarTitles);
  }, [isAuthenticated, role]);

  const loadPage = React.useCallback(async (mode: 'reset' | 'more' = 'reset') => {
    if (mode === 'more') setLoadingMore(true);
    else setLoading(true);
    setError(null);
    try {
      const offset = mode === 'more' ? nextOffset : 0;
      const [page, syncRun, stats] = await Promise.all([
        fetchWebinarQuestionnairePage({
          search: debouncedSearch || undefined,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          webinarTitle: webinarTitle !== 'all' ? webinarTitle : undefined,
          sourceType: sourceType !== 'all' ? sourceType : undefined,
          viewFilter,
          offset,
        }),
        mode === 'reset' ? fetchLatestQuestionnaireSyncRun() : Promise.resolve(lastSync),
        mode === 'reset'
          ? fetchWebinarQuestionnaireSummary({ dateFrom, dateTo })
          : Promise.resolve(summary),
      ]);

      setRows((prev) => (mode === 'more' ? [...prev, ...page.rows] : page.rows));
      setHasMore(page.hasMore);
      setNextOffset(page.nextOffset);
      if (mode === 'reset') {
        setLastSync(syncRun);
        setSummary(stats);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [debouncedSearch, dateFrom, dateTo, webinarTitle, sourceType, viewFilter, nextOffset]);

  React.useEffect(() => {
    if (!isAuthenticated || !canAccessWebinarQuestionnaires(role)) return;
    void loadPage('reset');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, role, debouncedSearch, dateFrom, dateTo, webinarTitle, sourceType, viewFilter]);

  const tryAutoBackfill = React.useCallback(async () => {
    if (sessionStorage.getItem(BACKFILL_SESSION_KEY)) return;
    if (!cacheMeta?.subscriptionCount) return;
    sessionStorage.setItem(BACKFILL_SESSION_KEY, '1');
    setBackfilling(true);
    try {
      const result = await backfillWebinarQuestionnairesFromCache();
      if (result.ok && result.data.upserted_count > 0) {
        setMessage(
          `Imported ${result.data.upserted_count} row(s) from cached attendance data`
          + (result.data.with_questionnaire_count ? ` (${result.data.with_questionnaire_count} with questionnaire answers)` : ''),
        );
        await loadPage('reset');
        void fetchWebinarQuestionnaireWebinarTitles().then(setWebinarTitles);
      }
    } catch {
      // silent on auto-backfill
    } finally {
      setBackfilling(false);
    }
  }, [cacheMeta?.subscriptionCount, loadPage]);

  React.useEffect(() => {
    if (!isAuthenticated || !canAccessWebinarQuestionnaires(role)) return;
    if (loading || backfilling) return;
    if (summary.total > 0) return;
    void tryAutoBackfill();
  }, [isAuthenticated, role, loading, backfilling, summary.total, tryAutoBackfill]);

  const handleBackfill = async () => {
    setBackfilling(true);
    setError(null);
    setMessage(null);
    try {
      const result = await backfillWebinarQuestionnairesFromCache();
      if (!result.ok) throw new Error(result.error);
      setMessage(
        `Imported ${result.data.upserted_count} row(s) from cached WebinarGeek attendance`
        + (result.data.with_questionnaire_count ? ` · ${result.data.with_questionnaire_count} with questionnaire` : '')
        + (result.data.cache_fetched_at ? ` · cache from ${formatDateTimeCanadaEastern(result.data.cache_fetched_at)}` : ''),
      );
      await loadPage('reset');
      void fetchWebinarQuestionnaireWebinarTitles().then(setWebinarTitles);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBackfilling(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    setMessage(null);
    try {
      const result = await syncWebinarGeekQuestionnaires();
      if (!result.ok) throw new Error(result.error);
      setMessage(
        `Synced ${result.data.upserted_count} submission(s) from WebinarGeek API`
        + (result.data.api_sources.length ? ` (${result.data.api_sources.join(', ')})` : ''),
      );
      await loadPage('reset');
      void fetchWebinarQuestionnaireWebinarTitles().then(setWebinarTitles);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  };

  const toggleExpanded = async (row: WebinarQuestionnaireSubmission) => {
    if (expandedId === row.id) {
      setExpandedId(null);
      setExpandedDetail(null);
      return;
    }
    setExpandedId(row.id);
    setExpandedDetail(null);
    setDetailLoadingId(row.id);
    try {
      const detail = await fetchWebinarQuestionnaireDetail(row.id);
      setExpandedDetail(detail);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDetailLoadingId(null);
    }
  };

  if (!isAuthenticated) {
    return <div className="p-6 text-sm text-slate-600">Sign in to view webinar questionnaires.</div>;
  }

  if (role && !canAccessWebinarQuestionnaires(role)) {
    return (
      <div className="p-6">
        <p className="text-sm text-slate-600">You do not have access to webinar questionnaires.</p>
        <Link to="/home" className="mt-2 inline-block text-sm text-[#005EB8] hover:underline">Back to home</Link>
      </div>
    );
  }

  const busy = loading || syncing || backfilling;

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 p-4 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-[#4b6d95]">
            <Link to="/webinar-geek" className="hover:underline">Webinar Geek</Link>
            <span className="mx-1">/</span>
            Questionnaires
          </p>
          <h1 className="text-2xl font-bold text-[#0B1B34] flex items-center gap-2">
            <ClipboardList size={24} className="text-[#005EB8]" />
            Webinar questionnaires & attendance
          </h1>
          <p className="mt-1 text-sm text-[#5c7594] max-w-2xl">
            Historical responses and attendees from your cached WebinarGeek dashboard data (no API calls).
            Use <strong>Sync from WebinarGeek API</strong> only when you need the latest evaluation endpoints.
          </p>
          {cacheMeta && (
            <p className="mt-1 text-[11px] text-[#8aa3c0]">
              Attendance cache: {cacheMeta.subscriptionCount.toLocaleString()} subscriptions
              {cacheMeta.fetchedAt ? ` · updated ${formatDateTimeCanadaEastern(cacheMeta.fetchedAt)}` : ''}
              {cacheMeta.fetchLabel ? ` · ${cacheMeta.fetchLabel}` : ''}
            </p>
          )}
          {lastSync && (
            <p className="mt-1 text-[11px] text-[#8aa3c0]">
              Last import {formatDateTimeCanadaEastern(lastSync.synced_at)}
              {lastSync.api_sources?.includes('dashboard_cache') ? ' (cache)' : ''}
              {lastSync.error_message ? ` · Error: ${lastSync.error_message}` : ` · ${lastSync.upserted_count} saved`}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void loadPage('reset')} disabled={busy}>
            <RefreshCw size={16} className={loading ? 'animate-spin mr-1.5' : 'mr-1.5'} />
            Refresh
          </Button>
          <Button variant="outline" onClick={() => void handleBackfill()} disabled={busy}>
            <Database size={16} className={backfilling ? 'animate-spin mr-1.5' : 'mr-1.5'} />
            {backfilling ? 'Importing…' : 'Import from cache'}
          </Button>
          <Button onClick={() => void handleSync()} disabled={busy}>
            <RefreshCw size={16} className={syncing ? 'animate-spin mr-1.5' : 'mr-1.5'} />
            {syncing ? 'Syncing API…' : 'Sync from WebinarGeek API'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-[#d6deea] bg-white p-3">
          <p className="text-[10px] uppercase tracking-wide text-[#7a8ba1]">In date range</p>
          <p className="text-xl font-bold text-[#0B1B34]">{summary.total.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
          <p className="text-[10px] uppercase tracking-wide text-emerald-800">With questionnaire</p>
          <p className="text-xl font-bold text-emerald-900">{summary.withAnswers.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-sky-200 bg-sky-50/50 p-3">
          <p className="text-[10px] uppercase tracking-wide text-sky-800">Attended only</p>
          <p className="text-xl font-bold text-sky-900">{summary.attendedOnly.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-3">
          <p className="text-[10px] uppercase tracking-wide text-violet-800">Matched pipeline</p>
          <p className="text-xl font-bold text-violet-900">{summary.matchedPipeline.toLocaleString()}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-[#cde0f4] bg-white p-4 space-y-3">
        <div className="flex flex-wrap gap-1">
          {VIEW_FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setViewFilter(item.id)}
              className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${
                viewFilter === item.id
                  ? 'border-[#7eb3e7] bg-[#e8f3ff] text-[#285082]'
                  : 'border-[#dbe8f5] bg-white text-[#5c7594]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
          <div className="relative lg:col-span-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a9ab0]" size={16} />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, email, phone, recruiter, webinar…"
              className="w-full rounded-xl border border-[#cfe3f9] py-2 pl-9 pr-3 text-sm"
            />
          </div>
          <label className="text-xs text-[#5c7594]">
            From
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="mt-1 w-full rounded-xl border border-[#cfe3f9] px-2 py-2 text-sm" />
          </label>
          <label className="text-xs text-[#5c7594]">
            To
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="mt-1 w-full rounded-xl border border-[#cfe3f9] px-2 py-2 text-sm" />
          </label>
          <label className="text-xs text-[#5c7594]">
            Webinar
            <select value={webinarTitle} onChange={(e) => setWebinarTitle(e.target.value)} className="mt-1 w-full rounded-xl border border-[#cfe3f9] px-2 py-2 text-sm">
              <option value="all">All webinars</option>
              {webinarTitles.map((title) => (
                <option key={title} value={title}>{title}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs text-[#5c7594]">
          <label className="inline-flex items-center gap-2">
            Source
            <select value={sourceType} onChange={(e) => setSourceType(e.target.value)} className="rounded-lg border border-[#cfe3f9] px-2 py-1 text-sm">
              <option value="all">All sources</option>
              <option value="dashboard_cache">Attendance cache</option>
              <option value="wg_sync">WebinarGeek API</option>
            </select>
          </label>
          <span>{rows.length.toLocaleString()} loaded{hasMore ? '+' : ''}</span>
        </div>
      </div>

      {message && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{message}</div>
      )}
      {error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{error}</div>
      )}

      <div className="rounded-2xl border border-[#cde0f4] bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#f4f7fb] text-left text-[10px] uppercase tracking-wide text-[#6b7c93]">
            <tr>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Candidate</th>
              <th className="px-3 py-2">Attendance</th>
              <th className="px-3 py-2">Booked by</th>
              <th className="px-3 py-2">Webinar</th>
              <th className="px-3 py-2">Stage</th>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2 w-24">Detail</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const expanded = expandedId === row.id;
              const detail = expanded && expandedDetail?.id === row.id ? expandedDetail : null;
              const answers = detail?.answers || [];
              const watchMins = watchMinutesFromSubmission(row);
              const hasQuestionnaire = row.hiring_stage === 'questionnaire_submitted';

              return (
                <React.Fragment key={row.id}>
                  <tr className="border-t border-[#eef2f7] hover:bg-[#fafcff] align-top">
                    <td className="px-3 py-2 whitespace-nowrap text-[#5c6b82] tabular-nums">
                      {row.submitted_at ? formatDateTimeCanadaEastern(row.submitted_at) : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-[#0B1B34]">{displayNameFromSubmission(row)}</div>
                      <div className="text-[11px] text-[#6b84a8]">{row.email || '—'}</div>
                      {row.phone && <div className="text-[10px] font-mono text-[#6b84a8]">{row.phone}</div>}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {row.watched === true ? (
                        <span className="text-emerald-700 font-medium">Watched</span>
                      ) : watchMins ? (
                        <span className="text-teal-700">{watchMins} min</span>
                      ) : (
                        <span className="text-[#8aa3c0]">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div>{row.booked_by_label || '—'}</div>
                      {row.recruiter_custom_field && (
                        <div className="text-[10px] text-[#6b84a8]">{row.recruiter_custom_field}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs max-w-[180px]">
                      <div className="truncate" title={row.webinar_title || ''}>{row.webinar_title || '—'}</div>
                      {row.broadcast_title && (
                        <div className="truncate text-[#6b84a8]" title={row.broadcast_title}>{row.broadcast_title}</div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${stageTone(row.hiring_stage)}`}>
                        {hiringStageLabel(row.hiring_stage)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[10px] text-[#6b84a8]">
                      {sourceTypeLabel(row.source_type)}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => void toggleExpanded(row)}
                        className="inline-flex items-center gap-1 text-[#005EB8] text-xs font-medium hover:underline"
                        disabled={!hasQuestionnaire && row.hiring_stage === 'attended_only'}
                      >
                        <ChevronDown size={14} className={expanded ? 'rotate-180' : ''} />
                        {hasQuestionnaire ? 'Answers' : '—'}
                      </button>
                    </td>
                  </tr>
                  {expanded && hasQuestionnaire && (
                    <tr className="border-t border-[#eef2f7] bg-[#f8fbff]">
                      <td colSpan={8} className="px-4 py-3">
                        {detailLoadingId === row.id && (
                          <p className="text-sm text-[#6b84a8]">Loading answers…</p>
                        )}
                        {!detailLoadingId && (
                          <div className="grid gap-2 md:grid-cols-2">
                            {answers.map((answer, idx) => (
                              <div key={`${row.id}-${idx}`} className="rounded-lg border border-[#dbe8f5] bg-white p-3">
                                <p className="text-[10px] uppercase tracking-wide text-[#6b84a8]">{answer.question}</p>
                                <p className="mt-1 text-sm text-[#0B1B34] whitespace-pre-wrap">{answer.answer}</p>
                              </div>
                            ))}
                            {!answers.length && (
                              <p className="text-sm text-[#6b84a8]">No parsed answers for this submission.</p>
                            )}
                          </div>
                        )}
                        {row.match_method && (
                          <p className="mt-2 text-[10px] text-[#8aa3c0]">Match: {row.match_method}</p>
                        )}
                        {row.pipeline_candidate_id && (
                          <Link
                            to={`/pipeline/call?candidateId=${row.pipeline_candidate_id}`}
                            className="mt-2 inline-block text-xs text-[#005EB8] hover:underline"
                          >
                            Open in call workspace
                          </Link>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-sm text-[#6f7b8d]">
                  No rows in this range. Click <strong>Import from cache</strong> to load historical attendance and questionnaires
                  from your WebinarGeek dashboard snapshot.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {hasMore && (
          <div className="border-t border-[#eef2f7] p-4 text-center">
            <Button variant="outline" onClick={() => void loadPage('more')} disabled={loadingMore}>
              {loadingMore ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default WebinarQuestionnairesPage;
