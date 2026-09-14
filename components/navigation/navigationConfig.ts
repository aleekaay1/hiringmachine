import type { LucideIcon } from 'lucide-react';
import {
  ClipboardList,
  Home,
  Mail,
  Mails,
  PhoneCall,
  Send,
  User,
} from 'lucide-react';
import type { AppSection } from '../../services/accessControl';

export type NavItem = {
  name: string;
  route: string;
  icon: LucideIcon;
  section: AppSection;
};

export type NavGroup = {
  id: string;
  label: string;
  icon: LucideIcon;
  items: NavItem[];
  tourId?: string;
};

export const LEADERBOARD_ROUTE = '/calls-analytics/leaderboard';

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'home',
    label: 'Home',
    icon: Home,
    tourId: 'nav-home',
    items: [{ name: 'Home', route: '/home', icon: Home, section: 'home' }],
  },
  {
    id: 'check-ins',
    label: 'Check-ins',
    icon: ClipboardList,
    tourId: 'nav-check-ins',
    items: [{ name: 'Check-ins', route: '/check-ins', icon: ClipboardList, section: 'check-ins' }],
  },
  {
    id: 'replies',
    label: 'Replies',
    icon: Mail,
    tourId: 'nav-replies',
    items: [{ name: 'Replies', route: '/replies', icon: Mail, section: 'replies' }],
  },
  {
    id: 'bulk-email',
    label: 'Bulk email',
    icon: Mails,
    tourId: 'nav-bulk-email',
    items: [{ name: 'Bulk email', route: '/bulk-email', icon: Mails, section: 'bulk-email' }],
  },
  {
    id: 'call',
    label: 'Call workspace',
    icon: PhoneCall,
    tourId: 'nav-call',
    items: [{ name: 'Call workspace', route: '/pipeline/call', icon: PhoneCall, section: 'pipeline-call' }],
  },
  {
    id: 'sent-ahead',
    label: 'Sent ahead',
    icon: Send,
    tourId: 'nav-sent-ahead',
    items: [{ name: 'Sent ahead', route: '/sent-ahead', icon: Send, section: 'sent-ahead' }],
  },
  {
    id: 'account',
    label: 'Account',
    icon: User,
    tourId: 'nav-account',
    items: [{ name: 'Account', route: '/account', icon: User, section: 'account' }],
  },
];

export function routeMatches(pathname: string, search: string, route: string): boolean {
  const current = `${pathname}${search}`;
  if (current === route) return true;
  const [routePath, routeQuery] = route.split('?');
  if (pathname !== routePath) return false;
  if (!routeQuery) return search === '';
  const expected = new URLSearchParams(routeQuery);
  const actual = new URLSearchParams(search.replace(/^\?/, ''));
  for (const [key, value] of expected.entries()) {
    if (actual.get(key) !== value) return false;
  }
  return true;
}

export function isGroupActive(group: NavGroup, pathname: string, search: string): boolean {
  return group.items.some((item) => routeMatches(pathname, search, item.route));
}

export function isItemActive(pathname: string, search: string, route: string): boolean {
  return routeMatches(pathname, search, route);
}
