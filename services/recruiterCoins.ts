/**
 * Paz Coins — 10 coins per webinar or live session show attributed to the booking recruiter.
 */
import type { UserProfile } from './accessControl';
import {
  buildLiveSessionRowsByEmail,
  liveSessionAttendedFromRegistrant,
  pickRegistrantForDisposition,
  type LiveSessionRegistrantRow,
} from './liveSessionBookedOutcomes';
import {
  buildRecruiterScopeTokens,
  recruiterOwnsNameKey,
} from './accessControl';
import { fmtHrScheduledDateKey } from './webinarGeekRecruiterAnalytics';
import { nameKeyFromRow } from './webinarGeekInviters';
import {
  readCallRecordMeta,
  type PipelineCallRecord,
} from './pipelineService';
import {
  seedsFromProfiles,
  type LeaderboardRecruiterSeed,
} from './pipelineLeaderboard';

export const COINS_PER_SHOW = 10;

export type CoinSourceType = 'webinar_show' | 'live_session_show';

export type RecruiterCoinEventDraft = {
  userId: string;
  sourceType: CoinSourceType;
  sourceKey: string;
  points: number;
  label: string;
  earnedAt: string;
};

type AnyRow = Record<string, unknown>;
type RecruiterDirectory = Map<string, { fullName: string | null; email: string | null }>;

const HALF_WATCH_SECONDS = Math.floor(47 * 60 * 0.5);

export function webinarShowedFromRow(row: AnyRow): boolean {
  if (row.watched === true) return true;
  const sec = Number(row.watch_duration || 0);
  return Number.isFinite(sec) && sec > 0 && sec >= HALF_WATCH_SECONDS;
}

function webinarSubscriptionId(row: AnyRow): string {
  const id = String(row.id ?? row.subscription_id ?? '').trim();
  return id;
}

function buildDirectory(profiles: UserProfile[]): RecruiterDirectory {
  const map: RecruiterDirectory = new Map();
  for (const p of profiles) {
    map.set(p.user_id, { fullName: p.full_name ?? null, email: p.email ?? null });
  }
  return map;
}

function ownerUserIdForWebinarRow(
  row: AnyRow,
  seeds: LeaderboardRecruiterSeed[],
  directory: RecruiterDirectory,
): string | null {
  const key = nameKeyFromRow(row);
  if (!key) return null;

  for (const seed of seeds) {
    const profile = directory.get(seed.recruiterUserId);
    const tokens = buildRecruiterScopeTokens(profile?.email ?? null, profile?.fullName ?? seed.displayName);
    if (recruiterOwnsNameKey(key, tokens)) {
      return seed.recruiterUserId;
    }
  }
  return null;
}

function liveShowEventsForUser(
  userId: string,
  records: PipelineCallRecord[],
  candidateEmailById: Map<string, string>,
  liveSessionByEmail: Map<string, LiveSessionRegistrantRow[]>,
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

    const recordId = String(record.id || '').trim();
    if (!recordId) continue;

    events.push({
      userId,
      sourceType: 'live_session_show',
      sourceKey: `live_show:${recordId}`,
      points: COINS_PER_SHOW,
      label: `Live session show · ${match.session_date}`,
      earnedAt: match.zoom_join_at || record.disposed_at || record.created_at,
    });
  }

  return events;
}

function webinarShowEventsForUser(
  userId: string,
  rows: AnyRow[],
  seeds: LeaderboardRecruiterSeed[],
  directory: RecruiterDirectory,
): RecruiterCoinEventDraft[] {
  const events: RecruiterCoinEventDraft[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (!webinarShowedFromRow(row)) continue;
    const ownerId = ownerUserIdForWebinarRow(row, seeds, directory);
    if (ownerId !== userId) continue;

    const subId = webinarSubscriptionId(row);
    const email = String(row.email || '').trim().toLowerCase();
    const dateKey = fmtHrScheduledDateKey(row);
    const sourceKey = subId
      ? `webinar_show:${subId}`
      : `webinar_show:${dateKey}:${email}`;
    if (!sourceKey || seen.has(sourceKey)) continue;
    seen.add(sourceKey);

    const earnedAt =
      (typeof row.watched_true_set_at === 'string' && row.watched_true_set_at) ||
      (typeof row.created_at === 'string' && row.created_at) ||
      new Date().toISOString();

    const candidate = String(row.firstname || '').trim();
    const surname = String(row.surname || '').trim();
    const name = `${candidate} ${surname}`.trim() || email || 'Webinar guest';

    events.push({
      userId,
      sourceType: 'webinar_show',
      sourceKey,
      points: COINS_PER_SHOW,
      label: `Webinar show · ${name}`,
      earnedAt,
    });
  }

  return events;
}

/** All coin earn events for one recruiter account (deduped by source_key). */
export function buildRecruiterCoinEventDrafts(input: {
  userId: string;
  profiles: UserProfile[];
  webinarRows: AnyRow[];
  callRecords: PipelineCallRecord[];
  candidateEmailById: Map<string, string>;
  liveRegistrants: LiveSessionRegistrantRow[];
}): RecruiterCoinEventDraft[] {
  const seeds = seedsFromProfiles(input.profiles);
  const directory = buildDirectory(input.profiles);
  const liveSessionByEmail = buildLiveSessionRowsByEmail(input.liveRegistrants);

  const merged = [
    ...webinarShowEventsForUser(input.userId, input.webinarRows, seeds, directory),
    ...liveShowEventsForUser(
      input.userId,
      input.callRecords,
      input.candidateEmailById,
      liveSessionByEmail,
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
