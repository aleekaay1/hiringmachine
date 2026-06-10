import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStaffAuthenticated } from '../hooks/useStaffAuthenticated';
import { Button } from '../components/UI';
import { formatDateTimeCanadaEastern } from '../services/dateDisplay';
import {
  canAccessCallLog,
  getCurrentUserProfile,
  listAllUserProfiles,
  type UserProfile,
} from '../services/accessControl';
import {
  listPipelineCallRecords,
  listPipelineCandidates,
  readCallRecordMeta,
  readCallRecordRecording,
  type PipelineCallRecord,
  type PipelineCandidate,
} from '../services/pipelineService';
import { PIPELINE_CALL_DISPOSITIONS } from '../services/pipelineCallDispositions';
import { Download, ExternalLink, PhoneCall, RefreshCw, Search } from 'lucide-react';

function csvEscape(s: string): string {
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
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

function CallRecordingCell({ record }: { record: PipelineCallRecord }) {
  const { recordingUrl } = readCallRecordRecording(record);
  if (!recordingUrl) {
    return (
      <span className="text-[#8a9ab0] text-xs" title="Recording appears after 3CX CRM webhook sync">
        —
      </span>
    );
  }
  return (
    <div className="flex flex-col gap-1.5 min-w-[200px]">
      <audio controls preload="none" src={recordingUrl} className="h-8 w-full max-w-[220px]" />
      <a
        href={recordingUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs text-[#005EB8] hover:underline"
      >
        <ExternalLink size={12} />
        Open / download
      </a>
    </div>
  );
}

const CallLog: React.FC = () => {
  const isAuthenticated = useStaffAuthenticated();
  const [accessAllowed, setAccessAllowed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<PipelineCallRecord[]>([]);
  const [candidates, setCandidates] = useState<PipelineCandidate[]>([]);
  const [staffProfiles, setStaffProfiles] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [recruiterFilter, setRecruiterFilter] = useState<string>('all');
  const [dispositionFilter, setDispositionFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    if (!isAuthenticated) {
      setAccessAllowed(null);
      return;
    }
    void getCurrentUserProfile().then((profile) => {
      setAccessAllowed(canAccessCallLog(profile?.role ?? null, profile?.email));
    });
  }, [isAuthenticated]);

  const load = useCallback(async () => {
    setLoadError(null);
    setLoading(true);
    try {
      const [callRows, candidateRows, profiles] = await Promise.all([
        listPipelineCallRecords({ limit: 2500 }),
        listPipelineCandidates().catch(() => [] as PipelineCandidate[]),
        listAllUserProfiles().catch(() => [] as UserProfile[]),
      ]);
      setRows(callRows);
      setCandidates(candidateRows);
      setStaffProfiles(profiles);
    } catch (err) {
      setRows([]);
      setLoadError(err instanceof Error ? err.message : 'Failed to load call log.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated && accessAllowed) void load();
  }, [isAuthenticated, accessAllowed, load]);

  const candidateById = useMemo(() => {
    const map = new Map<string, PipelineCandidate>();
    for (const c of candidates) map.set(c.id, c);
    return map;
  }, [candidates]);

  const recruiterOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const row of rows) {
      if (!row.recruiter_user_id) continue;
      const label =
        row.recruiter_label?.trim() ||
        staffProfiles.find((p) => p.user_id === row.recruiter_user_id)?.full_name ||
        staffProfiles.find((p) => p.user_id === row.recruiter_user_id)?.email ||
        row.recruiter_user_id.slice(0, 8);
      byId.set(row.recruiter_user_id, label);
    }
    return [...byId.entries()]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rows, staffProfiles]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const fromMs = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null;
    const toMs = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : null;

    return rows.filter((row) => {
      if (recruiterFilter !== 'all' && row.recruiter_user_id !== recruiterFilter) return false;
      if (dispositionFilter !== 'all' && row.disposition !== dispositionFilter) return false;

      const disposedMs = new Date(row.disposed_at).getTime();
      if (fromMs !== null && disposedMs < fromMs) return false;
      if (toMs !== null && disposedMs > toMs) return false;

      if (!q) return true;
      const candidate = candidateById.get(row.candidate_id);
      const candidateName = candidate?.full_name || '';
      const candidatePhone = candidate?.phone || '';
      const hay = [
        candidateName,
        candidatePhone,
        row.dialed_number,
        row.disposition,
        row.comment || '',
        row.recruiter_label || '',
        row.candidate_id,
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search, recruiterFilter, dispositionFilter, dateFrom, dateTo, candidateById]);

  const summary = useMemo(() => {
    const withRecording = filtered.filter((r) => readCallRecordRecording(r).recordingUrl).length;
    const recruiters = new Set(filtered.map((r) => r.recruiter_user_id).filter(Boolean));
    const booked = filtered.filter((r) => r.disposition === 'Booked').length;
    return {
      total: filtered.length,
      recruiters: recruiters.size,
      booked,
      withRecording,
    };
  }, [filtered]);

  const downloadCsv = () => {
    const header = [
      'Disposed at (raw)',
      'Disposed at (display)',
      'Recruiter',
      'Candidate',
      'Candidate ID',
      'Dialed number',
      'Disposition',
      'Callback at',
      'Booked subtype',
      'Comment',
      'Duration (sec)',
      'Recording URL',
    ];
    const lines = [
      header.map(csvEscape).join(','),
      ...filtered.map((row) => {
        const candidate = candidateById.get(row.candidate_id);
        const meta = readCallRecordMeta(row);
        const recording = readCallRecordRecording(row);
        return [
          row.disposed_at,
          formatDateTimeCanadaEastern(row.disposed_at),
          row.recruiter_label || row.recruiter_user_id || '',
          candidate?.full_name || '',
          row.candidate_id,
          row.dialed_number,
          row.disposition,
          meta.callbackAt || '',
          meta.bookedSubtype || '',
          row.comment || '',
          recording.durationSeconds != null ? String(recording.durationSeconds) : '',
          recording.recordingUrl || '',
        ]
          .map((c) => csvEscape(String(c)))
          .join(',');
      }),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `call-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

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
    <div className="w-full p-5 lg:p-6 space-y-5 text-[#1A2942]">
      <div className="rounded-2xl border border-[#d6deea] bg-white shadow-sm px-5 py-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-xl bg-[#005EB8]/10 flex items-center justify-center shrink-0">
            <PhoneCall size={20} className="text-[#005EB8]" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-[#0B1B34] truncate">Call log</h1>
            <p className="text-sm text-[#5c6b82]">
              Pipeline dispositions from all recruiters — filter by person, recruiter, or date. Recordings appear when
              3CX sync is configured.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'animate-spin inline mr-1.5' : 'inline mr-1.5'} />
            Refresh
          </Button>
          <Button type="button" variant="secondary" onClick={downloadCsv} disabled={filtered.length === 0}>
            <Download size={16} className="inline mr-1.5" />
            Export CSV
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-[#d6deea] bg-white p-3">
          <p className="text-[10px] uppercase tracking-wide text-[#7a8ba1]">Calls shown</p>
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
          <p className="text-[10px] uppercase tracking-wide text-[#7a8ba1]">With recording</p>
          <p className="text-xl font-bold text-[#005EB8]">{summary.withRecording}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-[#d6deea] bg-white shadow-sm p-4 flex flex-col gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a9ab0]" size={18} />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search candidate name, phone, dialed number, disposition, comment…"
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-[#cfe3f9] text-sm text-[#0B1B34] focus:outline-none focus:ring-2 focus:ring-[#005EB8]/30"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select
            value={recruiterFilter}
            onChange={(e) => setRecruiterFilter(e.target.value)}
            className="rounded-lg border border-[#cfe3f9] px-2.5 py-1.5 text-sm"
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
            className="rounded-lg border border-[#cfe3f9] px-2.5 py-1.5 text-sm"
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
          <span className="text-[#5c6b82] shrink-0">
            Showing <strong>{filtered.length}</strong> of {rows.length} loaded
          </span>
        </div>
      </div>

      {loadError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-sm px-4 py-3">{loadError}</div>
      )}

      <div className="rounded-2xl border border-[#d6deea] bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto max-h-[calc(100vh-320px)] overflow-y-auto">
          <table className="min-w-[1400px] w-full text-left text-sm border-collapse">
            <thead className="sticky top-0 z-10 bg-[#eef2f7] text-[#0B1B34] text-xs font-semibold border-b border-[#d6deea]">
              <tr>
                <th className="px-3 py-2.5 border-r border-[#d6deea] whitespace-nowrap min-w-[160px]">When</th>
                <th className="px-3 py-2.5 border-r border-[#d6deea] whitespace-nowrap min-w-[140px]">Recruiter</th>
                <th className="px-3 py-2.5 border-r border-[#d6deea] min-w-[180px]">Candidate</th>
                <th className="px-3 py-2.5 border-r border-[#d6deea] whitespace-nowrap min-w-[130px]">Number</th>
                <th className="px-3 py-2.5 border-r border-[#d6deea] whitespace-nowrap min-w-[150px]">Disposition</th>
                <th className="px-3 py-2.5 border-r border-[#d6deea] min-w-[200px]">Details</th>
                <th className="px-3 py-2.5 border-r border-[#d6deea] whitespace-nowrap min-w-[80px]">Duration</th>
                <th className="px-3 py-2.5 whitespace-nowrap min-w-[220px]">Recording</th>
              </tr>
            </thead>
            <tbody className="text-[13px] text-[#1A2942]">
              {filtered.map((row) => {
                const candidate = candidateById.get(row.candidate_id);
                const meta = readCallRecordMeta(row);
                const recording = readCallRecordRecording(row);
                const details: string[] = [];
                if (row.comment?.trim()) details.push(row.comment.trim());
                if (meta.callbackAt) {
                  details.push(`Callback: ${formatDateTimeCanadaEastern(meta.callbackAt)}`);
                }
                if (meta.bookedSubtype) details.push(`Booked: ${meta.bookedSubtype}`);

                return (
                  <tr key={row.id} className="border-b border-[#e8edf4] hover:bg-[#f8fafc] even:bg-[#fafcff] align-top">
                    <td className="px-3 py-2 border-r border-[#eef2f7] whitespace-nowrap text-xs text-[#334155]">
                      {formatDateTimeCanadaEastern(row.disposed_at)}
                    </td>
                    <td className="px-3 py-2 border-r border-[#eef2f7] whitespace-nowrap text-xs">
                      {row.recruiter_label || '—'}
                    </td>
                    <td className="px-3 py-2 border-r border-[#eef2f7]">
                      <div className="font-medium text-[#0B1B34]">{candidate?.full_name || '—'}</div>
                      {candidate ? (
                        <Link
                          to={`/pipeline/call?candidateId=${encodeURIComponent(row.candidate_id)}`}
                          className="text-xs text-[#005EB8] hover:underline"
                        >
                          Open in call workspace
                        </Link>
                      ) : (
                        <span className="text-xs font-mono text-[#8a9ab0]">{row.candidate_id.slice(0, 8)}…</span>
                      )}
                    </td>
                    <td className="px-3 py-2 border-r border-[#eef2f7] whitespace-nowrap font-mono text-xs">
                      {row.dialed_number || candidate?.phone || '—'}
                    </td>
                    <td className={`px-3 py-2 border-r border-[#eef2f7] whitespace-nowrap text-xs ${dispositionTone(row.disposition)}`}>
                      {row.disposition}
                    </td>
                    <td className="px-3 py-2 border-r border-[#eef2f7] text-xs text-[#334155] max-w-[280px] whitespace-normal">
                      {details.length > 0 ? details.join(' · ') : '—'}
                    </td>
                    <td className="px-3 py-2 border-r border-[#eef2f7] whitespace-nowrap text-xs">
                      {formatDuration(recording.durationSeconds)}
                    </td>
                    <td className="px-3 py-2">
                      <CallRecordingCell record={row} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!loading && filtered.length === 0 && !loadError && (
            <div className="p-8 text-center text-sm text-[#6f7b8d]">No calls match your filters, or the log is empty.</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CallLog;
