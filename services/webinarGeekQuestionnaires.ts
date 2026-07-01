import { supabase } from './supabaseClient';
import type { AppRole, UserProfile } from './accessControl';
import { buildRecruiterScopeTokens } from './accessControl';
import { loadWebinarGeekDashboardCache } from './webinarGeekDashboardCache';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const QUERY_TIMEOUT_MS = 12_000;

async function withQueryTimeout<T>(promise: PromiseLike<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), QUERY_TIMEOUT_MS);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const QUESTIONNAIRE_PAGE_SIZE = 50;

const LIST_SELECT =
  'id, wg_submission_key, subscription_id, webinar_id, broadcast_id, webinar_title, broadcast_title, email, first_name, last_name, phone, submitted_at, pipeline_candidate_id, journey_candidate_id, booked_by_user_id, booked_by_label, recruiter_custom_field, match_method, hiring_stage, source_type, watched, watch_duration_seconds, synced_at, created_at, updated_at, raw_payload';

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
  raw_payload?: Record<string, unknown>;
  /** Client-side WG cache link when DB row not yet rematched. */
  wg_linked_email?: string | null;
};

export type QuestionnaireViewFilter =
  | 'all'
  | 'with_answers'
  | 'attended_only'
  | 'matched_pipeline'
  | 'needs_pipeline_match'
  | 'wg_linked'
  | 'new_unread';

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

function wgPhoneDigits(value: unknown): string | null {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

function findWgRowForSubmission(
  row: WebinarQuestionnaireSubmission,
  wgRows: Array<Record<string, unknown>>,
): Record<string, unknown> | null {
  const email = normalizeQuestionnaireEmail(row.email);
  const phone = wgPhoneDigits(row.phone);
  const nameKey = normalizeQuestionnaireNameKey(row.first_name, row.last_name);
  const goLiveIso = questionnaireGoLiveIso();
  const matches: Array<Record<string, unknown>> = [];

  for (const wgRow of wgRows) {
    const wgEmail = normalizeQuestionnaireEmail(wgRow.email);
    const wgPhone = wgPhoneDigits(wgRow.phone ?? wgRow.telephone ?? wgRow.mobile);
    const wgName = normalizeQuestionnaireNameKey(wgRow.firstname ?? wgRow.first_name, wgRow.surname ?? wgRow.last_name);
    const hit = (email && wgEmail === email)
      || (phone && wgPhone && phone === wgPhone)
      || (nameKey && wgName && nameKey === wgName);
    if (!hit) continue;
    const activity = String(wgRow.watched_true_set_at || wgRow.watch_end || wgRow.updated_at || wgRow.created_at || '');
    if (activity && activity < goLiveIso) continue;
    matches.push(wgRow);
  }

  if (!matches.length) return null;
  matches.sort((a, b) => {
    const aw = a.watched === true ? 1 : 0;
    const bw = b.watched === true ? 1 : 0;
    if (bw !== aw) return bw - aw;
    return Date.parse(String(b.updated_at || b.created_at || '')) - Date.parse(String(a.updated_at || a.created_at || ''));
  });
  return matches[0] ?? null;
}

export function submissionHasWgLink(row: WebinarQuestionnaireSubmission): boolean {
  const storedWgEmail = normalizeQuestionnaireEmail(
    row.wg_linked_email
    || (row.raw_payload?.wg_linked_email as string | undefined),
  );
  return Boolean(
    row.subscription_id
    || row.watched === true
    || (row.watch_duration_seconds && row.watch_duration_seconds > 0)
    || row.match_method?.includes('wg_')
    || storedWgEmail
  );
}

export function enrichSubmissionFromWgCache(
  row: WebinarQuestionnaireSubmission,
  wgRows: Array<Record<string, unknown>>,
): WebinarQuestionnaireSubmission {
  if (submissionHasWgLink(row) && row.booked_by_label && row.webinar_title) return row;
  const wgRow = findWgRowForSubmission(row, wgRows);
  if (!wgRow) return row;

  const wgEmail = normalizeQuestionnaireEmail(wgRow.email);
  const watchSec = Number(wgRow.watch_duration ?? wgRow.watch_duration_seconds ?? 0);

  return {
    ...row,
    subscription_id: row.subscription_id || String(wgRow.id || wgRow.subscription_id || '') || null,
    webinar_title: row.webinar_title || String(wgRow.webinar_title || wgRow.webinar_name || wgRow.title || '').trim() || null,
    broadcast_title: row.broadcast_title || String(wgRow.broadcast_title || wgRow.broadcast_name || '').trim() || null,
    watched: row.watched ?? (wgRow.watched === true ? true : wgRow.watched === false ? false : null),
    watch_duration_seconds: row.watch_duration_seconds
      ?? (Number.isFinite(watchSec) && watchSec > 0 ? watchSec : null),
    wg_linked_email: row.wg_linked_email || wgEmail || null,
    phone: row.phone || String(wgRow.phone || wgRow.telephone || wgRow.mobile || '').trim() || null,
    recruiter_custom_field: row.recruiter_custom_field || String(wgRow.custom_field || '').trim() || null,
    match_method: row.match_method?.includes('wg_')
      ? row.match_method
      : [row.match_method, 'wg_snapshot_client'].filter(Boolean).join('+') || 'wg_snapshot_client',
  };
}

export function wgLinkedEmailForSubmission(row: WebinarQuestionnaireSubmission): string | null {
  return normalizeQuestionnaireEmail(
    row.wg_linked_email || (row.raw_payload?.wg_linked_email as string | undefined) || row.email,
  ) || null;
}

export function bookedByLabelForSubmission(row: WebinarQuestionnaireSubmission): string | null {
  const direct = row.booked_by_label?.trim();
  if (direct) return direct;

  const tag = String(row.recruiter_custom_field || '').trim();
  if (!tag) return null;

  const parsed = tag.match(/^(cooper|rms)[_\-\s]+(.+)$/i);
  if (parsed) {
    const channel = parsed[1].toUpperCase() === 'RMS' ? 'RMS' : 'Cooper';
    const slug = parsed[2]
      .trim()
      .split(/[_\-\s]+/g)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(' ');
    return `${channel} · ${slug}`;
  }

  return tag;
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
    .order('created_at', { ascending: false })
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
  } else if (viewFilter === 'wg_linked') {
    query = query.or(
      'subscription_id.not.is.null,watched.eq.true,watch_duration_seconds.gt.0,match_method.ilike.%wg_%,recruiter_custom_field.not.is.null,booked_by_user_id.not.is.null,raw_payload->>wg_linked_email.not.is.null',
    );
  }

  const { data, error } = await withQueryTimeout(query, 'Questionnaire list');
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
  const dateFrom = input?.dateFrom ? ymdStartIso(input.dateFrom) : questionnaireGoLiveIso();
  const dateTo = input?.dateTo ? ymdEndIso(input.dateTo) : null;

  try {
    let totalQ = supabase
      .from('webinar_geek_questionnaire_submissions')
      .select('id', { count: 'exact', head: true })
      .eq('source_type', 'google_form')
      .gte('submitted_at', dateFrom);
    let withAnswersQ = supabase
      .from('webinar_geek_questionnaire_submissions')
      .select('id', { count: 'exact', head: true })
      .eq('source_type', 'google_form')
      .eq('hiring_stage', 'questionnaire_submitted')
      .gte('submitted_at', dateFrom);
    let attendedOnlyQ = supabase
      .from('webinar_geek_questionnaire_submissions')
      .select('id', { count: 'exact', head: true })
      .eq('source_type', 'google_form')
      .eq('hiring_stage', 'attended_only')
      .gte('submitted_at', dateFrom);
    let matchedPipelineQ = supabase
      .from('webinar_geek_questionnaire_submissions')
      .select('id', { count: 'exact', head: true })
      .eq('source_type', 'google_form')
      .not('pipeline_candidate_id', 'is', null)
      .gte('submitted_at', dateFrom);
    if (dateTo) {
      totalQ = totalQ.lte('submitted_at', dateTo);
      withAnswersQ = withAnswersQ.lte('submitted_at', dateTo);
      attendedOnlyQ = attendedOnlyQ.lte('submitted_at', dateTo);
      matchedPipelineQ = matchedPipelineQ.lte('submitted_at', dateTo);
    }

    const [totalRes, withAnswersRes, attendedOnlyRes, matchedPipelineRes] = await withQueryTimeout(
      Promise.all([totalQ, withAnswersQ, attendedOnlyQ, matchedPipelineQ]),
      'Questionnaire summary',
    );

    return {
      total: totalRes.count ?? 0,
      withAnswers: withAnswersRes.count ?? 0,
      attendedOnly: attendedOnlyRes.count ?? 0,
      matchedPipeline: matchedPipelineRes.count ?? 0,
    };
  } catch {
    return { total: 0, withAnswers: 0, attendedOnly: 0, matchedPipeline: 0 };
  }
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

export function questionnaireGoLiveIso(): string {
  return ymdStartIso(QUESTIONNAIRE_GO_LIVE_YMD);
}

const QUESTIONNAIRE_OPENED_STORAGE_KEY = 'paz_questionnaire_opened_v1';

export function questionnaireOpenedStorageKey(userId: string): string {
  return `${QUESTIONNAIRE_OPENED_STORAGE_KEY}_${userId}`;
}

export function loadOpenedQuestionnaireIds(userId: string): Set<string> {
  if (!userId) return new Set();
  try {
    const raw = localStorage.getItem(questionnaireOpenedStorageKey(userId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === 'string' && id.length > 0));
  } catch {
    return new Set();
  }
}

function persistOpenedQuestionnaireIds(userId: string, ids: Set<string>): void {
  try {
    localStorage.setItem(questionnaireOpenedStorageKey(userId), JSON.stringify([...ids]));
  } catch {
    // quota / private mode
  }
}

export function markQuestionnaireSubmissionOpened(
  userId: string,
  submissionId: string,
  current: Set<string>,
): Set<string> {
  if (!userId || !submissionId || current.has(submissionId)) return current;
  const next = new Set(current);
  next.add(submissionId);
  persistOpenedQuestionnaireIds(userId, next);
  return next;
}

export function isQuestionnaireSubmissionUnread(submissionId: string, openedIds: Set<string>): boolean {
  return Boolean(submissionId) && !openedIds.has(submissionId);
}

/** On first visit, treat current list as already seen so only future submissions show as new. */
export function seedQuestionnaireOpenedIdsIfEmpty(userId: string, submissionIds: string[]): Set<string> {
  if (!userId) return new Set();
  if (localStorage.getItem(questionnaireOpenedStorageKey(userId)) !== null) {
    return loadOpenedQuestionnaireIds(userId);
  }
  const seeded = new Set(submissionIds.filter(Boolean));
  persistOpenedQuestionnaireIds(userId, seeded);
  return seeded;
}

export function normalizeQuestionnaireNameKey(
  first: unknown,
  last?: unknown,
): string | null {
  if (last === undefined) {
    const single = String(first || '').trim().toLowerCase().replace(/\s+/g, ' ');
    return single || null;
  }
  const parts = [first, last].map((v) => String(v || '').trim().toLowerCase()).filter(Boolean);
  if (!parts.length) return null;
  return parts.join(' ').replace(/\s+/g, ' ');
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

export type QuestionnairePageFilterOptions = {
  openedIds?: Set<string>;
};

export function submissionMatchesPageFilters(
  row: WebinarQuestionnaireSubmission,
  input: WebinarQuestionnairePageFilters,
  options?: QuestionnairePageFilterOptions,
): boolean {
  const viewFilter = input.viewFilter || 'all';
  if (viewFilter === 'with_answers' && row.hiring_stage !== 'questionnaire_submitted') return false;
  if (viewFilter === 'attended_only' && row.hiring_stage !== 'attended_only') return false;
  if (viewFilter === 'matched_pipeline' && !row.pipeline_candidate_id) return false;
  if (viewFilter === 'needs_pipeline_match') {
    if (row.pipeline_candidate_id) return false;
    if (row.hiring_stage !== 'questionnaire_submitted') return false;
  }
  if (viewFilter === 'wg_linked' && !submissionHasWgLink(row)) return false;
  if (viewFilter === 'new_unread' && !isQuestionnaireSubmissionUnread(row.id, options?.openedIds || new Set())) {
    return false;
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

function showedAtFromWgRowForBoard(row: Record<string, unknown>): string | null {
  for (const value of [row.watched_true_set_at, row.watch_end]) {
    const ms = Date.parse(String(value || ''));
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
  }
  const createdMs = Date.parse(String(row.created_at || ''));
  if (Number.isFinite(createdMs)) return new Date(createdMs).toISOString();
  return null;
}

function isOnOrAfterGoLive(iso: string | null | undefined): boolean {
  if (!iso) return false;
  return iso >= questionnaireGoLiveIso();
}

type FilledIdentityIndex = {
  emails: Set<string>;
  nameKeys: Set<string>;
  byName: Map<string, {
    email: string;
    submissionId: string | null;
    pipelineCandidateId: string | null;
  }>;
};

function filledIdentityIndexIsFilled(
  email: string,
  nameKey: string | null,
  index: FilledIdentityIndex,
): boolean {
  if (email && index.emails.has(email)) return true;
  if (nameKey && index.nameKeys.has(nameKey)) return true;
  return false;
}

function filledIdentityForRow(
  email: string,
  nameKey: string | null,
  index: FilledIdentityIndex,
): { submissionId: string | null; pipelineCandidateId: string | null } {
  if (nameKey && index.byName.has(nameKey)) {
    const hit = index.byName.get(nameKey)!;
    return { submissionId: hit.submissionId, pipelineCandidateId: hit.pipelineCandidateId };
  }
  return { submissionId: null, pipelineCandidateId: null };
}

async function fetchQuestionnaireFilledIdentities(
  scope: QuestionnaireAccessScope,
): Promise<FilledIdentityIndex> {
  const goLiveIso = questionnaireGoLiveIso();
  const index: FilledIdentityIndex = {
    emails: new Set(),
    nameKeys: new Set(),
    byName: new Map(),
  };

  const { data: rpcData, error: rpcErr } = await supabase.rpc('questionnaire_filled_identities_for_viewer');
  if (!rpcErr && rpcData) {
    for (const row of rpcData as Array<{
      email?: string;
      name_key?: string;
      submission_id?: string;
      pipeline_candidate_id?: string;
    }>) {
      const email = normalizeQuestionnaireEmail(row.email);
      const nameKey = normalizeQuestionnaireNameKey(row.name_key || '');
      if (email) index.emails.add(email);
      if (nameKey) {
        index.nameKeys.add(nameKey);
        if (!index.byName.has(nameKey)) {
          index.byName.set(nameKey, {
            email: email || '',
            submissionId: row.submission_id ? String(row.submission_id) : null,
            pipelineCandidateId: row.pipeline_candidate_id ? String(row.pipeline_candidate_id) : null,
          });
        }
      }
    }
    return index;
  }

  const { data: rpcEmails, error: emailRpcErr } = await supabase.rpc('questionnaire_filled_emails_for_viewer');
  if (!emailRpcErr && rpcEmails) {
    for (const row of rpcEmails as Array<{ email?: string }>) {
      const email = normalizeQuestionnaireEmail(row.email);
      if (email) index.emails.add(email);
    }
    return index;
  }

  if (isQuestionnaireRecruiterRole(scope.role)) {
    return index;
  }

  const { data: submissions, error: subErr } = await supabase
    .from('webinar_geek_questionnaire_submissions')
    .select('id, email, first_name, last_name, pipeline_candidate_id, submitted_at')
    .eq('source_type', 'google_form')
    .in('hiring_stage', ['questionnaire_submitted', 'ready_for_followup'])
    .gte('submitted_at', goLiveIso)
    .limit(5000);
  if (subErr) return index;

  for (const row of submissions || []) {
    const email = normalizeQuestionnaireEmail((row as { email?: string }).email);
    const nameKey = normalizeQuestionnaireNameKey(
      (row as { first_name?: string }).first_name,
      (row as { last_name?: string }).last_name,
    );
    if (email) index.emails.add(email);
    if (nameKey) {
      index.nameKeys.add(nameKey);
      if (!index.byName.has(nameKey)) {
        index.byName.set(nameKey, {
          email: email || '',
          submissionId: String((row as { id?: string }).id || '') || null,
          pipelineCandidateId: String((row as { pipeline_candidate_id?: string }).pipeline_candidate_id || '') || null,
        });
      }
    }
  }
  return index;
}

type PortalBookingMeta = {
  email?: string;
  bookedByUserId: string | null;
  bookedByLabel: string | null;
  customField: string | null;
  candidateId: string | null;
  candidateFirstName: string | null;
  candidateLastName: string | null;
  webinarTitle: string | null;
  createdAt: string | null;
};

type PortalBookingMaps = {
  byEmail: Map<string, PortalBookingMeta>;
  byName: Map<string, PortalBookingMeta>;
};

let portalBookingsTableUnavailable = false;

function isMissingSupabaseTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === 'PGRST205' || error.code === '42P01') return true;
  return /relation|does not exist|schema cache|not found/i.test(String(error.message || ''));
}

async function loadScopedPortalBookings(): Promise<PortalBookingMaps> {
  const byEmail = new Map<string, PortalBookingMeta>();
  const byName = new Map<string, PortalBookingMeta>();
  if (portalBookingsTableUnavailable) return { byEmail, byName };

  const goLiveIso = questionnaireGoLiveIso();
  const { data, error } = await withQueryTimeout(
    supabase
      .from('webinar_geek_portal_bookings')
      .select('candidate_email, candidate_first_name, candidate_last_name, booked_by_user_id, booked_by_label, custom_field, candidate_id, broadcast_id, created_at')
      .eq('status', 'booked')
      .gte('created_at', goLiveIso)
      .order('created_at', { ascending: false })
      .limit(3000),
    'Portal bookings',
  );
  if (error) {
    if (isMissingSupabaseTableError(error)) portalBookingsTableUnavailable = true;
    return { byEmail, byName };
  }

  for (const row of data || []) {
    const email = normalizeQuestionnaireEmail((row as { candidate_email?: string }).candidate_email);
    if (!email) continue;
    const meta: PortalBookingMeta = {
      bookedByUserId: String((row as { booked_by_user_id?: string }).booked_by_user_id || '').trim() || null,
      bookedByLabel: String((row as { booked_by_label?: string }).booked_by_label || '').trim() || null,
      customField: String((row as { custom_field?: string }).custom_field || '').trim() || null,
      candidateId: String((row as { candidate_id?: string }).candidate_id || '').trim() || null,
      candidateFirstName: String((row as { candidate_first_name?: string }).candidate_first_name || '').trim() || null,
      candidateLastName: String((row as { candidate_last_name?: string }).candidate_last_name || '').trim() || null,
      webinarTitle: null,
      createdAt: String((row as { created_at?: string }).created_at || '').trim() || null,
    };
    if (!byEmail.has(email)) byEmail.set(email, { ...meta, email });
    const nameKey = normalizeQuestionnaireNameKey(meta.candidateFirstName, meta.candidateLastName);
    if (nameKey && !byName.has(nameKey)) byName.set(nameKey, { ...meta, email });
  }
  return { byEmail, byName };
}

let wgShowedIndexUnavailable = false;

async function fetchWgShowedIndexRows(sinceIso: string): Promise<Array<Record<string, unknown>>> {
  if (wgShowedIndexUnavailable) return [];
  try {
    const { data, error } = await withQueryTimeout(
      supabase.rpc('wg_questionnaire_showed_index', { p_since: sinceIso }),
      'WG showed index',
    );
    if (error) {
      if (error.code === 'PGRST202' || isMissingSupabaseTableError(error)) {
        wgShowedIndexUnavailable = true;
      }
      return [];
    }
    if (!Array.isArray(data)) return [];
    return data as Array<Record<string, unknown>>;
  } catch {
    wgShowedIndexUnavailable = true;
    return [];
  }
}

function buildWgShowIndexes(wgRows: Array<Record<string, unknown>>): {
  byEmail: Map<string, Record<string, unknown>>;
  byName: Map<string, Record<string, unknown>>;
} {
  const byEmail = new Map<string, Record<string, unknown>>();
  const byName = new Map<string, Record<string, unknown>>();
  const goLiveIso = questionnaireGoLiveIso();

  for (const row of wgRows) {
    if (!showedFromWgRow(row)) continue;
    const showedAt = showedAtFromWgRowForBoard(row);
    if (!isOnOrAfterGoLive(showedAt)) continue;

    const email = normalizeQuestionnaireEmail(row.email);
    if (email) {
      const existing = byEmail.get(email);
      const existingAt = existing ? Date.parse(String(showedAtFromWgRowForBoard(existing) || '')) : 0;
      const nextAt = Date.parse(String(showedAt || ''));
      if (!existing || (Number.isFinite(nextAt) && nextAt > existingAt)) {
        byEmail.set(email, row);
      }
    }

    const nameKey = normalizeQuestionnaireNameKey(
      row.firstname || row.first_name,
      row.surname || row.last_name,
    );
    if (nameKey) {
      const existing = byName.get(nameKey);
      const existingAt = existing ? Date.parse(String(showedAtFromWgRowForBoard(existing) || '')) : 0;
      const nextAt = Date.parse(String(showedAt || ''));
      if (!existing || (Number.isFinite(nextAt) && nextAt > existingAt)) {
        byName.set(nameKey, row);
      }
    }
  }

  return { byEmail, byName };
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
  bookedByUserId: string | null;
  bookedByLabel: string | null;
  recruiterCustomField: string | null;
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

export async function fetchQuestionnaireFollowUpBoard(
  scope: QuestionnaireAccessScope,
): Promise<QuestionnaireFollowUpBoard> {
  const sinceIso = questionnaireGoLiveIso();
  const [filledIdentities, bookingMaps, wgRows] = await Promise.all([
    fetchQuestionnaireFilledIdentities(scope),
    loadScopedPortalBookings(),
    fetchWgShowedIndexRows(sinceIso),
  ]);

  const wgIndexes = buildWgShowIndexes(wgRows);
  const rows: QuestionnaireFollowUpRow[] = [];

  for (const [email, booking] of bookingMaps.byEmail.entries()) {
    if (!questionnaireLeadOwnedByScope(scope, booking.bookedByUserId, booking.customField)) continue;

    const nameKey = normalizeQuestionnaireNameKey(booking.candidateFirstName, booking.candidateLastName);
    const wgRow = wgIndexes.byEmail.get(email) || (nameKey ? wgIndexes.byName.get(nameKey) : null);
    const showed = Boolean(wgRow && showedFromWgRow(wgRow));
    const showedAt = wgRow ? showedAtFromWgRowForBoard(wgRow) : null;
    const filled = filledIdentityIndexIsFilled(email, nameKey, filledIdentities);
    if (isQuestionnaireRecruiterRole(scope.role) && filled) continue;

    const filledMeta = filledIdentityForRow(email, nameKey, filledIdentities);
    const displayName = nameKey
      ? nameKey.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
      : email;
    const since = showed && showedAt
      ? formatSinceShowLabel(showedAt)
      : formatSinceShowLabel(booking.createdAt);

    rows.push({
      key: `${showed ? 'showed' : 'upcoming'}:${email}`,
      email,
      name: displayName,
      webinarTitle: wgRow
        ? String(wgRow.webinar_title || wgRow.webinar_name || '').trim() || null
        : booking.webinarTitle,
      showedAt: showed ? showedAt : booking.createdAt,
      sinceLabel: showed ? since.label : (booking.createdAt ? `Booked ${since.label}` : 'Booked'),
      urgent: showed && !filled && since.urgent,
      filled,
      submissionId: filledMeta.submissionId,
      pipelineCandidateId: filledMeta.pipelineCandidateId || booking.candidateId,
      bookedByUserId: booking.bookedByUserId,
      bookedByLabel: booking.bookedByLabel,
      recruiterCustomField: booking.customField,
      kind: showed ? 'showed_awaiting' : 'upcoming_booked',
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

  return {
    filledCount: isQuestionnaireRecruiterRole(scope.role)
      ? 0
      : visible.filter((row) => row.filled).length,
    awaitingCount: awaiting.length,
    urgentCount: awaiting.filter((row) => row.urgent).length,
    readyForFollowUpCount: isQuestionnaireRecruiterRole(scope.role)
      ? 0
      : visible.filter((row) => row.filled && row.pipelineCandidateId).length,
    rows: visible,
  };
}

/** Resolve a pipeline candidate id the current viewer is allowed to call. */
export async function lookupPipelineCandidateIdByContact(
  email?: string | null,
  phone?: string | null,
): Promise<string | null> {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const digits = String(phone || '').replace(/\D/g, '');
  const phoneKey = digits.length >= 10 ? digits.slice(-10) : '';

  const candidates: string[] = [];
  if (normalizedEmail) {
    const { data } = await supabase
      .from('pipeline_candidates')
      .select('id')
      .ilike('email', normalizedEmail)
      .order('updated_at', { ascending: false })
      .limit(5);
    for (const row of data || []) {
      const id = String((row as { id?: string }).id || '').trim();
      if (id) candidates.push(id);
    }
  }
  if (phoneKey) {
    const { data } = await supabase
      .from('pipeline_candidates')
      .select('id')
      .eq('phone_last10', phoneKey)
      .order('updated_at', { ascending: false })
      .limit(5);
    for (const row of data || []) {
      const id = String((row as { id?: string }).id || '').trim();
      if (id && !candidates.includes(id)) candidates.push(id);
    }
  }

  for (const candidateId of candidates) {
    const { data: allowed, error } = await supabase.rpc('pipeline_can_access_candidate', {
      p_candidate_id: candidateId,
    });
    if (!error && allowed === true) return candidateId;
  }

  return null;
}
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
