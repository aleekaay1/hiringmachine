import React from 'react';
import type { UserProfile } from '../../services/accessControl';
import { loadLeadershipTeamMetrics, type LeadershipTeamMetrics } from '../../services/dashboardPersonalMetrics';
import { DayNotesPanel, formatLeaderboardRefreshed, QuickLinkCard, RecruiterStandingsBoard, StatTile } from './DashboardWidgets';

const LeadershipDashboardView: React.FC<{ profile: UserProfile }> = ({ profile }) => {
  const [metrics, setMetrics] = React.useState<LeadershipTeamMetrics | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void loadLeadershipTeamMetrics().then((data) => {
      if (!cancelled) setMetrics(data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!metrics) {
    return <div className="rounded-2xl border border-[#dfeaf8] bg-[#f9fcff] px-4 py-8 text-center text-sm text-[#4f6886]">Loading team overview…</div>;
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
        </div>
        <DayNotesPanel userId={profile.user_id} />
      </div>
    </>
  );
};

export default LeadershipDashboardView;
