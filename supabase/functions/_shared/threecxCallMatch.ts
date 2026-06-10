import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

export function phonesMatch(a: string, b: string): boolean {
  const da = digitsOnly(a);
  const db = digitsOnly(b);
  if (!da || !db) return false;
  if (da === db) return true;
  if (da.length >= 10 && db.length >= 10) return da.slice(-10) === db.slice(-10);
  return da.endsWith(db) || db.endsWith(da);
}

export function parseDurationSecondsFromText(raw: string): number | null {
  const text = String(raw || '').trim();
  if (!text) return null;
  const parts = text.split(':').map((p) => Number(p));
  if (parts.some((p) => !Number.isFinite(p))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  const asNum = Number(text);
  return Number.isFinite(asNum) && asNum > 0 ? Math.round(asNum) : null;
}

export async function resolveRecruiterUserIds(
  admin: SupabaseClient,
  extension: string,
  email: string,
): Promise<string[]> {
  const ids = new Set<string>();
  const ext = extension.trim();
  const normalizedEmail = email.trim().toLowerCase();

  if (ext) {
    const { data: settings } = await admin.from('pipeline_user_call_settings').select('user_id').eq('extension', ext);
    for (const row of settings || []) {
      if (row.user_id) ids.add(String(row.user_id));
    }
    const { data: profiles } = await admin.from('user_profiles').select('user_id').eq('extension', ext);
    for (const row of profiles || []) {
      if (row.user_id) ids.add(String(row.user_id));
    }
  }

  if (normalizedEmail) {
    const { data: byEmail } = await admin.from('user_profiles').select('user_id').ilike('email', normalizedEmail);
    for (const row of byEmail || []) {
      if (row.user_id) ids.add(String(row.user_id));
    }
  }

  return [...ids];
}

type CallRecordRow = {
  id: string;
  dialed_number: string;
  recruiter_user_id: string | null;
  disposed_at: string;
  recording_url?: string | null;
  threecx_metadata: Record<string, unknown> | null;
};

type MatchWindow = {
  beforeMs: number;
  afterMs: number;
};

const LIVE_MATCH_WINDOW: MatchWindow = { beforeMs: 90 * 60 * 1000, afterMs: 15 * 60 * 1000 };
const REPLAY_MATCH_WINDOW: MatchWindow = { beforeMs: 30 * 60 * 1000, afterMs: 3 * 60 * 60 * 1000 };

async function findCallRecordCandidates(
  admin: SupabaseClient,
  input: {
    phoneNumber: string;
    anchorMs: number;
    recruiterIds: string[];
    allowAnyRecruiter: boolean;
    onlyWithoutRecording: boolean;
    window: MatchWindow;
  },
): Promise<CallRecordRow[]> {
  const windowStart = new Date(input.anchorMs - input.window.beforeMs).toISOString();
  const windowEnd = new Date(input.anchorMs + input.window.afterMs).toISOString();

  let query = admin
    .from('pipeline_call_records')
    .select('id, dialed_number, recruiter_user_id, disposed_at, recording_url, threecx_metadata, threecx_call_id')
    .gte('disposed_at', windowStart)
    .lte('disposed_at', windowEnd)
    .order('disposed_at', { ascending: false })
    .limit(120);

  if (!input.allowAnyRecruiter) {
    if (input.recruiterIds.length === 1) {
      query = query.eq('recruiter_user_id', input.recruiterIds[0]);
    } else if (input.recruiterIds.length > 1) {
      query = query.in('recruiter_user_id', input.recruiterIds);
    }
  }

  const { data: rows, error } = await query;
  if (error) throw error;

  return (rows || []).filter((row: CallRecordRow) => {
    if (input.onlyWithoutRecording) {
      const hasRecording = Boolean(String(row.recording_url || '').trim());
      if (hasRecording) return false;
    }
    if (input.phoneNumber && phonesMatch(input.phoneNumber, String(row.dialed_number || ''))) {
      return true;
    }
    return false;
  });
}

async function findByExtensionAndTime(
  admin: SupabaseClient,
  input: {
    anchorMs: number;
    recruiterIds: string[];
    window: MatchWindow;
  },
): Promise<CallRecordRow[]> {
  if (!input.recruiterIds.length) return [];
  const windowStart = new Date(input.anchorMs - input.window.beforeMs).toISOString();
  const windowEnd = new Date(input.anchorMs + input.window.afterMs).toISOString();

  let query = admin
    .from('pipeline_call_records')
    .select('id, dialed_number, recruiter_user_id, disposed_at, recording_url, threecx_metadata, threecx_call_id')
    .gte('disposed_at', windowStart)
    .lte('disposed_at', windowEnd)
    .is('recording_url', null)
    .order('disposed_at', { ascending: false })
    .limit(20);

  if (input.recruiterIds.length === 1) {
    query = query.eq('recruiter_user_id', input.recruiterIds[0]);
  } else {
    query = query.in('recruiter_user_id', input.recruiterIds);
  }

  const { data: rows, error } = await query;
  if (error) throw error;
  return rows || [];
}

async function pickBestCandidate(
  candidates: CallRecordRow[],
  anchorMs: number,
): Promise<CallRecordRow | null> {
  if (!candidates.length) return null;
  return candidates.reduce((prev, curr) => {
    const prevDelta = Math.abs(new Date(prev.disposed_at).getTime() - anchorMs);
    const currDelta = Math.abs(new Date(curr.disposed_at).getTime() - anchorMs);
    return currDelta < prevDelta ? curr : prev;
  });
}

export async function attachRecordingToCallRecord(
  admin: SupabaseClient,
  input: {
    phoneNumber: string;
    agentExtension: string;
    agentEmail: string;
    recordingUrl: string | null;
    callId: string | null;
    durationSeconds: number | null;
    anchorIso: string;
    reportMeta?: Record<string, unknown>;
    replayMode?: boolean;
  },
): Promise<{ matched: boolean; callRecordId?: string; reason?: string }> {
  const recruiterIds = await resolveRecruiterUserIds(admin, input.agentExtension, input.agentEmail);
  const anchorMs = new Date(input.anchorIso).getTime();
  if (Number.isNaN(anchorMs)) {
    return { matched: false, reason: 'invalid_anchor_time' };
  }

  const window = input.replayMode ? REPLAY_MATCH_WINDOW : LIVE_MATCH_WINDOW;
  const phone = String(input.phoneNumber || '').trim();

  let candidates = await findCallRecordCandidates(admin, {
    phoneNumber: phone,
    anchorMs,
    recruiterIds,
    allowAnyRecruiter: false,
    onlyWithoutRecording: Boolean(input.replayMode),
    window,
  });
  if (!candidates.length && recruiterIds.length > 0) {
    candidates = await findCallRecordCandidates(admin, {
      phoneNumber: phone,
      anchorMs,
      recruiterIds,
      allowAnyRecruiter: true,
      onlyWithoutRecording: Boolean(input.replayMode),
      window,
    });
  }

  // Replay: extension + closest disposition without recording (disposition often saved after hangup).
  if (!candidates.length && input.replayMode && recruiterIds.length > 0) {
    const byTime = await findByExtensionAndTime(admin, { anchorMs, recruiterIds, window });
    const best = await pickBestCandidate(byTime, anchorMs);
    if (best) candidates = [best];
  }

  if (!candidates.length) {
    return { matched: false, reason: 'no_call_record_match' };
  }

  const best = await pickBestCandidate(candidates, anchorMs);
  if (!best) return { matched: false, reason: 'no_call_record_match' };

  const existingMeta =
    best.threecx_metadata && typeof best.threecx_metadata === 'object'
      ? best.threecx_metadata
      : {};

  const patch: Record<string, unknown> = {
    threecx_metadata: {
      ...existingMeta,
      threecx_call_id: input.callId,
      recording_url: input.recordingUrl || existingMeta.recording_url || null,
      duration_seconds: input.durationSeconds,
      threecx_report: {
        ...(input.reportMeta || {}),
        received_at: new Date().toISOString(),
      },
    },
  };
  if (input.recordingUrl) patch.recording_url = input.recordingUrl;
  if (input.callId) patch.threecx_call_id = input.callId;
  if (input.durationSeconds != null) patch.duration_seconds = input.durationSeconds;

  const { error: updateError } = await admin.from('pipeline_call_records').update(patch).eq('id', best.id);
  if (updateError) throw updateError;

  return { matched: true, callRecordId: best.id };
}
