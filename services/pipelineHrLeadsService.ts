import { supabase } from './supabaseClient';
import type { ParsedHrLeadRow } from './pipelineCsvParse';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export type PipelineLeadBatch = {
  id: string;
  created_at: string;
  created_by_user_id: string | null;
  created_by_label: string | null;
  label: string;
  source_filename: string | null;
  lead_team: string | null;
  total_rows: number;
  imported_count: number;
  skipped_duplicate_count: number;
  failed_count: number;
  assigned_count: number;
  pool_count?: number;
};

export type HrPoolLead = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  lead_batch_id: string | null;
  created_at: string;
  status: string;
  journey_stage: string;
  metadata: Record<string, unknown> | null;
};

export type HrAssignmentLead = HrPoolLead & {
  assigned_to_user_id: string | null;
  assigned_to_label: string | null;
  assigned_at: string | null;
  uploader_user_id: string | null;
};

export type HrDispositionCounts = {
  booked: number;
  no_answer: number;
  voicemail_left: number;
  callback_requested: number;
  not_interested: number;
  busy: number;
  wrong_number: number;
  connected: number;
  other: number;
};

export type HrRecruiterOverview = {
  user_id: string;
  label: string;
  assigned_count: number;
  not_contacted_count: number;
  worked_count: number;
  disposition_counts: HrDispositionCounts;
};

export type HrRecruiterLeadRow = HrAssignmentLead & {
  latest_disposition: string | null;
  latest_disposed_at: string | null;
  call_count: number;
};

export type HrAllLeadRow = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  lead_batch_id: string | null;
  assigned_to_user_id: string | null;
  assigned_to_label: string | null;
  assigned_at: string | null;
  status: string;
  journey_stage: string;
  created_at: string;
  batch_label: string;
  source_filename: string;
  batch_created_at: string;
  lead_team: string;
  latest_disposition: string | null;
  latest_disposed_at: string | null;
  metadata: Record<string, unknown> | null;
};

async function getToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sign in required.');
  return token;
}

async function callHrLeads<T extends Record<string, unknown>>(
  mode: string,
  init: RequestInit = {},
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { ok: false, error: 'Missing Supabase configuration.' };
  }
  const token = await getToken();
  const url = `${SUPABASE_URL}/functions/v1/pipeline-hr-leads?mode=${encodeURIComponent(mode)}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    return { ok: false, error: String(json.error || res.statusText || 'Request failed') };
  }
  return { ok: true, data: json as T };
}

export async function fetchHrLeadSummary() {
  return callHrLeads<{
    pool_count: number;
    assigned_count: number;
    recent_batches: PipelineLeadBatch[];
  }>('summary');
}

export async function fetchHrLeadBatches(limit = 30) {
  const params = new URLSearchParams({ mode: 'batches', limit: String(limit) });
  const token = await getToken();
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { ok: false as const, error: 'Missing Supabase configuration.' };
  }
  const res = await fetch(`${SUPABASE_URL}/functions/v1/pipeline-hr-leads?${params}`, {
    headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) return { ok: false as const, error: String(json.error || 'Failed to load upload history') };
  return { ok: true as const, batches: (json.batches || []) as PipelineLeadBatch[] };
}

export async function fetchHrAllLeads(filters: {
  batchId?: string;
  team?: string;
  status?: 'all' | 'pool' | 'assigned';
  assigneeId?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}) {
  const params = new URLSearchParams({ mode: 'all-leads', limit: '3000' });
  if (filters.batchId) params.set('batch_id', filters.batchId);
  if (filters.team) params.set('team', filters.team);
  if (filters.status && filters.status !== 'all') params.set('status', filters.status);
  if (filters.assigneeId) params.set('assignee_id', filters.assigneeId);
  if (filters.dateFrom) params.set('date_from', filters.dateFrom);
  if (filters.dateTo) params.set('date_to', filters.dateTo);
  if (filters.search) params.set('search', filters.search);
  const token = await getToken();
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { ok: false as const, error: 'Missing Supabase configuration.' };
  }
  const res = await fetch(`${SUPABASE_URL}/functions/v1/pipeline-hr-leads?${params}`, {
    headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) return { ok: false as const, error: String(json.error || 'Failed to load leads') };
  return {
    ok: true as const,
    leads: (json.leads || []) as HrAllLeadRow[],
    teams: (json.teams || []) as string[],
    total: Number(json.total || 0),
  };
}

export async function deleteHrPoolLeads(candidateIds: string[]) {
  return callHrLeads<{
    deleted_count: number;
    deleted_ids: string[];
    removed_batch_ids: string[];
    errors: Array<{ id: string; error: string }>;
  }>('delete-leads', {
    method: 'POST',
    body: JSON.stringify({ candidate_ids: candidateIds }),
  });
}

export async function deleteHrBatchPool(batchId: string) {
  return callHrLeads<{
    deleted_count: number;
    deleted_ids: string[];
    batch_removed: boolean;
    errors: Array<{ id: string; error: string }>;
  }>('delete-batch-pool', {
    method: 'POST',
    body: JSON.stringify({ batch_id: batchId }),
  });
}

export async function fetchHrLeadPool(batchId?: string) {
  const params = new URLSearchParams({ mode: 'pool', limit: '500' });
  if (batchId) params.set('batch_id', batchId);
  const token = await getToken();
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { ok: false as const, error: 'Missing Supabase configuration.' };
  }
  const res = await fetch(`${SUPABASE_URL}/functions/v1/pipeline-hr-leads?${params}`, {
    headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) return { ok: false as const, error: String(json.error || 'Failed to load pool') };
  return { ok: true as const, pool: (json.pool || []) as HrPoolLead[] };
}

export async function fetchHrRecruiterOverview(batchId?: string) {
  const params = new URLSearchParams({ mode: 'recruiter-overview' });
  if (batchId) params.set('batch_id', batchId);
  const token = await getToken();
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { ok: false as const, error: 'Missing Supabase configuration.' };
  }
  const res = await fetch(`${SUPABASE_URL}/functions/v1/pipeline-hr-leads?${params}`, {
    headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) return { ok: false as const, error: String(json.error || 'Failed to load recruiter overview') };
  return { ok: true as const, recruiters: (json.recruiters || []) as HrRecruiterOverview[] };
}

export async function fetchHrRecruiterLeads(userId: string, batchId?: string) {
  const params = new URLSearchParams({ mode: 'recruiter-leads', user_id: userId });
  if (batchId) params.set('batch_id', batchId);
  const token = await getToken();
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { ok: false as const, error: 'Missing Supabase configuration.' };
  }
  const res = await fetch(`${SUPABASE_URL}/functions/v1/pipeline-hr-leads?${params}`, {
    headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) return { ok: false as const, error: String(json.error || 'Failed to load recruiter leads') };
  return { ok: true as const, leads: (json.leads || []) as HrRecruiterLeadRow[] };
}

export async function fetchHrLeadAssignments(batchId?: string) {
  const params = new URLSearchParams({ mode: 'assignments', limit: '500' });
  if (batchId) params.set('batch_id', batchId);
  const token = await getToken();
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { ok: false as const, error: 'Missing Supabase configuration.' };
  }
  const res = await fetch(`${SUPABASE_URL}/functions/v1/pipeline-hr-leads?${params}`, {
    headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) return { ok: false as const, error: String(json.error || 'Failed to load assignments') };
  return { ok: true as const, assignments: (json.assignments || []) as HrAssignmentLead[] };
}

export type HrLeadDuplicateCheckRow = {
  row_number: number;
  full_name: string;
  email: string | null;
  phone: string | null;
  kind: string;
  match_row_number?: number;
  existing_candidate_id?: string;
  existing_assigned_to?: string | null;
  message: string;
};

export async function checkHrLeadDuplicates(rows: ParsedHrLeadRow[]) {
  return callHrLeads<{
    duplicate_count: number;
    clean_count: number;
    duplicates: HrLeadDuplicateCheckRow[];
  }>('check-duplicates', {
    method: 'POST',
    body: JSON.stringify({
      rows: rows.map((row) => ({
        row_number: row.rowNumber,
        full_name: row.fullName,
        email: row.email,
        phone: row.phone,
      })),
    }),
  });
}

export async function importHrLeadRowsChunk(input: {
  batchId?: string;
  label: string;
  sourceFilename?: string;
  leadTeam?: string | null;
  rows: ParsedHrLeadRow[];
}) {
  return callHrLeads<{
    batch_id: string;
    imported_count: number;
    skipped: Array<{ row_number: number; reason: string }>;
    failed: Array<{ row_number: number; error: string }>;
  }>('import-rows', {
    method: 'POST',
    body: JSON.stringify({
      batch_id: input.batchId,
      label: input.label,
      source_filename: input.sourceFilename,
      lead_team: input.leadTeam,
      rows: input.rows.map((row) => ({
        row_number: row.rowNumber,
        lead_age: row.leadAge,
        full_name: row.fullName,
        email: row.email,
        phone: row.phone,
      })),
    }),
  });
}

export async function retractHrAssignments(candidateIds: string[]) {
  return callHrLeads<{
    retracted_count: number;
    retracted_ids: string[];
    errors: Array<{ id: string; error: string }>;
  }>('retract-assignment', {
    method: 'POST',
    body: JSON.stringify({ candidate_ids: candidateIds }),
  });
}

export async function retractHrBatchAssignments(batchId: string, assigneeUserId?: string) {
  return callHrLeads<{
    retracted_count: number;
    retracted_ids: string[];
    errors: Array<{ id: string; error: string }>;
  }>('retract-batch', {
    method: 'POST',
    body: JSON.stringify({
      batch_id: batchId,
      assignee_user_id: assigneeUserId || undefined,
    }),
  });
}

export async function assignHrLeads(input: {
  assignToUserId: string;
  assignToLabel: string;
  candidateIds?: string[];
  count?: number;
  batchId?: string;
}) {
  return callHrLeads<{
    assigned_count: number;
    assigned_ids: string[];
    errors: Array<{ id: string; error: string }>;
  }>('assign', {
    method: 'POST',
    body: JSON.stringify({
      assign_to_user_id: input.assignToUserId,
      assign_to_label: input.assignToLabel,
      candidate_ids: input.candidateIds,
      count: input.count,
      batch_id: input.batchId,
    }),
  });
}

export async function importHrLeadCsvWithProgress(input: {
  label: string;
  sourceFilename: string;
  leadTeam?: string | null;
  rows: ParsedHrLeadRow[];
  chunkSize?: number;
  onProgress?: (progress: {
    pct: number;
    label: string;
    imported: number;
    skipped: number;
    failed: number;
    batchId?: string;
  }) => void;
}): Promise<{
  batchId: string;
  imported: number;
  skipped: number;
  failed: number;
  errors: string[];
}> {
  const chunkSize = input.chunkSize ?? 40;
  const leadTeam = input.leadTeam ?? null;
  let batchId = '';
  let imported = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];
  const totalChunks = Math.max(1, Math.ceil(input.rows.length / chunkSize));

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
    const slice = input.rows.slice(chunkIndex * chunkSize, (chunkIndex + 1) * chunkSize);
    input.onProgress?.({
      pct: Math.round(((chunkIndex) / totalChunks) * 100),
      label: `Importing rows ${chunkIndex * chunkSize + 1}–${chunkIndex * chunkSize + slice.length}…`,
      imported,
      skipped,
      failed,
      batchId: batchId || undefined,
    });

    const result = await importHrLeadRowsChunk({
      batchId: batchId || undefined,
      label: input.label,
      sourceFilename: input.sourceFilename,
      leadTeam,
      rows: slice,
    });
    if (!result.ok) throw new Error(result.error);

    batchId = String(result.data.batch_id);
    imported += Number(result.data.imported_count || 0);
    skipped += (result.data.skipped || []).length;
    failed += (result.data.failed || []).length;
    for (const row of result.data.failed || []) {
      errors.push(`Row ${row.row_number}: ${row.error}`);
    }
  }

  input.onProgress?.({
    pct: 100,
    label: 'Import complete.',
    imported,
    skipped,
    failed,
    batchId,
  });

  return { batchId, imported, skipped, failed, errors };
}
