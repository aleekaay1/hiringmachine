import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { COLORS } from '../constants';
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

  const current = `${location.pathname}${location.search}`;
  const isActive = (path: string) => current === path;

  const adminMenu = [
    { name: 'Overview', route: '/admin?view=overview', icon: Home },
    { name: 'Candidates', route: '/admin?view=candidates', icon: Users },
    { name: 'QR Codes', route: '/qr', icon: QrCode },
    { name: 'Live Sessions', route: '/live-sessions', icon: Video },
    { name: 'Analytics', route: '/admin?view=analytics', icon: BarChart3 },
    { name: 'Settings', route: '/admin?view=settings', icon: Settings },
  ] as const;

  return (
    <div className="min-h-screen flex font-sans text-gray-800" style={{ backgroundColor: isAdmin ? '#eef2f7' : COLORS.background }}>
      {isAdmin && (
        <aside className="hidden lg:flex w-72 shrink-0 flex-col border-r border-[#1c3760] bg-[#0b1f3a] text-white">
          <div className="px-5 py-6 border-b border-[#1c3760] flex flex-col items-center text-center gap-4">
            <div className="h-44 w-44 rounded-full bg-white border border-[#d6deea] shadow-[0_10px_30px_-18px_rgba(0,0,0,0.45)] flex items-center justify-center overflow-hidden">
              <img
                src="/logo.png"
                alt="Paz Hiring Journey"
                className="h-28 w-28 object-contain"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.style.display = 'none';
                }}
              />
            </div>
            <div className="text-sm font-semibold leading-tight text-slate-100">Paz Hiring Journey Management</div>
          </div>
          <nav className="p-3 space-y-1.5">
            {adminMenu.map((item) => {
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
              onClick={async () => {
                await supabase.auth.signOut();
                navigate('/admin');
              }}
              className="w-full mt-3 inline-flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm text-slate-300 hover:bg-[#123563]/60 hover:text-white"
            >
              <LogOut size={15} />
              Logout
            </button>
          </nav>
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