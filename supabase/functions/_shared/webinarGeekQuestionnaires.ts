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

function normalizePersonNameKey(first: unknown, last: unknown): string | null {
  const parts = [first, last].map((v) => String(v || '').trim().toLowerCase()).filter(Boolean);
  if (!parts.length) return null;
  return parts.join(' ').replace(/\s+/g, ' ');
}

type PipelineCandidateLookupRow = {
  id: string;
  email?: string | null;
  phone?: string | null;
  full_name?: string | null;
  uploader_user_id?: string | null;
  uploader_label?: string | null;
};

function personNameKeyFromFullName(fullName: unknown): string | null {
  const parts = String(fullName || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  return parts.join(' ').replace(/\s+/g, ' ');
}

function indexPipelineCandidateRow(
  row: PipelineCandidateLookupRow,
  pipelineByEmail: Map<string, string>,
  pipelineByPhone: Map<string, string>,
  pipelineByName: Map<string, string>,
  pipelineUploaderById?: Map<string, { user_id: string | null; label: string | null }>,
): void {
  const id = String(row.id);
  const email = normalizeEmail(row.email);
  if (email && !pipelineByEmail.has(email)) pipelineByEmail.set(email, id);
  const phone = normalizePhoneDigits(row.phone);
  if (phone && !pipelineByPhone.has(phone)) pipelineByPhone.set(phone, id);
  const nameKey = personNameKeyFromFullName(row.full_name);
  if (nameKey && !pipelineByName.has(nameKey)) pipelineByName.set(nameKey, id);
  if (pipelineUploaderById) {
    const uploaderId = pickString(row.uploader_user_id);
    if (uploaderId || row.uploader_label) {
      pipelineUploaderById.set(id, {
        user_id: uploaderId,
        label: pickString(row.uploader_label),
      });
    }
  }
}

function pipelineNameSearchOrFilter(
  firstName: string | null,
  lastName: string | null,
  nameKey: string | null,
): string | null {
  const clauses: string[] = [];
  const first = String(firstName || '').trim();
  const last = String(lastName || '').trim();
  if (first && last) {
    clauses.push(`full_name.ilike.%${first}%${last}%`);
    clauses.push(`full_name.ilike.%${last}%${first}%`);
  }
  const key = nameKey || normalizePersonNameKey(firstName, lastName);
  if (key) {
    const parts = key.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      clauses.push(`full_name.ilike.%${parts[0]}%${parts.slice(1).join('%')}%`);
    } else if (parts.length === 1) {
      clauses.push(`full_name.ilike.%${parts[0]}%`);
    }
  }
  if (!clauses.length) return null;
  return [...new Set(clauses)].join(',');
}

async function fetchPipelineCandidatesByEmail(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  email: string,
): Promise<PipelineCandidateLookupRow[]> {
  const { data } = await admin
    .from('pipeline_candidates')
    .select('id, email, phone, full_name, uploader_user_id, uploader_label')
    .ilike('email', email)
    .limit(10);
  return (data || []) as PipelineCandidateLookupRow[];
}

async function fetchPipelineCandidatesByPhone(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  phone: string,
): Promise<PipelineCandidateLookupRow[]> {
  const last10 = normalizePhoneDigits(phone);
  if (!last10) return [];
  const { data } = await admin
    .from('pipeline_candidates')
    .select('id, email, phone, full_name, uploader_user_id, uploader_label')
    .or(`phone_last10.eq.${last10},phone.ilike.%${last10}%`)
    .limit(10);
  return (data || []) as PipelineCandidateLookupRow[];
}

async function fetchPipelineCandidatesByName(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  firstName: string | null,
  lastName: string | null,
  nameKey: string | null,
): Promise<PipelineCandidateLookupRow[]> {
  const orFilter = pipelineNameSearchOrFilter(firstName, lastName, nameKey);
  if (!orFilter) return [];
  const { data } = await admin
    .from('pipeline_candidates')
    .select('id, email, phone, full_name, uploader_user_id, uploader_label')
    .or(orFilter)
    .limit(10);
  return (data || []) as PipelineCandidateLookupRow[];
}

function indexPipelineCandidateRows(
  rows: PipelineCandidateLookupRow[],
  pipelineByEmail: Map<string, string>,
  pipelineByPhone: Map<string, string>,
  pipelineByName: Map<string, string>,
  pipelineUploaderById?: Map<string, { user_id: string | null; label: string | null }>,
): void {
  for (const row of rows) {
    indexPipelineCandidateRow(row, pipelineByEmail, pipelineByPhone, pipelineByName, pipelineUploaderById);
  }
}

const QUESTIONNAIRE_WG_GO_LIVE_ISO = '2026-06-16T00:00:00.000Z';

type WgSnapshotRow = Record<string, unknown>;

function wgNameKeyFromSnapshotRow(row: WgSnapshotRow): string | null {
  return normalizePersonNameKey(row.firstname ?? row.first_name, row.surname ?? row.last_name);
}

function wgPhoneFromSnapshotRow(row: WgSnapshotRow): string | null {
  return normalizePhoneDigits(row.phone ?? row.telephone ?? row.mobile);
}

function wgWatchSecondsFromSnapshotRow(row: WgSnapshotRow): number | null {
  const sec = Number(row.watch_duration ?? row.watch_duration_seconds ?? 0);
  return Number.isFinite(sec) && sec > 0 ? sec : null;
}

async function loadWgSnapshotSubscriptions(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
): Promise<WgSnapshotRow[]> {
  const { data } = await admin
    .from('webinar_geek_dashboard_snapshots')
    .select('subscriptions')
    .eq('id', 'latest')
    .maybeSingle();
  const raw = data?.subscriptions;
  if (Array.isArray(raw)) return raw as WgSnapshotRow[];
  if (raw && typeof raw === 'object' && Array.isArray((raw as WgSnapshotRow).subscriptions)) {
    return (raw as WgSnapshotRow).subscriptions as WgSnapshotRow[];
  }
  return [];
}

function findBestWgSubscriptionForRow(
  subs: WgSnapshotRow[],
  row: NormalizedWgQuestionnaireRow,
): WgSnapshotRow | null {
  const email = normalizeEmail(row.email);
  const phone = normalizePhoneDigits(row.phone);
  const nameKey = normalizePersonNameKey(row.first_name, row.last_name);
  const goLiveMs = Date.parse(QUESTIONNAIRE_WG_GO_LIVE_ISO);
  const matches: WgSnapshotRow[] = [];

  for (const sub of subs) {
    const subEmail = normalizeEmail(sub.email);
    const subPhone = wgPhoneFromSnapshotRow(sub);
    const subName = wgNameKeyFromSnapshotRow(sub);
    const touched = (email && subEmail === email)
      || (phone && subPhone && phone === subPhone)
      || (nameKey && subName && nameKey === subName);
    if (!touched) continue;

    const activityMs = Date.parse(String(sub.watched_true_set_at || sub.watch_end || sub.updated_at || sub.created_at || ''));
    if (Number.isFinite(activityMs) && activityMs < goLiveMs) continue;
    matches.push(sub);
  }

  if (!matches.length) return null;
  matches.sort((a, b) => {
    const aw = a.watched === true ? 1 : 0;
    const bw = b.watched === true ? 1 : 0;
    if (bw !== aw) return bw - aw;
    const aSec = wgWatchSecondsFromSnapshotRow(a) || 0;
    const bSec = wgWatchSecondsFromSnapshotRow(b) || 0;
    if (bSec !== aSec) return bSec - aSec;
    return Date.parse(String(b.updated_at || b.created_at || '')) - Date.parse(String(a.updated_at || a.created_at || ''));
  });
  return matches[0] ?? null;
}

function appendMatchMethod(current: string | null, next: string): string {
  if (!current) return next;
  if (current.includes(next)) return current;
  return `${current}+${next}`;
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

function answerLooksLikeNameField(question: string): 'first' | 'last' | 'full' | null {
  const q = String(question || '').trim().toLowerCase();
  if (!q) return null;
  if (/full\s*name/.test(q) || q === 'name') return 'full';
  if (/first\s*name|given\s*name/.test(q)) return 'first';
  if (/last\s*name|surname|family\s*name/.test(q)) return 'last';
  return null;
}

function questionnaireDisplayName(row: NormalizedWgQuestionnaireRow): string {
  let firstName = pickString(row.first_name);
  let lastName = pickString(row.last_name);
  let fullFromAnswers = '';

  for (const answer of row.answers) {
    const kind = answerLooksLikeNameField(answer.question);
    const value = pickString(answer.answer);
    if (!value || !kind) continue;
    if (kind === 'full') fullFromAnswers = value;
    if (kind === 'first' && !firstName) firstName = value;
    if (kind === 'last' && !lastName) lastName = value;
  }

  const fromFields = [firstName, lastName].map((part) => String(part || '').trim()).filter(Boolean).join(' ');
  if (fromFields) return fromFields;
  if (fullFromAnswers) return fullFromAnswers;

  const email = normalizeEmail(row.email);
  if (email) {
    const local = email.split('@')[0]?.replace(/[._+-]+/g, ' ').trim();
    if (local) return local.replace(/\b\w/g, (ch) => ch.toUpperCase());
  }

  return 'Questionnaire lead';
}

async function resolveExistingPipelineCandidateId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  row: NormalizedWgQuestionnaireRow,
): Promise<string | null> {
  const email = normalizeEmail(row.email);
  if (email) {
    const byEmail = await fetchPipelineCandidatesByEmail(admin, email);
    if (byEmail[0]?.id) return String(byEmail[0].id);
  }

  const phoneDigits = normalizePhoneDigits(row.phone);
  if (phoneDigits) {
    const byPhone = await fetchPipelineCandidatesByPhone(admin, phoneDigits);
    if (byPhone[0]?.id) return String(byPhone[0].id);
  }

  const byName = await fetchPipelineCandidatesByName(
    admin,
    row.first_name,
    row.last_name,
    normalizePersonNameKey(row.first_name, row.last_name),
  );
  if (byName[0]?.id) return String(byName[0].id);

  return null;
}

async function enrichPipelineCandidateFromQuestionnaire(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  candidateId: string,
  row: NormalizedWgQuestionnaireRow,
  match: QuestionnaireMatchResult,
  sourceType: string,
): Promise<void> {
  const { data: existing, error } = await admin
    .from('pipeline_candidates')
    .select('email, phone, full_name, metadata, uploader_user_id, uploader_label')
    .eq('id', candidateId)
    .maybeSingle();
  if (error || !existing) return;

  const currentMeta = existing.metadata && typeof existing.metadata === 'object'
    ? existing.metadata as Record<string, unknown>
    : {};
  const displayName = questionnaireDisplayName(row);
  const updates: Record<string, unknown> = {
    metadata: {
      ...currentMeta,
      questionnaire_linked_at: new Date().toISOString(),
      questionnaire_source_type: sourceType,
      wg_submission_key: row.wg_submission_key,
      webinar_title: row.webinar_title ?? currentMeta.webinar_title ?? null,
      questionnaire_submitted_at: row.submitted_at ?? currentMeta.questionnaire_submitted_at ?? null,
      questionnaire_answers: row.answers.slice(0, 40),
      recruiter_custom_field: match.recruiter_custom_field ?? row.recruiter_custom_field ?? null,
    },
    updated_at: new Date().toISOString(),
  };

  if (!pickString(existing.email) && normalizeEmail(row.email)) {
    updates.email = normalizeEmail(row.email);
  }
  if (!pickString(existing.phone) && pickString(row.phone)) {
    updates.phone = pickString(row.phone);
  }
  if (!pickString(existing.full_name) && displayName) {
    updates.full_name = displayName;
  }
  if (!existing.uploader_user_id && match.booked_by_user_id) {
    updates.uploader_user_id = match.booked_by_user_id;
    updates.uploader_label = match.booked_by_label ?? null;
  }

  await admin.from('pipeline_candidates').update(updates).eq('id', candidateId);
}

async function createPipelineCandidateFromQuestionnaire(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  row: NormalizedWgQuestionnaireRow,
  match: QuestionnaireMatchResult,
  sourceType: string,
): Promise<string | null> {
  const email = normalizeEmail(row.email) || null;
  const phone = pickString(row.phone);
  const phoneDigits = normalizePhoneDigits(phone);
  if (!email && !phoneDigits) return null;

  const fullName = questionnaireDisplayName(row);
  const nowIso = new Date().toISOString();
  const insertRow = {
    full_name: fullName,
    email,
    phone: phone || null,
    source: 'webinar_questionnaire',
    journey_stage: 'new',
    status: 'open',
    uploader_user_id: match.booked_by_user_id ?? null,
    uploader_label: match.booked_by_label ?? null,
    metadata: {
      questionnaire_auto_created: true,
      questionnaire_auto_created_at: nowIso,
      questionnaire_source_type: sourceType,
      wg_submission_key: row.wg_submission_key,
      webinar_title: row.webinar_title ?? null,
      broadcast_title: row.broadcast_title ?? null,
      questionnaire_submitted_at: row.submitted_at ?? null,
      questionnaire_answers: row.answers.slice(0, 40),
      recruiter_custom_field: match.recruiter_custom_field ?? row.recruiter_custom_field ?? null,
    },
    updated_at: nowIso,
  };

  const { data, error } = await admin
    .from('pipeline_candidates')
    .insert(insertRow)
    .select('id')
    .single();

  if (error) {
    const duplicate = /duplicate|unique/i.test(String(error.message || ''));
    if (duplicate) {
      return resolveExistingPipelineCandidateId(admin, row);
    }
    throw new Error(`create pipeline candidate from questionnaire: ${error.message}`);
  }

  return data?.id ? String(data.id) : null;
}

export async function ensureQuestionnairePipelineLink(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  row: NormalizedWgQuestionnaireRow,
  match: QuestionnaireMatchResult,
  sourceType: string,
): Promise<QuestionnaireMatchResult> {
  if (match.pipeline_candidate_id) {
    await enrichPipelineCandidateFromQuestionnaire(admin, match.pipeline_candidate_id, row, match, sourceType);
    return match;
  }

  const email = normalizeEmail(row.email);
  const phoneDigits = normalizePhoneDigits(row.phone);
  if (!email && !phoneDigits) return match;

  let pipelineCandidateId = await resolveExistingPipelineCandidateId(admin, row);
  let matchMethod = match.match_method;

  if (pipelineCandidateId) {
    matchMethod = appendMatchMethod(matchMethod, 'pipeline_existing_lookup');
  } else {
    pipelineCandidateId = await createPipelineCandidateFromQuestionnaire(admin, row, match, sourceType);
    if (!pipelineCandidateId) return match;
    matchMethod = appendMatchMethod(matchMethod, 'pipeline_auto_created');
  }

  const linkedMatch: QuestionnaireMatchResult = {
    ...match,
    pipeline_candidate_id: pipelineCandidateId,
    match_method: matchMethod,
  };

  if (!linkedMatch.booked_by_user_id && linkedMatch.pipeline_candidate_id) {
    const { data: candidate } = await admin
      .from('pipeline_candidates')
      .select('uploader_user_id, uploader_label')
      .eq('id', linkedMatch.pipeline_candidate_id)
      .maybeSingle();
    if (candidate?.uploader_user_id) {
      linkedMatch.booked_by_user_id = String(candidate.uploader_user_id);
      linkedMatch.booked_by_label = pickString(candidate.uploader_label, linkedMatch.booked_by_label);
      linkedMatch.match_method = appendMatchMethod(linkedMatch.match_method, 'pipeline_uploader');
    }
  }

  await enrichPipelineCandidateFromQuestionnaire(admin, pipelineCandidateId, row, linkedMatch, sourceType);
  return linkedMatch;
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

  let updated = 0;
  let matchedPipeline = 0;
  let newlyMatched = 0;
  const syncedAt = new Date().toISOString();

  for (const stored of rows) {
    const hadPipeline = Boolean(stored.pipeline_candidate_id);
    const normalized = normalizedRowFromStoredSubmission(stored);
    let match = matchQuestionnaireRowWithContext(
      normalized,
      await buildQuestionnaireMatchContextForRow(admin, normalized),
    );
    match = await ensureQuestionnairePipelineLink(
      admin,
      normalized,
      match,
      String(stored.source_type || 'rematch'),
    );
    const { error: upErr } = await admin
      .from('webinar_geek_questionnaire_submissions')
      .update({
        pipeline_candidate_id: match.pipeline_candidate_id,
        journey_candidate_id: match.journey_candidate_id,
        booked_by_user_id: match.booked_by_user_id,
        booked_by_label: match.booked_by_label,
        recruiter_custom_field: match.recruiter_custom_field,
        match_method: match.match_method,
        subscription_id: match.subscription_id,
        webinar_id: match.webinar_id,
        broadcast_id: match.broadcast_id,
        webinar_title: match.webinar_title,
        broadcast_title: match.broadcast_title,
        watched: match.watched,
        watch_duration_seconds: match.watch_duration_seconds,
        hiring_stage: match.pipeline_candidate_id && normalized.answers.length
          ? 'ready_for_followup'
          : stored.hiring_stage,
        raw_payload: {
          ...(stored.raw_payload && typeof stored.raw_payload === 'object' ? stored.raw_payload as Record<string, unknown> : {}),
          wg_linked_email: match.wg_linked_email ?? null,
        },
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
  pipelineByName: Map<string, string>;
  journeyByName: Map<string, string>;
  bookingByEmailBroadcast: Map<string, Record<string, unknown>>;
  bookingByEmail: Map<string, Record<string, unknown>>;
  bookingByName: Map<string, Record<string, unknown>>;
  settingsByTag: Map<string, { user_id: string; label: string | null }>;
  pipelineUploaderById: Map<string, { user_id: string | null; label: string | null }>;
  wgBestRow: WgSnapshotRow | null;
};

async function loadBaseRecruiterSettingsByTag(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
): Promise<Map<string, { user_id: string; label: string | null }>> {
  const settingsByTag = new Map<string, { user_id: string; label: string | null }>();
  const [{ data: settingsRows }, { data: profileRows }] = await Promise.all([
    admin.from('pipeline_user_call_settings').select('user_id, webinar_geek_custom_field').not('webinar_geek_custom_field', 'is', null),
    admin.from('user_profiles').select('user_id, full_name, email'),
  ]);

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
  return settingsByTag;
}

function recruiterTagLookupKeys(rawTag: string): Set<string> {
  const tag = rawTag.trim().toLowerCase();
  const keys = new Set<string>([tag, tag.replace(/^(cooper|rms)[_\-]+/i, '')]);
  const parsed = parseBookingLinkTag(rawTag);
  if (parsed) {
    keys.add(parsed.tag.toLowerCase());
    keys.add(parsed.slug.toLowerCase());
    keys.add(parsed.slugKey.toLowerCase().replace(/\s+/g, '_'));
  }
  return keys;
}

function labelFromRecruiterCustomField(rawTag: string | null | undefined): string | null {
  const tag = pickString(rawTag);
  if (!tag) return null;
  const parsed = parseBookingLinkTag(tag);
  if (parsed) return parsed.label;
  const stripped = tag.replace(/^(cooper|rms)[_\-]+/i, '').trim();
  if (!stripped) return tag;
  return stripped
    .split(/[_\-\s]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

async function mergeSettingsByTagForCustomField(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  rawTag: string | null | undefined,
  settingsByTag: Map<string, { user_id: string; label: string | null }>,
): Promise<void> {
  const tag = pickString(rawTag);
  if (!tag) return;

  const keys = recruiterTagLookupKeys(tag);
  for (const key of keys) {
    if (settingsByTag.has(key)) return;
  }

  const { data: settingsRows } = await admin
    .from('pipeline_user_call_settings')
    .select('user_id, webinar_geek_custom_field')
    .not('webinar_geek_custom_field', 'is', null);

  const profileIds = new Set<string>();
  for (const settings of settingsRows || []) {
    const settingsTag = pickString(settings.webinar_geek_custom_field);
    if (!settingsTag) continue;
    const settingsKeys = recruiterTagLookupKeys(settingsTag);
    let matched = false;
    for (const key of keys) {
      if (settingsKeys.has(key) || settingsTag.toLowerCase() === key) {
        matched = true;
        break;
      }
    }
    if (!matched) continue;
    const userId = String(settings.user_id || '');
    if (!userId) continue;
    profileIds.add(userId);
    settingsByTag.set(settingsTag.toLowerCase(), { user_id: userId, label: null });
    for (const key of keys) {
      if (!settingsByTag.has(key)) settingsByTag.set(key, { user_id: userId, label: null });
    }
  }

  if (profileIds.size) {
    const { data: profileRows } = await admin
      .from('user_profiles')
      .select('user_id, full_name, email')
      .in('user_id', [...profileIds]);
    for (const profile of profileRows || []) {
      const userId = String(profile.user_id || '');
      if (!userId) continue;
      const label = pickString(profile.full_name, profile.email);
      for (const [mapKey, entry] of settingsByTag.entries()) {
        if (entry.user_id === userId) settingsByTag.set(mapKey, { user_id: userId, label });
      }
    }
  }
}

export async function buildQuestionnaireMatchContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
): Promise<QuestionnaireMatchContext> {
  const pipelineByEmail = new Map<string, string>();
  const journeyByEmail = new Map<string, string>();
  const pipelineByPhone = new Map<string, string>();
  const journeyByPhone = new Map<string, string>();
  const pipelineByName = new Map<string, string>();
  const journeyByName = new Map<string, string>();
  const bookingByEmailBroadcast = new Map<string, Record<string, unknown>>();
  const bookingByEmail = new Map<string, Record<string, unknown>>();
  const bookingByName = new Map<string, Record<string, unknown>>();
  const pipelineUploaderById = new Map<string, { user_id: string | null; label: string | null }>();

  const [
    { data: pipelineRows },
    { data: journeyRows },
    { data: bookingRows },
    settingsByTag,
  ] = await Promise.all([
    admin.from('pipeline_candidates').select('id, email, phone, full_name, uploader_user_id, uploader_label').limit(8000),
    admin.from('candidates').select('id, email, phone, first_name, last_name').not('email', 'is', null).limit(8000),
    admin.from('webinar_geek_portal_bookings').select('candidate_email, candidate_first_name, candidate_last_name, candidate_id, broadcast_id, booked_by_user_id, booked_by_label, custom_field, created_at').eq('status', 'booked').order('created_at', { ascending: false }).limit(8000),
    loadBaseRecruiterSettingsByTag(admin),
  ]);

  for (const row of pipelineRows || []) {
    indexPipelineCandidateRow(
      row as PipelineCandidateLookupRow,
      pipelineByEmail,
      pipelineByPhone,
      pipelineByName,
      pipelineUploaderById,
    );
  }
  for (const row of journeyRows || []) {
    const email = normalizeEmail(row.email);
    if (email && !journeyByEmail.has(email)) journeyByEmail.set(email, String(row.id));
    const phone = normalizePhoneDigits(row.phone);
    if (phone && !journeyByPhone.has(phone)) journeyByPhone.set(phone, String(row.id));
    const nameKey = normalizePersonNameKey(row.first_name, row.last_name);
    if (nameKey && !journeyByName.has(nameKey)) journeyByName.set(nameKey, String(row.id));
  }
  for (const row of bookingRows || []) {
    const email = normalizeEmail(row.candidate_email);
    if (!email) continue;
    if (!bookingByEmail.has(email)) bookingByEmail.set(email, row);
    const broadcastId = pickString(row.broadcast_id);
    const key = broadcastId ? `${email}|${broadcastId}` : email;
    if (!bookingByEmailBroadcast.has(key)) bookingByEmailBroadcast.set(key, row);
    const nameKey = normalizePersonNameKey(row.candidate_first_name, row.candidate_last_name);
    if (nameKey && !bookingByName.has(nameKey)) bookingByName.set(nameKey, row);
  }

  return {
    pipelineByEmail,
    journeyByEmail,
    pipelineByPhone,
    journeyByPhone,
    pipelineByName,
    journeyByName,
    bookingByEmailBroadcast,
    bookingByEmail,
    bookingByName,
    settingsByTag,
    pipelineUploaderById,
    wgBestRow: null,
  };
}

/** Targeted match lookups for a single webhook row (avoids scanning 8k+ rows). */
export async function buildQuestionnaireMatchContextForRow(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  row: NormalizedWgQuestionnaireRow,
): Promise<QuestionnaireMatchContext> {
  const pipelineByEmail = new Map<string, string>();
  const journeyByEmail = new Map<string, string>();
  const pipelineByPhone = new Map<string, string>();
  const journeyByPhone = new Map<string, string>();
  const pipelineByName = new Map<string, string>();
  const journeyByName = new Map<string, string>();
  const bookingByEmailBroadcast = new Map<string, Record<string, unknown>>();
  const bookingByEmail = new Map<string, Record<string, unknown>>();
  const bookingByName = new Map<string, Record<string, unknown>>();
  const settingsByTag = await loadBaseRecruiterSettingsByTag(admin);
  const pipelineUploaderById = new Map<string, { user_id: string | null; label: string | null }>();

  const email = normalizeEmail(row.email);
  const phone = normalizePhoneDigits(row.phone);
  const firstName = pickString(row.first_name);
  const lastName = pickString(row.last_name);
  const nameKey = normalizePersonNameKey(row.first_name, row.last_name);

  if (email) {
    const [{ data: journeyRows }, { data: bookingRows }, pipelineRows] = await Promise.all([
      admin.from('candidates').select('id, email, phone, first_name, last_name').ilike('email', email).limit(5),
      admin.from('webinar_geek_portal_bookings')
        .select('candidate_email, candidate_first_name, candidate_last_name, candidate_id, broadcast_id, booked_by_user_id, booked_by_label, custom_field, created_at')
        .eq('status', 'booked')
        .ilike('candidate_email', email)
        .order('created_at', { ascending: false })
        .limit(10),
      fetchPipelineCandidatesByEmail(admin, email),
    ]);
    indexPipelineCandidateRows(pipelineRows, pipelineByEmail, pipelineByPhone, pipelineByName, pipelineUploaderById);
    for (const journeyRow of journeyRows || []) {
      const em = normalizeEmail(journeyRow.email);
      if (em && !journeyByEmail.has(em)) journeyByEmail.set(em, String(journeyRow.id));
      const ph = normalizePhoneDigits(journeyRow.phone);
      if (ph && !journeyByPhone.has(ph)) journeyByPhone.set(ph, String(journeyRow.id));
      const nk = normalizePersonNameKey(journeyRow.first_name, journeyRow.last_name);
      if (nk && !journeyByName.has(nk)) journeyByName.set(nk, String(journeyRow.id));
    }
    for (const bookingRow of bookingRows || []) {
      const em = normalizeEmail(bookingRow.candidate_email);
      if (!em) continue;
      if (!bookingByEmail.has(em)) bookingByEmail.set(em, bookingRow);
      const broadcastId = pickString(bookingRow.broadcast_id);
      const key = broadcastId ? `${em}|${broadcastId}` : em;
      if (!bookingByEmailBroadcast.has(key)) bookingByEmailBroadcast.set(key, bookingRow);
      const nk = normalizePersonNameKey(bookingRow.candidate_first_name, bookingRow.candidate_last_name);
      if (nk && !bookingByName.has(nk)) bookingByName.set(nk, bookingRow);
    }
  }

  if (phone) {
    if (!pipelineByPhone.has(phone)) {
      indexPipelineCandidateRows(
        await fetchPipelineCandidatesByPhone(admin, phone),
        pipelineByEmail,
        pipelineByPhone,
        pipelineByName,
        pipelineUploaderById,
      );
    }
    if (!journeyByPhone.has(phone)) {
      const { data: journeyRows } = await admin
        .from('candidates')
        .select('id, email, phone, first_name, last_name')
        .ilike('phone', `%${phone.slice(-10)}%`)
        .limit(5);
      for (const journeyRow of journeyRows || []) {
        const ph = normalizePhoneDigits(journeyRow.phone);
        if (ph && !journeyByPhone.has(ph)) journeyByPhone.set(ph, String(journeyRow.id));
        const em = normalizeEmail(journeyRow.email);
        if (em && !journeyByEmail.has(em)) journeyByEmail.set(em, String(journeyRow.id));
        const nk = normalizePersonNameKey(journeyRow.first_name, journeyRow.last_name);
        if (nk && !journeyByName.has(nk)) journeyByName.set(nk, String(journeyRow.id));
      }
    }
  }

  if (nameKey) {
    if (!pipelineByName.has(nameKey)) {
      indexPipelineCandidateRows(
        await fetchPipelineCandidatesByName(admin, firstName, lastName, nameKey),
        pipelineByEmail,
        pipelineByPhone,
        pipelineByName,
        pipelineUploaderById,
      );
    }
    if (!journeyByName.has(nameKey)) {
      const { data: journeyRows } = await admin
        .from('candidates')
        .select('id, email, phone, first_name, last_name')
        .ilike('first_name', firstName)
        .ilike('last_name', lastName)
        .limit(5);
      for (const journeyRow of journeyRows || []) {
        const nk = normalizePersonNameKey(journeyRow.first_name, journeyRow.last_name);
        if (nk && !journeyByName.has(nk)) journeyByName.set(nk, String(journeyRow.id));
      }
    }
    if (!bookingByName.has(nameKey)) {
      const { data: bookingRows } = await admin
        .from('webinar_geek_portal_bookings')
        .select('candidate_email, candidate_first_name, candidate_last_name, broadcast_id, booked_by_user_id, booked_by_label, custom_field, created_at')
        .eq('status', 'booked')
        .ilike('candidate_first_name', firstName)
        .ilike('candidate_last_name', lastName)
        .order('created_at', { ascending: false })
        .limit(5);
      for (const bookingRow of bookingRows || []) {
        const nk = normalizePersonNameKey(bookingRow.candidate_first_name, bookingRow.candidate_last_name);
        if (nk && !bookingByName.has(nk)) bookingByName.set(nk, bookingRow);
      }
    }
  }

  if (pickString(row.recruiter_custom_field)) {
    await mergeSettingsByTagForCustomField(admin, row.recruiter_custom_field, settingsByTag);
  }

  const wgSubs = await loadWgSnapshotSubscriptions(admin);
  const wgBestRow = findBestWgSubscriptionForRow(wgSubs, row);
  if (wgBestRow) {
    const wgEmail = normalizeEmail(wgBestRow.email);
    const wgPhone = wgPhoneFromSnapshotRow(wgBestRow);
    if (wgEmail && !bookingByEmail.has(wgEmail)) {
      const { data: bookingRows } = await admin
        .from('webinar_geek_portal_bookings')
        .select('candidate_email, candidate_first_name, candidate_last_name, candidate_id, broadcast_id, booked_by_user_id, booked_by_label, custom_field, created_at')
        .eq('status', 'booked')
        .ilike('candidate_email', wgEmail)
        .order('created_at', { ascending: false })
        .limit(5);
      for (const bookingRow of bookingRows || []) {
        const em = normalizeEmail(bookingRow.candidate_email);
        if (!em) continue;
        if (!bookingByEmail.has(em)) bookingByEmail.set(em, bookingRow);
        const broadcastId = pickString(bookingRow.broadcast_id);
        const key = broadcastId ? `${em}|${broadcastId}` : em;
        if (!bookingByEmailBroadcast.has(key)) bookingByEmailBroadcast.set(key, bookingRow);
        const nk = normalizePersonNameKey(bookingRow.candidate_first_name, bookingRow.candidate_last_name);
        if (nk && !bookingByName.has(nk)) bookingByName.set(nk, bookingRow);
      }
    }
    if (wgEmail && !pipelineByEmail.has(wgEmail)) {
      indexPipelineCandidateRows(
        await fetchPipelineCandidatesByEmail(admin, wgEmail),
        pipelineByEmail,
        pipelineByPhone,
        pipelineByName,
        pipelineUploaderById,
      );
    }
    if (wgPhone && !pipelineByPhone.has(wgPhone)) {
      indexPipelineCandidateRows(
        await fetchPipelineCandidatesByPhone(admin, wgPhone),
        pipelineByEmail,
        pipelineByPhone,
        pipelineByName,
        pipelineUploaderById,
      );
    }
    const wgNameKey = wgNameKeyFromSnapshotRow(wgBestRow);
    const wgFirst = pickString(wgBestRow.firstname, wgBestRow.first_name);
    const wgLast = pickString(wgBestRow.surname, wgBestRow.last_name);
    if (wgNameKey && !pipelineByName.has(wgNameKey)) {
      indexPipelineCandidateRows(
        await fetchPipelineCandidatesByName(admin, wgFirst, wgLast, wgNameKey),
        pipelineByEmail,
        pipelineByPhone,
        pipelineByName,
        pipelineUploaderById,
      );
    }
    const wgCustomField = pickString(wgBestRow.custom_field);
    if (wgCustomField) {
      row.recruiter_custom_field = row.recruiter_custom_field || wgCustomField;
      await mergeSettingsByTagForCustomField(admin, wgCustomField, settingsByTag);
    }
  }

  return {
    pipelineByEmail,
    journeyByEmail,
    pipelineByPhone,
    journeyByPhone,
    pipelineByName,
    journeyByName,
    bookingByEmailBroadcast,
    bookingByEmail,
    bookingByName,
    settingsByTag,
    pipelineUploaderById,
    wgBestRow,
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

  const personNameKey = normalizePersonNameKey(row.first_name, row.last_name);
  if (personNameKey) {
    if (!pipelineCandidateId) {
      const pipelineId = context.pipelineByName.get(personNameKey);
      if (pipelineId) {
        pipelineCandidateId = pipelineId;
        matchMethod = matchMethod ? `${matchMethod}+pipeline_name` : 'pipeline_name';
      }
    }
    if (!journeyCandidateId) {
      const journeyId = context.journeyByName.get(personNameKey);
      if (journeyId) {
        journeyCandidateId = journeyId;
        matchMethod = matchMethod ? `${matchMethod}+journey_name` : 'journey_name';
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

  if (!bookedByUserId && personNameKey) {
    const booking = context.bookingByName.get(personNameKey) || null;
    if (booking) {
      bookedByUserId = booking.booked_by_user_id ? String(booking.booked_by_user_id) : null;
      bookedByLabel = pickString(booking.booked_by_label);
      recruiterCustomField = recruiterCustomField || pickString(booking.custom_field);
      matchMethod = matchMethod ? `${matchMethod}+portal_booking_name` : 'portal_booking_name';
      if (!pipelineCandidateId) {
        const bookingEmail = normalizeEmail(booking.candidate_email);
        if (bookingEmail) {
          const pipelineFromBookingEmail = context.pipelineByEmail.get(bookingEmail);
          if (pipelineFromBookingEmail) {
            pipelineCandidateId = pipelineFromBookingEmail;
            matchMethod = matchMethod ? `${matchMethod}+pipeline_booking_email` : 'pipeline_booking_email';
          }
        }
        const bookingCandidateId = pickString(booking.candidate_id);
        if (!pipelineCandidateId && bookingCandidateId) {
          pipelineCandidateId = bookingCandidateId;
          matchMethod = matchMethod ? `${matchMethod}+booking_candidate` : 'booking_candidate';
        }
      }
    }
  }

  let subscriptionId: string | null = null;
  let webinarId: string | null = null;
  let broadcastId: string | null = null;
  let webinarTitle: string | null = null;
  let broadcastTitle: string | null = null;
  let watched: boolean | null = null;
  let watchDurationSeconds: number | null = null;
  let wgLinkedEmail: string | null = null;

  const wgRow = context.wgBestRow;
  if (wgRow) {
    wgLinkedEmail = normalizeEmail(wgRow.email) || null;
    subscriptionId = pickString(wgRow.id, wgRow.subscription_id);
    webinarId = pickString(wgRow.webinar_id);
    broadcastId = pickString(wgRow.broadcast_id);
    webinarTitle = pickString(wgRow.webinar_title, wgRow.webinar_name, wgRow.title);
    broadcastTitle = pickString(wgRow.broadcast_title, wgRow.broadcast_name);
    watched = wgRow.watched === true ? true : wgRow.watched === false ? false : null;
    watchDurationSeconds = wgWatchSecondsFromSnapshotRow(wgRow);
    matchMethod = appendMatchMethod(matchMethod, 'wg_snapshot');

    const wgEmail = wgLinkedEmail;
    const wgPhone = wgPhoneFromSnapshotRow(wgRow);
    recruiterCustomField = recruiterCustomField || pickString(wgRow.custom_field);

    if (!pipelineCandidateId && wgEmail) {
      const pipelineId = context.pipelineByEmail.get(wgEmail);
      if (pipelineId) {
        pipelineCandidateId = pipelineId;
        matchMethod = appendMatchMethod(matchMethod, 'pipeline_wg_email');
      }
    }
    if (!pipelineCandidateId && wgPhone) {
      const pipelineId = context.pipelineByPhone.get(wgPhone);
      if (pipelineId) {
        pipelineCandidateId = pipelineId;
        matchMethod = appendMatchMethod(matchMethod, 'pipeline_wg_phone');
      }
    }
    if (!pipelineCandidateId) {
      const wgNameKey = wgNameKeyFromSnapshotRow(wgRow);
      if (wgNameKey) {
        const pipelineId = context.pipelineByName.get(wgNameKey);
        if (pipelineId) {
          pipelineCandidateId = pipelineId;
          matchMethod = appendMatchMethod(matchMethod, 'pipeline_wg_name');
        }
      }
    }
    if (!bookedByUserId && wgEmail) {
      const booking = context.bookingByEmail.get(wgEmail) || null;
      if (booking) {
        bookedByUserId = booking.booked_by_user_id ? String(booking.booked_by_user_id) : null;
        bookedByLabel = pickString(booking.booked_by_label);
        recruiterCustomField = recruiterCustomField || pickString(booking.custom_field);
        matchMethod = appendMatchMethod(matchMethod, 'portal_booking_wg_email');
        if (!pipelineCandidateId) {
          const bookingCandidateId = pickString(booking.candidate_id);
          if (bookingCandidateId) {
            pipelineCandidateId = bookingCandidateId;
            matchMethod = appendMatchMethod(matchMethod, 'booking_candidate_wg');
          }
        }
      }
    }
  }

  if (!bookedByUserId && recruiterCustomField) {
    for (const key of recruiterTagLookupKeys(recruiterCustomField)) {
      const settings = context.settingsByTag.get(key);
      if (!settings) continue;
      bookedByUserId = settings.user_id;
      bookedByLabel = settings.label;
      matchMethod = appendMatchMethod(matchMethod, 'booking_tag');
      break;
    }
  }

  if (!bookedByUserId && pipelineCandidateId) {
    const uploader = context.pipelineUploaderById.get(pipelineCandidateId);
    if (uploader?.user_id) {
      bookedByUserId = uploader.user_id;
      bookedByLabel = pickString(uploader.label, bookedByLabel);
      matchMethod = appendMatchMethod(matchMethod, 'pipeline_uploader');
    }
  }

  if (!bookedByLabel && recruiterCustomField) {
    bookedByLabel = labelFromRecruiterCustomField(recruiterCustomField);
  }

  return {
    pipeline_candidate_id: pipelineCandidateId,
    journey_candidate_id: journeyCandidateId,
    booked_by_user_id: bookedByUserId,
    booked_by_label: bookedByLabel,
    match_method: matchMethod,
    recruiter_custom_field: recruiterCustomField,
    subscription_id: subscriptionId,
    webinar_id: webinarId,
    broadcast_id: broadcastId,
    webinar_title: webinarTitle,
    broadcast_title: broadcastTitle,
    watched,
    watch_duration_seconds: watchDurationSeconds,
    wg_linked_email: wgLinkedEmail,
  };
}

export function buildQuestionnaireUpsertPayload(
  row: NormalizedWgQuestionnaireRow,
  match: QuestionnaireMatchResult,
  input: { sourceType: string; syncedAt: string },
): Record<string, unknown> {
  const hiringStage = row.answers.length > 0
    ? (match.pipeline_candidate_id ? 'ready_for_followup' : 'questionnaire_submitted')
    : hiringStageForQuestionnaireRow(row);

  return {
    wg_submission_key: row.wg_submission_key,
    subscription_id: match.subscription_id ?? row.subscription_id,
    webinar_id: match.webinar_id ?? row.webinar_id,
    broadcast_id: match.broadcast_id ?? row.broadcast_id,
    webinar_title: match.webinar_title ?? row.webinar_title,
    broadcast_title: match.broadcast_title ?? row.broadcast_title,
    email: row.email,
    first_name: row.first_name,
    last_name: row.last_name,
    phone: row.phone || null,
    submitted_at: row.submitted_at,
    answers: row.answers,
    raw_payload: {
      ...row.raw_payload,
      _source: row.source,
      wg_linked_email: match.wg_linked_email ?? null,
    },
    pipeline_candidate_id: match.pipeline_candidate_id,
    journey_candidate_id: match.journey_candidate_id,
    booked_by_user_id: match.booked_by_user_id,
    booked_by_label: match.booked_by_label,
    recruiter_custom_field: match.recruiter_custom_field,
    match_method: match.match_method,
    hiring_stage: hiringStage,
    source_type: input.sourceType,
    watched: match.watched ?? row.watched ?? null,
    watch_duration_seconds: match.watch_duration_seconds ?? row.watch_duration_seconds ?? null,
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
    pipelineByName: new Map(),
    journeyByName: new Map(),
    bookingByEmailBroadcast: new Map(),
    bookingByEmail: new Map(),
    bookingByName: new Map(),
    settingsByTag: new Map(),
    pipelineUploaderById: new Map(),
    wgBestRow: null,
  };
  const matchContext = input.match === false
    ? emptyContext
    : await buildQuestionnaireMatchContext(admin);

  const payloads: Record<string, unknown>[] = [];
  for (const row of withAnswers) {
    let match: QuestionnaireMatchResult = input.match === false
      ? {
        pipeline_candidate_id: null,
        journey_candidate_id: null,
        booked_by_user_id: null,
        booked_by_label: null,
        match_method: null,
        recruiter_custom_field: row.recruiter_custom_field,
      }
      : matchQuestionnaireRowWithContext(row, matchContext);
    if (input.match !== false) {
      match = await ensureQuestionnairePipelineLink(admin, row, match, input.sourceType);
    }
    payloads.push(buildQuestionnaireUpsertPayload(row, match, input));
  }

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
      .select('id, dismissed_at')
      .eq('user_id', userId)
      .eq('dedupe_key', dedupeKey)
      .maybeSingle();
    if (existing?.dismissed_at) return;
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
  const matchContext = sourceType === 'google_form' || sourceType === 'wg_webhook'
    ? await buildQuestionnaireMatchContextForRow(admin, row)
    : await buildQuestionnaireMatchContext(admin);
  let match = matchQuestionnaireRowWithContext(row, matchContext);
  match = await ensureQuestionnairePipelineLink(admin, row, match, sourceType);
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
  subscription_id?: string | null;
  webinar_id?: string | null;
  broadcast_id?: string | null;
  webinar_title?: string | null;
  broadcast_title?: string | null;
  watched?: boolean | null;
  watch_duration_seconds?: number | null;
  wg_linked_email?: string | null;
};

export async function matchQuestionnaireRow(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  row: NormalizedWgQuestionnaireRow,
  sourceType = 'rematch',
): Promise<QuestionnaireMatchResult> {
  const context = await buildQuestionnaireMatchContextForRow(admin, row);
  const match = matchQuestionnaireRowWithContext(row, context);
  return ensureQuestionnairePipelineLink(admin, row, match, sourceType);
}
