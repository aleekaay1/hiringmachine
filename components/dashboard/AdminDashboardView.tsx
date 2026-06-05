import React from 'react';
import type { UserProfile } from '../../services/accessControl';
import { isOpsConsoleEmail, listAllUserProfiles } from '../../services/accessControl';
import { loadAdminOverviewMetrics, type LeadershipTeamMetrics } from '../../services/dashboardPersonalMetrics';
import HomeLoadingScreen from './HomeLoadingScreen';
import { DayNotesPanel, RecruiterStandingsBoard, StatTile, QuickLinkCard } from './DashboardWidgets';
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
  const [loading, setLoading] = React.useState(true);
  const [progress, setProgress] = React.useState({ pct: 6, label: 'Loading organization overview…' });

  React.useEffect(() => {
    let cancelled = false;
    let tick: number | undefined;
    setLoadError(null);
    setLoading(true);
    tick = window.setInterval(() => {
      setProgress((prev) => ({ ...prev, pct: Math.min(prev.pct + 3, 92) }));
    }, 320);

    void Promise.all([
      loadAdminOverviewMetrics().catch((e) => {
        if (cancelled) return null;
        setLoadError(e instanceof Error ? e.message : String(e));
        return {
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
        } satisfies LeadershipTeamMetrics;
      }),
      listAllUserProfiles().catch(() => []),
    ])
      .then(([team, profiles]) => {
        if (cancelled || !team) return;
        setProgress({ pct: 88, label: 'Preparing dashboard…' });
        setMetrics(team);
        const counts: Record<string, number> = {};
        for (const p of profiles) {
          counts[p.role] = (counts[p.role] || 0) + 1;
        }
        setRoleCounts(counts);
        setProgress({ pct: 100, label: 'Ready' });
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
        title="Loading organization overview"
        subtitle="Team metrics, charts, and admin quick links."
      />
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
          {isOpsConsoleEmail(profile.email) && (
            <QuickLinkCard title="Ops console" description="Private monitoring & tickets." to="/ops-console" accent="border-[#0B1B34]/20 bg-[#0B1B34] text-white" />
          )}
          <QuickLinkCard title="Support" description="Team support tickets." to="/support" />
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
