import React from 'react';
import { Coins } from 'lucide-react';
import { COINS_PER_SHOW } from '../../services/recruiterCoins';

export function LeaderboardCoinChip({
  balance,
  compact = false,
}: {
  balance: number | null;
  compact?: boolean;
}) {
  if (balance == null) {
    return (
      <span className="inline-flex items-center gap-1 rounded-lg border border-[#e8e0d0] bg-[#faf8f4] px-2 py-1 text-[11px] text-[#8a7340]">
        <Coins size={12} className="opacity-60" aria-hidden />
        —
      </span>
    );
  }

  if (compact) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-lg border border-amber-200/80 bg-gradient-to-r from-amber-50 to-yellow-50 px-2 py-1 text-[11px] font-bold tabular-nums text-amber-950"
        title={`${COINS_PER_SHOW} Paz Coins per show`}
      >
        <Coins size={12} className="text-amber-800" strokeWidth={2.25} aria-hidden />
        {balance.toLocaleString()}
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200/80 bg-gradient-to-r from-amber-50 via-yellow-50 to-amber-100/90 px-2.5 py-1.5 text-xs font-bold tabular-nums text-amber-950 shadow-[0_2px_10px_-4px_rgba(180,120,0,0.35)]"
      title={`${COINS_PER_SHOW} Paz Coins per webinar or live session show`}
    >
      <Coins size={14} className="text-amber-800" strokeWidth={2.25} aria-hidden />
      <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-amber-800/85">Paz Coins</span>
      {balance.toLocaleString()}
    </span>
  );
}
