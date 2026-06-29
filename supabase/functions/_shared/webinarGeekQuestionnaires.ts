import {
  parseBookingLinkTag,
  recruiterOwnsBookingLinkSlug,
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
  const subscriptionParams: Record<string, string | number | boolean | undefined> = {
    per_page: 250,
    nested_resources: 'broadcast,webinar',
  };
  if (input?.webinarId) subscriptionParams.webinar_id = input.webinarId;
  if (input?.broadcastId) subscriptionParams.broadcast_id = input.broadcastId;

  const subscriptionRes = await wgGet('/subscriptions', subscriptionParams);
  const subscriptionRows = subscriptionRes.ok
    ? rowsFromJsonArray(subscriptionRes.json, ['subscriptions'])
    : [];
  const subscriptionById = new Map<string, Record<string, unknown>>();
  for (const row of subscriptionRows) {
    const id = pickString(row.id);
    if (id) subscriptionById.set(id, row);
  }

  const merged = new Map<string, NormalizedWgQuestionnaireRow>();
  const sources: string[] = [];

  const probePaths = [
    '/evaluations',
    '/evaluation_forms',
    '/evaluation_form_responses',
    '/evaluation_results',
    '/interaction_results',
    '/interactions',
  ];

  for (const path of probePaths) {
    const res = await wgGet(path, {
      per_page: 250,
      webinar_id: input?.webinarId,
      broadcast_id: input?.broadcastId,
    });
    if (!res.ok) continue;
    const rawRows = rowsFromJsonArray(res.json, [
      'evaluations',
      'evaluation_forms',
      'evaluation_form_responses',
      'evaluation_results',
      'interaction_results',
      'interactions',
      'results',
      'data',
    ]);
    if (!rawRows.length) continue;
    sources.push(path);
    for (const row of rawRows) {
      const normalized = normalizeEvaluationRow(row, path.replace(/^\//, ''), subscriptionById);
      if (!normalized || !normalized.answers.length) continue;
      merged.set(normalized.wg_submission_key, normalized);
    }
  }

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
    merged.set(normalized.wg_submission_key, normalized);
    if (!sources.includes('subscription_extra_fields')) sources.push('subscription_extra_fields');
  }

  return { rows: [...merged.values()], sources };
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
