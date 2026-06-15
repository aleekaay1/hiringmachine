import type { PipelineEmailSendLog, PipelineIncomingEmailLog } from './pipelineService';
import { supabase } from './supabaseClient';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

async function getAccessToken(): Promise<string | null> {
  const { data: sessionData } = await supabase.auth.getSession();
  return sessionData.session?.access_token ?? null;
}

async function postEmailWorkspace<T extends Record<string, unknown>>(
  body: Record<string, unknown>,
): Promise<{ ok: true } & T | { ok: false; error: string }> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { ok: false, error: 'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY' };
  }

  const token = await getAccessToken();
  if (!token) return { ok: false, error: 'Not signed in' };

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/email-inbox-sync`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const err =
        typeof json.error === 'string'
          ? json.error
          : typeof json.message === 'string'
            ? json.message
            : `Request failed (${res.status})`;
      return { ok: false, error: err };
    }
    return { ok: true, ...json } as { ok: true } & T;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function fetchCandidateMailLogsViaFunction(input: {
  candidateId: string;
  emails?: string[];
  limit?: number;
}): Promise<
  | { ok: true; incoming: PipelineIncomingEmailLog[]; sendLogs: PipelineEmailSendLog[] }
  | { ok: false; error: string }
> {
  const result = await postEmailWorkspace<{
    incoming: PipelineIncomingEmailLog[];
    sendLogs: PipelineEmailSendLog[];
  }>({
    action: 'list',
    candidateId: input.candidateId,
    emails: input.emails || [],
    limit: input.limit ?? 1000,
  });
  if (!result.ok) return result;
  return {
    ok: true,
    incoming: Array.isArray(result.incoming) ? result.incoming : [],
    sendLogs: Array.isArray(result.sendLogs) ? result.sendLogs : [],
  };
}
