import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  readCallRecordLiveSessionOutcome,
  readCallRecordMeta,
  readCallRecordRecording,
  type PipelineCallRecord,
  type PipelineCandidate,
} from '../services/pipelineService';
import {
  loadLiveSessionRegistrantsForMatching,
  matchLiveSessionForCallDisposition,
  type LiveSessionRegistrantRow,
} from '../services/liveSessionBookedOutcomes';
import { refreshLiveSessionsAndMatchOutcomes } from '../services/liveSessionOutcomeService';
import { PIPELINE_CALL_DISPOSITIONS } from '../services/pipelineCallDispositions';
import {
  fetchCallLogWebhookRows,
  syncThreeCxRecordings,
  type CallLogWebhookRow,
} from '../services/threecxCallLogAdmin';
import { PhoneCall, RefreshCw, Search } from 'lucide-react';

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
  const [liveRegistrants, setLiveRegistrants] = useState<LiveSessionRegistrantRow[]>([]);

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
      const [candidateRows, profiles, liveRegs] = await Promise.all([
        listPipelineCandidatesByIds(candidateIds).catch(() => [] as PipelineCandidate[]),
        listAllUserProfiles().catch(() => [] as UserProfile[]),
        loadLiveSessionRegistrantsForMatching().catch(() => [] as LiveSessionRegistrantRow[]),
      ]);
      setRows(callRows);
      setWebhookRows(webhooks);
      setCandidates(candidateRows);
      setStaffProfiles(profiles);
      setLiveRegistrants(liveRegs);
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
      const messages: string[] = [];
      const recordingResult = await syncThreeCxRecordings({ hoursBack: 24, incremental: true });
      if (recordingResult.message) messages.push(recordingResult.message);

      setSyncProgress({ pct: 45, label: 'Matching live sessions to Calendly/Zoom…' });
      const liveResult = await refreshLiveSessionsAndMatchOutcomes({ syncCoins: false, daysBack: 90 });
      if (liveResult.message) messages.push(liveResult.message);
      if (!liveResult.ok && liveResult.error) messages.push(`Live sessions: ${liveResult.error}`);

      setSyncProgress({ pct: 88, label: 'Loading call log…' });
      await load({ includeWebhooks: true });
      setSyncProgress({ pct: 100, label: 'Done' });
      if (messages.length) setStatusMessage(messages.join(' · '));
      if (recordingResult.warning && (recordingResult.updated ?? 0) === 0 && !liveResult.updated) {
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

  const resolveLiveOutcomeForRow = useCallback((row: PipelineCallRecord) => {
    const persisted = readCallRecordLiveSessionOutcome(row);
    if (!persisted.isLiveSessionBooked) return persisted;
    if (persisted.status && persisted.status !== 'pending') return persisted;

    const candidate = candidateById.get(row.candidate_id);
    const disposedMs = Date.parse(row.disposed_at || row.created_at);
    const match = matchLiveSessionForCallDisposition({
      email: candidate?.email || null,
      candidatePhone: candidate?.phone || null,
      dialedNumber: row.dialed_number,
      disposedAtMs: Number.isFinite(disposedMs) ? disposedMs : Date.now(),
      registrants: liveRegistrants,
    });
    return {
      isLiveSessionBooked: true,
      status: match.status,
      sessionDate: match.sessionDate,
      matchMethod: match.matchMethod,
    };
  }, [candidateById, liveRegistrants]);

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

      <div className="rounded-xl border border-[#d6deea] bg-white shadow-sm overflow-hidden">
        <div className="max-h-[calc(100vh-300px)] overflow-auto">
          <table className="w-full min-w-[960px] text-xs border-collapse">
            <thead className="sticky top-0 z-10 bg-[#f4f7fb] border-b border-[#d6deea]">
              <tr className="text-left text-[10px] uppercase tracking-wide text-[#6b7c93]">
                <th className="px-3 py-2 font-semibold whitespace-nowrap">Time</th>
                <th className="px-3 py-2 font-semibold whitespace-nowrap">Recruiter</th>
                <th className="px-3 py-2 font-semibold whitespace-nowrap">Candidate</th>
                <th className="px-3 py-2 font-semibold whitespace-nowrap">Phone</th>
                <th className="px-3 py-2 font-semibold whitespace-nowrap">Disposition</th>
                <th className="px-3 py-2 font-semibold whitespace-nowrap">Booked</th>
                <th className="px-3 py-2 font-semibold whitespace-nowrap">Live</th>
                <th className="px-3 py-2 font-semibold whitespace-nowrap">Duration</th>
                <th className="px-3 py-2 font-semibold whitespace-nowrap">Comment</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => {
                const row = entry.row;
                const wh = entry.webhook;
                const candidate = row
                  ? candidateById.get(row.candidate_id)
                  : (wh ? candidateByPhone.get(phoneLast10(wh.phoneNumber)) : null);
                const meta = row ? readCallRecordMeta(row) : { callbackAt: null, bookedSubtype: null };
                const liveOutcome = row ? resolveLiveOutcomeForRow(row) : null;
                const recording = row
                  ? readCallRecordRecording(row)
                  : { recordingUrl: wh?.recordingUrl || null, durationSeconds: wh?.durationSeconds ?? null };
                const recruiterLabel = row
                  ? resolveRecruiterLabel(row, staffById)
                  : (wh?.agentExtension
                    ? recruiterByExtension.get(wh.agentExtension)?.full_name
                      || recruiterByExtension.get(wh.agentExtension)?.email
                      || `Ext ${wh.agentExtension}`
                    : '—');
                const phone = row?.dialed_number || wh?.phoneNumber || candidate?.phone || '—';
                const disposition = row?.disposition || (entry.kind === 'inbound' ? 'Incoming' : '—');

                return (
                  <React.Fragment key={entry.key}>
                    <tr className="border-b border-[#eef2f7] hover:bg-[#fafcff] align-top">
                      <td className="px-3 py-2 whitespace-nowrap text-[#5c6b82] tabular-nums">
                        {formatDateTimeCanadaEastern(entry.at)}
                      </td>
                      <td className="px-3 py-2 text-[#334155] max-w-[140px] truncate" title={recruiterLabel}>
                        {recruiterLabel}
                      </td>
                      <td className="px-3 py-2 text-[#0B1B34] font-medium max-w-[160px]">
                        <div className="truncate" title={candidate?.full_name || ''}>
                          {candidate?.full_name || '—'}
                        </div>
                        {candidate?.email?.trim() && (
                          <div className="truncate text-[10px] text-[#5c6b82] font-normal" title={candidate.email}>
                            {candidate.email.trim()}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-[#334155] whitespace-nowrap">{phone}</td>
                      <td className={`px-3 py-2 whitespace-nowrap ${row ? dispositionTone(row.disposition) : 'text-violet-800'}`}>
                        {disposition}
                      </td>
                      <td className="px-3 py-2 text-[#334155] whitespace-nowrap">{meta.bookedSubtype || '—'}</td>
                      <td className={`px-3 py-2 whitespace-nowrap ${liveOutcome?.isLiveSessionBooked ? liveSessionOutcomeTone(liveOutcome.status) : 'text-[#8a9ab0]'}`}>
                        {liveOutcome?.isLiveSessionBooked ? liveSessionOutcomeLabel(liveOutcome.status) : '—'}
                      </td>
                      <td className="px-3 py-2 text-[#5c6b82] whitespace-nowrap tabular-nums">
                        {formatDuration(recording.durationSeconds)}
                      </td>
                      <td className="px-3 py-2 text-[#5c6b82] max-w-[200px] truncate" title={row?.comment || ''}>
                        {row?.comment?.trim() || '—'}
                      </td>
                    </tr>
                    {recording.recordingUrl && (
                      <tr className="border-b border-[#eef2f7] bg-[#fafcff]">
                        <td colSpan={9} className="px-3 py-2">
                          <CallRecordingPlayer url={recording.recordingUrl} durationHint={recording.durationSeconds} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
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
