import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { COLORS } from '../constants';
import { supabase } from '../services/supabaseClient';
import {
  canAccessSection,
  defaultRouteForRole,
  getCurrentUserProfile,
  type AppRole,
  type AppSection,
} from '../services/accessControl';
import { Home, Users, QrCode, Video, BarChart3, Settings, LogOut, MonitorPlay, Mail, PhoneCall, SlidersHorizontal, FileUp, Trophy } from 'lucide-react';

interface LayoutProps {
  children: React.ReactNode;
  hideHeader?: boolean;
  isAdmin?: boolean;
  /** When set (non-admin only), shows this image in the header instead of the logo — e.g. landing cover banner. */
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
  const [role, setRole] = React.useState<AppRole | null>(null);
  const [roleResolved, setRoleResolved] = React.useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);

  const current = `${location.pathname}${location.search}`;
  const isActive = (path: string) => current === path;

  const adminMenu = [
    { name: 'Overview', route: '/dashboard?view=overview', icon: Home, section: 'overview' as const },
    { name: 'Candidates', route: '/dashboard?view=candidates', icon: Users, section: 'candidates' as const },
    { name: 'QR Codes', route: '/qr', icon: QrCode, section: 'qr' as const },
    { name: 'Live Sessions', route: '/live-sessions', icon: Video, section: 'live-sessions' as const },
    { name: 'Webinar Geek', route: '/webinar-geek', icon: MonitorPlay, section: 'webinar-geek' as const },
    { name: 'Calls Analytics', route: '/calls-analytics', icon: BarChart3, section: 'calls-analytics' as const },
    { name: 'Leadership Board', route: '/calls-analytics/leaderboard', icon: Trophy, section: 'leaderboard' as const },
    { name: 'Call workspace', route: '/pipeline/call', icon: PhoneCall, section: 'pipeline-call' as const },
    { name: 'Recruiter performance', route: '/pipeline/performance', icon: BarChart3, section: 'pipeline-performance' as const },
    { name: 'Email workspace', route: '/pipeline/email', icon: Mail, section: 'pipeline-email' as const },
    { name: 'Resume uploads', route: '/pipeline/uploads', icon: FileUp, section: 'pipeline-uploads' as const },
    { name: 'Legacy pipeline', route: '/pipeline', icon: PhoneCall, section: 'pipeline' as const },
    { name: 'Pipeline settings', route: '/pipeline-settings', icon: SlidersHorizontal, section: 'pipeline-settings' as const },
    { name: 'Analytics', route: '/dashboard?view=analytics', icon: BarChart3, section: 'analytics' as const },
    { name: 'Settings', route: '/dashboard?view=settings', icon: Settings, section: 'settings' as const },
    { name: 'Email log', route: '/email-log', icon: Mail, section: 'email-log' as const },
  ] as const;

  const currentSection = React.useMemo<AppSection>(() => {
    if (location.pathname === '/pipeline') return 'pipeline';
    if (location.pathname === '/pipeline/call') return 'pipeline-call';
    if (location.pathname === '/pipeline/performance') return 'pipeline-performance';
    if (location.pathname === '/pipeline/email') return 'pipeline-email';
    if (location.pathname === '/pipeline/uploads') return 'pipeline-uploads';
    if (location.pathname === '/pipeline-settings') return 'pipeline-settings';
    if (location.pathname === '/calls-analytics') return 'calls-analytics';
    if (location.pathname === '/calls-analytics/leaderboard' || location.pathname === '/leaderboard') return 'leaderboard';
    if (location.pathname === '/webinar-geek') return 'webinar-geek';
    if (location.pathname === '/live-sessions') return 'live-sessions';
    if (location.pathname === '/hr-dashboard') return 'hr-dashboard';
    if (location.pathname === '/qr') return 'qr';
    if (location.pathname === '/email-log') return 'email-log';
    if (location.pathname === '/superdashboard') return 'superdashboard';
    if (location.pathname === '/dashboard' || location.pathname === '/admin') {
      const view = new URLSearchParams(location.search).get('view');
      if (view === 'candidates') return 'candidates';
      if (view === 'analytics') return 'analytics';
      if (view === 'settings') return 'settings';
      return 'overview';
    }
    return 'overview';
  }, [location.pathname, location.search]);

  React.useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    void getCurrentUserProfile().then((profile) => {
      if (!cancelled) {
        setRole(profile?.role ?? null);
        setRoleResolved(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  React.useEffect(() => {
    if (!isAdmin || !roleResolved) return;
    if (canAccessSection(role, currentSection)) return;
    const fallback = defaultRouteForRole(role);
    if (fallback !== `${location.pathname}${location.search}`) {
      navigate(fallback, { replace: true });
    }
  }, [isAdmin, roleResolved, role, currentSection, location.pathname, location.search, navigate]);

  const visibleAdminMenu = adminMenu.filter((item) => canAccessSection(role, item.section));

  const handleLogout = React.useCallback(async () => {
    try {
      await supabase.auth.signOut({ scope: 'global' });
    } finally {
      // Clear local page caches so a refresh does not appear to restore auth UX state.
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
          // no-op: storage may be unavailable in strict contexts
        }
      }
      navigate('/', { replace: true });
      if (typeof window !== 'undefined') window.location.reload();
    }
  }, [navigate]);

  return (
    <div className="min-h-screen flex font-sans text-gray-800" style={{ backgroundColor: isAdmin ? '#eef2f7' : COLORS.background }}>
      {isAdmin && (
        <aside
          className={`hidden lg:flex shrink-0 flex-col border-r border-[#1c3760] bg-[#0b1f3a] text-white relative transition-all duration-300 ease-in-out ${
            sidebarCollapsed ? 'w-5' : 'w-72'
          }`}
        >
          <button
            type="button"
            onClick={() => setSidebarCollapsed((prev) => !prev)}
            className="absolute -right-3 top-16 z-20 h-10 w-6 rounded-r-xl border border-[#2a528a] border-l-0 bg-[#123563] text-slate-200 hover:text-white hover:bg-[#1b4b88] text-xs font-bold shadow"
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? '>' : '<'}
          </button>

          {!sidebarCollapsed && (
            <>
              <div className="px-5 py-6 border-b border-[#1c3760] flex flex-col items-center text-center gap-4">
                <div className="h-60 w-60 rounded-full bg-white border border-[#d6deea] shadow-[0_10px_30px_-18px_rgba(0,0,0,0.45)] flex items-center justify-center overflow-hidden">
                  <img
                    src="/logo.png"
                    alt="Paz Hiring Journey"
                    className="h-56 w-56 object-contain"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      target.style.display = 'none';
                    }}
                  />
                </div>
                <div className="text-sm font-semibold leading-tight text-slate-100">Paz Hiring Journey Management</div>
              </div>
              <nav className="p-3 space-y-1.5">
                {visibleAdminMenu.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(item.route);
                  return (
                    <button
                      key={item.name}
                      type="button"
                      onClick={() => navigate(item.route)}
                      className={`w-full inline-flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm transition font-medium ${
                        active
                          ? 'bg-[#123563] text-white shadow-sm border border-[#2a528a]'
                          : 'text-slate-300 hover:bg-[#123563]/60 hover:text-white'
                      }`}
                    >
                      <Icon size={15} />
                      {item.name}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => void handleLogout()}
                  className="w-full mt-3 inline-flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm text-slate-300 hover:bg-[#123563]/60 hover:text-white"
                >
                  <LogOut size={15} />
                  Logout
                </button>
              </nav>
            </>
          )}
        </aside>
      )}
      <div className="min-h-screen flex flex-col flex-1">
      {!hideHeader && !isAdmin && (
        <header className="bg-white shadow-sm sticky top-0 z-50 safe-area-top">
          <div
            className={`mx-auto w-full flex items-center gap-2 ${
              isAdmin
                ? 'max-w-7xl px-4 py-2 sm:py-3 justify-between min-h-[52px] sm:min-h-0'
                : headerBannerSrc
                  ? 'max-w-full justify-center px-0 py-0'
                  : 'max-w-full justify-center px-4 py-3 sm:py-4 md:py-5'
            }`}
          >
            <div
              className={`flex items-center min-w-0 ${
                isAdmin ? 'flex-1' : headerBannerSrc ? 'justify-center w-full' : 'justify-center w-full'
              }`}
            >
              {!isAdmin && headerBannerSrc ? (
                <img
                  src={headerBannerSrc}
                  alt="Globe Life AIL Division - Paz Organization"
                  className="w-full h-auto max-h-[min(24vh,200px)] sm:max-h-[min(22vh,220px)] lg:max-h-[240px] object-contain object-center bg-[#f8fafc]"
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    target.style.display = 'none';
                  }}
                />
              ) : (
                <img
                  src="/logo.png"
                  alt="Globe Life AIL Division - Paz Organization"
                  className={
                    isAdmin
                      ? 'h-9 sm:h-10 w-auto max-w-full object-contain object-left'
                      : 'h-[min(11.25rem,32vh)] sm:h-[min(12.5rem,28vh)] md:h-[12.5rem] lg:h-[13.75rem] w-auto max-w-[min(100%,42rem)] object-contain object-center'
                  }
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    target.style.display = 'none';
                  }}
                />
              )}
            </div>
          </div>
          <div className="h-1 w-full bg-gradient-to-r from-[#005EB8] to-[#37B06D]" />
        </header>
      )}
      <main className="flex-grow flex flex-col relative overflow-x-hidden px-safe-area">
        {children}
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