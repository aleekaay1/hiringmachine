import {
  bookingLinkFirstNameSlug,
  parseBookingLinkTag,
  recruiterOwnsBookingLinkSlug,
  suggestedBookingLinkTags,
} from './webinarGeekBookingLinks.ts';

export type WgQuestionnaireAnswer = {
  question: string;
  answer: string;
  field_key?: string | null;
};

export type NormalizedWgQuestionnaireRow = {
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
  answers: WgQuestionnaireAnswer[];
  raw_payload: Record<string, unknown>;
  recruiter_custom_field: string | null;
  source: string;
  watched?: boolean | null;
  watch_duration_seconds?: number | null;
};

type WgGetFn = (
  path: string,
  params?: Record<string, string | number | boolean | undefined>,
) => Promise<{ ok: boolean; status: number; json: Record<string, unknown> }>;

function normalizeEmail(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    const str = String(value ?? '').trim();
    if (str) return str;
  }
  return null;
}

function parseSubmittedAt(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  const str = String(value).trim();
  if (!str) return null;
  const ms = Date.parse(str);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function rowsFromJsonArray(json: Record<string, unknown>, keys: string[]): Array<Record<string, unknown>> {
  for (const key of keys) {
    const value = json[key];
    if (Array.isArray(value)) return value as Array<Record<string, unknown>>;
  }
  if (Array.isArray(json.data)) return json.data as Array<Record<string, unknown>>;
  return [];
}

function answersFromObject(obj: Record<string, unknown>): WgQuestionnaireAnswer[] {
  const skip = new Set([
    'id', 'email', 'firstname', 'surname', 'first_name', 'last_name', 'phone', 'telephone',
    'subscription_id', 'webinar_id', 'broadcast_id', 'created_at', 'updated_at', 'submitted_at',
  ]);
  const answers: WgQuestionnaireAnswer[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (skip.has(key)) continue;
    if (value == null) continue;
    if (typeof value === 'object' && !Array.isArray(value)) continue;
    const answer = Array.isArray(value) ? value.map(String).join(', ') : String(value).trim();
    if (!answer) continue;
    answers.push({
      question: key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      answer,
      field_key: key,
    });
  }
  return answers;
}

function answersFromRow(row: Record<string, unknown>): WgQuestionnaireAnswer[] {
  const direct = row.answers ?? row.responses ?? row.evaluation_answers ?? row.form_answers;
  if (Array.isArray(direct)) {
    return direct
      .map((entry) => {
        if (!entry || typeof entry !== 'object') {
          const text = String(entry || '').trim();
          return text ? { question: 'Answer', answer: text } : null;
        }
        const item = entry as Record<string, unknown>;
        const question = pickString(item.question, item.label, item.name, item.field, item.title) || 'Question';
        const answer = pickString(item.answer, item.value, item.response, item.text);
        if (!answer) return null;
        return {
          question,
          answer,
          field_key: pickString(item.key, item.field_key, item.name),
        };
      })
      .filter((v): v is WgQuestionnaireAnswer => Boolean(v));
  }
  if (direct && typeof direct === 'object') {
    return answersFromObject(direct as Record<string, unknown>);
  }
  const extra = row.extra_fields;
  if (extra && typeof extra === 'object') {
    return answersFromObject(extra as Record<string, unknown>);
  }
  return [];
}

function normalizeEvaluationRow(
  row: Record<string, unknown>,
  source: string,
  subscriptionById: Map<string, Record<string, unknown>>,
): NormalizedWgQuestionnaireRow | null {
  const subscriptionId = pickString(row.subscription_id, row.subscriber_id);
  const subscription = subscriptionId ? subscriptionById.get(subscriptionId) || null : null;
  const email = normalizeEmail(row.email ?? subscription?.email);
  const answers = answersFromRow(row);
  if (!email && !answers.length) return null;

  const broadcast = (row.broadcast && typeof row.broadcast === 'object'
    ? row.broadcast
    : subscription?.broadcast) as Record<string, unknown> | null;
  const webinar = (row.webinar && typeof row.webinar === 'object'
    ? row.webinar
    : subscription?.webinar) as Record<string, unknown> | null;

  const idPart = pickString(row.id, row.uuid, row.evaluation_id, row.response_id)
    || `${email || 'unknown'}|${parseSubmittedAt(row.submitted_at || row.created_at) || 'unknown'}`;
  const wgSubmissionKey = `${source}:${idPart}`;

  return {
    wg_submission_key: wgSubmissionKey,
    subscription_id: subscriptionId,
    webinar_id: pickString(row.webinar_id, webinar?.id),
    broadcast_id: pickString(row.broadcast_id, broadcast?.id),
    webinar_title: pickString(row.webinar_title, webinar?.title, webinar?.name),
    broadcast_title: pickString(row.broadcast_title, broadcast?.title, broadcast?.name),
    email: email || null,
    first_name: pickString(row.firstname, row.first_name, subscription?.firstname),
    last_name: pickString(row.surname, row.last_name, subscription?.surname),
    phone: pickString(row.phone, row.telephone, subscription?.phone, subscription?.telephone),
    submitted_at: parseSubmittedAt(row.submitted_at ?? row.created_at ?? row.updated_at),
    answers,
    raw_payload: row,
    recruiter_custom_field: pickString(row.custom_field, subscription?.custom_field),
    source,
  };
}

function questionnaireLikeExtraFields(extra: Record<string, unknown>): WgQuestionnaireAnswer[] {
  const keys = Object.keys(extra);
  if (keys.length < 2) return [];
  const questionnaireHints = /stood|fit|license|entitled|virtual|social|position|contact|background|investment|question/i;
  const hits = keys.filter((k) => questionnaireHints.test(k) || questionnaireHints.test(String(extra[k] || '')));
  if (hits.length < 1 && keys.length < 4) return [];
  return answersFromObject(extra);
}

export async function fetchWebinarGeekQuestionnaireRows(
  wgGet: WgGetFn,
  input?: { webinarId?: string; broadcastId?: string },
): Promise<{ rows: NormalizedWgQuestionnaireRow[]; sources: string[] }> {
  const merged = new Map<string, NormalizedWgQuestionnaireRow>();
  const sources: string[] = [];
  const subscriptionById = new Map<string, Record<string, unknown>>();

  const probePaths = [
    '/evaluation_form_results',
    '/evaluation_form_responses',
    '/evaluations',
    '/evaluation_forms',
    '/evaluation_results',
    '/interaction_results',
    '/interactions',
  ];

  const maxPages = 8;
  for (const path of probePaths) {
    let pathHit = false;
    for (let page = 1; page <= maxPages; page += 1) {
      const res = await wgGet(path, {
        per_page: 250,
        page,
        webinar_id: input?.webinarId,
        broadcast_id: input?.broadcastId,
      });
      if (!res.ok) break;
      const rawRows = rowsFromJsonArray(res.json, [
        'evaluation_form_results',
        'evaluation_form_responses',
        'evaluations',
        'evaluation_forms',
        'evaluation_results',
        'interaction_results',
        'interactions',
        'results',
        'data',
      ]);
      if (!rawRows.length) break;
      if (!pathHit) {
        sources.push(path);
        pathHit = true;
      }
      for (const row of rawRows) {
        const normalized = normalizeEvaluationRow(row, path.replace(/^\//, ''), subscriptionById);
        if (!normalized || !normalized.answers.length) continue;
        merged.set(normalized.wg_submission_key, normalized);
      }
      if (rawRows.length < 250) break;
    }
  }

  return { rows: [...merged.values()], sources };
}

const HALF_WATCH_SECONDS = Math.floor(47 * 60 * 0.5);

function watchSecondsFromSubscription(sub: Record<string, unknown>): number {
  const sec = Number(sub.watch_duration || 0);
  return Number.isFinite(sec) && sec > 0 ? sec : 0;
}

function subscriptionShowed(sub: Record<string, unknown>): boolean {
  if (sub.watched === true) return true;
  return watchSecondsFromSubscription(sub) >= HALF_WATCH_SECONDS;
}

/** Questionnaire answers only from cached subscriptions (no attendance bulk import). */
export function extractQuestionnaireRowsFromCachedSubscriptions(
  subscriptionRows: Array<Record<string, unknown>>,
): NormalizedWgQuestionnaireRow[] {
  const subscriptionById = new Map<string, Record<string, unknown>>();
  for (const row of subscriptionRows) {
    const id = pickString(row.id);
    if (id) subscriptionById.set(id, row);
  }

  const merged = new Map<string, NormalizedWgQuestionnaireRow>();
  for (const sub of subscriptionRows) {
    const extra = sub.extra_fields && typeof sub.extra_fields === 'object'
      ? sub.extra_fields as Record<string, unknown>
      : null;
    if (!extra) continue;
    const answers = questionnaireLikeExtraFields(extra);
    if (!answers.length) continue;
    const subId = pickString(sub.id) || 'unknown';
    const normalized = normalizeEvaluationRow(
      { ...sub, answers, submitted_at: sub.watched_true_set_at || sub.watch_end || sub.created_at },
      'subscription_extra_fields',
      subscriptionById,
    );
    if (!normalized) continue;
    normalized.wg_submission_key = `subscription_extra_fields:${subId}`;
    normalized.answers = answers;
    normalized.watched = sub.watched === true;
    normalized.watch_duration_seconds = watchSecondsFromSubscription(sub);
    merged.set(normalized.wg_submission_key, normalized);
  }
  return [...merged.values()];
}

/** @deprecated Prefer extractQuestionnaireRowsFromCachedSubscriptions (questionnaires only). */
export function extractRowsFromCachedSubscriptions(
  subscriptionRows: Array<Record<string, unknown>>,
): NormalizedWgQuestionnaireRow[] {
  return extractQuestionnaireRowsFromCachedSubscriptions(subscriptionRows);
}

export function hiringStageForQuestionnaireRow(row: NormalizedWgQuestionnaireRow): string {
  return row.answers.length > 0 ? 'questionnaire_submitted' : 'attended_only';
}

export type QuestionnaireMatchContext = {
  pipelineByEmail: Map<string, string>;
  journeyByEmail: Map<string, string>;
  bookingByEmailBroadcast: Map<string, Record<string, unknown>>;
  bookingByEmail: Map<string, Record<string, unknown>>;
  settingsByTag: Map<string, { user_id: string; label: string | null }>;
};

export async function buildQuestionnaireMatchContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
): Promise<QuestionnaireMatchContext> {
  const pipelineByEmail = new Map<string, string>();
  const journeyByEmail = new Map<string, string>();
  const bookingByEmailBroadcast = new Map<string, Record<string, unknown>>();
  const bookingByEmail = new Map<string, Record<string, unknown>>();
  const settingsByTag = new Map<string, { user_id: string; label: string | null }>();

  const [
    { data: pipelineRows },
    { data: journeyRows },
    { data: bookingRows },
    { data: settingsRows },
    { data: profileRows },
  ] = await Promise.all([
    admin.from('pipeline_candidates').select('id, email').not('email', 'is', null).limit(8000),
    admin.from('candidates').select('id, email').not('email', 'is', null).limit(8000),
    admin.from('webinar_geek_portal_bookings').select('candidate_email, broadcast_id, booked_by_user_id, booked_by_label, custom_field, created_at').eq('status', 'booked').order('created_at', { ascending: false }).limit(8000),
    admin.from('pipeline_user_call_settings').select('user_id, webinar_geek_custom_field').not('webinar_geek_custom_field', 'is', null),
    admin.from('user_profiles').select('user_id, full_name, email'),
  ]);

  for (const row of pipelineRows || []) {
    const email = normalizeEmail(row.email);
    if (!email || pipelineByEmail.has(email)) continue;
    pipelineByEmail.set(email, String(row.id));
  }
  for (const row of journeyRows || []) {
    const email = normalizeEmail(row.email);
    if (!email || journeyByEmail.has(email)) continue;
    journeyByEmail.set(email, String(row.id));
  }
  for (const row of bookingRows || []) {
    const email = normalizeEmail(row.candidate_email);
    if (!email) continue;
    if (!bookingByEmail.has(email)) bookingByEmail.set(email, row);
    const broadcastId = pickString(row.broadcast_id);
    const key = broadcastId ? `${email}|${broadcastId}` : email;
    if (!bookingByEmailBroadcast.has(key)) bookingByEmailBroadcast.set(key, row);
  }

  const profileByUserId = new Map<string, { full_name?: string; email?: string }>();
  for (const profile of profileRows || []) {
    profileByUserId.set(String(profile.user_id), profile);
  }
  for (const settings of settingsRows || []) {
    const tag = pickString(settings.webinar_geek_custom_field);
    const userId = String(settings.user_id || '');
    if (!tag || !userId) continue;
    const profile = profileByUserId.get(userId);
    settingsByTag.set(tag.toLowerCase(), {
      user_id: userId,
      label: pickString(profile?.full_name, profile?.email),
    });
  }
  for (const profile of profileRows || []) {
    const userId = String(profile.user_id || '');
    if (!userId) continue;
    const label = pickString(profile.full_name, profile.email);
    for (const tag of suggestedBookingLinkTags(profile.email, profile.full_name)) {
      const key = tag.toLowerCase();
      if (!settingsByTag.has(key)) settingsByTag.set(key, { user_id: userId, label });
    }
    const slug = bookingLinkFirstNameSlug(profile.full_name, profile.email);
    if (slug && !settingsByTag.has(slug)) settingsByTag.set(slug, { user_id: userId, label });
  }

  return {
    pipelineByEmail,
    journeyByEmail,
    bookingByEmailBroadcast,
    bookingByEmail,
    settingsByTag,
  };
}

export function matchQuestionnaireRowWithContext(
  row: NormalizedWgQuestionnaireRow,
  context: QuestionnaireMatchContext,
): QuestionnaireMatchResult {
  const email = normalizeEmail(row.email);
  let pipelineCandidateId: string | null = null;
  let journeyCandidateId: string | null = null;
  let matchMethod: string | null = null;

  if (email) {
    const pipelineId = context.pipelineByEmail.get(email);
    if (pipelineId) {
      pipelineCandidateId = pipelineId;
      matchMethod = 'pipeline_email';
    }
    const journeyId = context.journeyByEmail.get(email);
    if (journeyId) {
      journeyCandidateId = journeyId;
      matchMethod = matchMethod || 'journey_email';
    }
  }

  let bookedByUserId: string | null = null;
  let bookedByLabel: string | null = null;
  let recruiterCustomField = row.recruiter_custom_field;

  if (email) {
    const broadcastKey = row.broadcast_id ? `${email}|${row.broadcast_id}` : email;
    const booking = context.bookingByEmailBroadcast.get(broadcastKey)
      || context.bookingByEmail.get(email)
      || null;
    if (booking) {
      bookedByUserId = booking.booked_by_user_id ? String(booking.booked_by_user_id) : null;
      bookedByLabel = pickString(booking.booked_by_label);
      recruiterCustomField = recruiterCustomField || pickString(booking.custom_field);
      matchMethod = matchMethod ? `${matchMethod}+portal_booking` : 'portal_booking';
    }
  }

  if (!bookedByUserId && recruiterCustomField) {
    const tagKeys = new Set<string>([
      recruiterCustomField.toLowerCase(),
      recruiterCustomField.toLowerCase().replace(/^(cooper|rms)[_\-]+/i, ''),
    ]);
    const parsed = parseBookingLinkTag(recruiterCustomField);
    if (parsed) tagKeys.add(parsed.tag.toLowerCase());
    for (const key of tagKeys) {
      if (!key) continue;
      const settings = context.settingsByTag.get(key);
      if (!settings) continue;
      bookedByUserId = settings.user_id;
      bookedByLabel = settings.label;
      matchMethod = matchMethod ? `${matchMethod}+booking_tag` : 'booking_tag';
      break;
    }
  }

  return {
    pipeline_candidate_id: pipelineCandidateId,
    journey_candidate_id: journeyCandidateId,
    booked_by_user_id: bookedByUserId,
    booked_by_label: bookedByLabel,
    match_method: matchMethod,
    recruiter_custom_field: recruiterCustomField,
  };
}

export function buildQuestionnaireUpsertPayload(
  row: NormalizedWgQuestionnaireRow,
  match: QuestionnaireMatchResult,
  input: { sourceType: string; syncedAt: string },
): Record<string, unknown> {
  return {
    wg_submission_key: row.wg_submission_key,
    subscription_id: row.subscription_id,
    webinar_id: row.webinar_id,
    broadcast_id: row.broadcast_id,
    webinar_title: row.webinar_title,
    broadcast_title: row.broadcast_title,
    email: row.email,
    first_name: row.first_name,
    last_name: row.last_name,
    phone: row.phone,
    submitted_at: row.submitted_at,
    answers: row.answers,
    raw_payload: { ...row.raw_payload, _source: row.source },
    pipeline_candidate_id: match.pipeline_candidate_id,
    journey_candidate_id: match.journey_candidate_id,
    booked_by_user_id: match.booked_by_user_id,
    booked_by_label: match.booked_by_label,
    recruiter_custom_field: match.recruiter_custom_field,
    match_method: match.match_method,
    hiring_stage: hiringStageForQuestionnaireRow(row),
    source_type: input.sourceType,
    watched: row.watched ?? null,
    watch_duration_seconds: row.watch_duration_seconds ?? null,
    synced_at: input.syncedAt,
    updated_at: input.syncedAt,
  };
}

const QUESTIONNAIRE_UPSERT_CHUNK = 80;

function isMissingQuestionnaireTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === 'PGRST205') return true;
  const msg = String(error.message || '');
  return /webinar_geek_questionnaire_submissions/i.test(msg) && /schema cache|does not exist/i.test(msg);
}

export async function upsertQuestionnaireRowsBatched(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  rows: NormalizedWgQuestionnaireRow[],
  input: { sourceType: string; syncedAt: string; match?: boolean },
): Promise<{ upserted: number; matchedPipeline: number }> {
  const withAnswers = rows.filter((row) => row.answers.length > 0);
  if (!withAnswers.length) return { upserted: 0, matchedPipeline: 0 };

  const emptyContext: QuestionnaireMatchContext = {
    pipelineByEmail: new Map(),
    journeyByEmail: new Map(),
    bookingByEmailBroadcast: new Map(),
    bookingByEmail: new Map(),
    settingsByTag: new Map(),
  };
  const matchContext = input.match === false
    ? emptyContext
    : await buildQuestionnaireMatchContext(admin);

  const payloads = withAnswers.map((row) => {
    const match = input.match === false
      ? {
        pipeline_candidate_id: null,
        journey_candidate_id: null,
        booked_by_user_id: null,
        booked_by_label: null,
        match_method: null,
        recruiter_custom_field: row.recruiter_custom_field,
      }
      : matchQuestionnaireRowWithContext(row, matchContext);
    return buildQuestionnaireUpsertPayload(row, match, input);
  });

  let upserted = 0;
  let matchedPipeline = 0;
  for (let i = 0; i < payloads.length; i += QUESTIONNAIRE_UPSERT_CHUNK) {
    const chunk = payloads.slice(i, i + QUESTIONNAIRE_UPSERT_CHUNK);
    matchedPipeline += chunk.filter((row) => row.pipeline_candidate_id).length;
    const { error } = await admin
      .from('webinar_geek_questionnaire_submissions')
      .upsert(chunk, { onConflict: 'wg_submission_key' });
    if (error) {
      if (isMissingQuestionnaireTableError(error)) {
        throw new Error(
          'Database table webinar_geek_questionnaire_submissions is missing. Run supabase/sql/paste_webinar_geek_questionnaires.sql in the Supabase SQL editor first.',
        );
      }
      throw new Error(error.message);
    }
    upserted += chunk.length;
  }

  return { upserted, matchedPipeline };
}

export type QuestionnaireMatchResult = {
  pipeline_candidate_id: string | null;
  journey_candidate_id: string | null;
  booked_by_user_id: string | null;
  booked_by_label: string | null;
  match_method: string | null;
  recruiter_custom_field: string | null;
};

export async function matchQuestionnaireRow(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  row: NormalizedWgQuestionnaireRow,
): Promise<QuestionnaireMatchResult> {
  const email = normalizeEmail(row.email);
  let pipelineCandidateId: string | null = null;
  let journeyCandidateId: string | null = null;
  let matchMethod: string | null = null;

  if (email) {
    const { data: pipelineRow } = await admin
      .from('pipeline_candidates')
      .select('id')
      .ilike('email', email)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (pipelineRow?.id) {
      pipelineCandidateId = String(pipelineRow.id);
      matchMethod = 'pipeline_email';
    }

    const { data: journeyRow } = await admin
      .from('candidates')
      .select('id')
      .ilike('email', email)
      .order('timestamp', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (journeyRow?.id) {
      journeyCandidateId = String(journeyRow.id);
      matchMethod = matchMethod || 'journey_email';
    }
  }

  let bookedByUserId: string | null = null;
  let bookedByLabel: string | null = null;
  let recruiterCustomField = row.recruiter_custom_field;

  if (email) {
    let bookingQuery = admin
      .from('webinar_geek_portal_bookings')
      .select('booked_by_user_id, booked_by_label, custom_field')
      .eq('status', 'booked')
      .ilike('candidate_email', email)
      .order('created_at', { ascending: false })
      .limit(1);
    if (row.broadcast_id) {
      bookingQuery = bookingQuery.eq('broadcast_id', row.broadcast_id);
    }
    const { data: booking } = await bookingQuery.maybeSingle();
    if (booking) {
      bookedByUserId = booking.booked_by_user_id ? String(booking.booked_by_user_id) : null;
      bookedByLabel = pickString(booking.booked_by_label);
      recruiterCustomField = recruiterCustomField || pickString(booking.custom_field);
      matchMethod = matchMethod ? `${matchMethod}+portal_booking` : 'portal_booking';
    }
  }

  if (!bookedByUserId && recruiterCustomField) {
    const { data: settingsRows } = await admin
      .from('pipeline_user_call_settings')
      .select('user_id, webinar_geek_custom_field')
      .not('webinar_geek_custom_field', 'is', null);
    for (const settings of settingsRows || []) {
      const settingsTag = pickString(settings.webinar_geek_custom_field);
      if (!settingsTag || settingsTag.toLowerCase() !== recruiterCustomField!.toLowerCase()) continue;
      const userId = String(settings.user_id || '');
      if (!userId) continue;
      const { data: profile } = await admin
        .from('user_profiles')
        .select('full_name, email')
        .eq('user_id', userId)
        .maybeSingle();
      bookedByUserId = userId;
      bookedByLabel = pickString(profile?.full_name, profile?.email);
      matchMethod = matchMethod ? `${matchMethod}+custom_field` : 'custom_field';
      break;
    }
  }

  return {
    pipeline_candidate_id: pipelineCandidateId,
    journey_candidate_id: journeyCandidateId,
    booked_by_user_id: bookedByUserId,
    booked_by_label: bookedByLabel,
    match_method: matchMethod,
    recruiter_custom_field: recruiterCustomField,
  };
}
