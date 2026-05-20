import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import { Button } from '../components/UI';
import { supabase } from '../services/supabaseClient';
import { formatDateTimeCanadaEastern } from '../services/dateDisplay';
import { getCandidates } from '../services/storageService';
import { sendEmail } from '../services/emailService';
import { EMAIL_TEMPLATES, mergeTemplate } from '../services/emailTemplates';
import { getSiteOriginForEmail } from '../services/emailSignature';
import { Candidate, type PipelineStage, normalizePipelineStage } from '../types';
import { Download, Mail, RefreshCw, Search } from 'lucide-react';

type EmailSendLogRow = {
  id: string;
  created_at: string;
  source: string;
  trigger_label: string | null;
  from_email: string;
  to_email: string;
  cc_email: string | null;
  subject: string;
  candidate_id: string | null;
  sent_by_user_id: string | null;
  status: string;
  error_message: string | null;
};

type WednesdaySendStatus = 'sent' | 'failed';

type WednesdaySendResultRow = {
  candidateId: string;
  candidateName: string;
  to: string;
  status: WednesdaySendStatus;
  error?: string;
};

type WednesdaySendResult = {
  attempted: number;
  sent: number;
  failed: number;
  completedAt: string;
  rows: WednesdaySendResultRow[];
};

const WEDNESDAY_MANUAL_TRIGGER = 'manual_wednesday_live_overview';
const EMAIL_SEND_LOGS_PAGE_SIZE = 1000;

function csvEscape(s: string): string {
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function candidateName(candidate: Candidate): string {
  const full = `${candidate.firstName || ''} ${candidate.lastName || ''}`.trim();
  return full || '(No name)';
}

function hasLeadershipFormSubmitted(candidate: Candidate, stage: PipelineStage): boolean {
  if (candidate.status === 'assessment_complete' || Boolean(candidate.assessment)) return true;
  return (
    stage === 'Leadership form submitted, awaiting evaluation' ||
    stage === 'Evaluation Done' ||
    stage === 'Interview scheduled' ||
    stage === 'Final decision'
  );
}

function isWednesdayLiveOverviewEligible(candidate: Candidate): boolean {
  const stage = normalizePipelineStage(candidate.adminData?.pipelineStage);
  const hasCheckInSignal = candidate.status === 'interview_complete' || Boolean(candidate.applicantQuestionnaire);
  const checkedInOnly = stage === 'Checked In';
  return hasCheckInSignal && checkedInOnly && !hasLeadershipFormSubmitted(candidate, stage);
}

function getCurrentEasternDateLabel(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(now);
}

function buildWednesdayManualMergeExtras(now: Date = new Date()): Record<string, string> {
  const sessionDate = getCurrentEasternDateLabel(now);
  const sessionTime = '11:30 AM Eastern Time (ET)';
  return {
    '{{Date}}': sessionDate,
    '{{sessionDate}}': sessionDate,
    '{{Time}}': sessionTime,
    '{{sessionTime}}': sessionTime,
  };
}

const EmailLog: React.FC = () => {
  const stage2Template = useMemo(
    () => EMAIL_TEMPLATES.find((t) => t.id === 'stage2_post_checkin') ?? null,
    []
  );
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [email, setEmail] = useState('admin@globelife-paz.com');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [rows, setRows] = useState<EmailSendLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [candidateRows, setCandidateRows] = useState<Candidate[]>([]);
  const [eligibleLoading, setEligibleLoading] = useState(false);
  const [eligibleError, setEligibleError] = useState<string | null>(null);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<string>>(new Set());
  const [campaignSending, setCampaignSending] = useState(false);
  const [campaignProgress, setCampaignProgress] = useState<{ current: number; total: number } | null>(null);
  const [campaignError, setCampaignError] = useState<string | null>(null);
  const [campaignResult, setCampaignResult] = useState<WednesdaySendResult | null>(null);
  const [wednesdaySentCandidateIds, setWednesdaySentCandidateIds] = useState<Set<string>>(new Set());
  const [sentTrackingReady, setSentTrackingReady] = useState(false);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data: s }) => {
      if (s.session) setIsAuthenticated(true);
    });
  }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    setLoading(true);
    const { data, error } = await supabase
      .from('email_send_logs')
      .select(
        'id, created_at, source, trigger_label, from_email, to_email, cc_email, subject, candidate_id, sent_by_user_id, status, error_message'
      )
      .order('created_at', { ascending: false })
      .limit(2500);
    setLoading(false);
    if (error) {
      setRows([]);
      const msg = error.message || 'Failed to load.';
      const code = (error as { code?: string }).code;
      const missingEmailLogs =
        code === 'PGRST205' ||
        (/relation|does not exist|schema cache/i.test(msg) && /email_send_logs/i.test(msg));
      setLoadError(
        missingEmailLogs
          ? 'The email_send_logs table is not visible to the API (often a 404 / PGRST205). In the Supabase SQL editor for this project, run the repo migration that creates public.email_send_logs and its "authenticated users can read email send logs" policy, then refresh the app.'
          : msg
      );
      return;
    }
    setRows((data as EmailSendLogRow[]) ?? []);
  }, []);

  useEffect(() => {
    if (isAuthenticated) void load();
  }, [isAuthenticated, load]);

  const loadWednesdaySentCandidateIds = useCallback(async (): Promise<Set<string>> => {
    const sentCandidateIds = new Set<string>();
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from('email_send_logs')
        .select('candidate_id')
        .eq('trigger_label', WEDNESDAY_MANUAL_TRIGGER)
        .eq('status', 'sent')
        .not('candidate_id', 'is', null)
        .order('created_at', { ascending: false })
        .range(from, from + EMAIL_SEND_LOGS_PAGE_SIZE - 1);

      if (error) {
        throw error;
      }

      const page = (data as Array<{ candidate_id: string | null }> | null) ?? [];
      for (const row of page) {
        if (row.candidate_id) {
          sentCandidateIds.add(row.candidate_id);
        }
      }

      if (page.length < EMAIL_SEND_LOGS_PAGE_SIZE) break;
      from += EMAIL_SEND_LOGS_PAGE_SIZE;
    }

    return sentCandidateIds;
  }, []);

  const loadCampaignCandidates = useCallback(async () => {
    setEligibleError(null);
    setEligibleLoading(true);
    setSentTrackingReady(false);
    try {
      const [data, sentCandidateIds] = await Promise.all([getCandidates(), loadWednesdaySentCandidateIds()]);
      setCandidateRows(data);
      setWednesdaySentCandidateIds(sentCandidateIds);
      setSentTrackingReady(true);
    } catch (err) {
      setCandidateRows([]);
      setWednesdaySentCandidateIds(new Set());
      setSentTrackingReady(false);
      setEligibleError(err instanceof Error ? err.message : 'Failed to load candidates.');
    } finally {
      setEligibleLoading(false);
    }
  }, [loadWednesdaySentCandidateIds]);

  useEffect(() => {
    if (isAuthenticated) void loadCampaignCandidates();
  }, [isAuthenticated, loadCampaignCandidates]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setAuthError('Invalid email or password.');
      return;
    }
    setIsAuthenticated(true);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const hay = [
        r.from_email,
        r.to_email,
        r.cc_email ?? '',
        r.subject,
        r.source,
        r.trigger_label ?? '',
        r.candidate_id ?? '',
        r.sent_by_user_id ?? '',
        r.status,
        r.error_message ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search]);

  const eligibleCandidates = useMemo(
    () =>
      candidateRows
        .filter(isWednesdayLiveOverviewEligible)
        .filter((candidate) => !wednesdaySentCandidateIds.has(candidate.id))
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    [candidateRows, wednesdaySentCandidateIds]
  );

  const eligibleSelectionKey = useMemo(
    () => eligibleCandidates.map((c) => c.id).join('|'),
    [eligibleCandidates]
  );

  useEffect(() => {
    setSelectedCandidateIds(new Set(eligibleCandidates.map((c) => c.id)));
  }, [eligibleSelectionKey]);

  const selectedEligibleCandidates = useMemo(
    () => eligibleCandidates.filter((c) => selectedCandidateIds.has(c.id)),
    [eligibleCandidates, selectedCandidateIds]
  );

  const previewCandidate = selectedEligibleCandidates[0] ?? eligibleCandidates[0] ?? null;

  const previewEmail = useMemo(() => {
    if (!stage2Template) return null;
    const fallback = {
      firstName: 'Candidate',
      lastName: '',
      email: 'candidate@example.com',
      phone: '',
    };
    return mergeTemplate(
      stage2Template.subject,
      stage2Template.bodyHtml,
      previewCandidate || fallback,
      buildWednesdayManualMergeExtras(),
      { siteOrigin: getSiteOriginForEmail() }
    );
  }, [previewCandidate, stage2Template]);

  const toggleCandidateSelection = (id: string) => {
    setSelectedCandidateIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllEligible = () => {
    setSelectedCandidateIds(new Set(eligibleCandidates.map((c) => c.id)));
  };

  const deselectAllEligible = () => {
    setSelectedCandidateIds(new Set());
  };

  const sendWednesdayCampaign = async () => {
    if (campaignSending) return;
    if (!stage2Template) {
      setCampaignError('Template not found: Stage 2 – Post check-in.');
      return;
    }
    if (selectedEligibleCandidates.length === 0) {
      setCampaignError('Select at least one eligible candidate.');
      return;
    }
    const { data: s } = await supabase.auth.getSession();
    const token = s.session?.access_token;
    if (!token) {
      setCampaignError('Your session expired. Please sign in again.');
      return;
    }

    setCampaignSending(true);
    setCampaignError(null);
    setCampaignResult(null);
    setCampaignProgress({ current: 0, total: selectedEligibleCandidates.length });

    const resultRows: WednesdaySendResultRow[] = [];
    let sent = 0;
    let failed = 0;

    for (let i = 0; i < selectedEligibleCandidates.length; i += 1) {
      const candidate = selectedEligibleCandidates[i];
      setCampaignProgress({ current: i + 1, total: selectedEligibleCandidates.length });
      const merged = mergeTemplate(
        stage2Template.subject,
        stage2Template.bodyHtml,
        candidate,
        buildWednesdayManualMergeExtras(),
        { siteOrigin: getSiteOriginForEmail() }
      );
      const response = await sendEmail(token, {
        to: candidate.email,
        subject: merged.subject,
        bodyHtml: merged.bodyHtml,
        trigger: WEDNESDAY_MANUAL_TRIGGER,
        candidateId: candidate.id,
      });
      if ('ok' in response && response.ok) {
        sent += 1;
        setWednesdaySentCandidateIds((prev) => {
          if (prev.has(candidate.id)) return prev;
          const next = new Set(prev);
          next.add(candidate.id);
          return next;
        });
        resultRows.push({
          candidateId: candidate.id,
          candidateName: candidateName(candidate),
          to: candidate.email,
          status: 'sent',
        });
      } else {
        failed += 1;
        resultRows.push({
          candidateId: candidate.id,
          candidateName: candidateName(candidate),
          to: candidate.email,
          status: 'failed',
          error: ('error' in response ? response.error : '') || 'Failed to send email.',
        });
      }
      if (i < selectedEligibleCandidates.length - 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 150));
      }
    }

    setCampaignSending(false);
    setCampaignProgress(null);
    setCampaignResult({
      attempted: selectedEligibleCandidates.length,
      sent,
      failed,
      completedAt: new Date().toISOString(),
      rows: resultRows,
    });
    void Promise.all([load(), loadCampaignCandidates()]);
  };

  const downloadCsv = () => {
    const header = [
      'When (UTC raw)',
      'When (display)',
      'From',
      'To',
      'CC',
      'Subject',
      'Source',
      'Trigger',
      'Candidate ID',
      'Sent by user ID',
      'Status',
      'Error',
    ];
    const lines = [
      header.map(csvEscape).join(','),
      ...filtered.map((r) =>
        [
          r.created_at,
          formatDateTimeCanadaEastern(r.created_at),
          r.from_email,
          r.to_email,
          r.cc_email ?? '',
          r.subject,
          r.source,
          r.trigger_label ?? '',
          r.candidate_id ?? '',
          r.sent_by_user_id ?? '',
          r.status,
          r.error_message ?? '',
        ]
          .map((c) => csvEscape(String(c)))
          .join(',')
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `email-send-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#f7fbff] to-[#eef6ff] flex items-center justify-center p-4">
        <div className="bg-white border border-[#d9e9fb] p-8 rounded-[28px] shadow-[0_18px_50px_-24px_rgba(0,94,184,0.35)] w-full max-w-sm">
          <h2 className="text-xl font-bold text-[#0B1B34] mb-1 text-center">Email log</h2>
          <p className="text-sm text-[#6f7b8d] text-center mb-6">Sign in with a staff account (admin, recruiter, or HR)</p>
          <form onSubmit={handleLogin} className="space-y-4">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2.5 rounded-2xl border border-[#cfe3f9] text-[#0B1B34]"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2.5 rounded-2xl border border-[#cfe3f9] text-[#0B1B34]"
            />
            <Button fullWidth type="submit">
              Sign in
            </Button>
            {authError && <p className="text-sm text-red-600 text-center">{authError}</p>}
          </form>
        </div>
      </div>
    );
  }

  return (
    <Layout isAdmin>
      <div className="w-full p-5 lg:p-6 space-y-5 text-[#1A2942]">
        <div className="rounded-2xl border border-[#d6deea] bg-white shadow-sm px-5 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-xl bg-[#005EB8]/10 flex items-center justify-center shrink-0">
              <Mail size={20} className="text-[#005EB8]" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-[#0B1B34] truncate">Email send log</h1>
              <p className="text-sm text-[#5c6b82]">
                Outbound mail from CRM and automations — search by address, subject, trigger, or candidate.
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

        <div className="rounded-2xl border border-[#d6deea] bg-white shadow-sm p-4 flex flex-col sm:flex-row gap-3 sm:items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a9ab0]" size={18} />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search to, from, subject, trigger, source, candidate ID…"
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-[#cfe3f9] text-sm text-[#0B1B34] focus:outline-none focus:ring-2 focus:ring-[#005EB8]/30"
            />
          </div>
          <div className="text-sm text-[#5c6b82] shrink-0">
            Showing <strong>{filtered.length}</strong> of {rows.length} loaded
          </div>
        </div>

        <div className="rounded-2xl border border-[#d6deea] bg-white shadow-sm p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-[#0B1B34]">Wednesday Live Overview Send</h2>
              <p className="text-sm text-[#5c6b82]">
                Manual campaign: run every Wednesday at 11:30 AM ET for candidates who are checked in only and have not submitted leadership form.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" onClick={() => void loadCampaignCandidates()} disabled={eligibleLoading || campaignSending}>
                <RefreshCw size={16} className={eligibleLoading ? 'animate-spin inline mr-1.5' : 'inline mr-1.5'} />
                Refresh eligibility
              </Button>
            </div>
          </div>

          {eligibleError && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-sm px-4 py-3">{eligibleError}</div>
          )}

          <div className="rounded-xl border border-[#d6deea] overflow-hidden">
            <div className="px-4 py-3 bg-[#f8fbff] border-b border-[#d6deea] flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm text-[#334155]">
                Eligible: <strong>{eligibleCandidates.length}</strong> · Selected: <strong>{selectedEligibleCandidates.length}</strong>
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" variant="secondary" onClick={selectAllEligible} disabled={eligibleCandidates.length === 0 || campaignSending}>
                  Select all
                </Button>
                <Button type="button" variant="secondary" onClick={deselectAllEligible} disabled={selectedEligibleCandidates.length === 0 || campaignSending}>
                  Deselect all
                </Button>
              </div>
            </div>
            <div className="max-h-64 overflow-auto">
              <table className="min-w-full text-left text-xs border-collapse">
                <thead className="sticky top-0 z-10 bg-[#eef2f7] text-[#0B1B34] font-semibold border-b border-[#d6deea]">
                  <tr>
                    <th className="px-3 py-2 border-r border-[#d6deea] w-10">Sel</th>
                    <th className="px-3 py-2 border-r border-[#d6deea]">Candidate</th>
                    <th className="px-3 py-2 border-r border-[#d6deea]">Email</th>
                    <th className="px-3 py-2 whitespace-nowrap">Stage</th>
                  </tr>
                </thead>
                <tbody className="text-[12px] text-[#1A2942]">
                  {eligibleCandidates.map((c) => {
                    const stage = normalizePipelineStage(c.adminData?.pipelineStage);
                    const checked = selectedCandidateIds.has(c.id);
                    return (
                      <tr key={c.id} className="border-b border-[#e8edf4] hover:bg-[#f8fafc]">
                        <td className="px-3 py-2 border-r border-[#eef2f7]">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleCandidateSelection(c.id)}
                            disabled={campaignSending}
                            className="h-4 w-4 rounded border-[#b8c8df] text-[#005EB8] focus:ring-[#005EB8]/30"
                          />
                        </td>
                        <td className="px-3 py-2 border-r border-[#eef2f7]">{candidateName(c)}</td>
                        <td className="px-3 py-2 border-r border-[#eef2f7] break-all">{c.email}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{stage}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!eligibleLoading && eligibleCandidates.length === 0 && (
                <div className="p-6 text-center text-sm text-[#6f7b8d]">No eligible candidates right now.</div>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-[#d6deea] p-4 bg-[#fcfdff] space-y-3">
            <div className="text-sm text-[#334155]">
              <strong>Template preview:</strong>{' '}
              {stage2Template ? 'Stage 2 – Post check-in (existing automation template family)' : 'Template unavailable'}
              {previewCandidate ? ` · Previewing ${candidateName(previewCandidate)}` : ''}
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#5c6b82] mb-1">Subject</label>
              <input
                type="text"
                readOnly
                value={previewEmail?.subject || ''}
                className="w-full px-3 py-2 rounded-lg border border-[#cfe3f9] bg-white text-sm text-[#0B1B34]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#5c6b82] mb-1">Body (rendered)</label>
              <div
                className="rounded-lg border border-[#cfe3f9] bg-white p-4 text-sm text-[#1A2942] max-h-56 overflow-auto prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{ __html: previewEmail?.bodyHtml || '<p class="text-gray-400">No preview available.</p>' }}
              />
            </div>
          </div>

          {campaignError && (
            <div className="rounded-xl border border-red-200 bg-red-50 text-red-800 text-sm px-4 py-3">{campaignError}</div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-[#5c6b82]">
              {campaignProgress
                ? `Sending ${campaignProgress.current} / ${campaignProgress.total}...`
                : 'Bulk send runs sequentially to reduce provider spikes.'}
            </div>
            <Button
              type="button"
              onClick={() => void sendWednesdayCampaign()}
              disabled={
                campaignSending ||
                eligibleLoading ||
                selectedEligibleCandidates.length === 0 ||
                !stage2Template ||
                !sentTrackingReady
              }
            >
              {campaignSending ? 'Sending...' : `Send to selected (${selectedEligibleCandidates.length})`}
            </Button>
          </div>

          {campaignResult && (
            <div className="rounded-xl border border-[#d6deea] overflow-hidden">
              <div className="px-4 py-3 bg-[#f8fbff] border-b border-[#d6deea] text-sm text-[#334155]">
                Run completed {formatDateTimeCanadaEastern(campaignResult.completedAt)} · Attempted <strong>{campaignResult.attempted}</strong> · Sent{' '}
                <strong className="text-emerald-700">{campaignResult.sent}</strong> · Failed{' '}
                <strong className="text-red-700">{campaignResult.failed}</strong>
              </div>
              <div className="max-h-56 overflow-auto">
                <table className="min-w-full text-left text-xs border-collapse">
                  <thead className="sticky top-0 z-10 bg-[#eef2f7] text-[#0B1B34] font-semibold border-b border-[#d6deea]">
                    <tr>
                      <th className="px-3 py-2 border-r border-[#d6deea]">Recipient</th>
                      <th className="px-3 py-2 border-r border-[#d6deea]">Candidate</th>
                      <th className="px-3 py-2 border-r border-[#d6deea]">Status</th>
                      <th className="px-3 py-2">Error</th>
                    </tr>
                  </thead>
                  <tbody className="text-[12px] text-[#1A2942]">
                    {campaignResult.rows.map((r) => (
                      <tr key={`${r.candidateId}-${r.to}`} className="border-b border-[#e8edf4] hover:bg-[#f8fafc] align-top">
                        <td className="px-3 py-2 border-r border-[#eef2f7] break-all">{r.to}</td>
                        <td className="px-3 py-2 border-r border-[#eef2f7]">{r.candidateName}</td>
                        <td className="px-3 py-2 border-r border-[#eef2f7]">
                          <span className={r.status === 'failed' ? 'text-red-700 font-semibold' : 'text-emerald-700 font-semibold'}>
                            {r.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-red-700">{r.error || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {loadError && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-sm px-4 py-3">{loadError}</div>
        )}

        <div className="rounded-2xl border border-[#d6deea] bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto max-h-[calc(100vh-280px)] overflow-y-auto">
            <table className="min-w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 z-10 bg-[#eef2f7] text-[#0B1B34] font-semibold border-b border-[#d6deea]">
                <tr>
                  <th className="px-2 py-2 border-r border-[#d6deea] whitespace-nowrap">When</th>
                  <th className="px-2 py-2 border-r border-[#d6deea] whitespace-nowrap">From</th>
                  <th className="px-2 py-2 border-r border-[#d6deea] whitespace-nowrap">To</th>
                  <th className="px-2 py-2 border-r border-[#d6deea] whitespace-nowrap">CC</th>
                  <th className="px-2 py-2 border-r border-[#d6deea] min-w-[140px]">Subject</th>
                  <th className="px-2 py-2 border-r border-[#d6deea] whitespace-nowrap">Source</th>
                  <th className="px-2 py-2 border-r border-[#d6deea] whitespace-nowrap">Trigger</th>
                  <th className="px-2 py-2 border-r border-[#d6deea] whitespace-nowrap">Candidate</th>
                  <th className="px-2 py-2 border-r border-[#d6deea] whitespace-nowrap">Sent by</th>
                  <th className="px-2 py-2 whitespace-nowrap">Status</th>
                </tr>
              </thead>
              <tbody className="font-mono text-[11px] text-[#1A2942]">
                {filtered.map((r) => (
                  <tr key={r.id} className="border-b border-[#e8edf4] hover:bg-[#f8fafc] align-top">
                    <td className="px-2 py-1.5 border-r border-[#eef2f7] whitespace-nowrap text-[#334155]">
                      {formatDateTimeCanadaEastern(r.created_at)}
                    </td>
                    <td className="px-2 py-1.5 border-r border-[#eef2f7] max-w-[200px] break-all">{r.from_email}</td>
                    <td className="px-2 py-1.5 border-r border-[#eef2f7] max-w-[220px] break-all">{r.to_email}</td>
                    <td className="px-2 py-1.5 border-r border-[#eef2f7] max-w-[160px] break-all">{r.cc_email || '—'}</td>
                    <td className="px-2 py-1.5 border-r border-[#eef2f7] max-w-[280px] break-words">{r.subject}</td>
                    <td className="px-2 py-1.5 border-r border-[#eef2f7] whitespace-nowrap">{r.source}</td>
                    <td className="px-2 py-1.5 border-r border-[#eef2f7] max-w-[200px] break-words">
                      {r.trigger_label || '—'}
                    </td>
                    <td className="px-2 py-1.5 border-r border-[#eef2f7] break-all max-w-[120px]">{r.candidate_id || '—'}</td>
                    <td className="px-2 py-1.5 border-r border-[#eef2f7] break-all max-w-[120px]">{r.sent_by_user_id || '—'}</td>
                    <td className="px-2 py-1.5">
                      <span
                        className={
                          r.status === 'failed' ? 'text-red-700 font-semibold' : 'text-emerald-800'
                        }
                      >
                        {r.status}
                      </span>
                      {r.error_message ? (
                        <div className="text-red-600 font-sans normal-case mt-0.5 max-w-[240px]">{r.error_message}</div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && filtered.length === 0 && !loadError && (
              <div className="p-8 text-center text-sm text-[#6f7b8d]">No rows match your search, or the log is empty.</div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default EmailLog;
