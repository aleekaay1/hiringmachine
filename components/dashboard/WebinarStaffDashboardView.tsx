import React from 'react';
import type { UserProfile } from '../../services/accessControl';
import type { HomeDashboardPayload } from '../../services/homeDashboardCache';
import { DayNotesPanel, QuickLinkCard, StatTile } from './DashboardWidgets';
import { EmptyHomePrompt } from './EmptyHomePrompt';

type Props = {
  profile: UserProfile;
  payload: HomeDashboardPayload | null;
  refreshing: boolean;
  onRefresh: () => void;
};

const WebinarStaffDashboardView: React.FC<Props> = ({ profile, payload }) => {
  if (!payload || payload.kind !== 'webinar') {
    return (
      <EmptyHomePrompt message="No saved webinar stats yet. Tap refresh in the top right to load your week." />
    );
  }

  const { booked, attended, windowLabel } = payload;

  return (
    <>
      <div className="rounded-3xl border border-[#d9e5f6] bg-white/80 p-4 backdrop-blur-xl">
        <p className="text-[10px] uppercase tracking-[0.2em] text-[#2f6ea8]">Your webinar week</p>
        <p className="mt-1 text-xs text-[#5c7594]">{windowLabel}</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <StatTile label="Booked" value={booked} />
          <StatTile label="Attended" value={attended} sub={booked > 0 ? `${Math.round((100 * attended) / booked)}% show rate` : undefined} />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="grid gap-3 sm:grid-cols-2">
          <QuickLinkCard title="Webinar dashboard" description="Full subscription and attendance views." to="/webinar-geek" accent="border-[#9bc8f6] bg-[#eef6ff] hover:bg-[#e7f4ff]" />
          <QuickLinkCard title="Calls analytics" description="Recruiter booking analytics." to="/calls-analytics" />
          <QuickLinkCard title="Leaderboard" description="Team recognition board." to="/calls-analytics/leaderboard" />
        </div>
        <DayNotesPanel userId={profile.user_id} />
      </div>
    </>
  );
};

export default WebinarStaffDashboardView;
