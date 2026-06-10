import React from 'react';
import type { UserProfile } from '../../services/accessControl';
import type { HomeDashboardPayload } from '../../services/homeDashboardCache';
import { DayNotesPanel, formatLeaderboardRefreshed, QuickLinkCard, RecruiterStandingsBoard, StatTile } from './DashboardWidgets';
import OpsConsoleHomeLink from './OpsConsoleHomeLink';
import { EmptyHomePrompt } from './EmptyHomePrompt';

type Props = {
  profile: UserProfile;
  payload: HomeDashboardPayload | null;
  refreshing: boolean;
  onRefresh: () => void;
};

const LeadershipDashboardView: React.FC<Props> = ({ profile, payload }) => {
  if (!payload || payload.kind !== 'leadership') {
    return (
      <EmptyHomePrompt message="No saved team overview yet. Tap refresh in the top right to load this week's pulse." />
    );
  }

  const metrics = payload.metrics;

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
          <QuickLinkCard title="Search leads" description="Find any assigned lead by name, email, or phone." to="/pipeline/lead-manager/leads" accent="border-[#9bc8f6] bg-[#eef6ff] hover:bg-[#e7f4ff]" />
          <QuickLinkCard title="Lead packs" description="Review packs and dial." to="/pipeline/lead-manager" />
          <QuickLinkCard title="Call workspace" description="Jump into the dialer when needed." to="/pipeline/call" />
          <QuickLinkCard title="Admin candidates" description="Candidate records and journey stages." to="/dashboard?view=candidates" />
          <QuickLinkCard title="Live sessions" description="Session schedules and invitees." to="/live-sessions" />
          <QuickLinkCard title="Support" description="Submit an issue or track your ticket." to="/support" />
          <OpsConsoleHomeLink />
        </div>
        <DayNotesPanel userId={profile.user_id} />
      </div>
    </>
  );
};

export default LeadershipDashboardView;
