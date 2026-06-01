import React from 'react';
import { Clock } from 'lucide-react';
import { formatCountdownRemaining } from '../../services/leaderboardCountdown';

export function LeaderboardWeekCountdown({
  endAt,
  label = 'This week ends Thursday night',
  sublabel = 'Fri–Thu week · rankings lock when the timer hits zero',
}: {
  endAt: Date;
  label?: string;
  sublabel?: string;
}) {
  const [remainingMs, setRemainingMs] = React.useState(() => Math.max(0, endAt.getTime() - Date.now()));

  React.useEffect(() => {
    const tick = () => setRemainingMs(Math.max(0, endAt.getTime() - Date.now()));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [endAt]);

  return (
    <div className="mx-auto max-w-xl rounded-2xl border border-[#c5daf3] bg-gradient-to-r from-[#0B1B34] via-[#123563] to-[#1a4a7c] px-4 py-3 text-center text-white shadow-lg">
      <p className="inline-flex items-center justify-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-200/90">
        <Clock size={13} aria-hidden />
        {label}
      </p>
      <p
        className="mt-1 text-2xl font-bold tabular-nums tracking-tight sm:text-3xl"
        style={{ fontFamily: 'Outfit, Inter, system-ui, sans-serif' }}
      >
        {formatCountdownRemaining(remainingMs)}
      </p>
      <p className="mt-1 text-[11px] text-sky-100/80">{sublabel}</p>
    </div>
  );
}
