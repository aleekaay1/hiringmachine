import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { COLORS } from '../constants';
import { supabase } from '../services/supabaseClient';
import {
  canAccessSection,
  defaultRouteForRole,
  getStaffRoleLabel,
  resolveAppSectionFromLocation,
  type AppRole,
  type AppSection,
} from '../services/accessControl';
import AppSidebar from './navigation/AppSidebar';
import PortalTour from './tour/PortalTour';
import TaskWalkthrough from './tour/TaskWalkthrough';
import PageHintBulb from './tour/PageHintBulb';
import {
  clearStaffSessionCache,
  getStaffSessionSnapshot,
  resolveStaffSession,
  subscribeStaffAuth,
} from '../services/staffSessionCache';

interface LayoutProps {
  children: React.ReactNode;
  hideHeader?: boolean;
  isAdmin?: boolean;
  headerBannerSrc?: string;
}

const Layout: React.FC<LayoutProps> = ({
  children,
  hideHeader = false,
  isAdmin = false,
  headerBannerSrc,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const cachedSession = React.useMemo(() => getStaffSessionSnapshot(), []);
  const [role, setRole] = React.useState<AppRole | null>(cachedSession.role);
  const [userEmail, setUserEmail] = React.useState<string | null>(cachedSession.userEmail);
  const [displayName, setDisplayName] = React.useState(cachedSession.displayName);
  const [avatarUrl, setAvatarUrl] = React.useState<string | null>(cachedSession.avatarUrl);
  const [roleResolved, setRoleResolved] = React.useState(cachedSession.resolved);
  const [userId, setUserId] = React.useState<string | null>(cachedSession.userId);

  const currentSection = React.useMemo<AppSection>(
    () => resolveAppSectionFromLocation(location.pathname, location.search),
    [location.pathname, location.search],
  );

  const applySessionSnapshot = React.useCallback((snapshot: ReturnType<typeof getStaffSessionSnapshot>) => {
    setUserId(snapshot.userId);
    setRole(snapshot.role);
    setUserEmail(snapshot.userEmail);
    setDisplayName(snapshot.displayName);
    setAvatarUrl(snapshot.avatarUrl);
    setRoleResolved(snapshot.resolved);
  }, []);

  React.useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    void resolveStaffSession().then((snapshot) => {
      if (!cancelled) applySessionSnapshot(snapshot);
    });
    const unsubscribe = subscribeStaffAuth(() => {
      if (!cancelled) applySessionSnapshot(getStaffSessionSnapshot());
    });
    const onProfileUpdated = () => {
      void resolveStaffSession(true).then((snapshot) => {
        if (!cancelled) applySessionSnapshot(snapshot);
      });
    };
    window.addEventListener('pohiring:profile-updated', onProfileUpdated);
    return () => {
      cancelled = true;
      unsubscribe();
      window.removeEventListener('pohiring:profile-updated', onProfileUpdated);
    };
  }, [isAdmin, applySessionSnapshot]);

  React.useEffect(() => {
    if (!isAdmin || !roleResolved) return;
    const currentPath = `${location.pathname}${location.search}`;
    if (canAccessSection(role, currentSection, userEmail, displayName)) return;
    const fallback = defaultRouteForRole(role);
    if (fallback !== currentPath) {
      navigate(fallback, { replace: true });
    }
  }, [isAdmin, roleResolved, role, userEmail, displayName, currentSection, location.pathname, location.search, navigate]);

  const handleLogout = React.useCallback(async () => {
    try {
      await supabase.auth.signOut({ scope: 'global' });
    } finally {
      clearStaffSessionCache();
      if (typeof window !== 'undefined') {
        try {
          const keysToRemove: string[] = [];
          for (let i = 0; i < window.localStorage.length; i += 1) {
            const k = window.localStorage.key(i) || '';
            if (
              k.startsWith('pohiring_') ||
              k.startsWith('pipeline_') ||
              k.includes('supabase.auth.token')
            ) {
              keysToRemove.push(k);
            }
          }
          keysToRemove.forEach((k) => window.localStorage.removeItem(k));
          window.sessionStorage.clear();
        } catch {
          // no-op
        }
      }
      navigate('/', { replace: true });
      if (typeof window !== 'undefined') window.location.reload();
    }
  }, [navigate]);

  const roleLabel = getStaffRoleLabel(role, userEmail, displayName);

  return (
    <div
      className="min-h-screen flex items-start font-sans text-gray-800"
      style={{ backgroundColor: isAdmin ? '#eef2f7' : COLORS.background }}
    >
      {isAdmin && <PortalTour userId={userId} enabled={roleResolved} />}
      {isAdmin && <TaskWalkthrough />}
      {isAdmin && (
        <AppSidebar
          role={role}
          userEmail={userEmail}
          displayName={displayName}
          roleLabel={roleLabel}
          avatarUrl={avatarUrl}
          roleResolved={roleResolved}
          onLogout={() => void handleLogout()}
        />
      )}
      <div className="min-h-screen flex flex-col flex-1 min-w-0">
        {!hideHeader && !isAdmin && (
          <header className="bg-white shadow-sm sticky top-0 z-50 safe-area-top">
            <div
              className={`mx-auto w-full flex items-center gap-2 ${
                headerBannerSrc
                  ? 'max-w-full justify-center px-0 py-0'
                  : 'max-w-full justify-center px-4 py-3 sm:py-4 md:py-5'
              }`}
            >
              {!headerBannerSrc ? (
                <img
                  src="/logo.png"
                  alt="Globe Life AIL Division - Paz Organization"
                  className="h-[min(11.25rem,32vh)] sm:h-[min(12.5rem,28vh)] md:h-[12.5rem] lg:h-[13.75rem] w-auto max-w-[min(100%,42rem)] object-contain object-center"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              ) : (
                <img
                  src={headerBannerSrc}
                  alt="Globe Life AIL Division - Paz Organization"
                  className="w-full h-auto max-h-[min(24vh,200px)] sm:max-h-[min(22vh,220px)] lg:max-h-[240px] object-contain object-center bg-[#f8fafc]"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              )}
            </div>
            <div className="h-1 w-full bg-gradient-to-r from-[#005EB8] to-[#37B06D]" />
          </header>
        )}
        <main className={`flex-grow flex flex-col min-h-0 relative overflow-x-hidden px-safe-area ${isAdmin ? 'max-lg:pl-[4.75rem]' : ''}`}>
          {children}
          {isAdmin && <PageHintBulb section={currentSection} />}
        </main>
        {!isAdmin && (
          <footer className="py-4 sm:py-6 text-center text-xs text-gray-400 safe-area-bottom px-4">
            <p>&copy; {new Date().getFullYear()} Paz Organization | Globe Life AIL Division</p>
          </footer>
        )}
      </div>
    </div>
  );
};

export default Layout;
