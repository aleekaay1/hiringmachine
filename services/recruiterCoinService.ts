import { supabase } from './supabaseClient';
import {
  COIN_LOOKBACK_DAYS,
  COINS_PER_SHOW,
  type RecruiterCoinLedgerRow,
} from './recruiterCoins';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export type RecruiterCoinWallet = {
  balance: number;
  coinsPerShow: number;
  lookbackDays: number;
  totalEvents: number;
  creditedInWindow: number;
  recentEvents: RecruiterCoinLedgerRow[];
  ledgerReady: boolean;
};

async function postRecruiterCoinSync(body: Record<string, unknown> = {}): Promise<{
  ok: boolean;
  balance?: number;
  totalEvents?: number;
  creditedInWindow?: number;
  error?: string;
}> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { ok: false, error: 'App not configured' };
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) {
    return { ok: false, error: 'Not signed in' };
  }

  const res = await fetch(`${SUPABASE_URL}/functions/v1/sync-recruiter-coins`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      error: (payload?.error as string) || res.statusText || 'Sync failed',
    };
  }

  return {
    ok: true,
    balance: Number(payload.balance || 0),
    totalEvents: Number(payload.totalEvents || 0),
    creditedInWindow: Number(payload.creditedInWindow || 0),
  };
}

export async function syncMyRecruiterCoins(): Promise<{
  balance: number;
  totalEvents: number;
  creditedInWindow: number;
  ledgerReady: boolean;
  error?: string;
}> {
  const result = await postRecruiterCoinSync({});
  if (!result.ok) {
    return { balance: 0, totalEvents: 0, creditedInWindow: 0, ledgerReady: false, error: result.error };
  }
  return {
    balance: result.balance ?? 0,
    totalEvents: result.totalEvents ?? 0,
    creditedInWindow: result.creditedInWindow ?? 0,
    ledgerReady: true,
  };
}

/** Admin/leadership: backfill last 14 days of shows for every eligible recruiter account. */
export async function syncAllRecruiterCoins(): Promise<{
  ok: boolean;
  usersSynced?: number;
  error?: string;
}> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { ok: false, error: 'App not configured' };
  }
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return { ok: false, error: 'Not signed in' };

  const res = await fetch(`${SUPABASE_URL}/functions/v1/sync-recruiter-coins`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ syncAll: true }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: (payload?.error as string) || res.statusText || 'Sync failed' };
  }
  return { ok: true, usersSynced: Number(payload.usersSynced || 0) };
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
    lookbackDays: COIN_LOOKBACK_DAYS,
    totalEvents: sync.totalEvents,
    creditedInWindow: sync.creditedInWindow,
    recentEvents,
    ledgerReady: sync.ledgerReady,
  };
}
