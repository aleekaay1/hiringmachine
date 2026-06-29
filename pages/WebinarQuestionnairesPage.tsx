import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ClipboardList, RefreshCw, Search } from 'lucide-react';
import { Button } from '../components/UI';
import { useStaffAuthenticated } from '../hooks/useStaffAuthenticated';
import { getCurrentUserProfile, type AppRole } from '../services/accessControl';
import { formatDateTimeCanadaEastern } from '../services/dateDisplay';
import {
  displayNameFromSubmission,
  fetchLatestQuestionnaireSyncRun,
  hiringStageLabel,
  listWebinarQuestionnaireSubmissions,
  syncWebinarGeekQuestionnaires,
  type WebinarQuestionnaireSubmission,
} from '../services/webinarGeekQuestionnaires';

function canAccessWebinarQuestionnaires(role: AppRole | null): boolean {
  return role === 'admin' || role === 'leadership' || role === 'hr' || role === 'webinar' || role === 'recruiter';
}

function stageTone(stage: string): string {
  if (stage === 'ready_for_followup') return 'bg-violet-100 text-violet-900';
  if (stage === 'questionnaire_submitted') return 'bg-emerald-100 text-emerald-900';
  return 'bg-slate-100 text-slate-700';
}

const WebinarQuestionnairesPage: React.FC = () => {
  const isAuthenticated = useStaffAuthenticated();
  const [role, setRole] = React.useState<AppRole | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [syncing, setSyncing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<WebinarQuestionnaireSubmission[]>([]);
  const [search, setSearch] = React.useState('');
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [lastSync, setLastSync] = React.useState<Awaited<ReturnType<typeof fetchLatestQuestionnaireSyncRun>>>(null);

  React.useEffect(() => {
    if (!isAuthenticated) return;
    void getCurrentUserProfile().then((profile) => setRole(profile?.role ?? null));
  }, [isAuthenticated]);

  const loadRows = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [submissions, syncRun] = await Promise.all([
        listWebinarQuestionnaireSubmissions({ search: search.trim() || undefined }),
        fetchLatestQuestionnaireSyncRun(),
      ]);
      setRows(submissions);
      setLastSync(syncRun);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [search]);

  React.useEffect(() => {
    if (!isAuthenticated || !canAccessWebinarQuestionnaires(role)) return;
    void loadRows();
  }, [isAuthenticated, role, loadRows]);

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    setMessage(null);
    try {
      const result = await syncWebinarGeekQuestionnaires();
      if (!result.ok) throw new Error(result.error);
      setMessage(
        `Synced ${result.data.upserted_count} submission(s) from WebinarGeek`
        + (result.data.api_sources.length ? ` (${result.data.api_sources.join(', ')})` : ''),
      );
      await loadRows();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
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
            Webinar questionnaires
          </h1>
          <p className="mt-1 text-sm text-[#5c7594] max-w-2xl">
            Post-webinar evaluation responses from WebinarGeek, matched to candidates and the recruiter who booked them.
            Use <strong>Sync from WebinarGeek</strong> to pull new submissions.
          </p>
          {lastSync && (
            <p className="mt-1 text-[11px] text-[#8aa3c0]">
              Last sync {formatDateTimeCanadaEastern(lastSync.synced_at)}
              {lastSync.error_message ? ` · Error: ${lastSync.error_message}` : ` · ${lastSync.upserted_count} saved`}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void loadRows()} disabled={loading || syncing}>
            <RefreshCw size={16} className={loading ? 'animate-spin mr-1.5' : 'mr-1.5'} />
            Refresh list
          </Button>
          <Button onClick={() => void handleSync()} disabled={syncing}>
            <RefreshCw size={16} className={syncing ? 'animate-spin mr-1.5' : 'mr-1.5'} />
            {syncing ? 'Syncing…' : 'Sync from WebinarGeek'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-[#d6deea] bg-white p-3">
          <p className="text-[10px] uppercase tracking-wide text-[#7a8ba1]">Submissions</p>
          <p className="text-xl font-bold text-[#0B1B34]">{rows.length}</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
          <p className="text-[10px] uppercase tracking-wide text-emerald-800">Matched to pipeline</p>
          <p className="text-xl font-bold text-emerald-900">{rows.filter((r) => r.pipeline_candidate_id).length}</p>
        </div>
        <div className="rounded-xl border border-[#d6deea] bg-white p-3">
          <p className="text-[10px] uppercase tracking-wide text-[#7a8ba1]">With booker</p>
          <p className="text-xl font-bold text-[#0B1B34]">{rows.filter((r) => r.booked_by_label).length}</p>
        </div>
        <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-3">
          <p className="text-[10px] uppercase tracking-wide text-violet-800">Ready for follow-up</p>
          <p className="text-xl font-bold text-violet-900">
            {rows.filter((r) => r.hiring_stage === 'ready_for_followup' || r.hiring_stage === 'questionnaire_submitted').length}
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-[#cde0f4] bg-white p-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a9ab0]" size={16} />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, phone, recruiter…"
            className="w-full rounded-xl border border-[#cfe3f9] py-2 pl-9 pr-3 text-sm"
          />
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
              <th className="px-3 py-2">Submitted</th>
              <th className="px-3 py-2">Candidate</th>
              <th className="px-3 py-2">Phone</th>
              <th className="px-3 py-2">Booked by</th>
              <th className="px-3 py-2">Webinar</th>
              <th className="px-3 py-2">Stage</th>
              <th className="px-3 py-2 w-24">Answers</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const expanded = expandedId === row.id;
              const answerCount = Array.isArray(row.answers) ? row.answers.length : 0;
              return (
                <React.Fragment key={row.id}>
                  <tr className="border-t border-[#eef2f7] hover:bg-[#fafcff] align-top">
                    <td className="px-3 py-2 whitespace-nowrap text-[#5c6b82] tabular-nums">
                      {row.submitted_at ? formatDateTimeCanadaEastern(row.submitted_at) : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-[#0B1B34]">{displayNameFromSubmission(row)}</div>
                      <div className="text-[11px] text-[#6b84a8]">{row.email || '—'}</div>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{row.phone || '—'}</td>
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
                        {hiringStageLabel(row.hiring_stage as 'questionnaire_submitted')}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => setExpandedId(expanded ? null : row.id)}
                        className="inline-flex items-center gap-1 text-[#005EB8] text-xs font-medium hover:underline"
                      >
                        <ChevronDown size={14} className={expanded ? 'rotate-180' : ''} />
                        {answerCount}
                      </button>
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="border-t border-[#eef2f7] bg-[#f8fbff]">
                      <td colSpan={7} className="px-4 py-3">
                        <div className="grid gap-2 md:grid-cols-2">
                          {(row.answers || []).map((answer, idx) => (
                            <div key={`${row.id}-${idx}`} className="rounded-lg border border-[#dbe8f5] bg-white p-3">
                              <p className="text-[10px] uppercase tracking-wide text-[#6b84a8]">{answer.question}</p>
                              <p className="mt-1 text-sm text-[#0B1B34] whitespace-pre-wrap">{answer.answer}</p>
                            </div>
                          ))}
                          {!answerCount && (
                            <p className="text-sm text-[#6b84a8]">No parsed answers for this submission.</p>
                          )}
                        </div>
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
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-[#6f7b8d]">
                  No questionnaire submissions yet. Click <strong>Sync from WebinarGeek</strong> to import responses.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default WebinarQuestionnairesPage;
