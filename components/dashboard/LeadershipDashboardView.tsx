import React from 'react';
import type { UserProfile } from '../../services/accessControl';
import { loadLeadershipTeamMetrics, type LeadershipTeamMetrics } from '../../services/dashboardPersonalMetrics';
import { DayNotesPanel, formatLeaderboardRefreshed, QuickLinkCard, RecruiterStandingsBoard, StatTile } from './DashboardWidgets';
import HomeLoadingScreen from './HomeLoadingScreen';
import { isOpsConsoleEmail } from '../../services/accessControl';

const LeadershipDashboardView: React.FC<{ profile: UserProfile }> = ({ profile }) => {
  const [metrics, setMetrics] = React.useState<LeadershipTeamMetrics | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [progress, setProgress] = React.useState({ pct: 6, label: 'Loading team overview…' });

  React.useEffect(() => {
    let cancelled = false;
    let tick: number | undefined;
    setLoading(true);
    tick = window.setInterval(() => {
      setProgress((prev) => ({ ...prev, pct: Math.min(prev.pct + 3, 92) }));
    }, 320);
    void loadLeadershipTeamMetrics()
      .then((data) => {
        if (!cancelled) {
          setMetrics(data);
          setProgress({ pct: 100, label: 'Ready' });
        }
      })
      .finally(() => {
        if (!cancelled) {
          if (tick) window.clearInterval(tick);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
      if (tick) window.clearInterval(tick);
    };
  }, []);

  if (loading || !metrics) {
    return (
      <HomeLoadingScreen
        progress={progress}
        title="Loading team overview"
        subtitle="Leadership metrics and standings for this week."
      />
    );
  }

  return (
    <>
      <div className="rounded-3xl border border-[#d9e5f6] bg-white/80 p-4 backdrop-blur-xl">
        <p className="text-[10px] uppercase tracking-[0.2em] text-[#2f6ea8]">Team pulse</p>
        <p className="mt-1 text-xs text-[#5c7594]">{metrics.windowLabel}</p>
        <p className="text-[11px] text-[#6a839f]">{formatLeaderboardRefreshed(metrics.refreshedAt)}</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Active on board" value={metrics.teamSize} />
          <StatTile label="Team booked" value={metrics.totalWebinarBooked} />
          <StatTile label="Team attended" value={metrics.totalWebinarShowed} />
          <StatTile label="Team calls" value={metrics.totalCalls} />
        </div>
      </div>

      <RecruiterStandingsBoard rows={metrics.topPerformers} />

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="grid gap-3 sm:grid-cols-2">
          <QuickLinkCard title="Leadership board" description="Full rankings, badges, and filters." to="/calls-analytics/leaderboard" accent="border-[#f0ce8f] bg-[#fff8ea] hover:bg-[#fff5df]" />
          <QuickLinkCard title="Calls analytics" description="Booking and attendance analytics." to="/calls-analytics" />
          <QuickLinkCard title="Webinar overview" description="Organization-wide webinar data." to="/webinar-geek" />
          <QuickLinkCard title="Call workspace" description="Jump into the dialer when needed." to="/pipeline/call" />
          <QuickLinkCard title="Admin candidates" description="Candidate records and journey stages." to="/dashboard?view=candidates" />
          <QuickLinkCard title="Live sessions" description="Session schedules and invitees." to="/live-sessions" />
          <QuickLinkCard title="Support" description="Submit an issue or track your ticket." to="/support" />
          {isOpsConsoleEmail(profile.email) && (
            <QuickLinkCard title="Ops console" description="Private monitoring backend." to="/ops-console" accent="border-[#0B1B34]/20 bg-[#0B1B34] text-white" />
          )}
        </div>
        <DayNotesPanel userId={profile.user_id} />
      </div>
    </>
  );
};

export default LeadershipDashboardView;
