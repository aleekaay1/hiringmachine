import React from 'react';

export type LeaderboardProgressState = {
  pct: number;
  label: string;
};

export function LeaderboardRefreshProgress({
  progress,
  variant = 'bar',
}: {
  progress: LeaderboardProgressState;
  variant?: 'bar' | 'compact';
}) {
  const pct = Math.max(0, Math.min(100, Math.round(progress.pct)));

  if (variant === 'compact') {
    return (
      <div className="flex min-w-[10rem] flex-col gap-1">
        <div className="flex items-center justify-between gap-2 text-[10px] text-[#4f6886]">
          <span className="truncate font-medium">{progress.label}</span>
          <span className="shrink-0 tabular-nums font-bold text-[#2f6ea8]">{pct}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-[#dfeaf8]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#4e9ae8] to-[#2f6ea8] transition-[width] duration-300 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[#c8dcf4] bg-white/95 px-4 py-3 shadow-sm backdrop-blur-sm">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-[#0B1B34]">{progress.label}</p>
        <span
          className="text-lg font-bold tabular-nums text-[#2f6ea8]"
          style={{ fontFamily: 'Outfit, Inter, system-ui, sans-serif' }}
        >
          {pct}%
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-[#e8f2fc]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#67b5ff] via-[#4e9ae8] to-[#2f6ea8] transition-[width] duration-300 ease-out"
          style={{ width: `${Math.max(pct, pct > 0 ? 4 : 0)}%` }}
        />
      </div>
      <p className="mt-2 text-[11px] text-[#5c7594]">
        {pct >= 100 ? 'Finishing up…' : 'Please wait — large datasets can take a minute.'}
      </p>
    </div>
  );
}
