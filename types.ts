export interface ApplicantQuestionnaire {
  occupation: string;
  currentRole: string;
  backgroundAreas: string[];
  backgroundOther?: string;
  salesExperience: string;
  somethingAboutYourself: string;
  legallyEntitledCanada: 'yes' | 'no';
  resumeUrls: string[];
  /** Normalized public profile URL (https://www.linkedin.com/in/…), optional alongside or instead of resumes */
  linkedinProfileUrl?: string;
  /** Legacy fields (optional) for older records */
  whatStoodOut?: string;
  whyGoodFit?: string;
  financialInvestmentLicense?: 'yes' | 'no';
  legallyEntitledCanadaFullTime?: 'yes' | 'no';
  comfortableVirtualEnvironment?: 'yes' | 'no';
  excitedOffSiteSocial?: 'yes' | 'no' | 'maybe';
  positionInterest?: string;
  questionsAboutOpportunity?: string;
  contactPermission?: 'yes' | 'no';
  backgroundCheckWilling?: 'yes' | 'no';
}

/** Post Live Career Overview Exit Questionnaire (link sent to candidate after live session) */
export interface PostLiveExitQuestionnaire {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  whatStoodOut: string;
  whyGoodFit: string;
  financialInvestmentLicense: 'yes' | 'no';
  legallyEntitledCanadaFullTime: 'yes' | 'no';
  comfortableVirtualEnvironment: 'yes' | 'no';
  excitedOffSiteSocial: 'yes' | 'no' | 'maybe';
  positionInterest: string;
  questionsAboutOpportunity: string;
  contactPermission: 'yes' | 'no';
  submittedAt: string; // ISO timestamp
}

export const RECEPTION_BACKGROUND_AREAS = [
  'Sales',
  'Customer Service',
  'Management / Leadership',
  'Entrepreneurial / Business Owner',
  'Trades / Skilled Labour',
  'Administrative / Office Support',
  'Basic Digital Skills / (CRM, Zoom, Google Workspace, etc.)',
  'Social Media / Marketing',
  'IT Advanced Skills (Advanced AI, Development, Data Intelligence and Infrastructure and Security)',
  'Web Developer',
  'Hospitality and Retail',
  'Health Care and Medical Field',
  'Other',
] as const;

export const ASSESSMENT_ROOM_BACKGROUND_AREAS = [
  'Sales',
  'Customer Service',
  'Management / Leadership',
  'Entrepreneurial / Business Owner',
  'Corporate / Professional',
  'Trades / Skilled Labour',
  'Administrative / Office Support',
  'Technical / Digital Skills (CRM, Zoom, Google Workspace, etc.)',
  'Social Media / Marketing',
  'Other',
] as const;

export type PipelineStage =
  | 'Checked In'
  | 'Invited to Live Career Overview Session'
  | 'Live Career Overview Session Attended'
  | 'Leadership assessment form sent'
  | 'Leadership form submitted, awaiting evaluation'
  | 'Evaluation Done'
  | 'Interview scheduled'
  | 'Final decision';

/** Admin pipeline dropdown, filters, and stats — single source of truth */
export const PIPELINE_STAGES: PipelineStage[] = [
  'Checked In',
  'Invited to Live Career Overview Session',
  'Live Career Overview Session Attended',
  'Leadership assessment form sent',
  'Leadership form submitted, awaiting evaluation',
  'Evaluation Done',
  'Interview scheduled',
  'Final decision',
];

/** Map legacy DB values to current stages */
const LEGACY_PIPELINE_STAGE: Record<string, PipelineStage> = {
  Applied: 'Checked In',
  Screening: 'Leadership form submitted, awaiting evaluation',
  'Check in': 'Checked In',
  'Checked in': 'Checked In',
  'Attended Live Session': 'Leadership assessment form sent',
  'Leadership Assessment Received Under Review': 'Leadership form submitted, awaiting evaluation',
  'Career session invited': 'Invited to Live Career Overview Session',
  'Interview Scheduled': 'Interview scheduled',
  Interviewed: 'Interview scheduled',
  Offer: 'Interview scheduled',
  Hired: 'Final decision',
  Rejected: 'Final decision',
  Withdrawn: 'Final decision',
  'Not Hired / Withdrawn': 'Final decision',
};

export function normalizePipelineStage(raw: unknown): PipelineStage {
  const s = typeof raw === 'string' ? raw : '';
  if ((PIPELINE_STAGES as readonly string[]).includes(s)) return s as PipelineStage;
  if (LEGACY_PIPELINE_STAGE[s] !== undefined) return LEGACY_PIPELINE_STAGE[s];
  return 'Checked In';
}

/**
 * After check-in form submit: pipeline is always at least "Check in" (persisted on candidate.adminData).
 */
export const PIPELINE_STAGE_AFTER_CHECK_IN: PipelineStage = 'Checked In';

/**
 * After leadership assessment submit: move to "Leadership Assessment Received Under Review" when the
 * candidate is still at or before that step. Does not downgrade or override later closed stages.
 */
export function pipelineStageAfterAssessmentComplete(current: unknown): PipelineStage {
  const cur = normalizePipelineStage(current);
  const target: PipelineStage = 'Leadership form submitted, awaiting evaluation';
  if (cur === 'Final decision') return cur;
  const ti = PIPELINE_STAGES.indexOf(target);
  const ci = PIPELINE_STAGES.indexOf(cur);
  if (ci > ti) return cur;
  return target;
}

/** Move candidate stage when Calendly invite is matched to a checked-in candidate. */
export function pipelineStageAfterLiveSessionInvited(current: unknown): PipelineStage {
  const cur = normalizePipelineStage(current);
  if (cur === 'Final decision') return cur;
  const target: PipelineStage = 'Invited to Live Career Overview Session';
  const ti = PIPELINE_STAGES.indexOf(target);
  const ci = PIPELINE_STAGES.indexOf(cur);
  if (ci > ti) return cur;
  return target;
}

/**
 * After Zoom + Calendly show the candidate attended the online career session.
 * Does not override Interview or later assessment stages.
 */
export function pipelineStageAfterLiveSessionAttended(current: unknown): PipelineStage {
  const cur = normalizePipelineStage(current);
  if (cur === 'Final decision') return cur;
  const target: PipelineStage = 'Live Career Overview Session Attended';
  const ti = PIPELINE_STAGES.indexOf(target);
  const ci = PIPELINE_STAGES.indexOf(cur);
  if (ci === -1) return target;
  if (ci > ti) return cur;
  return target;
}

/** After stage3 leadership assessment email is sent automatically */
export function pipelineStageAfterAssessmentFormSent(current: unknown): PipelineStage {
  const cur = normalizePipelineStage(current);
  if (cur === 'Final decision') return cur;
  const target: PipelineStage = 'Leadership assessment form sent';
  const ti = PIPELINE_STAGES.indexOf(target);
  const ci = PIPELINE_STAGES.indexOf(cur);
  if (ci === -1) return target;
  if (ci > ti) return cur;
  return target;
}

export interface AdminNote {
  id: string;
  createdAt: string;
  text: string;
  authorEmail?: string;
}

export interface EmailLogEntry {
  sentAt: string;
  subject: string;
  type?: string;
}

export interface QuestionnaireDisqualified {
  at: string; // ISO timestamp
  reason: string; // Shown to admin and used for applicant message
  questionKey: string; // e.g. 'legallyEntitledCanadaFullTime' for admin reference
}

export interface AdminData {
  notes: AdminNote[];
  pipelineStage: PipelineStage;
  rating: number | null; // 1-5
  interviewScheduledAt: string | null; // ISO
  nextStep: string;
  tags: string[];
  emailsSent: EmailLogEntry[];
  evaluation:
    | {
        doneAt: string;
        evaluatorName: string;
        comments: string;
        evaluationEmailSentAt?: string;
        history?: Array<{
          doneAt: string;
          evaluatorName: string;
          comments: string;
          evaluationEmailSentAt?: string;
          editedAt?: string;
        }>;
      }
    | null;
  resumeReviewedAt: string | null; // ISO - when admin reviewed/approved resumes
  questionnaireDisqualified: QuestionnaireDisqualified | null;
  /** ISO — first successful reception check-in (eligible path). Used for 24h leadership reminder scheduling. */
  checkedInAt?: string | null;
  /** ISO — automated 24h post–check-in leadership assessment reminder email was sent (at most once). */
  leadershipAssessmentReminder24hSentAt?: string | null;
  finalDecision?: 'Hired' | 'Not Hired';
  webinarGeek?: {
    synced_at?: string;
    total_subscriptions?: number;
    watched_count?: number;
    watched_live_count?: number;
    watched_replay_count?: number;
    total_watch_duration?: number;
    registration_ips?: string[];
    registration_sources?: string[];
    records?: Array<Record<string, unknown>>;
  };
}

export const DEFAULT_ADMIN_DATA: AdminData = {
  notes: [],
  pipelineStage: 'Checked In',
  rating: null,
  interviewScheduledAt: null,
  nextStep: '',
  tags: [],
  emailsSent: [],
  evaluation: null,
  resumeReviewedAt: null,
  questionnaireDisqualified: null,
};

export interface Candidate {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  city: string;
  timestamp: string;
  status: 'new' | 'interview_complete' | 'assessment_started' | 'assessment_complete';
  adminData?: AdminData;
  applicantQuestionnaire?: ApplicantQuestionnaire;
  postInterview?: {
    interviewCompleted: boolean;
    consent: boolean;
    ceoInvite: 'yes' | 'no' | 'declined';
  };
  assessment?: AssessmentData;
  score?: number;
  fitCategory?: 'High Fit' | 'Review' | 'Not Aligned';
  /** Post Live Career Overview Exit Questionnaire (filled via emailed link) */
  exitQuestionnaire?: PostLiveExitQuestionnaire;
}

export interface AssessmentData {
  /** Eligibility (at top of assessment) */
  financialInvestmentLicense?: 'yes' | 'no';
  comfortableVirtualEnvironment?: 'yes' | 'no';
  careerPathInterest?: 'Advisor' | 'Leadership';
  occupation: string;
  currentRole: string;
  backgroundAreas: string[];
  salesExperience: string;
  competitiveness: number; // 1-10
  moneyMotivation: number; // 1-10
  /** Legacy fields for the original 30-question assessment */
  likertResponses?: Record<number, number>; // Q3-20
  trueScaleResponses?: Record<number, number>; // Q21-30
  /** New assessment (50-question) fields */
  openEndedAnswers?: Record<number, string>; // ids 2-10
  personalityAnswers?: Record<number, 'a' | 'b' | 'c' | 'd'>; // 1-25
  scenarioAnswers?: Record<number, string>; // 26-40, option key
  eqAnswers?: Record<number, 'a' | 'b' | 'c' | 'd'>; // 1-10
}

export const QUESTIONS = {
  likert: [
    { id: 3, text: "I believe income should directly reflect performance." },
    { id: 4, text: "I enjoy public recognition for achievement." },
    { id: 5, text: "One of my long-term goals is financial independence." },
    { id: 6, text: "I prefer to lead rather than follow." },
    { id: 7, text: "I am comfortable making decisions under pressure." },
    { id: 8, text: "I naturally take ownership when things go wrong." },
    { id: 9, text: "I actively seek feedback to improve." },
    { id: 10, text: "I believe discipline is more important than motivation." },
    { id: 11, text: "I handle rejection well." },
    { id: 12, text: "I perform well without supervision." },
    { id: 13, text: "I am comfortable speaking with strangers." },
    { id: 14, text: "I enjoy persuading others when I believe in something." },
    { id: 15, text: "I stay consistent even when results are delayed." },
    { id: 16, text: "I prefer measurable goals." },
    { id: 17, text: "I thrive in competitive environments." },
    { id: 18, text: "I track my own performance metrics." },
    { id: 19, text: "I would rather earn based on results than tenure." },
    { id: 20, text: "I see myself building a team in the future." },
  ],
  trueScale: [
    { id: 21, text: "I need to know exactly what I’m going to make next year and the year after that.", negative: true },
    { id: 22, text: "When I’m working on something, I hate having my thought process interrupted.", negative: true },
    { id: 23, text: "I hate adrenaline and high-pressure competitive situations.", negative: true },
    { id: 24, text: "It is very gratifying knowing my paycheck is automatically deposited with safety and regularity.", negative: true },
    { id: 25, text: "I hope to work with the same people forever and don’t want them to move on.", negative: true },
    { id: 26, text: "I like my duties clearly spelled out with no ambiguity or spontaneity.", negative: true },
    { id: 27, text: "If it’s not in my job description, I don’t do it.", negative: true },
    { id: 28, text: "Sleep is incredibly important; I struggle if I don’t get eight hours.", negative: true },
    { id: 29, text: "Work/life balance and “me time” are extremely important to me.", negative: true },
    { id: 30, text: "Living a life of extremes and high intensity sounds stressful to me.", negative: true },
  ]
};