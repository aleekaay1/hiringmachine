import {
  canAccessReports,
  filterProductionStaffProfiles,
  isDemoStaffProfile,
  listAllUserProfiles,
  type AppRole,
  type UserProfile,
} from './accessControl';
import { loadRecruiterPersonalMetrics } from './dashboardPersonalMetrics';
import { supabase } from './supabaseClient';
import {
  fetchCoachingWeekDataViaFunction,
  fetchCoachingLadderViaFunction,
  fetchCoachingEmailLogsViaFunction,
} from './coachingHubApi';
import { isSupabaseNetworkError } from './dashboardTeamMetricsService';
import {
  fridayWeekBoundsFromYmd,
  torontoYmdFromDate,
  ymdToLocalDate,
  ymdToShortLabel,
} from './webinarGeekDates';

export const PERFORMANCE_CHECKIN_AUTOMATION_ENABLED = false;

export type PerformanceCheckInBlocker =
  | 'lead_quality'
  | 'dial_time'
  | 'follow_up'
  | 'scheduling'
  | 'motivation'
  | 'tools'
  | 'personal'
  | 'other';

export type PerformanceCheckInTroubleArea =
  | 'leads'
  | 'dialing'
  | 'follow_up'
  | 'bookings'
  | 'shows'
  | 'email';

export type PerformanceCheckInHelp =
  | 'coaching_call'
  | 'lead_refresh'
  | 'script_review'
  | 'schedule_block'
  | 'peer_shadow'
  | 'nothing';

export const PERFORMANCE_CHECKIN_BLOCKERS: Array<{ id: PerformanceCheckInBlocker; label: string }> = [
  { id: 'lead_quality', label: 'Lead quality or volume' },
  { id: 'dial_time', label: 'Not enough dial time' },
  { id: 'follow_up', label: 'Follow-up backlog' },
  { id: 'scheduling', label: 'Scheduling / calendar issues' },
  { id: 'motivation', label: 'Motivation / focus' },
  { id: 'tools', label: 'Tools or workspace issues' },
  { id: 'personal', label: 'Personal / schedule conflict' },
  { id: 'other', label: 'Something else' },
];

export const PERFORMANCE_CHECKIN_TROUBLE_AREAS: Array<{ id: PerformanceCheckInTroubleArea; label: string }> = [
  { id: 'leads', label: 'Working the right leads' },
  { id: 'dialing', label: 'Getting enough dials in' },
  { id: 'follow_up', label: 'Following up on warm leads' },
  { id: 'bookings', label: 'Converting to bookings' },
  { id: 'shows', label: 'Getting candidates to show' },
  { id: 'email', label: 'Email outreach' },
];

export const PERFORMANCE_CHECKIN_HELP_OPTIONS: Array<{ id: PerformanceCheckInHelp; label: string }> = [
  { id: 'coaching_call', label: 'Quick coaching call with leadership' },
  { id: 'lead_refresh', label: 'Fresh leads or list reset' },
  { id: 'script_review', label: 'Script / objection review' },
  { id: 'schedule_block', label: 'Protected dial block on calendar' },
  { id: 'peer_shadow', label: 'Shadow a top performer' },
  { id: 'nothing', label: 'I have a plan — just needed to check in' },
];

export type PerformanceCheckInStats = {
  weekSince: string;
  weekUntil: string;
  weekLabel: string;
  elapsedDays: number;
  dailyCallTarget: number | null;
  dailyBookingTarget: number | null;
  actualCalls: number;
  actualBooked: number;
  expectedCalls: number | null;
  expectedBookings: number | null;
  callsPacePct: number | null;
  bookingsPacePct: number | null;
  belowThreshold: boolean;
};

export type PerformanceCheckInRow = {
  id: string;
  user_id: string;
  invite_id: string | null;
  submitter_email: string;
  submitter_name: string | null;
  week_since: string;
  week_until: string;
  submitted_at: string;
  daily_call_target: number | null;
  daily_booking_target: number | null;
  elapsed_days: number;
  actual_calls: number;
  actual_booked: number;
  expected_calls: number | null;
  expected_bookings: number | null;
  calls_pace_pct: number | null;
  bookings_pace_pct: number | null;
  blocker_category: string | null;
  trouble_areas: string[];
  help_needed: string | null;
  comments: string | null;
  needs_coaching: boolean;
  status: 'submitted' | 'reviewed';
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  reviewer_notes: string | null;
};

export type PerformanceCheckInInvite = {
  id: string;
  user_id: string;
  submitter_email: string;
  submitter_name: string | null;
  week_since: string;
  week_until: string;
  invite_token: string;
  email_sent_at: string | null;
  below_threshold: boolean;
  calls_pace_pct: number | null;
  bookings_pace_pct: number | null;
};

const PARTICIPANT_ROLES = new Set<AppRole>(['recruiter', 'leadership', 'webinar']);

export function canAccessPerformanceCheckInParticipant(role: AppRole | null): boolean {
  return Boolean(role && PARTICIPANT_ROLES.has(role));
}

export function canAccessPerformanceCheckInAdmin(role: AppRole | null, email?: string | null): boolean {
  if (role === 'admin') return true;
  return canAccessReports(role, email);
}

export function torontoWeekdayIndex(now = new Date()): number {
  const label = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Toronto',
    weekday: 'short',
  }).format(now);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[label] ?? 0;
}

/** Mid-week coaching window: Monday or Tuesday (Toronto). */
export function isMidWeekCoachingDay(now = new Date()): boolean {
  const idx = torontoWeekdayIndex(now);
  return idx === 1 || idx === 2;
}

export function currentFridayWeekBounds(now = new Date()): { since: string; until: string; title: string } {
  return fridayWeekBoundsFromYmd(torontoYmdFromDate(now));
}

export function elapsedDaysInFridayWeek(weekSince: string, now = new Date()): number {
  const todayYmd = torontoYmdFromDate(now);
  const week = fridayWeekBoundsFromYmd(todayYmd);
  if (week.since !== weekSince) {
    const end = fridayWeekBoundsFromYmd(weekSince);
    if (todayYmd < weekSince || todayYmd > end.until) return 0;
  }
  if (todayYmd < weekSince) return 0;
  const endYmd = fridayWeekBoundsFromYmd(weekSince).until;
  const cappedUntil = todayYmd > endYmd ? endYmd : todayYmd;
  const start = ymdToLocalDate(weekSince);
  const today = ymdToLocalDate(cappedUntil);
  return Math.max(0, Math.floor((today.getTime() - start.getTime()) / 86400000) + 1);
}

export function computePaceSnapshot(input: {
  dailyCallTarget: number | null;
  dailyBookingTarget: number | null;
  actualCalls: number;
  actualBooked: number;
  elapsedDays: number;
}): Omit<PerformanceCheckInStats, 'weekSince' | 'weekUntil' | 'weekLabel'> {
  const { elapsedDays, actualCalls, actualBooked, dailyCallTarget, dailyBookingTarget } = input;
  let belowThreshold = false;
  let expectedCalls: number | null = null;
  let expectedBookings: number | null = null;
  let callsPacePct: number | null = null;
  let bookingsPacePct: number | null = null;

  if (dailyCallTarget && dailyCallTarget > 0 && elapsedDays > 0) {
    expectedCalls = dailyCallTarget * elapsedDays;
    callsPacePct = expectedCalls > 0 ? Math.round((actualCalls / expectedCalls) * 10000) / 100 : null;
    if (callsPacePct !== null && callsPacePct < 50) belowThreshold = true;
  }
  if (dailyBookingTarget && dailyBookingTarget > 0 && elapsedDays > 0) {
    expectedBookings = dailyBookingTarget * elapsedDays;
    bookingsPacePct =
      expectedBookings > 0 ? Math.round((actualBooked / expectedBookings) * 10000) / 100 : null;
    if (bookingsPacePct !== null && bookingsPacePct < 50) belowThreshold = true;
  }

  return {
    elapsedDays,
    dailyCallTarget,
    dailyBookingTarget,
    actualCalls,
    actualBooked,
    expectedCalls,
    expectedBookings,
    callsPacePct,
    bookingsPacePct,
    belowThreshold,
  };
}

export async function loadMidWeekStatsForProfile(profile: UserProfile, now = new Date()): Promise<PerformanceCheckInStats> {
  const week = currentFridayWeekBounds(now);
  const elapsedDays = elapsedDaysInFridayWeek(week.since, now);
  const metrics = await loadRecruiterPersonalMetrics(profile);
  const actualCalls = metrics.calls;
  const actualBooked = metrics.webinarBooked + metrics.liveSessionBooked;
  const pace = computePaceSnapshot({
    dailyCallTarget: metrics.uploadGoal,
    dailyBookingTarget: metrics.webinarGoal,
    actualCalls,
    actualBooked,
    elapsedDays,
  });
  return {
    weekSince: week.since,
    weekUntil: week.until,
    weekLabel: `${ymdToShortLabel(week.since)} → ${ymdToShortLabel(week.until)}`,
    ...pace,
  };
}

export async function loadInviteByToken(token: string): Promise<PerformanceCheckInInvite | null> {
  const trimmed = token.trim();
  if (!trimmed) return null;
  const { data, error } = await supabase
    .from('recruiter_performance_check_in_invites')
    .select(
      'id, user_id, submitter_email, submitter_name, week_since, week_until, invite_token, email_sent_at, below_threshold, calls_pace_pct, bookings_pace_pct',
    )
    .eq('invite_token', trimmed)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as PerformanceCheckInInvite | null) ?? null;
}

export async function loadMyCheckInForWeek(weekSince: string): Promise<PerformanceCheckInRow | null> {
  const { data, error } = await supabase
    .from('recruiter_performance_check_ins')
    .select('*')
    .eq('week_since', weekSince)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as PerformanceCheckInRow | null) ?? null;
}

export async function submitPerformanceCheckIn(input: {
  weekSince: string;
  weekUntil: string;
  stats: PerformanceCheckInStats;
  inviteId?: string | null;
  submitterEmail: string;
  submitterName?: string | null;
  blockerCategory: PerformanceCheckInBlocker;
  troubleAreas: PerformanceCheckInTroubleArea[];
  helpNeeded: PerformanceCheckInHelp;
  comments: string;
  needsCoaching: boolean;
}): Promise<PerformanceCheckInRow> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error('Not authenticated.');

  const payload = {
    user_id: userId,
    invite_id: input.inviteId ?? null,
    submitter_email: input.submitterEmail,
    submitter_name: input.submitterName ?? null,
    week_since: input.weekSince,
    week_until: input.weekUntil,
    daily_call_target: input.stats.dailyCallTarget,
    daily_booking_target: input.stats.dailyBookingTarget,
    elapsed_days: input.stats.elapsedDays,
    actual_calls: input.stats.actualCalls,
    actual_booked: input.stats.actualBooked,
    expected_calls: input.stats.expectedCalls,
    expected_bookings: input.stats.expectedBookings,
    calls_pace_pct: input.stats.callsPacePct,
    bookings_pace_pct: input.stats.bookingsPacePct,
    blocker_category: input.blockerCategory,
    trouble_areas: input.troubleAreas,
    help_needed: input.helpNeeded,
    comments: input.comments.trim() || null,
    needs_coaching: input.needsCoaching,
    status: 'submitted',
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('recruiter_performance_check_ins')
    .upsert(payload, { onConflict: 'user_id,week_since' })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as PerformanceCheckInRow;
}

export async function listPerformanceCheckIns(weekSince?: string | null): Promise<PerformanceCheckInRow[]> {
  const viaFn = await fetchCoachingWeekDataViaFunction(weekSince);
  if (viaFn.ok) return viaFn.forms;

  let query = supabase
    .from('recruiter_performance_check_ins')
    .select('*')
    .order('submitted_at', { ascending: false });
  if (weekSince) query = query.eq('week_since', weekSince);
  const { data, error } = await query;
  if (error) {
    if (isSupabaseNetworkError(error.message)) {
      const retry = await fetchCoachingWeekDataViaFunction(weekSince);
      if (retry.ok) return retry.forms;
    }
    throw new Error(error.message);
  }
  return (data || []) as PerformanceCheckInRow[];
}

export async function listPerformanceCheckInInvites(weekSince?: string | null): Promise<PerformanceCheckInInvite[]> {
  const viaFn = await fetchCoachingWeekDataViaFunction(weekSince);
  if (viaFn.ok) return viaFn.invites;

  let query = supabase.from('recruiter_performance_check_in_invites').select('*').order('created_at', { ascending: false });
  if (weekSince) query = query.eq('week_since', weekSince);
  const { data, error } = await query;
  if (error) {
    if (isSupabaseNetworkError(error.message)) {
      const retry = await fetchCoachingWeekDataViaFunction(weekSince);
      if (retry.ok) return retry.invites;
    }
    throw new Error(error.message);
  }
  return (data || []) as PerformanceCheckInInvite[];
}

export async function markPerformanceCheckInReviewed(
  checkInId: string,
  reviewerNotes?: string | null,
): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error('Not authenticated.');

  const { error } = await supabase
    .from('recruiter_performance_check_ins')
    .update({
      status: 'reviewed',
      reviewed_by_user_id: userId,
      reviewed_at: new Date().toISOString(),
      reviewer_notes: reviewerNotes?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', checkInId);
  if (error) throw new Error(error.message);
}

export async function loadParticipantDirectory(): Promise<UserProfile[]> {
  const profiles = await listAllUserProfiles();
  return filterProductionStaffProfiles(profiles).filter(
    (p) => (p.role === 'recruiter' || p.role === 'leadership' || p.role === 'webinar') && !isDemoStaffProfile(p),
  );
}

export function labelForBlocker(id: string | null | undefined): string {
  return PERFORMANCE_CHECKIN_BLOCKERS.find((b) => b.id === id)?.label ?? id ?? '—';
}

export function labelForHelp(id: string | null | undefined): string {
  return PERFORMANCE_CHECKIN_HELP_OPTIONS.find((h) => h.id === id)?.label ?? id ?? '—';
}

export function labelForTroubleArea(id: string): string {
  return PERFORMANCE_CHECKIN_TROUBLE_AREAS.find((t) => t.id === id)?.label ?? id;
}

export async function deletePerformanceCheckIns(ids: string[]): Promise<void> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return;
  const { error } = await supabase.from('recruiter_performance_check_ins').delete().in('id', unique);
  if (error) throw new Error(error.message);
}

export async function listDistinctCheckInWeeks(limit = 24): Promise<string[]> {
  const { data, error } = await supabase
    .from('recruiter_performance_check_ins')
    .select('week_since')
    .order('week_since', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  const weeks = new Set((data || []).map((r) => String((r as { week_since: string }).week_since)));
  const current = currentFridayWeekBounds().since;
  weeks.add(current);
  return [...weeks].sort((a, b) => b.localeCompare(a));
}
