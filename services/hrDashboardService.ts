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

  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    return { ok: false, error: (json.error as string) || res.statusText || 'Request failed' };
  }
  return { ok: true, data: json };
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
  action: 'resolve_task' | 'resolve_risk' | 'set_candidate_stage' | 'set_candidate_next_step' | 'create_task',
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
  },
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  return callFn('hr-dashboard-data', accessToken, {
    method: 'POST',
    body: JSON.stringify({ action, ...payload }),
  });
}

