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
} from './coachingHubApi';
import {
  computePaceSnapshot,
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

type CallSettingsRow = {
  user_id: string;
  daily_upload_target: number | null;
  daily_webinar_booking_target: number | null;
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
      title: 'No targets set',
      detail: 'Set daily call & booking targets in Account → call settings for pace tracking.',
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

async function loadAllCallSettings(): Promise<Map<string, CallSettingsRow>> {
  const map = new Map<string, CallSettingsRow>();
  const { data, error } = await supabase.from('pipeline_user_call_settings').select('*');
  if (error || !data) return map;
  for (const row of data as Record<string, unknown>[]) {
    const userId = String(row.user_id || '');
    if (!userId) continue;
    map.set(userId, {
      user_id: userId,
      daily_upload_target: typeof row.daily_upload_target === 'number' ? row.daily_upload_target : null,
      daily_webinar_booking_target:
        typeof row.daily_webinar_booking_target === 'number' ? row.daily_webinar_booking_target : null,
    });
  }
  return map;
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
  options?: { allowSnapshot?: boolean; liveRegistrants?: LiveSessionRegistrantRow[] },
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
  const [currentRecords, profiles, scopedWebinarRows, liveRegistrants] = await Promise.all([
    listPipelineCallRecords({
      fromIso: windows.current.fromIso,
      toIso: windows.current.toIso,
      limit: 2500,
    }).catch(() => [] as PipelineCallRecord[]),
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

export async function loadCoachingBoard(weekSince: string, now = new Date()): Promise<{
  summary: CoachingBoardSummary;
  people: CoachingBoardPerson[];
}> {
  const week = fridayWeekBoundsFromYmd(weekSince);
  const elapsedDays = elapsedDaysInFridayWeek(week.since, now);
  const isCurrentWeek = week.since === fridayWeekBoundsFromYmd(torontoYmdFromDate(now)).since;

  const [profiles, settingsMap, invites, forms, leaderboardBundle] = await Promise.all([
    listAllUserProfiles(),
    loadAllCallSettings(),
    listPerformanceCheckInInvites(week.since),
    listPerformanceCheckIns(week.since),
    loadLeaderboardRowsForWeek(week.since, week.until, { allowSnapshot: false }),
  ]);

  const leaderboardRows = leaderboardBundle.rows;
  let recordsByUser = leaderboardBundle.recordsByUser;

  if (recordsByUser.size === 0 && isCurrentWeek) {
    const windows = buildLeaderboardWindows('custom', now, { sinceYmd: week.since, untilYmd: week.until });
    const records = await listPipelineCallRecords({
      fromIso: windows.current.fromIso,
      toIso: windows.current.toIso,
      limit: 2000,
    }).catch(() => [] as PipelineCallRecord[]);
    recordsByUser = indexRecordsByUser(records);
  }

  const participants = filterProductionStaffProfiles(profiles).filter(
    (p) => (p.role === 'recruiter' || p.role === 'leadership' || p.role === 'webinar') && !isDemoStaffProfile(p),
  );

  const inviteByUser = new Map(invites.map((i) => [i.user_id, i]));
  const formByUser = new Map(forms.map((f) => [f.user_id, f]));
  const lbByUser = new Map(
    leaderboardRows.filter((r) => r.recruiterUserId).map((r) => [r.recruiterUserId as string, r]),
  );

  const previousWeekSince = shiftYmdDays(week.since, -7);
  const previousForms = await listPerformanceCheckIns(previousWeekSince);
  const prevPaceByUser = new Map(
    previousForms.map((f) => [f.user_id, combinedPace(f.calls_pace_pct, f.bookings_pace_pct)]),
  );

  const people: CoachingBoardPerson[] = [];

  for (const profile of participants) {
    const settings = settingsMap.get(profile.user_id);
    const invite = inviteByUser.get(profile.user_id) ?? null;
    const form = formByUser.get(profile.user_id) ?? null;
    const inviteTargets = invite as (PerformanceCheckInInvite & {
      daily_call_target?: number | null;
      daily_booking_target?: number | null;
    }) | null;
    const dailyCallTarget =
      settings?.daily_upload_target ?? form?.daily_call_target ?? inviteTargets?.daily_call_target ?? null;
    const dailyBookingTarget =
      settings?.daily_webinar_booking_target ??
      form?.daily_booking_target ??
      inviteTargets?.daily_booking_target ??
      null;
    const hasTargets = Boolean(dailyCallTarget || dailyBookingTarget);

    const lb = leaderboardRowForProfile(profile, lbByUser, leaderboardRows);
    const userRecords = recordsByUser.get(profile.user_id) || [];
    const webinarBooked = lb?.webinarBooked ?? 0;
    const webinarShowed = lb?.webinarShowed ?? 0;
    const liveSessionBooked = lb?.liveSessionBooked ?? 0;
    const liveSessionShowed = lb?.liveSessionShowed ?? 0;
    const totalShowed = webinarShowed + liveSessionShowed;
    const actualCalls = lb?.calls ?? userRecords.length;
    const actualBooked = lb ? lb.webinarBooked + (lb.liveSessionBooked ?? 0) : userRecords.filter(
      (r) => String(r.disposition || '').toLowerCase() === 'booked',
    ).length;
    const totalBooked = webinarBooked + liveSessionBooked;
    const showRatePct =
      totalBooked > 0 ? Math.round((100 * totalShowed) / totalBooked) : lb ? Math.round(lb.showRatio * 100) : null;

    const elapsed = isCurrentWeek ? elapsedDays : 7;
    const pace = computePaceSnapshot({
      dailyCallTarget: hasTargets ? dailyCallTarget : null,
      dailyBookingTarget: hasTargets ? dailyBookingTarget : null,
      actualCalls,
      actualBooked,
      elapsedDays: elapsed,
    });

    const combined = combinedPace(pace.callsPacePct, pace.bookingsPacePct);
    const prevCombined = prevPaceByUser.get(profile.user_id) ?? null;
    const belowThreshold = hasTargets && pace.belowThreshold;

    people.push({
      userId: profile.user_id,
      displayName: profile.full_name || profile.email || 'Unknown',
      email: profile.email || '',
      role: profile.role,
      dailyCallTarget,
      dailyBookingTarget,
      hasTargets,
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
      daily: buildDailyBreakdown(userRecords, week.since),
      invite,
      form: form ?? null,
      emailSent: Boolean(invite?.email_sent_at),
      hint: computeCoachingHint({
        belowThreshold,
        hasTargets,
        callsPacePct: pace.callsPacePct,
        bookingsPacePct: pace.bookingsPacePct,
        previousCombinedPace: prevCombined,
        currentCombinedPace: combined,
        hasForm: Boolean(form),
      }),
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
  let inviteRows: Array<{
    week_since: string;
    week_until: string;
    calls_pace_pct: number | null;
    bookings_pace_pct: number | null;
    below_threshold: boolean;
    actual_calls: number;
    actual_booked: number;
  }> = [];

  if (viaFn.ok) {
    formRows = viaFn.forms;
    inviteRows = viaFn.invites;
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
        .select(
          'week_since, week_until, calls_pace_pct, bookings_pace_pct, below_threshold, actual_calls, actual_booked',
        )
        .eq('user_id', userId)
        .order('week_since', { ascending: false })
        .limit(maxWeeks),
    ]);

    if (allForms.error) throw new Error(allForms.error.message);
    if (allInvites.error) throw new Error(allInvites.error.message);
    formRows = (allForms.data || []) as PerformanceCheckInRow[];
    inviteRows = (allInvites.data || []) as typeof inviteRows;
  }

  const weekMap = new Map<string, CoachingWeekPoint>();

  for (const invite of inviteRows) {
    const combined = combinedPace(
      invite.calls_pace_pct !== null ? Number(invite.calls_pace_pct) : null,
      invite.bookings_pace_pct !== null ? Number(invite.bookings_pace_pct) : null,
    );
    weekMap.set(invite.week_since, {
      weekSince: invite.week_since,
      weekUntil: invite.week_until,
      weekLabel: `${ymdToShortLabel(invite.week_since)} → ${ymdToShortLabel(invite.week_until)}`,
      callsPacePct: invite.calls_pace_pct !== null ? Number(invite.calls_pace_pct) : null,
      bookingsPacePct: invite.bookings_pace_pct !== null ? Number(invite.bookings_pace_pct) : null,
      combinedPacePct: combined,
      actualCalls: invite.actual_calls,
      actualBooked: invite.actual_booked,
      belowThreshold: invite.below_threshold,
      hasForm: false,
      source: 'invite',
    });
  }

  for (const form of formRows) {
    const combined = combinedPace(
      form.calls_pace_pct !== null ? Number(form.calls_pace_pct) : null,
      form.bookings_pace_pct !== null ? Number(form.bookings_pace_pct) : null,
    );
    weekMap.set(form.week_since, {
      weekSince: form.week_since,
      weekUntil: form.week_until,
      weekLabel: `${ymdToShortLabel(form.week_since)} → ${ymdToShortLabel(form.week_until)}`,
      callsPacePct: form.calls_pace_pct !== null ? Number(form.calls_pace_pct) : null,
      bookingsPacePct: form.bookings_pace_pct !== null ? Number(form.bookings_pace_pct) : null,
      combinedPacePct: combined,
      actualCalls: form.actual_calls,
      actualBooked: form.actual_booked,
      belowThreshold:
        (form.calls_pace_pct !== null && Number(form.calls_pace_pct) < 50) ||
        (form.bookings_pace_pct !== null && Number(form.bookings_pace_pct) < 50),
      hasForm: true,
      source: 'form',
    });
  }

  const profiles = await listAllUserProfiles();
  const profile = profiles.find((p) => p.user_id === userId);
  const settingsMap = await loadAllCallSettings();
  const recentWeeks = listRecentFridayWeeks(maxWeeks).map((w) => w.since);
  const missingWeeks = recentWeeks.filter((since) => !weekMap.has(since));

  if (profile && missingWeeks.length) {
    const weekList = listRecentFridayWeeks(maxWeeks);
    const oldestSince = weekList[weekList.length - 1]?.since ?? shiftYmdDays(torontoYmdFromDate(), -70);
    const sharedRegistrants = await loadLiveSessionRegistrantsForMatching({
      sinceYmd: shiftYmdDays(oldestSince, -21),
    }).catch(() => [] as LiveSessionRegistrantRow[]);

    const chunks: string[][] = [];
    for (let i = 0; i < missingWeeks.length; i += 3) {
      chunks.push(missingWeeks.slice(i, i + 3));
    }
    for (const chunk of chunks) {
      const weekPoints = await Promise.all(
        chunk.map(async (weekSince) => {
          const week = fridayWeekBoundsFromYmd(weekSince);
          const { rows } = await loadLeaderboardRowsForWeek(week.since, week.until, {
            allowSnapshot: false,
            liveRegistrants: sharedRegistrants,
          });
          const lbByUser = new Map(
            rows.filter((r) => r.recruiterUserId).map((r) => [r.recruiterUserId as string, r]),
          );
          const lb = leaderboardRowForProfile(profile, lbByUser, rows);
          if (!lb) return null;

          const settings = settingsMap.get(userId);
          const dailyCallTarget = settings?.daily_upload_target ?? null;
          const dailyBookingTarget = settings?.daily_webinar_booking_target ?? null;
          const hasTargets = Boolean(dailyCallTarget || dailyBookingTarget);
          const actualCalls = lb.calls ?? 0;
          const actualBooked = lb.webinarBooked + (lb.liveSessionBooked ?? 0);
          const pace = computePaceSnapshot({
            dailyCallTarget: hasTargets ? dailyCallTarget : null,
            dailyBookingTarget: hasTargets ? dailyBookingTarget : null,
            actualCalls,
            actualBooked,
            elapsedDays: 7,
          });
          const combined = combinedPace(pace.callsPacePct, pace.bookingsPacePct);

          return {
            weekSince: week.since,
            weekUntil: week.until,
            weekLabel: `${ymdToShortLabel(week.since)} → ${ymdToShortLabel(week.until)}`,
            callsPacePct: pace.callsPacePct,
            bookingsPacePct: pace.bookingsPacePct,
            combinedPacePct: combined,
            actualCalls,
            actualBooked,
            belowThreshold: hasTargets && pace.belowThreshold,
            hasForm: false,
            source: 'live' as const,
          };
        }),
      );
      for (const point of weekPoints) {
        if (point) weekMap.set(point.weekSince, point);
      }
    }
  }

  return [...weekMap.values()]
    .sort((a, b) => a.weekSince.localeCompare(b.weekSince))
    .slice(-maxWeeks);
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
