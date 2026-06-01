import type { UserProfile } from './accessControl';
import { loadLeaderboardSnapshot } from './pipelineLeaderboardCache';
import { loadScopedWebinarRowsForViewer } from './pipelineBookedOutcomes';
import {
  buildLiveSessionRowsByEmail,
  loadCandidateEmailsById,
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

export type LeadershipTeamMetrics = {
  windowLabel: string;
  teamSize: number;
  totalWebinarBooked: number;
  totalWebinarShowed: number;
  totalCalls: number;
  topPerformers: RecruiterLeaderboardRow[];
  refreshedAt: string | null;
};

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
  const candidateEmailById = await loadCandidateEmailsById(
    [...new Set(records.map((r) => r.candidate_id).filter(Boolean))],
  ).catch(() => new Map<string, string>());
  const liveSessionByEmail = buildLiveSessionRowsByEmail(liveRegistrants);

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
      liveSessionByEmail,
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

export async function loadLeadershipTeamMetrics(): Promise<LeadershipTeamMetrics> {
  const windows = buildLeaderboardWindows('last7');
  const snapshot = await loadLeaderboardSnapshot('last7');
  const rows = snapshot.data?.rows ?? [];

  if (rows.length > 0) {
    return {
      windowLabel: snapshot.data?.windowLabel || windows.current.label,
      teamSize: rows.length,
      totalWebinarBooked: rows.reduce((s, r) => s + r.webinarBooked, 0),
      totalWebinarShowed: rows.reduce((s, r) => s + r.webinarShowed, 0),
      totalCalls: rows.reduce((s, r) => s + r.calls, 0),
      topPerformers: rows.slice(0, 8),
      refreshedAt: snapshot.data?.fetchedAt ?? null,
    };
  }

  const profiles = await listAllUserProfiles().catch(() => []);
  const recruiters = profiles.filter((p) => p.role === 'recruiter' || p.role === 'webinar');
  return {
    windowLabel: windows.current.label,
    teamSize: recruiters.length,
    totalWebinarBooked: 0,
    totalWebinarShowed: 0,
    totalCalls: 0,
    topPerformers: [],
    refreshedAt: null,
  };
}

export async function loadAdminOverviewMetrics(): Promise<LeadershipTeamMetrics> {
  return loadLeadershipTeamMetrics();
}
