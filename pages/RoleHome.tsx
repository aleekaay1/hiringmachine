import React from 'react';
import DashboardShell from '../components/dashboard/DashboardShell';
import RecruiterDashboardView from '../components/dashboard/RecruiterDashboardView';
import LeadershipDashboardView from '../components/dashboard/LeadershipDashboardView';
import AdminDashboardView from '../components/dashboard/AdminDashboardView';
import WebinarStaffDashboardView from '../components/dashboard/WebinarStaffDashboardView';
import HrStaffDashboardView from '../components/dashboard/HrStaffDashboardView';
import ViewerDashboardView from '../components/dashboard/ViewerDashboardView';
import { getCurrentUserProfile, type UserProfile } from '../services/accessControl';

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

  React.useEffect(() => {
    let cancelled = false;
    void getCurrentUserProfile().then((p) => {
      if (!cancelled) {
        setProfile(p);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <DashboardShell profile={profile} loading={loading}>
      {profile && <DashboardByRole profile={profile} />}
    </DashboardShell>
  );
};

export default RoleHome;
