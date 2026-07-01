import { buildRecruiterScopeTokens, recruiterOwnsNameKey, type UserProfile } from './accessControl';
import { supabase } from './supabaseClient';
import { filterRowsForRecruiterOwnership } from './recruiterDataScope';
import { loadWebinarGeekDashboardCache } from './webinarGeekDashboardCache';
import {
  resolveWebinarRowRecruiterUserId,
  seedsFromProfiles,
} from './pipelineLeaderboard';
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

const COIN_SYNC_COOLDOWN_MS = 5 * 60 * 1000;
const COIN_SYNC_AT_KEY = 'paz_recruiter_coin_sync_at';
const COIN_SYNC_BALANCE_KEY = 'paz_recruiter_coin_balance';

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
  try {
    const lastSync = Number(sessionStorage.getItem(COIN_SYNC_AT_KEY) || 0);
    const cachedBalance = sessionStorage.getItem(COIN_SYNC_BALANCE_KEY);
    if (
      cachedBalance
      && Number.isFinite(lastSync)
      && Date.now() - lastSync < COIN_SYNC_COOLDOWN_MS
    ) {
      return {
        balance: Number(cachedBalance),
        ledgerReady: true,
        ledgerMissing: false,
      };
    }
  } catch {
    // sessionStorage unavailable
  }

  const result = await postRecruiterCoinSync({});
  if (!result.ok) {
    return { balance: 0, ledgerReady: false, ledgerMissing: false, error: result.error };
  }
  try {
    sessionStorage.setItem(COIN_SYNC_AT_KEY, String(Date.now()));
    sessionStorage.setItem(COIN_SYNC_BALANCE_KEY, String(result.balance ?? 0));
  } catch {
    // ignore
  }
  return {
    balance: result.balance ?? 0,
    ledgerReady: result.ledgerReady ?? false,
    ledgerMissing: result.ledgerMissing ?? false,
  };
}

/** After admin marks a CRM candidate Hired, credit the recruiter who dispositioned Booked (if any). */
export async function syncRecruiterCoinsAfterCandidateHired(assessmentCandidateId: string): Promise<void> {
  const id = assessmentCandidateId.trim();
  if (!id) return;
  await postRecruiterCoinSync({ assessmentCandidateId: id });
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

function mergeCoinBalance(map: Map<string, number>, userId: string, balance: number): void {
  if (!userId) return;
  const next = Number(balance);
  if (!Number.isFinite(next) || next < 0) return;
  const prev = map.get(userId) ?? 0;
  if (next > prev) map.set(userId, next);
}

/** Team coin totals — RPC (ledger sum) with profiles.points fallback. */
export async function loadRecruiterCoinBalanceMap(): Promise<Map<string, number>> {
  const map = new Map<string, number>();

  const { data: rpcData, error: rpcError } = await supabase.rpc('list_recruiter_coin_balances');
  if (!rpcError && Array.isArray(rpcData)) {
    for (const row of rpcData) {
      const parsed = readRpcCoinRow(row as Record<string, unknown>);
      if (parsed) mergeCoinBalance(map, parsed.userId, parsed.balance);
    }
  }

  const { data: profileRows, error: profileErr } = await supabase
    .from('user_profiles')
    .select('user_id, points, role');
  if (!profileErr) {
    for (const row of profileRows || []) {
      const role = String((row as { role?: string }).role || '');
      if (role !== 'recruiter' && role !== 'webinar' && role !== 'leadership') continue;
      const userId = String((row as { user_id?: string }).user_id || '').trim();
      mergeCoinBalance(map, userId, Number((row as { points?: number }).points || 0));
    }
  }

  if (rpcError) {
    const ledgerSum = new Map<string, number>();
    const { data: ledgerRows, error: ledgerErr } = await supabase
      .from('recruiter_coin_ledger')
      .select('user_id, points');
    if (!ledgerErr) {
      for (const row of ledgerRows || []) {
        const userId = String((row as { user_id?: string }).user_id || '').trim();
        if (!userId) continue;
        ledgerSum.set(userId, (ledgerSum.get(userId) ?? 0) + Number((row as { points?: number }).points || 0));
      }
      for (const [userId, sum] of ledgerSum) {
        mergeCoinBalance(map, userId, sum);
      }
    }
  }

  return map;
}

/** Map display/email tokens → user_id for leaderboard rows. */
export function buildDisplayNameToUserId(profiles: UserProfile[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const profile of profiles) {
    const userId = String(profile.user_id || '').trim();
    if (!userId) continue;

    const addKey = (raw: string) => {
      const trimmed = String(raw || '').trim().toLowerCase();
      if (!trimmed) return;
      map.set(trimmed, userId);
      const token = normalizeCoinLookupToken(trimmed);
      if (token) map.set(token, userId);
    };

    addKey(String(profile.full_name || ''));
    const email = String(profile.email || '').trim().toLowerCase();
    addKey(email);
    const local = email.split('@')[0] || '';
    addKey(local);
    addKey(local.replace(/[._-]+/g, ' '));
    addKey(local.replace(/[._-]+/g, ''));

    const tokens = buildRecruiterScopeTokens(profile.email ?? null, profile.full_name ?? null);
    for (const token of tokens) {
      map.set(token, userId);
    }
  }
  return map;
}

/** Direct label → balance (matches leaderboard displayName / email local part). */
export function buildBalanceByDisplayLabel(
  profiles: UserProfile[],
  byUserId: Map<string, number>,
): Map<string, number> {
  const map = new Map<string, number>();
  const attach = (label: string, userId: string) => {
    const key = label.trim().toLowerCase();
    if (!key) return;
    const bal = byUserId.get(userId) ?? 0;
    map.set(key, Math.max(map.get(key) ?? 0, bal));
    const token = normalizeCoinLookupToken(key);
    if (token) map.set(token, Math.max(map.get(token) ?? 0, bal));
  };

  for (const profile of profiles) {
    const userId = String(profile.user_id || '').trim();
    if (!userId) continue;
    attach(String(profile.full_name || ''), userId);
    attach((profile.email || '').split('@')[0] || '', userId);
  }
  return map;
}

type RecruiterDirectory = Map<string, { fullName: string | null; email: string | null }>;

function buildRecruiterDirectory(profiles: UserProfile[]): RecruiterDirectory {
  const map: RecruiterDirectory = new Map();
  for (const profile of profiles) {
    const userId = String(profile.user_id || '').trim();
    if (!userId) continue;
    map.set(userId, {
      fullName: profile.full_name ?? null,
      email: profile.email ?? null,
    });
  }
  return map;
}

/** Same WebinarGeek row → recruiter mapping as the leadership leaderboard. */
async function buildTeamCoinEstimatesFromWebinarCache(
  profiles: UserProfile[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const { data } = await loadWebinarGeekDashboardCache();
  const rows = data?.subscriptions || [];
  if (!rows.length) return map;

  const seeds = seedsFromProfiles(profiles);
  const directory = buildRecruiterDirectory(profiles);
  const window = coinEarnWindow();

  for (const row of rows) {
    if (!webinarShowedFromRow(row)) continue;
    if (!ymdInCoinEarnWindow(coinShowDateYmdForWebinarRow(row), window)) continue;
    const userId = resolveWebinarRowRecruiterUserId(row, seeds, directory);
    if (!userId) continue;
    mergeCoinBalance(map, userId, (map.get(userId) ?? 0) + COINS_PER_SHOW);
  }

  return map;
}

async function enrichBalancesFromWebinarEstimates(
  profiles: UserProfile[],
  byUserId: Map<string, number>,
): Promise<void> {
  const { data } = await loadWebinarGeekDashboardCache();
  const allRows = data?.subscriptions || [];
  if (!allRows.length) return;

  const window = coinEarnWindow();
  for (const profile of profiles) {
    const userId = String(profile.user_id || '').trim();
    if (!userId) continue;
    if ((byUserId.get(userId) ?? 0) > 0) continue;

    const scoped = filterRowsForRecruiterOwnership(allRows, profile.email ?? null, profile.full_name ?? null);
    let shows = 0;
    for (const row of scoped) {
      if (!webinarShowedFromRow(row)) continue;
      if (!ymdInCoinEarnWindow(coinShowDateYmdForWebinarRow(row), window)) continue;
      shows += 1;
    }
    if (shows > 0) {
      mergeCoinBalance(map, userId, shows * COINS_PER_SHOW);
    }
  }
}

export type LeaderboardCoinLookup = {
  byUserId: Map<string, number>;
  displayNameToUserId: Map<string, string>;
  byDisplayLabel: Map<string, number>;
};

export async function loadLeaderboardCoinLookup(profiles: UserProfile[]): Promise<LeaderboardCoinLookup> {
  const byUserId = await loadRecruiterCoinBalanceMap();
  const teamEstimates = await buildTeamCoinEstimatesFromWebinarCache(profiles);
  for (const [userId, estimate] of teamEstimates) {
    mergeCoinBalance(byUserId, userId, estimate);
  }
  await enrichBalancesFromWebinarEstimates(profiles, byUserId);
  const displayNameToUserId = buildDisplayNameToUserId(profiles);
  const byDisplayLabel = buildBalanceByDisplayLabel(profiles, byUserId);

  for (const profile of profiles) {
    const userId = String(profile.user_id || '').trim();
    if (!userId) continue;
    const bal = byUserId.get(userId) ?? 0;
    const local = (profile.email || '').split('@')[0].toLowerCase();
    if (local) byDisplayLabel.set(local, Math.max(byDisplayLabel.get(local) ?? 0, bal));
    const name = String(profile.full_name || '').trim().toLowerCase();
    if (name) byDisplayLabel.set(name, Math.max(byDisplayLabel.get(name) ?? 0, bal));
  }

  return {
    byUserId,
    displayNameToUserId,
    byDisplayLabel,
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

  if (row.recruiterKey.startsWith('name:')) {
    const nameKey = row.recruiterKey.slice(5).trim();
    if (nameKey && displayNameToUserId.has(nameKey)) {
      return displayNameToUserId.get(nameKey)!;
    }
  }

  const rawLabel = row.displayName.trim().toLowerCase();
  if (rawLabel && displayNameToUserId.has(rawLabel)) {
    return displayNameToUserId.get(rawLabel)!;
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
  const directUid = String(row.recruiterUserId || '').trim();
  if (directUid && byUserId.has(directUid)) {
    return byUserId.get(directUid)!;
  }

  if (!(lookup instanceof Map)) {
    const label = row.displayName.trim().toLowerCase();
    if (label && lookup.byDisplayLabel.has(label)) {
      return lookup.byDisplayLabel.get(label)!;
    }
    const token = normalizeCoinLookupToken(label);
    if (token && lookup.byDisplayLabel.has(token)) {
      return lookup.byDisplayLabel.get(token)!;
    }
    if (row.recruiterKey.startsWith('uid:')) {
      const fromKey = row.recruiterKey.slice(4).trim();
      if (fromKey && byUserId.has(fromKey)) return byUserId.get(fromKey)!;
    }
  }
  const nameMap =
    lookup instanceof Map ? displayNameToUserId ?? new Map<string, string>() : lookup.displayNameToUserId;

  const userId = resolveLeaderboardRowUserId(row, nameMap);
  if (userId) return byUserId.get(userId) ?? 0;

  const label = row.displayName.trim().toLowerCase();
  if (!(lookup instanceof Map) && label && lookup.byDisplayLabel.has(label)) {
    return lookup.byDisplayLabel.get(label)!;
  }

  return 0;
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
