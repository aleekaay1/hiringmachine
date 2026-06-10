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
import CallRecordingPlayer from '../components/callLog/CallRecordingPlayer';
import {
  listPipelineCallRecords,
  listPipelineCandidatesByIds,
  readCallRecordDirection,
  readCallRecordLiveSessionOutcome,
  readCallRecordMeta,
  readCallRecordRecording,
  type PipelineCallRecord,
  type PipelineCandidate,
} from '../services/pipelineService';
import { PIPELINE_CALL_DISPOSITIONS } from '../services/pipelineCallDispositions';
import {
  fetchCallLogWebhookRows,
  syncThreeCxRecordings,
  type CallLogWebhookRow,
} from '../services/threecxCallLogAdmin';
import { PhoneCall, PhoneIncoming, PhoneOutgoing, RefreshCw, Search } from 'lucide-react';

type CallLogEntry = {
  key: string;
  kind: 'disposition' | 'inbound';
  at: string;
  row: PipelineCallRecord | null;
  webhook: CallLogWebhookRow | null;
};

function phoneLast10(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

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

function liveSessionOutcomeLabel(status: string | null): string {
  if (!status) return '—';
  if (status === 'attended') return 'Showed';
  if (status === 'scheduled') return 'Scheduled';
  if (status === 'no_show') return 'No show';
  if (status === 'pending') return 'Pending match';
  return status;
}

function liveSessionOutcomeTone(status: string | null): string {
  if (status === 'attended') return 'text-emerald-800 font-medium';
  if (status === 'scheduled') return 'text-[#005EB8] font-medium';
  if (status === 'no_show') return 'text-red-700';
  if (status === 'pending') return 'text-amber-800';
  return 'text-[#8a9ab0]';
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

const CallLog: React.FC = () => {
  const isAuthenticated = useStaffAuthenticated();
  const [accessAllowed, setAccessAllowed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<PipelineCallRecord[]>([]);
  const [webhookRows, setWebhookRows] = useState<CallLogWebhookRow[]>([]);
  const [candidates, setCandidates] = useState<PipelineCandidate[]>([]);
  const [staffProfiles, setStaffProfiles] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [recruiterFilter, setRecruiterFilter] = useState<string>('all');
  const [dispositionFilter, setDispositionFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ pct: number; label: string } | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      setAccessAllowed(null);
      return;
    }
    void getCurrentUserProfile().then((profile) => {
      setAccessAllowed(canAccessCallLog(profile?.role ?? null, profile?.email));
    });
  }, [isAuthenticated]);

  const load = useCallback(async (options?: { includeWebhooks?: boolean }) => {
    setLoadError(null);
    setLoading(true);
    try {
      const callRows = await listPipelineCallRecords({ limit: 2500 });
      const webhooks = options?.includeWebhooks
        ? await fetchCallLogWebhookRows(48).catch(() => [] as CallLogWebhookRow[])
        : [];
      const candidateIds = [...new Set(callRows.map((row) => row.candidate_id).filter(Boolean))];
      const [candidateRows, profiles] = await Promise.all([
        listPipelineCandidatesByIds(candidateIds).catch(() => [] as PipelineCandidate[]),
        listAllUserProfiles().catch(() => [] as UserProfile[]),
      ]);
      setRows(callRows);
      setWebhookRows(webhooks);
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
    if (isAuthenticated && accessAllowed) {
      void load();
    }
  }, [isAuthenticated, accessAllowed, load]);

  const handleRefresh = async () => {
    setStatusError(null);
    setStatusMessage(null);
    setSyncing(true);
    setSyncProgress({ pct: 8, label: 'Matching recordings to dispositions…' });

    const tick = window.setInterval(() => {
      setSyncProgress((prev) => {
        if (!prev || prev.pct >= 82) return prev;
        return { ...prev, pct: Math.min(82, prev.pct + 3) };
      });
    }, 700);

    try {
      const recordingResult = await syncThreeCxRecordings({ hoursBack: 24, incremental: true });
      setSyncProgress({ pct: 88, label: 'Loading call log…' });
      await load({ includeWebhooks: true });
      setSyncProgress({ pct: 100, label: 'Done' });
      if (recordingResult.message) setStatusMessage(recordingResult.message);
      if (recordingResult.warning && (recordingResult.updated ?? 0) === 0) {
        setStatusError(recordingResult.warning);
      }
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Sync failed.');
    } finally {
      window.clearInterval(tick);
      setSyncing(false);
      window.setTimeout(() => setSyncProgress(null), 800);
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

  const recruiterByExtension = useMemo(() => {
    const map = new Map<string, UserProfile>();
    for (const profile of staffProfiles) {
      const ext = String(profile.extension || '').trim();
      if (ext) map.set(ext, profile);
    }
    return map;
  }, [staffProfiles]);

  const candidateByPhone = useMemo(() => {
    const map = new Map<string, PipelineCandidate>();
    for (const c of candidates) {
      const key = phoneLast10(c.phone || '');
      if (key.length >= 10) map.set(key, c);
    }
    return map;
  }, [candidates]);

  const allEntries = useMemo((): CallLogEntry[] => {
    const dispositionIds = new Set(rows.map((r) => r.id));
    const dispositionUrls = new Set(
      rows.map((r) => readCallRecordRecording(r).recordingUrl).filter(Boolean) as string[],
    );
    const list: CallLogEntry[] = rows.map((row) => ({
      key: row.id,
      kind: 'disposition',
      at: row.disposed_at,
      row,
      webhook: null,
    }));

    for (const wh of webhookRows) {
      const dir = String(wh.callDirection || '').toLowerCase();
      if (!dir.includes('in')) continue;
      if (!wh.recordingUrl) continue;
      if (wh.callRecordId && dispositionIds.has(wh.callRecordId)) continue;
      if (dispositionUrls.has(wh.recordingUrl)) continue;
      list.push({
        key: `inbound-${wh.id}`,
        kind: 'inbound',
        at: wh.receivedAt,
        row: null,
        webhook: wh,
      });
    }

    return list.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [rows, webhookRows]);

  const recruiterOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const row of rows) {
      if (!row.recruiter_user_id) continue;
      byId.set(row.recruiter_user_id, resolveRecruiterLabel(row, staffById));
    }
    return [...byId.entries()]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rows, staffById]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const fromMs = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null;
    const toMs = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : null;

    return allEntries.filter((entry) => {
      const row = entry.row;
      const wh = entry.webhook;
      const atMs = new Date(entry.at).getTime();
      if (fromMs !== null && atMs < fromMs) return false;
      if (toMs !== null && atMs > toMs) return false;

      if (entry.kind === 'inbound') {
        if (dispositionFilter !== 'all' && dispositionFilter !== 'Incoming call') return false;
        if (recruiterFilter !== 'all') {
          const ext = wh?.agentExtension || '';
          const profile = ext ? recruiterByExtension.get(ext) : null;
          if (profile?.user_id !== recruiterFilter) return false;
        }
      } else if (row) {
        if (recruiterFilter !== 'all' && row.recruiter_user_id !== recruiterFilter) return false;
        if (dispositionFilter !== 'all' && row.disposition !== dispositionFilter) return false;
      }

      if (!q) return true;
      const candidate = row ? candidateById.get(row.candidate_id) : null;
      const inboundPhone = wh?.phoneNumber || '';
      const inboundCandidate = candidateByPhone.get(phoneLast10(inboundPhone));
      const hay = [
        candidate?.full_name || inboundCandidate?.full_name || '',
        candidate?.email || inboundCandidate?.email || '',
        candidate?.phone || inboundPhone,
        row?.dialed_number || inboundPhone,
        row?.disposition || 'incoming call',
        row?.comment || '',
        row ? resolveRecruiterLabel(row, staffById) : '',
        wh?.agentExtension || '',
        entry.kind,
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [
    allEntries,
    search,
    recruiterFilter,
    dispositionFilter,
    dateFrom,
    dateTo,
    candidateById,
    candidateByPhone,
    staffById,
    recruiterByExtension,
  ]);

  const summary = useMemo(() => {
    const withRecording = filtered.filter((e) => {
      if (e.row) return Boolean(readCallRecordRecording(e.row).recordingUrl);
      return Boolean(e.webhook?.recordingUrl);
    }).length;
    const recruiters = new Set(
      filtered.map((e) => {
        if (e.row?.recruiter_user_id) return e.row.recruiter_user_id;
        const ext = e.webhook?.agentExtension || '';
        return ext ? recruiterByExtension.get(ext)?.user_id : null;
      }).filter(Boolean),
    );
    const booked = filtered.filter((e) => e.row?.disposition === 'Booked').length;
    const inbound = filtered.filter((e) => e.kind === 'inbound').length;
    return {
      total: filtered.length,
      recruiters: recruiters.size,
      booked,
      inbound,
      withRecording,
    };
  }, [filtered, recruiterByExtension]);

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
    <div className="w-full p-5 lg:p-6 space-y-4 text-[#1A2942]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <PhoneCall size={20} className="text-[#005EB8] shrink-0" />
          <h1 className="text-lg font-bold text-[#0B1B34]">Call log</h1>
        </div>
        <Button type="button" variant="secondary" onClick={() => void handleRefresh()} disabled={loading || syncing}>
          <RefreshCw size={16} className={loading || syncing ? 'animate-spin inline mr-1.5' : 'inline mr-1.5'} />
          {syncing ? 'Syncing…' : 'Refresh & sync'}
        </Button>
      </div>

      {syncProgress && (
        <div className="rounded-lg border border-[#cfe3f9] bg-white px-3 py-2.5">
          <div className="flex items-center justify-between text-xs text-[#334155] mb-1.5">
            <span>{syncProgress.label}</span>
            <span className="tabular-nums font-medium">{syncProgress.pct}%</span>
          </div>
          <div className="h-2 rounded-full bg-[#e8edf4] overflow-hidden">
            <div
              className="h-full rounded-full bg-[#005EB8] transition-all duration-500 ease-out"
              style={{ width: `${syncProgress.pct}%` }}
            />
          </div>
        </div>
      )}

      {statusMessage && (
        <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          {statusMessage}
        </p>
      )}
      {statusError && (
        <p className="text-xs text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{statusError}</p>
      )}

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
            placeholder="Search candidate name, email, phone, dialed number, disposition, comment…"
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
            <option value="Incoming call">Incoming calls</option>
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

      <div className="rounded-2xl border border-[#d6deea] bg-white shadow-sm p-3">
        <div className="max-h-[calc(100vh-320px)] overflow-y-auto space-y-2 pr-1">
          {filtered.map((entry) => {
            const row = entry.row;
            const wh = entry.webhook;
            const isInbound = entry.kind === 'inbound';
            const candidate = row
              ? candidateById.get(row.candidate_id)
              : (wh ? candidateByPhone.get(phoneLast10(wh.phoneNumber)) : null);
            const meta = row ? readCallRecordMeta(row) : { callbackAt: null, bookedSubtype: null };
            const liveOutcome = row ? readCallRecordLiveSessionOutcome(row) : null;
            const recording = row
              ? readCallRecordRecording(row)
              : { recordingUrl: wh?.recordingUrl || null, durationSeconds: wh?.durationSeconds ?? null };
            const direction = row ? readCallRecordDirection(row) : 'inbound';
            const recruiterLabel = row
              ? resolveRecruiterLabel(row, staffById)
              : (wh?.agentExtension
                ? recruiterByExtension.get(wh.agentExtension)?.full_name
                  || recruiterByExtension.get(wh.agentExtension)?.email
                  || `Ext ${wh.agentExtension}`
                : '—');
            const phone = row?.dialed_number || wh?.phoneNumber || candidate?.phone || '—';
            const details: string[] = [];
            if (row?.comment?.trim()) details.push(row.comment.trim());
            if (meta.callbackAt) details.push(`Callback: ${formatDateTimeCanadaEastern(meta.callbackAt)}`);
            if (meta.bookedSubtype) details.push(`Booked: ${meta.bookedSubtype}`);
            if (isInbound && candidate) details.push('Matched candidate by phone number');

            return (
              <article
                key={entry.key}
                className="rounded-lg border border-[#e8edf4] bg-white px-3 py-2.5 space-y-2"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <span className="text-[#5c6b82] shrink-0">{formatDateTimeCanadaEastern(entry.at)}</span>
                  {direction === 'inbound' ? (
                    <span className="inline-flex items-center gap-0.5 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-800">
                      <PhoneIncoming size={10} /> In
                    </span>
                  ) : direction === 'outbound' ? (
                    <span className="inline-flex items-center gap-0.5 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800">
                      <PhoneOutgoing size={10} /> Out
                    </span>
                  ) : null}
                  <span className="font-semibold text-[#0B1B34] truncate">{candidate?.full_name || 'Unknown'}</span>
                  <span className="font-mono text-[#334155]">{phone}</span>
                  <span className="text-[#5c6b82] truncate">{recruiterLabel}</span>
                  <span className={`ml-auto shrink-0 ${row ? dispositionTone(row.disposition) : 'text-violet-800 font-medium'}`}>
                    {row?.disposition || 'Incoming'}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-[#5c6b82]">
                  {candidate?.email?.trim() && (
                    <a href={`mailto:${candidate.email.trim()}`} className="text-[#005EB8] hover:underline truncate max-w-[220px]">
                      {candidate.email.trim()}
                    </a>
                  )}
                  <span>{formatDuration(recording.durationSeconds)}</span>
                  {liveOutcome?.isLiveSessionBooked && (
                    <span className={liveSessionOutcomeTone(liveOutcome.status)}>
                      Live {liveSessionOutcomeLabel(liveOutcome.status)}
                    </span>
                  )}
                  {row && candidate ? (
                    <Link
                      to={`/pipeline/call?candidateId=${encodeURIComponent(row.candidate_id)}`}
                      className="text-[#005EB8] hover:underline"
                    >
                      Open workspace
                    </Link>
                  ) : candidate ? (
                    <Link
                      to={`/pipeline?search=${encodeURIComponent(candidate.phone || phone)}`}
                      className="text-[#005EB8] hover:underline"
                    >
                      Find in pipeline
                    </Link>
                  ) : null}
                </div>

                {details.length > 0 && (
                  <p className="text-[11px] text-[#334155] line-clamp-2">{details.join(' · ')}</p>
                )}

                {recording.recordingUrl ? (
                  <CallRecordingPlayer url={recording.recordingUrl} durationHint={recording.durationSeconds} />
                ) : (
                  <p className="text-[11px] text-[#8a9ab0]">No recording — refresh after disposition is saved.</p>
                )}
              </article>
            );
          })}
          {!loading && filtered.length === 0 && !loadError && (
            <div className="p-8 text-center text-sm text-[#6f7b8d]">No calls match your filters, or the log is empty.</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CallLog;
