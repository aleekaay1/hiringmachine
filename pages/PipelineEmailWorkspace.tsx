import React from 'react';
import PipelineAuthShell from '../components/PipelineAuthShell';
import { Button } from '../components/UI';
import { CandidateMailbox } from '../components/CandidateMailbox';
import {
  listPipelineCallLogs,
  listPipelineEmailSendLogs,
  listPipelineIncomingEmailLogs,
  listPipelineManualCandidates,
  type PipelineCallLog,
  type PipelineCandidate,
  type PipelineEmailSendLog,
  type PipelineIncomingEmailLog,
} from '../services/pipelineService';
import { sendEmail } from '../services/emailService';
import { appendEmailSignatureToHtml } from '../services/emailSignatureHtml';
import { normalizeMessageIdForHeader, subjectForReply } from '../services/inboundEmailFormat';
import { supabase } from '../services/supabaseClient';

function plainToHtml(text: string): string {
  return text.split('\n').map((line) => `<p>${line || '&nbsp;'}</p>`).join('');
}

const PipelineEmailWorkspace: React.FC = () => {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [candidates, setCandidates] = React.useState<PipelineCandidate[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = React.useState<string | null>(null);
  const [incomingLogs, setIncomingLogs] = React.useState<PipelineIncomingEmailLog[]>([]);
  const [sendLogs, setSendLogs] = React.useState<PipelineEmailSendLog[]>([]);
  const [pipelineEmailLogs, setPipelineEmailLogs] = React.useState<PipelineCallLog[]>([]);
  const [syncing, setSyncing] = React.useState(false);
  const [syncMessage, setSyncMessage] = React.useState<string | null>(null);
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

  const loadCandidates = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listPipelineManualCandidates();
      setCandidates(rows);
      if (!selectedCandidateId || !rows.some((row) => row.id === selectedCandidateId)) {
        setSelectedCandidateId(rows[0]?.id || null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [selectedCandidateId]);

  const loadCandidateMail = React.useCallback(async (candidateId: string) => {
    setError(null);
    try {
      const [incoming, sends, callLogs] = await Promise.all([
        listPipelineIncomingEmailLogs(candidateId),
        listPipelineEmailSendLogs(candidateId),
        listPipelineCallLogs({
          candidateIds: [candidateId],
          actions: ['email_sent', 'email_send_failed'],
          limit: 500,
        }),
      ]);
      setIncomingLogs(incoming);
      setSendLogs(sends);
      setPipelineEmailLogs(callLogs);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  React.useEffect(() => {
    void loadCandidates();
  }, [loadCandidates]);

  React.useEffect(() => {
    if (!selectedCandidateId) return;
    void loadCandidateMail(selectedCandidateId);
  }, [selectedCandidateId, loadCandidateMail]);

  React.useEffect(() => {
    if (!selectedCandidate) return;
    setToEmail(selectedCandidate.email || '');
    setSubject('Quick follow-up from Paz Organization');
    setBody(`Hi ${(selectedCandidate.full_name || '').trim() || 'there'},\n\n`);
    setInReplyTo(null);
    setReferences(null);
  }, [selectedCandidate?.id]);

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
      const result = await sendEmail(token, {
        to: toEmail.trim(),
        subject: subject.trim(),
        bodyHtml: appendEmailSignatureToHtml(plainToHtml(body)),
        candidateId: selectedCandidate.id,
        trigger: 'pipeline_email_workspace',
        inReplyTo: inReplyTo || undefined,
        references: references || undefined,
      });
      if (!('ok' in result)) throw new Error(result.error || 'Failed to send email.');
      setMessage('Email sent.');
      await loadCandidateMail(selectedCandidate.id);
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
          <p className="text-xs text-[#365274]">Pipeline inbox/outbox plus recruiter send shell.</p>
        </div>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div className="grid gap-4 xl:grid-cols-[300px_1fr]">
          <aside className="rounded-2xl border border-[#d8e8fa] bg-white p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-[#0B1B34]">Candidates</p>
              <Button variant="outline" className="!min-h-0 h-8 px-2 text-xs" onClick={() => void loadCandidates()} disabled={loading}>
                Refresh
              </Button>
            </div>
            <div className="space-y-1.5 max-h-[70vh] overflow-auto">
              {candidates.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  onClick={() => setSelectedCandidateId(candidate.id)}
                  className={`w-full rounded-lg border px-2 py-2 text-left ${
                    selectedCandidateId === candidate.id ? 'border-[#9dc6ef] bg-[#e8f3ff]' : 'border-slate-200 bg-white'
                  }`}
                >
                  <p className="text-xs font-semibold text-slate-800 truncate">{candidate.full_name || 'Unknown Candidate'}</p>
                  <p className="text-[10px] text-slate-500 truncate">{candidate.email || candidate.phone || 'No contact info'}</p>
                </button>
              ))}
              {!candidates.length && <p className="text-xs text-slate-500">No manual candidates.</p>}
            </div>
          </aside>

          <section className="space-y-4">
            <div className="rounded-2xl border border-[#d8e8fa] bg-white p-4 space-y-2">
              <p className="text-sm font-semibold text-[#0B1B34]">Quick send</p>
              <div className="grid gap-2">
                <input value={toEmail} onChange={(e) => setToEmail(e.target.value)} placeholder="To" className="rounded-lg border border-[#c7ddf5] px-2 py-2 text-xs" />
                <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className="rounded-lg border border-[#c7ddf5] px-2 py-2 text-xs" />
                <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} className="rounded-lg border border-[#c7ddf5] px-2 py-2 text-xs" placeholder="Write message..." />
                <div className="flex items-center justify-between">
                  <p className="text-[11px] text-slate-500">Signature auto-appended.</p>
                  <Button className="!min-h-0 h-8 px-3 text-xs" onClick={() => void sendFromWorkspace()} disabled={sending || !selectedCandidate}>
                    {sending ? 'Sending...' : 'Send'}
                  </Button>
                </div>
                {message && <p className="text-xs text-[#365274]">{message}</p>}
              </div>
            </div>

            <CandidateMailbox
              incomingLogs={incomingLogs}
              sendLogs={sendLogs}
              pipelineEmailLogs={pipelineEmailLogs}
              syncing={syncing}
              syncMessage={syncMessage}
              onSync={async () => {
                if (!selectedCandidateId) return;
                setSyncing(true);
                setSyncMessage('Refreshing inbox for selected candidate...');
                await loadCandidateMail(selectedCandidateId);
                setSyncing(false);
                setSyncMessage('Inbox refreshed.');
              }}
              onReply={(log) => {
                setToEmail(String(log.from_email || '').trim());
                setSubject(subjectForReply(log.subject));
                setBody(`Hi ${(selectedCandidate?.full_name || '').trim() || 'there'},\n\n`);
                const mid = normalizeMessageIdForHeader(log.message_id);
                setInReplyTo(mid);
                setReferences(mid);
                setMessage('Reply headers prepared for this thread.');
              }}
              candidateEmail={String(selectedCandidate?.email || '').trim()}
            />
          </section>
        </div>
      </div>
    </PipelineAuthShell>
  );
};

export default PipelineEmailWorkspace;
