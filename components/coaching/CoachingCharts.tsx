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
      <div className="h-2.5 overflow-hidden rounded-full bg-[#e8f0fa]">
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
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

type PaceRingProps = {
  pct: number | null;
  label: string;
  size?: number;
};

export const PaceRing: React.FC<PaceRingProps> = ({ pct, label, size = 72 }) => {
  const stroke = 7;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const value = pct !== null ? Math.min(100, Math.max(0, pct)) : 0;
  const offset = c - (value / 100) * c;
  const color = paceColor(pct);

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e8f0fa" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          className="transition-all duration-700 ease-out"
        />
      </svg>
      <span className="text-[10px] font-medium text-[#5c7594]">{label}</span>
      <span className="text-sm font-bold tabular-nums" style={{ color }}>
        {pct !== null ? `${pct}%` : '—'}
      </span>
    </div>
  );
};

type DailyWeekBarsProps = {
  days: CoachingDailyPoint[];
  highlightThroughDay?: number;
  tall?: boolean;
};

export const DailyWeekBars: React.FC<DailyWeekBarsProps> = ({ days, highlightThroughDay, tall }) => {
  const barH = tall ? 88 : 64;
  const maxCalls = Math.max(1, ...days.map((d) => d.calls));
  return (
    <div>
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#4e79a9]">Daily activity</p>
      <div className="flex items-end justify-between gap-1.5">
        {days.map((day, index) => {
          const h = Math.round((day.calls / maxCalls) * 100);
          const bookedH = day.calls > 0 ? Math.round((day.booked / day.calls) * h) : 0;
          const muted = highlightThroughDay !== undefined && index > highlightThroughDay;
          return (
            <div key={day.ymd} className="group flex flex-1 flex-col items-center gap-1">
              <div
                className="relative flex w-full flex-col justify-end rounded-lg bg-[#edf4fc] transition-all duration-300 group-hover:ring-2 group-hover:ring-[#4e9ae8]/30"
                style={{ height: barH, opacity: muted ? 0.35 : 1 }}
                title={`${day.label}: ${day.calls} calls, ${day.booked} booked`}
              >
                <div
                  className="w-full rounded-lg bg-gradient-to-t from-[#2563eb] to-[#7ec0ff] transition-all duration-500"
                  style={{ height: `${Math.max(day.calls > 0 ? 12 : 4, h)}%` }}
                />
                {bookedH > 0 && (
                  <div
                    className="absolute bottom-0 w-full rounded-b-lg bg-[#10b981]"
                    style={{ height: `${bookedH}%`, opacity: 0.85 }}
                  />
                )}
              </div>
              <span className="text-[10px] font-semibold text-[#5c7594]">{day.label}</span>
              <span className="text-[10px] tabular-nums text-[#0B1B34]">{day.calls}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** Week strip: 7 day segments + total week bar */
export const WeekActivityStrip: React.FC<{ days: CoachingDailyPoint[]; totalCalls: number; totalBooked: number }> = ({
  days,
  totalCalls,
  totalBooked,
}) => {
  const maxDay = Math.max(1, ...days.map((d) => d.calls));
  const weekMax = Math.max(totalCalls, 1);

  return (
    <div className="space-y-3">
      <div className="flex gap-0.5 overflow-hidden rounded-xl bg-[#edf4fc] p-1">
        {days.map((day) => {
          const flex = Math.max(1, Math.round((day.calls / maxDay) * 10));
          return (
            <div
              key={day.ymd}
              className="flex min-w-[8px] flex-col items-center justify-end rounded-md bg-gradient-to-t from-[#4e9ae8] to-[#93c5fd] transition-transform hover:scale-y-105"
              style={{ flex, height: 32 + flex * 3 }}
              title={`${day.label}: ${day.calls} calls`}
            />
          );
        })}
      </div>
      <div className="space-y-1">
        <div className="flex justify-between text-[10px] text-[#5c7594]">
          <span>Week total</span>
          <span>
            {totalCalls} calls · {totalBooked} booked
          </span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-[#e8f0fa]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#0B1B34] via-[#4e9ae8] to-[#10b981] transition-all duration-700"
            style={{ width: `${Math.min(100, Math.round((totalBooked / weekMax) * 100) || 8)}%` }}
          />
        </div>
      </div>
    </div>
  );
};

export type TeamPaceRow = {
  userId: string;
  name: string;
  pacePct: number | null;
  belowThreshold: boolean;
  calls: number;
  booked: number;
};

export const TeamPaceChart: React.FC<{ rows: TeamPaceRow[]; onSelect?: (userId: string) => void }> = ({
  rows,
  onSelect,
}) => {
  const sorted = [...rows].sort((a, b) => (b.pacePct ?? 0) - (a.pacePct ?? 0));
  if (!sorted.length) {
    return <p className="text-sm text-[#5c7594]">No pace data for this week.</p>;
  }

  return (
    <div className="space-y-2">
      {sorted.map((row) => {
        const pct = row.pacePct ?? 0;
        const width = row.pacePct !== null ? Math.min(100, Math.max(6, pct)) : 6;
        const color = paceColor(row.pacePct);
        return (
          <button
            key={row.userId}
            type="button"
            onClick={() => onSelect?.(row.userId)}
            className="group flex w-full items-center gap-3 rounded-xl border border-transparent px-2 py-1.5 text-left transition hover:border-[#d4e4f7] hover:bg-[#f8fbff]"
          >
            <span className="w-[28%] min-w-[100px] truncate text-xs font-medium text-[#0B1B34]">{row.name}</span>
            <div className="relative h-7 flex-1 overflow-hidden rounded-lg bg-[#edf4fc]">
              <div
                className="absolute inset-y-0 left-0 rounded-lg transition-all duration-700 ease-out"
                style={{
                  width: `${width}%`,
                  background: `linear-gradient(90deg, ${color}dd, ${color})`,
                }}
              />
              <span className="absolute inset-0 flex items-center px-2 text-[11px] font-semibold tabular-nums text-[#0B1B34]">
                {row.pacePct !== null ? `${row.pacePct}%` : 'No target'}
              </span>
            </div>
            <span className="hidden w-20 text-right text-[10px] text-[#5c7594] sm:block">
              {row.calls}c · {row.booked}b
            </span>
          </button>
        );
      })}
    </div>
  );
};

export type LadderPoint = {
  weekLabel: string;
  shortLabel?: string;
  combinedPacePct: number | null;
  belowThreshold: boolean;
  hasForm: boolean;
  actualCalls?: number;
  actualBooked?: number;
};

function smoothPath(points: Array<{ x: number; y: number }>): string {
  if (points.length < 2) return points.length === 1 ? `M ${points[0].x} ${points[0].y}` : '';
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

export const ImprovementLadderChart: React.FC<{
  points: LadderPoint[];
  width?: number;
  height?: number;
}> = ({ points, width = 720, height = 240 }) => {
  const [hover, setHover] = React.useState<number | null>(null);
  if (!points.length) {
    return (
      <div className="rounded-2xl border border-dashed border-[#d4e4f7] bg-[#f8fbff] p-8 text-center text-sm text-[#5c7594]">
        Weekly history builds as callers submit check-ins and automation runs each mid-week.
      </div>
    );
  }

  const padX = 36;
  const padY = 32;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const coords = points.map((p, i) => {
    const x = padX + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
    const pct = p.combinedPacePct ?? 0;
    const y = padY + innerH - (Math.min(100, Math.max(0, pct)) / 100) * innerH;
    return { x, y, ...p, index: i };
  });

  const linePath = smoothPath(coords);
  const areaPath = `${linePath} L ${coords[coords.length - 1].x} ${padY + innerH} L ${coords[0].x} ${padY + innerH} Z`;
  const midY = padY + innerH * 0.5;

  return (
    <div className="relative w-full overflow-x-auto rounded-2xl border border-[#d4e4f7] bg-gradient-to-b from-white to-[#f8fbff] p-4">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#4e79a9]">
        Improvement ladder · hover for details
      </p>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[320px]" style={{ maxHeight: height }}>
        <defs>
          <linearGradient id="ladderArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4e9ae8" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#4e9ae8" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((t) => (
          <line
            key={t}
            x1={padX}
            y1={padY + innerH * (1 - t)}
            x2={width - padX}
            y2={padY + innerH * (1 - t)}
            stroke="#e8f0fa"
            strokeWidth="1"
          />
        ))}
        <line x1={padX} y1={midY} x2={width - padX} y2={midY} stroke="#fecdd3" strokeDasharray="5 4" strokeWidth="1.5" />
        <text x={padX + 4} y={midY - 6} fill="#e11d48" fontSize="11" fontWeight="600">
          50% pace
        </text>
        <path d={areaPath} fill="url(#ladderArea)" />
        <path d={linePath} fill="none" stroke="#2563eb" strokeWidth="3" strokeLinecap="round" />
        {coords.map((c) => (
          <g key={c.weekLabel}>
            <circle
              cx={c.x}
              cy={c.y}
              r={hover === c.index ? 9 : 6}
              fill={c.belowThreshold ? '#e11d48' : '#059669'}
              stroke="#fff"
              strokeWidth="2.5"
              className="cursor-pointer transition-all duration-200"
              onMouseEnter={() => setHover(c.index)}
              onMouseLeave={() => setHover(null)}
            />
            {c.hasForm && <circle cx={c.x + 10} cy={c.y - 10} r={4} fill="#4e9ae8" stroke="#fff" strokeWidth="1.5" />}
            <text x={c.x} y={height - 8} textAnchor="middle" fill="#5c7594" fontSize="9">
              {(c.shortLabel || c.weekLabel).slice(0, 8)}
            </text>
          </g>
        ))}
      </svg>
      {hover !== null && coords[hover] && (
        <div className="pointer-events-none absolute left-1/2 top-6 z-10 -translate-x-1/2 rounded-xl border border-[#d4e4f7] bg-white px-4 py-2 text-xs shadow-xl">
          <p className="font-semibold text-[#0B1B34]">{coords[hover].weekLabel}</p>
          <p className="text-[#5c7594]">Pace: {coords[hover].combinedPacePct ?? '—'}%</p>
          {coords[hover].actualCalls !== undefined && (
            <p className="text-[#5c7594]">
              {coords[hover].actualCalls} calls · {coords[hover].actualBooked} booked
            </p>
          )}
          {coords[hover].hasForm && <p className="font-medium text-[#4e9ae8]">✓ Form submitted</p>}
        </div>
      )}
    </div>
  );
};

export const MetricsBarChart: React.FC<{
  calls: number;
  webinarBooked: number;
  webinarShowed: number;
  liveBooked: number;
  liveShowed: number;
}> = ({ calls, webinarBooked, webinarShowed, liveBooked, liveShowed }) => {
  const items = [
    { label: 'Calls', value: calls, color: '#2563eb' },
    { label: 'WG booked', value: webinarBooked, color: '#7c3aed' },
    { label: 'WG showed', value: webinarShowed, color: '#059669' },
    { label: 'Live booked', value: liveBooked, color: '#0891b2' },
    { label: 'Live showed', value: liveShowed, color: '#10b981' },
  ];
  const max = Math.max(1, ...items.map((i) => i.value));

  return (
    <div className="flex items-end justify-between gap-2">
      {items.map((item) => {
        const h = Math.max(8, Math.round((item.value / max) * 100));
        return (
          <div key={item.label} className="flex flex-1 flex-col items-center gap-1">
            <span className="text-sm font-bold tabular-nums text-[#0B1B34]">{item.value}</span>
            <div className="flex w-full max-w-[48px] flex-col justify-end rounded-t-lg bg-[#edf4fc]" style={{ height: 72 }}>
              <div
                className="w-full rounded-t-lg transition-all duration-500"
                style={{ height: `${h}%`, backgroundColor: item.color }}
              />
            </div>
            <span className="text-center text-[9px] font-medium leading-tight text-[#5c7594]">{item.label}</span>
          </div>
        );
      })}
    </div>
  );
};
