import React, { useEffect, useMemo, useState } from 'react';
import { Inbox, Mail, RefreshCw, Reply, Send } from 'lucide-react';
import { Button } from './UI';
import { formatDateTimeCanadaEastern } from '../services/dateDisplay';
import {
  cleanSubjectForDisplay,
  splitInboundSnippet,
  normalizeMessageIdForHeader,
} from '../services/inboundEmailFormat';
import type { PipelineCallLog, PipelineEmailSendLog, PipelineIncomingEmailLog } from '../services/pipelineService';

export type CandidateMailboxProps = {
  incomingLogs: PipelineIncomingEmailLog[];
  sendLogs: PipelineEmailSendLog[];
  pipelineEmailLogs: PipelineCallLog[];
  syncing: boolean;
  syncMessage: string | null;
  onSync: () => void;
  onReply: (log: PipelineIncomingEmailLog) => void;
  candidateEmail: string;
};

function fromDisplayName(log: PipelineIncomingEmailLog): string {
  const h = log.raw_headers;
  if (h && typeof h === 'object' && typeof (h as Record<string, unknown>).from_name === 'string') {
    const n = String((h as Record<string, unknown>).from_name).trim();
    if (n) return n;
  }
  return log.from_email || 'Unknown';
}

export const CandidateMailbox: React.FC<CandidateMailboxProps> = ({
  incomingLogs,
  sendLogs,
  pipelineEmailLogs,
  syncing,
  syncMessage,
  onSync,
  onReply,
  candidateEmail,
}) => {
  const [tab, setTab] = useState<'inbox' | 'outbox'>('inbox');
  const [selectedIncomingId, setSelectedIncomingId] = useState<string | null>(null);
  const [selectedOutboxKey, setSelectedOutboxKey] = useState<string | null>(null);

  const sortedIncoming = useMemo(
    () => [...incomingLogs].sort((a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime()),
    [incomingLogs],
  );

  const selectedIncoming = useMemo(
    () => sortedIncoming.find((x) => x.id === selectedIncomingId) ?? sortedIncoming[0] ?? null,
    [sortedIncoming, selectedIncomingId],
  );

  useEffect(() => {
    if (sortedIncoming.length && !selectedIncomingId) {
      setSelectedIncomingId(sortedIncoming[0].id);
    }
  }, [sortedIncoming, selectedIncomingId]);

  const preview = useMemo(() => {
    if (!selectedIncoming?.snippet) return { latest: '', quoted: null as string | null };
    return splitInboundSnippet(selectedIncoming.snippet);
  }, [selectedIncoming]);

  const selectedSend = useMemo(
    () => (selectedOutboxKey && !selectedOutboxKey.startsWith('pl-') ? sendLogs.find((x) => x.id === selectedOutboxKey) ?? null : null),
    [sendLogs, selectedOutboxKey],
  );

  const selectedPipelineLog = useMemo(() => {
    if (!selectedOutboxKey?.startsWith('pl-')) return null;
    const id = selectedOutboxKey.slice(3);
    return pipelineEmailLogs.find((l) => l.id === id) ?? null;
  }, [pipelineEmailLogs, selectedOutboxKey]);

  return (
    <section className="rounded-2xl border border-white/15 bg-slate-900/55 shadow-[0_24px_60px_-30px_rgba(15,23,42,0.85)] backdrop-blur-xl overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-slate-950/45 px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#60a5fa]/15 text-[#93c5fd]">
            <Mail size={18} aria-hidden />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-100 tracking-tight">Candidate mailbox</h3>
            <p className="text-[11px] text-slate-400 truncate">Inbox (IMAP) · Outbox (SMTP + pipeline)</p>
          </div>
        </div>
        <Button
          variant="outline"
          className="!min-h-0 h-9 shrink-0 gap-1.5 text-xs font-semibold border-slate-500/50 bg-slate-900/20 text-slate-100 hover:bg-slate-800/50"
          onClick={() => void onSync()}
          disabled={syncing}
        >
          <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} aria-hidden />
          {syncing ? 'Syncing…' : 'Sync inbox'}
        </Button>
      </div>

      {syncMessage && (
        <div className="px-4 py-2 text-xs text-amber-200 bg-amber-500/10 border-b border-amber-400/20">{syncMessage}</div>
      )}

      <div className="flex border-b border-white/10 bg-slate-900/35">
        <button
          type="button"
          onClick={() => setTab('inbox')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold transition ${
            tab === 'inbox' ? 'text-sky-300 border-b-2 border-sky-400 bg-slate-900/60' : 'text-slate-400 hover:text-slate-100'
          }`}
        >
          <Inbox size={15} aria-hidden />
          Inbox
          <span className="rounded-full bg-slate-700/80 px-1.5 py-0 text-[10px] text-slate-100">{incomingLogs.length}</span>
        </button>
        <button
          type="button"
          onClick={() => setTab('outbox')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold transition ${
            tab === 'outbox' ? 'text-sky-300 border-b-2 border-sky-400 bg-slate-900/60' : 'text-slate-400 hover:text-slate-100'
          }`}
        >
          <Send size={15} aria-hidden />
          Outbox
          <span className="rounded-full bg-slate-700/80 px-1.5 py-0 text-[10px] text-slate-100">
            {sendLogs.length + pipelineEmailLogs.length}
          </span>
        </button>
      </div>

      {tab === 'inbox' && (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,280px)_1fr] min-h-[320px] max-h-[min(72vh,560px)]">
          <div className="border-b lg:border-b-0 lg:border-r border-white/10 overflow-y-auto bg-slate-950/35">
            {sortedIncoming.length === 0 ? (
              <p className="p-4 text-xs text-slate-400">
                No messages matched this candidate yet. Sync pulls recent IMAP mail and maps by sender email.
              </p>
            ) : (
              <ul className="divide-y divide-white/5">
                {sortedIncoming.map((log) => {
                  const active = selectedIncoming?.id === log.id;
                  const subj = cleanSubjectForDisplay(log.subject);
                  return (
                    <li key={log.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedIncomingId(log.id)}
                        className={`w-full text-left px-3 py-2.5 transition hover:bg-slate-800/50 ${
                          active ? 'bg-slate-800/60 border-l-[3px] border-l-sky-400 shadow-sm' : ''
                        }`}
                      >
                        <p className="text-[12px] font-semibold text-slate-100 line-clamp-2 leading-snug">{subj}</p>
                        <p className="text-[11px] text-slate-300 mt-0.5 truncate">{fromDisplayName(log)}</p>
                        <p className="text-[10px] text-slate-500 mt-1">{formatDateTimeCanadaEastern(log.received_at)}</p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="flex flex-col min-h-0 bg-slate-900/30">
            {!selectedIncoming ? (
              <div className="p-6 text-sm text-slate-400">Select a message.</div>
            ) : (
              <>
                <div className="shrink-0 border-b border-white/10 px-4 py-3 space-y-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h4 className="text-base font-bold text-slate-100 leading-snug pr-2">
                      {cleanSubjectForDisplay(selectedIncoming.subject)}
                    </h4>
                    <Button
                      type="button"
                      variant="outline"
                      className="!min-h-0 h-8 gap-1.5 text-xs shrink-0 border-sky-400/40 bg-slate-900/20 text-sky-300"
                      onClick={() => onReply(selectedIncoming)}
                    >
                      <Reply size={14} aria-hidden />
                      Reply
                    </Button>
                  </div>
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
                    <div className="flex gap-2">
                      <dt className="text-slate-500 shrink-0 w-12 font-semibold">From</dt>
                      <dd className="text-slate-100 font-semibold truncate">{fromDisplayName(selectedIncoming)}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="text-slate-500 shrink-0 w-12 font-semibold">Email</dt>
                      <dd className="text-slate-200 font-medium truncate">{selectedIncoming.from_email}</dd>
                    </div>
                    <div className="flex gap-2 sm:col-span-2">
                      <dt className="text-slate-500 shrink-0 w-12 font-semibold">To</dt>
                      <dd className="text-slate-200 truncate">{selectedIncoming.to_email || '—'}</dd>
                    </div>
                    <div className="flex gap-2 sm:col-span-2">
                      <dt className="text-slate-500 shrink-0 w-12 font-semibold">CC</dt>
                      <dd className="text-slate-200 truncate">{selectedIncoming.cc_email || '—'}</dd>
                    </div>
                    <div className="flex gap-2 sm:col-span-2">
                      <dt className="text-slate-500 shrink-0 w-12 font-semibold">Date</dt>
                      <dd className="text-slate-200">{formatDateTimeCanadaEastern(selectedIncoming.received_at)}</dd>
                    </div>
                    <div className="flex gap-2 sm:col-span-2">
                      <dt className="text-slate-500 shrink-0 w-12">Msg-ID</dt>
                      <dd className="text-slate-400 font-mono text-[10px] break-all">
                        {normalizeMessageIdForHeader(selectedIncoming.message_id) || selectedIncoming.message_id}
                      </dd>
                    </div>
                  </dl>
                  <p className="text-[10px] text-slate-500">Candidate on file: {candidateEmail}</p>
                </div>
                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">Message</p>
                    <div className="rounded-xl border border-white/10 bg-slate-950/40 px-3 py-3 text-[13px] text-slate-200 leading-relaxed whitespace-pre-wrap">
                      {preview.latest || <span className="text-slate-500 italic">No preview text extracted.</span>}
                    </div>
                  </div>
                  {preview.quoted && (
                    <details className="rounded-xl border border-dashed border-white/15 bg-slate-950/25">
                      <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold text-slate-300 select-none">
                        Earlier thread / quoted content
                      </summary>
                      <div className="px-3 pb-3 text-[11px] text-slate-300 leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto border-t border-white/10">
                        {preview.quoted}
                      </div>
                    </details>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {tab === 'outbox' && (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,280px)_1fr] min-h-[280px] max-h-[min(60vh,480px)]">
          <div className="border-b lg:border-b-0 lg:border-r border-white/10 overflow-y-auto bg-slate-950/35">
            {sendLogs.length === 0 && pipelineEmailLogs.length === 0 ? (
              <p className="p-4 text-xs text-slate-400">No outbound mail logged for this candidate yet.</p>
            ) : (
              <ul className="divide-y divide-white/5">
                {sendLogs.map((log) => {
                  const active = selectedOutboxKey === log.id;
                  return (
                    <li key={log.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedOutboxKey(log.id)}
                        className={`w-full text-left px-3 py-2.5 transition hover:bg-slate-800/50 ${
                          active ? 'bg-slate-800/60 border-l-[3px] border-l-emerald-500 shadow-sm' : ''
                        }`}
                      >
                        <p className="text-[11px] font-semibold text-emerald-800 uppercase tracking-wide">SMTP log</p>
                        <p className="text-[12px] font-semibold text-slate-100 line-clamp-2 mt-0.5">{log.subject}</p>
                        <p className="text-[11px] text-slate-300 truncate">To {log.to_email}</p>
                        <p className="text-[10px] mt-1">
                          <span className={log.status === 'sent' ? 'text-emerald-700 font-medium' : 'text-red-600 font-medium'}>
                            {log.status}
                          </span>
                          <span className="text-slate-400"> · {formatDateTimeCanadaEastern(log.created_at)}</span>
                        </p>
                      </button>
                    </li>
                  );
                })}
                {pipelineEmailLogs.map((log) => {
                  const req = (log.request_payload || {}) as Record<string, unknown>;
                  const key = `pl-${log.id}`;
                  const active = selectedOutboxKey === key;
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        onClick={() => setSelectedOutboxKey(key)}
                        className={`w-full text-left px-3 py-2.5 transition hover:bg-slate-800/50 ${
                          active ? 'bg-slate-800/60 border-l-[3px] border-l-slate-400 shadow-sm' : ''
                        }`}
                      >
                        <p className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide">Pipeline</p>
                        <p className="text-[12px] font-semibold text-slate-100 line-clamp-2 mt-0.5">{String(req.subject || '—')}</p>
                        <p className="text-[11px] text-slate-300 truncate">To {String(req.to || '—')}</p>
                        <p className="text-[10px] text-slate-400 mt-1">{formatDateTimeCanadaEastern(log.created_at)}</p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="overflow-y-auto bg-slate-900/30 p-4 text-sm min-h-[200px]">
            {selectedSend ? (
              <div className="space-y-2">
                <h4 className="font-bold text-slate-100">{selectedSend.subject}</h4>
                <dl className="grid gap-1.5 text-[12px]">
                  <div className="flex gap-2">
                    <dt className="text-slate-500 w-20">Status</dt>
                    <dd className={selectedSend.status === 'sent' ? 'text-emerald-700 font-semibold' : 'text-red-600 font-semibold'}>
                      {selectedSend.status}
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-slate-500 w-20">To</dt>
                    <dd className="text-slate-200">{selectedSend.to_email}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-slate-500 w-20">CC</dt>
                    <dd className="text-slate-200">{selectedSend.cc_email || '—'}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-slate-500 w-20">From</dt>
                    <dd className="text-slate-200">{selectedSend.from_email}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-slate-500 w-20">Trigger</dt>
                    <dd className="text-slate-200 font-mono text-[11px] break-all">{selectedSend.trigger_label || '—'}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-slate-500 w-20">Source</dt>
                    <dd className="text-slate-200">{selectedSend.source}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-slate-500 w-20">Sent</dt>
                    <dd className="text-slate-200">{formatDateTimeCanadaEastern(selectedSend.created_at)}</dd>
                  </div>
                  {selectedSend.error_message && (
                    <div className="rounded-lg bg-red-50 border border-red-100 p-2 text-red-800 text-[11px]">{selectedSend.error_message}</div>
                  )}
                </dl>
              </div>
            ) : selectedPipelineLog ? (
              <div className="space-y-2">
                {(() => {
                  const req = (selectedPipelineLog.request_payload || {}) as Record<string, unknown>;
                  return (
                    <>
                      <h4 className="font-bold text-slate-100">{String(req.subject || '—')}</h4>
                      <p className="text-[12px] text-slate-300">
                        Logged from pipeline send · template{' '}
                        <span className="font-mono bg-slate-100 px-1 rounded">{String(req.templateId || '—')}</span>
                      </p>
                      <dl className="grid gap-1 text-[12px]">
                        <div className="flex gap-2">
                          <dt className="text-slate-500 w-20">To</dt>
                            <dd className="text-slate-200">{String(req.to || '—')}</dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="text-slate-500 w-20">CC</dt>
                            <dd className="text-slate-200">{String(req.cc || '—')}</dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="text-slate-500 w-20">When</dt>
                            <dd className="text-slate-200">{formatDateTimeCanadaEastern(selectedPipelineLog.created_at)}</dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="text-slate-500 w-20">Outcome</dt>
                            <dd className="capitalize text-slate-200">{selectedPipelineLog.outcome || '—'}</dd>
                        </div>
                      </dl>
                    </>
                  );
                })()}
              </div>
            ) : (
              <p className="text-slate-400 text-xs">Select an outbound item.</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
