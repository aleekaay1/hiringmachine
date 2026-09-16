/**
 * Synced logic for services/recruiterCoins.ts — keep in sync when changing earn rules.
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  buildLiveSessionRowsByEmail,
  buildLiveSessionRowsByPhone,
  pickRegistrantForCallDisposition,
  type LiveSessionRegistrantRow,
} from './liveSessionBookedOutcomes.ts';

export const COINS_PER_SHOW = 10;
export const COINS_PER_LIVE_SESSION_SHOW = 15;
export const COINS_PER_HIRE = 50;
export const COIN_LOOKBACK_DAYS = 90;

export type CoinSourceType = 'webinar_show' | 'live_session_show' | 'candidate_hired';

export type RecruiterCoinEventDraft = {
  userId: string;
  sourceType: CoinSourceType;
  sourceKey: string;
  points: number;
  label: string;
  earnedAt: string;
};

type AnyRow = Record<string, unknown>;
type UserProfileRow = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  role: string;
};

type PipelineCallRecord = {
  id: string;
  candidate_id: string;
  recruiter_user_id: string | null;
  disposition: string | null;
  booked_subtype: string | null;
  dialed_number?: string | null;
  disposed_at: string;
  created_at: string;
  meta?: Record<string, unknown> | null;
  threecx_metadata?: Record<string, unknown> | null;
};

/** Half-watch threshold for ~22 min AO webinar (was ~47 min). */
const HALF_WATCH_SECONDS = Math.floor(22 * 60 * 0.5);
const INVITER_FILE_PREFIXES = ['cooper', 'rms'] as const;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function torontoYmdFromDate(d = new Date()): string {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const y = p.find((x) => x.type === 'year')?.value ?? '1970';
  const mo = p.find((x) => x.type === 'month')?.value ?? '01';
  const da = p.find((x) => x.type === 'day')?.value ?? '01';
  return `${y}-${mo}-${da}`;
}

function shiftYmdDays(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + deltaDays);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

export function coinEarnWindow(now = new Date()): { sinceYmd: string; untilYmd: string } {
  const untilYmd = torontoYmdFromDate(now);
  const sinceYmd = shiftYmdDays(untilYmd, -(COIN_LOOKBACK_DAYS - 1));
  return { sinceYmd, untilYmd };
}

function ymdInCoinEarnWindow(ymd: string, window: { sinceYmd: string; untilYmd: string }): boolean {
  const key = String(ymd || '').trim();
  if (!key || key === 'unknown' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  return key >= window.sinceYmd && key <= window.untilYmd;
}

function coinBookingFetchFromIso(window: { sinceYmd: string; untilYmd: string }): string {
  const bookingLookbackYmd = shiftYmdDays(window.sinceYmd, -45);
  const [y, m, d] = bookingLookbackYmd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 5, 0, 0)).toISOString();
}

function normalizeEmail(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase();
}

function webinarShowedFromRow(row: AnyRow): boolean {
  if (row.watched === true) return true;
  const sec = Number(row.watch_duration || 0);
  return Number.isFinite(sec) && sec > 0 && sec >= HALF_WATCH_SECONDS;
}

const RESUME_EXT_RE = /\.(pdf|docx?|rtf|txt|png|jpe?g|webp)$/i;

function eventMsToTorontoYmd(ms: number): string {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ms));
  const y = p.find((x) => x.type === 'year')?.value ?? '1970';
  const mo = p.find((x) => x.type === 'month')?.value ?? '01';
  const da = p.find((x) => x.type === 'day')?.value ?? '01';
  return `${y}-${mo}-${da}`;
}

function formatInviteeNameFromFileTail(tail: string): string {
  const cleaned = String(tail ?? '')
    .trim()
    .replace(RESUME_EXT_RE, '')
    .replace(/[^a-zA-Z0-9\s'-]/g, ' ')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  return cleaned
    .split(' ')
    .map((w) => {
      const t = w.trim();
      if (!t) return '';
      if (t.length <= 2) return t.toUpperCase();
      return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
    })
    .filter(Boolean)
    .join(' ');
}

function parseInviterCustomField(raw: string): { inviteeLabel: string | null } {
  const s = String(raw ?? '').trim();
  if (!s || s.toLowerCase() === 'registration_page') return { inviteeLabel: null };
  const lower = s.toLowerCase();
  for (const prefix of INVITER_FILE_PREFIXES) {
    if (lower.startsWith(`${prefix}_`) || lower.startsWith(`${prefix}-`)) {
      const tail = s.slice(prefix.length + 1).trim();
      const inviteeLabel = tail ? formatInviteeNameFromFileTail(tail) || null : null;
      return { inviteeLabel };
    }
  }
  return { inviteeLabel: null };
}

function nameKeyFromRow(row: AnyRow): string | null {
  const label = parseInviterCustomField(String(row.custom_field || '')).inviteeLabel;
  if (!label) return null;
  return label.trim().toLowerCase().replace(/\s+/g, ' ');
}

function fallbackNameKeyFromCustomField(row: AnyRow): string | null {
  const raw = String(row.custom_field ?? '').trim();
  if (!raw) return null;
  const m = raw.match(/^(cooper|rms)[_\-\s]+(.+)$/i);
  if (!m) return null;
  const parsed = formatInviteeNameFromFileTail(m[2] || '');
  if (!parsed) return null;
  return parsed.trim().toLowerCase().replace(/\s+/g, ' ');
}

function filterRowsForRecruiterOwnership(
  rows: AnyRow[],
  userEmail: string | null,
  userFullName: string | null,
): AnyRow[] {
  if (!rows.length) return [];
  const tokens = buildRecruiterScopeTokens(userEmail, userFullName);
  if (tokens.size === 0) return [];
  return rows.filter((row) => {
    const key = nameKeyFromRow(row) ?? fallbackNameKeyFromCustomField(row);
    return recruiterOwnsNameKey(key, tokens);
  });
}

function asUnixMs(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1e12 ? n : n * 1000;
}

function fmtHrScheduledDateKey(row: AnyRow): string {
  const registration =
    row.registration && typeof row.registration === 'object'
      ? (row.registration as AnyRow)
      : null;
  const ms =
    asUnixMs(registration?.created_at) ??
    asUnixMs(row.created_at) ??
    asUnixMs(row.hr_scheduled_at);
  if (!ms) return 'unknown';
  return eventMsToTorontoYmd(ms);
}

function fmtWebinarSessionDateKey(row: AnyRow): string {
  const broadcast = row.broadcast && typeof row.broadcast === 'object' ? (row.broadcast as AnyRow) : null;
  const ms = asUnixMs(broadcast?.date) ?? asUnixMs(row.watched_true_set_at);
  if (!ms) return 'unknown';
  return eventMsToTorontoYmd(ms);
}

function coinShowDateYmdForWebinarRow(row: AnyRow): string {
  const watchedRaw = row.watched_true_set_at;
  if (typeof watchedRaw === 'string' && watchedRaw.trim()) {
    const ms = Date.parse(watchedRaw);
    if (Number.isFinite(ms)) return eventMsToTorontoYmd(ms);
  }
  const sessionKey = fmtWebinarSessionDateKey(row);
  if (sessionKey !== 'unknown') return sessionKey;
  return fmtHrScheduledDateKey(row);
}

function normalizeIdentityToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function buildRecruiterScopeTokens(email: string | null, fullName: string | null): Set<string> {
  const tokens = new Set<string>();
  const add = (raw: string) => {
    const token = normalizeIdentityToken(raw);
    if (token) tokens.add(token);
  };
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const localPart = normalizedEmail.split('@')[0] || '';
  add(normalizedEmail);
  add(localPart);
  add(localPart.replace(/[._-]+/g, ' '));
  add(localPart.replace(/[._-]+/g, ''));
  const name = String(fullName || '').trim().toLowerCase();
  add(name);
  add(name.replace(/\s+/g, ''));
  for (const word of splitIdentityWords(localPart)) add(word);
  for (const word of splitIdentityWords(name)) add(word);
  return tokens;
}

function recruiterOwnsNameKey(nameKey: string | null, tokens: Set<string>): boolean {
  if (!nameKey || tokens.size === 0) return false;
  const normalized = normalizeIdentityToken(nameKey);
  if (!normalized) return false;
  if (tokens.has(normalized)) return true;
  const words = splitIdentityWords(nameKey);
  if (words.length > 0) {
    const matchedWords = words.reduce((count, word) => (tokens.has(word) ? count + 1 : count), 0);
    if (matchedWords >= 2) return true;
    if (matchedWords >= 1 && words.length === 1 && words[0].length >= 5) return true;
  }
  for (const token of tokens) {
    if (token.length < 6) continue;
    if (normalized.includes(token) || token.includes(normalized)) return true;
  }
  return false;
}

function splitIdentityWords(value: string): string[] {
  return value
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((w) => w.length >= 2);
}

function readBookedSubtype(record: PipelineCallRecord): string {
  const meta = record.meta && typeof record.meta === 'object' ? record.meta : {};
  const three =
    record.threecx_metadata && typeof record.threecx_metadata === 'object'
      ? record.threecx_metadata
      : {};
  return String(
    record.booked_subtype || meta.bookedSubtype || three.booked_subtype || three.bookedSubtype || '',
  )
    .trim()
    .toLowerCase();
}

function isLedgerMissingError(message: string): boolean {
  return /relation|does not exist|schema cache|PGRST205/i.test(message);
}

export function buildRecruiterCoinEventDrafts(input: {
  userId: string;
  userEmail: string | null;
  userFullName: string | null;
  webinarRows: AnyRow[];
  callRecords: PipelineCallRecord[];
  candidateEmailById: Map<string, string>;
  candidatePhoneById?: Map<string, string>;
  liveRegistrants: LiveSessionRegistrantRow[];
  earnWindow?: { sinceYmd: string; untilYmd: string };
}): RecruiterCoinEventDraft[] {
  const window = input.earnWindow ?? coinEarnWindow();
  const liveSessionByEmail = buildLiveSessionRowsByEmail(input.liveRegistrants);
  const liveSessionByPhone = buildLiveSessionRowsByPhone(input.liveRegistrants);
  const events: RecruiterCoinEventDraft[] = [];
  const seen = new Set<string>();

  const scopedWebinar = filterRowsForRecruiterOwnership(
    input.webinarRows,
    input.userEmail,
    input.userFullName,
  );

  for (const row of scopedWebinar) {
    if (!webinarShowedFromRow(row)) continue;

    const showYmd = coinShowDateYmdForWebinarRow(row);
    if (!ymdInCoinEarnWindow(showYmd, window)) continue;

    const subId = String(row.id ?? row.subscription_id ?? '').trim();
    const email = normalizeEmail(String(row.email || ''));
    const sourceKey = subId ? `webinar_show:${subId}` : `webinar_show:${showYmd}:${email}`;
    if (!sourceKey || seen.has(sourceKey)) continue;
    seen.add(sourceKey);

    const fn = String(row.firstname || '').trim();
    const sn = String(row.surname || '').trim();
    const name = `${fn} ${sn}`.trim() || email || 'Webinar guest';

    events.push({
      userId: input.userId,
      sourceType: 'webinar_show',
      sourceKey,
      points: COINS_PER_SHOW,
      label: `Webinar show · ${name}`,
      earnedAt:
        (typeof row.watched_true_set_at === 'string' && row.watched_true_set_at) ||
        (typeof row.created_at === 'string' && row.created_at) ||
        new Date().toISOString(),
    });
  }

  for (const record of input.callRecords) {
    if (String(record.recruiter_user_id || '').trim() !== input.userId) continue;
    if (String(record.disposition || '').trim().toLowerCase() !== 'booked') continue;
    if (readBookedSubtype(record) !== 'live session') continue;

    const disposedMs = Date.parse(record.disposed_at || record.created_at);
    const { registrant: match } = pickRegistrantForCallDisposition({
      email: input.candidateEmailById.get(record.candidate_id),
      candidatePhone: input.candidatePhoneById?.get(record.candidate_id),
      dialedNumber: record.dialed_number,
      disposedAtMs: Number.isFinite(disposedMs) ? disposedMs : Date.now(),
      byEmail: liveSessionByEmail,
      byPhone: liveSessionByPhone,
    });
    if (!match?.attended_zoom) continue;
    if (!ymdInCoinEarnWindow(match.session_date, window)) continue;

    const recordId = String(record.id || '').trim();
    if (!recordId) continue;
    const sourceKey = `live_show:${recordId}`;
    if (seen.has(sourceKey)) continue;
    seen.add(sourceKey);

    events.push({
      userId: input.userId,
      sourceType: 'live_session_show',
      sourceKey,
      points: COINS_PER_LIVE_SESSION_SHOW,
      label: `Live session show · ${match.session_date}`,
      earnedAt: match.zoom_join_at || `${match.session_date}T12:00:00.000Z`,
    });
  }

  return events.sort((a, b) => new Date(b.earnedAt).getTime() - new Date(a.earnedAt).getTime());
}

type PipelineCandidateHireRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  journey_stage: string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string | null;
};

type CrmCandidateHireRow = {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  admin_data: Record<string, unknown> | null;
  timestamp: string | null;
};

function isCrmCandidateHired(adminData: Record<string, unknown> | null | undefined): boolean {
  return String(adminData?.finalDecision || '').trim().toLowerCase() === 'hired';
}

function isPipelineCandidateHired(journeyStage: string | null | undefined): boolean {
  return String(journeyStage || '').trim().toLowerCase() === 'hired';
}

function sourceCandidateIdFromPipeline(metadata: Record<string, unknown> | null | undefined): string {
  return String(metadata?.source_candidate_id || '').trim();
}

function displayNameForHire(pipeline: PipelineCandidateHireRow, crm: CrmCandidateHireRow | null): string {
  if (crm) {
    const name = `${String(crm.first_name || '').trim()} ${String(crm.last_name || '').trim()}`.trim();
    if (name) return name;
    const email = normalizeEmail(crm.email);
    if (email) return email;
  }
  const pipeName = String(pipeline.full_name || '').trim();
  if (pipeName) return pipeName;
  return normalizeEmail(pipeline.email) || 'Candidate';
}

function hireEarnedAt(pipeline: PipelineCandidateHireRow, crm: CrmCandidateHireRow | null): string {
  if (crm?.timestamp) return crm.timestamp;
  if (pipeline.updated_at) return pipeline.updated_at;
  return new Date().toISOString();
}

function candidateHireCoinEvents(
  userId: string,
  bookedPipelineIds: Set<string>,
  pipelines: PipelineCandidateHireRow[],
  crmById: Map<string, CrmCandidateHireRow>,
  crmByEmail: Map<string, CrmCandidateHireRow>,
): RecruiterCoinEventDraft[] {
  if (!bookedPipelineIds.size || !pipelines.length) return [];

  const events: RecruiterCoinEventDraft[] = [];
  const seenSourceKeys = new Set<string>();

  for (const pipeline of pipelines) {
    if (!bookedPipelineIds.has(pipeline.id)) continue;

    const crmId = sourceCandidateIdFromPipeline(pipeline.metadata);
    const crm =
      (crmId ? crmById.get(crmId) : null) ??
      crmByEmail.get(normalizeEmail(pipeline.email)) ??
      null;

    const hired =
      isPipelineCandidateHired(pipeline.journey_stage) ||
      (crm ? isCrmCandidateHired(crm.admin_data) : false);
    if (!hired) continue;

    const stableCrmId = crm?.id || crmId || null;
    const sourceKey = stableCrmId
      ? `candidate_hire:crm:${stableCrmId}`
      : `candidate_hire:pipeline:${pipeline.id}`;
    if (seenSourceKeys.has(sourceKey)) continue;
    seenSourceKeys.add(sourceKey);

    events.push({
      userId,
      sourceType: 'candidate_hired',
      sourceKey,
      points: COINS_PER_HIRE,
      label: `Candidate hired · ${displayNameForHire(pipeline, crm)}`,
      earnedAt: hireEarnedAt(pipeline, crm),
    });
  }

  return events;
}

async function loadHireAttributionForUser(
  admin: SupabaseClient,
  userId: string,
): Promise<{
  bookedPipelineIds: Set<string>;
  pipelines: PipelineCandidateHireRow[];
  crmById: Map<string, CrmCandidateHireRow>;
  crmByEmail: Map<string, CrmCandidateHireRow>;
}> {
  const bookedPipelineIds = new Set<string>();
  const { data: bookedCalls, error: bookedErr } = await admin
    .from('pipeline_call_records')
    .select('candidate_id')
    .eq('recruiter_user_id', userId)
    .ilike('disposition', 'booked')
    .order('disposed_at', { ascending: true })
    .limit(12000);
  if (bookedErr && !isLedgerMissingError(bookedErr.message)) throw bookedErr;

  for (const row of bookedCalls || []) {
    const cid = String((row as { candidate_id?: string }).candidate_id || '').trim();
    if (cid) bookedPipelineIds.add(cid);
  }

  if (!bookedPipelineIds.size) {
    return { bookedPipelineIds, pipelines: [], crmById: new Map(), crmByEmail: new Map() };
  }

  const pipelines: PipelineCandidateHireRow[] = [];
  const pipeIds = [...bookedPipelineIds];
  const chunk = 200;
  for (let i = 0; i < pipeIds.length; i += chunk) {
    const slice = pipeIds.slice(i, i + chunk);
    const { data, error } = await admin
      .from('pipeline_candidates')
      .select('id, full_name, email, journey_stage, metadata, updated_at')
      .in('id', slice);
    if (error) throw error;
    pipelines.push(...((data || []) as PipelineCandidateHireRow[]));
  }

  const crmIds = new Set<string>();
  const crmEmails = new Set<string>();
  for (const p of pipelines) {
    const sid = sourceCandidateIdFromPipeline(p.metadata);
    if (sid) crmIds.add(sid);
    const em = normalizeEmail(p.email);
    if (em) crmEmails.add(em);
  }

  const crmById = new Map<string, CrmCandidateHireRow>();
  const crmByEmail = new Map<string, CrmCandidateHireRow>();

  const idList = [...crmIds];
  for (let i = 0; i < idList.length; i += chunk) {
    const slice = idList.slice(i, i + chunk);
    if (!slice.length) continue;
    const { data, error } = await admin
      .from('candidates')
      .select('id, email, first_name, last_name, admin_data, timestamp')
      .in('id', slice);
    if (error) throw error;
    for (const row of (data || []) as CrmCandidateHireRow[]) {
      crmById.set(row.id, row);
      const em = normalizeEmail(row.email);
      if (em) crmByEmail.set(em, row);
    }
  }

  const emailList = [...crmEmails].filter((em) => !crmByEmail.has(em));
  for (let i = 0; i < emailList.length; i += chunk) {
    const slice = emailList.slice(i, i + chunk);
    if (!slice.length) continue;
    const { data, error } = await admin
      .from('candidates')
      .select('id, email, first_name, last_name, admin_data, timestamp')
      .in('email', slice);
    if (error) throw error;
    for (const row of (data || []) as CrmCandidateHireRow[]) {
      if (!crmById.has(row.id)) crmById.set(row.id, row);
      const em = normalizeEmail(row.email);
      if (em && !crmByEmail.has(em)) crmByEmail.set(em, row);
    }
  }

  return { bookedPipelineIds, pipelines, crmById, crmByEmail };
}

/** First recruiter who dispositioned Booked on the linked pipeline candidate. */
export async function resolveBookerUserIdForAssessmentCandidate(
  admin: SupabaseClient,
  assessmentCandidateId: string,
): Promise<string | null> {
  const assessmentId = String(assessmentCandidateId || '').trim();
  if (!assessmentId) return null;

  const { data: assessment, error: aErr } = await admin
    .from('candidates')
    .select('id, email')
    .eq('id', assessmentId)
    .maybeSingle();
  if (aErr || !assessment) return null;

  const email = normalizeEmail((assessment as { email?: string }).email);

  let pipelineId: string | null = null;
  const { data: bySource, error: sourceErr } = await admin
    .from('pipeline_candidates')
    .select('id')
    .filter('metadata->>source_candidate_id', 'eq', assessmentId)
    .limit(5);
  if (!sourceErr && bySource?.length) {
    pipelineId = String((bySource[0] as { id?: string }).id || '').trim() || null;
  }

  if (!pipelineId && email) {
    const { data: byEmail, error: emailErr } = await admin
      .from('pipeline_candidates')
      .select('id')
      .eq('email', (assessment as { email?: string }).email)
      .limit(5);
    if (!emailErr && byEmail?.length) {
      pipelineId = String((byEmail[0] as { id?: string }).id || '').trim() || null;
    }
  }
  if (!pipelineId) return null;

  const { data: bookedCalls, error: cErr } = await admin
    .from('pipeline_call_records')
    .select('recruiter_user_id, disposed_at')
    .eq('candidate_id', pipelineId)
    .ilike('disposition', 'booked')
    .order('disposed_at', { ascending: true })
    .limit(50);
  if (cErr) return null;

  for (const row of bookedCalls || []) {
    const uid = String((row as { recruiter_user_id?: string }).recruiter_user_id || '').trim();
    if (uid) return uid;
  }
  return null;
}

export async function syncRecruiterCoinsForUser(
  admin: SupabaseClient,
  userId: string,
): Promise<{
  balance: number;
  totalEvents: number;
  ledgerReady: boolean;
  ledgerMissing: boolean;
}> {
  const earnWindow = coinEarnWindow();
  const bookingFromIso = coinBookingFetchFromIso(earnWindow);
  const liveSinceYmd = shiftYmdDays(earnWindow.sinceYmd, -60);

  const { data: profiles, error: profileErr } = await admin
    .from('user_profiles')
    .select('user_id, email, full_name, role');
  if (profileErr) throw profileErr;
  const profileRows = (profiles || []) as UserProfileRow[];

  const { data: cacheRow } = await admin
    .from('webinar_geek_dashboard_snapshots')
    .select('subscriptions')
    .eq('id', 'latest')
    .maybeSingle();

  const subs = cacheRow?.subscriptions;
  const webinarRows = Array.isArray(subs) ? (subs as AnyRow[]) : [];

  const { data: liveRows, error: liveErr } = await admin
    .from('live_session_registrants')
    .select('session_date, email, phone, attended_zoom, calendly_no_show, zoom_join_at')
    .gte('session_date', liveSinceYmd);
  if (liveErr && !isLedgerMissingError(liveErr.message)) throw liveErr;

  let callRecords: PipelineCallRecord[] = [];
  const { data: primaryCalls, error: primaryErr } = await admin
    .from('pipeline_call_records')
    .select(
      'id, candidate_id, recruiter_user_id, disposition, dialed_number, disposed_at, created_at, threecx_metadata',
    )
    .eq('recruiter_user_id', userId)
    .gte('disposed_at', bookingFromIso)
    .order('disposed_at', { ascending: false })
    .limit(8000);
  if (!primaryErr) {
    callRecords = (primaryCalls || []) as PipelineCallRecord[];
  } else if (!isLedgerMissingError(primaryErr.message)) {
    throw primaryErr;
  }

  if (!callRecords.length) {
    const { data: callLogs, error: callErr } = await admin
      .from('pipeline_call_logs')
      .select('id, candidate_id, created_by_user_id, outcome, request_payload, created_at')
      .eq('created_by_user_id', userId)
      .eq('action', 'call_disposition_saved')
      .gte('created_at', bookingFromIso)
      .order('created_at', { ascending: false })
      .limit(8000);
    if (callErr && !isLedgerMissingError(callErr.message)) throw callErr;
    callRecords = (callLogs || []).map((row) => {
      const req = (row.request_payload && typeof row.request_payload === 'object'
        ? row.request_payload
        : {}) as Record<string, unknown>;
      return {
        id: String(row.id),
        candidate_id: String(row.candidate_id),
        recruiter_user_id: String(row.created_by_user_id || ''),
        disposition: String(req.disposition || row.outcome || ''),
        booked_subtype: typeof req.booked_subtype === 'string' ? req.booked_subtype : null,
        disposed_at: String(row.created_at),
        created_at: String(row.created_at),
        meta: req,
      } as PipelineCallRecord;
    });
  }

  const candidateIds = [...new Set(callRecords.map((r) => r.candidate_id).filter(Boolean))];
  const candidateEmailById = new Map<string, string>();
  const candidatePhoneById = new Map<string, string>();
  const chunk = 200;
  for (let i = 0; i < candidateIds.length; i += chunk) {
    const slice = candidateIds.slice(i, i + chunk);
    if (!slice.length) continue;
    const { data: candidates, error: cErr } = await admin
      .from('pipeline_candidates')
      .select('id, email, phone')
      .in('id', slice);
    if (cErr) throw cErr;
    for (const row of candidates || []) {
      const id = String((row as { id?: string }).id || '').trim();
      const email = normalizeEmail((row as { email?: string }).email);
      const phone = String((row as { phone?: string }).phone || '').trim();
      if (id && email) candidateEmailById.set(id, email);
      if (id && phone) candidatePhoneById.set(id, phone);
    }
  }

  const hireAttribution = await loadHireAttributionForUser(admin, userId);

  const targetProfile = profileRows.find((p) => p.user_id === userId);

  const showDrafts = buildRecruiterCoinEventDrafts({
    userId,
    userEmail: targetProfile?.email ?? null,
    userFullName: targetProfile?.full_name ?? null,
    webinarRows,
    callRecords,
    candidateEmailById,
    candidatePhoneById,
    liveRegistrants: (liveRows || []) as LiveSessionRegistrantRow[],
    earnWindow,
  });

  const hireDrafts = candidateHireCoinEvents(
    userId,
    hireAttribution.bookedPipelineIds,
    hireAttribution.pipelines,
    hireAttribution.crmById,
    hireAttribution.crmByEmail,
  );

  const draftMap = new Map<string, RecruiterCoinEventDraft>();
  for (const d of [...showDrafts, ...hireDrafts]) {
    draftMap.set(d.sourceKey, d);
  }
  const drafts = [...draftMap.values()];

  for (const draft of drafts) {
    const { error: insErr } = await admin.from('recruiter_coin_ledger').upsert(
      {
        user_id: draft.userId,
        source_type: draft.sourceType,
        source_key: draft.sourceKey,
        points: draft.points,
        label: draft.label,
        earned_at: draft.earnedAt,
      },
      { onConflict: 'user_id,source_key', ignoreDuplicates: true },
    );
    if (insErr) {
      if (isLedgerMissingError(insErr.message)) {
        return { balance: 0, totalEvents: 0, ledgerReady: false, ledgerMissing: true };
      }
      throw insErr;
    }
  }

  const { data: ledgerRows, error: sumErr } = await admin
    .from('recruiter_coin_ledger')
    .select('points')
    .eq('user_id', userId);
  if (sumErr) {
    if (isLedgerMissingError(sumErr.message)) {
      return { balance: 0, totalEvents: 0, ledgerReady: false, ledgerMissing: true };
    }
    throw sumErr;
  }

  const balance = (ledgerRows || []).reduce((s, row) => s + Number((row as { points?: number }).points || 0), 0);
  const totalEvents = ledgerRows?.length ?? 0;

  await admin
    .from('user_profiles')
    .update({ points: balance, points_updated_at: new Date().toISOString() })
    .eq('user_id', userId);

  return { balance, totalEvents, ledgerReady: true, ledgerMissing: false };
}

const COIN_ELIGIBLE_ROLES = new Set(['recruiter', 'webinar', 'leadership']);

export async function syncAllEligibleRecruiterCoins(
  admin: SupabaseClient,
): Promise<{ usersSynced: number; ledgerMissing: boolean }> {
  const { data: profiles, error } = await admin.from('user_profiles').select('user_id, role');
  if (error) throw error;

  const userIds = (profiles || [])
    .filter((p) => COIN_ELIGIBLE_ROLES.has(String((p as UserProfileRow).role || '')))
    .map((p) => String((p as UserProfileRow).user_id))
    .filter(Boolean);

  let ledgerMissing = false;
  for (const userId of userIds) {
    const r = await syncRecruiterCoinsForUser(admin, userId);
    if (r.ledgerMissing) ledgerMissing = true;
  }

  return { usersSynced: userIds.length, ledgerMissing };
}
