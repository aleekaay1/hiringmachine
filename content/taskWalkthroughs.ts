export type TaskWalkthroughStep = {
  id: string;
  title: string;
  body: string;
  target?: string;
  route?: string;
  optionalTarget?: boolean;
};

export type TaskWalkthrough = {
  id: string;
  title: string;
  summary: string;
  steps: TaskWalkthroughStep[];
};

export type WalkthroughCatalogSection = {
  page: string;
  description: string;
  guides: Array<{ id: string; title: string; summary: string }>;
};

export const TASK_WALKTHROUGHS: Record<string, TaskWalkthrough> = {
  'home-refresh-stats': {
    id: 'home-refresh-stats',
    title: 'Refresh your dashboard',
    summary: 'Pull the latest saved stats on your home page.',
    steps: [
      {
        id: 'nav-home',
        title: 'Open My dashboard',
        body: 'Click Home in the sidebar — this is your personal landing page.',
        target: '[data-tour="nav-home"]',
      },
      {
        id: 'refresh',
        title: 'Refresh stats',
        body: 'Click the round refresh button in the header to load the latest numbers for your role.',
        route: '/home',
        target: '[data-tour="home-refresh"]',
      },
    ],
  },
  'call-setup-extension': {
    id: 'call-setup-extension',
    title: 'Set up your 3CX extension',
    summary: 'Configure extension and dialing before your first call.',
    steps: [
      {
        id: 'nav-account',
        title: 'Open My profile',
        body: 'Call settings live under your profile. Click Account in the sidebar.',
        target: '[data-tour="nav-account"]',
      },
      {
        id: 'call-settings',
        title: 'Recruiter call settings',
        body: 'Scroll to Recruiter call settings. Enter your 3CX extension and dialing locale.',
        route: '/account#recruiter-call-settings',
        target: '[data-tour="profile-call-settings"]',
      },
      {
        id: 'save',
        title: 'Save settings',
        body: 'Click Save call settings. Do this once before using the phone workspace.',
        route: '/account#recruiter-call-settings',
        target: '[data-tour="call-settings-save"]',
      },
    ],
  },
  'call-open-workspace': {
    id: 'call-open-workspace',
    title: 'Open the phone workspace',
    summary: 'Navigate to the dialer and call queue.',
    steps: [
      {
        id: 'nav-workstation',
        title: 'Open Workstation',
        body: 'Expand Workstation in the sidebar — phone and email tools live here.',
        target: '[data-tour="nav-workstation"]',
      },
      {
        id: 'workspace',
        title: 'Phone workspace',
        body: 'This is the recruiter call workspace. Your assigned leads appear in the queue on the left.',
        route: '/pipeline/call',
        target: '[data-tour="call-workspace-header"]',
      },
    ],
  },
  'call-pick-lead': {
    id: 'call-pick-lead',
    title: 'Pick a lead to call',
    summary: 'Select a candidate from your call queue.',
    steps: [
      {
        id: 'open',
        title: 'Go to phone workspace',
        body: 'We will open the phone workspace where your leads are queued.',
        route: '/pipeline/call',
        target: '[data-tour="call-workspace-header"]',
      },
      {
        id: 'queue',
        title: 'To call queue',
        body: 'Click any candidate in the To call list on the left. Their details load on the right.',
        route: '/pipeline/call',
        target: '[data-tour="call-queue"]',
      },
      {
        id: 'batches',
        title: 'Batch filters',
        body: 'If you have multiple HR batches, use the batch chips above the queue to filter leads.',
        route: '/pipeline/call',
        target: '[data-tour="call-queue"]',
        optionalTarget: true,
      },
    ],
  },
  'call-place-dial': {
    id: 'call-place-dial',
    title: 'Place a call',
    summary: 'Verify the number and launch 3CX.',
    steps: [
      {
        id: 'open',
        title: 'Phone workspace',
        body: 'Open the phone workspace and select a lead from the queue first.',
        route: '/pipeline/call',
        target: '[data-tour="call-queue"]',
      },
      {
        id: 'phone',
        title: 'Check the phone number',
        body: 'Review or edit the phone number field. Use Save number if you corrected it.',
        route: '/pipeline/call',
        target: '[data-tour="call-phone-field"]',
        optionalTarget: true,
      },
      {
        id: 'dial',
        title: 'Place call',
        body: 'Click Place call to launch 3CX with your saved extension. Complete the conversation in 3CX.',
        route: '/pipeline/call',
        target: '[data-tour="call-place-button"]',
        optionalTarget: true,
      },
    ],
  },
  'call-log-disposition': {
    id: 'call-log-disposition',
    title: 'Log a call disposition',
    summary: 'Record the outcome after every call.',
    steps: [
      {
        id: 'after-dial',
        title: 'After you hang up',
        body: 'When you return from 3CX, a Post-call disposition window opens automatically for the candidate you dialed.',
        route: '/pipeline/call',
        target: '[data-tour="call-place-button"]',
        optionalTarget: true,
      },
      {
        id: 'disposition',
        title: 'Choose a disposition',
        body: 'Select the outcome — Booked, Callback requested, No answer, Not interested, etc. Required fields appear based on your choice.',
        route: '/pipeline/call',
        target: '[data-tour="call-disposition-guide"]',
      },
      {
        id: 'done',
        title: 'Done queue',
        body: 'Saved dispositions move the lead to the Done panel so you can track completed work.',
        route: '/pipeline/call',
        target: '[data-tour="call-done-panel"]',
      },
    ],
  },
  'call-workspace-settings': {
    id: 'call-workspace-settings',
    title: 'Open call settings from workspace',
    summary: 'Jump to profile call settings while dialing.',
    steps: [
      {
        id: 'open',
        title: 'Phone workspace',
        body: 'From the call workspace you can jump straight to call settings.',
        route: '/pipeline/call',
        target: '[data-tour="call-workspace-header"]',
      },
      {
        id: 'settings-link',
        title: 'Settings shortcut',
        body: 'Click Settings in the header to open Recruiter call settings on your profile.',
        route: '/pipeline/call',
        target: '[data-tour="call-settings-link"]',
      },
    ],
  },
  'email-open-workspace': {
    id: 'email-open-workspace',
    title: 'Open the email workspace',
    summary: 'Find the recruiter email inbox and compose flow.',
    steps: [
      {
        id: 'nav',
        title: 'Workstation',
        body: 'Open Workstation in the sidebar, then choose Email workspace.',
        target: '[data-tour="nav-workstation"]',
      },
      {
        id: 'page',
        title: 'Email workspace',
        body: 'Inbox, outbox, and candidate compose are on this page. Sync inbox to pull new replies.',
        route: '/pipeline/email',
        target: '[data-tour="email-workspace-header"]',
      },
    ],
  },
  'email-sync-inbox': {
    id: 'email-sync-inbox',
    title: 'Sync your inbox',
    summary: 'Pull the latest candidate email replies.',
    steps: [
      {
        id: 'open',
        title: 'Email workspace',
        body: 'Open the email workspace to manage candidate threads.',
        route: '/pipeline/email',
        target: '[data-tour="email-workspace-header"]',
      },
      {
        id: 'inbox',
        title: 'Inbox panel',
        body: 'Incoming mail matched to pipeline candidates appears here.',
        route: '/pipeline/email',
        target: '[data-tour="email-inbox"]',
      },
      {
        id: 'sync',
        title: 'Sync inbox',
        body: 'Click Sync inbox to fetch new messages from the mail integration.',
        route: '/pipeline/email',
        target: '[data-tour="email-sync-inbox"]',
        optionalTarget: true,
      },
    ],
  },
  'email-compose-candidate': {
    id: 'email-compose-candidate',
    title: 'Email a candidate',
    summary: 'Select a candidate and send from templates.',
    steps: [
      {
        id: 'open',
        title: 'Email workspace',
        body: 'Open the email workspace.',
        route: '/pipeline/email',
        target: '[data-tour="email-workspace-header"]',
      },
      {
        id: 'candidates',
        title: 'Pick a candidate',
        body: 'Choose a candidate from the list to load their thread and compose area.',
        route: '/pipeline/email',
        target: '[data-tour="email-candidate-list"]',
        optionalTarget: true,
      },
      {
        id: 'compose',
        title: 'Compose or reply',
        body: 'Use Reply on an existing thread, or compose a new message with templates on the right.',
        route: '/pipeline/email',
        target: '[data-tour="email-compose"]',
        optionalTarget: true,
      },
    ],
  },
  'account-update-photo': {
    id: 'account-update-photo',
    title: 'Update your profile photo',
    summary: 'Change the avatar shown in the sidebar.',
    steps: [
      {
        id: 'nav',
        title: 'My profile',
        body: 'Click Account in the sidebar to open your profile.',
        target: '[data-tour="nav-account"]',
      },
      {
        id: 'photo',
        title: 'Profile photo',
        body: 'Click Change photo or the camera icon on your avatar. The sidebar updates immediately after upload.',
        route: '/account',
        target: '[data-tour="profile-avatar"]',
      },
    ],
  },
  'account-personal-details': {
    id: 'account-personal-details',
    title: 'Update personal details',
    summary: 'Name, phone, and extension for teammates.',
    steps: [
      {
        id: 'nav',
        title: 'My profile',
        body: 'Open Account from the sidebar.',
        target: '[data-tour="nav-account"]',
      },
      {
        id: 'details',
        title: 'Personal details',
        body: 'Edit display name, phone, and extension. Click Save profile when finished.',
        route: '/account',
        target: '[data-tour="profile-personal-details"]',
      },
    ],
  },
  'perf-view-kpis': {
    id: 'perf-view-kpis',
    title: 'View recruiter performance',
    summary: 'Read call and booking KPIs for a date range.',
    steps: [
      {
        id: 'nav',
        title: 'Insights',
        body: 'Open Insights in the sidebar, then Performance.',
        target: '[data-tour="nav-insights"]',
      },
      {
        id: 'page',
        title: 'Performance dashboard',
        body: 'KPI cards show calls, emails, and bookings for the selected period.',
        route: '/pipeline/performance',
        target: '[data-tour="perf-header"]',
      },
      {
        id: 'presets',
        title: 'Date range',
        body: 'Use This week, Last 7 days, or All time to change the reporting window.',
        route: '/pipeline/performance',
        target: '[data-tour="perf-date-presets"]',
      },
    ],
  },
  'analytics-fetch-data': {
    id: 'analytics-fetch-data',
    title: 'Load calls analytics',
    summary: 'Fetch dial data and explore the calendar.',
    steps: [
      {
        id: 'nav',
        title: 'Insights',
        body: 'Calls analytics lives under Insights in the sidebar.',
        target: '[data-tour="nav-insights"]',
      },
      {
        id: 'fetch',
        title: 'Fetch data',
        body: 'Click Fetch to load the latest call records from the database.',
        route: '/calls-analytics',
        target: '[data-tour="analytics-fetch"]',
      },
      {
        id: 'calendar',
        title: 'Calendar drill-down',
        body: 'Click a day on the calendar to see detail for that date.',
        route: '/calls-analytics',
        target: '[data-tour="analytics-calendar"]',
        optionalTarget: true,
      },
    ],
  },
  'leaderboard-open': {
    id: 'leaderboard-open',
    title: 'Open the leadership board',
    summary: 'Team rankings from the sidebar crown.',
    steps: [
      {
        id: 'crown',
        title: 'Crown icon',
        body: 'Click the crown above your profile photo in the sidebar. It opens the Leadership board.',
        target: '[data-tour="leaderboard-fab"]',
      },
      {
        id: 'board',
        title: 'Leadership board',
        body: 'Rankings and podium show top recruiters. Use this for team recognition.',
        route: '/calls-analytics/leaderboard',
        target: '[data-tour="leaderboard-page"]',
        optionalTarget: true,
      },
    ],
  },
  'email-log-search': {
    id: 'email-log-search',
    title: 'Search the email log',
    summary: 'Find outbound mail by address or subject.',
    steps: [
      {
        id: 'nav',
        title: 'Email log',
        body: 'Under Insights, open Email log for all outbound CRM and automation mail.',
        target: '[data-tour="nav-insights"]',
      },
      {
        id: 'search',
        title: 'Search and filter',
        body: 'Use the search box and filters to find sends by address, subject, trigger, or candidate.',
        route: '/email-log',
        target: '[data-tour="email-log-search"]',
      },
      {
        id: 'export',
        title: 'Export CSV',
        body: 'Export CSV when you need a spreadsheet copy of the filtered results.',
        route: '/email-log',
        target: '[data-tour="email-log-export"]',
      },
    ],
  },
  'support-submit-ticket': {
    id: 'support-submit-ticket',
    title: 'Submit a support ticket',
    summary: 'Report an issue to ops.',
    steps: [
      {
        id: 'nav',
        title: 'Support',
        body: 'Click Support in the sidebar to open the help center.',
        target: '[data-tour="nav-support"]',
      },
      {
        id: 'form',
        title: 'Submit a ticket',
        body: 'Pick a category, write a subject and details, then click Submit ticket.',
        route: '/support',
        target: '[data-tour="support-ticket-form"]',
      },
      {
        id: 'list',
        title: 'Track tickets',
        body: 'Your tickets appear on the right. Select one to read updates and resolution notes.',
        route: '/support',
        target: '[data-tour="support-ticket-list"]',
      },
    ],
  },
  'hiring-view-candidates': {
    id: 'hiring-view-candidates',
    title: 'Browse candidates',
    summary: 'Open the hiring candidates list.',
    steps: [
      {
        id: 'nav',
        title: 'Hiring menu',
        body: 'Expand Hiring in the sidebar to see overview, candidates, QR codes, and reports.',
        target: '[data-tour="nav-hiring"]',
      },
      {
        id: 'candidates',
        title: 'Candidates view',
        body: 'Open Candidates to search and manage applicant records.',
        route: '/dashboard?view=candidates',
        target: '[data-tour="hiring-candidates"]',
        optionalTarget: true,
      },
    ],
  },
};

export const WALKTHROUGH_CATALOG: WalkthroughCatalogSection[] = [
  {
    page: 'Getting started',
    description: 'Learn the layout before diving into daily tasks.',
    guides: [{ id: 'portal-welcome', title: 'Full portal tour', summary: 'Sidebar, menu groups, profile, crown, and support.' }],
  },
  {
    page: 'My dashboard',
    description: 'Home page stats and refresh.',
    guides: [{ id: 'home-refresh-stats', title: 'Refresh your dashboard', summary: 'Pull the latest saved stats.' }],
  },
  {
    page: 'Phone workspace',
    description: 'Dialing, dispositions, and queue workflow.',
    guides: [
      { id: 'call-setup-extension', title: 'Set up 3CX extension', summary: 'Extension and dialing locale on your profile.' },
      { id: 'call-open-workspace', title: 'Open phone workspace', summary: 'Navigate to the call queue.' },
      { id: 'call-pick-lead', title: 'Pick a lead', summary: 'Select a candidate from To call.' },
      { id: 'call-place-dial', title: 'Place a call', summary: 'Verify number and launch 3CX.' },
      { id: 'call-log-disposition', title: 'Log a disposition', summary: 'Record outcome after every call.' },
      { id: 'call-workspace-settings', title: 'Call settings shortcut', summary: 'Jump to settings from the workspace.' },
    ],
  },
  {
    page: 'Email workspace',
    description: 'Inbox sync, replies, and compose.',
    guides: [
      { id: 'email-open-workspace', title: 'Open email workspace', summary: 'Navigate to recruiter email tools.' },
      { id: 'email-sync-inbox', title: 'Sync inbox', summary: 'Pull latest candidate replies.' },
      { id: 'email-compose-candidate', title: 'Email a candidate', summary: 'Select candidate and send mail.' },
    ],
  },
  {
    page: 'My profile',
    description: 'Photo, contact info, and call configuration.',
    guides: [
      { id: 'account-update-photo', title: 'Update profile photo', summary: 'Avatar shown in the sidebar.' },
      { id: 'account-personal-details', title: 'Update personal details', summary: 'Name, phone, and extension.' },
      { id: 'call-setup-extension', title: 'Set up call settings', summary: '3CX extension and daily targets.' },
    ],
  },
  {
    page: 'Insights',
    description: 'Performance, analytics, and email log.',
    guides: [
      { id: 'perf-view-kpis', title: 'View performance KPIs', summary: 'Calls and bookings by date range.' },
      { id: 'analytics-fetch-data', title: 'Load calls analytics', summary: 'Fetch data and use the calendar.' },
      { id: 'email-log-search', title: 'Search email log', summary: 'Find and export outbound mail.' },
      { id: 'leaderboard-open', title: 'Open leadership board', summary: 'Team rankings via the crown.' },
    ],
  },
  {
    page: 'Hiring',
    description: 'Candidate records and hiring overview.',
    guides: [{ id: 'hiring-view-candidates', title: 'Browse candidates', summary: 'Open the candidates list.' }],
  },
  {
    page: 'Support',
    description: 'Tickets and help resources.',
    guides: [{ id: 'support-submit-ticket', title: 'Submit a support ticket', summary: 'Report issues and track replies.' }],
  },
];
