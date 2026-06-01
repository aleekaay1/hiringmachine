import { supabase } from './supabaseClient';
import type { ReportDateRange } from './reportsService';
import type { StaffReportCard } from './reportsService';

const TABLE = 'admin_reports_snapshots';

export type TeamReportSnapshotPayload = {
  cards: StaffReportCard[];
  rangeLabel: string;
  rangePreset: string;
  sinceYmd: string | null;
  untilYmd: string | null;
};

export type ReportsMetaPayload = {
  lastWebinarFetchAt: string | null;
  webinarRowCount: number;
  lastTeamSnapshotAt: string | null;
  lastTeamRangeKey: string | null;
};

function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === 'PGRST205') return true;
  const m = error.message || '';
  return /admin_reports_snapshots/i.test(m) && /schema cache|does not exist/i.test(m);
}

export function teamReportSnapshotKey(range: ReportDateRange): string {
  return `team:${range.preset}:${range.sinceYmd ?? 'all'}:${range.untilYmd ?? 'all'}`;
}

const META_KEY = 'meta:global';

export async function loadTeamReportSnapshot(range: ReportDateRange): Promise<{
  data: { cards: StaffReportCard[]; fetchedAt: string | null } | null;
  tableMissing: boolean;
  error: string | null;
}> {
  const key = teamReportSnapshotKey(range);
  const { data, error } = await supabase
    .from(TABLE)
    .select('payload, fetched_at')
    .eq('id', key)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) return { data: null, tableMissing: true, error: null };
    return { data: null, tableMissing: false, error: error.message };
  }
  if (!data) return { data: null, tableMissing: false, error: null };

  const payload = (data.payload || {}) as TeamReportSnapshotPayload;
  return {
    data: {
      cards: Array.isArray(payload.cards) ? payload.cards : [],
      fetchedAt: data.fetched_at ?? null,
    },
    tableMissing: false,
    error: null,
  };
}

export async function saveTeamReportSnapshot(
  range: ReportDateRange,
  cards: StaffReportCard[],
): Promise<{ ok: boolean; tableMissing: boolean; error: string | null; fetchedAt: string }> {
  const now = new Date().toISOString();
  const key = teamReportSnapshotKey(range);
  const row = {
    id: key,
    payload: {
      cards,
      rangeLabel: range.label,
      rangePreset: range.preset,
      sinceYmd: range.sinceYmd,
      untilYmd: range.untilYmd,
    } satisfies TeamReportSnapshotPayload,
    fetched_at: now,
    updated_at: now,
  };

  const { error } = await supabase.from(TABLE).upsert(row, { onConflict: 'id' });
  if (error) {
    if (isMissingTableError(error)) return { ok: false, tableMissing: true, error: null, fetchedAt: now };
    return { ok: false, tableMissing: false, error: error.message, fetchedAt: now };
  }
  return { ok: true, tableMissing: false, error: null, fetchedAt: now };
}

export async function loadReportsMeta(): Promise<{
  data: ReportsMetaPayload | null;
  tableMissing: boolean;
}> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('payload, fetched_at')
    .eq('id', META_KEY)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) return { data: null, tableMissing: true };
    return { data: null, tableMissing: false };
  }
  if (!data) return { data: null, tableMissing: false };
  return { data: (data.payload || {}) as ReportsMetaPayload, tableMissing: false };
}

export async function saveReportsMeta(patch: Partial<ReportsMetaPayload>): Promise<void> {
  const existing = await loadReportsMeta();
  const payload: ReportsMetaPayload = {
    lastWebinarFetchAt: patch.lastWebinarFetchAt ?? existing.data?.lastWebinarFetchAt ?? null,
    webinarRowCount: patch.webinarRowCount ?? existing.data?.webinarRowCount ?? 0,
    lastTeamSnapshotAt: patch.lastTeamSnapshotAt ?? existing.data?.lastTeamSnapshotAt ?? null,
    lastTeamRangeKey: patch.lastTeamRangeKey ?? existing.data?.lastTeamRangeKey ?? null,
  };
  const now = new Date().toISOString();
  await supabase.from(TABLE).upsert(
    {
      id: META_KEY,
      payload,
      fetched_at: now,
      updated_at: now,
    },
    { onConflict: 'id' },
  );
}

export function userReportSnapshotKey(userId: string, range: ReportDateRange): string {
  return `user:${userId}:${range.preset}:${range.sinceYmd ?? 'all'}:${range.untilYmd ?? 'all'}`;
}

export async function loadUserReportSnapshot(
  userId: string,
  range: ReportDateRange,
): Promise<{ payload: unknown | null; fetchedAt: string | null; tableMissing: boolean }> {
  const key = userReportSnapshotKey(userId, range);
  const { data, error } = await supabase.from(TABLE).select('payload, fetched_at').eq('id', key).maybeSingle();
  if (error) {
    if (isMissingTableError(error)) return { payload: null, fetchedAt: null, tableMissing: true };
    return { payload: null, fetchedAt: null, tableMissing: false };
  }
  return {
    payload: data?.payload ?? null,
    fetchedAt: data?.fetched_at ?? null,
    tableMissing: false,
  };
}

export async function saveUserReportSnapshot(
  userId: string,
  range: ReportDateRange,
  payload: unknown,
): Promise<{ fetchedAt: string }> {
  const now = new Date().toISOString();
  const key = userReportSnapshotKey(userId, range);
  await supabase.from(TABLE).upsert(
    {
      id: key,
      payload,
      fetched_at: now,
      updated_at: now,
    },
    { onConflict: 'id' },
  );
  return { fetchedAt: now };
}
