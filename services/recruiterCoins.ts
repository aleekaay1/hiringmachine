/**
 * Paz Coins — 10 coins per show, using the same WebinarGeek + live-session rules as the leaderboard.
 * Webinar: inviter file tag + watch signal (not pipeline dispositions).
 * Live session: Calendly/Zoom attendance matched like leaderboard liveSessionShowed.
 */
import type { UserProfile } from './accessControl';
import {
  buildLiveSessionRowsByEmail,
  liveSessionAttendedFromRegistrant,
  pickRegistrantForDisposition,
  type LiveSessionRegistrantRow,
} from './liveSessionBookedOutcomes';
import {
  resolveWebinarRowRecruiterUserId,
  seedsFromProfiles,
  type LeaderboardRecruiterSeed,
} from './pipelineLeaderboard';
import {
  readCallRecordMeta,
  type PipelineCallRecord,
} from './pipelineService';
import { shiftYmdDays, torontoYmdFromDate } from './webinarGeekDates';
import { fmtHrScheduledDateKey } from './webinarGeekRecruiterAnalytics';

export const COINS_PER_SHOW = 10;
/** Internal sync window (not shown in UI). */
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
type RecruiterDirectory = Map<string, { fullName: string | null; email: string | null }>;

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
  const bookingLookbackYmd = shiftYmdDays(window.sinceYmd, -45);
  const [y, m, d] = bookingLookbackYmd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 5, 0, 0)).toISOString();
}

export function webinarShowedFromRow(row: AnyRow): boolean {
  if (row.watched === true) return true;
  const sec = Number(row.watch_duration || 0);
  return Number.isFinite(sec) && sec > 0 && sec >= HALF_WATCH_SECONDS;
}

function buildDirectory(profiles: UserProfile[]): RecruiterDirectory {
  const map: RecruiterDirectory = new Map();
  for (const p of profiles) {
    map.set(p.user_id, { fullName: p.full_name ?? null, email: p.email ?? null });
  }
  return map;
}

function webinarShowCoinEvents(
  userId: string,
  webinarRows: AnyRow[],
  seeds: LeaderboardRecruiterSeed[],
  directory: RecruiterDirectory,
  window: CoinEarnWindow,
): RecruiterCoinEventDraft[] {
  const events: RecruiterCoinEventDraft[] = [];
  const seen = new Set<string>();

  for (const row of webinarRows) {
    if (!webinarShowedFromRow(row)) continue;

    const ownerId = resolveWebinarRowRecruiterUserId(row, seeds, directory);
    if (ownerId !== userId) continue;

    const dateKey = fmtHrScheduledDateKey(row);
    if (!ymdInCoinEarnWindow(dateKey, window)) continue;

    const subId = String(row.id ?? row.subscription_id ?? '').trim();
    const email = String(row.email || '').trim().toLowerCase();
    const sourceKey = subId ? `webinar_show:${subId}` : `webinar_show:${dateKey}:${email}`;
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

/** Same live-session showed rule as pipelineLeaderboard aggregateCallRecords. */
function liveSessionShowCoinEvents(
  userId: string,
  records: PipelineCallRecord[],
  candidateEmailById: Map<string, string>,
  liveSessionByEmail: Map<string, LiveSessionRegistrantRow[]>,
  window: CoinEarnWindow,
): RecruiterCoinEventDraft[] {
  const events: RecruiterCoinEventDraft[] = [];

  for (const record of records) {
    if (String(record.recruiter_user_id || '').trim() !== userId) continue;
    if (String(record.disposition || '').trim().toLowerCase() !== 'booked') continue;

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

export function buildRecruiterCoinEventDrafts(input: {
  userId: string;
  profiles: UserProfile[];
  webinarRows: AnyRow[];
  callRecords: PipelineCallRecord[];
  candidateEmailById: Map<string, string>;
  liveRegistrants: LiveSessionRegistrantRow[];
  earnWindow?: CoinEarnWindow;
}): RecruiterCoinEventDraft[] {
  const window = input.earnWindow ?? coinEarnWindow();
  const seeds = seedsFromProfiles(input.profiles);
  const directory = buildDirectory(input.profiles);
  const liveSessionByEmail = buildLiveSessionRowsByEmail(input.liveRegistrants);

  const merged = [
    ...webinarShowCoinEvents(input.userId, input.webinarRows, seeds, directory, window),
    ...liveSessionShowCoinEvents(
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
