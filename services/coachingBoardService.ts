import {
  filterProductionStaffProfiles,
  isDemoStaffProfile,
  listAllUserProfiles,
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
} from './liveSessionBookedOutcomes';
import { listPipelineCallRecords } from './pipelineService';
import { supabase } from './supabaseClient';
import {
  computePaceSnapshot,
  elapsedDaysInFridayWeek,
  computePaceSnapshot,
  elapsedDaysInFridayWeek,
  listPerformanceCheckInInvites,
  listPerformanceCheckIns,
  type PerformanceCheckInInvite,
  type PerformanceCheckInRow,
} from './performanceCheckInService';
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
  elapsedDays: number;
  actualCalls: number;
  actualBooked: number;
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

function rankScoreFromPace(pace: number | null, below: boolean): number {
  const base = pace ?? 0;
  return below ? base : base + 1000;
}

export function computeCoachingHint(input: {
  belowThreshold: boolean;
  callsPacePct: number | null;
  bookingsPacePct: number | null;
  previousCombinedPace: number | null;
  currentCombinedPace: number | null;
  hasForm: boolean;
}): CoachingHint {
  const { belowThreshold, callsPacePct, bookingsPacePct, previousCombinedPace, currentCombinedPace, hasForm } = input;

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
  records: Array<{ called_at?: string | null; disposition?: string | null }>,
  weekSince: string,
): CoachingDailyPoint[] {
  const days = fridayWeekDays(weekSince);
  const indexByYmd = new Map(days.map((d, i) => [d.ymd, i]));
  for (const record of records) {
    const iso = record.called_at;
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

async function loadAllCallSettings(): Promise<Map<string, CallSettingsRow>> {
  const map = new Map<string, CallSettingsRow>();
  const { data, error } = await supabase
    .from('pipeline_user_call_settings')
    .select('user_id, daily_upload_target, daily_webinar_booking_target');
  if (error || !data) return map;
  for (const row of data as CallSettingsRow[]) {
    map.set(row.user_id, row);
  }
  return map;
}

async function loadLeaderboardRowsForWeek(weekSince: string, weekUntil: string): Promise<RecruiterLeaderboardRow[]> {
  const custom = { sinceYmd: weekSince, untilYmd: weekUntil };
  const windows = buildLeaderboardWindows('custom', new Date(), custom);
  const [currentRecords, profiles, scopedWebinarRows, liveRegistrants] = await Promise.all([
    listPipelineCallRecords({
      fromIso: windows.current.fromIso,
      toIso: windows.current.toIso,
      limit: 8000,
    }),
    listAllUserProfiles().catch(() => []),
    loadScopedWebinarRowsForViewer({ role: 'admin', viewerEmail: null, viewerFullName: null }),
    loadLiveSessionRegistrantsForMatching().catch(() => []),
  ]);

  const candidateIds = [...new Set(currentRecords.map((r) => r.candidate_id).filter(Boolean))];
  const [candidateEmailById, candidatePhoneById] = await Promise.all([
    loadCandidateEmailsById(candidateIds).catch(() => new Map<string, string>()),
    loadCandidatePhonesById(candidateIds).catch(() => new Map<string, string>()),
  ]);

  const recruiterDirectory = new Map(
    profiles.map((p) => [p.user_id, { fullName: p.full_name, email: p.email ?? null }]),
  );

  return buildCompositeLeaderboard({
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

  const [profiles, settingsMap, invites, forms, leaderboardRows, allRecords] = await Promise.all([
    listAllUserProfiles(),
    loadAllCallSettings(),
    listPerformanceCheckInInvites(week.since),
    listPerformanceCheckIns(week.since),
    loadLeaderboardRowsForWeek(week.since, week.until),
    listPipelineCallRecords({
      fromIso: `${week.since}T00:00:00.000-04:00`,
      toIso: `${week.until}T23:59:59.999-04:00`,
      limit: 12000,
    }),
  ]);

  const participants = filterProductionStaffProfiles(profiles).filter(
    (p) => (p.role === 'recruiter' || p.role === 'leadership' || p.role === 'webinar') && !isDemoStaffProfile(p),
  );

  const inviteByUser = new Map(invites.map((i) => [i.user_id, i]));
  const formByUser = new Map(forms.map((f) => [f.user_id, f]));
  const lbByUser = new Map(
    leaderboardRows.filter((r) => r.recruiterUserId).map((r) => [r.recruiterUserId as string, r]),
  );

  const recordsByUser = new Map<string, typeof allRecords>();
  for (const record of allRecords) {
    const uid = record.recruiter_user_id;
    if (!uid) continue;
    const list = recordsByUser.get(uid) || [];
    list.push(record);
    recordsByUser.set(uid, list);
  }

  const previousWeekSince = shiftYmdDays(week.since, -7);
  const previousForms = await listPerformanceCheckIns(previousWeekSince);
  const prevPaceByUser = new Map(
    previousForms.map((f) => [f.user_id, combinedPace(f.calls_pace_pct, f.bookings_pace_pct)]),
  );

  const people: CoachingBoardPerson[] = [];

  for (const profile of participants) {
    const settings = settingsMap.get(profile.user_id);
    const dailyCallTarget = settings?.daily_upload_target ?? null;
    const dailyBookingTarget = settings?.daily_webinar_booking_target ?? null;
    if (!dailyCallTarget && !dailyBookingTarget) continue;

    const lb = lbByUser.get(profile.user_id);
    const userRecords = recordsByUser.get(profile.user_id) || [];
    const actualCalls = lb?.calls ?? userRecords.length;
    const actualBooked = lb ? lb.webinarBooked + (lb.liveSessionBooked ?? 0) : userRecords.filter(
      (r) => String(r.disposition || '').toLowerCase() === 'booked',
    ).length;

    const elapsed = isCurrentWeek ? elapsedDays : 7;
    const pace = computePaceSnapshot({
      dailyCallTarget,
      dailyBookingTarget,
      actualCalls,
      actualBooked,
      elapsedDays: elapsed,
    });

    const invite = inviteByUser.get(profile.user_id) ?? null;
    const form = formByUser.get(profile.user_id) ?? null;
    const combined = combinedPace(pace.callsPacePct, pace.bookingsPacePct);
    const prevCombined = prevPaceByUser.get(profile.user_id) ?? null;

    people.push({
      userId: profile.user_id,
      displayName: profile.full_name || profile.email || 'Unknown',
      email: profile.email || '',
      role: profile.role,
      dailyCallTarget,
      dailyBookingTarget,
      elapsedDays: elapsed,
      actualCalls,
      actualBooked,
      expectedCalls: pace.expectedCalls,
      expectedBookings: pace.expectedBookings,
      callsPacePct: pace.callsPacePct,
      bookingsPacePct: pace.bookingsPacePct,
      combinedPacePct: combined,
      belowThreshold: pace.belowThreshold,
      rankScore: rankScoreFromPace(combined, pace.belowThreshold),
      daily: buildDailyBreakdown(userRecords, week.since),
      invite,
      form: form ?? null,
      emailSent: Boolean(invite?.email_sent_at),
      hint: computeCoachingHint({
        belowThreshold: pace.belowThreshold,
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
      belowCount: people.filter((p) => p.belowThreshold).length,
      formCount: people.filter((p) => p.form).length,
      emailSentCount: people.filter((p) => p.emailSent).length,
      refreshedAt: new Date().toISOString(),
    },
    people,
  };
}

export async function loadUserImprovementLadder(userId: string, maxWeeks = 10): Promise<CoachingWeekPoint[]> {
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

  const formRows = (allForms.data || []) as PerformanceCheckInRow[];
  const inviteRows = (allInvites.data || []) as Array<{
    week_since: string;
    week_until: string;
    calls_pace_pct: number | null;
    bookings_pace_pct: number | null;
    below_threshold: boolean;
    actual_calls: number;
    actual_booked: number;
  }>;

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

  const currentWeek = fridayWeekBoundsFromYmd(torontoYmdFromDate());
  if (!weekMap.has(currentWeek.since)) {
    const profiles = await listAllUserProfiles();
    const profile = profiles.find((p) => p.user_id === userId);
    if (profile) {
      const board = await loadCoachingBoard(currentWeek.since);
      const live = board.people.find((p) => p.userId === userId);
      if (live) {
        weekMap.set(currentWeek.since, {
          weekSince: currentWeek.since,
          weekUntil: currentWeek.until,
          weekLabel: `${ymdToShortLabel(currentWeek.since)} → ${ymdToShortLabel(currentWeek.until)}`,
          callsPacePct: live.callsPacePct,
          bookingsPacePct: live.bookingsPacePct,
          combinedPacePct: live.combinedPacePct,
          actualCalls: live.actualCalls,
          actualBooked: live.actualBooked,
          belowThreshold: live.belowThreshold,
          hasForm: Boolean(live.form),
          source: 'live',
        });
      }
    }
  }

  return [...weekMap.values()]
    .sort((a, b) => a.weekSince.localeCompare(b.weekSince))
    .slice(-maxWeeks);
}

export async function loadCoachingEmailLogs(limit = 40): Promise<CoachingEmailLogRow[]> {
  const { data, error } = await supabase
    .from('email_send_logs')
    .select('id, created_at, to_email, subject, status, metadata')
    .or('trigger_label.eq.mid_week_performance_checkin,source.eq.performance-check-in-reminder')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data || []) as CoachingEmailLogRow[];
}
