import type { PerformanceCheckInInvite, PerformanceCheckInRow } from './performanceCheckInService';
import { supabase } from './supabaseClient';

export type CoachingHubEmailLogRow = {
  id: string;
  created_at: string;
  to_email: string;
  subject: string;
  status: string;
  metadata: Record<string, unknown> | null;
};

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

async function getAccessToken(): Promise<string | null> {
  const { data: sessionData } = await supabase.auth.getSession();
  return sessionData.session?.access_token ?? null;
}

async function coachingHubGet<T extends Record<string, unknown>>(
  params: Record<string, string>,
): Promise<{ ok: true } & T | { ok: false; error: string }> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { ok: false, error: 'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY' };
  }

  const token = await getAccessToken();
  if (!token) return { ok: false, error: 'Not signed in' };

  const qs = new URLSearchParams(params).toString();
  const url = `${SUPABASE_URL}/functions/v1/coaching-hub-data?${qs}`;

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
      },
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, error: (json.error as string) || res.statusText || 'Request failed' };
    }
    return { ok: true, ...json } as { ok: true } & T;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function fetchCoachingWeekDataViaFunction(weekSince?: string | null): Promise<
  | { ok: true; invites: PerformanceCheckInInvite[]; forms: PerformanceCheckInRow[] }
  | { ok: false; error: string }
> {
  const params: Record<string, string> = { action: 'week' };
  if (weekSince) params.weekSince = weekSince;
  const result = await coachingHubGet<{ invites: PerformanceCheckInInvite[]; forms: PerformanceCheckInRow[] }>(
    params,
  );
  if (!result.ok) return result;
  return {
    ok: true,
    invites: Array.isArray(result.invites) ? result.invites : [],
    forms: Array.isArray(result.forms) ? result.forms : [],
  };
}

export async function fetchCoachingLadderViaFunction(
  userId: string,
  limit = 10,
): Promise<
  | {
      ok: true;
      forms: PerformanceCheckInRow[];
      invites: Array<{
        week_since: string;
        week_until: string;
        calls_pace_pct: number | null;
        bookings_pace_pct: number | null;
        below_threshold: boolean;
        actual_calls: number;
        actual_booked: number;
      }>;
    }
  | { ok: false; error: string }
> {
  const result = await coachingHubGet<{
    forms: PerformanceCheckInRow[];
    invites: Array<{
      week_since: string;
      week_until: string;
      calls_pace_pct: number | null;
      bookings_pace_pct: number | null;
      below_threshold: boolean;
      actual_calls: number;
      actual_booked: number;
    }>;
  }>({
    action: 'ladder',
    userId,
    limit: String(limit),
  });
  if (!result.ok) return result;
  return {
    ok: true,
    forms: Array.isArray(result.forms) ? result.forms : [],
    invites: Array.isArray(result.invites) ? result.invites : [],
  };
}

export type CoachingFullBoardPayload = {
  weekInvites: PerformanceCheckInInvite[];
  weekForms: PerformanceCheckInRow[];
  historyForms: PerformanceCheckInRow[];
  historyInvites: PerformanceCheckInInvite[];
  emailLogs: CoachingHubEmailLogRow[];
};

export type ParticipantFormPayload = {
  inviteId: string | null;
  fromInvite: boolean;
  alreadySubmitted: boolean;
  weekSince: string;
  weekUntil: string;
  dailyCallTarget: number | null;
  dailyBookingTarget: number | null;
  elapsedDays: number | null;
  actualCalls: number;
  actualBooked: number;
  expectedCalls: number | null;
  expectedBookings: number | null;
  callsPacePct: number | null;
  bookingsPacePct: number | null;
};

export async function fetchParticipantFormViaFunction(input: {
  token?: string;
  weekSince: string;
  weekUntil: string;
}): Promise<{ ok: true; data: ParticipantFormPayload } | { ok: false; error: string }> {
  const params: Record<string, string> = {
    action: 'participantForm',
    weekSince: input.weekSince,
    weekUntil: input.weekUntil,
  };
  if (input.token) params.token = input.token;
  const result = await coachingHubGet<ParticipantFormPayload>(params);
  if (!result.ok) return result;
  const { ok: _ignored, ...data } = result;
  return { ok: true, data: data as ParticipantFormPayload };
}

export async function fetchCoachingFullBoardViaFunction(input: {
  weekSince: string;
  historySince: string;
  emailLimit?: number;
}): Promise<{ ok: true; data: CoachingFullBoardPayload } | { ok: false; error: string }> {
  const result = await coachingHubGet<CoachingFullBoardPayload>({
    action: 'fullBoard',
    weekSince: input.weekSince,
    historySince: input.historySince,
    emailLimit: String(input.emailLimit ?? 30),
  });
  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      weekInvites: Array.isArray(result.weekInvites) ? result.weekInvites : [],
      weekForms: Array.isArray(result.weekForms) ? result.weekForms : [],
      historyForms: Array.isArray(result.historyForms) ? result.historyForms : [],
      historyInvites: Array.isArray(result.historyInvites) ? result.historyInvites : [],
      emailLogs: Array.isArray(result.emailLogs) ? result.emailLogs : [],
    },
  };
}

export async function fetchCoachingEmailLogsViaFunction(limit = 30): Promise<
  | { ok: true; logs: CoachingHubEmailLogRow[] }
  | { ok: false; error: string }
> {
  const result = await coachingHubGet<{ logs: CoachingHubEmailLogRow[] }>({
    action: 'emailLogs',
    limit: String(limit),
  });
  if (!result.ok) return result;
  return {
    ok: true,
    logs: Array.isArray(result.logs) ? result.logs : [],
  };
}
