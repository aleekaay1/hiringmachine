/** Coaching hub uses team-wide weekly targets (not per-user call settings). */
export const COACHING_WEEKLY_BOOKING_TARGET = 30;
export const COACHING_WEEKLY_CALL_TARGET = 105;

export type CoachingPaceSnapshot = {
  dailyCallTarget: number;
  dailyBookingTarget: number;
  expectedCalls: number;
  expectedBookings: number;
  callsPacePct: number | null;
  bookingsPacePct: number | null;
  belowThreshold: boolean;
  hasTargets: true;
};

export function computeCoachingWeeklyPace(input: {
  actualCalls: number;
  actualBooked: number;
  elapsedDays: number;
}): CoachingPaceSnapshot {
  const elapsed = Math.max(1, Math.min(7, input.elapsedDays));
  const expectedBookings = Math.round((COACHING_WEEKLY_BOOKING_TARGET * elapsed) / 7);
  const expectedCalls = Math.round((COACHING_WEEKLY_CALL_TARGET * elapsed) / 7);
  const callsPacePct =
    expectedCalls > 0 ? Math.round((input.actualCalls / expectedCalls) * 10000) / 100 : null;
  const bookingsPacePct =
    expectedBookings > 0 ? Math.round((input.actualBooked / expectedBookings) * 10000) / 100 : null;
  const belowThreshold =
    (bookingsPacePct !== null && bookingsPacePct < 50) || (callsPacePct !== null && callsPacePct < 50);

  return {
    dailyCallTarget: Math.round((COACHING_WEEKLY_CALL_TARGET / 7) * 10) / 10,
    dailyBookingTarget: Math.round((COACHING_WEEKLY_BOOKING_TARGET / 7) * 10) / 10,
    expectedCalls,
    expectedBookings,
    callsPacePct,
    bookingsPacePct,
    belowThreshold,
    hasTargets: true,
  };
}

export function combinedCoachingPace(calls: number | null, bookings: number | null): number | null {
  const values = [calls, bookings].filter((v): v is number => v !== null && Number.isFinite(v));
  if (!values.length) return null;
  return Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 100) / 100;
}
