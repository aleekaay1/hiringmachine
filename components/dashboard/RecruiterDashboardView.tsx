import React from 'react';
import type { UserProfile } from '../../services/accessControl';
import { isOpsConsoleEmail } from '../../services/accessControl';
import { loadRecruiterPersonalMetrics, type RecruiterPersonalMetrics } from '../../services/dashboardPersonalMetrics';
import HomeLoadingScreen from './HomeLoadingScreen';
import { DayNotesPanel, GoalRow, QuickLinkCard, StatTile } from './DashboardWidgets';
import RecruiterCoinsPanel from './RecruiterCoinsPanel';
import { loadRecruiterCoinWallet, type RecruiterCoinWallet } from '../../services/recruiterCoinService';

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

const RecruiterDashboardView: React.FC<{ profile: UserProfile }> = ({ profile }) => {
  const [metrics, setMetrics] = React.useState<RecruiterPersonalMetrics | null>(null);
  const [wallet, setWallet] = React.useState<RecruiterCoinWallet | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [progress, setProgress] = React.useState({ pct: 6, label: 'Loading your stats…' });

  React.useEffect(() => {
    let cancelled = false;
    let tick: number | undefined;
    setLoading(true);
    setError(null);
    setProgress({ pct: 8, label: 'Loading personal metrics…' });

    tick = window.setInterval(() => {
      setProgress((prev) => ({
        ...prev,
        pct: Math.min(prev.pct + 3, 92),
      }));
    }, 320);

    void Promise.all([
      loadRecruiterPersonalMetrics(profile).then((data) => {
        if (!cancelled) {
          setProgress({ pct: 55, label: 'Loading Paz Coins…' });
          return data;
        }
        return null;
      }),
      loadRecruiterCoinWallet({
        profileBalance: Number(profile.points || 0),
        email: profile.email,
        fullName: profile.full_name,
      }).then((coinWallet) => {
        if (!cancelled) setProgress({ pct: 85, label: 'Preparing dashboard…' });
        return coinWallet;
      }),
    ])
      .then(([data, coinWallet]) => {
        if (cancelled || !data) return;
        setMetrics(data);
        setWallet(coinWallet);
        setProgress({ pct: 100, label: 'Ready' });
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (tick) window.clearInterval(tick);
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      if (tick) window.clearInterval(tick);
    };
  }, [profile]);

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">{error}</div>
    );
  }

  if (loading || !metrics) {
    return (
      <HomeLoadingScreen
        progress={progress}
        title="Loading your stats"
        subtitle="Rank, calls, bookings, and coin balance for your week."
      />
    );
  }

  return (
    <>
      <RecruiterCoinsPanel wallet={wallet} loading={!wallet && !error} />

      <div className="rounded-3xl border border-[#d9e5f6] bg-white/80 p-4 backdrop-blur-xl">
        <p className="text-[10px] uppercase tracking-[0.2em] text-[#2f6ea8]">Your week at a glance</p>
        <p className="mt-1 text-xs text-[#5c7594]">{metrics.windowLabel}</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Rank" value={metrics.rank != null ? `#${metrics.rank}` : '—'} sub={metrics.rankDelta !== 0 ? `${metrics.rankDelta > 0 ? '+' : ''}${metrics.rankDelta} vs last period` : undefined} />
          <StatTile label="Score" value={metrics.score.toFixed(1)} />
          <StatTile
            label="Webinar booked"
            value={metrics.webinarBooked}
            sub={`${metrics.webinarShowed} showed`}
          />
          <StatTile
            label="Live session"
            value={metrics.liveSessionBooked}
            sub={`${metrics.liveSessionShowed} showed`}
          />
          <StatTile label="Combined show rate" value={pct(metrics.showRatio)} />
          <StatTile label="Calls" value={metrics.calls} sub={`${metrics.bookedCalls} booked on calls`} />
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <GoalRow label="Daily resume uploads" current={0} goal={metrics.uploadGoal} />
          <GoalRow label="Daily webinar bookings" current={metrics.webinarBooked} goal={metrics.webinarGoal} />
        </div>
        <p className="mt-2 text-[10px] text-[#6a839f]">
          Upload progress updates in the uploads workspace. Booking goal compares to your week total above until daily tracking is added.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#4e79a9]">Quick links</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <QuickLinkCard title="Call workspace" description="Dial candidates and log outcomes." to="/pipeline/call" accent="border-[#9bc8f6] bg-[#eef6ff] hover:bg-[#e7f4ff]" />
            <QuickLinkCard title="Performance" description="Review your activity over time." to="/pipeline/performance" />
            <QuickLinkCard title="Email" description="Send and track candidate email." to="/pipeline/email" />
            <QuickLinkCard title="Resume uploads" description="Upload resumes for your queue." to="/pipeline/uploads" />
            <QuickLinkCard title="Webinar activity" description="See bookings and attendance." to="/webinar-geek" />
            <QuickLinkCard title="Leaderboard" description="See how you rank on the team board." to="/calls-analytics/leaderboard" />
            <QuickLinkCard title="Support" description="Submit an issue or track your ticket." to="/support" accent="border-[#c8ddf4] bg-[#f4f9ff] hover:bg-[#ebf5ff]" />
            {isOpsConsoleEmail(profile.email) && (
              <QuickLinkCard title="Ops console" description="Private monitoring & ticket backend." to="/ops-console" accent="border-[#0B1B34]/20 bg-[#0B1B34] text-white hover:opacity-95" />
            )}
          </div>
        </div>
        <DayNotesPanel userId={profile.user_id} />
      </div>
    </>
  );
};

export default RecruiterDashboardView;
