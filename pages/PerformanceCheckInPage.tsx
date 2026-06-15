import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, CheckCircle2, ClipboardList, PhoneCall } from 'lucide-react';
import PipelineAuthShell from '../components/PipelineAuthShell';
import { Button } from '../components/UI';
import {
  getCurrentUserProfile,
} from '../services/accessControl';
import {
  canAccessPerformanceCheckInParticipant,
  PERFORMANCE_CHECKIN_BLOCKERS,
  PERFORMANCE_CHECKIN_HELP_OPTIONS,
  PERFORMANCE_CHECKIN_TROUBLE_AREAS,
  loadInviteByToken,
  loadMidWeekStatsForProfile,
  loadMyCheckInForWeek,
  submitPerformanceCheckIn,
  type PerformanceCheckInBlocker,
  type PerformanceCheckInHelp,
  type PerformanceCheckInStats,
  type PerformanceCheckInTroubleArea,
} from '../services/performanceCheckInService';

function paceClass(pct: number | null): string {
  if (pct === null) return 'text-slate-500';
  if (pct < 50) return 'text-rose-600';
  if (pct < 80) return 'text-amber-600';
  return 'text-emerald-600';
}

function StatsCard({ stats }: { stats: PerformanceCheckInStats }) {
  return (
    <div className="grid gap-3 rounded-2xl border border-[#d4e4f7] bg-white/80 p-4 sm:grid-cols-2">
      <div>
        <p className="text-[10px] uppercase tracking-[0.2em] text-[#4e79a9]">Week</p>
        <p className="text-sm font-medium text-[#0B1B34]">{stats.weekLabel}</p>
        <p className="mt-1 text-xs text-[#5c7594]">Day {stats.elapsedDays} of Fri–Thu week</p>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-[0.2em] text-[#4e79a9]">Calls pace</p>
        <p className={`text-lg font-semibold ${paceClass(stats.callsPacePct)}`}>
          {stats.callsPacePct !== null ? `${stats.callsPacePct}%` : '—'}
        </p>
        <p className="text-xs text-[#5c7594]">
          {stats.actualCalls} / {stats.expectedCalls ?? '—'} target calls
        </p>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-[0.2em] text-[#4e79a9]">Bookings pace</p>
        <p className={`text-lg font-semibold ${paceClass(stats.bookingsPacePct)}`}>
          {stats.bookingsPacePct !== null ? `${stats.bookingsPacePct}%` : '—'}
        </p>
        <p className="text-xs text-[#5c7594]">
          {stats.actualBooked} / {stats.expectedBookings ?? '—'} target bookings
        </p>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-[0.2em] text-[#4e79a9]">Daily targets</p>
        <p className="text-sm text-[#0B1B34]">
          {stats.dailyCallTarget ?? '—'} calls · {stats.dailyBookingTarget ?? '—'} bookings
        </p>
      </div>
    </div>
  );
}

const PerformanceCheckInPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token')?.trim() ?? '';

  const [loading, setLoading] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [stats, setStats] = React.useState<PerformanceCheckInStats | null>(null);
  const [alreadySubmitted, setAlreadySubmitted] = React.useState(false);
  const [inviteId, setInviteId] = React.useState<string | null>(null);
  const [fromInvite, setFromInvite] = React.useState(false);

  const [blocker, setBlocker] = React.useState<PerformanceCheckInBlocker>('dial_time');
  const [troubleAreas, setTroubleAreas] = React.useState<PerformanceCheckInTroubleArea[]>([]);
  const [helpNeeded, setHelpNeeded] = React.useState<PerformanceCheckInHelp>('coaching_call');
  const [comments, setComments] = React.useState('');
  const [needsCoaching, setNeedsCoaching] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const profile = await getCurrentUserProfile();
        if (!profile || !canAccessPerformanceCheckInParticipant(profile.role)) {
          throw new Error('This check-in form is for recruiters and leadership only.');
        }

        let weekSince: string | null = null;
        if (token) {
          const invite = await loadInviteByToken(token);
          if (invite) {
            if (invite.user_id !== profile.user_id) {
              throw new Error('This check-in link was sent to a different account.');
            }
            weekSince = invite.week_since;
            setInviteId(invite.id);
            setFromInvite(true);
          }
        }

        const midStats = await loadMidWeekStatsForProfile(profile);
        const effectiveWeek = weekSince ?? midStats.weekSince;
        const existing = await loadMyCheckInForWeek(effectiveWeek);
        if (!cancelled) {
          setStats({ ...midStats, weekSince: effectiveWeek, weekUntil: midStats.weekUntil });
          setAlreadySubmitted(Boolean(existing));
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const toggleTrouble = (id: PerformanceCheckInTroubleArea) => {
    setTroubleAreas((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const onSubmit = async () => {
    if (!stats) return;
    if (!comments.trim()) {
      setError('Please add a short note in the comments box so leadership can help.');
      return;
    }
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const profile = await getCurrentUserProfile();
      if (!profile) throw new Error('Not authenticated.');
      await submitPerformanceCheckIn({
        weekSince: stats.weekSince,
        weekUntil: stats.weekUntil,
        stats,
        inviteId,
        submitterEmail: profile.email ?? '',
        submitterName: profile.full_name,
        blockerCategory: blocker,
        troubleAreas,
        helpNeeded,
        comments,
        needsCoaching,
      });
      setAlreadySubmitted(true);
      setMessage('Thanks — your check-in was saved. Leadership can review it before the weekly recruiting meeting.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PipelineAuthShell
      title="Mid-week check-in"
      subtitle="Sign in to complete your coaching form"
      redirectPath="/performance-check-in"
    >
      <div className="mx-auto w-full max-w-[760px] space-y-4 p-1">
        <div className="rounded-3xl border border-[#d4e4f7] bg-gradient-to-br from-white via-[#f7fbff] to-[#eef6ff] p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.24em] text-[#4e79a9]">Coaching</p>
              <h1 className="text-2xl font-semibold text-[#0B1B34]">Mid-week performance check-in</h1>
              <p className="mt-1 text-sm text-[#5c7594]">
                A quick pulse on what is slowing you down this week. Fill this out and get back to dialing — leadership
                reviews before the recruiting meeting.
              </p>
            </div>
            <ClipboardList className="text-[#4e9ae8]" size={28} />
          </div>
        </div>

        {loading && (
          <div className="rounded-2xl border border-[#d4e4f7] bg-white p-6 text-sm text-[#5c7594]">Loading…</div>
        )}

        {error && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div>
        )}

        {!loading && stats && (
          <>
            {fromInvite && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                You are below 50% of mid-week pace on at least one target. This form helps us coach you before the week
                ends.
              </div>
            )}

            <StatsCard stats={stats} />

            {alreadySubmitted ? (
              <div className="space-y-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600" size={22} />
                  <div>
                    <h2 className="text-lg font-semibold text-emerald-900">Check-in submitted</h2>
                    <p className="mt-1 text-sm text-emerald-800">
                      {message || 'You already submitted for this week. Leadership has your notes.'}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link to="/pipeline/call">
                    <Button>
                      <PhoneCall size={16} className="mr-2" />
                      Back to phone workspace
                    </Button>
                  </Link>
                  <Link to="/home">
                    <Button variant="secondary">Home</Button>
                  </Link>
                </div>
              </div>
            ) : (
              <div className="space-y-4 rounded-2xl border border-[#d4e4f7] bg-white p-5 shadow-sm">
                <div>
                  <label className="mb-2 block text-sm font-medium text-[#0B1B34]">
                    What has been the biggest blocker this week?
                  </label>
                  <select
                    className="w-full rounded-xl border border-[#c9d9ee] bg-white px-3 py-2 text-sm"
                    value={blocker}
                    onChange={(e) => setBlocker(e.target.value as PerformanceCheckInBlocker)}
                  >
                    {PERFORMANCE_CHECKIN_BLOCKERS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <p className="mb-2 text-sm font-medium text-[#0B1B34]">Where are you struggling most? (pick any)</p>
                  <div className="flex flex-wrap gap-2">
                    {PERFORMANCE_CHECKIN_TROUBLE_AREAS.map((opt) => {
                      const active = troubleAreas.includes(opt.id);
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => toggleTrouble(opt.id)}
                          className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                            active
                              ? 'border-[#4e9ae8] bg-[#e8f4ff] text-[#0B1B34]'
                              : 'border-[#d4e4f7] bg-white text-[#5c7594] hover:border-[#9ec5ea]'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-[#0B1B34]">
                    What would help you finish the week strong?
                  </label>
                  <select
                    className="w-full rounded-xl border border-[#c9d9ee] bg-white px-3 py-2 text-sm"
                    value={helpNeeded}
                    onChange={(e) => setHelpNeeded(e.target.value as PerformanceCheckInHelp)}
                  >
                    {PERFORMANCE_CHECKIN_HELP_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-[#0B1B34]">
                    Tell us more — what is going on and what support do you need?
                  </label>
                  <textarea
                    className="min-h-[120px] w-full rounded-xl border border-[#c9d9ee] bg-white px-3 py-2 text-sm"
                    value={comments}
                    onChange={(e) => setComments(e.target.value)}
                    placeholder="Example: I have been stuck on voicemails, need a fresh lead pack, or want a 10-min script review…"
                  />
                </div>

                <label className="flex items-center gap-2 text-sm text-[#0B1B34]">
                  <input
                    type="checkbox"
                    checked={needsCoaching}
                    onChange={(e) => setNeedsCoaching(e.target.checked)}
                    className="rounded border-[#c9d9ee]"
                  />
                  I would like leadership to follow up with me this week
                </label>

                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <Button onClick={() => void onSubmit()} disabled={submitting}>
                    {submitting ? 'Saving…' : 'Submit check-in'}
                    <ArrowRight size={16} className="ml-2" />
                  </Button>
                  <Link to="/pipeline/call" className="text-sm text-[#4e79a9] hover:underline">
                    Skip for now — back to dialing
                  </Link>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </PipelineAuthShell>
  );
};

export default PerformanceCheckInPage;
