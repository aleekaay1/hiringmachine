import { supabase } from './supabaseClient';
import type { AppRole, UserProfile } from './accessControl';
import { listAllUserProfiles } from './accessControl';
import {
  computeLeadershipTeamMetricsLive,
  loadRecruiterPersonalMetrics,
  type LeadershipTeamMetrics,
  type RecruiterPersonalMetrics,
} from './dashboardPersonalMetrics';
import { loadRecruiterCoinWallet, type RecruiterCoinWallet } from './recruiterCoinService';
import { buildLeaderboardWindows } from './pipelineLeaderboard';
import { loadScopedWebinarRowsForViewer } from './pipelineBookedOutcomes';
import { fmtHrScheduledDateKey } from './webinarGeekRecruiterAnalytics';

const TABLE = 'user_home_dashboard_snapshots';
const LOCAL_PREFIX = 'pohiring_home_dashboard_v1:';

export type HomeDashboardPayload =
  | { kind: 'recruiter'; metrics: RecruiterPersonalMetrics; wallet: RecruiterCoinWallet | null }
  | { kind: 'leadership'; metrics: LeadershipTeamMetrics }
  | { kind: 'admin'; metrics: LeadershipTeamMetrics; roleCounts: Record<string, number> }
  | { kind: 'webinar'; booked: number; attended: number; windowLabel: string };

export type HomeDashboardRecord = {
  payload: HomeDashboardPayload;
  fetchedAt: string;
  fromCache: boolean;
};

function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === 'PGRST205') return true;
  const m = error.message || '';
  return /user_home_dashboard_snapshots/i.test(m) && /schema cache|does not exist/i.test(m);
}

function readLocal(userId: string): HomeDashboardRecord | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`${LOCAL_PREFIX}${userId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { payload: HomeDashboardPayload; fetchedAt: string };
    if (!parsed?.payload?.kind) return null;
    return { payload: parsed.payload, fetchedAt: parsed.fetchedAt, fromCache: true };
  } catch {
    return null;
  }
}

function writeLocal(userId: string, payload: HomeDashboardPayload, fetchedAt: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`${LOCAL_PREFIX}${userId}`, JSON.stringify({ payload, fetchedAt }));
  } catch {
    // ignore
  }
}

export async function loadHomeDashboardCache(userId: string): Promise<HomeDashboardRecord | null> {
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select('payload, fetched_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (!error && data?.payload && typeof data.payload === 'object') {
      const payload = data.payload as HomeDashboardPayload;
      if (payload.kind) {
        const fetchedAt = String(data.fetched_at || new Date().toISOString());
        writeLocal(userId, payload, fetchedAt);
        return { payload, fetchedAt, fromCache: true };
      }
    }
    if (error && !isMissingTableError(error)) {
      console.warn('loadHomeDashboardCache:', error.message);
    }
  } catch {
    // fall through to local
  }
  return readLocal(userId);
}

export async function saveHomeDashboardCache(
  userId: string,
  role: AppRole,
  payload: HomeDashboardPayload,
): Promise<void> {
  const now = new Date().toISOString();
  writeLocal(userId, payload, now);
  const { error } = await supabase.from(TABLE).upsert(
    {
      user_id: userId,
      role,
      payload,
      fetched_at: now,
      updated_at: now,
    },
    { onConflict: 'user_id' },
  );
  if (error && !isMissingTableError(error)) {
    console.warn('saveHomeDashboardCache:', error.message);
  }
}

async function refreshWebinarStaffPayload(profile: UserProfile): Promise<HomeDashboardPayload> {
  const windows = buildLeaderboardWindows('last7');
  const rows = await loadScopedWebinarRowsForViewer({
    role: 'webinar',
    viewerEmail: profile.email ?? null,
    viewerFullName: profile.full_name,
  });
  const since = windows.current.sinceYmd;
  const until = windows.current.untilYmd;
  let booked = 0;
  let attended = 0;
  for (const row of rows) {
    const key = fmtHrScheduledDateKey(row);
    if (key === 'unknown' || key < since || key > until) continue;
    booked += 1;
    if (row.watched === true) attended += 1;
  }
  return { kind: 'webinar', booked, attended, windowLabel: windows.current.label };
}

export async function refreshHomeDashboard(profile: UserProfile): Promise<HomeDashboardRecord> {
  let payload: HomeDashboardPayload;

  switch (profile.role) {
    case 'recruiter': {
      const [metrics, wallet] = await Promise.all([
        loadRecruiterPersonalMetrics(profile),
        loadRecruiterCoinWallet({
          profileBalance: Number(profile.points || 0),
          email: profile.email,
          fullName: profile.full_name,
        }),
      ]);
      payload = { kind: 'recruiter', metrics, wallet };
      break;
    }
    case 'leadership': {
      const metrics = (await computeLeadershipTeamMetricsLive()) ?? {
        windowLabel: buildLeaderboardWindows('last7').current.label,
        teamSize: 0,
        totalWebinarBooked: 0,
        totalWebinarShowed: 0,
        totalLiveBooked: 0,
        totalLiveShowed: 0,
        totalCalls: 0,
        totalBooked: 0,
        showRatePct: 0,
        topPerformers: [],
        performerBars: [],
        refreshedAt: null,
      };
      payload = { kind: 'leadership', metrics };
      break;
    }
    case 'admin': {
      const [metrics, profiles] = await Promise.all([
        computeLeadershipTeamMetricsLive(),
        listAllUserProfiles().catch(() => []),
      ]);
      const roleCounts: Record<string, number> = {};
      for (const p of profiles) {
        roleCounts[p.role] = (roleCounts[p.role] || 0) + 1;
      }
      payload = {
        kind: 'admin',
        metrics: metrics ?? {
          windowLabel: buildLeaderboardWindows('last7').current.label,
          teamSize: 0,
          totalWebinarBooked: 0,
          totalWebinarShowed: 0,
          totalLiveBooked: 0,
          totalLiveShowed: 0,
          totalCalls: 0,
          totalBooked: 0,
          showRatePct: 0,
          topPerformers: [],
          performerBars: [],
          refreshedAt: null,
        },
        roleCounts,
      };
      break;
    }
    case 'webinar':
      payload = await refreshWebinarStaffPayload(profile);
      break;
    default:
      throw new Error('This role does not use a refreshable home dashboard.');
  }

  const fetchedAt = new Date().toISOString();
  await saveHomeDashboardCache(profile.user_id, profile.role, payload);
  return { payload, fetchedAt, fromCache: false };
}

export function homeDashboardSupportsRefresh(role: AppRole): boolean {
  return role === 'recruiter' || role === 'leadership' || role === 'admin' || role === 'webinar';
}
