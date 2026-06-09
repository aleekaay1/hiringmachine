import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BarChart3, TrendingUp } from 'lucide-react';
import type { LeadershipTeamMetrics } from '../../services/dashboardPersonalMetrics';
import { formatLeaderboardRefreshed } from './DashboardWidgets';

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** SVG ring — team combined show rate */
export function TeamShowRateRing({
  showRatePct,
  totalBooked,
  totalShowed,
  windowLabel,
}: {
  showRatePct: number;
  totalBooked: number;
  totalShowed: number;
  windowLabel: string;
}) {
  const pct = clampPct(showRatePct);
  const gradId = React.useId().replace(/:/g, '');
  const size = 132;
  const stroke = 9;
  const r = (size - stroke) / 2 - 4;
  const cx = size / 2;
  const cy = size / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;

  return (
    <div className="relative flex h-full min-h-[220px] flex-col justify-between overflow-hidden rounded-3xl border border-[#c8dcf4] bg-gradient-to-br from-[#0B1B34] via-[#123a62] to-[#1a5080] p-5 text-white shadow-[0_20px_50px_-28px_rgba(11,27,52,0.65)]">
      <div
        className="pointer-events-none absolute -right-8 -top-8 h-40 w-40 rounded-full bg-[#67b5ff]/20 blur-2xl"
        aria-hidden
      />
      <div className="relative">
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#9ec9f5]">Team show rate</p>
        <p className="mt-0.5 text-xs text-[#b8d4f0]">{windowLabel}</p>
      </div>

      <div className="relative flex flex-col items-center py-1">
        <div className="relative" style={{ width: size, height: size }}>
          <svg
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            className="block -rotate-90"
            aria-hidden
          >
            <circle
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke="rgba(255,255,255,0.14)"
              strokeWidth={stroke}
            />
            <circle
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={`url(#${gradId})`}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={c}
              strokeDashoffset={offset}
              className="transition-[stroke-dashoffset] duration-700 ease-out"
            />
            <defs>
              <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#67b5ff" />
                <stop offset="100%" stopColor="#34d399" />
              </linearGradient>
            </defs>
          </svg>
          <div
            className="absolute inset-0 flex items-center justify-center"
            aria-label={`${pct} percent show rate`}
          >
            <div className="flex h-[4.75rem] w-[4.75rem] items-center justify-center rounded-full bg-[#0a1628]/95 shadow-inner ring-1 ring-white/15">
              <span
                className="text-[2rem] font-bold tabular-nums leading-none tracking-tight"
                style={{ fontFamily: 'Outfit, Inter, system-ui, sans-serif' }}
              >
                {pct}%
              </span>
            </div>
          </div>
        </div>
        <p className="mt-2 text-center text-[10px] font-semibold uppercase tracking-[0.2em] text-[#9ec9f5]">
          Attended ÷ booked
        </p>
      </div>

      <div className="relative grid grid-cols-2 gap-2 text-center">
        <div className="rounded-xl bg-white/10 px-2 py-2 backdrop-blur-sm">
          <p className="text-[10px] uppercase tracking-wide text-[#9ec9f5]">Booked</p>
          <p className="text-lg font-bold tabular-nums">{totalBooked}</p>
        </div>
        <div className="rounded-xl bg-white/10 px-2 py-2 backdrop-blur-sm">
          <p className="text-[10px] uppercase tracking-wide text-[#9ec9f5]">Attended</p>
          <p className="text-lg font-bold tabular-nums text-emerald-200">{totalShowed}</p>
        </div>
      </div>
    </div>
  );
}

/** Horizontal stacked bars — booked vs showed per recruiter */
export function RecruiterComparisonChart({
  bars,
  emptyHint,
}: {
  bars: LeadershipTeamMetrics['performerBars'];
  emptyHint: string;
}) {
  const maxBooked = Math.max(1, ...bars.map((b) => b.booked));

  return (
    <div className="flex h-full min-h-[220px] flex-col rounded-3xl border border-[#d9e5f6] bg-white/90 p-4 shadow-sm backdrop-blur-xl">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#0B1B34]">
            <BarChart3 size={16} className="text-[#2f6ea8]" aria-hidden />
            Recruiter throughput
          </p>
          <p className="mt-0.5 text-[11px] text-[#5c7594]">Booked vs attended · top performers</p>
        </div>
        <Link
          to="/calls-analytics/leaderboard"
          className="shrink-0 text-[11px] font-semibold text-[#2f6ea8] hover:underline"
        >
          Full board
        </Link>
      </div>

      {bars.length === 0 ? (
        <div className="mt-6 flex flex-1 items-center justify-center rounded-2xl border border-dashed border-[#dfeaf8] bg-[#f9fcff] px-4 py-8 text-center text-xs text-[#5c7594]">
          {emptyHint}
        </div>
      ) : (
        <ul className="mt-4 flex flex-1 flex-col justify-center gap-3">
          {bars.map((bar) => {
            const widthPct = Math.max(4, Math.round((100 * bar.booked) / maxBooked));
            const showedPct = bar.booked > 0 ? clampPct((100 * bar.showed) / bar.booked) : 0;
            const firstName = bar.name.split(/\s+/)[0] || bar.name;
            return (
              <li key={bar.name}>
                <div className="mb-1 flex items-baseline justify-between gap-2 text-[11px]">
                  <span className="truncate font-medium text-[#0B1B34]" title={bar.name}>
                    {firstName}
                  </span>
                  <span className="shrink-0 tabular-nums text-[#5c7594]">
                    <span className="font-semibold text-[#0B1B34]">{bar.showed}</span>
                    <span className="text-[#8aa3be]"> / {bar.booked}</span>
                    <span className="ml-1 text-[#2f6ea8]">{showedPct}%</span>
                  </span>
                </div>
                <div
                  className="h-2.5 overflow-hidden rounded-full bg-[#e8f2fc]"
                  style={{ width: `${widthPct}%`, maxWidth: '100%' }}
                >
                  <div
                    className="flex h-full"
                    title={`${bar.showed} attended of ${bar.booked} booked`}
                  >
                    <div
                      className="h-full bg-gradient-to-r from-[#34d399] to-[#10b981]"
                      style={{ width: `${showedPct}%` }}
                    />
                    <div
                      className="h-full flex-1 bg-gradient-to-r from-[#8bc3ff] to-[#4e9ae8]"
                      style={{ width: `${100 - showedPct}%` }}
                    />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap gap-3 border-t border-[#eef4fb] pt-3 text-[10px] text-[#6d86a3]">
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-3 rounded-sm bg-gradient-to-r from-emerald-400 to-emerald-500" aria-hidden />
          Attended
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-3 rounded-sm bg-gradient-to-r from-[#8bc3ff] to-[#4e9ae8]" aria-hidden />
          Booked (no show yet)
        </span>
      </div>
    </div>
  );
}

/** Mini funnel + channel split */
export function TeamActivityBreakdown({ metrics }: { metrics: LeadershipTeamMetrics }) {
  const stages = [
    { label: 'Dial activity', value: metrics.totalCalls, color: 'from-[#94a3b8] to-[#64748b]' },
    { label: 'Webinar booked', value: metrics.totalWebinarBooked, color: 'from-[#8bc3ff] to-[#2f6ea8]' },
    { label: 'Webinar attended', value: metrics.totalWebinarShowed, color: 'from-[#34d399] to-[#059669]' },
    { label: 'Live booked', value: metrics.totalLiveBooked, color: 'from-[#c4b5fd] to-[#7c3aed]' },
    { label: 'Live attended', value: metrics.totalLiveShowed, color: 'from-[#fbbf24] to-[#d97706]' },
  ];
  const max = Math.max(1, ...stages.map((s) => s.value));

  return (
    <div className="rounded-3xl border border-[#d9e5f6] bg-gradient-to-br from-[#f9fcff] to-white p-4 shadow-sm">
      <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#0B1B34]">
        <TrendingUp size={16} className="text-[#2f6ea8]" aria-hidden />
        Activity breakdown
      </p>
      <p className="mt-0.5 text-[11px] text-[#5c7594]">{metrics.windowLabel}</p>
      <div className="mt-4 space-y-2.5">
        {stages.map((stage) => {
          const w = Math.max(stage.value > 0 ? 6 : 0, Math.round((100 * stage.value) / max));
          return (
            <div key={stage.label} className="grid grid-cols-[7.5rem_1fr_2.5rem] items-center gap-2">
              <span className="text-[11px] font-medium text-[#35567a]">{stage.label}</span>
              <div className="h-2 rounded-full bg-[#e8f2fc] overflow-hidden">
                <div
                  className={`h-full rounded-full bg-gradient-to-r ${stage.color} transition-all duration-500`}
                  style={{ width: `${w}%` }}
                />
              </div>
              <span className="text-right text-xs font-bold tabular-nums text-[#0B1B34]">{stage.value}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function AdminQuickLinksStrip() {
  const links = [
    { title: 'Leaderboard', to: '/calls-analytics/leaderboard' },
    { title: 'Reports', to: '/reports' },
    { title: 'Webinar data', to: '/webinar-geek' },
    { title: 'Profile settings', to: '/account' },
  ] as const;

  return (
    <div className="flex flex-wrap gap-2">
      {links.map((link) => (
        <Link
          key={link.to}
          to={link.to}
          className="group inline-flex items-center gap-1.5 rounded-full border border-[#d9e5f6] bg-white px-3 py-1.5 text-[11px] font-semibold text-[#2f6ea8] shadow-sm transition hover:border-[#8bc3ff] hover:bg-[#f7fbff]"
        >
          {link.title}
          <ArrowRight size={12} className="opacity-60 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
        </Link>
      ))}
    </div>
  );
}

export function AdminSnapshotHeader({
  metrics,
  roleCounts,
}: {
  metrics: LeadershipTeamMetrics;
  roleCounts: Record<string, number>;
}) {
  return (
    <div className="mb-3">
      <p className="text-[10px] uppercase tracking-[0.2em] text-[#2f6ea8]">Organization snapshot</p>
      <p className="mt-1 text-xs text-[#5c7594]">{metrics.windowLabel}</p>
      <p className="text-[11px] text-[#6a839f]">{formatLeaderboardRefreshed(metrics.refreshedAt)}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <span className="rounded-full border border-[#dfeaf8] bg-[#f9fcff] px-3 py-1 text-[11px] font-medium text-[#35567a]">
          <span className="font-bold tabular-nums text-[#0B1B34]">{roleCounts.recruiter || 0}</span> recruiters
        </span>
        <span className="rounded-full border border-[#dfeaf8] bg-[#f9fcff] px-3 py-1 text-[11px] font-medium text-[#35567a]">
          <span className="font-bold tabular-nums text-[#0B1B34]">{roleCounts.leadership || 0}</span> leadership
        </span>
        <span className="rounded-full border border-[#dfeaf8] bg-[#f9fcff] px-3 py-1 text-[11px] font-medium text-[#35567a]">
          <span className="font-bold tabular-nums text-[#0B1B34]">{metrics.teamSize}</span> on board
        </span>
      </div>
    </div>
  );
}
