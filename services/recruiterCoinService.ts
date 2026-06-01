import { supabase } from './supabaseClient';
import { COINS_PER_SHOW, type RecruiterCoinLedgerRow } from './recruiterCoins';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export type RecruiterCoinWallet = {
  balance: number;
  coinsPerShow: number;
  recentEvents: RecruiterCoinLedgerRow[];
  ledgerReady: boolean;
  ledgerMissing: boolean;
};

async function postRecruiterCoinSync(body: Record<string, unknown> = {}): Promise<{
  ok: boolean;
  balance?: number;
  totalEvents?: number;
  ledgerReady?: boolean;
  ledgerMissing?: boolean;
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
    ledgerReady: payload.ledgerReady !== false,
    ledgerMissing: payload.ledgerMissing === true,
  };
}

export async function syncMyRecruiterCoins(): Promise<{
  balance: number;
  ledgerReady: boolean;
  ledgerMissing: boolean;
  error?: string;
}> {
  const result = await postRecruiterCoinSync({});
  if (!result.ok) {
    return { balance: 0, ledgerReady: false, ledgerMissing: false, error: result.error };
  }
  return {
    balance: result.balance ?? 0,
    ledgerReady: result.ledgerReady ?? false,
    ledgerMissing: result.ledgerMissing ?? false,
  };
}

export async function syncAllRecruiterCoins(): Promise<{
  ok: boolean;
  usersSynced?: number;
  ledgerMissing?: boolean;
  error?: string;
}> {
  const result = await postRecruiterCoinSync({ syncAll: true });
  if (!result.ok) return { ok: false, error: result.error };
  return {
    ok: true,
    ledgerMissing: result.ledgerMissing,
  };
}

export async function loadMyCoinLedgerRecent(limit = 8): Promise<RecruiterCoinLedgerRow[]> {
  const { data, error } = await supabase
    .from('recruiter_coin_ledger')
    .select('id, source_type, source_key, points, label, earned_at')
    .order('earned_at', { ascending: false })
    .limit(limit);

  if (error) {
    if (/relation|does not exist|schema cache|PGRST205|404/i.test(error.message)) return [];
    throw error;
  }

  return (data || []) as RecruiterCoinLedgerRow[];
}

export async function loadRecruiterCoinWallet(profileBalance: number): Promise<RecruiterCoinWallet> {
  const sync = await syncMyRecruiterCoins();
  const ledgerMissing = sync.ledgerMissing;
  const ledgerReady = sync.ledgerReady && !ledgerMissing;
  const balance = ledgerReady ? sync.balance : Number(profileBalance || 0);

  let recentEvents: RecruiterCoinLedgerRow[] = [];
  if (ledgerReady) {
    try {
      recentEvents = await loadMyCoinLedgerRecent(6);
    } catch {
      recentEvents = [];
    }
  }

  return {
    balance,
    coinsPerShow: COINS_PER_SHOW,
    recentEvents,
    ledgerReady,
    ledgerMissing,
  };
}
