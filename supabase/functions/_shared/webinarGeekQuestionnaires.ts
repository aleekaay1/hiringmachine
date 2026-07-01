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
  if (Array.isArray(json.__root_array)) {
    return json.__root_array as Array<Record<string, unknown>>;
  }
  for (const key of keys) {
    const value = json[key];
    if (Array.isArray(value)) return value as Array<Record<string, unknown>>;
  }
  if (Array.isArray(json.data)) return json.data as Array<Record<string, unknown>>;
  if (json.data && typeof json.data === 'object' && !Array.isArray(json.data)) {
    const nested = json.data as Record<string, unknown>;
    for (const key of keys) {
      const value = nested[key];
      if (Array.isArray(value)) return value as Array<Record<string, unknown>>;
    }
  }
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

function answersFromEvaluationFormAnswers(value: unknown): WgQuestionnaireAnswer[] {
  if (!Array.isArray(value) || !value.length) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        const text = String(entry || '').trim();
        return text ? { question: 'Answer', answer: text } : null;
      }
      const item = entry as Record<string, unknown>;
      const question = pickString(
        item.question,
        item.label,
        item.title,
        item.name,
        item.field,
        item.question_text,
        item.question_label,
      ) || 'Question';
      const answer = pickString(
        item.answer,
        item.value,
        item.response,
        item.text,
        item.content,
        item.answer_text,
      );
      if (!answer) return null;
      return {
        question,
        answer,
        field_key: pickString(item.key, item.field_key, item.id, item.question_id),
      };
    })
    .filter((v): v is WgQuestionnaireAnswer => Boolean(v));
}

function answersFromRow(row: Record<string, unknown>): WgQuestionnaireAnswer[] {
  const evalForm = answersFromEvaluationFormAnswers(row.evaluation_form_answers);
  if (evalForm.length) return evalForm;

  const direct = row.answers ?? row.responses ?? row.evaluation_answers ?? row.form_answers
    ?? row.fields ?? row.questions ?? row.form_fields ?? row.items ?? row.results;
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

export type WgEvaluationProbeResult = {
  path: string;
  status: number;
  ok: boolean;
  raw_count: number;
  with_answers: number;
};

export type WgQuestionnaireFetchResult = {
  rows: NormalizedWgQuestionnaireRow[];
  sources: string[];
  api_connected: boolean;
  api_status: number;
  probes: WgEvaluationProbeResult[];
};

async function ingestEvaluationApiPage(
  merged: Map<string, NormalizedWgQuestionnaireRow>,
  sources: string[],
  path: string,
  res: { ok: boolean; status: number; json: Record<string, unknown> },
  subscriptionById: Map<string, Record<string, unknown>>,
  pathHit: { value: boolean },
): Promise<number> {
  if (!res.ok) return 0;
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
  if (!rawRows.length) return 0;
  if (!pathHit.value) {
    sources.push(path);
    pathHit.value = true;
  }
  let withAnswers = 0;
  for (const row of rawRows) {
    const normalized = normalizeEvaluationRow(row, path.replace(/^\//, ''), subscriptionById);
    if (!normalized || !normalized.answers.length) continue;
    withAnswers += 1;
    merged.set(normalized.wg_submission_key, normalized);
  }
  return withAnswers;
}

export async function probeWebinarGeekEvaluationApi(
  wgGet: WgGetFn,
): Promise<{ api_connected: boolean; api_status: number; probes: WgEvaluationProbeResult[] }> {
  const account = await wgGet('/account');
  const probes: WgEvaluationProbeResult[] = [];
  const probePaths = [
    '/evaluation_form_results',
    '/evaluation_form_responses',
    '/evaluations',
    '/evaluation_forms',
    '/evaluation_results',
    '/interaction_results',
    '/interactions',
  ];

  for (const path of probePaths) {
    const res = await wgGet(path, { per_page: 5, page: 1 });
    const rawRows = res.ok
      ? rowsFromJsonArray(res.json, [
        'evaluation_form_results',
        'evaluation_form_responses',
        'evaluations',
        'evaluation_forms',
        'evaluation_results',
        'interaction_results',
        'interactions',
        'results',
        'data',
      ])
      : [];
    let withAnswers = 0;
    for (const row of rawRows) {
      const normalized = normalizeEvaluationRow(row, path.replace(/^\//, ''), new Map());
      if (normalized?.answers.length) withAnswers += 1;
    }
    probes.push({
      path,
      status: res.status,
      ok: res.ok,
      raw_count: rawRows.length,
      with_answers: withAnswers,
    });
  }

  return {
    api_connected: account.ok,
    api_status: account.status,
    probes,
  };
}

export async function fetchWebinarGeekQuestionnaireRows(
  wgGet: WgGetFn,
  input?: { webinarId?: string; broadcastId?: string },
): Promise<WgQuestionnaireFetchResult> {
  const merged = new Map<string, NormalizedWgQuestionnaireRow>();
  const sources: string[] = [];
  const subscriptionById = new Map<string, Record<string, unknown>>();
  const probes: WgEvaluationProbeResult[] = [];

  const account = await wgGet('/account');
  if (!account.ok) {
    return {
      rows: [],
      sources,
      api_connected: false,
      api_status: account.status,
      probes,
    };
  }

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
    const pathHit = { value: false };
    let pathRaw = 0;
    let pathWithAnswers = 0;
    let pathStatus = 0;
    let pathOk = false;
    for (let page = 1; page <= maxPages; page += 1) {
      const res = await wgGet(path, {
        per_page: 250,
        page,
        webinar_id: input?.webinarId,
        broadcast_id: input?.broadcastId,
      });
      pathStatus = res.status;
      pathOk = res.ok;
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
      pathRaw += rawRows.length;
      if (!rawRows.length) break;
      const added = await ingestEvaluationApiPage(merged, sources, path, res, subscriptionById, pathHit);
      pathWithAnswers += added;
      if (rawRows.length < 250) break;
    }
    probes.push({
      path,
      status: pathStatus,
      ok: pathOk,
      raw_count: pathRaw,
      with_answers: pathWithAnswers,
    });
  }

  if (merged.size === 0) {
    const broadcastsRes = await wgGet('/broadcasts', {
      per_page: 25,
      page: 1,
      webinar_id: input?.webinarId,
    });
    const broadcasts = broadcastsRes.ok
      ? rowsFromJsonArray(broadcastsRes.json, ['broadcasts', 'data'])
      : [];
    for (const broadcast of broadcasts.slice(0, 15)) {
      const broadcastId = pickString(broadcast.id);
      if (!broadcastId) continue;
      if (input?.broadcastId && broadcastId !== input.broadcastId) continue;
      const nestedPaths = [
        `/broadcasts/${broadcastId}/evaluation_form_results`,
        `/broadcasts/${broadcastId}/evaluation_form_responses`,
        `/broadcasts/${broadcastId}/evaluations`,
      ];
      for (const path of nestedPaths) {
        const pathHit = { value: false };
        const res = await wgGet(path, { per_page: 250, page: 1 });
        const added = await ingestEvaluationApiPage(merged, sources, path, res, subscriptionById, pathHit);
        if (added > 0) break;
      }
      if (merged.size > 0 && !input?.broadcastId) break;
    }
  }

  return {
    rows: [...merged.values()],
    sources,
    api_connected: true,
    api_status: account.status,
    probes,
  };
}

function unixMsFromSubscription(sub: Record<string, unknown>): number | null {
  const broadcast = sub.broadcast && typeof sub.broadcast === 'object'
    ? sub.broadcast as Record<string, unknown>
    : null;
  const candidates = [
    sub.watched_true_set_at,
    sub.watch_end,
    sub.updated_at,
    sub.created_at,
    broadcast?.date,
  ];
  let best: number | null = null;
  for (const value of candidates) {
    const ms = parseSubmittedAt(value);
    if (!ms) continue;
    const n = Date.parse(ms);
    if (!Number.isFinite(n)) continue;
    if (best == null || n > best) best = n;
  }
  return best;
}

function normalizePhoneDigits(value: unknown): string | null {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

/** Pull evaluation answers per recent watched subscription (WebinarGeek bulk endpoints are often empty). */
export async function fetchRecentQuestionnaireRowsFromSubscriptions(
  wgGet: WgGetFn,
  subscriptions: Array<Record<string, unknown>>,
  input?: { sinceMs?: number | null; maxSubscriptions?: number },
): Promise<{ rows: NormalizedWgQuestionnaireRow[]; sources: string[]; scanned: number }> {
  const sinceMs = input?.sinceMs ?? (Date.now() - 15 * 24 * 60 * 60 * 1000);
  const maxSubscriptions = input?.maxSubscriptions ?? 300;
  const subscriptionById = new Map<string, Record<string, unknown>>();
  for (const row of subscriptions) {
    const id = pickString(row.id);
    if (id) subscriptionById.set(id, row);
  }

  const candidates = subscriptions
    .filter((sub) => {
      const eventMs = unixMsFromSubscription(sub);
      if (eventMs != null && eventMs < sinceMs) return false;
      return true;
    })
    .sort((a, b) => {
      const aHas = answersFromEvaluationFormAnswers(a.evaluation_form_answers).length ? 1 : 0;
      const bHas = answersFromEvaluationFormAnswers(b.evaluation_form_answers).length ? 1 : 0;
      if (bHas !== aHas) return bHas - aHas;
      return (unixMsFromSubscription(b) ?? 0) - (unixMsFromSubscription(a) ?? 0);
    })
    .slice(0, maxSubscriptions);

  const merged = new Map<string, NormalizedWgQuestionnaireRow>();
  const sources: string[] = [];

  const nestedSuffixes = [
    'evaluation_form_results',
    'evaluation_form_responses',
    'evaluations',
  ];

  for (const sub of candidates) {
    const subId = pickString(sub.id);
    if (!subId) continue;

    const evalAnswers = answersFromEvaluationFormAnswers(sub.evaluation_form_answers);
    if (evalAnswers.length) {
      const normalized = normalizeEvaluationRow(
        {
          ...sub,
          answers: evalAnswers,
          submitted_at: sub.watched_true_set_at || sub.watch_end || sub.updated_at || sub.created_at,
        },
        'subscription_evaluation_form_answers',
        subscriptionById,
      );
      if (normalized?.answers.length) {
        normalized.wg_submission_key = `subscription_evaluation_form_answers:${subId}`;
        normalized.watched = sub.watched === true;
        normalized.watch_duration_seconds = watchSecondsFromSubscription(sub);
        merged.set(normalized.wg_submission_key, normalized);
        if (!sources.includes('subscription_evaluation_form_answers')) {
          sources.push('subscription_evaluation_form_answers');
        }
        continue;
      }
    }

    const inlineAnswers = answersFromRow(sub);
    if (inlineAnswers.length) {
      const normalized = normalizeEvaluationRow(
        { ...sub, answers: inlineAnswers },
        'subscription_inline',
        subscriptionById,
      );
      if (normalized?.answers.length) {
        normalized.wg_submission_key = `subscription_inline:${subId}`;
        normalized.watched = sub.watched === true;
        normalized.watch_duration_seconds = watchSecondsFromSubscription(sub);
        merged.set(normalized.wg_submission_key, normalized);
        if (!sources.includes('subscription_inline')) sources.push('subscription_inline');
      }
    }

    for (const suffix of nestedSuffixes) {
      const path = `/subscriptions/${subId}/${suffix}`;
      const res = await wgGet(path, { per_page: 50 });
      if (!res.ok) continue;
      const rawRows = rowsFromJsonArray(res.json, [
        suffix,
        'evaluation_form_results',
        'evaluation_form_responses',
        'evaluations',
        'results',
        'data',
      ]);
      if (!rawRows.length && res.json && typeof res.json === 'object') {
        const single = normalizeEvaluationRow(
          { ...res.json, subscription_id: subId, email: (res.json as Record<string, unknown>).email ?? sub.email },
          `subscription_${suffix}`,
          subscriptionById,
        );
        if (single?.answers.length) {
          single.wg_submission_key = `subscription_${suffix}:${subId}`;
          merged.set(single.wg_submission_key, single);
          if (!sources.includes(path)) sources.push(path);
        }
      }
      for (const rawRow of rawRows) {
        const normalized = normalizeEvaluationRow(
          {
            ...rawRow,
            subscription_id: subId,
            email: rawRow.email ?? sub.email,
            firstname: rawRow.firstname ?? sub.firstname,
            surname: rawRow.surname ?? sub.surname,
            phone: rawRow.phone ?? sub.phone ?? sub.telephone,
            custom_field: rawRow.custom_field ?? sub.custom_field,
          },
          `subscription_${suffix}`,
          subscriptionById,
        );
        if (!normalized?.answers.length) continue;
        normalized.watched = sub.watched === true;
        normalized.watch_duration_seconds = watchSecondsFromSubscription(sub);
        merged.set(normalized.wg_submission_key, normalized);
        if (!sources.includes(path)) sources.push(path);
      }
      if (rawRows.length) break;
    }
  }

  return { rows: [...merged.values()], sources, scanned: candidates.length };
}

function normalizedRowFromStoredSubmission(stored: Record<string, unknown>): NormalizedWgQuestionnaireRow {
  const answers = Array.isArray(stored.answers) ? stored.answers as WgQuestionnaireAnswer[] : [];
  return {
    wg_submission_key: String(stored.wg_submission_key || stored.id),
    subscription_id: pickString(stored.subscription_id),
    webinar_id: pickString(stored.webinar_id),
    broadcast_id: pickString(stored.broadcast_id),
    webinar_title: pickString(stored.webinar_title),
    broadcast_title: pickString(stored.broadcast_title),
    email: pickString(stored.email),
    first_name: pickString(stored.first_name),
    last_name: pickString(stored.last_name),
    phone: pickString(stored.phone),
    submitted_at: pickString(stored.submitted_at),
    answers,
    raw_payload: (stored.raw_payload && typeof stored.raw_payload === 'object'
      ? stored.raw_payload
      : {}) as Record<string, unknown>,
    recruiter_custom_field: pickString(stored.recruiter_custom_field),
    source: String(stored.source_type || 'rematch'),
    watched: stored.watched === true ? true : stored.watched === false ? false : null,
    watch_duration_seconds: Number.isFinite(Number(stored.watch_duration_seconds))
      ? Number(stored.watch_duration_seconds)
      : null,
  };
}

export async function rematchStoredQuestionnaireRows(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  input: {
    sinceIso: string;
    limit?: number;
    onlyUnmatched?: boolean;
    email?: string | null;
    phone?: string | null;
    notifyOnNewMatch?: boolean;
  },
): Promise<{ updated: number; matchedPipeline: number; newlyMatched: number }> {
  const limit = Math.min(Math.max(input.limit ?? 500, 1), 1000);
  let query = admin
    .from('webinar_geek_questionnaire_submissions')
    .select('*')
    .gte('submitted_at', input.sinceIso)
    .order('submitted_at', { ascending: false })
    .limit(limit);
  if (input.onlyUnmatched) {
    query = query.is('pipeline_candidate_id', null);
  }
  const emailFilter = normalizeEmail(input.email);
  if (emailFilter) {
    query = query.ilike('email', emailFilter);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  let rows = (data || []) as Array<Record<string, unknown>>;
  const phoneFilter = normalizePhoneDigits(input.phone);
  if (phoneFilter) {
    rows = rows.filter((stored) => normalizePhoneDigits(pickString(stored.phone)) === phoneFilter);
  }
  if (!rows.length) return { updated: 0, matchedPipeline: 0, newlyMatched: 0 };

  const matchContext = await buildQuestionnaireMatchContext(admin);
  let updated = 0;
  let matchedPipeline = 0;
  let newlyMatched = 0;
  const syncedAt = new Date().toISOString();

  for (const stored of rows) {
    const hadPipeline = Boolean(stored.pipeline_candidate_id);
    const normalized = normalizedRowFromStoredSubmission(stored);
    const match = matchQuestionnaireRowWithContext(normalized, matchContext);
    const { error: upErr } = await admin
      .from('webinar_geek_questionnaire_submissions')
      .update({
        pipeline_candidate_id: match.pipeline_candidate_id,
        journey_candidate_id: match.journey_candidate_id,
        booked_by_user_id: match.booked_by_user_id,
        booked_by_label: match.booked_by_label,
        recruiter_custom_field: match.recruiter_custom_field,
        match_method: match.match_method,
        updated_at: syncedAt,
      })
      .eq('id', stored.id);
    if (upErr) continue;
    updated += 1;
    if (match.pipeline_candidate_id) matchedPipeline += 1;
    if (input.notifyOnNewMatch && !hadPipeline && match.pipeline_candidate_id) {
      newlyMatched += 1;
      await notifyQuestionnaireSubmission(admin, normalized, match, String(stored.id));
    }
  }

  return { updated, matchedPipeline, newlyMatched };
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
    const subId = pickString(sub.id) || 'unknown';
    const evalAnswers = answersFromEvaluationFormAnswers(sub.evaluation_form_answers);
    if (evalAnswers.length) {
      const normalized = normalizeEvaluationRow(
        {
          ...sub,
          answers: evalAnswers,
          submitted_at: sub.watched_true_set_at || sub.watch_end || sub.updated_at || sub.created_at,
        },
        'subscription_evaluation_form_answers',
        subscriptionById,
      );
      if (normalized) {
        normalized.wg_submission_key = `subscription_evaluation_form_answers:${subId}`;
        normalized.answers = evalAnswers;
        normalized.watched = sub.watched === true;
        normalized.watch_duration_seconds = watchSecondsFromSubscription(sub);
        merged.set(normalized.wg_submission_key, normalized);
      }
      continue;
    }

    const extra = sub.extra_fields && typeof sub.extra_fields === 'object'
      ? sub.extra_fields as Record<string, unknown>
      : null;
    if (!extra) continue;
    const answers = questionnaireLikeExtraFields(extra);
    if (!answers.length) continue;
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
  pipelineByPhone: Map<string, string>;
  journeyByPhone: Map<string, string>;
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
  const pipelineByPhone = new Map<string, string>();
  const journeyByPhone = new Map<string, string>();
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
    admin.from('pipeline_candidates').select('id, email, phone').not('email', 'is', null).limit(8000),
    admin.from('candidates').select('id, email, phone').not('email', 'is', null).limit(8000),
    admin.from('webinar_geek_portal_bookings').select('candidate_email, broadcast_id, booked_by_user_id, booked_by_label, custom_field, created_at').eq('status', 'booked').order('created_at', { ascending: false }).limit(8000),
    admin.from('pipeline_user_call_settings').select('user_id, webinar_geek_custom_field').not('webinar_geek_custom_field', 'is', null),
    admin.from('user_profiles').select('user_id, full_name, email'),
  ]);

  for (const row of pipelineRows || []) {
    const email = normalizeEmail(row.email);
    if (email && !pipelineByEmail.has(email)) pipelineByEmail.set(email, String(row.id));
    const phone = normalizePhoneDigits(row.phone);
    if (phone && !pipelineByPhone.has(phone)) pipelineByPhone.set(phone, String(row.id));
  }
  for (const row of journeyRows || []) {
    const email = normalizeEmail(row.email);
    if (email && !journeyByEmail.has(email)) journeyByEmail.set(email, String(row.id));
    const phone = normalizePhoneDigits(row.phone);
    if (phone && !journeyByPhone.has(phone)) journeyByPhone.set(phone, String(row.id));
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
    pipelineByPhone,
    journeyByPhone,
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

  const phoneKey = normalizePhoneDigits(row.phone);
  if (phoneKey) {
    if (!pipelineCandidateId) {
      const pipelineId = context.pipelineByPhone.get(phoneKey);
      if (pipelineId) {
        pipelineCandidateId = pipelineId;
        matchMethod = matchMethod ? `${matchMethod}+pipeline_phone` : 'pipeline_phone';
      }
    }
    if (!journeyCandidateId) {
      const journeyId = context.journeyByPhone.get(phoneKey);
      if (journeyId) {
        journeyCandidateId = journeyId;
        matchMethod = matchMethod ? `${matchMethod}+journey_phone` : 'journey_phone';
      }
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
    pipelineByPhone: new Map(),
    journeyByPhone: new Map(),
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

function webhookPayloadCandidates(body: Record<string, unknown>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const push = (value: unknown) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out.push(value as Record<string, unknown>);
    }
  };
  push(body);
  push(body.data);
  push(body.payload);
  push(body.entity);
  if (body.entity && typeof body.entity === 'object') {
    out.push({ ...(body.entity as Record<string, unknown>), ...body });
  }
  push(body.evaluation_form_answers);
  push(body.evaluation);
  push(body.evaluation_form_result);
  push(body.evaluation_form_response);
  push(body.evaluation_form);
  push(body.result);
  if (body.subscription && typeof body.subscription === 'object') {
    out.push({ ...(body.subscription as Record<string, unknown>) });
    out.push({ ...(body.subscription as Record<string, unknown>), ...body });
  }
  return out;
}

/** Parse a WebinarGeek webhook / Zapier payload into a normalized questionnaire row. */
export function normalizeQuestionnaireWebhookPayload(
  body: Record<string, unknown>,
): NormalizedWgQuestionnaireRow | null {
  for (const candidate of webhookPayloadCandidates(body)) {
    const normalized = normalizeEvaluationRow(candidate, 'wg_webhook', new Map());
    if (!normalized || !normalized.answers.length) continue;
    const idPart = pickString(candidate.id, candidate.uuid, candidate.evaluation_id, candidate.response_id)
      || `${normalized.email || 'unknown'}|${normalized.submitted_at || new Date().toISOString()}`;
    normalized.wg_submission_key = `wg_webhook:${idPart}`;
    normalized.submitted_at = normalized.submitted_at || new Date().toISOString();
    return normalized;
  }
  return null;
}

async function upsertStaffNotification(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  row: Record<string, unknown>,
): Promise<void> {
  const userId = row.user_id as string | null;
  const dedupeKey = row.dedupe_key as string | null;
  if (userId && dedupeKey) {
    const { data: existing } = await admin
      .from('staff_notifications')
      .select('id')
      .eq('user_id', userId)
      .eq('dedupe_key', dedupeKey)
      .is('dismissed_at', null)
      .maybeSingle();
    if (existing?.id) {
      await admin.from('staff_notifications').update({
        title: row.title,
        body: row.body,
        link_route: row.link_route,
        link_label: row.link_label,
        metadata: row.metadata,
      }).eq('id', existing.id);
      return;
    }
  }
  await admin.from('staff_notifications').insert(row);
}

export async function notifyQuestionnaireSubmission(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  row: NormalizedWgQuestionnaireRow,
  match: QuestionnaireMatchResult,
  submissionId?: string | null,
): Promise<void> {
  const name = [row.first_name, row.last_name].map((v) => String(v || '').trim()).filter(Boolean).join(' ')
    || row.email
    || 'A webinar attendee';
  const dedupeBase = row.wg_submission_key;
  const linkRoute = match.pipeline_candidate_id
    ? `/pipeline/call?candidateId=${match.pipeline_candidate_id}`
    : '/webinar-questionnaires';

  if (match.booked_by_user_id) {
    await upsertStaffNotification(admin, {
      user_id: match.booked_by_user_id,
      category: 'system',
      title: 'Webinar questionnaire submitted',
      body: `${name} completed the post-webinar questionnaire.`,
      link_route: linkRoute,
      link_label: 'Open lead',
      dedupe_key: `wg_questionnaire:${dedupeBase}`,
      metadata: {
        wg_submission_key: row.wg_submission_key,
        submission_id: submissionId ?? null,
        email: row.email,
      },
    });
  }

  await upsertStaffNotification(admin, {
    user_id: null,
    target_roles: ['admin', 'leadership', 'hr', 'webinar'],
    category: 'system',
    title: 'New webinar questionnaire',
    body: `${name}${match.booked_by_label ? ` · booked by ${match.booked_by_label}` : ''}${
      match.pipeline_candidate_id ? '' : ' · not yet linked to pipeline'
    } submitted evaluation responses.`,
    link_route: '/webinar-questionnaires',
    link_label: 'Review answers',
    dedupe_key: `wg_questionnaire_broadcast:${dedupeBase}`,
    metadata: {
      wg_submission_key: row.wg_submission_key,
      submission_id: submissionId ?? null,
      booked_by_user_id: match.booked_by_user_id,
      matched_pipeline: Boolean(match.pipeline_candidate_id),
    },
  });
}

/** Parse Google Apps Script webhook payload (post-webinar Google Form). */
export function normalizeGoogleFormWebhookPayload(
  body: Record<string, unknown>,
): NormalizedWgQuestionnaireRow | null {
  const source = String(body.source || 'google_form').toLowerCase();
  if (source !== 'google_form') return null;

  let answers: WgQuestionnaireAnswer[] = [];
  if (Array.isArray(body.answers)) {
    answers = (body.answers as unknown[])
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const item = entry as Record<string, unknown>;
        const question = pickString(item.question, item.title, item.label) || 'Question';
        const answer = pickString(item.answer, item.value, item.response);
        if (!answer) return null;
        return {
          question,
          answer,
          field_key: pickString(item.field_key, item.key),
        };
      })
      .filter((x): x is WgQuestionnaireAnswer => x !== null);
  }
  if (!answers.length) answers = answersFromObject(body);
  if (!answers.length) return null;

  const responseId = pickString(body.response_id, body.responseId, body.id);
  const formId = pickString(body.form_id, body.formId) || 'form';
  const email = pickString(body.email, body.Email);
  const submittedAt = parseSubmittedAt(body.submitted_at ?? body.submittedAt ?? body.timestamp);

  return {
    wg_submission_key: `google_form:${formId}:${responseId || `${email || 'unknown'}|${submittedAt || new Date().toISOString()}`}`,
    subscription_id: null,
    webinar_id: null,
    broadcast_id: null,
    webinar_title: pickString(body.form_title, body.formTitle, body.webinar_title),
    broadcast_title: null,
    email,
    first_name: pickString(body.first_name, body.firstName, body.firstname),
    last_name: pickString(body.last_name, body.lastName, body.lastname, body.surname),
    phone: pickString(body.phone, body.Phone, body.mobile, body.telephone),
    submitted_at: submittedAt || new Date().toISOString(),
    answers,
    raw_payload: body,
    recruiter_custom_field: pickString(body.recruiter_custom_field, body.recruiter, body.custom_field),
    source: 'google_form',
  };
}

async function processIncomingQuestionnaireRow(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  row: NormalizedWgQuestionnaireRow,
  sourceType: string,
): Promise<{
  ok: boolean;
  upserted: boolean;
  submission_id?: string;
  matched_pipeline: boolean;
  error?: string;
}> {
  const matchContext = await buildQuestionnaireMatchContext(admin);
  const match = matchQuestionnaireRowWithContext(row, matchContext);
  const syncedAt = new Date().toISOString();
  const payload = buildQuestionnaireUpsertPayload(row, match, {
    sourceType,
    syncedAt,
  });

  const { data, error } = await admin
    .from('webinar_geek_questionnaire_submissions')
    .upsert(payload, { onConflict: 'wg_submission_key' })
    .select('id')
    .maybeSingle();

  if (error) {
    if (isMissingQuestionnaireTableError(error)) {
      throw new Error(
        'Database table webinar_geek_questionnaire_submissions is missing. Run paste_webinar_geek_questionnaires.sql first.',
      );
    }
    throw new Error(error.message);
  }

  const submissionId = data?.id ? String(data.id) : undefined;
  await notifyQuestionnaireSubmission(admin, row, match, submissionId);

  return {
    ok: true,
    upserted: true,
    submission_id: submissionId,
    matched_pipeline: Boolean(match.pipeline_candidate_id),
  };
}

export async function processIncomingQuestionnaireWebhook(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  body: Record<string, unknown>,
): Promise<{
  ok: boolean;
  upserted: boolean;
  submission_id?: string;
  matched_pipeline: boolean;
  error?: string;
}> {
  const row = normalizeQuestionnaireWebhookPayload(body);
  if (!row) {
    return { ok: false, upserted: false, matched_pipeline: false, error: 'No questionnaire answers in webhook payload' };
  }
  return processIncomingQuestionnaireRow(admin, row, 'wg_webhook');
}

export async function processIncomingGoogleFormWebhook(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  body: Record<string, unknown>,
): Promise<{
  ok: boolean;
  upserted: boolean;
  submission_id?: string;
  matched_pipeline: boolean;
  error?: string;
}> {
  const row = normalizeGoogleFormWebhookPayload(body);
  if (!row) {
    return { ok: false, upserted: false, matched_pipeline: false, error: 'No Google Form answers in webhook payload' };
  }
  return processIncomingQuestionnaireRow(admin, row, 'google_form');
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
