const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export interface HrDashboardPayload {
  generated_at: string;
  summary: Record<string, unknown>;
  stage_breakdown?: Array<Record<string, unknown>>;
  action_queue?: Array<Record<string, unknown>>;
  live_metrics?: Record<string, unknown>;
  webinar_metrics?: Record<string, unknown>;
  candidates: Array<Record<string, unknown>>;
  open_tasks: Array<Record<string, unknown>>;
  active_risks: Array<Record<string, unknown>>;
  funnel_daily: Array<Record<string, unknown>>;
  cohorts: Array<Record<string, unknown>>;
}

function fnUrl(name: string): string | null {
  if (!SUPABASE_URL) return null;
  return `${SUPABASE_URL}/functions/v1/${name}`;
}

function normalizeUnknownError(input: unknown): string {
  if (typeof input === 'string') {
    const text = input.trim();
    if (!text) return 'Unknown error';
    return text;
  }
  if (input instanceof Error) {
    return input.message || input.name || 'Unknown error';
  }
  if (!input) return 'Unknown error';
  if (typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    const keys = ['error', 'message', 'details', 'hint', 'msg'] as const;
    for (const key of keys) {
      const value = obj[key];
      if (typeof value === 'string' && value.trim()) return value;
      if (value && typeof value === 'object') {
        const nested = normalizeUnknownError(value);
        if (nested && nested !== 'Unknown error') return nested;
      }
    }
    try {
      const text = JSON.stringify(obj);
      if (text && text !== '{}' && text !== '[]') return text;
    } catch {
      // ignore stringify failures
    }
  }
  return String(input) || 'Unknown error';
}

async function callFn(
  name: string,
  token: string,
  init: RequestInit = {},
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { ok: false, error: 'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY' };
  }
  const url = fnUrl(name);
  if (!url) return { ok: false, error: 'Missing function URL' };

  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
    });
    const rawText = await res.text().catch(() => '');
    let json: Record<string, unknown> = {};
    if (rawText) {
      try {
        json = JSON.parse(rawText) as Record<string, unknown>;
      } catch {
        json = { message: rawText };
      }
    }
    if (!res.ok) {
      return {
        ok: false,
        error: normalizeUnknownError(json.error ?? json.message ?? rawText) || res.statusText || `Request failed (${res.status})`,
      };
    }
    return { ok: true, data: json };
  } catch (error) {
    return { ok: false, error: normalizeUnknownError(error) };
  }
}

export async function fetchHrDashboard(
  accessToken: string,
): Promise<{ ok: true; data: HrDashboardPayload } | { ok: false; error: string }> {
  const res = await callFn('hr-dashboard-data', accessToken, { method: 'GET' });
  if (!res.ok) return res;
  return { ok: true, data: res.data as unknown as HrDashboardPayload };
}

export async function runHrRollup(
  accessToken: string,
  dryRun = true,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  return callFn('hr-rollup-jobs', accessToken, {
    method: 'POST',
    body: JSON.stringify({ dry_run: dryRun }),
  });
}

export async function runHrAutomation(
  accessToken: string,
  dryRun = true,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  return callFn('hr-automation-runner', accessToken, {
    method: 'POST',
    body: JSON.stringify({ dry_run: dryRun }),
  });
}

export async function hrDashboardAction(
  accessToken: string,
  action: 'resolve_task' | 'resolve_risk' | 'set_candidate_stage' | 'set_candidate_next_step' | 'create_task' | 'set_candidate_interview',
  payload: {
    task_id?: number;
    risk_id?: number;
    candidate_id?: string;
    stage?: string;
    next_step?: string;
    task_type?: string;
    priority?: string;
    title?: string;
    details?: string;
    interview_at?: string;
    interview_comment?: string;
  },
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  return callFn('hr-dashboard-data', accessToken, {
    method: 'POST',
    body: JSON.stringify({ action, ...payload }),
  });
}

