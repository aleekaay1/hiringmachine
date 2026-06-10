import React from 'react';
import type { HrDispositionCounts } from '../../services/pipelineHrLeadsService';
import type { DailyCallBar, HourlyCallBar } from '../../services/recruiterLeadPackAnalytics';

type Tone = {
  panelTitle: string;
  panelMuted: string;
  panelLabel: string;
};

export function DispositionBreakdownChart({
  counts,
  worked,
  tone,
}: {
  counts: HrDispositionCounts;
  worked: number;
  tone: Tone;
}) {
  const items = [
    { key: 'booked', label: 'Booked', value: counts.booked, color: 'bg-violet-500' },
    { key: 'connected', label: 'Connected', value: counts.connected, color: 'bg-emerald-500' },
    { key: 'callback_requested', label: 'Callback', value: counts.callback_requested, color: 'bg-sky-500' },
    { key: 'no_answer', label: 'No answer', value: counts.no_answer, color: 'bg-amber-500' },
    { key: 'voicemail_left', label: 'Voicemail', value: counts.voicemail_left, color: 'bg-orange-400' },
    { key: 'not_interested', label: 'Not interested', value: counts.not_interested, color: 'bg-red-400' },
    { key: 'busy', label: 'Busy', value: counts.busy, color: 'bg-slate-400' },
    { key: 'wrong_number', label: 'Wrong #', value: counts.wrong_number, color: 'bg-slate-300' },
    { key: 'other', label: 'Other', value: counts.other, color: 'bg-[#7eb3e7]' },
  ].filter((row) => row.value > 0);

  if (!worked || !items.length) {
    return <p className={`text-xs ${tone.panelMuted}`}>No dispositions logged for this pack yet.</p>;
  }

  const max = Math.max(...items.map((item) => item.value), 1);

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2 overflow-x-auto pb-1" style={{ minHeight: 160 }}>
        {items.map((item) => (
          <div key={item.key} className="flex min-w-[3.25rem] flex-1 flex-col items-center gap-1">
            <span className={`text-[10px] font-semibold ${tone.panelTitle}`}>{item.value}</span>
            <div className="flex h-28 w-full items-end justify-center">
              <div
                className={`w-full max-w-[2.5rem] rounded-t-md ${item.color} transition-all`}
                style={{ height: `${Math.max(12, Math.round((item.value / max) * 100))}%` }}
                title={`${item.label}: ${item.value}`}
              />
            </div>
            <span className={`text-center text-[9px] leading-tight ${tone.panelLabel}`}>{item.label}</span>
          </div>
        ))}
      </div>
      <div className="space-y-1">
        {items.map((item) => (
          <div key={`row-${item.key}`} className="flex items-center gap-2">
            <span className={`w-24 shrink-0 text-[10px] ${tone.panelLabel}`}>{item.label}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#e8f1fb]">
              <div
                className={`h-full rounded-full ${item.color}`}
                style={{ width: `${Math.max(4, Math.round((item.value / worked) * 100))}%` }}
              />
            </div>
            <span className={`w-10 shrink-0 text-right text-[10px] font-semibold ${tone.panelTitle}`}>
              {Math.round((item.value / worked) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DailyCallVolumeChart({
  bars,
  tone,
}: {
  bars: DailyCallBar[];
  tone: Tone;
}) {
  if (!bars.length) {
    return <p className={`text-xs ${tone.panelMuted}`}>No calls in the last two weeks for this pack.</p>;
  }

  const max = Math.max(...bars.map((bar) => bar.totalCalls), 1);

  return (
    <div className="overflow-x-auto pb-1">
      <div className="flex min-w-full items-end gap-1.5" style={{ minHeight: 180 }}>
        {bars.map((bar) => (
          <div key={bar.dateKey} className="flex min-w-[2.75rem] flex-1 flex-col items-center gap-1">
            <span className={`text-[9px] font-semibold ${tone.panelTitle}`}>{bar.totalCalls}</span>
            <div className="relative flex h-32 w-full items-end justify-center gap-0.5">
              <div
                className="w-[42%] rounded-t bg-[#c5ddf5]"
                style={{ height: `${Math.max(8, Math.round((bar.totalCalls / max) * 100))}%` }}
                title={`${bar.label}: ${bar.totalCalls} calls`}
              />
              <div
                className="w-[42%] rounded-t bg-emerald-500"
                style={{
                  height: `${Math.max(4, Math.round((bar.pickups / max) * 100))}%`,
                }}
                title={`${bar.label}: ${bar.pickups} pickups`}
              />
            </div>
            <span className={`text-center text-[9px] ${tone.panelLabel}`}>{bar.label}</span>
          </div>
        ))}
      </div>
      <div className={`mt-2 flex flex-wrap gap-3 text-[10px] ${tone.panelMuted}`}>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-[#c5ddf5]" />
          Total calls
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-emerald-500" />
          Pickups
        </span>
      </div>
    </div>
  );
}

export function HourlyPickupChart({
  bars,
  tone,
  highlightBest = true,
}: {
  bars: HourlyCallBar[];
  tone: Tone;
  highlightBest?: boolean;
}) {
  const active = bars.filter((bar) => bar.totalCalls > 0);
  if (!active.length) {
    return (
      <p className={`text-xs ${tone.panelMuted}`}>
        No calls between 10 AM and 5 PM Eastern yet. Your best hours will appear here as you dial.
      </p>
    );
  }

  const max = Math.max(...bars.map((bar) => bar.pickups), 1);
  const bestHour = [...bars]
    .filter((bar) => bar.totalCalls >= 2)
    .sort((a, b) => b.pickupRate - a.pickupRate || b.pickups - a.pickups)[0]?.hour;

  return (
    <div>
      <div className="flex items-end gap-2 overflow-x-auto pb-1" style={{ minHeight: 170 }}>
        {bars.map((bar) => {
          const isBest = highlightBest && bestHour === bar.hour && bar.pickups > 0;
          return (
            <div key={bar.hour} className="flex min-w-[2.75rem] flex-1 flex-col items-center gap-1">
              <span className={`text-[9px] font-semibold ${isBest ? 'text-emerald-700' : tone.panelTitle}`}>
                {bar.pickups > 0 ? `${bar.pickupRate}%` : '—'}
              </span>
              <div className="flex h-28 w-full items-end justify-center">
                <div
                  className={`w-full max-w-[2.25rem] rounded-t-md transition-all ${
                    isBest ? 'bg-emerald-500 ring-2 ring-emerald-200' : bar.pickups ? 'bg-[#4b8fd4]' : 'bg-[#d8e8f8]'
                  }`}
                  style={{
                    height: `${Math.max(bar.pickups ? 14 : 6, Math.round((bar.pickups / max) * 100))}%`,
                  }}
                  title={`${bar.label}: ${bar.totalCalls} calls, ${bar.pickups} pickups`}
                />
              </div>
              <span className={`text-center text-[9px] ${isBest ? 'font-semibold text-emerald-800' : tone.panelLabel}`}>
                {bar.label}
              </span>
              <span className={`text-[8px] ${tone.panelMuted}`}>{bar.totalCalls} calls</span>
            </div>
          );
        })}
      </div>
      <p className={`mt-2 text-[10px] ${tone.panelMuted}`}>10 AM – 5 PM Eastern · bar height = pickups · label = pickup rate</p>
    </div>
  );
}

export function PackInsightCard({
  title,
  body,
  tone,
  accent = 'slate',
}: {
  title: string;
  body: string;
  tone: Tone;
  accent?: 'emerald' | 'sky' | 'amber' | 'slate';
}) {
  const accentClass =
    accent === 'emerald'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
      : accent === 'sky'
        ? 'border-sky-200 bg-sky-50 text-sky-900'
        : accent === 'amber'
          ? 'border-amber-200 bg-amber-50 text-amber-900'
          : 'border-[#cde0f4] bg-[#f8fbff] text-[#0B1B34]';

  return (
    <div className={`rounded-xl border px-3 py-2.5 ${accentClass}`}>
      <p className="text-xs font-semibold">{title}</p>
      <p className={`mt-1 text-[11px] leading-relaxed ${tone.panelMuted}`}>{body}</p>
    </div>
  );
}
