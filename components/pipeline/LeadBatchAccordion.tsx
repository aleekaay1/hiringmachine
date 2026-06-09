import React from 'react';
import { ChevronDown } from 'lucide-react';
import type { LeadBatchGroup } from '../../services/pipelineLeadGrouping';

type LeadBatchAccordionProps<T> = {
  groups: LeadBatchGroup<T>[];
  expandedKeys: Set<string>;
  onToggle: (key: string) => void;
  renderItem: (item: T, indexInGroup: number) => React.ReactNode;
  emptyMessage?: string;
  tone?: {
    header: string;
    headerMuted: string;
    panel: string;
    badgeNew: string;
    badgeMuted: string;
  };
  compact?: boolean;
};

const defaultTone = {
  header: 'text-[#0B1B34]',
  headerMuted: 'text-[#4b6d95]',
  panel: 'border-slate-200 bg-slate-50/80',
  badgeNew: 'bg-[#edf5ff] text-[#285082]',
  badgeMuted: 'bg-slate-100 text-slate-600',
};

function LeadBatchAccordion<T>({
  groups,
  expandedKeys,
  onToggle,
  renderItem,
  emptyMessage = 'No leads in this view.',
  tone = defaultTone,
  compact = false,
}: LeadBatchAccordionProps<T>) {
  if (!groups.length) {
    return <p className={`rounded-xl border border-dashed p-4 text-center text-xs ${tone.headerMuted}`}>{emptyMessage}</p>;
  }

  return (
    <div className="space-y-2">
      {groups.map((group) => {
        const expanded = expandedKeys.has(group.key);
        const total = group.items.length;
        return (
          <div key={group.key} className={`overflow-hidden rounded-xl border ${tone.panel}`}>
            <button
              type="button"
              onClick={() => onToggle(group.key)}
              className="flex w-full items-start justify-between gap-2 px-3 py-2.5 text-left"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className={`truncate text-xs font-semibold ${tone.header}`}>{group.title}</p>
                  {group.newCount > 0 && (
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${tone.badgeNew}`}>
                      {group.newCount} new
                    </span>
                  )}
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${tone.badgeMuted}`}>
                    {total} total
                  </span>
                </div>
                {group.subtitle && (
                  <p className={`mt-0.5 truncate text-[10px] ${tone.headerMuted}`}>{group.subtitle}</p>
                )}
                {!compact && (group.inProgressCount > 0 || group.doneCount > 0) && (
                  <p className={`mt-0.5 text-[10px] ${tone.headerMuted}`}>
                    {group.inProgressCount > 0 ? `${group.inProgressCount} in progress` : ''}
                    {group.inProgressCount > 0 && group.doneCount > 0 ? ' · ' : ''}
                    {group.doneCount > 0 ? `${group.doneCount} done` : ''}
                  </p>
                )}
              </div>
              <ChevronDown
                size={14}
                className={`mt-0.5 shrink-0 transition-transform ${tone.headerMuted} ${expanded ? 'rotate-180' : ''}`}
              />
            </button>
            {expanded && (
              <div className={`border-t border-inherit px-2 py-2 ${compact ? 'space-y-1' : 'space-y-2'}`}>
                {group.items.map((item, index) => renderItem(item, index))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default LeadBatchAccordion;
