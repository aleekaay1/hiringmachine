import { supabase } from './supabaseClient';
import type { RecruiterLeaderboardRow } from './pipelineLeaderboard';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export type WeeklyLeaderboardEmailPayload = {
  windowLabel: string;
  periodKey: string;
  fetchedAt: string | null;
  rows: Array<{
    rank: number;
    displayName: string;
    score: number;
    calls: number;
    webinarBooked: number;
    webinarShowed: number;
    liveSessionBooked: number;
    liveSessionShowed: number;
    showRatio: number;
    rankDelta: number;
    periodCoins: number;
    coinBalance: number;
    badges: string[];
  }>;
  topPerformerName: string | null;
  fastClimberName: string | null;
  consistentCloserName: string | null;
  previousTopPerformerName: string | null;
};

export type SendWeeklyLeaderboardEmailResult =
  | { ok: true; to: string; subject: string; rowCount: number }
  | { ok: false; error: string };

export function buildWeeklyLeaderboardEmailPayload(input: {
  windowLabel: string;
  periodKey: string;
  fetchedAt: string | null;
  rows: RecruiterLeaderboardRow[];
  topPerformerName: string | null;
  fastClimberName: string | null;
  consistentCloserName: string | null;
  previousTopPerformerName: string | null;
  periodCoinsForRow: (row: RecruiterLeaderboardRow) => number;
  coinBalanceForRow: (row: RecruiterLeaderboardRow) => number;
}): WeeklyLeaderboardEmailPayload {
  return {
    windowLabel: input.windowLabel,
    periodKey: input.periodKey,
    fetchedAt: input.fetchedAt,
    topPerformerName: input.topPerformerName,
    fastClimberName: input.fastClimberName,
    consistentCloserName: input.consistentCloserName,
    previousTopPerformerName: input.previousTopPerformerName,
    rows: [...input.rows]
      .sort((a, b) => a.rank - b.rank)
      .map((row) => ({
        rank: row.rank,
        displayName: row.displayName,
        score: row.score,
        calls: row.calls,
        webinarBooked: row.webinarBooked,
        webinarShowed: row.webinarShowed,
        liveSessionBooked: row.liveSessionBooked,
        liveSessionShowed: row.liveSessionShowed,
        showRatio: row.showRatio,
        rankDelta: row.rankDelta,
        periodCoins: input.periodCoinsForRow(row),
        coinBalance: input.coinBalanceForRow(row),
        badges: row.badges,
      })),
  };
}

export async function sendWeeklyLeaderboardEmail(
  payload: WeeklyLeaderboardEmailPayload,
): Promise<SendWeeklyLeaderboardEmailResult> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { ok: false, error: 'App not configured' };
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) {
    return { ok: false, error: 'Not signed in' };
  }

  const appUrl =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'https://paz-talent-journey.vercel.app';

  const res = await fetch(`${SUPABASE_URL}/functions/v1/send-weekly-leaderboard-email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ ...payload, appUrl }),
  });

  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    to?: string;
    subject?: string;
    rowCount?: number;
  };

  if (!res.ok) {
    return { ok: false, error: json.error || `Request failed (${res.status})` };
  }

  return {
    ok: true,
    to: String(json.to || ''),
    subject: String(json.subject || ''),
    rowCount: Number(json.rowCount) || payload.rows.length,
  };
}
