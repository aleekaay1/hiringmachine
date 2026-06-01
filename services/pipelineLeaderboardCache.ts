import { supabase } from './supabaseClient';
import type { RecruiterLeaderboardRow } from './pipelineLeaderboard';

const TABLE = 'pipeline_leaderboard_snapshots';

export type LeaderboardSnapshotPayload = {
  rows: RecruiterLeaderboardRow[];
  previousRows: RecruiterLeaderboardRow[];
  windowLabel: string;
};

export type LeaderboardSnapshotRecord = LeaderboardSnapshotPayload & {
  period: string;
  fetchedAt: string;
};

function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === 'PGRST205') return true;
  const m = error.message || '';
  return /pipeline_leaderboard_snapshots/i.test(m) && /schema cache|does not exist/i.test(m);
}

export async function loadLeaderboardSnapshot(periodKey: string): Promise<{
  data: LeaderboardSnapshotRecord | null;
  error: string | null;
  tableMissing: boolean;
}> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('period, payload, fetched_at')
    .eq('period', periodKey)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) {
      return { data: null, error: null, tableMissing: true };
    }
    return { data: null, error: error.message, tableMissing: false };
  }
  if (!data) return { data: null, error: null, tableMissing: false };

  const payload = (data.payload || {}) as LeaderboardSnapshotPayload;
  return {
    data: {
      period: String(data.period || periodKey),
      rows: Array.isArray(payload.rows) ? payload.rows : [],
      previousRows: Array.isArray(payload.previousRows) ? payload.previousRows : [],
      windowLabel: String(payload.windowLabel || ''),
      fetchedAt: data.fetched_at ?? new Date().toISOString(),
    },
    error: null,
    tableMissing: false,
  };
}

export async function saveLeaderboardSnapshot(input: {
  periodKey: string;
  payload: LeaderboardSnapshotPayload;
}): Promise<{ ok: boolean; error: string | null; tableMissing: boolean }> {
  const now = new Date().toISOString();
  const row = {
    period: input.periodKey,
    payload: input.payload,
    fetched_at: now,
    updated_at: now,
  };

  const { error } = await supabase.from(TABLE).upsert(row, { onConflict: 'period' });

  if (error) {
    if (isMissingTableError(error)) {
      return { ok: false, error: null, tableMissing: true };
    }
    return { ok: false, error: error.message, tableMissing: false };
  }
  return { ok: true, error: null, tableMissing: false };
}
