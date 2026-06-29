import { supabase } from './supabaseClient';
import type { PipelineCallRecord } from './pipelineService';

export const CALL_LOG_PAGE_SIZE = 50;

const SEARCH_CANDIDATE_LIMIT = 80;
const SEARCH_MIN_CHARS = 2;

export type CallLogPageQuery = {
  fromYmd: string;
  toYmd: string;
  recruiterUserId?: string | null;
  disposition?: string | null;
  search?: string | null;
  offset?: number;
  limit?: number;
};

export type CallLogPageResult = {
  rows: PipelineCallRecord[];
  hasMore: boolean;
  nextOffset: number;
};

function escapeIlikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function ymdStartIso(ymd: string): string {
  return new Date(`${ymd}T00:00:00`).toISOString();
}

function ymdEndIso(ymd: string): string {
  return new Date(`${ymd}T23:59:59.999`).toISOString();
}

async function findCandidateIdsForCallLogSearch(query: string): Promise<string[]> {
  const term = query.trim();
  if (term.length < SEARCH_MIN_CHARS) return [];
  const pattern = `%${escapeIlikePattern(term)}%`;
  const { data, error } = await supabase
    .from('pipeline_candidates')
    .select('id')
    .or(`full_name.ilike.${pattern},email.ilike.${pattern},phone.ilike.${pattern}`)
    .limit(SEARCH_CANDIDATE_LIMIT);
  if (error) {
    console.warn('call log candidate search failed', error.message);
    return [];
  }
  return (data || []).map((row) => String(row.id));
}

export async function fetchCallLogPage(input: CallLogPageQuery): Promise<CallLogPageResult> {
  const limit = Math.min(Math.max(input.limit ?? CALL_LOG_PAGE_SIZE, 1), 100);
  const offset = Math.max(input.offset ?? 0, 0);
  const fetchLimit = limit + 1;

  const fromIso = ymdStartIso(input.fromYmd);
  const toIso = ymdEndIso(input.toYmd);

  let query = supabase
    .from('pipeline_call_records')
    .select('*')
    .order('disposed_at', { ascending: false });

  const search = input.search?.trim() || '';
  const searchActive = search.length >= SEARCH_MIN_CHARS;
  if (!searchActive) {
    query = query.gte('disposed_at', fromIso).lte('disposed_at', toIso);
  }

  if (input.recruiterUserId && input.recruiterUserId !== 'all') {
    query = query.eq('recruiter_user_id', input.recruiterUserId);
  }
  if (input.disposition && input.disposition !== 'all') {
    query = query.eq('disposition', input.disposition);
  }

  if (searchActive) {
    const pattern = `%${escapeIlikePattern(search)}%`;
    const candidateIds = await findCandidateIdsForCallLogSearch(search);
    const orParts = [
      `disposition.ilike.${pattern}`,
      `comment.ilike.${pattern}`,
      `dialed_number.ilike.${pattern}`,
      `recruiter_label.ilike.${pattern}`,
    ];
    if (candidateIds.length) {
      orParts.push(`candidate_id.in.(${candidateIds.slice(0, 60).join(',')})`);
    }
    query = query.or(orParts.join(','));
  }

  const { data, error } = await query.range(offset, offset + fetchLimit - 1);
  if (error) throw new Error(error.message);

  const all = (data || []) as PipelineCallRecord[];
  const hasMore = all.length > limit;
  const rows = hasMore ? all.slice(0, limit) : all;

  return {
    rows,
    hasMore,
    nextOffset: offset + rows.length,
  };
}
