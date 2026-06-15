import {
  buildRecruiterScopeTokens,
  filterProductionStaffProfiles,
  isDemoStaffProfile,
  listAllUserProfiles,
  recruiterOwnsNameKey,
  type UserProfile,
} from './accessControl';
import {
  buildCompositeLeaderboard,
  buildLeaderboardWindows,
  seedsFromProfiles,
  type RecruiterLeaderboardRow,
} from './pipelineLeaderboard';
import { loadScopedWebinarRowsForViewer } from './pipelineBookedOutcomes';
import {
  buildLiveSessionRowsByEmail,
  buildLiveSessionRowsByPhone,
  loadCandidateEmailsById,
  loadCandidatePhonesById,
  loadLiveSessionRegistrantsForMatching,
  type LiveSessionRegistrantRow,
} from './liveSessionBookedOutcomes';
import { loadLeaderboardSnapshot } from './pipelineLeaderboardCache';
import { listPipelineCallRecords, type PipelineCallRecord } from './pipelineService';
import {
  fetchCoachingLadderViaFunction,
  fetchCoachingEmailLogsViaFunction,
  fetchCoachingFullBoardViaFunction,
  type CoachingCallActivity,
} from './coachingHubApi';
import {
  COACHING_WEEKLY_BOOKING_TARGET,
  COACHING_WEEKLY_CALL_TARGET,
  combinedCoachingPace,
  computeCoachingWeeklyPace,
} from './coachingPace';
import {
  elapsedDaysInFridayWeek,
  listPerformanceCheckInInvites,
  listPerformanceCheckIns,
  type PerformanceCheckInInvite,
  type PerformanceCheckInRow,
} from './performanceCheckInService';
import { supabase } from './supabaseClient';
import {
  fridayWeekBoundsFromYmd,
  shiftYmdDays,
  torontoYmdFromDate,
  ymdToShortLabel,
} from './webinarGeekDates';

export type CoachingDailyPoint = {
  ymd: string;
  label: string;
  calls: number;
  booked: number;
};

export type CoachingWeekPoint = {
  weekSince: string;
  weekUntil: string;
  weekLabel: string;
  callsPacePct: number | null;
  bookingsPacePct: number | null;
  combinedPacePct: number | null;
  actualCalls: number;
  actualBooked: number;
  belowThreshold: boolean;
  hasForm: boolean;
  source: 'live' | 'invite' | 'form';
};

export type CoachingHint = {
  tone: 'positive' | 'neutral' | 'warning' | 'critical';
  title: string;
  detail: string;
};

export type CoachingBoardPerson = {
  userId: string;
  displayName: string;
  email: string;
  role: string;
  dailyCallTarget: number | null;
  dailyBookingTarget: number | null;
  hasTargets: boolean;
  elapsedDays: number;
  actualCalls: number;
  actualBooked: number;
  webinarBooked: number;
  webinarShowed: number;
  liveSessionBooked: number;
  liveSessionShowed: number;
  totalShowed: number;
  showRatePct: number | null;
  leaderboardRank: number | null;
  leaderboardScore: number | null;
  expectedCalls: number | null;
  expectedBookings: number | null;
  callsPacePct: number | null;
  bookingsPacePct: number | null;
  combinedPacePct: number | null;
  belowThreshold: boolean;
  rankScore: number;
  daily: CoachingDailyPoint[];
  invite: PerformanceCheckInInvite | null;
  form: PerformanceCheckInRow | null;
  emailSent: boolean;
  hint: CoachingHint;
  ladder: CoachingWeekPoint[];
};

export type CoachingBoardSummary = {
  weekSince: string;
  weekUntil: string;
  weekLabel: string;
  elapsedDays: number;
  teamCount: number;
  belowCount: number;
  formCount: number;
  emailSentCount: number;
  refreshedAt: string;
};

export type CoachingEmailLogRow = {
  id: string;
  created_at: string;
  to_email: string;
  subject: string;
  status: string;
  metadata: Record<string, unknown> | null;
};

function combinedPace(calls: number | null, bookings: number | null): number | null {
  const values = [calls, bookings].filter((v): v is number => v !== null && Number.isFinite(v));
  if (!values.length) return null;
  return Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 100) / 100;
}

export function computeCoachingHint(input: {
  belowThreshold: boolean;
  hasTargets: boolean;
  callsPacePct: number | null;
  bookingsPacePct: number | null;
  previousCombinedPace: number | null;
  currentCombinedPace: number | null;
  hasForm: boolean;
}): CoachingHint {
  const {
    belowThreshold,
    hasTargets,
    callsPacePct,
    bookingsPacePct,
    previousCombinedPace,
    currentCombinedPace,
    hasForm,
  } = input;

  if (!hasTargets) {
    return {
      tone: 'neutral',
      title: 'Tracking pace',
      detail: `Team target: ${COACHING_WEEKLY_BOOKING_TARGET} bookings / week (50%+ mid-week is on track).`,
    };
  }

  if (!belowThreshold && (currentCombinedPace ?? 0) >= 85) {
    return { tone: 'positive', title: 'On track', detail: 'Pacing well mid-week — keep the momentum.' };
  }
  if (!belowThreshold) {
    return { tone: 'neutral', title: 'Steady', detail: 'Above the 50% mid-week line. Monitor bookings vs calls balance.' };
  }
  if (previousCombinedPace !== null && currentCombinedPace !== null && currentCombinedPace > previousCombinedPace + 8) {
    return {
      tone: 'positive',
      title: 'Trending up',
      detail: `Pace improved vs last week (${previousCombinedPace}% → ${currentCombinedPace}%).`,
    };
  }
  if (previousCombinedPace !== null && currentCombinedPace !== null && currentCombinedPace < previousCombinedPace - 8) {
    return {
      tone: 'critical',
      title: 'Slipping',
      detail: `Pace dropped vs last week (${previousCombinedPace}% → ${currentCombinedPace}%). Prioritize coaching.`,
    };
  }
  const weak = (callsPacePct ?? 100) <= (bookingsPacePct ?? 100) ? 'calls' : 'bookings';
  if (!hasForm) {
    return {
      tone: 'warning',
      title: 'Below 50% — no form yet',
      detail: `Main gap: ${weak}. Email sent or pending — follow up if no submission.`,
    };
  }
  return {
    tone: 'warning',
    title: 'Below 50% — form received',
    detail: `Focus coaching on ${weak}. Review their notes before the recruiting meeting.`,
  };
}

function fridayWeekDays(weekSince: string): CoachingDailyPoint[] {
  const labels = ['Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu'];
  return labels.map((label, i) => ({
    ymd: shiftYmdDays(weekSince, i),
    label,
    calls: 0,
    booked: 0,
  }));
}

function torontoYmdFromIso(iso: string): string {
  const d = new Date(iso);
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const y = p.find((x) => x.type === 'year')?.value ?? '1970';
  const mo = p.find((x) => x.type === 'month')?.value ?? '01';
  const da = p.find((x) => x.type === 'day')?.value ?? '01';
  return `${y}-${mo}-${da}`;
}

function buildDailyBreakdown(
  records: Array<{ disposed_at?: string | null; called_at?: string | null; disposition?: string | null }>,
  weekSince: string,
): CoachingDailyPoint[] {
  const days = fridayWeekDays(weekSince);
  const indexByYmd = new Map(days.map((d, i) => [d.ymd, i]));
  for (const record of records) {
    const iso = record.disposed_at || record.called_at;
    if (!iso) continue;
    const ymd = torontoYmdFromIso(iso);
    const idx = indexByYmd.get(ymd);
    if (idx === undefined) continue;
    days[idx].calls += 1;
    if (String(record.disposition || '').trim().toLowerCase() === 'booked') {
      days[idx].booked += 1;
    }
  }
  return days;
}

function indexRecordsByUser(records: PipelineCallRecord[]): Map<string, PipelineCallRecord[]> {
  const recordsByUser = new Map<string, PipelineCallRecord[]>();
  for (const record of records) {
    const uid = record.recruiter_user_id;
    if (!uid) continue;
    const list = recordsByUser.get(uid) || [];
    list.push(record);
    recordsByUser.set(uid, list);
  }
  return recordsByUser;
}

function rankScoreFromPerson(input: {
  combinedPace: number | null;
  belowThreshold: boolean;
  leaderboardRank: number | null;
  leaderboardScore: number | null;
}): number {
  if (input.leaderboardRank !== null) return 10000 - input.leaderboardRank;
  if (input.combinedPace !== null) return input.belowThreshold ? input.combinedPace : input.combinedPace + 1000;
  return input.leaderboardScore ?? 0;
}

function leaderboardRowForProfile(
  profile: UserProfile,
  lbByUser: Map<string, RecruiterLeaderboardRow>,
  lbRows: RecruiterLeaderboardRow[],
): RecruiterLeaderboardRow | undefined {
  const byId = lbByUser.get(profile.user_id);
  if (byId) return byId;
  const tokens = buildRecruiterScopeTokens(profile.email, profile.full_name);
  return lbRows.find((row) => recruiterOwnsNameKey(row.displayName, tokens));
}

function liveRegistrantWindowForWeek(weekSince: string, weekUntil: string): { sinceYmd: string; untilYmd: string } {
  return {
    sinceYmd: shiftYmdDays(weekSince, -21),
    untilYmd: shiftYmdDays(weekUntil, 60),
  };
}

async function loadLeaderboardRowsForWeek(
  weekSince: string,
  weekUntil: string,
  options?: {
    allowSnapshot?: boolean;
    liveRegistrants?: LiveSessionRegistrantRow[];
    /** When true, never fetch pipeline_call_records from the browser (use snapshot or webinar/live only). */
    skipClientCallRecords?: boolean;
  },
): Promise<{ rows: RecruiterLeaderboardRow[]; recordsByUser: Map<string, PipelineCallRecord[]> }> {
  const allowSnapshot = options?.allowSnapshot !== false;
  const currentWeek = fridayWeekBoundsFromYmd(torontoYmdFromDate());
  if (allowSnapshot && weekSince === currentWeek.since) {
    const snapshot = await loadLeaderboardSnapshot('last7');
    if (snapshot.data?.rows?.length) {
      return { rows: snapshot.data.rows, recordsByUser: new Map() };
    }
  }

  const custom = { sinceYmd: weekSince, untilYmd: weekUntil };
  const windows = buildLeaderboardWindows('custom', new Date(), custom);
  const registrantWindow = liveRegistrantWindowForWeek(weekSince, weekUntil);
  const liveRegistrantsPromise = options?.liveRegistrants
    ? Promise.resolve(options.liveRegistrants)
    : loadLiveSessionRegistrantsForMatching(registrantWindow).catch(() => [] as LiveSessionRegistrantRow[]);
  const callRecordsPromise = options?.skipClientCallRecords
    ? Promise.resolve([] as PipelineCallRecord[])
    : listPipelineCallRecords({
        fromIso: windows.current.fromIso,
        toIso: windows.current.toIso,
        limit: 2500,
      }).catch(() => [] as PipelineCallRecord[]);
  const [currentRecords, profiles, scopedWebinarRows, liveRegistrants] = await Promise.all([
    callRecordsPromise,
    listAllUserProfiles().catch(() => []),
    loadScopedWebinarRowsForViewer({ role: 'admin', viewerEmail: null, viewerFullName: null }).catch(() => []),
    liveRegistrantsPromise,
  ]);

  const candidateIds = [...new Set(currentRecords.map((r) => r.candidate_id).filter(Boolean))];
  const [candidateEmailById, candidatePhoneById] = await Promise.all([
    loadCandidateEmailsById(candidateIds).catch(() => new Map<string, string>()),
    loadCandidatePhonesById(candidateIds).catch(() => new Map<string, string>()),
  ]);

  const recruiterDirectory = new Map(
    profiles.map((p) => [p.user_id, { fullName: p.full_name, email: p.email ?? null }]),
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
    liveSessionByEmail: buildLiveSessionRowsByEmail(liveRegistrants),
    liveSessionByPhone: buildLiveSessionRowsByPhone(liveRegistrants),
  });

  return { rows, recordsByUser: indexRecordsByUser(currentRecords) };
}

export function listRecentFridayWeeks(count = 12, now = new Date()): Array<{ since: string; until: string; label: string }> {
  const weeks: Array<{ since: string; until: string; label: string }> = [];
  let since = fridayWeekBoundsFromYmd(torontoYmdFromDate(now)).since;
  for (let i = 0; i < count; i += 1) {
    const bounds = fridayWeekBoundsFromYmd(since);
    weeks.push({
      since: bounds.since,
      until: bounds.until,
      label: `${ymdToShortLabel(bounds.since)} → ${ymdToShortLabel(bounds.until)}`,
    });
    since = shiftYmdDays(bounds.since, -7);
  }
  return weeks;
}

export function buildLadderPointsForUser(
  userId: string,
  allForms: PerformanceCheckInRow[],
  allInvites: PerformanceCheckInInvite[],
  maxWeeks = 10,
): CoachingWeekPoint[] {
  const formRows = allForms.filter((f) => f.user_id === userId);
  const inviteRows = allInvites.filter((i) => i.user_id === userId);
  const weekMap = new Map<string, CoachingWeekPoint>();

  const pushPoint = (
    weekSince: string,
    weekUntil: string,
    actualCalls: number,
    actualBooked: number,
    hasForm: boolean,
    source: CoachingWeekPoint['source'],
  ) => {
    const pace = computeCoachingWeeklyPace({ actualCalls, actualBooked, elapsedDays: 7 });
    weekMap.set(weekSince, {
      weekSince,
      weekUntil,
      weekLabel: `${ymdToShortLabel(weekSince)} → ${ymdToShortLabel(weekUntil)}`,
      callsPacePct: pace.callsPacePct,
      bookingsPacePct: pace.bookingsPacePct,
      combinedPacePct: combinedCoachingPace(pace.callsPacePct, pace.bookingsPacePct),
      actualCalls,
      actualBooked,
      belowThreshold: pace.belowThreshold,
      hasForm,
      source,
    });
  };

  for (const invite of inviteRows) {
    pushPoint(
      invite.week_since,
      invite.week_until,
      (invite as PerformanceCheckInInvite & { actual_calls?: number }).actual_calls ?? 0,
      (invite as PerformanceCheckInInvite & { actual_booked?: number }).actual_booked ?? 0,
      false,
      'invite',
    );
  }

  for (const form of formRows) {
    pushPoint(form.week_since, form.week_until, form.actual_calls, form.actual_booked, true, 'form');
  }

  return [...weekMap.values()]
    .sort((a, b) => a.weekSince.localeCompare(b.weekSince))
    .slice(-maxWeeks);
}

export function buildAllLaddersFromHistory(
  userIds: string[],
  historyForms: PerformanceCheckInRow[],
  historyInvites: PerformanceCheckInInvite[],
  maxWeeks = 10,
): Map<string, CoachingWeekPoint[]> {
  const map = new Map<string, CoachingWeekPoint[]>();
  for (const userId of userIds) {
    map.set(userId, buildLadderPointsForUser(userId, historyForms, historyInvites, maxWeeks));
  }
  return map;
}

const COACHING_HISTORY_WEEKS = 12;

export async function loadFullCoachingHub(weekSince: string, now = new Date()): Promise<{
  summary: CoachingBoardSummary;
  people: CoachingBoardPerson[];
  emailLogs: CoachingEmailLogRow[];
}> {
  const historySince =
    listRecentFridayWeeks(COACHING_HISTORY_WEEKS).at(-1)?.since ?? shiftYmdDays(weekSince, -70);
  const previousWeekSince = shiftYmdDays(weekSince, -7);
  const week = fridayWeekBoundsFromYmd(weekSince);
  const windows = buildLeaderboardWindows('custom', now, { sinceYmd: week.since, untilYmd: week.until });

  const bulk = await fetchCoachingFullBoardViaFunction({
    weekSince: week.since,
    weekUntil: week.until,
    fromIso: windows.current.fromIso,
    toIso: windows.current.toIso,
    historySince,
    emailLimit: 30,
  });

  let weekInvites = bulk.ok ? bulk.data.weekInvites : [];
  let weekForms = bulk.ok ? bulk.data.weekForms : [];
  let historyForms = bulk.ok ? bulk.data.historyForms : [];
  let historyInvites = bulk.ok ? bulk.data.historyInvites : [];
  let emailLogs = bulk.ok ? (bulk.data.emailLogs as CoachingEmailLogRow[]) : [];
  const callActivityByUser = new Map<string, CoachingCallActivity>(
    (bulk.ok ? bulk.data.callActivityByUser : []).map((row) => [row.userId, row]),
  );

  if (!bulk.ok) {
    const [invites, forms, logs] = await Promise.all([
      listPerformanceCheckInInvites(weekSince),
      listPerformanceCheckIns(weekSince),
      loadCoachingEmailLogs(30).catch(() => [] as CoachingEmailLogRow[]),
    ]);
    weekInvites = invites;
    weekForms = forms;
    emailLogs = logs;
    const historySinceYmd = historySince;
    const [allForms, allInvites] = await Promise.all([
      supabase
        .from('recruiter_performance_check_ins')
        .select('*')
        .gte('week_since', historySinceYmd)
        .order('week_since', { ascending: false })
        .limit(2000),
      supabase
        .from('recruiter_performance_check_in_invites')
        .select('*')
        .gte('week_since', historySinceYmd)
        .order('week_since', { ascending: false })
        .limit(2000),
    ]);
    if (!allForms.error) historyForms = (allForms.data || []) as PerformanceCheckInRow[];
    if (!allInvites.error) historyInvites = (allInvites.data || []) as PerformanceCheckInInvite[];
  }

  const previousForms = historyForms.filter((f) => f.week_since === previousWeekSince);
  const profiles = await listAllUserProfiles();
  const participants = filterProductionStaffProfiles(profiles).filter(
    (p) => (p.role === 'recruiter' || p.role === 'leadership' || p.role === 'webinar') && !isDemoStaffProfile(p),
  );
  const laddersByUser = buildAllLaddersFromHistory(
    participants.map((p) => p.user_id),
    historyForms,
    historyInvites,
    COACHING_HISTORY_WEEKS,
  );

  const board = await loadCoachingBoard(weekSince, now, {
    invites: weekInvites,
    forms: weekForms,
    previousForms,
    laddersByUser,
    callActivityByUser,
  });

  return { ...board, emailLogs };
}

export async function loadCoachingBoard(
  weekSince: string,
  now = new Date(),
  prefetched?: {
    invites: PerformanceCheckInInvite[];
    forms: PerformanceCheckInRow[];
    previousForms: PerformanceCheckInRow[];
    laddersByUser?: Map<string, CoachingWeekPoint[]>;
    callActivityByUser?: Map<string, CoachingCallActivity>;
  },
): Promise<{
  summary: CoachingBoardSummary;
  people: CoachingBoardPerson[];
}> {
  const week = fridayWeekBoundsFromYmd(weekSince);
  const elapsedDays = elapsedDaysInFridayWeek(week.since, now);
  const isCurrentWeek = week.since === fridayWeekBoundsFromYmd(torontoYmdFromDate(now)).since;

  const invitesPromise = prefetched
    ? Promise.resolve(prefetched.invites)
    : listPerformanceCheckInInvites(week.since);
  const formsPromise = prefetched
    ? Promise.resolve(prefetched.forms)
    : listPerformanceCheckIns(week.since);
  const previousWeekSince = shiftYmdDays(week.since, -7);
  const previousFormsPromise = prefetched
    ? Promise.resolve(prefetched.previousForms)
    : listPerformanceCheckIns(previousWeekSince);

  const skipClientCallRecords = prefetched?.callActivityByUser !== undefined;
  const [profiles, invites, forms, leaderboardBundle, previousForms] = await Promise.all([
    listAllUserProfiles(),
    invitesPromise,
    formsPromise,
    loadLeaderboardRowsForWeek(week.since, week.until, { allowSnapshot: true, skipClientCallRecords }),
    previousFormsPromise,
  ]);

  const leaderboardRows = leaderboardBundle.rows;
  const callActivityByUser = prefetched?.callActivityByUser ?? new Map<string, CoachingCallActivity>();

  const participants = filterProductionStaffProfiles(profiles).filter(
    (p) => (p.role === 'recruiter' || p.role === 'leadership' || p.role === 'webinar') && !isDemoStaffProfile(p),
  );

  const inviteByUser = new Map(invites.map((i) => [i.user_id, i]));
  const formByUser = new Map(forms.map((f) => [f.user_id, f]));
  const lbByUser = new Map(
    leaderboardRows.filter((r) => r.recruiterUserId).map((r) => [r.recruiterUserId as string, r]),
  );

  const prevPaceByUser = new Map(
    previousForms.map((f) => {
      const pace = computeCoachingWeeklyPace({
        actualCalls: f.actual_calls,
        actualBooked: f.actual_booked,
        elapsedDays: 7,
      });
      return [f.user_id, combinedCoachingPace(pace.callsPacePct, pace.bookingsPacePct)];
    }),
  );

  const people: CoachingBoardPerson[] = [];

  for (const profile of participants) {
    const invite = inviteByUser.get(profile.user_id) ?? null;
    const form = formByUser.get(profile.user_id) ?? null;
    const callActivity = callActivityByUser.get(profile.user_id);
    const lb = leaderboardRowForProfile(profile, lbByUser, leaderboardRows);
    const webinarBooked = lb?.webinarBooked ?? 0;
    const webinarShowed = lb?.webinarShowed ?? 0;
    const liveSessionBooked = lb?.liveSessionBooked ?? 0;
    const liveSessionShowed = lb?.liveSessionShowed ?? 0;
    const totalShowed = webinarShowed + liveSessionShowed;
    const bookedFromActivity = callActivity?.days.reduce((sum, day) => sum + day.booked, 0) ?? 0;
    const webinarLiveBooked = lb ? (lb.webinarBooked ?? 0) + (lb.liveSessionBooked ?? 0) : 0;
    const actualCalls = Math.max(callActivity?.totalCalls ?? 0, lb?.calls ?? 0);
    const actualBooked = Math.max(webinarLiveBooked, bookedFromActivity);
    const totalBooked = webinarBooked + liveSessionBooked;
    const showRatePct =
      totalBooked > 0 ? Math.round((100 * totalShowed) / totalBooked) : lb ? Math.round(lb.showRatio * 100) : null;

    const elapsed = isCurrentWeek ? elapsedDays : 7;
    const pace = computeCoachingWeeklyPace({ actualCalls, actualBooked, elapsedDays: elapsed });
    const combined = combinedCoachingPace(pace.callsPacePct, pace.bookingsPacePct);
    const prevCombined = prevPaceByUser.get(profile.user_id) ?? null;
    const belowThreshold = pace.belowThreshold;
    const daily =
      callActivity?.days?.length
        ? callActivity.days
        : buildDailyBreakdown([], week.since);

    people.push({
      userId: profile.user_id,
      displayName: profile.full_name || profile.email || 'Unknown',
      email: profile.email || '',
      role: profile.role,
      dailyCallTarget: pace.dailyCallTarget,
      dailyBookingTarget: pace.dailyBookingTarget,
      hasTargets: true,
      elapsedDays: elapsed,
      actualCalls,
      actualBooked,
      webinarBooked,
      webinarShowed,
      liveSessionBooked,
      liveSessionShowed,
      totalShowed,
      showRatePct,
      leaderboardRank: lb?.rank ?? null,
      leaderboardScore: lb?.score ?? null,
      expectedCalls: pace.expectedCalls,
      expectedBookings: pace.expectedBookings,
      callsPacePct: pace.callsPacePct,
      bookingsPacePct: pace.bookingsPacePct,
      combinedPacePct: combined,
      belowThreshold,
      rankScore: rankScoreFromPerson({
        combinedPace: combined,
        belowThreshold,
        leaderboardRank: lb?.rank ?? null,
        leaderboardScore: lb?.score ?? null,
      }),
      daily,
      invite,
      form: form ?? null,
      emailSent: Boolean(invite?.email_sent_at),
      hint: computeCoachingHint({
        belowThreshold,
        hasTargets: true,
        callsPacePct: pace.callsPacePct,
        bookingsPacePct: pace.bookingsPacePct,
        previousCombinedPace: prevCombined,
        currentCombinedPace: combined,
        hasForm: Boolean(form),
      }),
      ladder: prefetched?.laddersByUser?.get(profile.user_id) ?? [],
    });
  }

  people.sort((a, b) => {
    if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore;
    return a.displayName.localeCompare(b.displayName);
  });

  return {
    summary: {
      weekSince: week.since,
      weekUntil: week.until,
      weekLabel: `${ymdToShortLabel(week.since)} → ${ymdToShortLabel(week.until)}`,
      elapsedDays: isCurrentWeek ? elapsedDays : 7,
      teamCount: people.length,
      belowCount: people.filter((p) => p.belowThreshold).length,
      formCount: people.filter((p) => p.form).length,
      emailSentCount: people.filter((p) => p.emailSent).length,
      refreshedAt: new Date().toISOString(),
    },
    people,
  };
}

export async function loadUserImprovementLadder(userId: string, maxWeeks = 10): Promise<CoachingWeekPoint[]> {
  const viaFn = await fetchCoachingLadderViaFunction(userId, maxWeeks);
  let formRows: PerformanceCheckInRow[] = [];
  let inviteRows: PerformanceCheckInInvite[] = [];

  if (viaFn.ok) {
    formRows = viaFn.forms;
    inviteRows = viaFn.invites.map((row) => ({
      user_id: userId,
      id: '',
      submitter_email: '',
      submitter_name: null,
      week_since: row.week_since,
      week_until: row.week_until,
      invite_token: '',
      email_sent_at: null,
      below_threshold: row.below_threshold,
      calls_pace_pct: row.calls_pace_pct,
      bookings_pace_pct: row.bookings_pace_pct,
      actual_calls: row.actual_calls,
      actual_booked: row.actual_booked,
    })) as PerformanceCheckInInvite[];
  } else {
    const [allForms, allInvites] = await Promise.all([
      supabase
        .from('recruiter_performance_check_ins')
        .select('*')
        .eq('user_id', userId)
        .order('week_since', { ascending: false })
        .limit(maxWeeks),
      supabase
        .from('recruiter_performance_check_in_invites')
        .select('*')
        .eq('user_id', userId)
        .order('week_since', { ascending: false })
        .limit(maxWeeks),
    ]);

    if (allForms.error) throw new Error(allForms.error.message);
    if (allInvites.error) throw new Error(allInvites.error.message);
    formRows = (allForms.data || []) as PerformanceCheckInRow[];
    inviteRows = (allInvites.data || []) as PerformanceCheckInInvite[];
  }

  return buildLadderPointsForUser(userId, formRows, inviteRows, maxWeeks);
}

export async function loadCoachingEmailLogs(limit = 30): Promise<CoachingEmailLogRow[]> {
  const viaFn = await fetchCoachingEmailLogsViaFunction(limit);
  if (viaFn.ok) return viaFn.logs as CoachingEmailLogRow[];

  try {
    const { data, error } = await supabase
      .from('email_send_logs')
      .select('id, created_at, to_email, subject, status, metadata')
      .eq('trigger_label', 'mid_week_performance_checkin')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (!error && data) return data as CoachingEmailLogRow[];

    const fallback = await supabase
      .from('email_send_logs')
      .select('id, created_at, to_email, subject, status, metadata')
      .order('created_at', { ascending: false })
      .limit(Math.min(limit * 3, 120));
    if (fallback.error) return [];
    return ((fallback.data || []) as CoachingEmailLogRow[]).filter((row) => {
      const meta = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
      const category = String((meta as Record<string, unknown>).category || '');
      return category === 'mid_week_coaching';
    }).slice(0, limit);
  } catch {
    return [];
  }
}
