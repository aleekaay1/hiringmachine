import { supabase } from './supabaseClient';
import { fetchLiveSessionsDashboard } from './liveSessionsIntegrations';
import {
  loadLiveSessionRegistrantsForMatching,
  matchLiveSessionForCallDisposition,
  type LiveSessionMatchResult,
} from './liveSessionBookedOutcomes';
import {
  readCallRecordMeta,
  readCallRecordLiveSessionOutcome,
  readPipelineCandidateEmail,
  readPipelineCandidatePhone,
  type PipelineCallRecord,
  type PipelineCandidate,
} from './pipelineService';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export type LiveSessionOutcomeSyncResult = {
  ok: boolean;
  scanned?: number;
  matched?: number;
  attended?: number;
  scheduled?: number;
  updated?: number;
  coinsSynced?: number;
  message?: string;
  error?: string;
  source?: 'edge' | 'client';
};

function readBookedSubtype(record: PipelineCallRecord): string {
  const meta = readCallRecordMeta(record);
  return String(record.booked_subtype || meta.bookedSubtype || '').trim().toLowerCase();
}

function liveSessionMetadataPatch(outcome: LiveSessionMatchResult): Record<string, unknown> {
  return {
    live_session_outcome: outcome.status,
    live_session_date: outcome.sessionDate,
    live_session_match_method: outcome.matchMethod,
    live_session_matched_at: new Date().toISOString(),
    live_session_attended_zoom: outcome.status === 'attended',
  };
}

/** Match one Booked (Live Session) record and persist outcome on pipeline_call_records. */
export async function matchAndPersistLiveSessionForRecord(input: {
  record: PipelineCallRecord;
  candidate: PipelineCandidate;
  emailOverride?: string;
  registrants?: Awaited<ReturnType<typeof loadLiveSessionRegistrantsForMatching>>;
}): Promise<LiveSessionMatchResult | null> {
  if (String(input.record.disposition || '').trim().toLowerCase() !== 'booked') return null;
  if (readBookedSubtype(input.record) !== 'live session') return null;
  if (input.record.id.startsWith('fallback-')) return null;

  const registrants = input.registrants ?? (await loadLiveSessionRegistrantsForMatching());
  const emailInfo = readPipelineCandidateEmail(input.candidate);
  const phoneInfo = readPipelineCandidatePhone(input.candidate);
  const disposedMs = Date.parse(input.record.disposed_at || input.record.created_at);

  const outcome = matchLiveSessionForCallDisposition({
    email: input.emailOverride?.trim() || emailInfo.effectiveEmail,
    candidatePhone: phoneInfo.effectivePhone,
    candidateName: input.candidate.full_name,
    dialedNumber: input.record.dialed_number,
    disposedAtMs: Number.isFinite(disposedMs) ? disposedMs : Date.now(),
    registrants,
  });

  if (outcome.status === 'pending') return outcome;

  const existingMeta = input.record.threecx_metadata && typeof input.record.threecx_metadata === 'object'
    ? (input.record.threecx_metadata as Record<string, unknown>)
    : {};

  const { error } = await supabase
    .from('pipeline_call_records')
    .update({
      threecx_metadata: {
        ...existingMeta,
        ...liveSessionMetadataPatch(outcome),
      },
    })
    .eq('id', input.record.id);

  if (error) {
    console.warn('[liveSessionOutcome] Could not persist match for record', input.record.id, error.message);
  }

  return outcome;
}

/** Client-side batch match when edge function is unavailable (403/404). */
export async function clientSideSyncLiveSessionOutcomes(options?: {
  daysBack?: number;
}): Promise<LiveSessionOutcomeSyncResult> {
  const daysBack = options?.daysBack ?? 90;
  const sinceIso = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

  const [registrants, recordsResult] = await Promise.all([
    loadLiveSessionRegistrantsForMatching(),
    supabase
      .from('pipeline_call_records')
      .select('id, candidate_id, recruiter_user_id, disposition, dialed_number, disposed_at, created_at, booked_subtype, threecx_metadata')
      .gte('disposed_at', sinceIso)
      .ilike('disposition', 'booked')
      .order('disposed_at', { ascending: false })
      .limit(5000),
  ]);

  if (recordsResult.error) {
    return { ok: false, error: recordsResult.error.message, source: 'client' };
  }

  const bookedLive = (recordsResult.data || []).filter((r) => readBookedSubtype(r as PipelineCallRecord) === 'live session') as PipelineCallRecord[];
  const candidateIds = [...new Set(bookedLive.map((r) => r.candidate_id).filter(Boolean))];
  const candidateById = new Map<string, PipelineCandidate>();

  const chunk = 150;
  for (let i = 0; i < candidateIds.length; i += chunk) {
    const slice = candidateIds.slice(i, i + chunk);
    const { data } = await supabase
      .from('pipeline_candidates')
      .select('id, full_name, email, phone, source, journey_stage, status, metadata, created_at, updated_at')
      .in('id', slice);
    for (const row of (data || []) as PipelineCandidate[]) {
      candidateById.set(row.id, row);
    }
  }

  let scanned = 0;
  let matched = 0;
  let attended = 0;
  let updated = 0;

  for (const record of bookedLive) {
    scanned += 1;
    const persisted = readCallRecordLiveSessionOutcome(record);
    if (persisted.status && persisted.status !== 'pending') {
      matched += 1;
      if (persisted.status === 'attended') attended += 1;
      continue;
    }
    const candidate = candidateById.get(record.candidate_id);
    if (!candidate) continue;
    const outcome = await matchAndPersistLiveSessionForRecord({ record, candidate, registrants });
    if (!outcome || outcome.status === 'pending') continue;
    matched += 1;
    if (outcome.status === 'attended') attended += 1;
    updated += 1;
  }

  return {
    ok: true,
    scanned,
    matched,
    attended,
    updated,
    source: 'client',
    message: updated > 0
      ? `Matched ${updated} live session booking(s) locally (${attended} attended).`
      : 'Live session data synced from cache.',
  };
}

/** Pull latest Calendly + Zoom into DB, then match Booked (Live Session) rows. */
export async function refreshLiveSessionsAndMatchOutcomes(options?: {
  syncCoins?: boolean;
  daysBack?: number;
}): Promise<LiveSessionOutcomeSyncResult> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { ok: false, error: 'Missing Supabase configuration' };
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return { ok: false, error: 'Not signed in' };

  try {
    const dash = await fetchLiveSessionsDashboard(token, { sync: true });
    if (!dash.ok) {
      console.warn('[liveSessionOutcome] Calendly/Zoom sync failed, matching cached registrants', dash.error);
    }
  } catch (err) {
    console.warn('[liveSessionOutcome] Calendly/Zoom sync failed, matching cached registrants', err);
  }

  const res = await fetch(`${SUPABASE_URL}/functions/v1/sync-live-session-outcomes`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      syncCoins: options?.syncCoins !== false,
      daysBack: options?.daysBack ?? 90,
    }),
  });

  const body = (await res.json().catch(() => ({}))) as LiveSessionOutcomeSyncResult;
  if (res.ok) {
    return { ...body, ok: true, source: 'edge' };
  }

  if (res.status === 403 || res.status === 404) {
    console.warn('[liveSessionOutcome] Edge sync unavailable, falling back to client match', body.error || res.status);
    return clientSideSyncLiveSessionOutcomes({ daysBack: options?.daysBack });
  }

  return { ok: false, error: body.error || `Sync failed (${res.status})` };
}
