import { supabase } from './supabaseClient';
import type { AppRole, UserProfile } from './accessControl';
import { buildRecruiterScopeTokens } from './accessControl';
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

export type QuestionnaireViewFilter = 'all' | 'with_answers' | 'attended_only' | 'matched_pipeline' | 'needs_pipeline_match';

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
  newly_matched_count?: number;
  deleted_count?: number;
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
  if (sourceType === 'google_form') return 'Google Form';
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
  mode: 'questionnaire-sync' | 'questionnaire-backfill' | 'questionnaire-recent-import' | 'questionnaire-rematch' | 'questionnaire-rematch-contact' | 'questionnaire-purge-legacy',
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
      newly_matched_count: Number(json.newly_matched_count || 0) || undefined,
      deleted_count: Number(json.deleted_count || 0) || undefined,
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

/** Link stored questionnaire rows to pipeline when email/phone later appears in Paz. */
export async function rematchWebinarQuestionnairesForContact(input: {
  email?: string | null;
  phone?: string | null;
  daysBack?: number;
}): Promise<{ ok: true; data: WebinarQuestionnaireSyncResult } | { ok: false; error: string }> {
  return postQuestionnaireMode('questionnaire-rematch-contact', {
    email: input.email || undefined,
    phone: input.phone || undefined,
    days_back: input.daysBack,
  });
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
  } else if (viewFilter === 'needs_pipeline_match') {
    query = query
      .is('pipeline_candidate_id', null)
      .eq('hiring_stage', 'questionnaire_submitted');
  }

  const { data, error } = await query;
  if (error) {
    if (error.code === 'PGRST205' || /schema cache|does not exist/i.test(error.message)) {
      throw new Error(
        'Questionnaire table is not deployed on this Supabase project. Run supabase/sql/paste_webinar_geek_questionnaires.sql in the SQL editor, then paste_webinar_geek_questionnaires_ops.sql.',
      );
    }
    throw new Error(error.message);
  }

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
  const { data, error } = await supabase.rpc('wg_questionnaire_summary_counts', {
    p_date_from: input?.dateFrom ? ymdStartIso(input.dateFrom) : null,
    p_date_to: input?.dateTo ? ymdEndIso(input.dateTo) : null,
  });
  if (!error && data && typeof data === 'object') {
    const counts = data as Record<string, unknown>;
    return {
      total: Number(counts.total || 0),
      withAnswers: Number(counts.withAnswers || 0),
      attendedOnly: Number(counts.attendedOnly || 0),
      matchedPipeline: Number(counts.matchedPipeline || 0),
    };
  }

  let query = supabase
    .from('webinar_geek_questionnaire_submissions')
    .select('hiring_stage, pipeline_candidate_id', { count: 'exact', head: true });
  if (input?.dateFrom) query = query.gte('submitted_at', ymdStartIso(input.dateFrom));
  if (input?.dateTo) query = query.lte('submitted_at', ymdEndIso(input.dateTo));

  const { count, error: countError } = await query;
  if (countError) {
    return { total: 0, withAnswers: 0, attendedOnly: 0, matchedPipeline: 0 };
  }

  return {
    total: count ?? 0,
    withAnswers: 0,
    attendedOnly: 0,
    matchedPipeline: 0,
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

export const QUESTIONNAIRE_GO_LIVE_YMD = '2026-06-16';

export function defaultQuestionnaireDateFrom(): string {
  return QUESTIONNAIRE_GO_LIVE_YMD;
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
  if (viewFilter === 'needs_pipeline_match') {
    if (row.pipeline_candidate_id) return false;
    if (row.hiring_stage !== 'questionnaire_submitted') return false;
  }

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

const HALF_WATCH_SECONDS = Math.floor(47 * 60 * 0.5);

function normalizeQuestionnaireEmail(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function showedFromWgRow(row: Record<string, unknown>): boolean {
  if (row.watched === true) return true;
  const sec = Number(row.watch_duration || 0);
  return Number.isFinite(sec) && sec >= HALF_WATCH_SECONDS;
}

function showedAtFromWgRow(row: Record<string, unknown>): string | null {
  const pick = [
    row.watched_true_set_at,
    row.watch_end,
    row.updated_at,
    row.created_at,
  ];
  for (const value of pick) {
    const ms = Date.parse(String(value || ''));
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
  }
  return null;
}

export function formatSinceShowLabel(showedAt: string | null): { label: string; urgent: boolean } {
  if (!showedAt) return { label: '—', urgent: false };
  const ms = Date.now() - Date.parse(showedAt);
  if (!Number.isFinite(ms) || ms < 0) return { label: '—', urgent: false };
  const hours = ms / 3600000;
  if (hours < 24) {
    const h = Math.max(1, Math.floor(hours));
    return { label: `${h}h ago`, urgent: false };
  }
  const days = Math.floor(hours / 24);
  return { label: `${days}d ago`, urgent: days >= 2 };
}

export type QuestionnaireFollowUpRow = {
  key: string;
  email: string;
  name: string;
  webinarTitle: string | null;
  showedAt: string | null;
  sinceLabel: string;
  urgent: boolean;
  filled: boolean;
  submissionId: string | null;
  pipelineCandidateId: string | null;
  bookedByLabel: string | null;
  kind: 'showed_awaiting' | 'upcoming_booked';
};

export type QuestionnaireFollowUpBoard = {
  filledCount: number;
  awaitingCount: number;
  urgentCount: number;
  readyForFollowUpCount: number;
  rows: QuestionnaireFollowUpRow[];
};

export type QuestionnaireAccessScope = {
  role: AppRole;
  userId: string;
  teamUserIds: string[];
  scopeTokens: Set<string>;
};

export function isQuestionnaireStaffRole(role: AppRole | null): boolean {
  return role === 'admin' || role === 'leadership' || role === 'hr' || role === 'webinar';
}

export function isQuestionnaireRecruiterRole(role: AppRole | null): boolean {
  return role === 'recruiter';
}

export async function fetchHierarchyTeamUserIds(leaderUserId: string): Promise<string[]> {
  const { data } = await supabase
    .from('user_profile_hierarchy')
    .select('member_user_id')
    .eq('leader_user_id', leaderUserId);
  const ids = new Set<string>([leaderUserId]);
  for (const row of data || []) {
    const memberId = String((row as { member_user_id?: string }).member_user_id || '').trim();
    if (memberId) ids.add(memberId);
  }
  return [...ids];
}

export async function buildQuestionnaireAccessScope(profile: UserProfile): Promise<QuestionnaireAccessScope> {
  const teamUserIds = profile.role === 'leadership'
    ? await fetchHierarchyTeamUserIds(profile.user_id)
    : [profile.user_id];
  return {
    role: profile.role,
    userId: profile.user_id,
    teamUserIds,
    scopeTokens: buildRecruiterScopeTokens(profile.email, profile.full_name),
  };
}

type PortalBookingMeta = {
  bookedByUserId: string | null;
  bookedByLabel: string | null;
  customField: string | null;
  candidateId: string | null;
  webinarTitle: string | null;
  createdAt: string | null;
};

function customFieldOwnedByScope(scope: QuestionnaireAccessScope, customField: string | null | undefined): boolean {
  const tag = String(customField || '').trim().toLowerCase();
  if (!tag || scope.scopeTokens.size === 0) return false;
  for (const token of scope.scopeTokens) {
    if (!token || token.length < 3) continue;
    if (tag === token || tag.includes(token)) return true;
  }
  return false;
}

export function questionnaireLeadOwnedByScope(
  scope: QuestionnaireAccessScope,
  bookedByUserId: string | null | undefined,
  recruiterCustomField: string | null | undefined,
): boolean {
  if (scope.role === 'admin' || scope.role === 'hr' || scope.role === 'webinar') return true;
  const bookedBy = String(bookedByUserId || '').trim();
  if (bookedBy && scope.teamUserIds.includes(bookedBy)) return true;
  if (scope.role === 'recruiter' && bookedBy === scope.userId) return true;
  return customFieldOwnedByScope(scope, recruiterCustomField);
}

async function fetchQuestionnaireFilledEmails(scope: QuestionnaireAccessScope): Promise<Set<string>> {
  const { data, error } = await supabase.rpc('questionnaire_filled_emails_for_viewer');
  if (!error) {
    return new Set(
      (data || [])
        .map((row: { email?: string }) => normalizeQuestionnaireEmail(row.email))
        .filter(Boolean) as string[],
    );
  }

  if (isQuestionnaireRecruiterRole(scope.role)) {
    return new Set();
  }

  const { data: submissions, error: subErr } = await supabase
    .from('webinar_geek_questionnaire_submissions')
    .select('email')
    .eq('source_type', 'google_form')
    .in('hiring_stage', ['questionnaire_submitted', 'ready_for_followup'])
    .limit(5000);
  if (subErr) return new Set();
  return new Set(
    (submissions || [])
      .map((row) => normalizeQuestionnaireEmail((row as { email?: string }).email))
      .filter(Boolean) as string[],
  );
}

async function loadScopedPortalBookings(): Promise<Map<string, PortalBookingMeta>> {
  const { data, error } = await supabase
    .from('webinar_geek_portal_bookings')
    .select('candidate_email, candidate_first_name, candidate_last_name, booked_by_user_id, booked_by_label, custom_field, candidate_id, broadcast_id, created_at')
    .eq('status', 'booked')
    .order('created_at', { ascending: false })
    .limit(3000);
  if (error) return new Map();

  const byEmail = new Map<string, PortalBookingMeta>();
  for (const row of data || []) {
    const email = normalizeQuestionnaireEmail((row as { candidate_email?: string }).candidate_email);
    if (!email || byEmail.has(email)) continue;
    byEmail.set(email, {
      bookedByUserId: String((row as { booked_by_user_id?: string }).booked_by_user_id || '').trim() || null,
      bookedByLabel: String((row as { booked_by_label?: string }).booked_by_label || '').trim() || null,
      customField: String((row as { custom_field?: string }).custom_field || '').trim() || null,
      candidateId: String((row as { candidate_id?: string }).candidate_id || '').trim() || null,
      webinarTitle: null,
      createdAt: String((row as { created_at?: string }).created_at || '').trim() || null,
    });
  }
  return byEmail;
}

export async function fetchQuestionnaireFollowUpBoard(
  scope: QuestionnaireAccessScope,
): Promise<QuestionnaireFollowUpBoard> {
  const [filledEmails, bookingByEmail, cache] = await Promise.all([
    fetchQuestionnaireFilledEmails(scope),
    loadScopedPortalBookings(),
    loadWebinarGeekDashboardCache(),
  ]);

  const wgRows = (cache.data?.subscriptions || []) as Array<Record<string, unknown>>;
  const showedByEmail = new Map<string, Record<string, unknown>>();
  for (const row of wgRows) {
    if (!showedFromWgRow(row)) continue;
    const email = normalizeQuestionnaireEmail(row.email);
    if (!email) continue;
    const existing = showedByEmail.get(email);
    const existingAt = existing ? Date.parse(String(showedAtFromWgRow(existing) || '')) : 0;
    const nextAt = Date.parse(String(showedAtFromWgRow(row) || ''));
    if (!existing || (Number.isFinite(nextAt) && nextAt > existingAt)) {
      showedByEmail.set(email, row);
    }
  }

  const rows: QuestionnaireFollowUpRow[] = [];
  const seenKeys = new Set<string>();

  for (const [email, wgRow] of showedByEmail.entries()) {
    const booking = bookingByEmail.get(email);
    const customField = booking?.customField || String(wgRow.custom_field || '').trim() || null;
    if (!questionnaireLeadOwnedByScope(scope, booking?.bookedByUserId, customField)) continue;

    const filled = filledEmails.has(email);
    if (isQuestionnaireRecruiterRole(scope.role) && filled) continue;

    const showedAt = showedAtFromWgRow(wgRow);
    const since = formatSinceShowLabel(showedAt);
    const wgFirst = String(wgRow.firstname || wgRow.first_name || '').trim();
    const wgLast = String(wgRow.surname || wgRow.last_name || '').trim();
    const name = [wgFirst, wgLast].filter(Boolean).join(' ') || email;

    const key = `showed:${email}`;
    seenKeys.add(key);
    rows.push({
      key,
      email,
      name,
      webinarTitle: String(wgRow.webinar_title || wgRow.webinar_name || '').trim() || null,
      showedAt,
      sinceLabel: since.label,
      urgent: !filled && since.urgent,
      filled,
      submissionId: null,
      pipelineCandidateId: booking?.candidateId ?? null,
      bookedByLabel: booking?.bookedByLabel ?? null,
      kind: 'showed_awaiting',
    });
  }

  for (const [email, booking] of bookingByEmail.entries()) {
    if (!questionnaireLeadOwnedByScope(scope, booking.bookedByUserId, booking.customField)) continue;
    if (filledEmails.has(email)) continue;
    if (showedByEmail.has(email)) continue;

    const key = `upcoming:${email}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const since = formatSinceShowLabel(booking.createdAt);
    rows.push({
      key,
      email,
      name: email,
      webinarTitle: booking.webinarTitle,
      showedAt: booking.createdAt,
      sinceLabel: booking.createdAt ? `Booked ${since.label}` : 'Booked',
      urgent: false,
      filled: false,
      submissionId: null,
      pipelineCandidateId: booking.candidateId,
      bookedByLabel: booking.bookedByLabel,
      kind: 'upcoming_booked',
    });
  }

  rows.sort((a, b) => {
    if (a.filled !== b.filled) return a.filled ? 1 : -1;
    if (a.kind !== b.kind) return a.kind === 'showed_awaiting' ? -1 : 1;
    if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
    return Date.parse(b.showedAt || '') - Date.parse(a.showedAt || '');
  });

  const visible = isQuestionnaireRecruiterRole(scope.role) ? rows.filter((row) => !row.filled) : rows;
  const awaiting = visible.filter((row) => !row.filled);
  const filledCount = isQuestionnaireRecruiterRole(scope.role)
    ? 0
    : visible.filter((row) => row.filled).length;

  return {
    filledCount,
    awaitingCount: awaiting.length,
    urgentCount: awaiting.filter((row) => row.urgent).length,
    readyForFollowUpCount: isQuestionnaireRecruiterRole(scope.role)
      ? 0
      : visible.filter((row) => row.filled && row.pipelineCandidateId).length,
    rows: visible,
  };
}

export async function deleteWebinarQuestionnaireSubmission(id: string): Promise<void> {
  const { error } = await supabase
    .from('webinar_geek_questionnaire_submissions')
    .delete()
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function purgeLegacyQuestionnaireSubmissions(): Promise<
  { ok: true; deleted: number } | { ok: false; error: string }
> {
  return postQuestionnaireMode('questionnaire-purge-legacy');
}

export function canManageQuestionnaireRows(role: AppRole | null): boolean {
  return role === 'admin' || role === 'leadership' || role === 'hr' || role === 'webinar';
}
