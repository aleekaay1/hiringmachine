import React from 'react';
import { Coins } from 'lucide-react';
import type { RecruiterCoinWallet } from '../../services/recruiterCoinService';
import { COINS_PER_SHOW } from '../../services/recruiterCoins';

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
            You earn <strong>{COINS_PER_SHOW} coins</strong> when your webinar or live session bookings show up.
            Save them up — rewards and bonuses are coming soon.
          </p>
        </div>
      </div>
    </div>
  );
};

export default RecruiterCoinsPanel;
