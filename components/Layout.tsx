import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { COLORS } from '../constants';
import IntegrationStatusLights from './IntegrationStatusLights';
import { supabase } from '../services/supabaseClient';
import { Home, Users, QrCode, Video, BarChart3, Settings, LogOut } from 'lucide-react';

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

  const isActive = (path: string) => location.pathname === path;

  const adminMenu = [
    { name: 'Overview', route: '/admin', icon: Home },
    { name: 'Candidates', route: '/admin', icon: Users },
    { name: 'QR Codes', route: '/qr', icon: QrCode },
    { name: 'Live Sessions', route: '/live-sessions', icon: Video },
    { name: 'Analytics', route: '/admin', icon: BarChart3 },
    { name: 'Settings', route: '/admin', icon: Settings },
  ] as const;

  return (
    <div className="min-h-screen flex font-sans text-gray-800" style={{ backgroundColor: isAdmin ? '#f3f4f6' : COLORS.background }}>
      {isAdmin && (
        <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-gray-200 bg-[#f7f9fc]">
          <div className="px-5 py-5 border-b border-gray-200">
            <div className="text-sm font-semibold text-gray-900">HR & Recruiter</div>
            <div className="text-xs text-gray-500">hire smarter</div>
          </div>
          <nav className="p-3 space-y-1">
            {adminMenu.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.route);
              return (
                <button
                  key={item.name}
                  type="button"
                  onClick={() => navigate(item.route)}
                  className={`w-full inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition ${
                    active ? 'bg-white text-[#0f172a] shadow-sm border border-gray-200' : 'text-gray-600 hover:bg-white/80'
                  }`}
                >
                  <Icon size={15} />
                  {item.name}
                </button>
              );
            })}
            <button
              type="button"
              onClick={async () => {
                await supabase.auth.signOut();
                navigate('/admin');
              }}
              className="w-full mt-2 inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-gray-600 hover:bg-white/80"
            >
              <LogOut size={15} />
              Logout
            </button>
          </nav>
        </aside>
      )}
      <div className="min-h-screen flex flex-col flex-1">
      {!hideHeader && (
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
            {isAdmin && (
              <nav className="flex items-center gap-2 sm:gap-3 text-sm shrink-0 flex-wrap justify-end">
                <button
                  type="button"
                  onClick={() => navigate('/admin')}
                  className={`min-h-[44px] min-w-[44px] inline-flex items-center justify-center px-3 py-2 rounded-full border text-xs font-medium transition-colors touch-manipulation ${
                    isActive('/admin')
                      ? 'bg-[#005EB8] text-white border-[#005EB8]'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-blue-50 active:bg-blue-50'
                  }`}
                >
                  Dashboard
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/live-sessions')}
                  className={`min-h-[44px] min-w-[44px] inline-flex items-center justify-center px-3 py-2 rounded-full border text-xs font-medium transition-colors touch-manipulation ${
                    isActive('/live-sessions')
                      ? 'bg-[#005EB8] text-white border-[#005EB8]'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-blue-50 active:bg-blue-50'
                  }`}
                >
                  Sessions
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/qr')}
                  className={`min-h-[44px] min-w-[44px] inline-flex items-center justify-center px-3 py-2 rounded-full border text-xs font-medium transition-colors touch-manipulation ${
                    isActive('/qr')
                      ? 'bg-[#005EB8] text-white border-[#005EB8]'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-blue-50 active:bg-blue-50'
                  }`}
                >
                  QR Codes
                </button>
                <IntegrationStatusLights />
              </nav>
            )}
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