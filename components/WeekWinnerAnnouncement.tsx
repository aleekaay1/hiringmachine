import React from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  CalendarCheck,
  Crown,
  Phone,
  Sparkles,
  Star,
  TrendingUp,
  Trophy,
  UserCheck,
  X,
} from 'lucide-react';
import { LeaderboardCoinChip } from './dashboard/LeaderboardCoinChip';
import StaffAvatar from './StaffAvatar';
import { useStaffAvatarLookup } from '../hooks/useStaffAvatarLookup';
import { loadLeaderboardSnapshot } from '../services/pipelineLeaderboardCache';
import {
  dismissWeekWinnerAnnouncement,
  estimateWeekPazCoinsFromLeaderboardRow,
  formatWeekWinnerPeriodLabel,
  isWeekWinnerAnnouncementOpen,
  isWeekWinnerDismissed,
  lastCompletedCompetitionWeek,
  markWeekWinnerShownThisSession,
  pickWeekWinner,
  wasWeekWinnerShownThisSession,
  type LastWeekWinnerContext,
} from '../services/weekWinnerPopup';


function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type StatTileProps = {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string | number;
};

function StatTile({ icon: Icon, label, value }: StatTileProps) {
  return (
    <div className="rounded-2xl border border-white/15 bg-white/10 px-3 py-2.5 backdrop-blur-sm">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-100/75">
        <Icon size={12} aria-hidden />
        {label}
      </div>
      <p className="mt-1 text-lg font-bold tabular-nums text-white">{value}</p>
    </div>
  );
}

type WeekWinnerModalProps = {
  context: LastWeekWinnerContext;
  onClose: () => void;
};

function WeekWinnerModal({ context, onClose }: WeekWinnerModalProps) {
  const { winner, weekPazCoins } = context;
  const avatarLookup = useStaffAvatarLookup();
  const periodLabel = formatWeekWinnerPeriodLabel(context.weekSinceYmd, context.weekUntilYmd);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[260] flex items-center justify-center bg-[#061428]/70 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        className="relative w-full max-w-lg overflow-hidden rounded-[28px] border border-[#f0ce8f]/40 shadow-[0_40px_120px_-40px_rgba(0,0,0,0.75)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="week-winner-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,215,120,0.22),transparent_58%)]" />
        <div className="pointer-events-none absolute -left-16 top-8 h-40 w-40 rounded-full bg-amber-300/20 blur-3xl" />
        <div className="pointer-events-none absolute -right-10 bottom-0 h-44 w-44 rounded-full bg-sky-400/15 blur-3xl" />

        <div className="relative bg-gradient-to-b from-[#0f2848] via-[#123563] to-[#1a4a7c] px-5 pb-5 pt-4 sm:px-6 sm:pb-6">
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white/80 transition hover:bg-white/20 hover:text-white"
            aria-label="Close weekly winner announcement"
          >
            <X size={18} aria-hidden />
          </button>

          <div className="flex flex-col items-center pt-2 text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200/30 bg-amber-300/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-100">
              <Sparkles size={12} aria-hidden />
              Week complete
            </span>
            <h2
              id="week-winner-title"
              className="mt-3 text-2xl font-bold tracking-tight text-white sm:text-[1.65rem]"
              style={{ fontFamily: 'Outfit, Inter, system-ui, sans-serif' }}
            >
              Last week&apos;s champion
            </h2>
            <p className="mt-1 text-sm text-sky-100/80">
              Fri–Thu · {periodLabel}
            </p>
          </div>

          <div className="relative mx-auto mt-6 flex flex-col items-center">
            <Crown size={28} className="mb-2 text-amber-300 drop-shadow" aria-hidden />
            <StaffAvatar
              name={winner.displayName}
              userId={winner.recruiterUserId}
              lookup={avatarLookup}
              size="xl"
              ringClassName="border-[3px] border-amber-200 shadow-xl"
              className="!h-24 !w-24 !text-2xl"
            />
            <p
              className="mt-4 max-w-[18rem] truncate text-xl font-semibold text-white sm:text-2xl"
              style={{ fontFamily: 'Outfit, Inter, system-ui, sans-serif' }}
              title={winner.displayName}
            >
              {winner.displayName}
            </p>
            <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-amber-100/90">
              <Trophy size={15} aria-hidden />
              #1 on the leaderboard
            </p>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <StatTile icon={Star} label="Score" value={winner.score.toFixed(1)} />
            <StatTile icon={TrendingUp} label="Show rate" value={pct(winner.showRatio)} />
            <StatTile icon={Phone} label="Calls" value={winner.calls} />
            <StatTile icon={CalendarCheck} label="Booked" value={winner.booked} />
            <StatTile icon={UserCheck} label="Shows" value={winner.webinarShowed + winner.liveSessionShowed} />
            <StatTile icon={UserCheck} label="Live shows" value={winner.liveSessionShowed} />
          </div>

          <div className="mt-4 flex flex-col items-center gap-2 rounded-2xl border border-amber-200/25 bg-amber-50/10 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-100/80">
              Paz Coins earned last week
            </p>
            <LeaderboardCoinChip balance={weekPazCoins} />
            <p className="text-center text-[11px] text-white/55">
              From webinar and live session shows in that week
            </p>
          </div>

          <p className="mt-4 text-center text-xs text-white/50">
            New week is live — climb the board before Thursday night.
          </p>
        </div>
      </motion.div>
    </motion.div>
  );
}

type WeekWinnerAnnouncementProps = {
  userId: string | null;
};

const WeekWinnerAnnouncement: React.FC<WeekWinnerAnnouncementProps> = ({ userId }) => {
  const [open, setOpen] = React.useState(false);
  const [context, setContext] = React.useState<LastWeekWinnerContext | null>(null);

  React.useEffect(() => {
    if (!userId) return;
    if (!isWeekWinnerAnnouncementOpen()) return;

    const week = lastCompletedCompetitionWeek();
    if (isWeekWinnerDismissed(userId, week.since)) return;
    if (wasWeekWinnerShownThisSession(userId, week.since)) return;

    let cancelled = false;

    void (async () => {
      const { data } = await loadLeaderboardSnapshot('lastWeek');
      if (cancelled) return;

      const winner = pickWeekWinner(data?.rows ?? []);
      if (!winner) return;

      setContext({
        weekSinceYmd: week.since,
        weekUntilYmd: week.until,
        windowLabel: data?.windowLabel || week.title,
        winner,
        weekPazCoins: estimateWeekPazCoinsFromLeaderboardRow(winner),
      });
      setOpen(true);
      markWeekWinnerShownThisSession(userId, week.since);
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const handleClose = React.useCallback(() => {
    if (userId && context) {
      dismissWeekWinnerAnnouncement(userId, context.weekSinceYmd);
    }
    setOpen(false);
  }, [userId, context]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && context ? <WeekWinnerModal context={context} onClose={handleClose} /> : null}
    </AnimatePresence>,
    document.body,
  );
};

export default WeekWinnerAnnouncement;
