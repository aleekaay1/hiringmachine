import React from 'react';
import type { UserProfile } from '../../services/accessControl';
import { QuickLinkCard } from './DashboardWidgets';

const ViewerDashboardView: React.FC<{ profile: UserProfile }> = ({ profile: _profile }) => {
  return (
    <div className="max-w-lg">
      <div className="rounded-3xl border border-[#d9e5f6] bg-white/80 p-4 backdrop-blur-xl">
        <p className="text-sm text-[#4f6886]">
          Your account has view-only access. You can review the public leaderboard when it has been refreshed by the team.
        </p>
        <div className="mt-4">
          <QuickLinkCard title="Leaderboard" description="See current team rankings." to="/calls-analytics/leaderboard" />
        </div>
      </div>
    </div>
  );
};

export default ViewerDashboardView;
