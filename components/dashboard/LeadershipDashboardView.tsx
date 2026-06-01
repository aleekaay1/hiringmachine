import React from 'react';
import type { UserProfile } from '../../services/accessControl';
import { loadLeadershipTeamMetrics, type LeadershipTeamMetrics } from '../../services/dashboardPersonalMetrics';
import { DayNotesPanel, QuickLinkCard, StatTile } from './DashboardWidgets';

function formatRefreshed(iso: string | null): string {
  if (!iso) return 'Refresh the leaderboard for latest team numbers';
  return `Board updated ${new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
}

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
        <p className="text-[11px] text-[#6a839f]">{formatRefreshed(metrics.refreshedAt)}</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Active on board" value={metrics.teamSize} />
          <StatTile label="Team booked" value={metrics.totalWebinarBooked} />
          <StatTile label="Team attended" value={metrics.totalWebinarShowed} />
          <StatTile label="Team calls" value={metrics.totalCalls} />
        </div>
      </div>

      {metrics.topPerformers.length > 0 && (
        <div className="rounded-3xl border border-[#d9e5f6] bg-white/80 p-4 backdrop-blur-xl">
          <p className="text-sm font-semibold text-[#0B1B34]">Recruiter standings (saved board)</p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-xs">
              <thead className="text-[#6d86a3]">
                <tr>
                  <th className="pb-2 pr-3 font-medium">#</th>
                  <th className="pb-2 pr-3 font-medium">Name</th>
                  <th className="pb-2 pr-3 font-medium">Booked</th>
                  <th className="pb-2 pr-3 font-medium">Attended</th>
                  <th className="pb-2 pr-3 font-medium">Calls</th>
                  <th className="pb-2 font-medium">Score</th>
                </tr>
              </thead>
              <tbody>
                {metrics.topPerformers.map((row) => (
                  <tr key={row.recruiterKey} className="border-t border-[#eef4fb] text-[#35567a]">
                    <td className="py-2 pr-3 font-semibold text-[#0B1B34]">{row.rank}</td>
                    <td className="py-2 pr-3">{row.displayName}</td>
                    <td className="py-2 pr-3 tabular-nums">{row.webinarBooked}</td>
                    <td className="py-2 pr-3 tabular-nums">{row.webinarShowed}</td>
                    <td className="py-2 pr-3 tabular-nums">{row.calls}</td>
                    <td className="py-2 tabular-nums">{row.score.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
