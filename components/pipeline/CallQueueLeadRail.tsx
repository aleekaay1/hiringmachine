import React from 'react';
import { queueLeadChipClass, queueLeadChipLabel } from '../../services/callHistoryRows';
import type { PipelineCallRecord, PipelineCandidate } from '../../services/pipelineService';

export type CallQueueLeadRailTone = {
  panelMuted: string;
  panelLabel: string;
  subtle: string;
};

type CallQueueLeadRailProps = {
  leads: PipelineCandidate[];
  selectedId: string | null;
  latestByCandidate: Map<string, PipelineCallRecord>;
  onSelect: (candidateId: string) => void;
  tone: CallQueueLeadRailTone;
};

function shortName(name: string): string {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Lead';
  if (parts.length === 1) return parts[0].slice(0, 14);
  return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
}

const CallQueueLeadRail: React.FC<CallQueueLeadRailProps> = ({
  leads,
  selectedId,
  latestByCandidate,
  onSelect,
  tone,
}) => {
  const railRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!selectedId || !railRef.current) return;
    const chip = railRef.current.querySelector(`[data-lead-id="${selectedId}"]`);
    chip?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [selectedId]);

  if (!leads.length) return null;

  return (
    <div className={`mt-3 rounded-xl border p-3 ${tone.subtle}`} data-tour="call-queue-rail">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className={`text-[10px] font-semibold uppercase tracking-[0.16em] ${tone.panelLabel}`}>Batch queue</p>
        <div className={`flex flex-wrap gap-2 text-[10px] ${tone.panelMuted}`}>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-slate-300" /> New
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-yellow-400" /> Retry
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-emerald-500" /> Booked
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-rose-500" /> Declined
          </span>
        </div>
      </div>
      <div ref={railRef} className="flex gap-2 overflow-x-auto pb-1">
        {leads.map((lead, index) => {
          const latest = latestByCandidate.get(lead.id);
          const hasDisposition = Boolean(latest);
          const disposition = latest?.disposition ?? null;
          const selected = lead.id === selectedId;
          return (
            <button
              key={lead.id}
              type="button"
              data-lead-id={lead.id}
              onClick={() => onSelect(lead.id)}
              className={`flex min-w-[108px] max-w-[140px] shrink-0 flex-col rounded-xl border px-2.5 py-2 text-left transition ${
                queueLeadChipClass(disposition, hasDisposition)
              } ${selected ? 'shadow-md ring-2 ring-[#4e9ae8] ring-offset-1' : 'hover:brightness-[0.98]'}`}
            >
              <span className="truncate text-[11px] font-semibold">{shortName(lead.full_name || '')}</span>
              <span className="mt-0.5 truncate text-[10px] opacity-90">
                {queueLeadChipLabel(disposition, hasDisposition)}
              </span>
              <span className="mt-1 text-[9px] tabular-nums opacity-70">#{index + 1}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default CallQueueLeadRail;
