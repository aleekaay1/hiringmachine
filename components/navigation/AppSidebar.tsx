import React from 'react';
import { useLocation } from 'react-router-dom';
import { ChevronDown, LogOut, Menu, X } from 'lucide-react';
import type { AppRole } from '../../services/accessControl';
import { canAccessSection } from '../../services/accessControl';
import { getStaffSessionSnapshot } from '../../services/staffSessionCache';
import {
  isGroupActive,
  isItemActive,
  NAV_GROUPS,
  type NavGroup,
} from './navigationConfig';
import NavMenuLink from './NavMenuLink';

type AppSidebarProps = {
  role: AppRole | null;
  userEmail: string | null;
  displayName: string;
  roleLabel: string;
  avatarUrl: string | null;
  onLogout: () => void;
};

const SIDEBAR_LOGO_SRC = '/logo.png';

function SidebarBrand() {
  return (
    <div className="min-w-0 flex-1 overflow-hidden pr-2">
      <img
        src={SIDEBAR_LOGO_SRC}
        alt="AO Paz Globelife"
        className="block h-12 w-auto max-w-full object-contain object-left"
      />
    </div>
  );
}

const AppSidebar: React.FC<AppSidebarProps> = ({
  role,
  userEmail,
  displayName,
  roleLabel,
  avatarUrl,
  onLogout,
}) => {
  const location = useLocation();
  const pathname = location.pathname;
  const search = location.search;

  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [isMobile, setIsMobile] = React.useState(false);
  const [openGroups, setOpenGroups] = React.useState<Set<string>>(() => new Set());
  const [hoverGroup, setHoverGroup] = React.useState<string | null>(null);

  React.useEffect(() => {
    const media = window.matchMedia('(max-width: 1023px)');
    const sync = () => setIsMobile(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  const isRailView = collapsed || (isMobile && !mobileOpen);

  const sessionSnapshot = getStaffSessionSnapshot();
  const menuRole = role ?? sessionSnapshot.role;
  const menuEmail = userEmail ?? sessionSnapshot.userEmail;

  const menuName = displayName || sessionSnapshot.displayName;

  const visibleGroups = React.useMemo(() => {
    return NAV_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        canAccessSection(menuRole, item.section, menuEmail, menuName),
      ),
    })).filter((group) => group.items.length > 0);
  }, [menuRole, menuEmail, menuName]);

  React.useEffect(() => {
    const active = visibleGroups.find((group) => isGroupActive(group, pathname, search));
    if (active && active.items.length > 1) {
      setOpenGroups(new Set([active.id]));
    }
  }, [pathname, search, visibleGroups]);

  React.useEffect(() => {
    setMobileOpen(false);
  }, [pathname, search]);

  React.useEffect(() => {
    if (pathname === '/call-log') {
      setCollapsed(true);
    }
  }, [pathname]);

  const toggleGroup = (groupId: string) => {
    setOpenGroups((prev) => (prev.has(groupId) ? new Set<string>() : new Set([groupId])));
  };

  const openFullSidebar = React.useCallback(() => {
    setCollapsed(false);
    if (isMobile) setMobileOpen(true);
  }, [isMobile]);

  const closeMobileMenu = React.useCallback(() => {
    setMobileOpen(false);
  }, []);

  const handleMenuToggle = () => {
    if (isMobile) {
      if (mobileOpen) setMobileOpen(false);
      else openFullSidebar();
      return;
    }
    setCollapsed((prev) => !prev);
  };

  const handleCollapsedNavClick = (group: NavGroup, singleItem: boolean) => {
    openFullSidebar();
    if (!singleItem) toggleGroup(group.id);
  };

  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'U';

  const renderGroupItems = (group: NavGroup, flyout = false) => (
    <ul
      className={
        flyout
          ? 'space-y-0.5'
          : 'mb-1.5 ml-3 space-y-0.5 border-l border-white/15 py-1 pl-2.5'
      }
    >
      {group.items.map((item) => {
        const Icon = item.icon;
        const active = isItemActive(pathname, search, item.route);
        return (
          <li key={item.route}>
            <NavMenuLink
              to={item.route}
              active={active}
              onNavigate={closeMobileMenu}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition ${
                active
                  ? 'bg-white font-medium text-[#11101d] shadow-sm'
                  : 'font-normal text-slate-300 hover:bg-white/10 hover:text-white'
              }`}
            >
              <Icon size={16} className="shrink-0" />
              {(!isRailView || flyout) && <span className="truncate">{item.name}</span>}
            </NavMenuLink>
          </li>
        );
      })}
    </ul>
  );

  const sidebarInner = (
    <>
      <div
        className={`flex shrink-0 items-center border-b border-white/10 ${
          isRailView ? 'justify-center px-2 py-3' : 'justify-between gap-3 px-3 py-3.5 lg:px-4 lg:py-4'
        }`}
      >
        {!isRailView && <SidebarBrand />}
        <button
          type="button"
          onClick={handleMenuToggle}
          className={`relative z-10 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-300 hover:bg-white/10 hover:text-white ${
            isRailView ? 'inline-flex' : 'hidden lg:inline-flex'
          }`}
          aria-label={isRailView ? 'Expand menu' : 'Collapse menu'}
        >
          <Menu size={20} />
        </button>
      </div>

      <nav className={`shrink-0 py-2 ${isRailView ? 'space-y-0' : 'space-y-0.5'}`} data-tour="sidebar-nav">
        {visibleGroups.map((group) => {
          const GroupIcon = group.icon;
          const groupOpen = openGroups.has(group.id);
          const groupActive = isGroupActive(group, pathname, search);
          const singleItem = group.items.length === 1;

          if (isRailView) {
            if (singleItem) {
              const item = group.items[0];
              const active = isItemActive(pathname, search, item.route);
              return (
                <div key={group.id} data-tour={group.tourId} className="px-1.5 py-0.5">
                  <NavMenuLink
                    to={item.route}
                    active={active}
                    onNavigate={closeMobileMenu}
                    className={`flex w-full items-center justify-center rounded-xl p-2 transition ${
                      active ? 'bg-white text-[#11101d]' : 'text-slate-300 hover:bg-white/10 hover:text-white'
                    }`}
                    title={item.name}
                    aria-label={item.name}
                  >
                    <GroupIcon size={20} />
                  </NavMenuLink>
                </div>
              );
            }

            return (
              <div
                key={group.id}
                data-tour={group.tourId}
                className="relative px-1.5 py-0.5"
                onMouseEnter={() => setHoverGroup(group.id)}
                onMouseLeave={() => setHoverGroup(null)}
              >
                <button
                  type="button"
                  onClick={() => handleCollapsedNavClick(group, false)}
                  className={`flex w-full items-center justify-center rounded-xl p-2 transition ${
                    groupActive ? 'bg-white text-[#11101d]' : 'text-slate-300 hover:bg-white/10 hover:text-white'
                  }`}
                  title={group.label}
                  aria-label={group.label}
                >
                  <GroupIcon size={20} />
                </button>
                {hoverGroup === group.id && !isMobile && (
                  <div className="absolute left-full top-0 z-50 ml-2 min-w-[200px] rounded-xl border border-white/10 bg-[#1d1b31] py-2 shadow-2xl">
                    <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-white">{group.label}</p>
                    {renderGroupItems(group, true)}
                  </div>
                )}
              </div>
            );
          }

          if (singleItem) {
            const item = group.items[0];
            const Icon = item.icon;
            const active = isItemActive(pathname, search, item.route);
            return (
              <div key={group.id} data-tour={group.tourId} className="px-2 py-0.5">
                <NavMenuLink
                  to={item.route}
                  active={active}
                  onNavigate={closeMobileMenu}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${
                    active ? 'bg-white text-[#11101d]' : 'text-slate-300 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <Icon size={18} />
                  <span>{item.name}</span>
                </NavMenuLink>
              </div>
            );
          }

          return (
            <div
              key={group.id}
              data-tour={group.tourId}
              className={`px-2 py-1 ${groupOpen ? 'rounded-xl bg-white/[0.03]' : ''}`}
            >
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 transition ${
                  groupOpen
                    ? 'text-white'
                    : groupActive
                      ? 'text-white/95'
                      : 'text-slate-400 hover:text-white/90'
                }`}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <GroupIcon size={15} className="shrink-0 text-slate-500" strokeWidth={2} />
                  <span className="truncate text-[11px] font-bold uppercase tracking-[0.2em] text-white">
                    {group.label}
                  </span>
                </span>
                <ChevronDown
                  size={14}
                  className={`shrink-0 text-slate-500 transition ${groupOpen ? 'rotate-180 text-slate-300' : ''}`}
                />
              </button>
              {groupOpen && renderGroupItems(group)}
            </div>
          );
        })}
      </nav>

      <div className={`mt-auto shrink-0 border-t border-white/10 ${isRailView ? 'p-2' : 'p-3'}`}>
        <NavMenuLink
          to="/account"
          active={pathname === '/account'}
          onNavigate={closeMobileMenu}
          className={`flex w-full items-center gap-3 rounded-xl p-2 transition hover:bg-white/10 ${
            isRailView ? 'justify-center' : ''
          }`}
        >
          <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-[#2a2847] ring-2 ring-white/10">
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-white">{initials}</div>
            )}
          </div>
          {!isRailView && (
            <div className="min-w-0 flex-1 text-left">
              <p className="truncate text-sm font-semibold text-white">{displayName}</p>
              <p className="truncate text-[11px] text-slate-400">{roleLabel}</p>
            </div>
          )}
        </NavMenuLink>
        {!isRailView && (
          <button
            type="button"
            onClick={onLogout}
            className="mt-2 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-slate-300 hover:bg-white/10 hover:text-white"
          >
            <LogOut size={16} />
            Logout
          </button>
        )}
        {isRailView && (
          <button
            type="button"
            onClick={onLogout}
            className="mt-2 flex w-full items-center justify-center rounded-xl p-2 text-slate-300 hover:bg-white/10 hover:text-white"
            title="Logout"
          >
            <LogOut size={18} />
          </button>
        )}
      </div>
    </>
  );

  return (
    <>
      {isMobile && mobileOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          aria-label="Close menu"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        data-tour="app-sidebar"
        className={`fixed inset-y-0 left-0 z-50 flex flex-col bg-[#1c1915] text-white shadow-2xl transition-[width] duration-300 translate-x-0 lg:sticky lg:top-0 lg:z-auto lg:h-auto lg:min-h-screen lg:self-start lg:overflow-visible ${
          isMobile ? (mobileOpen ? 'w-[17.5rem]' : 'w-[4.75rem]') : collapsed ? 'w-[4.75rem]' : 'w-[17.5rem]'
        }`}
      >
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-300 hover:bg-white/10 lg:hidden"
          aria-label="Close menu"
        >
          <X size={20} />
        </button>
        {sidebarInner}
      </aside>
    </>
  );
};

export default AppSidebar;
