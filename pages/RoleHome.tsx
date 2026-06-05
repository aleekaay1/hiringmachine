import React from 'react';
import { getCurrentUserProfile, type UserProfile } from '../services/accessControl';
import DashboardShell from '../components/dashboard/DashboardShell';
import RecruiterDashboardView from '../components/dashboard/RecruiterDashboardView';
import LeadershipDashboardView from '../components/dashboard/LeadershipDashboardView';
import AdminDashboardView from '../components/dashboard/AdminDashboardView';
import WebinarStaffDashboardView from '../components/dashboard/WebinarStaffDashboardView';
import HrStaffDashboardView from '../components/dashboard/HrStaffDashboardView';
import ViewerDashboardView from '../components/dashboard/ViewerDashboardView';
import {
  homeDashboardSupportsRefresh,
  loadHomeDashboardCache,
  refreshHomeDashboard,
  type HomeDashboardPayload,
} from '../services/homeDashboardCache';

type DashboardViewProps = {
  profile: UserProfile;
  payload: HomeDashboardPayload | null;
  refreshing: boolean;
  onRefresh: () => void;
};

function DashboardByRole({ profile, payload, refreshing, onRefresh }: DashboardViewProps) {
  switch (profile.role) {
    case 'admin':
      return <AdminDashboardView profile={profile} payload={payload} refreshing={refreshing} onRefresh={onRefresh} />;
    case 'leadership':
      return <LeadershipDashboardView profile={profile} payload={payload} refreshing={refreshing} onRefresh={onRefresh} />;
    case 'recruiter':
      return <RecruiterDashboardView profile={profile} payload={payload} refreshing={refreshing} onRefresh={onRefresh} />;
    case 'webinar':
      return <WebinarStaffDashboardView profile={profile} payload={payload} refreshing={refreshing} onRefresh={onRefresh} />;
    case 'hr':
      return <HrStaffDashboardView profile={profile} />;
    default:
      return <ViewerDashboardView profile={profile} />;
  }
}

const RoleHome: React.FC = () => {
  const [profile, setProfile] = React.useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = React.useState(true);
  const [payload, setPayload] = React.useState<HomeDashboardPayload | null>(null);
  const [refreshedAt, setRefreshedAt] = React.useState<string | null>(null);
  const [fromCache, setFromCache] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const [refreshError, setRefreshError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void getCurrentUserProfile().then((p) => {
      if (!cancelled) {
        setProfile(p);
        setProfileLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (!profile || !homeDashboardSupportsRefresh(profile.role)) return;
    let cancelled = false;
    void loadHomeDashboardCache(profile.user_id).then((record) => {
      if (cancelled || !record) return;
      setPayload(record.payload);
      setRefreshedAt(record.fetchedAt);
      setFromCache(record.fromCache);
    });
    return () => {
      cancelled = true;
    };
  }, [profile?.user_id, profile?.role]);

  const handleRefresh = React.useCallback(async () => {
    if (!profile || !homeDashboardSupportsRefresh(profile.role)) return;
    setRefreshing(true);
    setRefreshError(null);
    try {
      const record = await refreshHomeDashboard(profile);
      setPayload(record.payload);
      setRefreshedAt(record.fetchedAt);
      setFromCache(false);
    } catch (e) {
      setRefreshError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }, [profile]);

  return (
    <DashboardShell
      profile={profile}
      loading={profileLoading}
      refreshedAt={refreshedAt}
      fromCache={fromCache}
      showRefresh={profile ? homeDashboardSupportsRefresh(profile.role) : false}
      refreshing={refreshing}
      onRefresh={handleRefresh}
    >
      {refreshError && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">{refreshError}</div>
      )}
      {profile && (
        <DashboardByRole
          profile={profile}
          payload={payload}
          refreshing={refreshing}
          onRefresh={handleRefresh}
        />
      )}
    </DashboardShell>
  );
};

export default RoleHome;
