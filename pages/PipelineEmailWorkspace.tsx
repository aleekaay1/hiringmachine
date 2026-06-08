import React from 'react';
import { motion } from 'framer-motion';
import { Moon, Sun } from 'lucide-react';
import PipelineAuthShell from '../components/PipelineAuthShell';
import { Button } from '../components/UI';
import {
  listPipelineEmailSendLogs,
  listPipelineIncomingEmailLogs,
  listPipelineManualCandidates,
  readPipelineCandidateEmail,
  savePipelineCandidateEmailOverride,
  syncPipelineIncomingEmails,
  type PipelineCandidate,
  type PipelineEmailSendLog,
  type PipelineIncomingEmailLog,
} from '../services/pipelineService';
import { sendEmail } from '../services/emailService';
import { appendEmailSignatureToHtml, SIGNATURE_LOGO_URL } from '../services/emailSignatureHtml';
import {
  cleanSubjectForDisplay,
  normalizeMessageIdForHeader,
  splitInboundSnippet,
  subjectForReply,
} from '../services/inboundEmailFormat';
import { supabase } from '../services/supabaseClient';
import { EMAIL_TEMPLATES, mergeTemplate } from '../services/emailTemplates';
import { formatDateTimeCanadaEastern } from '../services/dateDisplay';
import { fetchNextUpcomingLiveSession } from '../services/liveSessionOccurrences';

type WorkspaceThemeMode = 'dark' | 'light';
type ComposeView = 'write' | 'preview';
const WORKSPACE_THEME_STORAGE_KEY = 'pipeline-recruiter-workspace-theme';

function plainToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped.split('\n').map((line) => `<p style="margin:0 0 12px;">${line || '&nbsp;'}</p>`).join('');
}

function wrapEmailPreviewShell(innerHtml: string): string {
  return `<div style="margin:0;padding:16px;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:8px;padding:24px;font-size:14px;line-height:1.55;color:#1f2937;">
${innerHtml}
</div>
</div>`;
}

function readSendLogBody(log: PipelineEmailSendLog): { html: string | null; text: string | null } {
  const meta = log.metadata && typeof log.metadata === 'object' ? log.metadata : {};
  const html = typeof meta.body_html === 'string' && meta.body_html.trim() ? meta.body_html : null;
  const text = typeof meta.body_text === 'string' && meta.body_text.trim() ? meta.body_text : null;
  return { html, text };
}

const PipelineEmailWorkspace: React.FC = () => {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [candidates, setCandidates] = React.useState<PipelineCandidate[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = React.useState<string>('');
  const [incomingLogs, setIncomingLogs] = React.useState<PipelineIncomingEmailLog[]>([]);
  const [sendLogs, setSendLogs] = React.useState<PipelineEmailSendLog[]>([]);
  const [listQuery, setListQuery] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<'all' | 'sent' | 'failed' | 'other'>('all');
  const [fromDate, setFromDate] = React.useState('');
  const [toDate, setToDate] = React.useState('');
  const [selectedInboxId, setSelectedInboxId] = React.useState<string | null>(null);
  const [selectedOutboxId, setSelectedOutboxId] = React.useState<string | null>(null);

  const [templateId, setTemplateId] = React.useState('');
  const [toEmail, setToEmail] = React.useState('');
  const [subject, setSubject] = React.useState('');
  const [bodyPlain, setBodyPlain] = React.useState('');
  const [bodyHtml, setBodyHtml] = React.useState('');
  const [useHtmlCompose, setUseHtmlCompose] = React.useState(false);
  const [composeView, setComposeView] = React.useState<ComposeView>('write');
  const [sending, setSending] = React.useState(false);
  const [syncingInbox, setSyncingInbox] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [inReplyTo, setInReplyTo] = React.useState<string | null>(null);
  const [references, setReferences] = React.useState<string | null>(null);
  const [themeMode, setThemeMode] = React.useState<WorkspaceThemeMode>('dark');
  const [candidateEmailInput, setCandidateEmailInput] = React.useState('');
  const [savingEmail, setSavingEmail] = React.useState(false);
  const [emailMsg, setEmailMsg] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(WORKSPACE_THEME_STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') {
      setThemeMode(stored);
    }
  }, []);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(WORKSPACE_THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

  const selectedCandidate = React.useMemo(
    () => candidates.find((candidate) => candidate.id === selectedCandidateId) || null,
    [candidates, selectedCandidateId],
  );
  const selectedCandidateEmailInfo = React.useMemo(
    () => (selectedCandidate ? readPipelineCandidateEmail(selectedCandidate) : null),
    [selectedCandidate],
  );
  const candidateNameById = React.useMemo(
    () => new Map(candidates.map((candidate) => [candidate.id, candidate.full_name || 'Unknown Candidate'])),
    [candidates],
  );

  const loadCandidateMailLogs = React.useCallback(async (candidate: PipelineCandidate) => {
    const emailInfo = readPipelineCandidateEmail(candidate);
    const [incoming, sends] = await Promise.all([
      listPipelineIncomingEmailLogs(candidate.id, emailInfo.effectiveEmail),
      listPipelineEmailSendLogs(candidate.id, emailInfo.effectiveEmail),
    ]);
    setIncomingLogs(incoming);
    setSendLogs(sends);
  }, []);

  const loadWorkspace = React.useCallback(async (options?: { syncInbox?: boolean; candidateId?: string }) => {
    setLoading(true);
    setError(null);
    try {
      if (options?.syncInbox) {
        setSyncingInbox(true);
        try {
          const result = await syncPipelineIncomingEmails(14, 120);
          setMessage(`Inbox synced: ${result.synced} checked, ${result.mapped} mapped to candidates.`);
        } catch (syncErr) {
          setMessage(syncErr instanceof Error ? syncErr.message : String(syncErr));
        } finally {
          setSyncingInbox(false);
        }
      }

      const rows = await listPipelineManualCandidates();
      setCandidates(rows);
      if (rows.length === 0) {
        setIncomingLogs([]);
        setSendLogs([]);
        setSelectedCandidateId('');
        return;
      }
      let nextCandidateId = '';
      setSelectedCandidateId((prev) => {
        const preferred = options?.candidateId || prev;
        if (preferred && rows.some((row) => row.id === preferred)) {
          nextCandidateId = preferred;
          return preferred;
        }
        nextCandidateId = rows[0]?.id || '';
        return nextCandidateId;
      });
      const active = rows.find((row) => row.id === nextCandidateId);
      if (active) await loadCandidateMailLogs(active);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [loadCandidateMailLogs]);

  React.useEffect(() => {
    void loadWorkspace({ syncInbox: true });
    // Mount-only inbox sync + candidate list load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (!selectedCandidate) return;
    const emailInfo = readPipelineCandidateEmail(selectedCandidate);
    setCandidateEmailInput(emailInfo.effectiveEmail);
    setEmailMsg(null);
    setToEmail(emailInfo.effectiveEmail);
    setSubject('Quick follow-up from Paz Organization');
    setBodyPlain(`Hi ${(selectedCandidate.full_name || '').trim() || 'there'},\n\n`);
    setBodyHtml('');
    setUseHtmlCompose(false);
    setComposeView('write');
    setInReplyTo(null);
    setReferences(null);
    void loadCandidateMailLogs(selectedCandidate).catch((e) => {
      setError(e instanceof Error ? e.message : String(e));
    });
  }, [selectedCandidate?.id, loadCandidateMailLogs]);

  const saveCandidateEmailOverride = async () => {
    if (!selectedCandidate) return;
    setSavingEmail(true);
    setEmailMsg(null);
    try {
      const updated = await savePipelineCandidateEmailOverride({
        candidateId: selectedCandidate.id,
        emailInput: candidateEmailInput,
        source: 'pipeline_email_workspace',
      });
      setCandidates((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
      setCandidateEmailInput(readPipelineCandidateEmail(updated).effectiveEmail);
      setToEmail(readPipelineCandidateEmail(updated).effectiveEmail);
      await loadCandidateMailLogs(updated);
      setEmailMsg('Email saved. Inbox remapped to this address.');
    } catch (e) {
      setEmailMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingEmail(false);
    }
  };

  const filteredInbox = React.useMemo(() => {
    const query = listQuery.trim().toLowerCase();
    const fromMs = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : null;
    const toMs = toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : null;
    return incomingLogs.filter((log) => {
      const stamp = new Date(log.received_at).getTime();
      if (fromMs != null && stamp < fromMs) return false;
      if (toMs != null && stamp > toMs) return false;
      if (!query) return true;
      const hay = `${log.from_email} ${log.to_email || ''} ${log.subject || ''} ${log.snippet || ''}`.toLowerCase();
      return hay.includes(query);
    });
  }, [incomingLogs, listQuery, fromDate, toDate]);

  const filteredOutbox = React.useMemo(() => {
    const query = listQuery.trim().toLowerCase();
    const fromMs = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : null;
    const toMs = toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : null;
    return sendLogs.filter((log) => {
      const stamp = new Date(log.created_at).getTime();
      if (fromMs != null && stamp < fromMs) return false;
      if (toMs != null && stamp > toMs) return false;
      if (statusFilter !== 'all') {
        const status = String(log.status || '').toLowerCase();
        if (statusFilter === 'sent' && status !== 'sent') return false;
        if (statusFilter === 'failed' && status === 'sent') return false;
        if (statusFilter === 'other' && (status === 'sent' || status.includes('fail'))) return false;
      }
      if (!query) return true;
      const hay = `${log.to_email} ${log.subject} ${log.status}`.toLowerCase();
      return hay.includes(query);
    });
  }, [sendLogs, listQuery, fromDate, toDate, statusFilter]);

  React.useEffect(() => {
    if (!filteredInbox.length) {
      setSelectedInboxId(null);
      return;
    }
    setSelectedInboxId((prev) => (prev && filteredInbox.some((log) => log.id === prev) ? prev : filteredInbox[0].id));
  }, [filteredInbox]);

  React.useEffect(() => {
    if (!filteredOutbox.length) {
      setSelectedOutboxId(null);
      return;
    }
    setSelectedOutboxId((prev) => (prev && filteredOutbox.some((log) => log.id === prev) ? prev : filteredOutbox[0].id));
  }, [filteredOutbox]);

  const selectedInbox = React.useMemo(
    () => filteredInbox.find((log) => log.id === selectedInboxId) || null,
    [filteredInbox, selectedInboxId],
  );
  const selectedOutbox = React.useMemo(
    () => filteredOutbox.find((log) => log.id === selectedOutboxId) || null,
    [filteredOutbox, selectedOutboxId],
  );
  const selectedInboxPreview = React.useMemo(() => {
    if (!selectedInbox?.snippet) return { latest: '', quoted: null as string | null };
    return splitInboundSnippet(selectedInbox.snippet);
  }, [selectedInbox]);
  const selectedOutboxBody = React.useMemo(
    () => (selectedOutbox ? readSendLogBody(selectedOutbox) : { html: null, text: null }),
    [selectedOutbox],
  );
  const selectedOutboxPreviewHtml = React.useMemo(() => {
    if (!selectedOutboxBody.html) return '';
    return wrapEmailPreviewShell(selectedOutboxBody.html);
  }, [selectedOutboxBody.html]);

  const applyTemplateToCompose = async () => {
    if (!selectedCandidate || !templateId) return;
    const template = EMAIL_TEMPLATES.find((item) => item.id === templateId);
    if (!template) return;
    const nameParts = String(selectedCandidate.full_name || '').trim().split(/\s+/);
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ');
    const liveSessionOccurrence =
      templateId === 'stage2_post_checkin' ? await fetchNextUpcomingLiveSession() : null;
    const merged = mergeTemplate(
      template.subject,
      template.bodyHtml,
      {
        firstName,
        lastName,
        email: selectedCandidate.email || '',
        phone: selectedCandidate.phone || '',
      },
      undefined,
      { siteOrigin: window.location.origin, liveSessionOccurrence },
    );
    setSubject(merged.subject);
    setBodyHtml(merged.bodyHtml);
    setBodyPlain('');
    setUseHtmlCompose(true);
    setComposeView('preview');
    setMessage(`Template applied: ${template.name}. Use Preview to see the final email.`);
  };

  const composedHtmlForSend = React.useMemo(() => {
    const core = useHtmlCompose ? bodyHtml.trim() : plainToHtml(bodyPlain.trim());
    if (!core) return '';
    if (core.includes(SIGNATURE_LOGO_URL) || core.includes('{{emailSignature}}')) return core.replace(/\{\{emailSignature\}\}/g, '');
    return appendEmailSignatureToHtml(core);
  }, [bodyHtml, bodyPlain, useHtmlCompose]);

  const previewHtml = React.useMemo(
    () => (composedHtmlForSend ? wrapEmailPreviewShell(composedHtmlForSend) : ''),
    [composedHtmlForSend],
  );

  const sendFromWorkspace = async () => {
    const hasBody = useHtmlCompose ? bodyHtml.trim().length > 0 : bodyPlain.trim().length > 0;
    if (!selectedCandidate || !toEmail.trim() || !subject.trim() || !hasBody) {
      setMessage('To, subject, and message are required.');
      return;
    }
    setSending(true);
    setMessage(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Not authenticated.');
      const result = await sendEmail(token, {
        to: toEmail.trim(),
        subject: subject.trim(),
        bodyHtml: composedHtmlForSend,
        candidateId: selectedCandidate.id,
        trigger: 'pipeline_email_workspace',
        inReplyTo: inReplyTo || undefined,
        references: references || undefined,
        attachLiveSessionCalendar: templateId === 'stage2_post_checkin',
      });
      if (!('ok' in result)) throw new Error(result.error || 'Failed to send email.');
      setMessage('Email sent.');
      await loadCandidateMailLogs(selectedCandidate);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  const isDark = themeMode === 'dark';
  const tone = React.useMemo(
    () => ({
      page: 'relative overflow-hidden rounded-[30px] border p-4 md:p-5 shadow-[0_35px_100px_-45px_rgba(0,0,0,0.7)]',
      pageTheme: isDark
        ? 'border-white/10 bg-[#070b18] text-slate-100'
        : 'border-[#d4e4f7]/70 bg-[#f4f8ff]/80 text-slate-900',
      orbA: isDark
        ? 'from-violet-500/30 via-indigo-500/10 to-transparent'
        : 'from-violet-300/35 via-indigo-200/20 to-transparent',
      orbB: isDark
        ? 'from-cyan-500/25 via-sky-500/10 to-transparent'
        : 'from-cyan-300/35 via-sky-200/25 to-transparent',
      orbC: isDark
        ? 'from-fuchsia-500/15 via-blue-500/10 to-transparent'
        : 'from-fuchsia-200/35 via-blue-200/20 to-transparent',
      glassPanel: isDark
        ? 'border-white/12 bg-white/[0.045] backdrop-blur-xl shadow-[0_24px_60px_-42px_rgba(16,24,40,0.9)]'
        : 'border-white/70 bg-white/70 backdrop-blur-xl shadow-[0_22px_48px_-38px_rgba(37,99,235,0.45)]',
      panelMuted: isDark ? 'text-slate-300' : 'text-[#365274]',
      panelLabel: isDark ? 'text-slate-400' : 'text-[#4b6d95]',
      panelTitle: isDark ? 'text-white' : 'text-[#0B1B34]',
      input: isDark
        ? 'border-white/15 bg-white/5 text-slate-100 placeholder:text-slate-500'
        : 'border-[#bfd6ee] bg-white/70 text-[#13243f] placeholder:text-[#7392b8]',
      subtle: isDark ? 'bg-white/5 border-white/10' : 'bg-white/80 border-[#cde0f4]',
      actionButton: isDark
        ? 'border-white/20 bg-white/10 text-white hover:bg-white/15'
        : 'border-[#bad4ee] bg-white/75 text-[#0B1B34] hover:bg-white',
      selectedCard: isDark ? 'border-cyan-300/40 bg-cyan-300/15' : 'border-[#9dc6ef] bg-[#e8f3ff]',
      neutralCard: isDark ? 'border-white/10 bg-white/[0.04]' : 'border-slate-200 bg-white/85',
    }),
    [isDark],
  );

  return (
    <PipelineAuthShell
      title="Email Workspace"
      subtitle="Sign in to use recruiter email workflow"
      redirectPath="/pipeline/email"
    >
      <div className={`mx-auto w-full max-w-[1460px] ${tone.page} ${tone.pageTheme}`}>
        <div className={`pointer-events-none absolute -top-24 left-[-10%] h-72 w-72 rounded-full bg-gradient-to-br blur-3xl ${tone.orbA}`} />
        <div className={`pointer-events-none absolute top-40 right-[-8%] h-80 w-80 rounded-full bg-gradient-to-br blur-3xl ${tone.orbB}`} />
        <div className={`pointer-events-none absolute bottom-[-6rem] left-1/3 h-72 w-72 rounded-full bg-gradient-to-tr blur-3xl ${tone.orbC}`} />

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className={`relative rounded-3xl border p-4 ${tone.glassPanel}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className={`text-[10px] uppercase tracking-[0.22em] ${tone.panelLabel}`}>Pipeline recruiter studio</p>
              <h1 className={`text-lg font-semibold ${tone.panelTitle}`}>Email Workspace</h1>
              <p className={`text-xs ${tone.panelMuted}`}>Operational inbox/outbox and candidate compose flow with template support.</p>
            </div>
            <button
              type="button"
              onClick={() => setThemeMode((prev) => (prev === 'dark' ? 'light' : 'dark'))}
              className={`inline-flex items-center gap-1 rounded-xl border px-3 py-2 text-xs font-semibold ${tone.actionButton}`}
              aria-label="Toggle dark and light mode"
            >
              {isDark ? <Sun size={13} /> : <Moon size={13} />}
              {isDark ? 'Light mode' : 'Dark mode'}
            </button>
          </div>
        </motion.div>

        {error && (
          <div className={`mt-4 rounded-xl border px-3 py-2 text-sm ${isDark ? 'border-red-300/40 bg-red-500/12 text-red-200' : 'border-red-200 bg-red-50 text-red-700'}`}>
            {error}
          </div>
        )}

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05 }}
          className={`mt-4 rounded-2xl border p-3 ${tone.glassPanel}`}
        >
          <p className={`mb-2 text-[10px] uppercase tracking-[0.18em] ${tone.panelLabel}`}>Search and status filters</p>
          <div className="grid gap-2 md:grid-cols-5">
            <input
              value={listQuery}
              onChange={(e) => setListQuery(e.target.value)}
              placeholder="Search email/subject/status"
              className={`rounded-lg border px-2 py-2 text-xs md:col-span-2 ${tone.input}`}
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | 'sent' | 'failed' | 'other')}
              className={`rounded-lg border px-2 py-2 text-xs ${tone.input}`}
            >
              <option value="all">Any status</option>
              <option value="sent">Sent only</option>
              <option value="failed">Failed only</option>
              <option value="other">Other statuses</option>
            </select>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className={`rounded-lg border px-2 py-2 text-xs ${tone.input}`} />
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className={`rounded-lg border px-2 py-2 text-xs ${tone.input}`} />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.1 }}
          className="mt-4 grid gap-4 lg:grid-cols-2"
        >
          <section className={`rounded-2xl border p-3 space-y-2 ${tone.glassPanel}`}>
            <div className="flex items-center justify-between gap-2">
              <p className={`text-xs font-semibold ${tone.panelTitle}`}>Inbox ({filteredInbox.length})</p>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  className={`!min-h-0 h-8 px-2 text-xs ${isDark ? '!border-white/20 !bg-white/10 !text-slate-100 hover:!bg-white/15' : ''}`}
                  onClick={() => void loadWorkspace({ syncInbox: true })}
                  disabled={loading || syncingInbox}
                >
                  {syncingInbox ? 'Syncing...' : 'Sync inbox'}
                </Button>
                <Button
                  variant="outline"
                  className={`!min-h-0 h-8 px-2 text-xs ${isDark ? '!border-white/20 !bg-white/10 !text-slate-100 hover:!bg-white/15' : ''}`}
                  onClick={() => void loadWorkspace()}
                  disabled={loading || syncingInbox}
                >
                  {loading ? 'Refreshing...' : 'Refresh'}
                </Button>
              </div>
            </div>
            <div className="space-y-1.5 max-h-[42vh] min-h-[200px] overflow-auto">
              {filteredInbox.map((log) => (
                <button
                  key={log.id}
                  type="button"
                  onClick={() => {
                    setSelectedInboxId(log.id);
                    setSelectedCandidateId(log.candidate_id || '');
                    setToEmail(String(log.from_email || '').trim());
                    setSubject(subjectForReply(log.subject));
                    setBodyPlain(`Hi ${(candidateNameById.get(log.candidate_id || '') || 'there').trim()},\n\n`);
                    setBodyHtml('');
                    setUseHtmlCompose(false);
                    setComposeView('write');
                    const mid = normalizeMessageIdForHeader(log.message_id);
                    setInReplyTo(mid);
                    setReferences(mid);
                    setMessage('Reply headers prepared from selected inbox thread.');
                  }}
                  className={`w-full rounded-lg border px-2 py-2 text-left ${
                    selectedInboxId === log.id ? tone.selectedCard : tone.neutralCard
                  }`}
                >
                  <p className={`text-[11px] font-semibold truncate ${tone.panelTitle}`}>{log.subject || '(no subject)'}</p>
                  <p className={`text-[10px] truncate ${tone.panelMuted}`}>{log.from_email}</p>
                  <p className={`text-[10px] truncate ${tone.panelLabel}`}>
                    {candidateNameById.get(log.candidate_id || '') || 'Unmapped candidate'} · {formatDateTimeCanadaEastern(log.received_at)}
                  </p>
                </button>
              ))}
              {!filteredInbox.length && (
                <p className={`rounded-lg border border-dashed px-2 py-2 text-xs ${tone.input}`}>
                  No inbox messages match current filters.
                </p>
              )}
            </div>
            <div className={`rounded-lg border p-2.5 max-h-[28vh] overflow-auto ${tone.subtle}`}>
              <p className={`text-[11px] font-semibold ${tone.panelTitle}`}>Inbox detail</p>
              {selectedInbox ? (
                <div className={`mt-1 space-y-2 text-[11px] ${tone.panelMuted}`}>
                  <p><span className="font-semibold">From:</span> {selectedInbox.from_email}</p>
                  <p><span className="font-semibold">To:</span> {selectedInbox.to_email || '—'}</p>
                  <p><span className="font-semibold">Subject:</span> {cleanSubjectForDisplay(selectedInbox.subject)}</p>
                  <div className={`rounded-lg border px-2 py-2 whitespace-pre-wrap leading-relaxed ${tone.neutralCard}`}>
                    {selectedInboxPreview.latest || 'No preview snippet.'}
                  </div>
                  {selectedInboxPreview.quoted && (
                    <details className={`rounded-lg border px-2 py-1 ${tone.neutralCard}`}>
                      <summary className="cursor-pointer py-1 font-semibold">Earlier thread / quoted content</summary>
                      <div className="pb-2 whitespace-pre-wrap leading-relaxed">{selectedInboxPreview.quoted}</div>
                    </details>
                  )}
                </div>
              ) : (
                <p className={`mt-1 text-[11px] ${tone.panelLabel}`}>
                  {selectedCandidate
                    ? 'No inbox messages matched this candidate yet. Sync inbox or correct the resume email below if OCR picked the wrong address.'
                    : 'Select an inbox row.'}
                </p>
              )}
            </div>
          </section>

          <section className={`rounded-2xl border p-3 space-y-2 ${tone.glassPanel}`}>
            <p className={`text-xs font-semibold ${tone.panelTitle}`}>Outbox ({filteredOutbox.length})</p>
            <div className="space-y-1.5 max-h-[42vh] min-h-[200px] overflow-auto">
              {filteredOutbox.map((log) => (
                <button
                  key={log.id}
                  type="button"
                  onClick={() => setSelectedOutboxId(log.id)}
                  className={`w-full rounded-lg border px-2 py-2 text-left ${
                    selectedOutboxId === log.id ? tone.selectedCard : tone.neutralCard
                  }`}
                >
                  <p className={`text-[11px] font-semibold truncate ${tone.panelTitle}`}>{log.subject}</p>
                  <p className={`text-[10px] truncate ${tone.panelMuted}`}>{log.to_email}</p>
                  <p className={`text-[10px] truncate ${tone.panelLabel}`}>
                    <span className={String(log.status).toLowerCase() === 'sent' ? 'text-emerald-700' : 'text-red-700'}>
                      {log.status}
                    </span>
                    {' · '}
                    {formatDateTimeCanadaEastern(log.created_at)}
                  </p>
                </button>
              ))}
              {!filteredOutbox.length && (
                <p className={`rounded-lg border border-dashed px-2 py-2 text-xs ${tone.input}`}>
                  No outbox messages match current filters.
                </p>
              )}
            </div>
            <div className={`rounded-lg border p-2.5 max-h-[28vh] overflow-auto ${tone.subtle}`}>
              <p className={`text-[11px] font-semibold ${tone.panelTitle}`}>Outbox detail</p>
              {selectedOutbox ? (
                <div className={`mt-1 space-y-2 text-[11px] ${tone.panelMuted}`}>
                  <p><span className="font-semibold">To:</span> {selectedOutbox.to_email}</p>
                  <p><span className="font-semibold">Subject:</span> {selectedOutbox.subject}</p>
                  <p>
                    <span className="font-semibold">Status:</span>{' '}
                    <span className={String(selectedOutbox.status).toLowerCase() === 'sent' ? 'text-emerald-700' : 'text-red-700'}>
                      {selectedOutbox.status}
                    </span>
                    {' · '}
                    {formatDateTimeCanadaEastern(selectedOutbox.created_at)}
                  </p>
                  {selectedOutbox.error_message && (
                    <p className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-red-700">{selectedOutbox.error_message}</p>
                  )}
                  {selectedOutboxPreviewHtml ? (
                    <iframe
                      title="Outbox email body"
                      srcDoc={selectedOutboxPreviewHtml}
                      className="w-full min-h-[180px] rounded-lg border border-slate-200 bg-white"
                      sandbox=""
                    />
                  ) : selectedOutboxBody.text ? (
                    <div className={`rounded-lg border px-2 py-2 whitespace-pre-wrap leading-relaxed ${tone.neutralCard}`}>
                      {selectedOutboxBody.text}
                    </div>
                  ) : (
                    <p className={`${tone.panelLabel}`}>Body not stored for this send (older logs). New sends include full content.</p>
                  )}
                </div>
              ) : (
                <p className={`mt-1 text-[11px] ${tone.panelLabel}`}>Click an outbox row to read the full email.</p>
              )}
            </div>
          </section>
        </motion.div>

        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.15 }}
          className={`mt-4 rounded-2xl border p-4 md:p-5 space-y-4 ${tone.glassPanel}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className={`text-[10px] uppercase tracking-[0.18em] ${tone.panelLabel}`}>Compose</p>
              <h2 className={`text-base font-semibold ${tone.panelTitle}`}>New message</h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setComposeView('write')}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                  composeView === 'write' ? tone.selectedCard : tone.neutralCard
                }`}
              >
                Write
              </button>
              <button
                type="button"
                onClick={() => setComposeView('preview')}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                  composeView === 'preview' ? tone.selectedCard : tone.neutralCard
                }`}
              >
                Preview
              </button>
              <Button
                className="!min-h-0 h-9 px-4 text-xs"
                onClick={() => void sendFromWorkspace()}
                disabled={sending || !selectedCandidate}
              >
                {sending ? 'Sending…' : 'Send email'}
              </Button>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-4">
              <div>
                <label htmlFor="compose-candidate" className={`mb-1 block text-xs font-semibold ${tone.panelTitle}`}>
                  Candidate
                </label>
                <select
                  id="compose-candidate"
                  value={selectedCandidateId}
                  onChange={(e) => setSelectedCandidateId(e.target.value)}
                  className={`w-full rounded-xl border px-3 py-2.5 text-sm ${tone.input}`}
                >
                  {candidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.full_name || 'Unknown Candidate'} ({candidate.email || candidate.phone || 'no contact'})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="compose-template" className={`mb-1 block text-xs font-semibold ${tone.panelTitle}`}>
                  Email template
                </label>
                <div className="flex gap-2">
                  <select
                    id="compose-template"
                    value={templateId}
                    onChange={(e) => setTemplateId(e.target.value)}
                    className={`w-full rounded-xl border px-3 py-2.5 text-sm ${tone.input}`}
                  >
                    <option value="">None — write your own message</option>
                    {EMAIL_TEMPLATES.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="outline"
                    className={`!min-h-0 shrink-0 h-10 px-3 text-xs ${isDark ? '!border-white/20 !bg-white/10 !text-slate-100 hover:!bg-white/15' : ''}`}
                    onClick={() => void applyTemplateToCompose()}
                    disabled={!templateId || !selectedCandidate}
                  >
                    Apply template
                  </Button>
                </div>
                {useHtmlCompose && (
                  <p className={`mt-1.5 text-xs ${tone.panelMuted}`}>
                    Rich HTML template loaded — calendar button and formatting are preserved on send.
                  </p>
                )}
              </div>

              <div className={`rounded-xl border p-3 ${tone.subtle}`}>
                <p className={`mb-2 text-xs font-semibold uppercase tracking-wide ${tone.panelTitle}`}>Resume email (for inbox matching)</p>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    value={candidateEmailInput}
                    onChange={(e) => {
                      setCandidateEmailInput(e.target.value);
                      setEmailMsg(null);
                    }}
                    placeholder="candidate@example.com"
                    className={`min-w-0 flex-1 rounded-xl border px-3 py-2.5 text-sm ${tone.input}`}
                  />
                  <Button
                    variant="outline"
                    className="!min-h-0 h-10 shrink-0 px-4 text-sm"
                    onClick={() => void saveCandidateEmailOverride()}
                    disabled={savingEmail || !selectedCandidate}
                  >
                    {savingEmail ? 'Saving...' : 'Save email'}
                  </Button>
                </div>
                {selectedCandidateEmailInfo?.originalExtractedEmail && (
                  <p className={`mt-2 text-[11px] ${tone.panelLabel}`}>
                    OCR extracted email: {selectedCandidateEmailInfo.originalExtractedEmail}
                  </p>
                )}
                <p className={`mt-1 text-[11px] ${tone.panelLabel}`}>
                  Inbox sync matches incoming mail by this address. Fix it here if OCR picked the wrong email.
                </p>
                {emailMsg && <p className="mt-1 text-xs text-emerald-700">{emailMsg}</p>}
              </div>

              <div>
                <label htmlFor="compose-to" className={`mb-1 block text-xs font-semibold ${tone.panelTitle}`}>
                  To (email)
                </label>
                <input
                  id="compose-to"
                  type="email"
                  value={toEmail}
                  onChange={(e) => setToEmail(e.target.value)}
                  className={`w-full rounded-xl border px-3 py-2.5 text-sm ${tone.input}`}
                  placeholder="candidate@example.com"
                />
              </div>

              <div>
                <label htmlFor="compose-subject" className={`mb-1 block text-xs font-semibold ${tone.panelTitle}`}>
                  Subject
                </label>
                <input
                  id="compose-subject"
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className={`w-full rounded-xl border px-3 py-2.5 text-sm ${tone.input}`}
                  placeholder="Email subject line"
                />
              </div>

              {composeView === 'write' && (
                <div>
                  <label htmlFor="compose-body" className={`mb-1 block text-xs font-semibold ${tone.panelTitle}`}>
                    Message
                  </label>
                  {useHtmlCompose ? (
                    <div className={`rounded-xl border px-3 py-3 text-sm ${tone.subtle} ${tone.panelMuted}`}>
                      This email uses an HTML template with buttons and styling. Switch to{' '}
                      <button
                        type="button"
                        className="underline font-semibold"
                        onClick={() => setComposeView('preview')}
                      >
                        Preview
                      </button>{' '}
                      to review it, or pick another template.
                    </div>
                  ) : (
                    <textarea
                      id="compose-body"
                      value={bodyPlain}
                      onChange={(e) => setBodyPlain(e.target.value)}
                      rows={14}
                      className={`w-full min-h-[280px] rounded-xl border px-3 py-3 text-sm leading-relaxed resize-y ${tone.input}`}
                      placeholder="Write your message here…"
                    />
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-col min-h-[360px]">
              <p className={`mb-2 text-xs font-semibold ${tone.panelTitle}`}>
                {composeView === 'preview' ? 'Email preview' : 'Live preview'}
              </p>
              <div
                className={`flex-1 overflow-auto rounded-xl border ${isDark ? 'border-white/10 bg-white' : 'border-slate-200 bg-white'}`}
              >
                {previewHtml ? (
                  <iframe
                    title="Email preview"
                    srcDoc={previewHtml}
                    className="w-full min-h-[360px] h-full border-0 rounded-xl bg-white"
                    sandbox=""
                  />
                ) : (
                  <div className={`flex min-h-[360px] items-center justify-center px-6 text-center text-sm ${tone.panelMuted}`}>
                    Add a message or apply a template to see how the email will look.
                  </div>
                )}
              </div>
            </div>
          </div>

          {message && <p className={`text-sm ${tone.panelMuted}`}>{message}</p>}
        </motion.section>
      </div>
    </PipelineAuthShell>
  );
};

export default PipelineEmailWorkspace;
