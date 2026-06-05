import { supabase } from './supabaseClient';
import type { RecruiterLeaderboardRow } from './pipelineLeaderboard';
import {
  fetchDashboardTeamMetricsViaFunction,
  isSupabaseNetworkError,
} from './dashboardTeamMetricsService';

const TABLE = 'pipeline_leaderboard_snapshots';
const LOCAL_CACHE_PREFIX = 'pohiring_leaderboard_snapshot_v1:';

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

function readLocalSnapshot(periodKey: string): LeaderboardSnapshotRecord | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`${LOCAL_CACHE_PREFIX}${periodKey}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LeaderboardSnapshotRecord;
    if (!parsed || !Array.isArray(parsed.rows)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeLocalSnapshot(record: LeaderboardSnapshotRecord): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`${LOCAL_CACHE_PREFIX}${record.period}`, JSON.stringify(record));
  } catch {
    // ignore quota errors
  }
}

function recordFromPayload(
  periodKey: string,
  payload: LeaderboardSnapshotPayload,
  fetchedAt: string | null,
): LeaderboardSnapshotRecord {
  return {
    period: periodKey,
    rows: Array.isArray(payload.rows) ? payload.rows : [],
    previousRows: Array.isArray(payload.previousRows) ? payload.previousRows : [],
    windowLabel: String(payload.windowLabel || ''),
    fetchedAt: fetchedAt || new Date().toISOString(),
  };
}

export async function loadLeaderboardSnapshot(periodKey: string): Promise<{
  data: LeaderboardSnapshotRecord | null;
  error: string | null;
  tableMissing: boolean;
  source?: 'rest' | 'edge' | 'local';
}> {
  let restError: string | null = null;

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select('period, payload, fetched_at')
      .eq('period', periodKey)
      .maybeSingle();

    if (error) {
      if (isMissingTableError(error)) {
        return { data: null, error: null, tableMissing: true };
      }
      restError = error.message;
      if (!isSupabaseNetworkError(restError)) {
        return { data: null, error: restError, tableMissing: false };
      }
    } else if (data) {
      const payload = (data.payload || {}) as LeaderboardSnapshotPayload;
      const record = recordFromPayload(periodKey, payload, data.fetched_at ?? null);
      writeLocalSnapshot(record);
      return { data: record, error: null, tableMissing: false, source: 'rest' };
    }
  } catch (e) {
    restError = e instanceof Error ? e.message : String(e);
    if (!isSupabaseNetworkError(restError)) {
      return { data: null, error: restError, tableMissing: false };
    }
  }

  const viaFn = await fetchDashboardTeamMetricsViaFunction(periodKey);
  if (viaFn.ok && viaFn.snapshot) {
    const record = recordFromPayload(
      periodKey,
      {
        rows: viaFn.snapshot.rows as RecruiterLeaderboardRow[],
        previousRows: viaFn.snapshot.previousRows as RecruiterLeaderboardRow[],
        windowLabel: viaFn.snapshot.windowLabel,
      },
      viaFn.snapshot.fetchedAt,
    );
    writeLocalSnapshot(record);
    return { data: record, error: null, tableMissing: false, source: 'edge' };
  }

  const local = readLocalSnapshot(periodKey);
  if (local) {
    return { data: local, error: restError || viaFn.ok ? null : viaFn.error, tableMissing: false, source: 'local' };
  }

  return {
    data: null,
    error: restError || (viaFn.ok ? null : viaFn.error),
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

  writeLocalSnapshot(recordFromPayload(input.periodKey, input.payload, now));

  const { error } = await supabase.from(TABLE).upsert(row, { onConflict: 'period' });

  if (error) {
    if (isMissingTableError(error)) {
      return { ok: false, error: null, tableMissing: true };
    }
    if (isSupabaseNetworkError(error.message)) {
      return { ok: true, error: null, tableMissing: false };
    }
    return { ok: false, error: error.message, tableMissing: false };
  }
  return { ok: true, error: null, tableMissing: false };
}
