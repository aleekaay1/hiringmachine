import React from 'react';
import { motion } from 'framer-motion';
import { Moon, Sun } from 'lucide-react';
import PipelineAuthShell from '../components/PipelineAuthShell';
import { Button } from '../components/UI';
import {
  listPipelineEmailSendLogsByCandidates,
  listPipelineIncomingEmailLogsByCandidates,
  listPipelineManualCandidates,
  type PipelineCandidate,
  type PipelineEmailSendLog,
  type PipelineIncomingEmailLog,
} from '../services/pipelineService';
import { sendEmail } from '../services/emailService';
import { appendEmailSignatureToHtml } from '../services/emailSignatureHtml';
import { normalizeMessageIdForHeader, subjectForReply } from '../services/inboundEmailFormat';
import { supabase } from '../services/supabaseClient';
import { EMAIL_TEMPLATES, mergeTemplate } from '../services/emailTemplates';
import { formatDateTimeCanadaEastern } from '../services/dateDisplay';

type WorkspaceThemeMode = 'dark' | 'light';
const WORKSPACE_THEME_STORAGE_KEY = 'pipeline-recruiter-workspace-theme';

function plainToHtml(text: string): string {
  return text.split('\n').map((line) => `<p>${line || '&nbsp;'}</p>`).join('');
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
  const [body, setBody] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [inReplyTo, setInReplyTo] = React.useState<string | null>(null);
  const [references, setReferences] = React.useState<string | null>(null);
  const [themeMode, setThemeMode] = React.useState<WorkspaceThemeMode>('dark');

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
  const candidateNameById = React.useMemo(
    () => new Map(candidates.map((candidate) => [candidate.id, candidate.full_name || 'Unknown Candidate'])),
    [candidates],
  );

  const loadWorkspace = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listPipelineManualCandidates();
      setCandidates(rows);
      const candidateIds = rows.map((row) => row.id);
      if (candidateIds.length === 0) {
        setIncomingLogs([]);
        setSendLogs([]);
        setSelectedCandidateId('');
        return;
      }
      const [incoming, sends] = await Promise.all([
        listPipelineIncomingEmailLogsByCandidates(candidateIds),
        listPipelineEmailSendLogsByCandidates(candidateIds),
      ]);
      setIncomingLogs(incoming);
      setSendLogs(sends);
      if (!selectedCandidateId || !rows.some((row) => row.id === selectedCandidateId)) {
        setSelectedCandidateId(rows[0]?.id || '');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [selectedCandidateId]);

  React.useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  React.useEffect(() => {
    if (!selectedCandidate) return;
    setToEmail(selectedCandidate.email || '');
    setSubject('Quick follow-up from Paz Organization');
    setBody(`Hi ${(selectedCandidate.full_name || '').trim() || 'there'},\n\n`);
    setInReplyTo(null);
    setReferences(null);
  }, [selectedCandidate?.id]);

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

  const applyTemplateToCompose = () => {
    if (!selectedCandidate || !templateId) return;
    const template = EMAIL_TEMPLATES.find((item) => item.id === templateId);
    if (!template) return;
    const nameParts = String(selectedCandidate.full_name || '').trim().split(/\s+/);
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ');
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
      { siteOrigin: window.location.origin },
    );
    const plain = merged.bodyHtml
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    setSubject(merged.subject);
    setBody(plain);
    setMessage(`Template applied: ${template.name}`);
  };

  const sendFromWorkspace = async () => {
    if (!selectedCandidate || !toEmail.trim() || !subject.trim() || !body.trim()) {
      setMessage('To, subject, and body are required.');
      return;
    }
    setSending(true);
    setMessage(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Not authenticated.');
      const nameParts = String(selectedCandidate.full_name || '').trim().split(/\s+/);
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ');
      const template = EMAIL_TEMPLATES.find((item) => item.id === templateId);
      const mergedTemplate = template
        ? mergeTemplate(
            template.subject,
            template.bodyHtml,
            {
              firstName,
              lastName,
              email: selectedCandidate.email || '',
              phone: selectedCandidate.phone || '',
            },
            undefined,
            { siteOrigin: window.location.origin },
          )
        : null;
      const result = await sendEmail(token, {
        to: toEmail.trim(),
        subject: subject.trim() || mergedTemplate?.subject || template?.subject || '',
        bodyHtml: body.trim()
          ? appendEmailSignatureToHtml(plainToHtml(body))
          : (mergedTemplate?.bodyHtml || ''),
        candidateId: selectedCandidate.id,
        trigger: 'pipeline_email_workspace',
        inReplyTo: inReplyTo || undefined,
        references: references || undefined,
      });
      if (!('ok' in result)) throw new Error(result.error || 'Failed to send email.');
      setMessage('Email sent.');
      await loadWorkspace();
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
          className="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr_380px]"
        >
          <section className={`rounded-2xl border p-3 space-y-2 ${tone.glassPanel}`}>
            <div className="flex items-center justify-between">
              <p className={`text-xs font-semibold ${tone.panelTitle}`}>Inbox ({filteredInbox.length})</p>
              <Button
                variant="outline"
                className={`!min-h-0 h-8 px-2 text-xs ${isDark ? '!border-white/20 !bg-white/10 !text-slate-100 hover:!bg-white/15' : ''}`}
                onClick={() => void loadWorkspace()}
                disabled={loading}
              >
                {loading ? 'Refreshing...' : 'Refresh'}
              </Button>
            </div>
            <div className="space-y-1.5 max-h-[64vh] overflow-auto">
              {filteredInbox.map((log) => (
                <button
                  key={log.id}
                  type="button"
                  onClick={() => {
                    setSelectedInboxId(log.id);
                    setSelectedCandidateId(log.candidate_id || '');
                    setToEmail(String(log.from_email || '').trim());
                    setSubject(subjectForReply(log.subject));
                    setBody(`Hi ${(candidateNameById.get(log.candidate_id || '') || 'there').trim()},\n\n`);
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
            <div className={`rounded-lg border p-2.5 ${tone.subtle}`}>
              <p className={`text-[11px] font-semibold ${tone.panelTitle}`}>Inbox detail</p>
              {selectedInbox ? (
                <div className={`mt-1 space-y-1 text-[11px] ${tone.panelMuted}`}>
                  <p><span className="font-semibold">From:</span> {selectedInbox.from_email}</p>
                  <p><span className="font-semibold">To:</span> {selectedInbox.to_email || '—'}</p>
                  <p><span className="font-semibold">Subject:</span> {selectedInbox.subject || '(no subject)'}</p>
                  <p className={`whitespace-pre-wrap ${tone.panelLabel}`}>{selectedInbox.snippet || 'No preview snippet.'}</p>
                </div>
              ) : <p className={`mt-1 text-[11px] ${tone.panelLabel}`}>Select an inbox row.</p>}
            </div>
          </section>

          <section className={`rounded-2xl border p-3 space-y-2 ${tone.glassPanel}`}>
            <p className={`text-xs font-semibold ${tone.panelTitle}`}>Outbox ({filteredOutbox.length})</p>
            <div className="space-y-1.5 max-h-[64vh] overflow-auto">
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
          </section>

          <section className={`rounded-2xl border p-4 space-y-2 ${tone.glassPanel}`}>
            <p className={`text-sm font-semibold ${tone.panelTitle}`}>Compose</p>
            <label className={`text-[11px] block ${tone.panelMuted}`}>
              Candidate
              <select
                value={selectedCandidateId}
                onChange={(e) => setSelectedCandidateId(e.target.value)}
                className={`mt-1 w-full rounded-lg border px-2 py-2 text-xs ${tone.input}`}
              >
                {candidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.full_name || 'Unknown Candidate'} ({candidate.email || candidate.phone || 'no contact'})
                  </option>
                ))}
              </select>
            </label>
            <label className={`text-[11px] block ${tone.panelMuted}`}>
              Template (optional)
              <div className="mt-1 flex gap-2">
                <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={`w-full rounded-lg border px-2 py-2 text-xs ${tone.input}`}>
                  <option value="">No template</option>
                  {EMAIL_TEMPLATES.map((template) => (
                    <option key={template.id} value={template.id}>{template.name}</option>
                  ))}
                </select>
                <Button
                  variant="outline"
                  className={`!min-h-0 h-9 px-2 text-xs whitespace-nowrap ${isDark ? '!border-white/20 !bg-white/10 !text-slate-100 hover:!bg-white/15' : ''}`}
                  onClick={applyTemplateToCompose}
                  disabled={!templateId || !selectedCandidate}
                >
                  Apply
                </Button>
              </div>
            </label>
            <input value={toEmail} onChange={(e) => setToEmail(e.target.value)} placeholder="To" className={`rounded-lg border px-2 py-2 text-xs ${tone.input}`} />
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className={`rounded-lg border px-2 py-2 text-xs ${tone.input}`} />
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} className={`rounded-lg border px-2 py-2 text-xs ${tone.input}`} placeholder="Write message..." />
            <div className="flex items-center justify-between">
              <p className={`text-[11px] ${tone.panelLabel}`}>Template merge + signature path reused on send.</p>
              <Button className="!min-h-0 h-8 px-3 text-xs" onClick={() => void sendFromWorkspace()} disabled={sending || !selectedCandidate}>
                {sending ? 'Sending...' : 'Send'}
              </Button>
            </div>
            {message && <p className={`text-xs ${tone.panelMuted}`}>{message}</p>}
            {selectedOutbox && (
              <div className={`rounded-lg border p-2.5 text-[11px] ${tone.subtle} ${tone.panelMuted}`}>
                <p className={`font-semibold ${tone.panelTitle}`}>Selected outbox detail</p>
                <p>To: {selectedOutbox.to_email}</p>
                <p>Status: {selectedOutbox.status}</p>
                <p>Candidate: {candidateNameById.get(selectedOutbox.candidate_id || '') || 'Unmapped'}</p>
                <p>When: {formatDateTimeCanadaEastern(selectedOutbox.created_at)}</p>
                {selectedOutbox.error_message && <p className="text-red-700 mt-1">{selectedOutbox.error_message}</p>}
              </div>
            )}
          </section>
        </motion.div>
      </div>
    </PipelineAuthShell>
  );
};

export default PipelineEmailWorkspace;
