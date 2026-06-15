import React from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList, X } from 'lucide-react';
import type { AppRole } from '../services/accessControl';
import { getCurrentUserProfile } from '../services/accessControl';
import {
  canAccessPerformanceCheckInParticipant,
  currentFridayWeekBounds,
  isMidWeekCoachingDay,
  loadMidWeekStatsForProfile,
  loadMyCheckInForWeek,
} from '../services/performanceCheckInService';

const DISMISS_KEY_PREFIX = 'pohiring_checkin_due_dismiss:';

type DueState = {
  weekSince: string;
  callsPacePct: number | null;
  bookingsPacePct: number | null;
};

const PerformanceCheckInDueBanner: React.FC<{ role: AppRole | null; userId: string | null }> = ({ role, userId }) => {
  const [due, setDue] = React.useState<DueState | null>(null);
  const [dismissed, setDismissed] = React.useState(false);

  React.useEffect(() => {
    if (!userId || !canAccessPerformanceCheckInParticipant(role)) {
      setDue(null);
      return;
    }
    if (!isMidWeekCoachingDay()) {
      setDue(null);
      return;
    }

    const week = currentFridayWeekBounds();
    const dismissKey = `${DISMISS_KEY_PREFIX}${userId}:${week.since}`;
    if (sessionStorage.getItem(dismissKey) === '1') {
      setDismissed(true);
    }

    let cancelled = false;
    void (async () => {
      try {
        const profile = await getCurrentUserProfile();
        if (!profile || profile.user_id !== userId) return;
        const existing = await loadMyCheckInForWeek(week.since);
        if (existing) {
          if (!cancelled) setDue(null);
          return;
        }
        const stats = await loadMidWeekStatsForProfile(profile);
        if (!stats.belowThreshold) {
          if (!cancelled) setDue(null);
          return;
        }
        if (!cancelled) {
          setDue({
            weekSince: week.since,
            callsPacePct: stats.callsPacePct,
            bookingsPacePct: stats.bookingsPacePct,
          });
        }
      } catch {
        if (!cancelled) setDue(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [role, userId]);

  if (!due || dismissed) return null;

  const dismissKey = `${DISMISS_KEY_PREFIX}${userId}:${due.weekSince}`;

  return (
    <div className="border-b border-amber-200 bg-gradient-to-r from-amber-50 via-[#fff8ed] to-amber-50 px-4 py-2.5">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <ClipboardList className="mt-0.5 shrink-0 text-amber-700" size={18} />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-amber-950">Mid-week check-in due</p>
            <p className="text-xs text-amber-900/90">
              You are below 50% mid-week pace (calls {due.callsPacePct ?? '—'}% · bookings {due.bookingsPacePct ?? '—'}%).
              Complete your coaching form so leadership can help.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/performance-check-in"
            className="rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-800"
          >
            Open check-in
          </Link>
          <button
            type="button"
            aria-label="Dismiss for this session"
            onClick={() => {
              sessionStorage.setItem(dismissKey, '1');
              setDismissed(true);
            }}
            className="rounded-lg p-1.5 text-amber-800 hover:bg-amber-100"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default PerformanceCheckInDueBanner;
