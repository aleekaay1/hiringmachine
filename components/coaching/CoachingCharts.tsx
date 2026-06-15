import React from 'react';
import type { CoachingDailyPoint } from '../../services/coachingBoardService';
import { COACHING_WEEKLY_BOOKING_TARGET } from '../../services/coachingPace';

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
  const width = pct !== null ? Math.min(100, Math.max(2, pct)) : 0;
  const color = paceColor(pct);
  return (
    <div className={compact ? 'space-y-1.5' : 'space-y-2'}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-semibold uppercase tracking-[0.12em] text-[#5c7594]">{label}</span>
        <span className="font-bold tabular-nums" style={{ color }}>
          {pct !== null ? `${pct}%` : '—'}
        </span>
      </div>
      <div className="relative h-2 overflow-hidden rounded-sm bg-[#e8eef6] ring-1 ring-[#d4e4f7]">
        <div
          className="absolute inset-y-0 left-0 rounded-sm transition-all duration-700 ease-out"
          style={{ width: `${width}%`, backgroundColor: color }}
        />
        <div
          className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-rose-300/80"
          title="50% pace line"
        />
      </div>
      {!compact && (
        <p className="font-mono text-[10px] text-[#5c7594]">
          {actual} / {expected ?? '—'} mid-week · 50%+ on track
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

export const PaceRing: React.FC<PaceRingProps> = ({ pct, label, size = 76 }) => {
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const value = pct !== null ? Math.min(100, Math.max(0, pct)) : 0;
  const offset = c - (value / 100) * c;
  const color = paceColor(pct);

  return (
    <div className="flex flex-col items-center gap-0.5">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e8eef6" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="butt"
          strokeDasharray={c}
          strokeDashoffset={offset}
          className="transition-all duration-700 ease-out"
        />
      </svg>
      <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#5c7594]">{label}</span>
      <span className="font-mono text-sm font-bold tabular-nums" style={{ color }}>
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
  const chartH = tall ? 96 : 72;
  const maxCalls = Math.max(1, ...days.map((d) => d.calls));

  return (
    <div>
      <div className="mb-3 flex items-end justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#4e79a9]">Daily timeline</p>
        <p className="font-mono text-[9px] text-[#5c7594]">calls · booked overlay</p>
      </div>
      <div className="relative border-b border-[#c9d9ee] pb-1">
        <div className="absolute inset-x-0 top-0 flex flex-col justify-between" style={{ height: chartH }}>
          {[0.25, 0.5, 0.75].map((t) => (
            <div key={t} className="border-t border-dashed border-[#e8eef6]" style={{ marginTop: t === 0 ? 0 : undefined }} />
          ))}
        </div>
        <div className="relative flex items-end justify-between gap-1 px-0.5" style={{ height: chartH }}>
          {days.map((day, index) => {
            const callH = Math.round((day.calls / maxCalls) * 100);
            const bookedH = day.calls > 0 ? Math.round((day.booked / day.calls) * callH) : 0;
            const muted = highlightThroughDay !== undefined && index > highlightThroughDay;
            return (
              <div
                key={day.ymd}
                className="group flex w-[22px] shrink-0 flex-col items-center gap-1.5"
                title={`${day.label}: ${day.calls} calls, ${day.booked} booked`}
              >
                <div
                  className="relative flex w-[14px] flex-col justify-end rounded-[2px] bg-[#edf2f8] ring-1 ring-[#d4e4f7] transition-opacity"
                  style={{ height: chartH, opacity: muted ? 0.35 : 1 }}
                >
                  <div
                    className="w-full rounded-[2px] bg-[#1e40af] transition-all duration-500"
                    style={{ height: `${Math.max(day.calls > 0 ? 8 : 2, callH)}%` }}
                  />
                  {bookedH > 0 && (
                    <div
                      className="absolute bottom-0 w-full rounded-[2px] bg-[#059669]"
                      style={{ height: `${bookedH}%`, opacity: 0.92 }}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-2 flex justify-between gap-1 px-0.5">
        {days.map((day) => (
          <div key={`${day.ymd}-label`} className="flex w-[22px] shrink-0 flex-col items-center gap-0.5">
            <span className="text-[9px] font-semibold uppercase tracking-wide text-[#5c7594]">{day.label}</span>
            <span className="font-mono text-[10px] font-semibold tabular-nums text-[#0B1B34]">{day.calls}</span>
          </div>
        ))}
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

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-px overflow-hidden rounded-sm border border-[#d4e4f7] bg-[#f8fafc] p-2">
        {days.map((day) => {
          const h = Math.max(4, Math.round((day.calls / maxDay) * 40));
          return (
            <div key={day.ymd} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <div
                className="w-[10px] rounded-[2px] bg-[#1e40af] transition-all"
                style={{ height: h }}
                title={`${day.label}: ${day.calls} calls`}
              />
              <span className="text-[8px] font-semibold uppercase text-[#5c7594]">{day.label.charAt(0)}</span>
            </div>
          );
        })}
      </div>
      <div className="space-y-1">
        <div className="flex justify-between font-mono text-[10px] text-[#5c7594]">
          <span>Week total</span>
          <span>
            {totalCalls} calls · {totalBooked} / {COACHING_WEEKLY_BOOKING_TARGET} bookings
          </span>
        </div>
        <div className="relative h-2 overflow-hidden rounded-sm bg-[#e8eef6] ring-1 ring-[#d4e4f7]">
          <div
            className="h-full rounded-sm bg-[#059669] transition-all duration-700"
            style={{
              width: `${Math.min(100, Math.round((totalBooked / COACHING_WEEKLY_BOOKING_TARGET) * 100) || 0)}%`,
            }}
          />
          <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-rose-400/70" />
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
    <div className="space-y-1.5">
      <p className="mb-1 font-mono text-[9px] text-[#5c7594]">Target {COACHING_WEEKLY_BOOKING_TARGET} bookings/wk · 50% mid-week</p>
      {sorted.map((row) => {
        const pct = row.pacePct ?? 0;
        const width = row.pacePct !== null ? Math.min(100, Math.max(4, pct)) : 4;
        const color = paceColor(row.pacePct);
        return (
          <button
            key={row.userId}
            type="button"
            onClick={() => onSelect?.(row.userId)}
            className="group flex w-full items-center gap-3 rounded-lg border border-transparent px-2 py-1 text-left transition hover:border-[#d4e4f7] hover:bg-[#f8fbff]"
          >
            <span className="w-[28%] min-w-[100px] truncate text-xs font-medium text-[#0B1B34]">{row.name}</span>
            <div className="relative h-6 flex-1 overflow-hidden rounded-sm bg-[#edf2f8] ring-1 ring-[#d4e4f7]">
              <div
                className="absolute inset-y-0 left-0 rounded-sm transition-all duration-700 ease-out"
                style={{ width: `${width}%`, backgroundColor: color }}
              />
              <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-rose-300/70" />
              <span className="absolute inset-0 flex items-center px-2 font-mono text-[10px] font-semibold tabular-nums text-[#0B1B34]">
                {row.pacePct !== null ? `${row.pacePct}%` : '—'}
              </span>
            </div>
            <span className="hidden w-20 text-right font-mono text-[10px] text-[#5c7594] sm:block">
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
  bookingsPacePct?: number | null;
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
      <div className="rounded-xl border border-dashed border-[#d4e4f7] bg-[#f8fbff] p-8 text-center text-sm text-[#5c7594]">
        Weekly pace history appears as check-ins and invites are saved.
      </div>
    );
  }

  const padX = 40;
  const padY = 36;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const coords = points.map((p, i) => {
    const paceValue = p.bookingsPacePct ?? p.combinedPacePct ?? 0;
    const x = padX + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
    const pct = Math.min(100, Math.max(0, paceValue));
    const y = padY + innerH - (pct / 100) * innerH;
    return { x, y, ...p, index: i, displayPace: paceValue };
  });

  const linePath = smoothPath(coords);
  const areaPath = `${linePath} L ${coords[coords.length - 1].x} ${padY + innerH} L ${coords[0].x} ${padY + innerH} Z`;
  const midY = padY + innerH * 0.5;

  return (
    <div className="relative w-full overflow-x-auto rounded-xl border border-[#d4e4f7] bg-[#fafcff] p-4">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#4e79a9]">
        Bookings pace · week over week ({COACHING_WEEKLY_BOOKING_TARGET}/wk target)
      </p>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[320px]" style={{ maxHeight: height }}>
        {[0.25, 0.5, 0.75, 1].map((t) => (
          <line
            key={t}
            x1={padX}
            y1={padY + innerH * (1 - t)}
            x2={width - padX}
            y2={padY + innerH * (1 - t)}
            stroke="#e8eef6"
            strokeWidth="1"
          />
        ))}
        <line x1={padX} y1={midY} x2={width - padX} y2={midY} stroke="#f43f5e" strokeDasharray="4 3" strokeWidth="1.5" />
        <text x={padX + 4} y={midY - 6} fill="#e11d48" fontSize="10" fontWeight="600" fontFamily="ui-monospace, monospace">
          50% pace
        </text>
        <path d={areaPath} fill="#1e40af" fillOpacity="0.08" />
        <path d={linePath} fill="none" stroke="#1e40af" strokeWidth="2.5" strokeLinecap="square" />
        {coords.map((c) => (
          <g key={c.weekLabel}>
            <rect
              x={c.x - (hover === c.index ? 5 : 4)}
              y={c.y - (hover === c.index ? 5 : 4)}
              width={hover === c.index ? 10 : 8}
              height={hover === c.index ? 10 : 8}
              fill={c.belowThreshold ? '#e11d48' : '#059669'}
              stroke="#fff"
              strokeWidth="1.5"
              className="cursor-pointer transition-all duration-200"
              onMouseEnter={() => setHover(c.index)}
              onMouseLeave={() => setHover(null)}
            />
            {c.hasForm && <circle cx={c.x + 8} cy={c.y - 8} r={3} fill="#4e9ae8" stroke="#fff" strokeWidth="1" />}
            <text
              x={c.x}
              y={height - 6}
              textAnchor="middle"
              fill="#5c7594"
              fontSize="9"
              fontFamily="ui-monospace, monospace"
            >
              {(c.shortLabel || c.weekLabel).slice(0, 8)}
            </text>
          </g>
        ))}
      </svg>
      {hover !== null && coords[hover] && (
        <div className="pointer-events-none absolute left-1/2 top-6 z-10 -translate-x-1/2 rounded-lg border border-[#d4e4f7] bg-white px-3 py-2 font-mono text-[11px] shadow-lg">
          <p className="font-semibold text-[#0B1B34]">{coords[hover].weekLabel}</p>
          <p className="text-[#5c7594]">Bookings pace: {coords[hover].displayPace ?? '—'}%</p>
          {coords[hover].actualCalls !== undefined && (
            <p className="text-[#5c7594]">
              {coords[hover].actualCalls} calls · {coords[hover].actualBooked} booked
            </p>
          )}
          {coords[hover].hasForm && <p className="text-[#4e9ae8]">Form submitted</p>}
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
    { label: 'Calls', value: calls, color: '#1e40af' },
    { label: 'WG bk', value: webinarBooked, color: '#6d28d9' },
    { label: 'WG sh', value: webinarShowed, color: '#059669' },
    { label: 'Live bk', value: liveBooked, color: '#0e7490' },
    { label: 'Live sh', value: liveShowed, color: '#10b981' },
  ];
  const max = Math.max(1, ...items.map((i) => i.value));

  return (
    <div className="flex items-end justify-center gap-3">
      {items.map((item) => {
        const h = Math.max(6, Math.round((item.value / max) * 100));
        return (
          <div key={item.label} className="flex flex-col items-center gap-1.5">
            <span className="font-mono text-xs font-bold tabular-nums text-[#0B1B34]">{item.value}</span>
            <div className="flex flex-col justify-end rounded-sm bg-[#edf2f8] ring-1 ring-[#d4e4f7]" style={{ height: 64, width: 22 }}>
              <div
                className="w-full rounded-sm transition-all duration-500"
                style={{ height: `${h}%`, backgroundColor: item.color }}
              />
            </div>
            <span className="text-center font-mono text-[8px] font-semibold uppercase tracking-wide text-[#5c7594]">
              {item.label}
            </span>
          </div>
        );
      })}
    </div>
  );
};
