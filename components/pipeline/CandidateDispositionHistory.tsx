import React from 'react';
import { MessageSquare } from 'lucide-react';
import { formatDateTimeCanadaEastern } from '../../services/dateDisplay';
import { callRecordsForCandidate, dispositionBadgeClass } from '../../services/callHistoryRows';
import type { PipelineCallRecord } from '../../services/pipelineService';

export type CandidateDispositionHistoryTone = {
  panelTitle: string;
  panelMuted: string;
  panelLabel: string;
  subtle: string;
};

type CandidateDispositionHistoryProps = {
  candidateId: string;
  records: PipelineCallRecord[];
  tone: CandidateDispositionHistoryTone;
  maxItems?: number;
};

const CandidateDispositionHistory: React.FC<CandidateDispositionHistoryProps> = ({
  candidateId,
  records,
  tone,
  maxItems = 12,
}) => {
  const history = React.useMemo(
    () => callRecordsForCandidate(records, candidateId).slice(0, maxItems),
    [records, candidateId, maxItems],
  );

  if (!history.length) return null;

  const latest = history[0];

  return (
    <div className={`rounded-2xl border p-4 ${tone.subtle}`} data-tour="call-disposition-history">
      <div className="mb-3 flex items-center gap-2">
        <MessageSquare size={16} className="text-[#4e9ae8]" />
        <div>
          <p className={`text-xs font-semibold uppercase tracking-wide ${tone.panelLabel}`}>Your call notes</p>
          <p className={`text-[11px] ${tone.panelMuted}`}>
            {history.length} disposition{history.length === 1 ? '' : 's'} on this lead
          </p>
        </div>
      </div>

      {latest && (
        <div className="mb-3 rounded-xl border border-amber-200/80 bg-gradient-to-br from-amber-50 to-[#fffbeb] px-3 py-3 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-800">Latest call</span>
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${dispositionBadgeClass(
                String(latest.disposition || ''),
              )}`}
            >
              {latest.disposition || '—'}
            </span>
            <span className="text-[11px] tabular-nums text-amber-900/80">
              {formatDateTimeCanadaEastern(latest.disposed_at || latest.created_at)}
            </span>
          </div>
          {latest.comment?.trim() ? (
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[#0B1B34]">{latest.comment.trim()}</p>
          ) : (
            <p className={`mt-2 text-xs italic ${tone.panelMuted}`}>No comment on the latest disposition.</p>
          )}
        </div>
      )}

      {history.length > 1 && (
        <div className="space-y-2">
          <p className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${tone.panelLabel}`}>Earlier calls</p>
          <ul className="max-h-56 space-y-2 overflow-y-auto pr-1">
            {history.slice(1).map((record) => (
              <li
                key={record.id}
                className="rounded-lg border border-[#e8f1fb] bg-white/90 px-3 py-2.5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${dispositionBadgeClass(
                      String(record.disposition || ''),
                    )}`}
                  >
                    {record.disposition || '—'}
                  </span>
                  <span className={`text-[11px] tabular-nums ${tone.panelMuted}`}>
                    {formatDateTimeCanadaEastern(record.disposed_at || record.created_at)}
                  </span>
                </div>
                {record.comment?.trim() ? (
                  <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-[#0B1B34]">{record.comment.trim()}</p>
                ) : (
                  <p className={`mt-1 text-[11px] italic ${tone.panelMuted}`}>No comment</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default CandidateDispositionHistory;
