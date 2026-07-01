import React from 'react';
import {
  queueLeadCategory,
  queueLeadChipLabel,
  type QueueLeadCategory,
} from '../../services/callHistoryRows';
import { formatDateTimeCanadaEastern } from '../../services/dateDisplay';
import type { PipelineCallRecord, PipelineCandidate } from '../../services/pipelineService';

export type WebinarPipelineStage = 'booked' | 'showed' | 'questionnaire';

export type CallQueueLeadRailTone = {
  panelMuted: string;
  panelLabel: string;
  panelTitle: string;
  subtle: string;
};

type QueueLeadStyle = {
  accent: string;
  badge: string;
  legendDot: string;
};

type CallQueueLeadRailProps = {
  leads: PipelineCandidate[];
  selectedId: string | null;
  latestByCandidate: Map<string, PipelineCallRecord>;
  webinarStageByCandidate?: Map<string, WebinarPipelineStage>;
  legendFilter?: QueueLeadCategory | null;
  onLegendFilterChange?: (filter: QueueLeadCategory | null) => void;
  onSelect: (candidateId: string) => void;
  tone: CallQueueLeadRailTone;
};

const LEGEND: Array<{ key: QueueLeadCategory; label: string; dot: string }> = [
  { key: 'new', label: 'New', dot: 'bg-slate-400' },
  { key: 'retry', label: 'Retry', dot: 'bg-amber-500' },
  { key: 'callback', label: 'Callback', dot: 'bg-orange-500' },
  { key: 'booked', label: 'Booked', dot: 'bg-emerald-600' },
  { key: 'declined', label: 'Declined', dot: 'bg-rose-600' },
];

const WEBINAR_STAGE_BADGE: Record<WebinarPipelineStage, string> = {
  booked: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  showed: 'bg-teal-50 text-teal-800 border-teal-200',
  questionnaire: 'bg-violet-50 text-violet-900 border-violet-200',
};

const WEBINAR_STAGE_LABEL: Record<WebinarPipelineStage, string> = {
  booked: 'Webinar booked',
  showed: 'Webinar showed',
  questionnaire: 'Questionnaire',
};

function shortName(name: string): string {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Lead';
  if (parts.length === 1) return parts[0].slice(0, 16);
  return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
}

function webinarStageForLead(
  leadId: string,
  disposition: string | null | undefined,
  webinarStageByCandidate?: Map<string, WebinarPipelineStage>,
): WebinarPipelineStage | null {
  if (String(disposition || '').trim().toLowerCase() !== 'booked') return null;
  return webinarStageByCandidate?.get(leadId) ?? 'booked';
}

function leadQueueStyle(disposition: string | null | undefined, hasDisposition: boolean): QueueLeadStyle {
  const category = queueLeadCategory(disposition, hasDisposition);
  if (category === 'new') {
    return {
      accent: 'bg-slate-300',
      badge: 'bg-slate-100 text-slate-700 border-slate-200/80',
      legendDot: 'bg-slate-400',
    };
  }
  if (category === 'booked') {
    return {
      accent: 'bg-emerald-600',
      badge: 'bg-emerald-50 text-emerald-800 border-emerald-200',
      legendDot: 'bg-emerald-600',
    };
  }
  if (category === 'callback') {
    return {
      accent: 'bg-orange-500',
      badge: 'bg-orange-50 text-orange-900 border-orange-200',
      legendDot: 'bg-orange-500',
    };
  }
  if (category === 'retry') {
    return {
      accent: 'bg-amber-500',
      badge: 'bg-amber-50 text-amber-900 border-amber-200',
      legendDot: 'bg-amber-500',
    };
  }
  if (category === 'declined') {
    return {
      accent: 'bg-rose-600',
      badge: 'bg-rose-50 text-rose-800 border-rose-200',
      legendDot: 'bg-rose-600',
    };
  }
  return {
    accent: 'bg-[#2563eb]',
    badge: 'bg-[#eff6ff] text-[#1e40af] border-[#bfdbfe]',
    legendDot: 'bg-[#2563eb]',
  };
}

function shortDisposedAt(iso: string): string {
  const formatted = formatDateTimeCanadaEastern(iso);
  const parts = formatted.split(',');
  if (parts.length >= 2) return `${parts[0].trim()} · ${parts[1].trim()}`;
  return formatted;
}

const CallQueueLeadRail: React.FC<CallQueueLeadRailProps> = ({
  leads,
  selectedId,
  latestByCandidate,
  webinarStageByCandidate,
  legendFilter = null,
  onLegendFilterChange,
  onSelect,
  tone,
}) => {
  const railRef = React.useRef<HTMLDivElement>(null);
  const scrollTargetId = selectedId;

  React.useEffect(() => {
    if (!scrollTargetId || !railRef.current) return;
    const chip = railRef.current.querySelector(`[data-lead-id="${scrollTargetId}"]`);
    chip?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [scrollTargetId, legendFilter]);

  if (!leads.length) {
    return (
      <div
        className="mt-4 overflow-hidden rounded-2xl border border-[#d4e4f7] bg-gradient-to-b from-white via-white to-[#f6faff]"
        data-tour="call-queue-rail"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e8f1fb] px-4 py-3">
          <div>
            <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tone.panelLabel}`}>Batch queue</p>
            <p className={`text-xs ${tone.panelMuted}`}>
              {legendFilter ? 'No leads in this filter' : 'No leads loaded'}
            </p>
          </div>
          {onLegendFilterChange && (
            <div className="flex flex-wrap gap-1.5">
              {LEGEND.map((item) => {
                const active = legendFilter === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => onLegendFilterChange(active ? null : item.key)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-medium shadow-sm transition ${
                      active
                        ? 'border-[#0B1B34] bg-[#0B1B34] text-white'
                        : 'border-[#e2ecf8] bg-white/90 text-[#365274] hover:border-[#b8d4f0]'
                    }`}
                  >
                    <span className={`h-2 w-2 rounded-full ${item.dot}`} />
                    {item.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="mt-4 overflow-hidden rounded-2xl border border-[#d4e4f7] bg-gradient-to-b from-white via-white to-[#f6faff]"
      data-tour="call-queue-rail"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e8f1fb] px-4 py-3">
        <div>
          <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tone.panelLabel}`}>Batch queue</p>
          <p className={`text-xs ${tone.panelMuted}`}>
            {leads.length} lead{leads.length === 1 ? '' : 's'}
            {legendFilter ? ` · ${LEGEND.find((item) => item.key === legendFilter)?.label || 'Filtered'}` : ''}
            {' · tap legend to filter · tap card to jump'}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {LEGEND.map((item) => {
            const active = legendFilter === item.key;
            const ButtonTag = onLegendFilterChange ? 'button' : 'span';
            return (
              <ButtonTag
                key={item.key}
                type={onLegendFilterChange ? 'button' : undefined}
                onClick={onLegendFilterChange ? () => onLegendFilterChange(active ? null : item.key) : undefined}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-medium shadow-sm transition ${
                  active
                    ? 'border-[#0B1B34] bg-[#0B1B34] text-white'
                    : onLegendFilterChange
                      ? 'border-[#e2ecf8] bg-white/90 text-[#365274] hover:border-[#b8d4f0]'
                      : 'border-[#e2ecf8] bg-white/90 text-[#365274]'
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${item.dot}`} />
                {item.label}
              </ButtonTag>
            );
          })}
        </div>
      </div>

      <div
        ref={railRef}
        className="flex gap-3 overflow-x-auto px-4 py-3 [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#c9d9ee]"
      >
        {leads.map((lead, index) => {
          const latest = latestByCandidate.get(lead.id);
          const hasDisposition = Boolean(latest);
          const disposition = latest?.disposition ?? null;
          const selected = lead.id === selectedId;
          const style = leadQueueStyle(disposition, hasDisposition);
          const statusLabel = queueLeadChipLabel(disposition, hasDisposition);
          const webinarStage = webinarStageForLead(lead.id, disposition, webinarStageByCandidate);

          return (
            <button
              key={lead.id}
              type="button"
              data-lead-id={lead.id}
              onClick={() => onSelect(lead.id)}
              className={`group relative flex min-w-[148px] max-w-[168px] shrink-0 flex-col rounded-xl border bg-white px-3 py-3 text-left transition-all duration-200 ${
                selected
                  ? 'border-[#0B1B34] shadow-[0_10px_28px_-14px_rgba(11,27,52,0.45)] ring-2 ring-[#4e9ae8]/25'
                  : 'border-[#e2ecf8] shadow-sm hover:-translate-y-0.5 hover:border-[#b8d4f0] hover:shadow-md'
              }`}
            >
              <span className={`absolute bottom-3 left-0 top-3 w-1 rounded-full ${style.accent}`} aria-hidden />

              <div className="flex items-start justify-between gap-2 pl-2">
                <span className="truncate text-[13px] font-semibold leading-tight text-[#0B1B34]">
                  {shortName(lead.full_name || '')}
                </span>
                <span className="shrink-0 rounded-md bg-[#f0f6ff] px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-[#4e79a9]">
                  {index + 1}
                </span>
              </div>

              <span
                className={`mt-2 inline-flex w-fit max-w-full truncate rounded-md border px-2 py-0.5 text-[10px] font-semibold leading-tight ${style.badge}`}
              >
                {statusLabel}
              </span>

              {webinarStage && (
                <span
                  className={`mt-1.5 inline-flex w-fit max-w-full truncate rounded-md border px-2 py-0.5 text-[9px] font-semibold leading-tight ${WEBINAR_STAGE_BADGE[webinarStage]}`}
                >
                  {WEBINAR_STAGE_LABEL[webinarStage]}
                </span>
              )}

              {latest?.disposed_at && (
                <span className={`mt-2 pl-2 text-[10px] tabular-nums leading-tight ${tone.panelMuted}`}>
                  {shortDisposedAt(latest.disposed_at)}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default CallQueueLeadRail;
