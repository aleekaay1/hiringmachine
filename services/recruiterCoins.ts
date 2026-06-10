/**
 * Paz Coins — webinar shows + live session shows + hire bonuses.
 */
import { filterRowsForRecruiterOwnership } from './recruiterDataScope';
import {
  buildLiveSessionRowsByEmail,
  buildLiveSessionRowsByPhone,
  liveSessionAttendedFromRegistrant,
  pickRegistrantForCallDisposition,
  type LiveSessionRegistrantRow,
} from './liveSessionBookedOutcomes';
import {
  readCallRecordMeta,
  type PipelineCallRecord,
} from './pipelineService';
import { shiftYmdDays, torontoYmdFromDate } from './webinarGeekDates';
import {
  fmtHrScheduledDateKey,
  fmtWebinarSessionDateKey,
} from './webinarGeekRecruiterAnalytics';

export const COINS_PER_SHOW = 10;
export const COINS_PER_LIVE_SESSION_SHOW = 15;
export const COINS_PER_HIRE = 50;
/** Internal rolling window for crediting shows on sync. */
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

export type CoinEarnWindow = {
  sinceYmd: string;
  untilYmd: string;
};

type AnyRow = Record<string, unknown>;

const HALF_WATCH_SECONDS = Math.floor(47 * 60 * 0.5);

export function coinEarnWindow(now = new Date()): CoinEarnWindow {
  const untilYmd = torontoYmdFromDate(now);
  const sinceYmd = shiftYmdDays(untilYmd, -(COIN_LOOKBACK_DAYS - 1));
  return { sinceYmd, untilYmd };
}

export function ymdInCoinEarnWindow(ymd: string, window: CoinEarnWindow = coinEarnWindow()): boolean {
  const key = String(ymd || '').trim();
  if (!key || key === 'unknown' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  return key >= window.sinceYmd && key <= window.untilYmd;
}

export function coinBookingFetchFromIso(window: CoinEarnWindow = coinEarnWindow()): string {
  const bookingLookbackYmd = shiftYmdDays(window.sinceYmd, -60);
  const [y, m, d] = bookingLookbackYmd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 5, 0, 0)).toISOString();
}

export function webinarShowedFromRow(row: AnyRow): boolean {
  if (row.watched === true) return true;
  const sec = Number(row.watch_duration || 0);
  return Number.isFinite(sec) && sec > 0 && sec >= HALF_WATCH_SECONDS;
}

/** When the show happened (watch/session), not invite upload date. */
export function coinShowDateYmdForWebinarRow(row: AnyRow): string {
  const watchedRaw = row.watched_true_set_at;
  if (typeof watchedRaw === 'string' && watchedRaw.trim()) {
    const ms = Date.parse(watchedRaw);
    if (Number.isFinite(ms)) return torontoYmdFromDate(new Date(ms));
  }
  const sessionKey = fmtWebinarSessionDateKey(row);
  if (sessionKey !== 'unknown') return sessionKey;
  return fmtHrScheduledDateKey(row);
}

function webinarShowCoinEvents(
  userId: string,
  allWebinarRows: AnyRow[],
  userEmail: string | null,
  userFullName: string | null,
  window: CoinEarnWindow,
): RecruiterCoinEventDraft[] {
  const scopedRows = filterRowsForRecruiterOwnership(allWebinarRows, userEmail, userFullName);
  const events: RecruiterCoinEventDraft[] = [];
  const seen = new Set<string>();

  for (const row of scopedRows) {
    if (!webinarShowedFromRow(row)) continue;

    const showYmd = coinShowDateYmdForWebinarRow(row);
    if (!ymdInCoinEarnWindow(showYmd, window)) continue;

    const subId = String(row.id ?? row.subscription_id ?? '').trim();
    const email = String(row.email || '').trim().toLowerCase();
    const sourceKey = subId ? `webinar_show:${subId}` : `webinar_show:${showYmd}:${email}`;
    if (!sourceKey || seen.has(sourceKey)) continue;
    seen.add(sourceKey);

    const fn = String(row.firstname || '').trim();
    const sn = String(row.surname || '').trim();
    const name = `${fn} ${sn}`.trim() || email || 'Webinar guest';

    events.push({
      userId,
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

  return events;
}

function liveSessionShowCoinEvents(
  userId: string,
  records: PipelineCallRecord[],
  candidateEmailById: Map<string, string>,
  candidatePhoneById: Map<string, string>,
  liveSessionByEmail: Map<string, LiveSessionRegistrantRow[]>,
  liveSessionByPhone: Map<string, LiveSessionRegistrantRow[]>,
  window: CoinEarnWindow,
): RecruiterCoinEventDraft[] {
  const events: RecruiterCoinEventDraft[] = [];

  for (const record of records) {
    if (String(record.recruiter_user_id || '').trim() !== userId) continue;
    if (String(record.disposition || '').trim().toLowerCase() !== 'booked') continue;

    const meta = readCallRecordMeta(record);
    const bookedSubtype = String(record.booked_subtype || meta.bookedSubtype || '').trim().toLowerCase();
    if (bookedSubtype !== 'live session') continue;

    const disposedMs = Date.parse(record.disposed_at || record.created_at);
    const { registrant: match } = pickRegistrantForCallDisposition({
      email: candidateEmailById.get(record.candidate_id),
      candidatePhone: candidatePhoneById.get(record.candidate_id),
      dialedNumber: record.dialed_number,
      disposedAtMs: Number.isFinite(disposedMs) ? disposedMs : Date.now(),
      byEmail: liveSessionByEmail,
      byPhone: liveSessionByPhone,
    });
    if (!match || !liveSessionAttendedFromRegistrant(match)) continue;
    if (!ymdInCoinEarnWindow(match.session_date, window)) continue;

    const recordId = String(record.id || '').trim();
    if (!recordId) continue;

    events.push({
      userId,
      sourceType: 'live_session_show',
      sourceKey: `live_show:${recordId}`,
      points: COINS_PER_LIVE_SESSION_SHOW,
      label: `Live session show · ${match.session_date}`,
      earnedAt: match.zoom_join_at || `${match.session_date}T12:00:00.000Z`,
    });
  }

  return events;
}

export type PipelineCandidateHireRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  journey_stage: string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string | null;
};

export type CrmCandidateHireRow = {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  admin_data: Record<string, unknown> | null;
  updated_at: string | null;
};

function normalizeHireEmail(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase();
}

export function isCrmCandidateHired(adminData: Record<string, unknown> | null | undefined): boolean {
  return String(adminData?.finalDecision || '').trim().toLowerCase() === 'hired';
}

export function isPipelineCandidateHired(journeyStage: string | null | undefined): boolean {
  return String(journeyStage || '').trim().toLowerCase() === 'hired';
}

function sourceCandidateIdFromPipeline(metadata: Record<string, unknown> | null | undefined): string {
  return String(metadata?.source_candidate_id || '').trim();
}

function displayNameForHire(
  pipeline: PipelineCandidateHireRow,
  crm: CrmCandidateHireRow | null,
): string {
  if (crm) {
    const name = `${String(crm.first_name || '').trim()} ${String(crm.last_name || '').trim()}`.trim();
    if (name) return name;
    const email = normalizeHireEmail(crm.email);
    if (email) return email;
  }
  const pipeName = String(pipeline.full_name || '').trim();
  if (pipeName) return pipeName;
  const email = normalizeHireEmail(pipeline.email);
  return email || 'Candidate';
}

function hireEarnedAt(pipeline: PipelineCandidateHireRow, crm: CrmCandidateHireRow | null): string {
  if (crm?.updated_at) return crm.updated_at;
  if (pipeline.updated_at) return pipeline.updated_at;
  return new Date().toISOString();
}

/** 50 coins when a pipeline candidate this recruiter booked is hired (CRM or pipeline journey). */
export function candidateHireCoinEvents(
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
      crmByEmail.get(normalizeHireEmail(pipeline.email)) ??
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

    const name = displayNameForHire(pipeline, crm);
    events.push({
      userId,
      sourceType: 'candidate_hired',
      sourceKey,
      points: COINS_PER_HIRE,
      label: `Candidate hired · ${name}`,
      earnedAt: hireEarnedAt(pipeline, crm),
    });
  }

  return events;
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
  earnWindow?: CoinEarnWindow;
  bookedPipelineIds?: Set<string>;
  hirePipelines?: PipelineCandidateHireRow[];
  hireCrmById?: Map<string, CrmCandidateHireRow>;
  hireCrmByEmail?: Map<string, CrmCandidateHireRow>;
}): RecruiterCoinEventDraft[] {
  const window = input.earnWindow ?? coinEarnWindow();
  const liveSessionByEmail = buildLiveSessionRowsByEmail(input.liveRegistrants);
  const liveSessionByPhone = buildLiveSessionRowsByPhone(input.liveRegistrants);

  const merged = [
    ...webinarShowCoinEvents(
      input.userId,
      input.webinarRows,
      input.userEmail,
      input.userFullName,
      window,
    ),
    ...liveSessionShowCoinEvents(
      input.userId,
      input.callRecords,
      input.candidateEmailById,
      input.candidatePhoneById ?? new Map(),
      liveSessionByEmail,
      liveSessionByPhone,
      window,
    ),
    ...candidateHireCoinEvents(
      input.userId,
      input.bookedPipelineIds ?? new Set(),
      input.hirePipelines ?? [],
      input.hireCrmById ?? new Map(),
      input.hireCrmByEmail ?? new Map(),
    ),
  ];

  const byKey = new Map<string, RecruiterCoinEventDraft>();
  for (const e of merged) {
    byKey.set(e.sourceKey, e);
  }
  return [...byKey.values()].sort(
    (a, b) => new Date(b.earnedAt).getTime() - new Date(a.earnedAt).getTime(),
  );
}

export type RecruiterCoinLedgerRow = {
  id: string;
  source_type: CoinSourceType;
  source_key: string;
  points: number;
  label: string | null;
  earned_at: string;
};
