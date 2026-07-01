import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ClipboardList, RefreshCw, Search, Trash2 } from 'lucide-react';
import { Button } from '../components/UI';
import { useStaffAuthenticated } from '../hooks/useStaffAuthenticated';
import { getCurrentUserProfile, type AppRole } from '../services/accessControl';
import { formatDateTimeCanadaEastern } from '../services/dateDisplay';
import {
  buildQuestionnaireAccessScope,
  canManageQuestionnaireRows,
  defaultQuestionnaireDateFrom,
  deleteWebinarQuestionnaireSubmission,
  displayNameFromSubmission,
  fetchQuestionnaireFollowUpBoard,
  fetchWebinarQuestionnaireDetail,
  fetchWebinarQuestionnairePage,
  fetchWebinarQuestionnaireSummary,
  hiringStageLabel,
  isQuestionnaireRecruiterRole,
  purgeLegacyQuestionnaireSubmissions,
  rematchWebinarQuestionnaires,
  submissionMatchesPageFilters,
  subscribeWebinarQuestionnaireSubmissions,
  type QuestionnaireAccessScope,
  type QuestionnaireFollowUpBoard,
  type QuestionnaireFollowUpRow,
  type QuestionnaireViewFilter,
  type WebinarQuestionnaireSubmission,
} from '../services/webinarGeekQuestionnaires';

const SEARCH_DEBOUNCE_MS = 300;

type PageTab = 'submissions' | 'awaiting';

function canAccessWebinarQuestionnaires(role: AppRole | null): boolean {
  return role === 'admin' || role === 'leadership' || role === 'hr' || role === 'webinar' || role === 'recruiter';
}

function stageTone(stage: string): string {
  if (stage === 'ready_for_followup') return 'bg-violet-100 text-violet-900';
  if (stage === 'questionnaire_submitted') return 'bg-emerald-100 text-emerald-900';
  return 'bg-slate-100 text-slate-700';
}

const VIEW_FILTERS: Array<{ id: QuestionnaireViewFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'needs_pipeline_match', label: 'Needs pipeline match' },
  { id: 'matched_pipeline', label: 'Matched to pipeline' },
];

const WebinarQuestionnairesPage: React.FC = () => {
  const isAuthenticated = useStaffAuthenticated();
  const [role, setRole] = React.useState<AppRole | null>(null);
  const [tab, setTab] = React.useState<PageTab>('submissions');
  const [loading, setLoading] = React.useState(true);
  const [summaryLoading, setSummaryLoading] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [purging, setPurging] = React.useState(false);
  const [rematching, setRematching] = React.useState(false);
  const [followUpLoading, setFollowUpLoading] = React.useState(false);
  const [liveConnected, setLiveConnected] = React.useState(false);
  const [liveNotice, setLiveNotice] = React.useState<string | null>(null);
  const [highlightIds, setHighlightIds] = React.useState<Set<string>>(() => new Set());
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<WebinarQuestionnaireSubmission[]>([]);
  const [hasMore, setHasMore] = React.useState(false);
  const [nextOffset, setNextOffset] = React.useState(0);
  const [search, setSearch] = React.useState('');
  const [debouncedSearch, setDebouncedSearch] = React.useState('');
  const [dateFrom, setDateFrom] = React.useState(defaultQuestionnaireDateFrom());
  const [dateTo, setDateTo] = React.useState('');
  const [viewFilter, setViewFilter] = React.useState<QuestionnaireViewFilter>('all');
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [expandedDetail, setExpandedDetail] = React.useState<WebinarQuestionnaireSubmission | null>(null);
  const [detailLoadingId, setDetailLoadingId] = React.useState<string | null>(null);
  const [summary, setSummary] = React.useState({ total: 0, withAnswers: 0, attendedOnly: 0, matchedPipeline: 0 });
  const [followUp, setFollowUp] = React.useState<QuestionnaireFollowUpBoard | null>(null);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [accessScope, setAccessScope] = React.useState<QuestionnaireAccessScope | null>(null);

  const canManage = canManageQuestionnaireRows(role);
  const isRecruiter = isQuestionnaireRecruiterRole(role);

  React.useEffect(() => {
    if (!isAuthenticated) return;
    void getCurrentUserProfile().then(async (profile) => {
      if (!profile) return;
      setRole(profile.role);
      const scope = await buildQuestionnaireAccessScope(profile);
      setAccessScope(scope);
      if (profile.role === 'recruiter') setTab('awaiting');
    });
  }, [isAuthenticated]);

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search]);

  const pageFilters = React.useMemo(() => ({
    search: debouncedSearch || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    sourceType: 'google_form',
    viewFilter,
  }), [debouncedSearch, dateFrom, dateTo, viewFilter]);

  const flashRow = React.useCallback((id: string, notice: string) => {
    setHighlightIds((prev) => new Set(prev).add(id));
    setLiveNotice(notice);
    window.setTimeout(() => {
      setHighlightIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 5000);
    window.setTimeout(() => setLiveNotice(null), 6000);
  }, []);

  const loadFollowUp = React.useCallback(async () => {
    if (!accessScope) return;
    setFollowUpLoading(true);
    try {
      const board = await fetchQuestionnaireFollowUpBoard(accessScope);
      setFollowUp(board);
    } catch {
      // WG cache may be empty
    } finally {
      setFollowUpLoading(false);
    }
  }, [accessScope]);

  const handleLiveInsert = React.useCallback((row: WebinarQuestionnaireSubmission) => {
    if (row.source_type !== 'google_form') return;
    if (!submissionMatchesPageFilters(row, pageFilters)) return;
    setRows((prev) => {
      if (prev.some((item) => item.id === row.id)) return prev;
      return [row, ...prev];
    });
    setSummary((prev) => ({
      ...prev,
      total: prev.total + 1,
      withAnswers: prev.withAnswers + (row.hiring_stage === 'questionnaire_submitted' ? 1 : 0),
      matchedPipeline: prev.matchedPipeline + (row.pipeline_candidate_id ? 1 : 0),
    }));
    flashRow(row.id, `New form submission: ${displayNameFromSubmission(row)}`);
    void loadFollowUp();
  }, [flashRow, loadFollowUp, pageFilters]);

  const handleLiveUpdate = React.useCallback((row: WebinarQuestionnaireSubmission) => {
    if (row.source_type !== 'google_form') return;
    setRows((prev) => {
      const idx = prev.findIndex((item) => item.id === row.id);
      const matches = submissionMatchesPageFilters(row, pageFilters);
      if (idx === -1) {
        if (!matches) return prev;
        return [row, ...prev];
      }
      if (!matches) return prev.filter((item) => item.id !== row.id);
      const next = [...prev];
      next[idx] = { ...next[idx], ...row };
      return next;
    });
    if (expandedId === row.id) {
      setExpandedDetail((prev) => (prev?.id === row.id ? { ...prev, ...row } : prev));
    }
  }, [expandedId, pageFilters]);

  const loadMeta = React.useCallback(async () => {
    setSummaryLoading(true);
    try {
      const stats = await fetchWebinarQuestionnaireSummary({
        dateFrom,
        dateTo: dateTo || undefined,
      });
      setSummary(stats);
    } catch {
      // optional
    } finally {
      setSummaryLoading(false);
    }
  }, [dateFrom, dateTo]);

  const loadPage = React.useCallback(async (mode: 'reset' | 'more' = 'reset') => {
    if (mode === 'more') setLoadingMore(true);
    else setLoading(true);
    setError(null);
    try {
      const offset = mode === 'more' ? nextOffset : 0;
      const page = await fetchWebinarQuestionnairePage({
        ...pageFilters,
        offset,
      });
      setRows((prev) => (mode === 'more' ? [...prev, ...page.rows] : page.rows));
      setHasMore(page.hasMore);
      setNextOffset(page.nextOffset);
      if (mode === 'reset') {
        void loadMeta();
        void loadFollowUp();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [loadFollowUp, loadMeta, nextOffset, pageFilters]);

  React.useEffect(() => {
    if (!isAuthenticated || !canAccessWebinarQuestionnaires(role) || !accessScope) return;
    if (isRecruiter || tab === 'awaiting') void loadFollowUp();
    else void loadPage('reset');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, role, accessScope, tab, debouncedSearch, dateFrom, dateTo, viewFilter, isRecruiter]);

  React.useEffect(() => {
    if (!isAuthenticated || !canAccessWebinarQuestionnaires(role) || isRecruiter) return;
    const unsubscribe = subscribeWebinarQuestionnaireSubmissions({
      onInsert: handleLiveInsert,
      onUpdate: handleLiveUpdate,
    });
    setLiveConnected(true);
    return () => {
      unsubscribe();
      setLiveConnected(false);
    };
  }, [isAuthenticated, role, isRecruiter, handleLiveInsert, handleLiveUpdate]);

  const handlePurgeLegacy = async () => {
    if (!canManage) return;
    if (!window.confirm('Remove all non–Google Form rows? This cannot be undone.')) return;
    setPurging(true);
    setError(null);
    setMessage(null);
    try {
      const result = await purgeLegacyQuestionnaireSubmissions();
      if (!result.ok) throw new Error(result.error);
      setMessage(result.data.message || `Removed ${result.data.deleted_count ?? 0} legacy row(s).`);
      await loadPage('reset');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPurging(false);
    }
  };

  const handleRematch = async () => {
    setRematching(true);
    setError(null);
    try {
      const result = await rematchWebinarQuestionnaires(90);
      if (!result.ok) throw new Error(result.error);
      setMessage(result.data.message || 'Pipeline links updated.');
      await loadPage('reset');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRematching(false);
    }
  };

  const handleDelete = async (row: WebinarQuestionnaireSubmission) => {
    if (!canManage) return;
    if (!window.confirm(`Delete submission for ${displayNameFromSubmission(row)}?`)) return;
    setDeletingId(row.id);
    setError(null);
    try {
      await deleteWebinarQuestionnaireSubmission(row.id);
      setRows((prev) => prev.filter((item) => item.id !== row.id));
      setMessage('Submission deleted.');
      void loadMeta();
      void loadFollowUp();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingId(null);
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

  const busy = loading || purging || rematching || followUpLoading;
  const board = followUp;

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
            {isRecruiter ? 'Questionnaire follow-up' : 'Google Form questionnaires'}
          </h1>
          <p className="mt-1 text-sm text-[#5c7594] max-w-2xl">
            {isRecruiter ? (
              <>
                Your booked webinar leads who still need the <strong>Applicant Questionnaire</strong>.
                Once they submit, leadership takes over — you will not see their answers here.
              </>
            ) : role === 'leadership' ? (
              <>
                Google Form submissions and follow-up for your team&apos;s booked webinars (hierarchy scope).
                Matched by email, phone, and name.
              </>
            ) : (
              <>
                Live feed from your <strong>Applicant Questionnaire</strong> Google Form (via Apps Script → Paz webhook).
                Matched to pipeline and booking recruiter by email, phone, and name.
              </>
            )}
          </p>
          {liveConnected && (
            <p className="mt-1 inline-flex items-center gap-1.5 text-[11px] text-emerald-700">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" aria-hidden />
              Live updates on
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => (tab === 'submissions' && !isRecruiter ? void loadPage('reset') : void loadFollowUp())} disabled={busy}>
            <RefreshCw size={16} className={busy ? 'animate-spin mr-1.5' : 'mr-1.5'} />
            Refresh
          </Button>
          {canManage && (
            <>
              <Button variant="outline" onClick={() => void handleRematch()} disabled={busy}>
                {rematching ? 'Matching…' : 'Re-match pipeline'}
              </Button>
              <Button variant="outline" onClick={() => void handlePurgeLegacy()} disabled={busy}>
                {purging ? 'Cleaning…' : 'Clear old imports'}
              </Button>
            </>
          )}
        </div>
      </div>

      <div className={`grid gap-3 ${isRecruiter ? 'grid-cols-2' : 'grid-cols-2 md:grid-cols-4'}`}>
        {!isRecruiter && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
            <p className="text-[10px] uppercase tracking-wide text-emerald-800">Form filled</p>
            <p className="text-xl font-bold text-emerald-900">
              {board?.filledCount ?? (summaryLoading ? '…' : summary.withAnswers)}
            </p>
          </div>
        )}
        <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3">
          <p className="text-[10px] uppercase tracking-wide text-amber-900">Awaiting form</p>
          <p className="text-xl font-bold text-amber-950">
            {board?.awaitingCount ?? '…'}
          </p>
          <p className="text-[10px] text-amber-800">
            {isRecruiter ? 'Your leads — call to remind' : 'Showed on WG, no form yet'}
          </p>
        </div>
        <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-3">
          <p className="text-[10px] uppercase tracking-wide text-rose-800">Urgent (&gt;2 days)</p>
          <p className="text-xl font-bold text-rose-900">{board?.urgentCount ?? '…'}</p>
        </div>
        {!isRecruiter && (
          <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-3">
            <p className="text-[10px] uppercase tracking-wide text-violet-800">Ready for follow-up</p>
            <p className="text-xl font-bold text-violet-900">{board?.readyForFollowUpCount ?? '…'}</p>
            <p className="text-[10px] text-violet-800">Filled + matched pipeline</p>
          </div>
        )}
      </div>

      <div className="flex gap-1 border-b border-[#dbe8f5]">
        {!isRecruiter && (
          <button
            type="button"
            onClick={() => setTab('submissions')}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px ${
              tab === 'submissions' ? 'border-[#005EB8] text-[#005EB8]' : 'border-transparent text-[#5c7594]'
            }`}
          >
            Form submissions
          </button>
        )}
        <button
          type="button"
          onClick={() => setTab('awaiting')}
          className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px ${
            tab === 'awaiting' ? 'border-[#005EB8] text-[#005EB8]' : 'border-transparent text-[#5c7594]'
          }`}
        >
          {isRecruiter ? 'My leads awaiting form' : 'Awaiting questionnaire'}
          {board && board.awaitingCount > 0 && (
            <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 text-[10px] text-amber-900">{board.awaitingCount}</span>
          )}
        </button>
      </div>

      {tab === 'submissions' && !isRecruiter && (
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
          <div className="grid gap-3 md:grid-cols-3">
            <div className="relative md:col-span-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a9ab0]" size={16} />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name, email, phone…"
                className="w-full rounded-xl border border-[#cfe3f9] py-2 pl-9 pr-3 text-sm"
              />
            </div>
            <label className="text-xs text-[#5c7594]">
              From
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="mt-1 w-full rounded-xl border border-[#cfe3f9] px-2 py-2 text-sm" />
            </label>
            <label className="text-xs text-[#5c7594]">
              To <span className="text-[#8aa3c0]">(optional)</span>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="mt-1 w-full rounded-xl border border-[#cfe3f9] px-2 py-2 text-sm" />
            </label>
          </div>
        </div>
      )}

      {liveNotice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-900">{liveNotice}</div>
      )}
      {message && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{message}</div>
      )}
      {error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 whitespace-pre-wrap">{error}</div>
      )}

      {tab === 'submissions' && !isRecruiter && (
        <div className="rounded-2xl border border-[#cde0f4] bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#f4f7fb] text-left text-[10px] uppercase tracking-wide text-[#6b7c93]">
              <tr>
                <th className="px-3 py-2">Submitted</th>
                <th className="px-3 py-2">Candidate</th>
                <th className="px-3 py-2">Booked by</th>
                <th className="px-3 py-2">Stage</th>
                <th className="px-3 py-2">Pipeline</th>
                {canManage && <th className="px-3 py-2 w-16" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const expanded = expandedId === row.id;
                const detail = expanded && expandedDetail?.id === row.id ? expandedDetail : null;
                const answers = detail?.answers || [];

                return (
                  <React.Fragment key={row.id}>
                    <tr className={`border-t border-[#eef2f7] hover:bg-[#fafcff] align-top ${
                      highlightIds.has(row.id) ? 'bg-emerald-50/80 ring-1 ring-inset ring-emerald-200' : ''
                    }`}>
                      <td className="px-3 py-2 whitespace-nowrap text-[#5c6b82] tabular-nums">
                        {row.submitted_at ? formatDateTimeCanadaEastern(row.submitted_at) : '—'}
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-[#0B1B34]">{displayNameFromSubmission(row)}</div>
                        <div className="text-[11px] text-[#6b84a8]">{row.email || '—'}</div>
                      </td>
                      <td className="px-3 py-2 text-xs">{row.booked_by_label || '—'}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${stageTone(row.hiring_stage)}`}>
                          {hiringStageLabel(row.hiring_stage)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {row.pipeline_candidate_id ? (
                          <Link to={`/pipeline/call?candidateId=${row.pipeline_candidate_id}`} className="text-[#005EB8] hover:underline">
                            Open lead
                          </Link>
                        ) : (
                          <span className="text-[#8aa3c0]">Not linked</span>
                        )}
                      </td>
                      {canManage && (
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => void handleDelete(row)}
                            disabled={deletingId === row.id}
                            className="text-rose-600 hover:text-rose-800 disabled:opacity-50"
                            title="Delete test row"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      )}
                    </tr>
                    <tr className="border-t border-[#eef2f7] bg-[#f8fbff]">
                      <td colSpan={canManage ? 6 : 5} className="px-3 py-1">
                        <button
                          type="button"
                          onClick={() => void toggleExpanded(row)}
                          className="inline-flex items-center gap-1 text-[#005EB8] text-xs font-medium hover:underline"
                        >
                          <ChevronDown size={14} className={expanded ? 'rotate-180' : ''} />
                          {expanded ? 'Hide answers' : 'Show answers'}
                        </button>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="border-t border-[#eef2f7] bg-[#f8fbff]">
                        <td colSpan={canManage ? 6 : 5} className="px-4 py-3">
                          {detailLoadingId === row.id && <p className="text-sm text-[#6b84a8]">Loading answers…</p>}
                          {!detailLoadingId && (
                            <div className="grid gap-2 md:grid-cols-2">
                              {answers.map((answer, idx) => (
                                <div key={`${row.id}-${idx}`} className="rounded-lg border border-[#dbe8f5] bg-white p-3">
                                  <p className="text-[10px] uppercase tracking-wide text-[#6b84a8]">{answer.question}</p>
                                  <p className="mt-1 text-sm text-[#0B1B34] whitespace-pre-wrap">{answer.answer}</p>
                                </div>
                              ))}
                              {!answers.length && <p className="text-sm text-[#6b84a8]">No answers stored.</p>}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={canManage ? 6 : 5} className="px-4 py-10 text-center text-sm text-[#6f7b8d]">
                    No Google Form submissions yet. Submit a test on the form — it should appear here within seconds.
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
      )}

      {(tab === 'awaiting' || isRecruiter) && (
        <div className="rounded-2xl border border-[#cde0f4] bg-white overflow-hidden">
          <p className="px-4 py-3 text-xs text-[#5c7594] border-b border-[#eef2f7]">
            {isRecruiter
              ? 'Your booked webinar leads. Red = showed 2+ days ago without the form — call to remind them to submit.'
              : 'WebinarGeek attendance vs Google Form for your scope. Red = showed 2+ days ago, still no form.'}
          </p>
          <table className="w-full text-sm">
            <thead className="bg-[#f4f7fb] text-left text-[10px] uppercase tracking-wide text-[#6b7c93]">
              <tr>
                <th className="px-3 py-2">Since show</th>
                <th className="px-3 py-2">Candidate</th>
                <th className="px-3 py-2">Webinar</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {(board?.rows || []).map((row: QuestionnaireFollowUpRow) => (
                <tr
                  key={row.key}
                  className={`border-t border-[#eef2f7] align-top ${
                    !row.filled && row.urgent ? 'bg-rose-50/60' : row.filled ? 'bg-emerald-50/30' : ''
                  }`}
                >
                  <td className={`px-3 py-2 font-semibold tabular-nums ${!row.filled && row.urgent ? 'text-rose-700' : 'text-[#5c6b82]'}`}>
                    {row.sinceLabel}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-[#0B1B34]">{row.name}</div>
                    <div className="text-[11px] text-[#6b84a8]">{row.email}</div>
                  </td>
                  <td className="px-3 py-2 text-xs">{row.webinarTitle || '—'}</td>
                  <td className="px-3 py-2">
                    {row.kind === 'upcoming_booked' ? (
                      <span className="inline-flex rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-900">
                        Upcoming webinar
                      </span>
                    ) : row.filled && !isRecruiter ? (
                      <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-900">
                        Form filled
                      </span>
                    ) : (
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        row.urgent ? 'bg-rose-100 text-rose-900' : 'bg-amber-100 text-amber-900'
                      }`}>
                        {row.urgent ? 'Call — overdue' : 'Awaiting form'}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {row.pipelineCandidateId ? (
                      <Link to={`/pipeline/call?candidateId=${row.pipelineCandidateId}`} className="text-[#005EB8] hover:underline">
                        {isRecruiter || !row.filled ? 'Call lead' : 'Final interview follow-up'}
                      </Link>
                    ) : (
                      <span className="text-[#8aa3c0]">{isRecruiter ? 'Call to remind' : '—'}</span>
                    )}
                  </td>
                </tr>
              ))}
              {!followUpLoading && !(board?.rows.length) && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-[#6f7b8d]">
                    {isRecruiter
                      ? 'No leads awaiting the questionnaire right now. Booked webinars will appear here until they submit the form.'
                      : 'No follow-up rows in your scope — refresh the WebinarGeek dashboard cache if attendance looks missing.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default WebinarQuestionnairesPage;
