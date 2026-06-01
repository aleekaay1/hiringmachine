import React from 'react';
import { Coins, Sparkles } from 'lucide-react';
import type { RecruiterCoinWallet } from '../../services/recruiterCoinService';
import { COINS_PER_SHOW } from '../../services/recruiterCoins';
import { formatDateTimeCanadaEastern } from '../../services/dateDisplay';

const RecruiterCoinsPanel: React.FC<{ wallet: RecruiterCoinWallet | null; loading?: boolean }> = ({
  wallet,
  loading,
}) => {
  if (loading || !wallet) {
    return (
      <div className="rounded-3xl border border-amber-200/60 bg-gradient-to-br from-amber-50/90 to-white/80 p-4 text-sm text-amber-900/70">
        Loading your Paz Coins…
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-amber-200/70 bg-gradient-to-br from-amber-50 via-yellow-50/80 to-white/90 p-4 md:p-5 shadow-[0_12px_40px_-24px_rgba(146,100,10,0.55)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-300 to-amber-500 shadow-md">
            <Coins size={24} className="text-amber-950" strokeWidth={2.2} />
          </span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-amber-800">Paz Coins</p>
            <p
              className="text-3xl font-bold tabular-nums text-amber-950"
              style={{ fontFamily: 'Outfit, Inter, system-ui, sans-serif' }}
            >
              {wallet.balance.toLocaleString()}
            </p>
            <p className="mt-1 max-w-md text-xs text-amber-900/80">
              You earn <strong>{COINS_PER_SHOW} coins</strong> every time a candidate you booked attends a
              webinar or live session (last {wallet.lookbackDays} days are credited on sync, then new shows
              add automatically). Save them up — rewards and bonuses redemption is coming soon.
            </p>
          </div>
        </div>
        <div className="rounded-xl border border-amber-200/60 bg-white/60 px-3 py-2 text-xs text-amber-900/85">
          <p className="flex items-center gap-1 font-semibold text-amber-950">
            <Sparkles size={14} /> {wallet.totalEvents} shows credited
          </p>
          <p className="mt-0.5 text-[11px] text-amber-800/75">
            {wallet.ledgerReady
              ? `${wallet.creditedInWindow} shows in last ${wallet.lookbackDays} days · wallet synced`
              : 'Run Fetch on Webinar Geek to refresh shows'}
          </p>
        </div>
      </div>

      {wallet.recentEvents.length > 0 && (
        <div className="mt-4 border-t border-amber-200/50 pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-800/90 mb-2">
            Recent earnings
          </p>
          <ul className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
            {wallet.recentEvents.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between gap-3 rounded-lg bg-white/55 border border-amber-100/80 px-2.5 py-1.5 text-xs"
              >
                <span className="min-w-0 truncate text-amber-950/90">{row.label || row.source_type}</span>
                <span className="shrink-0 text-right">
                  <span className="block font-bold tabular-nums text-amber-800">+{row.points}</span>
                  <span className="block text-[10px] text-amber-800/60">
                    {formatDateTimeCanadaEastern(row.earned_at)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default RecruiterCoinsPanel;
