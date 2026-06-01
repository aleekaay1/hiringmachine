import { supabase } from './supabaseClient';
import { COINS_PER_SHOW, type RecruiterCoinLedgerRow } from './recruiterCoins';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export type RecruiterCoinWallet = {
  balance: number;
  coinsPerShow: number;
  totalEvents: number;
  recentEvents: RecruiterCoinLedgerRow[];
  ledgerReady: boolean;
};

export async function syncMyRecruiterCoins(): Promise<{
  balance: number;
  totalEvents: number;
  ledgerReady: boolean;
  error?: string;
}> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { balance: 0, totalEvents: 0, ledgerReady: false, error: 'App not configured' };
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) {
    return { balance: 0, totalEvents: 0, ledgerReady: false, error: 'Not signed in' };
  }

  const res = await fetch(`${SUPABASE_URL}/functions/v1/sync-recruiter-coins`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({}),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      balance: 0,
      totalEvents: 0,
      ledgerReady: false,
      error: (payload?.error as string) || res.statusText || 'Sync failed',
    };
  }

  return {
    balance: Number(payload.balance || 0),
    totalEvents: Number(payload.totalEvents || 0),
    ledgerReady: true,
  };
}

export async function loadMyCoinLedgerRecent(limit = 8): Promise<RecruiterCoinLedgerRow[]> {
  const { data, error } = await supabase
    .from('recruiter_coin_ledger')
    .select('id, source_type, source_key, points, label, earned_at')
    .order('earned_at', { ascending: false })
    .limit(limit);

  if (error) {
    if (/relation|does not exist|schema cache/i.test(error.message)) return [];
    throw error;
  }

  return (data || []) as RecruiterCoinLedgerRow[];
}

export async function loadRecruiterCoinWallet(profileBalance: number): Promise<RecruiterCoinWallet> {
  const sync = await syncMyRecruiterCoins();
  const balance = sync.ledgerReady ? sync.balance : profileBalance;
  let recentEvents: RecruiterCoinLedgerRow[] = [];
  if (sync.ledgerReady) {
    try {
      recentEvents = await loadMyCoinLedgerRecent(6);
    } catch {
      recentEvents = [];
    }
  }

  return {
    balance,
    coinsPerShow: COINS_PER_SHOW,
    totalEvents: sync.totalEvents,
    recentEvents,
    ledgerReady: sync.ledgerReady,
  };
}
