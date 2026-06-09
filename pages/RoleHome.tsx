import React from 'react';
import { getCurrentUserProfile, type AppRole, type UserProfile } from '../services/accessControl';
import DashboardShell from '../components/dashboard/DashboardShell';
import HomeLoadingScreen from '../components/dashboard/HomeLoadingScreen';
import PageGuidePanel from '../components/tour/PageGuidePanel';
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

function refreshLoadingCopy(role: AppRole | null | undefined): { title: string; subtitle: string; label: string } {
  switch (role) {
    case 'admin':
      return {
        title: 'Refreshing organization overview',
        subtitle: 'Team metrics, charts, and admin quick links.',
        label: 'Loading team metrics…',
      };
    case 'leadership':
      return {
        title: 'Refreshing team overview',
        subtitle: 'Leadership metrics and standings for this week.',
        label: 'Loading team pulse…',
      };
    case 'webinar':
      return {
        title: 'Refreshing webinar stats',
        subtitle: 'Your booked and attended counts for this week.',
        label: 'Loading webinar activity…',
      };
    default:
      return {
        title: 'Refreshing your stats',
        subtitle: 'Rank, calls, bookings, and coin balance for your week.',
        label: 'Loading personal metrics…',
      };
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
  const [progress, setProgress] = React.useState({ pct: 6, label: 'Loading…' });

  React.useEffect(() => {
    if (!refreshing) return;
    const copy = refreshLoadingCopy(profile?.role);
    setProgress({ pct: 8, label: copy.label });
    const tick = window.setInterval(() => {
      setProgress((prev) => ({ ...prev, pct: Math.min(prev.pct + 3, 92) }));
    }, 320);
    return () => window.clearInterval(tick);
  }, [refreshing, profile?.role]);

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
    const copy = refreshLoadingCopy(profile.role);
    setProgress({ pct: 10, label: copy.label });
    try {
      setProgress({ pct: 55, label: 'Pulling latest numbers…' });
      const record = await refreshHomeDashboard(profile);
      setProgress({ pct: 88, label: 'Saving snapshot…' });
      setPayload(record.payload);
      setRefreshedAt(record.fetchedAt);
      setFromCache(false);
      setProgress({ pct: 100, label: 'Ready' });
    } catch (e) {
      setRefreshError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }, [profile]);

  const loadingCopy = refreshLoadingCopy(profile?.role);

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
      <PageGuidePanel guideId="home" />
      {refreshError && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">{refreshError}</div>
      )}
      {refreshing ? (
        <HomeLoadingScreen
          progress={progress}
          title={loadingCopy.title}
          subtitle={loadingCopy.subtitle}
        />
      ) : profile ? (
        <DashboardByRole
          profile={profile}
          payload={payload}
          refreshing={refreshing}
          onRefresh={handleRefresh}
        />
      ) : null}
    </DashboardShell>
  );
};

export default RoleHome;
