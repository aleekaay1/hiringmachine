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
  Settings,
  SlidersHorizontal,
  Trophy,
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
};

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'home',
    label: 'Home',
    icon: Home,
    items: [{ name: 'My dashboard', route: '/home', icon: Home, section: 'home' }],
  },
  {
    id: 'hiring',
    label: 'Hiring',
    icon: Users,
    items: [
      { name: 'Overview', route: '/dashboard?view=overview', icon: LayoutDashboard, section: 'overview' },
      { name: 'Candidates', route: '/dashboard?view=candidates', icon: Users, section: 'candidates' },
      { name: 'QR Codes', route: '/qr', icon: QrCode, section: 'qr' },
      { name: 'Reports', route: '/reports', icon: FileText, section: 'reports' },
    ],
  },
  {
    id: 'pipeline',
    label: 'Pipeline',
    icon: PhoneCall,
    items: [
      { name: 'Call workspace', route: '/pipeline/call', icon: PhoneCall, section: 'pipeline-call' },
      { name: 'Resume uploads', route: '/pipeline/uploads', icon: FileUp, section: 'pipeline-uploads' },
      { name: 'Email workspace', route: '/pipeline/email', icon: Mail, section: 'pipeline-email' },
      { name: 'Performance', route: '/pipeline/performance', icon: BarChart3, section: 'pipeline-performance' },
      { name: 'Pipeline settings', route: '/pipeline-settings', icon: SlidersHorizontal, section: 'pipeline-settings' },
      { name: 'Legacy pipeline', route: '/pipeline', icon: PhoneCall, section: 'pipeline' },
    ],
  },
  {
    id: 'hr-leads',
    label: 'HR & Leads',
    icon: UserPlus,
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
    items: [
      { name: 'Live Sessions', route: '/live-sessions', icon: Video, section: 'live-sessions' },
      { name: 'Webinar Geek', route: '/webinar-geek', icon: MonitorPlay, section: 'webinar-geek' },
    ],
  },
  {
    id: 'analytics',
    label: 'Analytics',
    icon: BarChart3,
    items: [
      { name: 'Calls Analytics', route: '/calls-analytics', icon: BarChart3, section: 'calls-analytics' },
      { name: 'Leadership Board', route: '/calls-analytics/leaderboard', icon: Trophy, section: 'leaderboard' },
      { name: 'Dashboard analytics', route: '/dashboard?view=analytics', icon: BarChart3, section: 'analytics' },
    ],
  },
  {
    id: 'communication',
    label: 'Communication',
    icon: Mail,
    items: [{ name: 'Email log', route: '/email-log', icon: Mail, section: 'email-log' }],
  },
  {
    id: 'account',
    label: 'Account',
    icon: User,
    items: [
      { name: 'My profile', route: '/account', icon: User, section: 'account' },
      { name: 'System settings', route: '/dashboard?view=settings', icon: Settings, section: 'settings' },
    ],
  },
  {
    id: 'support',
    label: 'Support',
    icon: LifeBuoy,
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
