/**
 * Paz Coins — 10 coins per webinar or live session show for the recruiter who booked.
 * Credits shows from the last COIN_LOOKBACK_DAYS (Toronto) and onward on each sync.
 */
import {
  buildLiveSessionRowsByEmail,
  liveSessionAttendedFromRegistrant,
  pickRegistrantForDisposition,
  type LiveSessionRegistrantRow,
} from './liveSessionBookedOutcomes';
import { buildWebinarRowsByEmail, classifyBookedOutcome } from './pipelineBookedOutcomes';
import {
  readCallRecordMeta,
  type PipelineCallRecord,
} from './pipelineService';
import { shiftYmdDays, torontoYmdFromDate } from './webinarGeekDates';
import { fmtHrScheduledDateKey } from './webinarGeekRecruiterAnalytics';

export const COINS_PER_SHOW = 10;
/** Rolling earn window: backfill this many days on sync, then keep crediting new shows. */
export const COIN_LOOKBACK_DAYS = 14;

export type CoinSourceType = 'webinar_show' | 'live_session_show';

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

/** ISO lower bound for loading bookings that may have shown inside the earn window. */
export function coinBookingFetchFromIso(window: CoinEarnWindow = coinEarnWindow()): string {
  const bookingLookbackYmd = shiftYmdDays(window.sinceYmd, -45);
  const [y, m, d] = bookingLookbackYmd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 5, 0, 0)).toISOString();
}

export function webinarShowedFromRow(row: AnyRow): boolean {
  if (row.watched === true) return true;
  const sec = Number(row.watch_duration || 0);
  return Number.isFinite(sec) && sec > 0 && sec >= HALF_WATCH_SECONDS;
}

function webinarSubscriptionId(row: AnyRow): string {
  return String(row.id ?? row.subscription_id ?? '').trim();
}

function showDateYmdForWebinarRow(row: AnyRow): string {
  return fmtHrScheduledDateKey(row);
}

function liveShowEventsForUser(
  userId: string,
  records: PipelineCallRecord[],
  candidateEmailById: Map<string, string>,
  liveSessionByEmail: Map<string, LiveSessionRegistrantRow[]>,
  window: CoinEarnWindow,
): RecruiterCoinEventDraft[] {
  const events: RecruiterCoinEventDraft[] = [];

  for (const record of records) {
    if (String(record.recruiter_user_id || '').trim() !== userId) continue;
    const disposition = String(record.disposition || '').trim().toLowerCase();
    if (disposition !== 'booked') continue;

    const meta = readCallRecordMeta(record);
    const bookedSubtype = String(record.booked_subtype || meta.bookedSubtype || '').trim().toLowerCase();
    if (bookedSubtype !== 'live session') continue;

    const email = candidateEmailById.get(record.candidate_id);
    if (!email) continue;

    const liveRows = liveSessionByEmail.get(email) || [];
    const disposedMs = Date.parse(record.disposed_at || record.created_at);
    const match = pickRegistrantForDisposition(
      liveRows,
      Number.isFinite(disposedMs) ? disposedMs : Date.now(),
    );
    if (!match || !liveSessionAttendedFromRegistrant(match)) continue;
    if (!ymdInCoinEarnWindow(match.session_date, window)) continue;

    const recordId = String(record.id || '').trim();
    if (!recordId) continue;

    events.push({
      userId,
      sourceType: 'live_session_show',
      sourceKey: `live_show:${recordId}`,
      points: COINS_PER_SHOW,
      label: `Live session show · ${match.session_date}`,
      earnedAt: match.zoom_join_at || `${match.session_date}T12:00:00.000Z`,
    });
  }

  return events;
}

function webinarShowEventsFromBookings(
  userId: string,
  records: PipelineCallRecord[],
  candidateEmailById: Map<string, string>,
  rowsByEmail: Map<string, AnyRow[]>,
  window: CoinEarnWindow,
): RecruiterCoinEventDraft[] {
  const events: RecruiterCoinEventDraft[] = [];

  for (const record of records) {
    if (String(record.recruiter_user_id || '').trim() !== userId) continue;
    const disposition = String(record.disposition || '').trim().toLowerCase();
    if (disposition !== 'booked') continue;

    const meta = readCallRecordMeta(record);
    const bookedSubtype = String(record.booked_subtype || meta.bookedSubtype || '').trim().toLowerCase();
    if (bookedSubtype !== 'webinar') continue;

    const email = candidateEmailById.get(record.candidate_id);
    if (!email) continue;

    const disposedMs = Date.parse(record.disposed_at || record.created_at);
    const outcome = classifyBookedOutcome({
      bookedSubtype: 'webinar',
      candidateEmail: email,
      rowsByEmail,
      disposedAtMs: Number.isFinite(disposedMs) ? disposedMs : Date.now(),
    });
    if (!outcome.watchedSignal) continue;

    const matchedRows = (rowsByEmail.get(email) || []).filter((row) => webinarShowedFromRow(row));
    const showRow = matchedRows[0];
    const showYmd = showRow ? showDateYmdForWebinarRow(showRow) : torontoYmdFromDate();
    if (!ymdInCoinEarnWindow(showYmd, window)) continue;

    const recordId = String(record.id || '').trim();
    if (!recordId) continue;

    const subId = showRow ? webinarSubscriptionId(showRow) : '';
    const sourceKey = subId ? `webinar_show:${subId}` : `webinar_show:booking:${recordId}`;

    events.push({
      userId,
      sourceType: 'webinar_show',
      sourceKey,
      points: COINS_PER_SHOW,
      label: `Webinar show · ${email}`,
      earnedAt:
        (showRow && typeof showRow.watched_true_set_at === 'string' && showRow.watched_true_set_at) ||
        (showRow && typeof showRow.created_at === 'string' && showRow.created_at) ||
        record.disposed_at ||
        record.created_at,
    });
  }

  return events;
}

/** Coin earn events for one recruiter (deduped by source_key, last 14 days + future syncs). */
export function buildRecruiterCoinEventDrafts(input: {
  userId: string;
  webinarRows: AnyRow[];
  callRecords: PipelineCallRecord[];
  candidateEmailById: Map<string, string>;
  liveRegistrants: LiveSessionRegistrantRow[];
  earnWindow?: CoinEarnWindow;
}): RecruiterCoinEventDraft[] {
  const window = input.earnWindow ?? coinEarnWindow();
  const rowsByEmail = buildWebinarRowsByEmail(input.webinarRows);
  const liveSessionByEmail = buildLiveSessionRowsByEmail(input.liveRegistrants);

  const merged = [
    ...webinarShowEventsFromBookings(
      input.userId,
      input.callRecords,
      input.candidateEmailById,
      rowsByEmail,
      window,
    ),
    ...liveShowEventsForUser(
      input.userId,
      input.callRecords,
      input.candidateEmailById,
      liveSessionByEmail,
      window,
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
