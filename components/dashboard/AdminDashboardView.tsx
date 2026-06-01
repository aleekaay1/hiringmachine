import React from 'react';
import type { UserProfile } from '../../services/accessControl';
import { listAllUserProfiles } from '../../services/accessControl';
import { loadAdminOverviewMetrics, type LeadershipTeamMetrics } from '../../services/dashboardPersonalMetrics';
import { DayNotesPanel, formatLeaderboardRefreshed, QuickLinkCard, RecruiterStandingsBoard, StatTile } from './DashboardWidgets';

const AdminDashboardView: React.FC<{ profile: UserProfile }> = ({ profile }) => {
  const [metrics, setMetrics] = React.useState<LeadershipTeamMetrics | null>(null);
  const [roleCounts, setRoleCounts] = React.useState<Record<string, number>>({});

  React.useEffect(() => {
    let cancelled = false;
    void Promise.all([loadAdminOverviewMetrics(), listAllUserProfiles().catch(() => [])]).then(([team, profiles]) => {
      if (cancelled) return;
      setMetrics(team);
      const counts: Record<string, number> = {};
      for (const p of profiles) {
        counts[p.role] = (counts[p.role] || 0) + 1;
      }
      setRoleCounts(counts);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!metrics) {
    return <div className="rounded-2xl border border-[#dfeaf8] bg-[#f9fcff] px-4 py-8 text-center text-sm text-[#4f6886]">Loading organization overview…</div>;
  }

  return (
    <>
      <div className="rounded-3xl border border-[#d9e5f6] bg-white/80 p-4 backdrop-blur-xl">
        <p className="text-[10px] uppercase tracking-[0.2em] text-[#2f6ea8]">Organization snapshot</p>
        <p className="mt-1 text-xs text-[#5c7594]">{metrics.windowLabel}</p>
        <p className="text-[11px] text-[#6a839f]">{formatLeaderboardRefreshed(metrics.refreshedAt)}</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <StatTile label="Recruiters" value={roleCounts.recruiter || 0} />
          <StatTile label="Leadership" value={roleCounts.leadership || 0} />
          <StatTile label="Webinar staff" value={roleCounts.webinar || 0} />
          <StatTile label="HR" value={roleCounts.hr || 0} />
          <StatTile label="On leaderboard" value={metrics.teamSize} />
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <StatTile label="Team booked" value={metrics.totalWebinarBooked} />
          <StatTile label="Team attended" value={metrics.totalWebinarShowed} />
          <StatTile label="Team calls" value={metrics.totalCalls} />
        </div>
      </div>

      <RecruiterStandingsBoard rows={metrics.topPerformers} />

      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#4e79a9]">Administration</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <QuickLinkCard title="Leadership board" description="Team performance rankings." to="/calls-analytics/leaderboard" />
            <QuickLinkCard title="Pipeline settings" description="Extensions, targets, and dial rules." to="/pipeline-settings" />
            <QuickLinkCard title="QR codes" description="Event and collateral QR management." to="/qr" />
            <QuickLinkCard title="Email log" description="Outbound email history." to="/email-log" />
            <QuickLinkCard title="Webinar data" description="Subscriptions and attendance." to="/webinar-geek" />
            <QuickLinkCard title="Live sessions" description="Calendly and Zoom sessions." to="/live-sessions" />
            <QuickLinkCard title="HR dashboard" description="HR workflows and risk signals." to="/hr-dashboard" />
          </div>
        </div>
        <DayNotesPanel userId={profile.user_id} />
      </div>
    </>
  );
};

export default AdminDashboardView;
