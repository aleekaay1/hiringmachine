import { supabase } from './supabaseClient';

const TABLE = 'webinar_geek_dashboard_snapshots';
const CACHE_ID = 'latest';

type AnyRow = Record<string, unknown>;

export type WebinarGeekDashboardCachePayload = {
  subscriptions: AnyRow[];
  broadcasts: AnyRow[];
  fetchSince: string | null;
  fetchUntil: string | null;
  fetchLabel: string | null;
  subscriptionCount: number;
  fetchedAt: string;
};

function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === 'PGRST205') return true;
  const m = error.message || '';
  return /webinar_geek_dashboard_snapshots/i.test(m) && /schema cache|does not exist/i.test(m);
}

export function subscriptionsFromDashboardData(data: Record<string, unknown> | null): AnyRow[] {
  const payload = data?.subscriptions as Record<string, unknown> | undefined;
  const rows = payload?.subscriptions;
  return Array.isArray(rows) ? (rows as AnyRow[]) : [];
}

export function broadcastsFromDashboardData(data: Record<string, unknown> | null): AnyRow[] {
  const payload = data?.broadcasts as Record<string, unknown> | undefined;
  const rows = payload?.broadcasts;
  return Array.isArray(rows) ? (rows as AnyRow[]) : [];
}

export async function loadWebinarGeekDashboardCache(): Promise<{
  data: WebinarGeekDashboardCachePayload | null;
  error: string | null;
  tableMissing: boolean;
}> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('subscriptions, broadcasts, fetch_since, fetch_until, fetch_label, subscription_count, fetched_at')
    .eq('id', CACHE_ID)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) {
      return { data: null, error: null, tableMissing: true };
    }
    return { data: null, error: error.message, tableMissing: false };
  }
  if (!data) return { data: null, error: null, tableMissing: false };

  const subs = Array.isArray(data.subscriptions) ? (data.subscriptions as AnyRow[]) : [];
  const bcasts = Array.isArray(data.broadcasts) ? (data.broadcasts as AnyRow[]) : [];

  return {
    data: {
      subscriptions: subs,
      broadcasts: bcasts,
      fetchSince: data.fetch_since ?? null,
      fetchUntil: data.fetch_until ?? null,
      fetchLabel: data.fetch_label ?? null,
      subscriptionCount: Number(data.subscription_count) || subs.length,
      fetchedAt: data.fetched_at ?? new Date().toISOString(),
    },
    error: null,
    tableMissing: false,
  };
}

export async function saveWebinarGeekDashboardCache(input: {
  subscriptions: AnyRow[];
  broadcasts?: AnyRow[];
  fetchSince?: string;
  fetchUntil?: string;
  fetchLabel?: string;
}): Promise<{ ok: boolean; error: string | null; tableMissing: boolean }> {
  const now = new Date().toISOString();
  const row = {
    id: CACHE_ID,
    subscriptions: input.subscriptions,
    broadcasts: input.broadcasts ?? [],
    fetch_since: input.fetchSince ?? null,
    fetch_until: input.fetchUntil ?? null,
    fetch_label: input.fetchLabel ?? null,
    subscription_count: input.subscriptions.length,
    fetched_at: now,
    updated_at: now,
  };

  const { error } = await supabase.from(TABLE).upsert(row, { onConflict: 'id' });

  if (error) {
    if (isMissingTableError(error)) {
      return { ok: false, error: null, tableMissing: true };
    }
    return { ok: false, error: error.message, tableMissing: false };
  }
  return { ok: true, error: null, tableMissing: false };
}
