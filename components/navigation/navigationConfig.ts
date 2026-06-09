import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  FileSpreadsheet,
  FileText,
  FileUp,
  Home,
  LayoutDashboard,
  LifeBuoy,
  Mail,
  MonitorPlay,
  PhoneCall,
  QrCode,
  User,
  UserPlus,
  Users,
  Video,
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
    items: [{ name: 'My dashboard', route: '/home', icon: Home, section: 'home' }],
  },
  {
    id: 'hiring',
    label: 'Hiring',
    icon: Users,
    tourId: 'nav-hiring',
    items: [
      { name: 'Overview', route: '/dashboard?view=overview', icon: LayoutDashboard, section: 'overview' },
      { name: 'Candidates', route: '/dashboard?view=candidates', icon: Users, section: 'candidates' },
      { name: 'QR Codes', route: '/qr', icon: QrCode, section: 'qr' },
      { name: 'Reports', route: '/reports', icon: FileText, section: 'reports' },
    ],
  },
  {
    id: 'workstation',
    label: 'Workstation',
    icon: PhoneCall,
    tourId: 'nav-workstation',
    items: [
      { name: 'Phone workspace', route: '/pipeline/call', icon: PhoneCall, section: 'pipeline-call' },
      { name: 'Email workspace', route: '/pipeline/email', icon: Mail, section: 'pipeline-email' },
      { name: 'Resume uploads', route: '/pipeline/uploads', icon: FileUp, section: 'pipeline-uploads' },
    ],
  },
  {
    id: 'insights',
    label: 'Insights',
    icon: BarChart3,
    tourId: 'nav-insights',
    items: [
      { name: 'Performance', route: '/pipeline/performance', icon: BarChart3, section: 'pipeline-performance' },
      { name: 'Calls analytics', route: '/calls-analytics', icon: BarChart3, section: 'calls-analytics' },
      { name: 'Email log', route: '/email-log', icon: Mail, section: 'email-log' },
    ],
  },
  {
    id: 'hr-leads',
    label: 'HR & Leads',
    icon: UserPlus,
    tourId: 'nav-hr',
    items: [
      { name: 'Lead distribution', route: '/hr/lead-distribution', icon: UserPlus, section: 'pipeline-hr-leads' },
      { name: 'All leads', route: '/hr/leads', icon: FileSpreadsheet, section: 'pipeline-hr-leads' },
      { name: 'HR dashboard', route: '/hr-dashboard', icon: BarChart3, section: 'hr-dashboard' },
    ],
  },
  {
    id: 'sessions',
    label: 'Sessions',
    icon: Video,
    tourId: 'nav-sessions',
    items: [
      { name: 'Live Sessions', route: '/live-sessions', icon: Video, section: 'live-sessions' },
      { name: 'Webinar Geek', route: '/webinar-geek', icon: MonitorPlay, section: 'webinar-geek' },
    ],
  },
  {
    id: 'account',
    label: 'Account',
    icon: User,
    tourId: 'nav-account',
    items: [{ name: 'My profile', route: '/account', icon: User, section: 'account' }],
  },
  {
    id: 'support',
    label: 'Support',
    icon: LifeBuoy,
    tourId: 'nav-support',
    items: [{ name: 'Support', route: '/support', icon: LifeBuoy, section: 'support' }],
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
