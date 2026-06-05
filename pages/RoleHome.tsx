import React from 'react';
import { getCurrentUserProfile, type UserProfile } from '../services/accessControl';
import DashboardShell from '../components/dashboard/DashboardShell';
import HomeLoadingScreen from '../components/dashboard/HomeLoadingScreen';
import RecruiterDashboardView from '../components/dashboard/RecruiterDashboardView';
import LeadershipDashboardView from '../components/dashboard/LeadershipDashboardView';
import AdminDashboardView from '../components/dashboard/AdminDashboardView';
import WebinarStaffDashboardView from '../components/dashboard/WebinarStaffDashboardView';
import HrStaffDashboardView from '../components/dashboard/HrStaffDashboardView';
import ViewerDashboardView from '../components/dashboard/ViewerDashboardView';

function DashboardByRole({ profile }: { profile: UserProfile }) {
  switch (profile.role) {
    case 'admin':
      return <AdminDashboardView profile={profile} />;
    case 'leadership':
      return <LeadershipDashboardView profile={profile} />;
    case 'recruiter':
      return <RecruiterDashboardView profile={profile} />;
    case 'webinar':
      return <WebinarStaffDashboardView profile={profile} />;
    case 'hr':
      return <HrStaffDashboardView profile={profile} />;
    default:
      return <ViewerDashboardView profile={profile} />;
  }
}

const RoleHome: React.FC = () => {
  const [profile, setProfile] = React.useState<UserProfile | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [progress, setProgress] = React.useState({ pct: 5, label: 'Loading your profile…' });

  React.useEffect(() => {
    if (!loading) return;
    const id = window.setInterval(() => {
      setProgress((prev) => ({ ...prev, pct: Math.min(prev.pct + 2, 90) }));
    }, 280);
    return () => window.clearInterval(id);
  }, [loading]);

  React.useEffect(() => {
    let cancelled = false;
    setProgress({ pct: 8, label: 'Loading your profile…' });
    void getCurrentUserProfile().then((p) => {
      if (!cancelled) {
        setProfile(p);
        setProgress({ pct: 100, label: 'Ready' });
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <DashboardShell profile={profile} loading={loading}>
      {loading ? (
        <HomeLoadingScreen
          progress={progress}
          title="Loading your overview"
          subtitle="Setting up your dashboard and permissions."
        />
      ) : (
        profile && <DashboardByRole profile={profile} />
      )}
    </DashboardShell>
  );
};

export default RoleHome;
