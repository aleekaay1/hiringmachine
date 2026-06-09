export type TourStep = {
  id: string;
  target: string;
  title: string;
  body: string;
};

export const PORTAL_TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    target: '[data-tour="app-sidebar"]',
    title: 'Welcome to PAZ HRMS',
    body: 'This sidebar is your home base. Use the groups below to move between hiring, workstations, insights, and account settings.',
  },
  {
    id: 'home',
    target: '[data-tour="nav-home"]',
    title: 'My dashboard',
    body: 'Your personal landing page with role-based stats, quick links, and refresh for the latest numbers.',
  },
  {
    id: 'workstation',
    target: '[data-tour="nav-workstation"]',
    title: 'Workstation',
    body: 'Phone workspace for 3CX dialing, email workspace for candidate threads, and resume uploads for pipeline files.',
  },
  {
    id: 'insights',
    target: '[data-tour="nav-insights"]',
    title: 'Insights',
    body: 'Recruiter performance, calls analytics, and the email log live here — your reporting hub.',
  },
  {
    id: 'profile',
    target: '[data-tour="nav-account"]',
    title: 'Profile & settings',
    body: 'Update your name, photo, contact info, and recruiter call settings (extension, targets, dialing).',
  },
  {
    id: 'leaderboard',
    target: '[data-tour="leaderboard-fab"]',
    title: 'Leadership board',
    body: 'The crown opens the team leaderboard — rankings and recognition without cluttering the main menu.',
  },
  {
    id: 'support',
    target: '[data-tour="nav-support"]',
    title: 'Support & training',
    body: 'Open a ticket, read FAQs, restart this tour, or open page guides when you need a refresher.',
  },
  {
    id: 'finish',
    target: '[data-tour="app-sidebar"]',
    title: 'You are set',
    body: 'Expand any menu group to see its pages. You can replay this tour anytime from Support.',
  },
];

export type FaqItem = { q: string; a: string };

export const PORTAL_FAQS: FaqItem[] = [
  {
    q: 'How do I set my 3CX extension?',
    a: 'Go to My profile → Recruiter call settings. Save your extension and dialing locale before using the phone workspace.',
  },
  {
    q: 'Where is the phone dialer?',
    a: 'Open Workstation → Phone workspace. Leads assigned to you appear in the call queue.',
  },
  {
    q: 'How do I see team rankings?',
    a: 'Click the crown icon above your profile in the sidebar. It opens the Leadership board.',
  },
  {
    q: 'Can I skip the welcome tour?',
    a: 'Yes — press Skip tour on any step. Restart it later from Support → Portal training.',
  },
  {
    q: 'Who receives support tickets?',
    a: 'Tickets go to the ops inbox and appear in your Support page with status updates.',
  },
];

export type PageGuide = {
  id: string;
  title: string;
  summary: string;
  steps: string[];
};

export const PAGE_GUIDES: Record<string, PageGuide> = {
  home: {
    id: 'home',
    title: 'My dashboard',
    summary: 'Your role-based home with stats and shortcuts.',
    steps: [
      'Use Refresh in the header to pull the latest saved metrics.',
      'Quick links jump to common tasks for your role.',
      'Coin balance and rank appear for eligible recruiters.',
    ],
  },
  'pipeline-call': {
    id: 'pipeline-call',
    title: 'Phone workspace',
    summary: 'Dial assigned leads and log dispositions.',
    steps: [
      'Confirm call settings under My profile before your first dial.',
      'Select a lead, review details, then click Dial to launch 3CX.',
      'When you return, save a disposition so the lead moves forward.',
    ],
  },
  'pipeline-email': {
    id: 'pipeline-email',
    title: 'Email workspace',
    summary: 'Send and track candidate email from the pipeline.',
    steps: [
      'Pick a candidate to load templates and thread history.',
      'Use Reply on an incoming message to keep the thread intact.',
      'Sent mail is logged in the outbox for your records.',
    ],
  },
  account: {
    id: 'account',
    title: 'My profile',
    summary: 'Personal details and recruiter call configuration.',
    steps: [
      'Upload a photo — it updates the sidebar avatar immediately.',
      'Phone and extension under Personal details are for contact display.',
      'Recruiter call settings control 3CX extension and daily targets.',
    ],
  },
  support: {
    id: 'support',
    title: 'Support',
    summary: 'Tickets, FAQs, and training.',
    steps: [
      'Submit a ticket with category and description.',
      'Track replies in the ticket list on this page.',
      'Use Interactive training guides above for step-by-step walkthroughs.',
    ],
  },
  'pipeline-performance': {
    id: 'pipeline-performance',
    title: 'Performance',
    summary: 'KPIs for calls, emails, and pipeline activity.',
    steps: [
      'Pick a date range preset to filter the metrics.',
      'Admins can switch between team view and individual recruiters.',
      'Use Refresh after a busy calling block to update totals.',
    ],
  },
  'calls-analytics': {
    id: 'calls-analytics',
    title: 'Calls analytics',
    summary: 'Dial volume, outcomes, and calendar trends.',
    steps: [
      'Press Fetch to load the latest call data from the database.',
      'Use the calendar to drill into a specific day.',
      'Open Leadership Board from the header or the sidebar crown.',
    ],
  },
  'email-log': {
    id: 'email-log',
    title: 'Email log',
    summary: 'Search outbound mail sent from CRM and automations.',
    steps: [
      'Filter by address, subject, trigger, or candidate name.',
      'Export CSV when you need a spreadsheet copy.',
      'Refresh after campaigns to see new sends.',
    ],
  },
};
