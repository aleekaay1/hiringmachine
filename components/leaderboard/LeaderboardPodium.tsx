import React from 'react';
import { Crown, Medal, Trophy } from 'lucide-react';
import StaffAvatar from '../StaffAvatar';
import type { StaffAvatarLookup } from '../../services/staffAvatarLookup';
import type { RecruiterLeaderboardRow } from '../../services/pipelineLeaderboard';

function pct(value: number): number {
  return Math.round(value * 100);
}

type PodiumSlotProps = {
  row: RecruiterLeaderboardRow | null;
  rank: 1 | 2 | 3;
  orderClass: string;
  pedestalClass: string;
  avatarRing: string;
  rankBadge: string;
  RankIcon: React.ComponentType<{ size?: number; className?: string }>;
  avatarLookup?: StaffAvatarLookup;
};

function PodiumSlot({
  row,
  rank,
  orderClass,
  pedestalClass,
  avatarRing,
  rankBadge,
  RankIcon,
  avatarLookup,
}: PodiumSlotProps) {
  if (!row) {
    return (
      <div className={`flex flex-col items-center ${orderClass}`}>
        <div className={`flex h-16 w-16 items-center justify-center rounded-full border-2 border-dashed border-white/25 bg-white/5 text-sm text-white/40`}>
          —
        </div>
        <div className={`mt-3 w-full max-w-[11rem] rounded-t-2xl ${pedestalClass} px-3 py-6 text-center`}>
          <p className="text-xs text-white/50">No #{rank} yet</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col items-center ${orderClass}`}>
      <div className="relative mb-2">
        {rank === 1 && (
          <Crown
            size={22}
            className="absolute -top-6 left-1/2 -translate-x-1/2 text-amber-300 drop-shadow"
            aria-hidden
          />
        )}
        <div className="relative">
          <StaffAvatar
            name={row.displayName}
            userId={row.recruiterUserId}
            lookup={avatarLookup}
            size="lg"
            ringClassName={`border-[3px] shadow-xl ${avatarRing}`}
            className="sm:!h-20 sm:!w-20 sm:!text-xl"
          />
          <span
            className={`absolute -bottom-1 -right-1 inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-[#0B1B34] text-[10px] font-bold shadow ${rankBadge}`}
          >
            {rank}
          </span>
        </div>
      </div>
      <p
        className="max-w-[9.5rem] truncate text-center text-sm font-semibold text-white sm:text-base"
        style={{ fontFamily: 'Outfit, Inter, system-ui, sans-serif' }}
        title={row.displayName}
      >
        {row.displayName}
      </p>
      <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-sky-100/90">
        <RankIcon size={12} aria-hidden />
        Score {row.score.toFixed(1)}
      </p>
      <p className="mt-0.5 text-[10px] tabular-nums text-white/70">
        {row.webinarShowed} shows · {row.webinarBooked} booked · {pct(row.showRatio)}% rate
      </p>
      <div
        className={`mt-3 flex w-full max-w-[11rem] flex-col items-center justify-end rounded-t-2xl border border-white/10 px-3 pb-3 pt-4 text-center shadow-inner ${pedestalClass}`}
      >
        <p className="text-[10px] font-semibold uppercase tracking-wider text-white/60">Rank {rank}</p>
      </div>
    </div>
  );
}

export function LeaderboardPodium({
  first,
  second,
  third,
  avatarLookup,
}: {
  first: RecruiterLeaderboardRow | null;
  second: RecruiterLeaderboardRow | null;
  third: RecruiterLeaderboardRow | null;
  avatarLookup?: StaffAvatarLookup;
}) {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-[#1c3760] bg-gradient-to-b from-[#0f2848] via-[#123563] to-[#1a4a7c] px-3 pb-2 pt-10 sm:px-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,215,120,0.12),transparent_55%)]" />
      <div className="relative grid grid-cols-3 items-end gap-2 sm:gap-4">
        <PodiumSlot
          row={second}
          rank={2}
          orderClass="order-1 pb-0"
          pedestalClass="min-h-[5.5rem] bg-gradient-to-t from-slate-400/35 to-slate-300/15"
          avatarRing="border-slate-200"
          rankBadge="bg-slate-200 text-slate-800"
          RankIcon={Medal}
          avatarLookup={avatarLookup}
        />
        <PodiumSlot
          row={first}
          rank={1}
          orderClass="order-2 -mt-6 pb-0 sm:-mt-8"
          pedestalClass="min-h-[7.5rem] bg-gradient-to-t from-amber-400/40 to-amber-200/15"
          avatarRing="border-amber-200"
          rankBadge="bg-amber-300 text-amber-950"
          RankIcon={Trophy}
          avatarLookup={avatarLookup}
        />
        <PodiumSlot
          row={third}
          rank={3}
          orderClass="order-3 pb-0"
          pedestalClass="min-h-[4.75rem] bg-gradient-to-t from-orange-400/30 to-orange-200/12"
          avatarRing="border-orange-200"
          rankBadge="bg-orange-200 text-orange-950"
          RankIcon={Medal}
          avatarLookup={avatarLookup}
        />
      </div>
    </div>
  );
}
