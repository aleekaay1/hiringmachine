import { supabase } from './supabaseClient';
import { loadWebinarGeekDashboardCache } from './webinarGeekDashboardCache';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const QUESTIONNAIRE_PAGE_SIZE = 50;

const LIST_SELECT =
  'id, wg_submission_key, subscription_id, webinar_id, broadcast_id, webinar_title, broadcast_title, email, first_name, last_name, phone, submitted_at, pipeline_candidate_id, journey_candidate_id, booked_by_user_id, booked_by_label, recruiter_custom_field, match_method, hiring_stage, source_type, watched, watch_duration_seconds, synced_at, created_at, updated_at';

export type WebinarQuestionnaireAnswer = {
  question: string;
  answer: string;
  field_key?: string | null;
};

export type WebinarQuestionnaireSubmission = {
  id: string;
  wg_submission_key: string;
  subscription_id: string | null;
  webinar_id: string | null;
  broadcast_id: string | null;
  webinar_title: string | null;
  broadcast_title: string | null;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  submitted_at: string | null;
  answers?: WebinarQuestionnaireAnswer[];
  pipeline_candidate_id: string | null;
  journey_candidate_id: string | null;
  booked_by_user_id: string | null;
  booked_by_label: string | null;
  recruiter_custom_field: string | null;
  match_method: string | null;
  hiring_stage: string;
  source_type?: string | null;
  watched?: boolean | null;
  watch_duration_seconds?: number | null;
  synced_at: string;
  created_at: string;
  updated_at: string;
};

export type QuestionnaireViewFilter = 'all' | 'with_answers' | 'attended_only' | 'matched_pipeline';

export type WebinarQuestionnairePageQuery = {
  search?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  webinarTitle?: string | null;
  sourceType?: string | null;
  viewFilter?: QuestionnaireViewFilter;
  offset?: number;
  limit?: number;
};

export type WebinarQuestionnairePageResult = {
  rows: WebinarQuestionnaireSubmission[];
  hasMore: boolean;
  nextOffset: number;
};

export type WebinarQuestionnaireSyncResult = {
  synced_at: string;
  fetched_count: number;
  upserted_count: number;
  matched_pipeline_count: number;
  api_sources: string[];
  with_questionnaire_count?: number;
  cache_fetched_at?: string | null;
  cache_label?: string | null;
  subscription_count?: number;
  subscriptions_scanned?: number;
  subscriptions_loaded?: number;
  subscriptions_with_evaluation_form_answers?: number;
  rematched_count?: number;
  days_back?: number;
  message?: string;
};

export type WebinarHiringStage =
  | 'not_booked'
  | 'booked'
  | 'showed'
  | 'questionnaire_submitted'
  | 'ready_for_followup'
  | 'attended_only';

function escapeIlikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function ymdStartIso(ymd: string): string {
  return new Date(`${ymd}T00:00:00`).toISOString();
}

function ymdEndIso(ymd: string): string {
  return new Date(`${ymd}T23:59:59.999`).toISOString();
}

export function displayNameFromSubmission(row: WebinarQuestionnaireSubmission): string {
  const parts = [row.first_name, row.last_name].map((v) => String(v || '').trim()).filter(Boolean);
  if (parts.length) return parts.join(' ');
  return row.email || 'Unknown';
}

export function watchMinutesFromSubmission(row: WebinarQuestionnaireSubmission): number | null {
  const sec = Number(row.watch_duration_seconds || 0);
  if (!Number.isFinite(sec) || sec <= 0) return null;
  return Math.round(sec / 60);
}

export function sourceTypeLabel(sourceType: string | null | undefined): string {
  if (sourceType === 'dashboard_cache') return 'Attendance cache';
  if (sourceType === 'wg_sync') return 'WebinarGeek API';
  if (sourceType === 'wg_webhook') return 'Live webhook';
  return sourceType || 'Unknown';
}

export function webinarQuestionnaireWebhookUrl(): string {
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || '';
  if (!base) return '';
  return `${base.replace(/\/$/, '')}/functions/v1/webinar-geek-questionnaire-webhook`;
}

async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function postQuestionnaireMode(
  mode: 'questionnaire-sync' | 'questionnaire-backfill' | 'questionnaire-recent-import' | 'questionnaire-rematch',
  body?: Record<string, unknown>,
): Promise<{ ok: true; data: WebinarQuestionnaireSyncResult } | { ok: false; error: string }> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { ok: false, error: 'Missing Supabase configuration.' };
  }
  const token = await getAccessToken();
  if (!token) return { ok: false, error: 'Not signed in.' };

  const res = await fetch(`${SUPABASE_URL}/functions/v1/integrations-webinar-geek?mode=${mode}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body || {}),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    return { ok: false, error: String(json.error || res.statusText || 'Request failed') };
  }
  return {
    ok: true,
    data: {
      synced_at: String(json.synced_at || new Date().toISOString()),
      fetched_count: Number(json.fetched_count || 0),
      upserted_count: Number(json.upserted_count || 0),
      matched_pipeline_count: Number(json.matched_pipeline_count || 0),
      api_sources: Array.isArray(json.api_sources) ? json.api_sources.map(String) : [],
      with_questionnaire_count: Number(json.with_questionnaire_count || 0) || undefined,
      cache_fetched_at: json.cache_fetched_at ? String(json.cache_fetched_at) : null,
      cache_label: json.cache_label ? String(json.cache_label) : null,
      subscription_count: Number(json.subscription_count || 0) || undefined,
      subscriptions_scanned: Number(json.subscriptions_scanned || 0) || undefined,
      subscriptions_loaded: Number(json.subscriptions_loaded || 0) || undefined,
      subscriptions_with_evaluation_form_answers: Number(json.subscriptions_with_evaluation_form_answers || 0) || undefined,
      rematched_count: Number(json.rematched_count || 0) || undefined,
      days_back: Number(json.days_back || 0) || undefined,
      message: json.message ? String(json.message) : undefined,
    },
  };
}

export async function syncWebinarGeekQuestionnaires(input?: {
  webinarId?: string;
  broadcastId?: string;
}): Promise<{ ok: true; data: WebinarQuestionnaireSyncResult } | { ok: false; error: string }> {
  return postQuestionnaireMode('questionnaire-sync', {
    webinar_id: input?.webinarId || undefined,
    broadcast_id: input?.broadcastId || undefined,
  });
}

/** Scan recent WebinarGeek subscriptions (default 15 days) and import evaluation forms. */
export async function importRecentWebinarQuestionnaires(daysBack = 15): Promise<
  { ok: true; data: WebinarQuestionnaireSyncResult } | { ok: false; error: string }
> {
  return postQuestionnaireMode('questionnaire-recent-import', { days_back: daysBack });
}

export async function rematchWebinarQuestionnaires(daysBack = 15): Promise<
  { ok: true; data: WebinarQuestionnaireSyncResult } | { ok: false; error: string }
> {
  return postQuestionnaireMode('questionnaire-rematch', { days_back: daysBack });
}

/** Import from webinar_geek_dashboard_snapshots — no WebinarGeek API calls. */
export async function backfillWebinarQuestionnairesFromCache(): Promise<
  { ok: true; data: WebinarQuestionnaireSyncResult } | { ok: false; error: string }
> {
  return postQuestionnaireMode('questionnaire-backfill');
}

export async function fetchWebinarQuestionnairePage(
  input: WebinarQuestionnairePageQuery,
): Promise<WebinarQuestionnairePageResult> {
  const limit = Math.min(Math.max(input.limit ?? QUESTIONNAIRE_PAGE_SIZE, 1), 100);
  const offset = Math.max(input.offset ?? 0, 0);
  const fetchLimit = limit + 1;

  let query = supabase
    .from('webinar_geek_questionnaire_submissions')
    .select(LIST_SELECT)
    .order('submitted_at', { ascending: false, nullsFirst: false })
    .order('synced_at', { ascending: false })
    .range(offset, offset + fetchLimit - 1);

  const search = input.search?.trim();
  if (search) {
    const pattern = `%${escapeIlikePattern(search)}%`;
    query = query.or(
      `email.ilike.${pattern},first_name.ilike.${pattern},last_name.ilike.${pattern},phone.ilike.${pattern},booked_by_label.ilike.${pattern},webinar_title.ilike.${pattern}`,
    );
  }

  if (input.dateFrom) {
    query = query.gte('submitted_at', ymdStartIso(input.dateFrom));
  }
  if (input.dateTo) {
    query = query.lte('submitted_at', ymdEndIso(input.dateTo));
  }
  if (input.webinarTitle && input.webinarTitle !== 'all') {
    query = query.eq('webinar_title', input.webinarTitle);
  }
  if (input.sourceType && input.sourceType !== 'all') {
    query = query.eq('source_type', input.sourceType);
  }

  const viewFilter = input.viewFilter || 'all';
  if (viewFilter === 'with_answers') {
    query = query.eq('hiring_stage', 'questionnaire_submitted');
  } else if (viewFilter === 'attended_only') {
    query = query.eq('hiring_stage', 'attended_only');
  } else if (viewFilter === 'matched_pipeline') {
    query = query.not('pipeline_candidate_id', 'is', null);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const allRows = (data || []) as WebinarQuestionnaireSubmission[];
  const hasMore = allRows.length > limit;
  const rows = hasMore ? allRows.slice(0, limit) : allRows;

  return {
    rows,
    hasMore,
    nextOffset: offset + rows.length,
  };
}

export async function fetchWebinarQuestionnaireDetail(
  id: string,
): Promise<WebinarQuestionnaireSubmission | null> {
  const { data, error } = await supabase
    .from('webinar_geek_questionnaire_submissions')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as WebinarQuestionnaireSubmission | null) ?? null;
}

export async function fetchWebinarQuestionnaireWebinarTitles(): Promise<string[]> {
  const { data, error } = await supabase
    .from('webinar_geek_questionnaire_submissions')
    .select('webinar_title')
    .not('webinar_title', 'is', null)
    .order('webinar_title', { ascending: true })
    .limit(500);
  if (error) return [];
  const titles = new Set<string>();
  for (const row of data || []) {
    const title = String((row as { webinar_title?: string }).webinar_title || '').trim();
    if (title) titles.add(title);
  }
  return [...titles].sort((a, b) => a.localeCompare(b));
}

export async function fetchWebinarQuestionnaireSummary(input?: {
  dateFrom?: string | null;
  dateTo?: string | null;
}): Promise<{
  total: number;
  withAnswers: number;
  attendedOnly: number;
  matchedPipeline: number;
}> {
  let query = supabase
    .from('webinar_geek_questionnaire_submissions')
    .select('hiring_stage, pipeline_candidate_id');
  if (input?.dateFrom) query = query.gte('submitted_at', ymdStartIso(input.dateFrom));
  if (input?.dateTo) query = query.lte('submitted_at', ymdEndIso(input.dateTo));

  const { data, error } = await query.limit(5000);
  if (error) {
    return { total: 0, withAnswers: 0, attendedOnly: 0, matchedPipeline: 0 };
  }

  const rows = data || [];
  return {
    total: rows.length,
    withAnswers: rows.filter((row) => row.hiring_stage === 'questionnaire_submitted').length,
    attendedOnly: rows.filter((row) => row.hiring_stage === 'attended_only').length,
    matchedPipeline: rows.filter((row) => row.pipeline_candidate_id).length,
  };
}

export async function fetchDashboardCacheMetaForQuestionnaires(): Promise<{
  fetchedAt: string | null;
  fetchLabel: string | null;
  subscriptionCount: number;
} | null> {
  const { data } = await loadWebinarGeekDashboardCache();
  if (!data) return null;
  return {
    fetchedAt: data.fetchedAt,
    fetchLabel: data.fetchLabel,
    subscriptionCount: data.subscriptionCount,
  };
}

/** @deprecated Use fetchWebinarQuestionnairePage for paginated loads. */
export async function listWebinarQuestionnaireSubmissions(input?: {
  search?: string;
  limit?: number;
}): Promise<WebinarQuestionnaireSubmission[]> {
  const result = await fetchWebinarQuestionnairePage({
    search: input?.search,
    limit: input?.limit ?? 500,
    offset: 0,
  });
  return result.rows;
}

export async function loadQuestionnaireMapForCandidateIds(
  candidateIds: string[],
): Promise<Map<string, WebinarQuestionnaireSubmission>> {
  const ids = [...new Set(candidateIds.map((id) => id.trim()).filter(Boolean))];
  const map = new Map<string, WebinarQuestionnaireSubmission>();
  if (!ids.length) return map;

  const chunkSize = 60;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from('webinar_geek_questionnaire_submissions')
      .select(LIST_SELECT)
      .in('pipeline_candidate_id', chunk)
      .eq('hiring_stage', 'questionnaire_submitted')
      .order('submitted_at', { ascending: false });
    if (error) throw new Error(error.message);
    for (const row of (data || []) as WebinarQuestionnaireSubmission[]) {
      if (!row.pipeline_candidate_id || map.has(row.pipeline_candidate_id)) continue;
      map.set(row.pipeline_candidate_id, row);
    }
  }
  return map;
}

export async function fetchLatestQuestionnaireSyncRun(): Promise<{
  synced_at: string;
  fetched_count: number;
  upserted_count: number;
  error_message: string | null;
  api_sources?: string[] | null;
} | null> {
  const { data, error } = await supabase
    .from('webinar_geek_questionnaire_sync_runs')
    .select('synced_at, fetched_count, upserted_count, error_message, api_sources')
    .order('synced_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  if (!data) return null;
  return data as {
    synced_at: string;
    fetched_count: number;
    upserted_count: number;
    error_message: string | null;
    api_sources?: string[] | null;
  };
}

export function hiringStageLabel(stage: string): string {
  switch (stage) {
    case 'not_booked':
      return 'Not booked';
    case 'booked':
      return 'Booked';
    case 'showed':
      return 'Showed';
    case 'questionnaire_submitted':
      return 'Questionnaire';
    case 'ready_for_followup':
      return 'Ready for follow-up';
    case 'attended_only':
      return 'Attended (no form)';
    default:
      return stage;
  }
}

export function resolveHiringStage(input: {
  booked: boolean;
  showed: boolean;
  questionnaireSubmitted: boolean;
}): WebinarHiringStage {
  if (input.questionnaireSubmitted) return 'questionnaire_submitted';
  if (input.showed) return 'showed';
  if (input.booked) return 'booked';
  return 'not_booked';
}

export function defaultQuestionnaireDateFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 15);
  return d.toISOString().slice(0, 10);
}

export const QUESTIONNAIRE_DEFAULT_DAYS_BACK = 15;

export function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

export type WebinarQuestionnairePageFilters = Pick<
  WebinarQuestionnairePageQuery,
  'search' | 'dateFrom' | 'dateTo' | 'webinarTitle' | 'sourceType' | 'viewFilter'
>;

function submissionMatchesSearch(row: WebinarQuestionnaireSubmission, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    row.email,
    row.first_name,
    row.last_name,
    row.phone,
    row.booked_by_label,
    row.webinar_title,
    row.broadcast_title,
    row.recruiter_custom_field,
  ]
    .map((v) => String(v || '').trim().toLowerCase())
    .filter(Boolean)
    .join(' ');
  return hay.includes(q);
}

export function submissionMatchesPageFilters(
  row: WebinarQuestionnaireSubmission,
  input: WebinarQuestionnairePageFilters,
): boolean {
  const viewFilter = input.viewFilter || 'all';
  if (viewFilter === 'with_answers' && row.hiring_stage !== 'questionnaire_submitted') return false;
  if (viewFilter === 'attended_only' && row.hiring_stage !== 'attended_only') return false;
  if (viewFilter === 'matched_pipeline' && !row.pipeline_candidate_id) return false;

  if (input.sourceType && input.sourceType !== 'all' && row.source_type !== input.sourceType) return false;
  if (input.webinarTitle && input.webinarTitle !== 'all' && row.webinar_title !== input.webinarTitle) return false;

  if (input.dateFrom && row.submitted_at) {
    if (row.submitted_at < ymdStartIso(input.dateFrom)) return false;
  }
  if (input.dateTo && row.submitted_at) {
    if (row.submitted_at > ymdEndIso(input.dateTo)) return false;
  }
  if (input.search && !submissionMatchesSearch(row, input.search)) return false;

  return true;
}

function mapRealtimeSubmissionRow(payload: Record<string, unknown>): WebinarQuestionnaireSubmission | null {
  const id = String(payload.id || '').trim();
  if (!id) return null;
  return payload as unknown as WebinarQuestionnaireSubmission;
}

/** Live INSERT/UPDATE events — new webhook submissions appear without refresh. */
export function subscribeWebinarQuestionnaireSubmissions(
  handlers: {
    onInsert?: (row: WebinarQuestionnaireSubmission) => void;
    onUpdate?: (row: WebinarQuestionnaireSubmission) => void;
  },
): () => void {
  const channel = supabase
    .channel('webinar-questionnaire-live')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'webinar_geek_questionnaire_submissions',
      },
      (payload) => {
        const row = mapRealtimeSubmissionRow((payload.new || {}) as Record<string, unknown>);
        if (row) handlers.onInsert?.(row);
      },
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'webinar_geek_questionnaire_submissions',
      },
      (payload) => {
        const row = mapRealtimeSubmissionRow((payload.new || {}) as Record<string, unknown>);
        if (row) handlers.onUpdate?.(row);
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
