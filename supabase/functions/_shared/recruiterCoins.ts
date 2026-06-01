/**
 * Synced logic for services/recruiterCoins.ts — keep in sync when changing earn rules.
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

export const COINS_PER_SHOW = 10;
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

type AnyRow = Record<string, unknown>;
type UserProfileRow = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  role: string;
};

type LiveSessionRegistrantRow = {
  session_date: string;
  email: string;
  attended_zoom: boolean;
  calendly_no_show: boolean | null;
  zoom_join_at: string | null;
};

type PipelineCallRecord = {
  id: string;
  candidate_id: string;
  recruiter_user_id: string | null;
  disposition: string | null;
  booked_subtype: string | null;
  disposed_at: string;
  created_at: string;
  meta?: Record<string, unknown> | null;
  threecx_metadata?: Record<string, unknown> | null;
};

const HALF_WATCH_SECONDS = Math.floor(47 * 60 * 0.5);
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

function fmtHrScheduledDateKey(row: AnyRow): string {
  const ms = Date.parse(String(row.created_at || ''));
  if (!Number.isFinite(ms)) return 'unknown';
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(ms));
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  return `${map.year}-${map.month}-${map.day}`;
}

function nameKeyFromRow(row: AnyRow): string | null {
  const raw = String(row.custom_field || '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  for (const prefix of INVITER_FILE_PREFIXES) {
    if (lower.startsWith(`${prefix}_`) || lower.startsWith(`${prefix}-`)) {
      const tail = raw.slice(prefix.length + 1).trim();
      return tail.replace(/[^a-z0-9]/gi, '').toLowerCase() || null;
    }
  }
  return raw.replace(/[^a-z0-9]/gi, '').toLowerCase() || null;
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
  return tokens;
}

function recruiterOwnsNameKey(nameKey: string | null, tokens: Set<string>): boolean {
  if (!nameKey || tokens.size === 0) return false;
  const normalized = normalizeIdentityToken(nameKey);
  if (tokens.has(normalized)) return true;
  for (const token of tokens) {
    if (token.length >= 6 && (normalized.includes(token) || token.includes(normalized))) return true;
  }
  return false;
}

function seedsFromProfiles(profiles: UserProfileRow[]) {
  return profiles
    .filter((p) => p.role === 'recruiter' || p.role === 'webinar' || p.role === 'leadership')
    .filter((p) => p.role !== 'admin')
    .map((p) => ({
      recruiterUserId: p.user_id,
      displayName: String(p.full_name || '').trim() || String(p.email || '').split('@')[0] || 'Team member',
    }));
}

function resolveWebinarRowRecruiterUserId(
  row: AnyRow,
  seeds: ReturnType<typeof seedsFromProfiles>,
  directory: Map<string, { fullName: string | null; email: string | null }>,
): string | null {
  const key = nameKeyFromRow(row);
  if (!key) return null;
  for (const seed of seeds) {
    const profile = directory.get(seed.recruiterUserId);
    const tokens = buildRecruiterScopeTokens(profile?.email ?? null, profile?.fullName ?? seed.displayName);
    if (recruiterOwnsNameKey(key, tokens)) return seed.recruiterUserId;
  }
  return null;
}

function buildLiveSessionRowsByEmail(rows: LiveSessionRegistrantRow[]): Map<string, LiveSessionRegistrantRow[]> {
  const map = new Map<string, LiveSessionRegistrantRow[]>();
  for (const row of rows) {
    const email = normalizeEmail(row.email);
    if (!email) continue;
    const list = map.get(email) || [];
    list.push(row);
    map.set(email, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.session_date.localeCompare(b.session_date));
  }
  return map;
}

function pickRegistrantForDisposition(rows: LiveSessionRegistrantRow[], disposedAtMs: number): LiveSessionRegistrantRow | null {
  if (!rows.length) return null;
  const disposeYmd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .formatToParts(new Date(disposedAtMs))
    .reduce(
      (acc, p) => {
        if (p.type !== 'literal') acc[p.type] = p.value;
        return acc;
      },
      {} as Record<string, string>,
    );
  const ymd = `${disposeYmd.year}-${disposeYmd.month}-${disposeYmd.day}`;
  const onOrAfter = rows.filter((r) => r.session_date >= ymd);
  if (onOrAfter.length) return onOrAfter[0];
  return rows[rows.length - 1];
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
  profiles: UserProfileRow[];
  webinarRows: AnyRow[];
  callRecords: PipelineCallRecord[];
  candidateEmailById: Map<string, string>;
  liveRegistrants: LiveSessionRegistrantRow[];
  earnWindow?: { sinceYmd: string; untilYmd: string };
}): RecruiterCoinEventDraft[] {
  const window = input.earnWindow ?? coinEarnWindow();
  const seeds = seedsFromProfiles(input.profiles);
  const directory = new Map(
    input.profiles.map((p) => [p.user_id, { fullName: p.full_name, email: p.email }]),
  );
  const liveSessionByEmail = buildLiveSessionRowsByEmail(input.liveRegistrants);
  const events: RecruiterCoinEventDraft[] = [];
  const seen = new Set<string>();

  for (const row of input.webinarRows) {
    if (!webinarShowedFromRow(row)) continue;
    const ownerId = resolveWebinarRowRecruiterUserId(row, seeds, directory);
    if (ownerId !== input.userId) continue;

    const dateKey = fmtHrScheduledDateKey(row);
    if (!ymdInCoinEarnWindow(dateKey, window)) continue;

    const subId = String(row.id ?? row.subscription_id ?? '').trim();
    const email = normalizeEmail(String(row.email || ''));
    const sourceKey = subId ? `webinar_show:${subId}` : `webinar_show:${dateKey}:${email}`;
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

    const email = input.candidateEmailById.get(record.candidate_id);
    if (!email) continue;

    const liveRows = liveSessionByEmail.get(email) || [];
    const disposedMs = Date.parse(record.disposed_at || record.created_at);
    const match = pickRegistrantForDisposition(
      liveRows,
      Number.isFinite(disposedMs) ? disposedMs : Date.now(),
    );
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
      points: COINS_PER_SHOW,
      label: `Live session show · ${match.session_date}`,
      earnedAt: match.zoom_join_at || `${match.session_date}T12:00:00.000Z`,
    });
  }

  return events.sort((a, b) => new Date(b.earnedAt).getTime() - new Date(a.earnedAt).getTime());
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
  const liveSinceYmd = shiftYmdDays(earnWindow.sinceYmd, -14);

  const { data: profiles, error: profileErr } = await admin
    .from('user_profiles')
    .select('user_id, email, full_name, role');
  if (profileErr) throw profileErr;
  const profileRows = (profiles || []) as UserProfileRow[];

  const { data: cacheRow } = await admin
    .from('webinar_geek_dashboard_cache')
    .select('payload')
    .eq('id', 'latest')
    .maybeSingle();

  const payload = cacheRow?.payload as { subscriptions?: AnyRow[] } | null;
  const webinarRows = Array.isArray(payload?.subscriptions) ? payload!.subscriptions! : [];

  const { data: liveRows, error: liveErr } = await admin
    .from('live_session_registrants')
    .select('session_date, email, attended_zoom, calendly_no_show, zoom_join_at')
    .gte('session_date', liveSinceYmd);
  if (liveErr && !isLedgerMissingError(liveErr.message)) throw liveErr;

  let callRecords: PipelineCallRecord[] = [];
  const { data: primaryCalls, error: primaryErr } = await admin
    .from('pipeline_call_records')
    .select(
      'id, candidate_id, recruiter_user_id, disposition, booked_subtype, disposed_at, created_at, meta, threecx_metadata',
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
  const chunk = 200;
  for (let i = 0; i < candidateIds.length; i += chunk) {
    const slice = candidateIds.slice(i, i + chunk);
    if (!slice.length) continue;
    const { data: candidates, error: cErr } = await admin
      .from('candidates')
      .select('id, email')
      .in('id', slice);
    if (cErr) throw cErr;
    for (const row of candidates || []) {
      const id = String((row as { id?: string }).id || '').trim();
      const email = normalizeEmail((row as { email?: string }).email);
      if (id && email) candidateEmailById.set(id, email);
    }
  }

  const drafts = buildRecruiterCoinEventDrafts({
    userId,
    profiles: profileRows,
    webinarRows,
    callRecords,
    candidateEmailById,
    liveRegistrants: (liveRows || []) as LiveSessionRegistrantRow[],
    earnWindow,
  });

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
