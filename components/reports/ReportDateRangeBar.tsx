import React from 'react';
import type { ReportDatePreset } from '../../services/reportsService';

const PRESETS: Array<{ id: ReportDatePreset; label: string }> = [
  { id: 'friday_week', label: 'This week (Fri–Thu)' },
  { id: 'last7', label: 'Last 7 days' },
  { id: 'last30', label: 'Last 30 days' },
  { id: 'this_month', label: 'This month' },
  { id: 'all', label: 'All time' },
  { id: 'custom', label: 'Custom' },
];

export function ReportDateRangeBar({
  preset,
  onPresetChange,
  customSince,
  customUntil,
  onCustomSince,
  onCustomUntil,
  rangeLabel,
}: {
  preset: ReportDatePreset;
  onPresetChange: (p: ReportDatePreset) => void;
  customSince: string;
  customUntil: string;
  onCustomSince: (v: string) => void;
  onCustomUntil: (v: string) => void;
  rangeLabel: string;
}) {
  return (
    <div className="rounded-2xl border border-[#d9e5f6] bg-white/80 p-3 space-y-2">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onPresetChange(item.id)}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
              preset === item.id
                ? 'border-[#8bc3ff] bg-[#dff0ff] text-[#0B1B34]'
                : 'border-[#d2e1f5] bg-white text-[#446181] hover:bg-[#f4f9ff]'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
      {preset === 'custom' && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] font-medium text-[#4f6886]">
            From
            <input
              type="date"
              value={customSince}
              onChange={(e) => onCustomSince(e.target.value)}
              className="rounded-lg border border-[#d2e1f5] px-2 py-1 text-xs"
            />
          </label>
          <label className="flex items-center gap-1.5 text-[11px] font-medium text-[#4f6886]">
            To
            <input
              type="date"
              value={customUntil}
              onChange={(e) => onCustomUntil(e.target.value)}
              className="rounded-lg border border-[#d2e1f5] px-2 py-1 text-xs"
            />
          </label>
        </div>
      )}
      <p className="text-[11px] text-[#5c7594]">{rangeLabel}</p>
    </div>
  );
}
