import React from 'react';
import { Coins } from 'lucide-react';
import { loadRecruiterCoinWallet, syncAllRecruiterCoins } from '../../services/recruiterCoinService';
import type { AppRole } from '../../services/accessControl';
import { COINS_PER_SHOW } from '../../services/recruiterCoins';

const BACKFILL_SESSION_KEY = 'paz_coins_team_backfill_v4';

type CoinWalletBadgeProps = {
  profileBalance?: number | null;
  profileEmail?: string | null;
  profileFullName?: string | null;
  role?: AppRole | null;
  className?: string;
};

const CoinWalletBadge: React.FC<CoinWalletBadgeProps> = ({
  profileBalance = 0,
  profileEmail = null,
  profileFullName = null,
  role = null,
  className = '',
}) => {
  const [balance, setBalance] = React.useState<number>(Number(profileBalance || 0));
  const [syncing, setSyncing] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    setSyncing(true);

    const run = async () => {
      const isAdmin = role === 'admin' || role === 'leadership';
      if (isAdmin && !sessionStorage.getItem(BACKFILL_SESSION_KEY)) {
        await syncAllRecruiterCoins().catch(() => undefined);
        sessionStorage.setItem(BACKFILL_SESSION_KEY, '1');
      }
      const wallet = await loadRecruiterCoinWallet({
        profileBalance: Number(profileBalance || 0),
        email: profileEmail,
        fullName: profileFullName,
      });
      if (cancelled) return;
      setBalance(wallet.balance);
      setSyncing(false);
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [profileBalance, profileEmail, profileFullName, role]);

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-2xl border border-amber-200/80 bg-gradient-to-r from-amber-50 via-yellow-50 to-amber-100/90 px-3 py-2 shadow-[0_4px_18px_-8px_rgba(180,120,0,0.45)] ${className}`}
      title={`Paz Coins — ${COINS_PER_SHOW} per show. Save them up for rewards coming soon.`}
    >
      <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 to-amber-500 shadow-inner">
        <Coins size={18} className="text-amber-950" strokeWidth={2.25} />
      </span>
      <div className="text-left leading-tight">
        <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-amber-800/90">Paz Coins</p>
        <p
          className="text-lg font-bold tabular-nums text-amber-950"
          style={{ fontFamily: 'Outfit, Inter, system-ui, sans-serif' }}
        >
          {syncing ? '…' : balance.toLocaleString()}
        </p>
      </div>
    </div>
  );
};

export default CoinWalletBadge;
