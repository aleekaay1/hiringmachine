import React from 'react';
import type { UserProfile } from '../../services/accessControl';
import { DayNotesPanel, QuickLinkCard } from './DashboardWidgets';

const HrStaffDashboardView: React.FC<{ profile: UserProfile }> = ({ profile }) => {
  return (
    <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
      <div className="grid gap-3 sm:grid-cols-2">
        <QuickLinkCard title="HR dashboard" description="Risk signals, stages, and follow-ups." to="/hr-dashboard" accent="border-[#b8e6cf] bg-[#f0faf4] hover:bg-[#e8f7ee]" />
        <QuickLinkCard title="Candidates" description="Search and review applicant records." to="/dashboard?view=candidates" />
        <QuickLinkCard title="Live sessions" description="Upcoming and past career sessions." to="/live-sessions" />
        <QuickLinkCard title="Email log" description="Communication history." to="/email-log" />
        <QuickLinkCard title="Leaderboard" description="Team performance overview." to="/calls-analytics/leaderboard" />
      </div>
      <DayNotesPanel userId={profile.user_id} />
    </div>
  );
};

export default HrStaffDashboardView;
