import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { RECRUITER_3CX_EXTENSIONS } from './recruiter3cxExtensions.ts';
import { threeCxTranscriptMetaPatch } from './threecxTranscript.ts';

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

export function phonesMatch(a: string, b: string): boolean {
  const da = digitsOnly(a);
  const db = digitsOnly(b);
  if (!da || !db) return false;
  if (da.length >= 10 && db.length >= 10) return da.slice(-10) === db.slice(-10);
  return da === db;
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

  if (!ids.size && ext) {
    const emails = RECRUITER_3CX_EXTENSIONS
      .filter((row) => row.extension.trim() === ext)
      .map((row) => row.email.trim().toLowerCase())
      .filter(Boolean);
    for (const mappedEmail of emails) {
      const { data: byMapped } = await admin.from('user_profiles').select('user_id').ilike('email', mappedEmail);
      for (const row of byMapped || []) {
        if (row.user_id) ids.add(String(row.user_id));
      }
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

/** Disposition is saved shortly after hangup — tight window with 30s slack. */
const BUFFER_BEFORE_MS = 30_000;
const BUFFER_AFTER_MS = 8 * 60_000;
const LIVE_BUFFER_AFTER_MS = 5 * 60_000;

function phoneLast10(phoneNumber: string): string {
  const digits = digitsOnly(phoneNumber);
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function rowHasRecording(row: CallRecordRow): boolean {
  if (String(row.recording_url || '').trim()) return true;
  const meta = row.threecx_metadata && typeof row.threecx_metadata === 'object'
    ? row.threecx_metadata as Record<string, unknown>
    : {};
  return Boolean(String(meta.recording_url || '').trim());
}

async function recordingUrlAlreadyUsed(
  admin: SupabaseClient,
  recordingUrl: string,
  excludeId?: string,
): Promise<boolean> {
  let query = admin
    .from('pipeline_call_records')
    .select('id')
    .eq('recording_url', recordingUrl)
    .limit(1);
  if (excludeId) query = query.neq('id', excludeId);
  const { data, error } = await query;
  if (error) throw error;
  return Boolean(data?.length);
}

/**
 * Match requires ALL of:
 * - customer phone (last 10 digits) matches dialed_number
 * - recruiter_user_id matches 3CX agent extension (or agent email)
 * - disposition time within ~30s before to 8m after call end
 */
async function findStrictMatch(
  admin: SupabaseClient,
  input: {
    phoneNumber: string;
    anchorMs: number;
    recruiterIds: string[];
    onlyWithoutRecording: boolean;
    bufferAfterMs: number;
    excludeRecordIds?: Set<string>;
  },
): Promise<CallRecordRow[]> {
  const last10 = phoneLast10(input.phoneNumber);
  if (last10.length < 10) return [];
  if (!input.recruiterIds.length) return [];

  const windowStart = new Date(input.anchorMs - BUFFER_BEFORE_MS).toISOString();
  const windowEnd = new Date(input.anchorMs + input.bufferAfterMs).toISOString();

  let query = admin
    .from('pipeline_call_records')
    .select('id, dialed_number, recruiter_user_id, disposed_at, recording_url, threecx_metadata, threecx_call_id')
    .gte('disposed_at', windowStart)
    .lte('disposed_at', windowEnd)
    .or(`dialed_number.ilike.%${last10},dialed_number.eq.${last10},dialed_number.eq.1${last10},dialed_number.eq.+1${last10}`)
    .order('disposed_at', { ascending: false })
    .limit(20);

  if (input.recruiterIds.length === 1) {
    query = query.eq('recruiter_user_id', input.recruiterIds[0]);
  } else {
    query = query.in('recruiter_user_id', input.recruiterIds);
  }

  const { data: rows, error } = await query;
  if (error) throw error;

  return (rows || []).filter((row: CallRecordRow) => {
    if (input.excludeRecordIds?.has(row.id)) return false;
    if (input.onlyWithoutRecording && rowHasRecording(row)) return false;
    if (!phonesMatch(input.phoneNumber, String(row.dialed_number || ''))) return false;
    if (!row.recruiter_user_id || !input.recruiterIds.includes(String(row.recruiter_user_id))) {
      return false;
    }
    const disposedMs = new Date(row.disposed_at).getTime();
    if (Number.isNaN(disposedMs)) return false;
    if (disposedMs < input.anchorMs - BUFFER_BEFORE_MS) return false;
    if (disposedMs > input.anchorMs + input.bufferAfterMs) return false;
    return true;
  });
}

function pickBestStrictMatch(candidates: CallRecordRow[], anchorMs: number): CallRecordRow | null {
  if (!candidates.length) return null;
  const afterCallEnd = candidates.filter((row) => {
    const disposedMs = new Date(row.disposed_at).getTime();
    return disposedMs >= anchorMs - BUFFER_BEFORE_MS;
  });
  const pool = afterCallEnd.length ? afterCallEnd : candidates;
  return pool.reduce((prev, curr) => {
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
    excludeRecordIds?: Set<string>;
    transcription?: string | null;
    summary?: string | null;
    sentiment?: string | null;
  },
): Promise<{ matched: boolean; callRecordId?: string; reason?: string }> {
  const anchorMs = new Date(input.anchorIso).getTime();
  if (Number.isNaN(anchorMs)) {
    return { matched: false, reason: 'invalid_anchor_time' };
  }

  const phone = String(input.phoneNumber || '').trim();
  if (phoneLast10(phone).length < 10) {
    return { matched: false, reason: 'missing_phone_number' };
  }

  const recruiterIds = await resolveRecruiterUserIds(
    admin,
    String(input.agentExtension || ''),
    String(input.agentEmail || ''),
  );
  if (!recruiterIds.length) {
    return { matched: false, reason: 'unknown_recruiter_extension' };
  }

  const bufferAfterMs = input.replayMode ? BUFFER_AFTER_MS : LIVE_BUFFER_AFTER_MS;
  const candidates = await findStrictMatch(admin, {
    phoneNumber: phone,
    anchorMs,
    recruiterIds,
    onlyWithoutRecording: Boolean(input.replayMode),
    bufferAfterMs,
    excludeRecordIds: input.excludeRecordIds,
  });

  if (!candidates.length) {
    return { matched: false, reason: 'no_phone_recruiter_time_match' };
  }

  const best = pickBestStrictMatch(candidates, anchorMs);
  if (!best) return { matched: false, reason: 'no_phone_recruiter_time_match' };

  if (input.recordingUrl) {
    const used = await recordingUrlAlreadyUsed(admin, input.recordingUrl, best.id);
    if (used) return { matched: false, reason: 'recording_already_assigned' };
  }

  const existingMeta =
    best.threecx_metadata && typeof best.threecx_metadata === 'object'
      ? best.threecx_metadata
      : {};

  const transcriptPatch = threeCxTranscriptMetaPatch({
    transcription: input.transcription || null,
    summary: input.summary || null,
    sentiment: input.sentiment || null,
  });

  const patch: Record<string, unknown> = {
    threecx_metadata: {
      ...existingMeta,
      threecx_call_id: input.callId,
      recording_url: input.recordingUrl || existingMeta.recording_url || null,
      duration_seconds: input.durationSeconds,
      match_phone: phoneLast10(phone),
      match_anchor: input.anchorIso,
      match_extension: String(input.agentExtension || ''),
      match_recruiter_ids: recruiterIds,
      threecx_report: {
        ...(input.reportMeta || {}),
        received_at: new Date().toISOString(),
        match_method: 'phone_recruiter_time',
      },
      ...transcriptPatch,
    },
  };
  if (input.recordingUrl) patch.recording_url = input.recordingUrl;
  if (input.callId) patch.threecx_call_id = input.callId;
  if (input.durationSeconds != null) patch.duration_seconds = input.durationSeconds;

  const { error: updateError } = await admin.from('pipeline_call_records').update(patch).eq('id', best.id);
  if (updateError) throw updateError;

  return { matched: true, callRecordId: best.id };
}
