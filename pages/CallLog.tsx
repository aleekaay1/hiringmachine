import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStaffAuthenticated } from '../hooks/useStaffAuthenticated';
import { Button } from '../components/UI';
import { formatDateTimeCanadaEastern } from '../services/dateDisplay';
import {
  canAccessCallLog,
  getCurrentUserProfile,
  listAllUserProfiles,
  type UserProfile,
} from '../services/accessControl';
import CallRecordingPlayer from '../components/callLog/CallRecordingPlayer';
import '../components/callLog/call-recording-player.css';
import {
  formatCallLogCacheAge,
  readCallLogCache,
  writeCallLogCache,
} from '../services/callLogCache';
import {
  CALL_LOG_PAGE_SIZE,
  fetchCallLogPage,
  type CallLogPageQuery,
} from '../services/callLogQuery';
import {
  listPipelineCandidatesForCallLog,
  readCallRecordCandidateSnapshot,
  readCallRecordMeta,
  readCallRecordRecording,
  readCallRecordThreeCxContent,
  type PipelineCallRecord,
  type PipelineCandidate,
} from '../services/pipelineService';
import { PIPELINE_CALL_DISPOSITIONS } from '../services/pipelineCallDispositions';
import { fetchCallRecordingForDisposition } from '../services/threecxCallLogAdmin';
import { torontoYmdFromDate } from '../services/webinarGeekDates';
import { Headphones, PhoneCall, RefreshCw, Search } from 'lucide-react';

const SEARCH_DEBOUNCE_MS = 400;

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function resolveRecruiterLabel(
  row: PipelineCallRecord,
  staffById: Map<string, UserProfile>,
): string {
  const direct = row.recruiter_label?.trim();
  if (direct) return direct;
  const profile = row.recruiter_user_id ? staffById.get(row.recruiter_user_id) : null;
  if (profile?.full_name?.trim()) return profile.full_name.trim();
  if (profile?.email?.trim()) return profile.email.trim();
  if (row.recruiter_user_id) return row.recruiter_user_id.slice(0, 8);
  return '—';
}

function resolveCandidateDisplay(
  row: PipelineCallRecord,
  candidateById: Map<string, PipelineCandidate>,
): { fullName: string; email: string | null } {
  const candidate = candidateById.get(row.candidate_id);
  const snapshot = readCallRecordCandidateSnapshot(row);
  return {
    fullName: candidate?.full_name?.trim() || snapshot.fullName || '—',
    email: candidate?.email?.trim() || snapshot.email || null,
  };
}

function dispositionTone(disposition: string): string {
  const d = disposition.toLowerCase();
  if (d.includes('booked') || d.includes('interview') || d.includes('interested')) {
    return 'text-emerald-800 font-medium';
  }
  if (d.includes('callback')) return 'text-[#005EB8] font-medium';
  if (d.includes('no answer') || d.includes('voicemail') || d.includes('busy')) {
    return 'text-amber-800';
  }
  if (d.includes('wrong') || d.includes('not interested') || d.includes('do not call')) {
    return 'text-red-700';
  }
  return 'text-[#334155]';
}

function mergeCandidates(
  existing: PipelineCandidate[],
  incoming: PipelineCandidate[],
): PipelineCandidate[] {
  const map = new Map(existing.map((c) => [c.id, c]));
  for (const c of incoming) map.set(c.id, c);
  return [...map.values()];
}

function buildPageQuery(input: {
  dateFrom: string;
  dateTo: string;
  recruiterFilter: string;
  dispositionFilter: string;
  searchDebounced: string;
}): CallLogPageQuery {
  const today = torontoYmdFromDate();
  return {
    fromYmd: input.dateFrom || today,
    toYmd: input.dateTo || today,
    recruiterUserId: input.recruiterFilter,
    disposition: input.dispositionFilter,
    search: input.searchDebounced.trim() || null,
  };
}

function queriesMatch(a: CallLogPageQuery, b: CallLogPageQuery): boolean {
  return (
    a.fromYmd === b.fromYmd
    && a.toYmd === b.toYmd
    && (a.recruiterUserId || 'all') === (b.recruiterUserId || 'all')
    && (a.disposition || 'all') === (b.disposition || 'all')
    && (a.search || '') === (b.search || '')
  );
}

const CallLog: React.FC = () => {
  const isAuthenticated = useStaffAuthenticated();
  const [accessAllowed, setAccessAllowed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<PipelineCallRecord[]>([]);
  const [candidates, setCandidates] = useState<PipelineCandidate[]>([]);
  const [staffProfiles, setStaffProfiles] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [recruiterFilter, setRecruiterFilter] = useState<string>('all');
  const [dispositionFilter, setDispositionFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState(() => torontoYmdFromDate());
  const [dateTo, setDateTo] = useState(() => torontoYmdFromDate());
  const [refreshing, setRefreshing] = useState(false);
  const [cacheAge, setCacheAge] = useState<string | null>(null);
  const [hydratedFromCache, setHydratedFromCache] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);
  const [fetchingRecordingId, setFetchingRecordingId] = useState<string | null>(null);
  const [recordingErrors, setRecordingErrors] = useState<Record<string, string>>({});
  const [expandedRecordingIds, setExpandedRecordingIds] = useState<Set<string>>(new Set());
  const loadRequestIdRef = useRef(0);

  const pageQuery = useMemo(
    () => buildPageQuery({ dateFrom, dateTo, recruiterFilter, dispositionFilter, searchDebounced }),
    [dateFrom, dateTo, recruiterFilter, dispositionFilter, searchDebounced],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setSearchDebounced(search), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!isAuthenticated) {
      setAccessAllowed(null);
      return;
    }
    void getCurrentUserProfile().then((profile) => {
      setAccessAllowed(canAccessCallLog(profile?.role ?? null, profile?.email));
    });
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || !accessAllowed) return;
    void listAllUserProfiles()
      .then(setStaffProfiles)
      .catch(() => setStaffProfiles([]));
  }, [isAuthenticated, accessAllowed]);

  const loadPage = useCallback(async (input: {
    query: CallLogPageQuery;
    offset: number;
    append: boolean;
    staff: UserProfile[];
  }) => {
    const requestId = ++loadRequestIdRef.current;
    if (input.append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
      setLoadError(null);
    }

    try {
      const page = await fetchCallLogPage({
        ...input.query,
        offset: input.offset,
        limit: CALL_LOG_PAGE_SIZE,
      });
      if (requestId !== loadRequestIdRef.current) return;

      const candidateIds = [...new Set(page.rows.map((row) => row.candidate_id).filter(Boolean))];
      const candidateRows = candidateIds.length
        ? await listPipelineCandidatesForCallLog(candidateIds)
        : [];

      if (requestId !== loadRequestIdRef.current) return;

      setRows((prev) => (input.append ? [...prev, ...page.rows] : page.rows));
      setCandidates((prev) => (input.append ? mergeCandidates(prev, candidateRows) : candidateRows));
      setHasMore(page.hasMore);
      setNextOffset(page.nextOffset);
      setCacheAge('just now');
      setHydratedFromCache(false);

      if (!input.append) {
        writeCallLogCache({
          query: input.query,
          rows: page.rows,
          candidates: candidateRows,
          staffProfiles: input.staff,
          hasMore: page.hasMore,
          nextOffset: page.nextOffset,
        });
      }
    } catch (err) {
      if (requestId !== loadRequestIdRef.current) return;
      if (!input.append) {
        setRows([]);
        setCandidates([]);
        setHasMore(false);
        setNextOffset(0);
      }
      setLoadError(err instanceof Error ? err.message : 'Failed to load call log.');
    } finally {
      if (requestId === loadRequestIdRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !accessAllowed) return;

    const cached = readCallLogCache();
    if (cached && queriesMatch(cached.query, pageQuery) && cached.nextOffset <= CALL_LOG_PAGE_SIZE) {
      setRows(cached.rows);
      setCandidates(cached.candidates);
      setStaffProfiles((prev) => (prev.length ? prev : cached.staffProfiles));
      setHasMore(cached.hasMore);
      setNextOffset(cached.nextOffset);
      setCacheAge(formatCallLogCacheAge(cached.savedAt));
      setHydratedFromCache(true);
      return;
    }

    void loadPage({
      query: pageQuery,
      offset: 0,
      append: false,
      staff: staffProfiles,
    });
  }, [isAuthenticated, accessAllowed, pageQuery, loadPage]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setHydratedFromCache(false);
    try {
      await loadPage({
        query: pageQuery,
        offset: 0,
        append: false,
        staff: staffProfiles,
      });
    } finally {
      setRefreshing(false);
    }
  };

  const handleLoadMore = () => {
    if (loading || loadingMore || !hasMore) return;
    void loadPage({
      query: pageQuery,
      offset: nextOffset,
      append: true,
      staff: staffProfiles,
    });
  };

  const handleTodayPreset = () => {
    const today = torontoYmdFromDate();
    setDateFrom(today);
    setDateTo(today);
  };

  const handleLoadRecording = async (row: PipelineCallRecord) => {
    const existing = readCallRecordRecording(row);
    if (existing.recordingUrl) {
      setExpandedRecordingIds((prev) => new Set(prev).add(row.id));
      return;
    }

    setFetchingRecordingId(row.id);
    setRecordingErrors((prev) => {
      const next = { ...prev };
      delete next[row.id];
      return next;
    });

    try {
      const result = await fetchCallRecordingForDisposition(row.id);
      if (!result.matched || !result.recordingUrl) {
        setRecordingErrors((prev) => ({
          ...prev,
          [row.id]: result.message || 'No recording found for this call.',
        }));
        return;
      }

      setRows((prev) => prev.map((r) => {
        if (r.id !== row.id) return r;
        const meta = r.threecx_metadata && typeof r.threecx_metadata === 'object'
          ? { ...(r.threecx_metadata as Record<string, unknown>) }
          : {};
        return {
          ...r,
          recording_url: result.recordingUrl,
          duration_seconds: result.durationSeconds ?? r.duration_seconds,
          threecx_metadata: {
            ...meta,
            recording_url: result.recordingUrl,
            duration_seconds: result.durationSeconds,
            fetch_source: result.source,
          },
        };
      }));
      setExpandedRecordingIds((prev) => new Set(prev).add(row.id));
    } catch (err) {
      setRecordingErrors((prev) => ({
        ...prev,
        [row.id]: err instanceof Error ? err.message : 'Failed to load recording.',
      }));
    } finally {
      setFetchingRecordingId(null);
    }
  };

  const candidateById = useMemo(() => {
    const map = new Map<string, PipelineCandidate>();
    for (const c of candidates) map.set(c.id, c);
    return map;
  }, [candidates]);

  const staffById = useMemo(() => {
    const map = new Map<string, UserProfile>();
    for (const profile of staffProfiles) map.set(profile.user_id, profile);
    return map;
  }, [staffProfiles]);

  const recruiterOptions = useMemo(() => {
    return staffProfiles
      .map((profile) => ({
        id: profile.user_id,
        label: profile.full_name?.trim() || profile.email?.trim() || profile.user_id.slice(0, 8),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [staffProfiles]);

  const summary = useMemo(() => {
    const withRecording = rows.filter((r) => Boolean(readCallRecordRecording(r).recordingUrl)).length;
    const recruiters = new Set(rows.map((r) => r.recruiter_user_id).filter(Boolean));
    const booked = rows.filter((r) => r.disposition === 'Booked').length;
    return {
      total: rows.length,
      recruiters: recruiters.size,
      booked,
      withRecording,
    };
  }, [rows]);

  const dateRangeLabel = useMemo(() => {
    if (dateFrom === dateTo) return dateFrom;
    return `${dateFrom} → ${dateTo}`;
  }, [dateFrom, dateTo]);

  if (!isAuthenticated) {
    return (
      <div className="w-full p-6 text-sm text-[#5c6b82]">
        Sign in to view the call log.
      </div>
    );
  }

  if (accessAllowed === false) {
    return (
      <div className="w-full p-6">
        <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-sm px-4 py-3">
          You do not have access to the call log. This page is limited to admins, ali@globelife-paz.com, and
          hr.licensing@globelife-paz.com.
        </div>
      </div>
    );
  }

  if (accessAllowed === null) {
    return <div className="w-full p-6 text-sm text-[#5c6b82]">Checking access…</div>;
  }

  return (
    <div className="call-log-page text-[#1A2942]">
      <div className="flex flex-wrap items-center justify-between gap-3 shrink-0 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <PhoneCall size={20} className="text-[#005EB8] shrink-0" />
          <div>
            <h1 className="text-lg font-bold text-[#0B1B34]">Call log</h1>
            {cacheAge && (
              <p className="text-[11px] text-[#6b84a8]">
                {hydratedFromCache && !loading && !refreshing
                  ? `Showing saved data · ${cacheAge}`
                  : `Updated ${cacheAge}`}
              </p>
            )}
          </div>
        </div>
        <Button type="button" variant="secondary" onClick={() => void handleRefresh()} disabled={loading || refreshing}>
          <RefreshCw size={16} className={loading || refreshing ? 'animate-spin inline mr-1.5' : 'inline mr-1.5'} />
          {refreshing || loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 shrink-0 mb-3">
        <div className="rounded-xl border border-[#d6deea] bg-white p-3">
          <p className="text-[10px] uppercase tracking-wide text-[#7a8ba1]">Calls loaded</p>
          <p className="text-xl font-bold text-[#0B1B34]">{summary.total}</p>
        </div>
        <div className="rounded-xl border border-[#d6deea] bg-white p-3">
          <p className="text-[10px] uppercase tracking-wide text-[#7a8ba1]">Recruiters</p>
          <p className="text-xl font-bold text-[#0B1B34]">{summary.recruiters}</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
          <p className="text-[10px] uppercase tracking-wide text-emerald-800">Booked</p>
          <p className="text-xl font-bold text-emerald-900">{summary.booked}</p>
        </div>
        <div className="rounded-xl border border-[#d6deea] bg-white p-3">
          <p className="text-[10px] uppercase tracking-wide text-[#7a8ba1]">Recordings loaded</p>
          <p className="text-xl font-bold text-[#005EB8]">{summary.withRecording}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-[#d6deea] bg-white shadow-sm p-4 flex flex-col gap-3 shrink-0 mb-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a9ab0]" size={18} />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search all dispositions (name, phone, recruiter…)"
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-[#cfe3f9] text-sm text-[#0B1B34] focus:outline-none focus:ring-2 focus:ring-[#005EB8]/30"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select
            value={recruiterFilter}
            onChange={(e) => setRecruiterFilter(e.target.value)}
            className="rounded-lg border border-[#cfe3f9] px-2 py-1.5 text-sm min-w-[140px]"
          >
            <option value="all">All recruiters</option>
            {recruiterOptions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
          <select
            value={dispositionFilter}
            onChange={(e) => setDispositionFilter(e.target.value)}
            className="rounded-lg border border-[#cfe3f9] px-2 py-1.5 text-sm min-w-[140px]"
          >
            <option value="all">All dispositions</option>
            {PIPELINE_CALL_DISPOSITIONS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-[#5c6b82]">
            From
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded-lg border border-[#cfe3f9] px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex items-center gap-1.5 text-[#5c6b82]">
            To
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="rounded-lg border border-[#cfe3f9] px-2 py-1.5 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={handleTodayPreset}
            className="rounded-lg border border-[#cfe3f9] px-2.5 py-1.5 text-sm text-[#005EB8] hover:bg-[#f4f9ff]"
          >
            Today
          </button>
          <span className="text-[#5c6b82] shrink-0">
            {loading && !loadingMore
              ? 'Loading…'
              : (
                <>
                  <strong>{rows.length}</strong> call{rows.length === 1 ? '' : 's'} · {dateRangeLabel}
                  {searchDebounced.trim().length >= 2 ? ' · searching full call log' : ''}
                </>
              )}
          </span>
        </div>
      </div>

      {loadError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-sm px-4 py-3 mb-3">{loadError}</div>
      )}

      <div className="call-log-page__table-wrap">
          <table className="call-log-page__table">
            <thead className="sticky top-0 z-10 bg-[#f4f7fb] border-b border-[#d6deea]">
              <tr className="text-left text-[10px] uppercase tracking-wide text-[#6b7c93]">
                <th className="px-3 py-2 font-semibold col-time">Time</th>
                <th className="px-3 py-2 font-semibold col-recruiter">Recruiter</th>
                <th className="px-3 py-2 font-semibold col-candidate">Candidate</th>
                <th className="px-3 py-2 font-semibold col-phone">Phone</th>
                <th className="px-3 py-2 font-semibold col-disposition">Disposition</th>
                <th className="px-3 py-2 font-semibold col-booked">Booked</th>
                <th className="px-3 py-2 font-semibold col-duration">Duration</th>
                <th className="px-3 py-2 font-semibold col-recording">Recording</th>
                <th className="px-3 py-2 font-semibold col-comment">Comment</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const candidate = candidateById.get(row.candidate_id);
                const candidateDisplay = resolveCandidateDisplay(row, candidateById);
                const meta = readCallRecordMeta(row);
                const recording = readCallRecordRecording(row);
                const recruiterLabel = resolveRecruiterLabel(row, staffById);
                const phone = row.dialed_number || candidate?.phone || '—';
                const isFetching = fetchingRecordingId === row.id;
                const fetchError = recordingErrors[row.id];
                const showPlayer = Boolean(recording.recordingUrl) && expandedRecordingIds.has(row.id);
                const threeCxContent = readCallRecordThreeCxContent(row);

                return (
                  <React.Fragment key={row.id}>
                    <tr className="border-b border-[#eef2f7] hover:bg-[#fafcff] align-top">
                      <td className="px-3 py-2 whitespace-nowrap text-[#5c6b82] tabular-nums">
                        {formatDateTimeCanadaEastern(row.disposed_at)}
                      </td>
                      <td className="px-3 py-2 text-[#334155] max-w-[140px] truncate" title={recruiterLabel}>
                        {recruiterLabel}
                      </td>
                      <td className="px-3 py-2 text-[#0B1B34] font-medium max-w-[160px]">
                        <div className="truncate" title={candidateDisplay.fullName}>
                          {candidateDisplay.fullName}
                        </div>
                        {candidateDisplay.email && (
                          <div className="truncate text-[10px] text-[#5c6b82] font-normal" title={candidateDisplay.email}>
                            {candidateDisplay.email}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-[#334155] whitespace-nowrap">{phone}</td>
                      <td className={`px-3 py-2 whitespace-nowrap ${dispositionTone(row.disposition)}`}>
                        {row.disposition}
                      </td>
                      <td className="px-3 py-2 text-[#334155] whitespace-nowrap">{meta.bookedSubtype || '—'}</td>
                      <td className="px-3 py-2 text-[#5c6b82] whitespace-nowrap tabular-nums">
                        {formatDuration(recording.durationSeconds)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {recording.recordingUrl ? (
                          <button
                            type="button"
                            onClick={() => setExpandedRecordingIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(row.id)) next.delete(row.id);
                              else next.add(row.id);
                              return next;
                            })}
                            className="text-[#005EB8] hover:underline text-xs font-medium"
                          >
                            {showPlayer ? 'Hide' : 'Play'}
                          </button>
                        ) : (
                          <div className="call-recording-load-btn">
                            <button
                              type="button"
                              onClick={() => void handleLoadRecording(row)}
                              disabled={isFetching}
                              className="inline-flex items-center gap-1 rounded-md border border-[#cfe3f9] bg-white px-2 py-1 text-[11px] font-medium text-[#005EB8] hover:bg-[#f4f9ff] disabled:opacity-80"
                            >
                              <Headphones size={12} className={isFetching ? 'animate-pulse' : ''} />
                              {isFetching ? 'Loading…' : 'Load recording'}
                            </button>
                            {isFetching && (
                              <div className="call-recording-load-track" aria-hidden>
                                <div className="call-recording-load-bar" />
                              </div>
                            )}
                          </div>
                        )}
                        {fetchError && (
                          <p className="mt-1 text-[10px] text-red-700 max-w-[160px]">{fetchError}</p>
                        )}
                      </td>
                      <td className="px-3 py-2 text-[#5c6b82] max-w-[200px] truncate" title={row.comment || ''}>
                        {row.comment?.trim() || '—'}
                      </td>
                    </tr>
                    {showPlayer && recording.recordingUrl && (
                      <tr className="border-b border-[#eef2f7] call-log-page__player-row">
                        <td colSpan={9}>
                          <CallRecordingPlayer
                            callRecordId={row.id}
                            initialTranscript={threeCxContent.transcript}
                            initialSummary={threeCxContent.summary}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {!loading && rows.length === 0 && !loadError && (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-sm text-[#6f7b8d]">
                    No calls match your filters for this date range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
      </div>

      {(hasMore || loadingMore) && (
        <div className="flex justify-center py-4">
          <Button
            type="button"
            variant="secondary"
            onClick={handleLoadMore}
            disabled={loading || loadingMore || !hasMore}
          >
            {loadingMore ? 'Loading more…' : `Load more (${CALL_LOG_PAGE_SIZE} at a time)`}
          </Button>
        </div>
      )}
    </div>
  );
};

export default CallLog;
