import React from 'react';
import type { UserProfile } from '../../services/accessControl';
import { isOpsConsoleEmail } from '../../services/accessControl';
import type { HomeDashboardPayload } from '../../services/homeDashboardCache';
import { DayNotesPanel, GoalRow, QuickLinkCard, StatTile } from './DashboardWidgets';
import RecruiterCoinsPanel from './RecruiterCoinsPanel';
import { EmptyHomePrompt } from './EmptyHomePrompt';

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

type Props = {
  profile: UserProfile;
  payload: HomeDashboardPayload | null;
  refreshing: boolean;
  onRefresh: () => void;
};

const RecruiterDashboardView: React.FC<Props> = ({ profile, payload }) => {
  if (!payload || payload.kind !== 'recruiter') {
    return (
      <EmptyHomePrompt message="No saved stats yet. Tap refresh in the top right to load your week at a glance." />
    );
  }

  const { metrics, wallet } = payload;

  return (
    <>
      <RecruiterCoinsPanel wallet={wallet} loading={false} />

      <div className="rounded-3xl border border-[#d9e5f6] bg-white/80 p-4 backdrop-blur-xl">
        <p className="text-[10px] uppercase tracking-[0.2em] text-[#2f6ea8]">Your week at a glance</p>
        <p className="mt-1 text-xs text-[#5c7594]">{metrics.windowLabel}</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Rank" value={metrics.rank != null ? `#${metrics.rank}` : '—'} sub={metrics.rankDelta !== 0 ? `${metrics.rankDelta > 0 ? '+' : ''}${metrics.rankDelta} vs last period` : undefined} />
          <StatTile label="Score" value={metrics.score.toFixed(1)} />
          <StatTile label="Webinar booked" value={metrics.webinarBooked} sub={`${metrics.webinarShowed} showed`} />
          <StatTile label="Live session" value={metrics.liveSessionBooked} sub={`${metrics.liveSessionShowed} showed`} />
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
