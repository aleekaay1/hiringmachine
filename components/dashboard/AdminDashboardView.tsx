import React from 'react';
import type { UserProfile } from '../../services/accessControl';
import { listAllUserProfiles } from '../../services/accessControl';
import { loadAdminOverviewMetrics, type LeadershipTeamMetrics } from '../../services/dashboardPersonalMetrics';
import { DayNotesPanel, RecruiterStandingsBoard, StatTile } from './DashboardWidgets';
import {
  AdminQuickLinksStrip,
  AdminSnapshotHeader,
  RecruiterComparisonChart,
  TeamActivityBreakdown,
  TeamShowRateRing,
} from './AdminOverviewCharts';

const AdminDashboardView: React.FC<{ profile: UserProfile }> = ({ profile }) => {
  const [metrics, setMetrics] = React.useState<LeadershipTeamMetrics | null>(null);
  const [roleCounts, setRoleCounts] = React.useState<Record<string, number>>({});
  const [loadError, setLoadError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    void loadAdminOverviewMetrics()
      .then((team) => {
        if (cancelled) return;
        setMetrics(team);
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : String(e));
        setMetrics({
          windowLabel: 'This week',
          teamSize: 0,
          totalWebinarBooked: 0,
          totalWebinarShowed: 0,
          totalLiveBooked: 0,
          totalLiveShowed: 0,
          totalCalls: 0,
          totalBooked: 0,
          showRatePct: 0,
          topPerformers: [],
          performerBars: [],
          refreshedAt: null,
        });
      });

    void listAllUserProfiles()
      .then((profiles) => {
        if (cancelled) return;
        const counts: Record<string, number> = {};
        for (const p of profiles) {
          counts[p.role] = (counts[p.role] || 0) + 1;
        }
        setRoleCounts(counts);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  if (!metrics) {
    return (
      <div className="rounded-2xl border border-[#dfeaf8] bg-[#f9fcff] px-4 py-8 text-center text-sm text-[#4f6886]">
        Loading organization overview…
      </div>
    );
  }

  const emptyChartHint =
    metrics.refreshedAt == null
      ? 'Open the leadership board and refresh to populate charts.'
      : 'No recruiter activity in this window yet.';

  return (
    <>
      {loadError ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Some dashboard data could not be loaded from the database ({loadError}). Showing cached or live estimates where available.
          Open the leadership board and click Refresh for the latest team numbers.
        </div>
      ) : null}
      <div className="rounded-3xl border border-[#d9e5f6] bg-white/80 p-4 backdrop-blur-xl">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <div className="flex flex-col">
            <AdminSnapshotHeader metrics={metrics} roleCounts={roleCounts} />
            <div className="mt-auto grid gap-2 sm:grid-cols-3">
              <StatTile label="Team booked" value={metrics.totalBooked} sub="Webinar + live" />
              <StatTile label="Team attended" value={metrics.totalWebinarShowed + metrics.totalLiveShowed} />
              <StatTile
                label="Show rate"
                value={`${metrics.showRatePct}%`}
                sub={metrics.totalBooked > 0 ? 'Combined channels' : 'No bookings yet'}
              />
            </div>
          </div>
          <TeamShowRateRing
            showRatePct={metrics.showRatePct}
            totalBooked={metrics.totalBooked}
            totalShowed={metrics.totalWebinarShowed + metrics.totalLiveShowed}
            windowLabel={metrics.windowLabel}
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <RecruiterComparisonChart bars={metrics.performerBars} emptyHint={emptyChartHint} />
        <TeamActivityBreakdown metrics={metrics} />
      </div>

      <RecruiterStandingsBoard rows={metrics.topPerformers} />

      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#4e79a9]">Administration</p>
          <AdminQuickLinksStrip />
          <p className="text-[11px] text-[#6d86a3]">
            Charts use the saved leaderboard window. Refresh the board for the latest team numbers.
          </p>
        </div>
        <DayNotesPanel userId={profile.user_id} />
      </div>
    </>
  );
};

export default AdminDashboardView;
