import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown, LogOut, Menu, X } from 'lucide-react';
import type { AppRole } from '../../services/accessControl';
import { canAccessSection } from '../../services/accessControl';
import {
  isGroupActive,
  isItemActive,
  NAV_GROUPS,
  type NavGroup,
} from './navigationConfig';

type AppSidebarProps = {
  role: AppRole | null;
  userEmail: string | null;
  displayName: string;
  roleLabel: string;
  avatarUrl: string | null;
  roleResolved: boolean;
  onLogout: () => void;
};

const AppSidebar: React.FC<AppSidebarProps> = ({
  role,
  userEmail,
  displayName,
  roleLabel,
  avatarUrl,
  roleResolved,
  onLogout,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const pathname = location.pathname;
  const search = location.search;

  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [openGroups, setOpenGroups] = React.useState<Set<string>>(() => new Set());
  const [hoverGroup, setHoverGroup] = React.useState<string | null>(null);

  const visibleGroups = React.useMemo(() => {
    if (!roleResolved) return NAV_GROUPS;
    return NAV_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter((item) => canAccessSection(role, item.section, userEmail)),
    })).filter((group) => group.items.length > 0);
  }, [role, userEmail, roleResolved]);

  React.useEffect(() => {
    const active = visibleGroups.find((group) => isGroupActive(group, pathname, search));
    if (active) {
      setOpenGroups((prev) => new Set(prev).add(active.id));
    }
  }, [pathname, search, visibleGroups]);

  React.useEffect(() => {
    setMobileOpen(false);
  }, [pathname, search]);

  const toggleGroup = (groupId: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const go = (route: string) => {
    navigate(route);
    setMobileOpen(false);
  };

  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'U';

  const renderGroupItems = (group: NavGroup, flyout = false) => (
    <ul className={flyout ? 'space-y-0.5' : 'space-y-0.5 px-2 pb-2'}>
      {group.items.map((item) => {
        const Icon = item.icon;
        const active = isItemActive(pathname, search, item.route);
        return (
          <li key={item.route}>
            <button
              type="button"
              onClick={() => go(item.route)}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${
                active
                  ? 'bg-white text-[#11101d] shadow-sm'
                  : 'text-slate-300 hover:bg-white/10 hover:text-white'
              }`}
            >
              <Icon size={18} className="shrink-0" />
              {(!collapsed || flyout) && <span className="truncate">{item.name}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );

  const sidebarInner = (
    <>
      <div className={`flex items-center border-b border-white/10 ${collapsed ? 'justify-center px-2 py-4' : 'justify-between px-4 py-4'}`}>
        {!collapsed && (
          <div className="flex min-w-0 items-center gap-2">
            <img src="/logo.png" alt="Paz" className="h-9 w-9 shrink-0 rounded-lg bg-white object-contain p-0.5" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">Paz Talent</p>
              <p className="truncate text-[10px] text-slate-400">Journey</p>
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((prev) => !prev)}
          className="hidden lg:inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-300 hover:bg-white/10 hover:text-white"
          aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
        >
          <Menu size={20} />
        </button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-3">
        {!roleResolved && (
          <p className="px-4 pb-2 text-[11px] text-slate-500">Loading menu…</p>
        )}
        {visibleGroups.map((group) => {
          const GroupIcon = group.icon;
          const groupOpen = openGroups.has(group.id);
          const groupActive = isGroupActive(group, pathname, search);
          const singleItem = group.items.length === 1;

          if (collapsed) {
            return (
              <div
                key={group.id}
                className="relative px-2 py-1"
                onMouseEnter={() => setHoverGroup(group.id)}
                onMouseLeave={() => setHoverGroup(null)}
              >
                <button
                  type="button"
                  onClick={() => (singleItem ? go(group.items[0].route) : toggleGroup(group.id))}
                  className={`flex w-full items-center justify-center rounded-xl p-3 transition ${
                    groupActive ? 'bg-white text-[#11101d]' : 'text-slate-300 hover:bg-white/10 hover:text-white'
                  }`}
                  title={group.label}
                >
                  <GroupIcon size={20} />
                </button>
                {hoverGroup === group.id && (
                  <div className="absolute left-full top-0 z-50 ml-2 min-w-[200px] rounded-xl border border-white/10 bg-[#1d1b31] py-2 shadow-2xl">
                    <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{group.label}</p>
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
              <div key={group.id} className="px-2 py-0.5">
                <button
                  type="button"
                  onClick={() => go(item.route)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${
                    active ? 'bg-white text-[#11101d]' : 'text-slate-300 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <Icon size={18} />
                  <span>{item.name}</span>
                </button>
              </div>
            );
          }

          return (
            <div key={group.id} className="px-2 py-0.5">
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm transition ${
                  groupActive ? 'text-white' : 'text-slate-300 hover:bg-white/10 hover:text-white'
                }`}
              >
                <span className="flex items-center gap-3">
                  <GroupIcon size={18} />
                  <span className="font-medium">{group.label}</span>
                </span>
                <ChevronDown size={16} className={`transition ${groupOpen ? 'rotate-180' : ''}`} />
              </button>
              {groupOpen && renderGroupItems(group)}
            </div>
          );
        })}
      </nav>

      <div className={`mt-auto border-t border-white/10 ${collapsed ? 'p-2' : 'p-3'}`}>
        <button
          type="button"
          onClick={() => go('/account')}
          className={`flex w-full items-center gap-3 rounded-xl p-2 transition hover:bg-white/10 ${
            collapsed ? 'justify-center' : ''
          }`}
        >
          <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-[#2a2847] ring-2 ring-white/10">
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-white">{initials}</div>
            )}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1 text-left">
              <p className="truncate text-sm font-semibold text-white">{displayName}</p>
              <p className="truncate text-[11px] text-slate-400">{roleLabel}</p>
            </div>
          )}
        </button>
        {!collapsed && (
          <button
            type="button"
            onClick={onLogout}
            className="mt-2 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-slate-300 hover:bg-white/10 hover:text-white"
          >
            <LogOut size={16} />
            Logout
          </button>
        )}
        {collapsed && (
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
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="fixed left-4 top-4 z-50 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[#11101d] text-white shadow-lg lg:hidden"
        aria-label="Open menu"
      >
        <Menu size={22} />
      </button>

      {mobileOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          aria-label="Close menu"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex h-screen w-[280px] min-h-0 flex-col bg-[#11101d] text-white shadow-2xl transition-transform duration-300 lg:sticky lg:top-0 lg:z-auto lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        } ${collapsed ? 'lg:w-[78px]' : 'lg:w-[260px]'}`}
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
