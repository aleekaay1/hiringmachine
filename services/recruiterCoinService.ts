import { buildRecruiterScopeTokens, recruiterOwnsNameKey, type UserProfile } from './accessControl';
import { supabase } from './supabaseClient';
import { filterRowsForRecruiterOwnership } from './recruiterDataScope';
import { loadWebinarGeekDashboardCache } from './webinarGeekDashboardCache';
import {
  COINS_PER_SHOW,
  coinEarnWindow,
  coinShowDateYmdForWebinarRow,
  webinarShowedFromRow,
  ymdInCoinEarnWindow,
  type RecruiterCoinLedgerRow,
} from './recruiterCoins';

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

export async function estimateCoinBalanceFromWebinarCache(
  userEmail: string | null,
  userFullName: string | null,
): Promise<number> {
  const { data } = await loadWebinarGeekDashboardCache();
  const rows = data?.subscriptions || [];
  if (!rows.length) return 0;

  const window = coinEarnWindow();
  const scoped = filterRowsForRecruiterOwnership(rows, userEmail, userFullName);
  let shows = 0;
  for (const row of scoped) {
    if (!webinarShowedFromRow(row)) continue;
    if (!ymdInCoinEarnWindow(coinShowDateYmdForWebinarRow(row), window)) continue;
    shows += 1;
  }
  return shows * COINS_PER_SHOW;
}

function normalizeCoinLookupToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function readRpcCoinRow(row: Record<string, unknown>): { userId: string; balance: number } | null {
  const userId = String(row.user_id ?? row.userId ?? '').trim();
  if (!userId) return null;
  const balance = Number(row.balance ?? row.points ?? 0);
  return { userId, balance: Number.isFinite(balance) ? balance : 0 };
}

/** Team coin totals for leaderboard (RPC when deployed, else visible profile rows). */
export async function loadRecruiterCoinBalanceMap(): Promise<Map<string, number>> {
  const map = new Map<string, number>();

  const { data: rpcData, error: rpcError } = await supabase.rpc('list_recruiter_coin_balances');
  if (!rpcError && Array.isArray(rpcData)) {
    for (const row of rpcData) {
      const parsed = readRpcCoinRow(row as Record<string, unknown>);
      if (parsed) map.set(parsed.userId, parsed.balance);
    }
    return map;
  }

  const { data, error } = await supabase.from('user_profiles').select('user_id, points, role');
  if (error) {
    if (/relation|does not exist|schema cache|PGRST205|404/i.test(error.message)) return map;
    throw error;
  }

  for (const row of data || []) {
    const role = String((row as { role?: string }).role || '');
    if (role !== 'recruiter' && role !== 'webinar' && role !== 'leadership') continue;
    const userId = String((row as { user_id?: string }).user_id || '').trim();
    if (!userId) continue;
    map.set(userId, Number((row as { points?: number }).points || 0));
  }

  return map;
}

/** Map normalized display/email tokens → user_id for leaderboard rows missing recruiterUserId. */
export function buildDisplayNameToUserId(profiles: UserProfile[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const profile of profiles) {
    const userId = String(profile.user_id || '').trim();
    if (!userId) continue;

    const add = (raw: string) => {
      const token = normalizeCoinLookupToken(raw);
      if (token) map.set(token, userId);
    };

    add(String(profile.full_name || ''));
    const email = String(profile.email || '').trim().toLowerCase();
    add(email);
    const local = email.split('@')[0] || '';
    add(local);
    add(local.replace(/[._-]+/g, ' '));
    add(local.replace(/[._-]+/g, ''));

    const tokens = buildRecruiterScopeTokens(profile.email ?? null, profile.full_name ?? null);
    for (const token of tokens) {
      map.set(token, userId);
    }
  }
  return map;
}

export type LeaderboardCoinLookup = {
  byUserId: Map<string, number>;
  displayNameToUserId: Map<string, string>;
};

export async function loadLeaderboardCoinLookup(profiles: UserProfile[]): Promise<LeaderboardCoinLookup> {
  const byUserId = await loadRecruiterCoinBalanceMap();
  return {
    byUserId,
    displayNameToUserId: buildDisplayNameToUserId(profiles),
  };
}

export type LeaderboardCoinRowRef = {
  recruiterUserId: string | null;
  recruiterKey: string;
  displayName: string;
};

export function resolveLeaderboardRowUserId(
  row: LeaderboardCoinRowRef,
  displayNameToUserId: Map<string, string>,
): string | null {
  const direct = String(row.recruiterUserId || '').trim();
  if (direct) return direct;

  if (row.recruiterKey.startsWith('uid:')) {
    const fromKey = row.recruiterKey.slice(4).trim();
    if (fromKey) return fromKey;
  }

  const displayToken = normalizeCoinLookupToken(row.displayName);
  if (displayToken && displayNameToUserId.has(displayToken)) {
    return displayNameToUserId.get(displayToken)!;
  }

  for (const [token, userId] of displayNameToUserId) {
    if (token.length < 5) continue;
    if (recruiterOwnsNameKey(row.displayName, new Set([token]))) return userId;
  }

  return null;
}

export function coinBalanceForLeaderboardRow(
  row: LeaderboardCoinRowRef,
  lookup: LeaderboardCoinLookup | Map<string, number>,
  displayNameToUserId?: Map<string, string>,
): number {
  const byUserId = lookup instanceof Map ? lookup : lookup.byUserId;
  const nameMap =
    lookup instanceof Map ? displayNameToUserId ?? new Map<string, string>() : lookup.displayNameToUserId;

  const userId = resolveLeaderboardRowUserId(row, nameMap);
  if (!userId) return 0;
  return byUserId.get(userId) ?? 0;
}

export async function loadRecruiterCoinWallet(input: {
  profileBalance?: number;
  email?: string | null;
  fullName?: string | null;
}): Promise<RecruiterCoinWallet> {
  const profileBalance = Number(input.profileBalance || 0);
  const sync = await syncMyRecruiterCoins();
  const ledgerMissing = sync.ledgerMissing;
  const ledgerReady = sync.ledgerReady && !ledgerMissing;

  let balance = ledgerReady ? sync.balance : profileBalance;
  if (balance <= 0) {
    const estimated = await estimateCoinBalanceFromWebinarCache(
      input.email ?? null,
      input.fullName ?? null,
    ).catch(() => 0);
    if (estimated > balance) balance = estimated;
  }

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
