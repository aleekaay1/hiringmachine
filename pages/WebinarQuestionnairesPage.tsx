import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronDown, ClipboardList, Phone, RefreshCw, Search, Trash2 } from 'lucide-react';
import { Button } from '../components/UI';
import { useStaffAuthenticated } from '../hooks/useStaffAuthenticated';
import { getCurrentUserProfile, type AppRole } from '../services/accessControl';
import { formatDateTimeCanadaEastern } from '../services/dateDisplay';
import {
  bookedByLabelForSubmission,
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
  isQuestionnaireSubmissionUnread,
  loadOpenedQuestionnaireIds,
  lookupPipelineCandidateIdByContact,
  markQuestionnaireSubmissionOpened,
  purgeLegacyQuestionnaireSubmissions,
  questionnaireLeadOwnedByScope,
  rematchWebinarQuestionnaires,
  rematchWebinarQuestionnairesForContact,
  seedQuestionnaireOpenedIdsIfEmpty,
  submissionMatchesPageFilters,
  subscribeWebinarQuestionnaireSubmissions,
  watchMinutesFromSubmission,
  wgLinkedEmailForSubmission,
  type QuestionnaireAccessScope,
  type QuestionnaireFollowUpBoard,
  type QuestionnaireFollowUpRow,
  type QuestionnaireViewFilter,
  type WebinarQuestionnaireSubmission,
} from '../services/webinarGeekQuestionnaires';
import { pipelineCandidateAccessibleToViewer } from '../services/pipelineService';

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

function submissionCallable(row: WebinarQuestionnaireSubmission): boolean {
  return Boolean(row.email || row.phone || row.pipeline_candidate_id);
}

type QuestionnaireCallButtonProps = {
  row: WebinarQuestionnaireSubmission;
  submissionId?: string | null;
  pipelineCandidateId?: string | null;
  showForAwaiting?: boolean;
  accessScope?: QuestionnaireAccessScope | null;
  onLinked?: (submissionId: string, pipelineCandidateId: string) => void;
  className?: string;
};

const QuestionnaireCallButton: React.FC<QuestionnaireCallButtonProps> = ({
  row,
  submissionId,
  pipelineCandidateId,
  showForAwaiting = false,
  accessScope,
  onLinked,
  className = '',
}) => {
  const navigate = useNavigate();
  const [loading, setLoading] = React.useState(false);

  const canCall = showForAwaiting || submissionCallable(row);
  if (!canCall) return null;
  if (
    accessScope
    && !questionnaireLeadOwnedByScope(accessScope, row.booked_by_user_id, row.recruiter_custom_field)
  ) {
    return null;
  }

  const handleClick = async () => {
    setLoading(true);
    try {
      let candidateId = pipelineCandidateId || row.pipeline_candidate_id || null;
      if (!candidateId) {
        await rematchWebinarQuestionnairesForContact({
          email: row.email,
          phone: row.phone,
        });
        const detailId = submissionId || row.id;
        if (detailId) {
          const detail = await fetchWebinarQuestionnaireDetail(detailId);
          candidateId = detail?.pipeline_candidate_id ?? null;
          if (candidateId) onLinked?.(detailId, candidateId);
        }
        if (!candidateId) {
          candidateId = await lookupPipelineCandidateIdByContact(row.email, row.phone);
        }
      }
      if (!candidateId) return;
      const allowed = await pipelineCandidateAccessibleToViewer(candidateId);
      if (!allowed) return;
      navigate(`/pipeline/call?candidateId=${encodeURIComponent(candidateId)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={loading}
      title="Open call workspace"
      className={`inline-flex items-center gap-1 rounded-lg bg-[#0B1B34] px-2.5 py-1 text-[10px] font-semibold text-white shadow-sm transition hover:bg-[#16325f] disabled:opacity-60 ${className}`}
    >
      <Phone size={12} />
      {loading ? 'Opening…' : 'Call'}
    </button>
  );
};

const VIEW_FILTERS: Array<{ id: QuestionnaireViewFilter; label: string }> = [
  { id: 'new_unread', label: 'New (unopened)' },
  { id: 'wg_linked', label: 'WG linked only' },
  { id: 'all', label: 'All forms' },
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
  const [userId, setUserId] = React.useState<string | null>(null);
  const [openedIds, setOpenedIds] = React.useState<Set<string>>(() => new Set());

  const canManage = canManageQuestionnaireRows(role);
  const isRecruiter = isQuestionnaireRecruiterRole(role);

  React.useEffect(() => {
    if (!isAuthenticated) return;
    void getCurrentUserProfile().then(async (profile) => {
      if (!profile) return;
      setRole(profile.role);
      setUserId(profile.user_id);
      setOpenedIds(loadOpenedQuestionnaireIds(profile.user_id));
      const scope = await buildQuestionnaireAccessScope(profile);
      setAccessScope(scope);
      if (profile.role === 'recruiter') setTab('awaiting');
    });
  }, [isAuthenticated]);

  const filterOptions = React.useMemo(
    () => ({ openedIds: viewFilter === 'new_unread' ? openedIds : undefined }),
    [viewFilter, openedIds],
  );

  const unreadCount = React.useMemo(
    () => rows.filter((row) => isQuestionnaireSubmissionUnread(row.id, openedIds)).length,
    [rows, openedIds],
  );

  const markSubmissionOpened = React.useCallback((submissionId: string) => {
    if (!userId) return;
    setOpenedIds((prev) => markQuestionnaireSubmissionOpened(userId, submissionId, prev));
    if (viewFilter === 'new_unread') {
      setRows((prev) => prev.filter((row) => row.id !== submissionId));
    }
  }, [userId, viewFilter]);

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search]);

  const markSubmissionLinked = React.useCallback((submissionId: string, pipelineCandidateId: string) => {
    setRows((prev) => prev.map((row) => (
      row.id === submissionId
        ? { ...row, pipeline_candidate_id: pipelineCandidateId, hiring_stage: 'ready_for_followup' }
        : row
    )));
  }, []);

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
    if (accessScope && !questionnaireLeadOwnedByScope(accessScope, row.booked_by_user_id, row.recruiter_custom_field)) {
      return;
    }
    if (pageFilters.dateFrom && row.submitted_at && row.submitted_at < `${pageFilters.dateFrom}T00:00:00.000Z`) {
      return;
    }
    if (pageFilters.dateTo && row.submitted_at && row.submitted_at > `${pageFilters.dateTo}T23:59:59.999Z`) {
      return;
    }
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
    if (!row.pipeline_candidate_id && (row.email || row.phone)) {
      void rematchWebinarQuestionnairesForContact({
        email: row.email,
        phone: row.phone,
      }).then((result) => {
        if (result.ok) {
          void fetchWebinarQuestionnaireDetail(row.id).then((detail) => {
            if (!detail?.pipeline_candidate_id) return;
            setRows((prev) => prev.map((item) => (
              item.id === row.id ? { ...item, pipeline_candidate_id: detail.pipeline_candidate_id } : item
            )));
          });
        }
      });
    }
  }, [accessScope, flashRow, loadFollowUp, pageFilters.dateFrom, pageFilters.dateTo]);

  const handleLiveUpdate = React.useCallback((row: WebinarQuestionnaireSubmission) => {
    if (row.source_type !== 'google_form') return;
    if (accessScope && !questionnaireLeadOwnedByScope(accessScope, row.booked_by_user_id, row.recruiter_custom_field)) {
      return;
    }
    setRows((prev) => {
      const idx = prev.findIndex((item) => item.id === row.id);
      if (idx !== -1) {
        const next = [...prev];
        next[idx] = { ...next[idx], ...row };
        return next;
      }
      const matches = submissionMatchesPageFilters(row, pageFilters, filterOptions);
      if (!matches) return prev;
      return [row, ...prev];
    });
    if (expandedId === row.id) {
      setExpandedDetail((prev) => (prev?.id === row.id ? { ...prev, ...row } : prev));
    }
  }, [accessScope, expandedId, pageFilters, filterOptions]);

  const linkPipelineProfilesForRows = React.useCallback(async (rowsToLink: WebinarQuestionnaireSubmission[]) => {
    const unmatched = rowsToLink.filter((row) => !row.pipeline_candidate_id && (row.email || row.phone));
    if (!unmatched.length) return;

    await Promise.all(
      unmatched.slice(0, 8).map(async (row) => {
        const result = await rematchWebinarQuestionnairesForContact({
          email: row.email,
          phone: row.phone,
        });
        if (!result.ok) return;
        const detail = await fetchWebinarQuestionnaireDetail(row.id);
        if (!detail?.pipeline_candidate_id) return;
        setRows((prev) => prev.map((item) => (
          item.id === row.id ? { ...item, pipeline_candidate_id: detail.pipeline_candidate_id } : item
        )));
      }),
    );
  }, [accessScope, filterOptions, pageFilters, viewFilter]);

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
      if (mode === 'reset' && userId) {
        setOpenedIds(seedQuestionnaireOpenedIdsIfEmpty(userId, page.rows.map((row) => row.id)));
      }
      const visible = page.rows.filter((row) => {
        if (accessScope && !questionnaireLeadOwnedByScope(accessScope, row.booked_by_user_id, row.recruiter_custom_field)) {
          return false;
        }
        if (viewFilter === 'new_unread') {
          return submissionMatchesPageFilters(row, pageFilters, filterOptions);
        }
        if (pageFilters.sourceType && pageFilters.sourceType !== 'all' && row.source_type !== pageFilters.sourceType) {
          return false;
        }
        return true;
      });
      setRows((prev) => (mode === 'more' ? [...prev, ...visible] : visible));
      setHasMore(page.hasMore);
      setNextOffset(page.nextOffset);
      if (mode === 'reset') {
        void loadMeta();
        void linkPipelineProfilesForRows(visible);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [accessScope, linkPipelineProfilesForRows, loadMeta, nextOffset, pageFilters, filterOptions, userId, viewFilter]);

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
    return () => {
      unsubscribe();
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
      markSubmissionOpened(row.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDetailLoadingId(null);
    }
  };

  if (!isAuthenticated) {
    return <div className="p-6 text-sm text-slate-600">Sign in to view Webinar Questionnaire.</div>;
  }

  if (role && !canAccessWebinarQuestionnaires(role)) {
    return (
      <div className="p-6">
        <p className="text-sm text-slate-600">You do not have access to Webinar Questionnaire.</p>
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
            Webinar Questionnaire
          </p>
          <h1 className="text-2xl font-bold text-[#0B1B34] flex items-center gap-2">
            <ClipboardList size={24} className="text-[#005EB8]" />
            Webinar Questionnaire
          </h1>
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

      <div className={`grid gap-3 ${isRecruiter ? 'grid-cols-2' : 'grid-cols-2 md:grid-cols-5'}`}>
        {!isRecruiter && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
            <p className="text-[10px] uppercase tracking-wide text-emerald-800">Form filled</p>
            <p className="text-xl font-bold text-emerald-900">
              {board?.filledCount ?? (summaryLoading ? '…' : summary.withAnswers)}
            </p>
          </div>
        )}
        {!isRecruiter && (
          <div className="rounded-xl border border-sky-200 bg-sky-50/50 p-3">
            <p className="text-[10px] uppercase tracking-wide text-sky-800">New unopened</p>
            <p className="text-xl font-bold text-sky-900">{unreadCount}</p>
          </div>
        )}
        <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3">
          <p className="text-[10px] uppercase tracking-wide text-amber-900">Awaiting form</p>
          <p className="text-xl font-bold text-amber-950">
            {board?.awaitingCount ?? (tab === 'awaiting' || followUpLoading ? '…' : '—')}
          </p>
        </div>
        <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-3">
          <p className="text-[10px] uppercase tracking-wide text-rose-800">Urgent (&gt;2 days)</p>
          <p className="text-xl font-bold text-rose-900">
            {board?.urgentCount ?? (tab === 'awaiting' || followUpLoading ? '…' : '—')}
          </p>
        </div>
        {!isRecruiter && (
          <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-3">
            <p className="text-[10px] uppercase tracking-wide text-violet-800">Ready for follow-up</p>
            <p className="text-xl font-bold text-violet-900">
              {board?.readyForFollowUpCount ?? (tab === 'awaiting' || followUpLoading ? '…' : '—')}
            </p>
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
            Submissions
            {unreadCount > 0 && (
              <span className="ml-1.5 rounded-full bg-sky-100 px-1.5 text-[10px] font-bold text-sky-900">{unreadCount}</span>
            )}
          </button>
        )}
        <button
          type="button"
          onClick={() => setTab('awaiting')}
          className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px ${
            tab === 'awaiting' ? 'border-[#005EB8] text-[#005EB8]' : 'border-transparent text-[#5c7594]'
          }`}
        >
          Awaiting
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
              To
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
                <th className="px-3 py-2">WebinarGeek</th>
                <th className="px-3 py-2">Booked by</th>
                <th className="px-3 py-2">Stage</th>
                <th className="px-3 py-2 w-20">Call</th>
                {canManage && <th className="px-3 py-2 w-16" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const expanded = expandedId === row.id;
                const detail = expanded && expandedDetail?.id === row.id ? expandedDetail : null;
                const answers = detail?.answers || [];
                const wgEmail = wgLinkedEmailForSubmission(row);
                const formEmail = String(row.email || '').trim().toLowerCase() || null;
                const watchMin = watchMinutesFromSubmission(row);
                const bookedBy = bookedByLabelForSubmission(row);
                const isUnread = isQuestionnaireSubmissionUnread(row.id, openedIds);
                const isLiveFlash = highlightIds.has(row.id);

                return (
                  <React.Fragment key={row.id}>
                    <tr className={`border-t border-[#eef2f7] hover:bg-[#fafcff] align-top ${
                      isLiveFlash ? 'bg-emerald-50/80 ring-1 ring-inset ring-emerald-200' : ''
                    } ${isUnread ? 'bg-sky-50/90 ring-1 ring-inset ring-sky-300' : ''}`}>
                      <td className="px-3 py-2 whitespace-nowrap text-[#5c6b82] tabular-nums">
                        {row.submitted_at ? formatDateTimeCanadaEastern(row.submitted_at) : '—'}
                        {isUnread && (
                          <span className="mt-1 block w-fit rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide bg-sky-200 text-sky-950">
                            New
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-[#0B1B34]">{displayNameFromSubmission(row)}</div>
                        <div className="text-[11px] text-[#6b84a8]">Form: {formEmail || '—'}</div>
                        {row.phone && <div className="text-[11px] text-[#6b84a8]">{row.phone}</div>}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <div className="text-[#0B1B34]">{row.webinar_title || row.broadcast_title || '—'}</div>
                        {wgEmail && wgEmail !== formEmail && (
                          <div className="text-[10px] text-[#6b84a8]">WG email: {wgEmail}</div>
                        )}
                        <div className="text-[10px] text-[#6b84a8]">
                          {row.watched === true ? `Watched${watchMin ? ` · ${watchMin}m` : ''}` : row.watched === false ? 'Registered' : watchMin ? `${watchMin}m` : '—'}
                        </div>
                        {row.match_method && (
                          <div className="text-[9px] text-[#8aa3c0] mt-0.5">{row.match_method}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">{bookedBy || '—'}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${stageTone(row.hiring_stage)}`}>
                          {hiringStageLabel(row.hiring_stage)}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {submissionCallable(row) ? (
                          <QuestionnaireCallButton row={row} accessScope={accessScope} onLinked={markSubmissionLinked} />
                        ) : (
                          <span className="text-[10px] text-[#8aa3c0]">No contact</span>
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
                    <tr className={`border-t border-[#eef2f7] ${isUnread ? 'bg-sky-50/60' : 'bg-[#f8fbff]'}`}>
                      <td colSpan={canManage ? 7 : 6} className="px-3 py-1">
                        <button
                          type="button"
                          onClick={() => void toggleExpanded(row)}
                          className={`inline-flex items-center gap-1 text-xs font-medium hover:underline ${
                            isUnread ? 'text-sky-800' : 'text-[#005EB8]'
                          }`}
                        >
                          <ChevronDown size={14} className={expanded ? 'rotate-180' : ''} />
                          {expanded ? 'Hide answers' : isUnread ? 'Show answers (new)' : 'Show answers'}
                        </button>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className={`border-t border-[#eef2f7] ${isUnread ? 'bg-sky-50/60' : 'bg-[#f8fbff]'}`}>
                        <td colSpan={canManage ? 7 : 6} className="px-4 py-3">
                          {detailLoadingId === row.id && <p className="text-sm text-[#6b84a8]">Loading answers…</p>}
                          {!detailLoadingId && (
                            <div className="grid gap-2 md:grid-cols-2">
                              {answers.map((answer, idx) => (
                                <div
                                  key={`${row.id}-${idx}`}
                                  className={`rounded-lg border bg-white p-3 ${
                                    isUnread ? 'border-sky-300 ring-1 ring-sky-100' : 'border-[#dbe8f5]'
                                  }`}
                                >
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
                  <td colSpan={canManage ? 7 : 6} className="px-4 py-10 text-center text-sm text-[#6f7b8d]">
                    {viewFilter === 'new_unread'
                      ? 'No unopened submissions.'
                      : viewFilter === 'wg_linked'
                      ? 'No linked submissions.'
                      : 'No submissions yet.'}
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
                  <td className="px-3 py-2">
                    {(row.pipelineCandidateId || row.email) ? (
                      <QuestionnaireCallButton
                        showForAwaiting
                        accessScope={accessScope}
                        submissionId={row.submissionId}
                        pipelineCandidateId={row.pipelineCandidateId}
                        row={{
                          id: row.submissionId || row.key,
                          pipeline_candidate_id: row.pipelineCandidateId,
                          booked_by_user_id: row.bookedByUserId,
                          recruiter_custom_field: row.recruiterCustomField,
                          hiring_stage: row.filled ? 'ready_for_followup' : 'questionnaire_submitted',
                          email: row.email,
                          phone: null,
                        } as WebinarQuestionnaireSubmission}
                        onLinked={(linkedSubmissionId, linkedPipelineId) => {
                          setFollowUp((prev) => {
                            if (!prev) return prev;
                            return {
                              ...prev,
                              rows: prev.rows.map((entry) => (
                                entry.key === row.key || entry.submissionId === linkedSubmissionId
                                  ? { ...entry, pipelineCandidateId: linkedPipelineId, submissionId: linkedSubmissionId }
                                  : entry
                              )),
                            };
                          });
                        }}
                      />
                    ) : (
                      <span className="text-[#8aa3c0]">{isRecruiter ? 'Call to remind' : '—'}</span>
                    )}
                  </td>
                </tr>
              ))}
              {!followUpLoading && !(board?.rows.length) && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-[#6f7b8d]">
                    No awaiting leads.
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
