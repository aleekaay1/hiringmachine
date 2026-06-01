import React from 'react';
import { Coins } from 'lucide-react';
import { loadRecruiterCoinWallet } from '../../services/recruiterCoinService';
import { COINS_PER_SHOW } from '../../services/recruiterCoins';

type CoinWalletBadgeProps = {
  profileBalance?: number | null;
  className?: string;
};

const CoinWalletBadge: React.FC<CoinWalletBadgeProps> = ({ profileBalance = 0, className = '' }) => {
  const [balance, setBalance] = React.useState<number>(Number(profileBalance || 0));
  const [syncing, setSyncing] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    setSyncing(true);
    void loadRecruiterCoinWallet(Number(profileBalance || 0)).then((wallet) => {
      if (cancelled) return;
      setBalance(wallet.balance);
      setSyncing(false);
    });
    return () => {
      cancelled = true;
    };
  }, [profileBalance]);

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-2xl border border-amber-200/80 bg-gradient-to-r from-amber-50 via-yellow-50 to-amber-100/90 px-3 py-2 shadow-[0_4px_18px_-8px_rgba(180,120,0,0.45)] ${className}`}
      title={`Paz Coins — ${COINS_PER_SHOW} coins per webinar or live session show. Redeem for rewards coming soon.`}
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
