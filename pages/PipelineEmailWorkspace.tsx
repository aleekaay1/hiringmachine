import React from 'react';
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

  return (
    <PipelineAuthShell
      title="Email Workspace"
      subtitle="Sign in to use recruiter email workflow"
      redirectPath="/pipeline/email"
    >
      <div className="mx-auto w-full max-w-[1460px] p-4 space-y-4">
        <div className="rounded-3xl border border-[#d5e5f8] bg-white/80 backdrop-blur-xl p-4 shadow-[0_18px_45px_-28px_rgba(11,27,52,0.35)]">
          <h1 className="text-lg font-semibold text-[#0B1B34]">Email Workspace</h1>
          <p className="text-xs text-[#365274]">Operational inbox/outbox and candidate compose flow with template support.</p>
        </div>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div className="rounded-2xl border border-[#d8e8fa] bg-white p-3">
          <div className="grid gap-2 md:grid-cols-5">
            <input
              value={listQuery}
              onChange={(e) => setListQuery(e.target.value)}
              placeholder="Search email/subject/status"
              className="rounded-lg border border-[#c7ddf5] px-2 py-2 text-xs md:col-span-2"
            />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | 'sent' | 'failed' | 'other')} className="rounded-lg border border-[#c7ddf5] px-2 py-2 text-xs">
              <option value="all">Any status</option>
              <option value="sent">Sent only</option>
              <option value="failed">Failed only</option>
              <option value="other">Other statuses</option>
            </select>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="rounded-lg border border-[#c7ddf5] px-2 py-2 text-xs" />
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="rounded-lg border border-[#c7ddf5] px-2 py-2 text-xs" />
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1fr_1fr_380px]">
          <section className="rounded-2xl border border-[#d8e8fa] bg-white p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-[#0B1B34]">Inbox ({filteredInbox.length})</p>
              <Button variant="outline" className="!min-h-0 h-8 px-2 text-xs" onClick={() => void loadWorkspace()} disabled={loading}>
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
                    selectedInboxId === log.id ? 'border-[#9dc6ef] bg-[#e8f3ff]' : 'border-slate-200 bg-white'
                  }`}
                >
                  <p className="text-[11px] font-semibold text-slate-800 truncate">{log.subject || '(no subject)'}</p>
                  <p className="text-[10px] text-slate-600 truncate">{log.from_email}</p>
                  <p className="text-[10px] text-slate-500 truncate">
                    {candidateNameById.get(log.candidate_id || '') || 'Unmapped candidate'} · {formatDateTimeCanadaEastern(log.received_at)}
                  </p>
                </button>
              ))}
              {!filteredInbox.length && (
                <p className="rounded-lg border border-dashed border-slate-300 px-2 py-2 text-xs text-slate-500">
                  No inbox messages match current filters.
                </p>
              )}
            </div>
            <div className="rounded-lg border border-[#dce9f8] bg-[#f8fbff] p-2.5">
              <p className="text-[11px] font-semibold text-[#0B1B34]">Inbox detail</p>
              {selectedInbox ? (
                <div className="mt-1 space-y-1 text-[11px] text-slate-700">
                  <p><span className="font-semibold">From:</span> {selectedInbox.from_email}</p>
                  <p><span className="font-semibold">To:</span> {selectedInbox.to_email || '—'}</p>
                  <p><span className="font-semibold">Subject:</span> {selectedInbox.subject || '(no subject)'}</p>
                  <p className="text-slate-600 whitespace-pre-wrap">{selectedInbox.snippet || 'No preview snippet.'}</p>
                </div>
              ) : <p className="mt-1 text-[11px] text-slate-500">Select an inbox row.</p>}
            </div>
          </section>

          <section className="rounded-2xl border border-[#d8e8fa] bg-white p-3 space-y-2">
            <p className="text-xs font-semibold text-[#0B1B34]">Outbox ({filteredOutbox.length})</p>
            <div className="space-y-1.5 max-h-[64vh] overflow-auto">
              {filteredOutbox.map((log) => (
                <button
                  key={log.id}
                  type="button"
                  onClick={() => setSelectedOutboxId(log.id)}
                  className={`w-full rounded-lg border px-2 py-2 text-left ${
                    selectedOutboxId === log.id ? 'border-[#9dc6ef] bg-[#e8f3ff]' : 'border-slate-200 bg-white'
                  }`}
                >
                  <p className="text-[11px] font-semibold text-slate-800 truncate">{log.subject}</p>
                  <p className="text-[10px] text-slate-600 truncate">{log.to_email}</p>
                  <p className="text-[10px] text-slate-500 truncate">
                    <span className={String(log.status).toLowerCase() === 'sent' ? 'text-emerald-700' : 'text-red-700'}>
                      {log.status}
                    </span>
                    {' · '}
                    {formatDateTimeCanadaEastern(log.created_at)}
                  </p>
                </button>
              ))}
              {!filteredOutbox.length && (
                <p className="rounded-lg border border-dashed border-slate-300 px-2 py-2 text-xs text-slate-500">
                  No outbox messages match current filters.
                </p>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-[#d8e8fa] bg-white p-4 space-y-2">
            <p className="text-sm font-semibold text-[#0B1B34]">Compose</p>
            <label className="text-[11px] text-[#365274] block">
              Candidate
              <select
                value={selectedCandidateId}
                onChange={(e) => setSelectedCandidateId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[#c7ddf5] px-2 py-2 text-xs"
              >
                {candidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.full_name || 'Unknown Candidate'} ({candidate.email || candidate.phone || 'no contact'})
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[11px] text-[#365274] block">
              Template (optional)
              <div className="mt-1 flex gap-2">
                <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="w-full rounded-lg border border-[#c7ddf5] px-2 py-2 text-xs">
                  <option value="">No template</option>
                  {EMAIL_TEMPLATES.map((template) => (
                    <option key={template.id} value={template.id}>{template.name}</option>
                  ))}
                </select>
                <Button variant="outline" className="!min-h-0 h-9 px-2 text-xs whitespace-nowrap" onClick={applyTemplateToCompose} disabled={!templateId || !selectedCandidate}>
                  Apply
                </Button>
              </div>
            </label>
            <input value={toEmail} onChange={(e) => setToEmail(e.target.value)} placeholder="To" className="rounded-lg border border-[#c7ddf5] px-2 py-2 text-xs" />
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className="rounded-lg border border-[#c7ddf5] px-2 py-2 text-xs" />
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} className="rounded-lg border border-[#c7ddf5] px-2 py-2 text-xs" placeholder="Write message..." />
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-slate-500">Template merge + signature path reused on send.</p>
              <Button className="!min-h-0 h-8 px-3 text-xs" onClick={() => void sendFromWorkspace()} disabled={sending || !selectedCandidate}>
                {sending ? 'Sending...' : 'Send'}
              </Button>
            </div>
            {message && <p className="text-xs text-[#365274]">{message}</p>}
            {selectedOutbox && (
              <div className="rounded-lg border border-[#dce9f8] bg-[#f8fbff] p-2.5 text-[11px] text-slate-700">
                <p className="font-semibold text-[#0B1B34]">Selected outbox detail</p>
                <p>To: {selectedOutbox.to_email}</p>
                <p>Status: {selectedOutbox.status}</p>
                <p>Candidate: {candidateNameById.get(selectedOutbox.candidate_id || '') || 'Unmapped'}</p>
                <p>When: {formatDateTimeCanadaEastern(selectedOutbox.created_at)}</p>
                {selectedOutbox.error_message && <p className="text-red-700 mt-1">{selectedOutbox.error_message}</p>}
              </div>
            )}
          </section>
        </div>
      </div>
    </PipelineAuthShell>
  );
};

export default PipelineEmailWorkspace;
