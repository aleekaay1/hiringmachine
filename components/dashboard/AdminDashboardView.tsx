import React from 'react';
import type { UserProfile } from '../../services/accessControl';
import { isOpsConsoleEmail } from '../../services/accessControl';
import type { HomeDashboardPayload } from '../../services/homeDashboardCache';
import { DayNotesPanel, RecruiterStandingsBoard, StatTile, QuickLinkCard } from './DashboardWidgets';
import {
  AdminQuickLinksStrip,
  AdminSnapshotHeader,
  RecruiterComparisonChart,
  TeamActivityBreakdown,
  TeamShowRateRing,
} from './AdminOverviewCharts';
import { EmptyHomePrompt } from './EmptyHomePrompt';

type Props = {
  profile: UserProfile;
  payload: HomeDashboardPayload | null;
  refreshing: boolean;
  onRefresh: () => void;
};

const AdminDashboardView: React.FC<Props> = ({ profile, payload }) => {
  if (!payload || payload.kind !== 'admin') {
    return (
      <EmptyHomePrompt message="No saved organization overview yet. Tap refresh in the top right to load team metrics." />
    );
  }

  const { metrics, roleCounts } = payload;
  const emptyChartHint =
    metrics.refreshedAt == null
      ? 'Open the leadership board and refresh to populate charts.'
      : 'No recruiter activity in this window yet.';

  return (
    <>
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
            Saved snapshot from your last refresh. Use the refresh button above for the latest team numbers.
          </p>
        </div>
        <DayNotesPanel userId={profile.user_id} />
      </div>
    </>
  );
};

export default AdminDashboardView;
