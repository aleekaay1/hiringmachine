import React from 'react';
import type { CoachingDailyPoint } from '../../services/coachingBoardService';

export function paceColor(pct: number | null): string {
  if (pct === null) return '#94a3b8';
  if (pct < 50) return '#e11d48';
  if (pct < 80) return '#d97706';
  return '#059669';
}

export function paceBgClass(pct: number | null): string {
  if (pct === null) return 'bg-slate-100';
  if (pct < 50) return 'bg-rose-100';
  if (pct < 80) return 'bg-amber-100';
  return 'bg-emerald-100';
}

type PaceGaugeProps = {
  label: string;
  pct: number | null;
  actual: number;
  expected: number | null;
  compact?: boolean;
};

export const PaceGauge: React.FC<PaceGaugeProps> = ({ label, pct, actual, expected, compact }) => {
  const width = pct !== null ? Math.min(100, Math.max(4, pct)) : 0;
  const color = paceColor(pct);
  return (
    <div className={compact ? 'space-y-1' : 'space-y-1.5'}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium text-[#5c7594]">{label}</span>
        <span className="font-semibold tabular-nums" style={{ color }}>
          {pct !== null ? `${pct}%` : '—'}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[#e8f0fa]">
        <div
          className="h-full rounded-full transition-all duration-500 ease-out"
          style={{ width: `${width}%`, backgroundColor: color }}
        />
      </div>
      {!compact && (
        <p className="text-[11px] text-[#5c7594]">
          {actual} / {expected ?? '—'} mid-week target
        </p>
      )}
    </div>
  );
};

type DailyWeekBarsProps = {
  days: CoachingDailyPoint[];
  highlightThroughDay?: number;
};

export const DailyWeekBars: React.FC<DailyWeekBarsProps> = ({ days, highlightThroughDay }) => {
  const maxCalls = Math.max(1, ...days.map((d) => d.calls));
  return (
    <div className="flex items-end justify-between gap-1">
      {days.map((day, index) => {
        const h = Math.round((day.calls / maxCalls) * 100);
        const bookedH = day.calls > 0 ? Math.round((day.booked / day.calls) * h) : 0;
        const muted = highlightThroughDay !== undefined && index > highlightThroughDay;
        return (
          <div key={day.ymd} className="group flex flex-1 flex-col items-center gap-1">
            <div
              className="relative flex w-full max-w-[36px] flex-col justify-end rounded-md bg-[#edf4fc] transition-opacity duration-300"
              style={{ height: 56, opacity: muted ? 0.35 : 1 }}
              title={`${day.label}: ${day.calls} calls, ${day.booked} booked`}
            >
              <div
                className="w-full rounded-md bg-gradient-to-t from-[#4e9ae8] to-[#7ec0ff] transition-all duration-500"
                style={{ height: `${Math.max(8, h)}%` }}
              />
              {bookedH > 0 && (
                <div
                  className="absolute bottom-0 w-full rounded-b-md bg-[#10b981]/80"
                  style={{ height: `${bookedH}%` }}
                />
              )}
            </div>
            <span className="text-[10px] font-medium text-[#5c7594]">{day.label}</span>
            <span className="hidden text-[10px] tabular-nums text-[#0B1B34] group-hover:block">{day.calls}</span>
          </div>
        );
      })}
    </div>
  );
};

export type LadderPoint = {
  weekLabel: string;
  combinedPacePct: number | null;
  belowThreshold: boolean;
  hasForm: boolean;
};

type ImprovementLadderChartProps = {
  points: LadderPoint[];
  width?: number;
  height?: number;
};

export const ImprovementLadderChart: React.FC<ImprovementLadderChartProps> = ({
  points,
  width = 640,
  height = 200,
}) => {
  const [hover, setHover] = React.useState<number | null>(null);
  if (!points.length) {
    return <p className="text-sm text-[#5c7594]">Not enough weekly history yet.</p>;
  }

  const padX = 28;
  const padY = 24;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const coords = points.map((p, i) => {
    const x = padX + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
    const pct = p.combinedPacePct ?? 0;
    const y = padY + innerH - (Math.min(100, Math.max(0, pct)) / 100) * innerH;
    return { x, y, ...p, index: i };
  });

  const pathD = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x} ${c.y}`).join(' ');

  return (
    <div className="relative w-full overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[320px]" style={{ maxHeight: height }}>
        <line x1={padX} y1={padY + innerH * 0.5} x2={width - padX} y2={padY + innerH * 0.5} stroke="#fecdd3" strokeDasharray="4 4" />
        <text x={padX} y={padY + innerH * 0.5 - 6} fill="#e11d48" fontSize="10">
          50% line
        </text>
        <path d={pathD} fill="none" stroke="#4e9ae8" strokeWidth="2.5" strokeLinecap="round" />
        {coords.map((c) => (
          <g key={c.weekLabel}>
            <circle
              cx={c.x}
              cy={c.y}
              r={hover === c.index ? 7 : 5}
              fill={c.belowThreshold ? '#e11d48' : '#059669'}
              stroke="#fff"
              strokeWidth="2"
              className="cursor-pointer transition-all duration-200"
              onMouseEnter={() => setHover(c.index)}
              onMouseLeave={() => setHover(null)}
            />
            {c.hasForm && (
              <circle cx={c.x + 8} cy={c.y - 8} r={3} fill="#4e9ae8" stroke="#fff" strokeWidth="1" />
            )}
          </g>
        ))}
      </svg>
      {hover !== null && coords[hover] && (
        <div
          className="pointer-events-none absolute rounded-xl border border-[#d4e4f7] bg-white px-3 py-2 text-xs shadow-lg transition-opacity"
          style={{ left: `${(coords[hover].x / width) * 100}%`, top: 8, transform: 'translateX(-50%)' }}
        >
          <p className="font-semibold text-[#0B1B34]">{coords[hover].weekLabel}</p>
          <p className="text-[#5c7594]">Pace: {coords[hover].combinedPacePct ?? '—'}%</p>
          {coords[hover].hasForm && <p className="text-[#4e9ae8]">Form submitted</p>}
        </div>
      )}
    </div>
  );
};
