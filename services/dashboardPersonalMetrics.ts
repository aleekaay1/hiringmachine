import type { UserProfile } from './accessControl';
import { loadLeaderboardSnapshot } from './pipelineLeaderboardCache';
import { loadScopedWebinarRowsForViewer } from './pipelineBookedOutcomes';
import {
  buildLiveSessionRowsByEmail,
  buildLiveSessionRowsByPhone,
  loadCandidateEmailsById,
  loadCandidatePhonesById,
  loadLiveSessionRegistrantsForMatching,
} from './liveSessionBookedOutcomes';
import {
  buildCompositeLeaderboard,
  buildLeaderboardWindows,
  seedsFromProfiles,
  type RecruiterLeaderboardRow,
} from './pipelineLeaderboard';
import {
  getPipelineUserCallSettings,
  listPipelineCallRecords,
  type PipelineUserCallSettings,
} from './pipelineService';
import { listAllUserProfiles } from './accessControl';
import { fmtHrScheduledDateKey } from './webinarGeekRecruiterAnalytics';

export type RecruiterPersonalMetrics = {
  windowLabel: string;
  calls: number;
  bookedCalls: number;
  webinarBooked: number;
  webinarShowed: number;
  liveSessionBooked: number;
  liveSessionShowed: number;
  showRatio: number;
  score: number;
  rank: number | null;
  rankDelta: number;
  uploadGoal: number | null;
  webinarGoal: number | null;
  settings: PipelineUserCallSettings | null;
};

export type AdminPerformerBar = {
  name: string;
  booked: number;
  showed: number;
  calls: number;
  score: number;
};

export type LeadershipTeamMetrics = {
  windowLabel: string;
  teamSize: number;
  totalWebinarBooked: number;
  totalWebinarShowed: number;
  totalLiveBooked: number;
  totalLiveShowed: number;
  totalCalls: number;
  /** Combined webinar + live bookings */
  totalBooked: number;
  /** 0–100, combined show rate */
  showRatePct: number;
  topPerformers: RecruiterLeaderboardRow[];
  performerBars: AdminPerformerBar[];
  refreshedAt: string | null;
};

function summarizeLeaderboardRows(rows: RecruiterLeaderboardRow[]): Omit<
  LeadershipTeamMetrics,
  'windowLabel' | 'topPerformers' | 'performerBars' | 'refreshedAt'
> {
  const totalWebinarBooked = rows.reduce((s, r) => s + r.webinarBooked, 0);
  const totalWebinarShowed = rows.reduce((s, r) => s + r.webinarShowed, 0);
  const totalLiveBooked = rows.reduce((s, r) => s + (r.liveSessionBooked ?? 0), 0);
  const totalLiveShowed = rows.reduce((s, r) => s + (r.liveSessionShowed ?? 0), 0);
  const totalBooked = totalWebinarBooked + totalLiveBooked;
  const totalShowed = totalWebinarShowed + totalLiveShowed;
  const showRatePct = totalBooked > 0 ? Math.round((100 * totalShowed) / totalBooked) : 0;

  return {
    teamSize: rows.length,
    totalWebinarBooked,
    totalWebinarShowed,
    totalLiveBooked,
    totalLiveShowed,
    totalCalls: rows.reduce((s, r) => s + r.calls, 0),
    totalBooked,
    showRatePct,
  };
}

function performerBarsFromRows(rows: RecruiterLeaderboardRow[], limit = 6): AdminPerformerBar[] {
  return [...rows]
    .sort((a, b) => {
      const bookedA = a.webinarBooked + (a.liveSessionBooked ?? 0);
      const bookedB = b.webinarBooked + (b.liveSessionBooked ?? 0);
      if (bookedB !== bookedA) return bookedB - bookedA;
      return b.score - a.score;
    })
    .slice(0, limit)
    .map((r) => ({
      name: r.displayName,
      booked: r.webinarBooked + (r.liveSessionBooked ?? 0),
      showed: r.webinarShowed + (r.liveSessionShowed ?? 0),
      calls: r.calls,
      score: r.score,
    }));
}

export async function loadRecruiterPersonalMetrics(profile: UserProfile): Promise<RecruiterPersonalMetrics> {
  const windows = buildLeaderboardWindows('last7');
  const userId = profile.user_id;

  const [records, settings, snapshot, webinarRows, liveRegistrants] = await Promise.all([
    listPipelineCallRecords({
      recruiterUserId: userId,
      fromIso: windows.current.fromIso,
      toIso: windows.current.toIso,
      limit: 5000,
    }),
    getPipelineUserCallSettings().catch(() => null),
    loadLeaderboardSnapshot('last7'),
    loadScopedWebinarRowsForViewer({
      role: 'recruiter',
      viewerEmail: profile.email ?? null,
      viewerFullName: profile.full_name,
    }),
    loadLiveSessionRegistrantsForMatching().catch(() => []),
  ]);
  const candidateIds = [...new Set(records.map((r) => r.candidate_id).filter(Boolean))];
  const [candidateEmailById, candidatePhoneById] = await Promise.all([
    loadCandidateEmailsById(candidateIds).catch(() => new Map<string, string>()),
    loadCandidatePhonesById(candidateIds).catch(() => new Map<string, string>()),
  ]);
  const liveSessionByEmail = buildLiveSessionRowsByEmail(liveRegistrants);
  const liveSessionByPhone = buildLiveSessionRowsByPhone(liveRegistrants);

  const sinceYmd = windows.current.sinceYmd;
  const untilYmd = windows.current.untilYmd;
  let webinarBooked = 0;
  let webinarShowed = 0;
  for (const row of webinarRows) {
    const key = fmtHrScheduledDateKey(row);
    if (key === 'unknown' || key < sinceYmd || key > untilYmd) continue;
    webinarBooked += 1;
    if (row.watched === true) webinarShowed += 1;
    else {
      const sec = Number(row.watch_duration || 0);
      if (Number.isFinite(sec) && sec >= Math.floor(47 * 60 * 0.5)) webinarShowed += 1;
    }
  }

  const bookedCalls = records.filter((r) => String(r.disposition || '').toLowerCase() === 'booked').length;
  const showRatio = webinarBooked > 0 ? webinarShowed / webinarBooked : 0;

  let rank: number | null = null;
  let rankDelta = 0;
  let score = 0;
  let liveSessionBooked = 0;
  let liveSessionShowed = 0;

  if (snapshot.data?.rows.length) {
    const mine = snapshot.data.rows.find((r) => r.recruiterUserId === userId);
    if (mine) {
      rank = mine.rank;
      rankDelta = mine.rankDelta;
      score = mine.score;
      webinarBooked = mine.webinarBooked;
      webinarShowed = mine.webinarShowed;
      liveSessionBooked = mine.liveSessionBooked ?? 0;
      liveSessionShowed = mine.liveSessionShowed ?? 0;
    }
  } else {
    const directory = new Map([[userId, { fullName: profile.full_name, email: profile.email ?? null }]]);
    const seeds = seedsFromProfiles([profile]);
    const rows = buildCompositeLeaderboard({
      webinarRows: webinarRows as Array<Record<string, unknown>>,
      currentWindow: windows.current,
      previousWindow: windows.previous,
      currentRecords: records,
      previousRecords: [],
      recruiterDirectory: directory,
      recruiterSeeds: seeds,
      candidateEmailById,
      candidatePhoneById,
      liveSessionByEmail,
      liveSessionByPhone,
      restrictToUserIds: [userId],
    });
    const mine = rows[0];
    if (mine) {
      rank = mine.rank;
      rankDelta = mine.rankDelta;
      score = mine.score;
      webinarBooked = mine.webinarBooked;
      webinarShowed = mine.webinarShowed;
      liveSessionBooked = mine.liveSessionBooked;
      liveSessionShowed = mine.liveSessionShowed;
    }
  }

  const totalBooked = webinarBooked + liveSessionBooked;
  const totalShowed = webinarShowed + liveSessionShowed;
  const combinedShowRatio = totalBooked > 0 ? totalShowed / totalBooked : showRatio;

  return {
    windowLabel: windows.current.label,
    calls: records.length,
    bookedCalls,
    webinarBooked,
    webinarShowed,
    liveSessionBooked,
    liveSessionShowed,
    showRatio: combinedShowRatio,
    score,
    rank,
    rankDelta,
    uploadGoal: settings?.daily_upload_target ?? null,
    webinarGoal: settings?.daily_webinar_booking_target ?? null,
    settings,
  };
}

function emptyTeamMetrics(windowLabel: string, teamSize = 0): LeadershipTeamMetrics {
  return {
    windowLabel,
    teamSize,
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
}

export async function computeLeadershipTeamMetricsLive(): Promise<LeadershipTeamMetrics | null> {
  try {
    const windows = buildLeaderboardWindows('last7');
    const [currentRecords, profiles, scopedWebinarRows, liveRegistrants] = await Promise.all([
      listPipelineCallRecords({
        fromIso: windows.current.fromIso,
        toIso: windows.current.toIso,
        limit: 6000,
      }),
      listAllUserProfiles().catch(() => []),
      loadScopedWebinarRowsForViewer({
        role: 'admin',
        viewerEmail: null,
        viewerFullName: null,
      }),
      loadLiveSessionRegistrantsForMatching().catch(() => []),
    ]);

    const candidateIds = [...new Set(currentRecords.map((r) => r.candidate_id).filter(Boolean))];
    const [candidateEmailById, candidatePhoneById] = await Promise.all([
      loadCandidateEmailsById(candidateIds).catch(() => new Map<string, string>()),
      loadCandidatePhonesById(candidateIds).catch(() => new Map<string, string>()),
    ]);
    const liveSessionByEmail = buildLiveSessionRowsByEmail(liveRegistrants);
    const liveSessionByPhone = buildLiveSessionRowsByPhone(liveRegistrants);
    const recruiterDirectory = new Map(
      profiles.map((item) => [item.user_id, { fullName: item.full_name, email: item.email ?? null }]),
    );
    const rows = buildCompositeLeaderboard({
      webinarRows: scopedWebinarRows as Array<Record<string, unknown>>,
      currentWindow: windows.current,
      previousWindow: windows.previous,
      currentRecords,
      previousRecords: [],
      recruiterDirectory,
      recruiterSeeds: seedsFromProfiles(profiles),
      candidateEmailById,
      candidatePhoneById,
      liveSessionByEmail,
      liveSessionByPhone,
    });

    if (!rows.length) return null;
    const summary = summarizeLeaderboardRows(rows);
    return {
      windowLabel: windows.current.label,
      ...summary,
      topPerformers: rows.slice(0, 8),
      performerBars: performerBarsFromRows(rows),
      refreshedAt: null,
    };
  } catch {
    return null;
  }
}

export async function loadLeadershipTeamMetrics(): Promise<LeadershipTeamMetrics> {
  const windows = buildLeaderboardWindows('last7');
  const snapshot = await loadLeaderboardSnapshot('last7');
  const rows = snapshot.data?.rows ?? [];

  if (rows.length > 0) {
    const summary = summarizeLeaderboardRows(rows);
    return {
      windowLabel: snapshot.data?.windowLabel || windows.current.label,
      ...summary,
      topPerformers: rows.slice(0, 8),
      performerBars: performerBarsFromRows(rows),
      refreshedAt: snapshot.data?.fetchedAt ?? null,
    };
  }

  const live = await computeLeadershipTeamMetricsLive();
  if (live) return live;

  const profiles = await listAllUserProfiles().catch(() => []);
  const recruiters = profiles.filter((p) => p.role === 'recruiter' || p.role === 'webinar');
  return emptyTeamMetrics(windows.current.label, recruiters.length);
}

export async function loadAdminOverviewMetrics(): Promise<LeadershipTeamMetrics> {
  return loadLeadershipTeamMetrics();
}
