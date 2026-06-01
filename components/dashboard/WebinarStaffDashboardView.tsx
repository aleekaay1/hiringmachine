import React from 'react';
import type { UserProfile } from '../../services/accessControl';
import { loadScopedWebinarRowsForViewer } from '../../services/pipelineBookedOutcomes';
import { buildLeaderboardWindows } from '../../services/pipelineLeaderboard';
import { fmtHrScheduledDateKey } from '../../services/webinarGeekRecruiterAnalytics';
import { DayNotesPanel, QuickLinkCard, StatTile } from './DashboardWidgets';

const WebinarStaffDashboardView: React.FC<{ profile: UserProfile }> = ({ profile }) => {
  const [booked, setBooked] = React.useState(0);
  const [attended, setAttended] = React.useState(0);
  const [windowLabel, setWindowLabel] = React.useState('');

  React.useEffect(() => {
    const windows = buildLeaderboardWindows('last7');
    setWindowLabel(windows.current.label);
    let cancelled = false;
    void loadScopedWebinarRowsForViewer({
      role: 'webinar',
      viewerEmail: profile.email ?? null,
      viewerFullName: profile.full_name,
    }).then((rows) => {
      if (cancelled) return;
      const since = windows.current.sinceYmd;
      const until = windows.current.untilYmd;
      let b = 0;
      let a = 0;
      for (const row of rows) {
        const key = fmtHrScheduledDateKey(row);
        if (key === 'unknown' || key < since || key > until) continue;
        b += 1;
        if (row.watched === true) a += 1;
      }
      setBooked(b);
      setAttended(a);
    });
    return () => {
      cancelled = true;
    };
  }, [profile]);

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
