export interface ApplicantQuestionnaire {
  occupation: string;
  currentRole: string;
  backgroundAreas: string[];
  backgroundOther?: string;
  salesExperience: string;
  somethingAboutYourself: string;
  legallyEntitledCanada: 'yes' | 'no';
  resumeUrls: string[];
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
  | 'Applied'
  | 'Screening'
  | 'Interview Scheduled'
  | 'Interviewed'
  | 'Offer'
  | 'Hired'
  | 'Rejected'
  | 'Withdrawn';

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
  resumeReviewedAt: string | null; // ISO - when admin reviewed/approved resumes
  questionnaireDisqualified: QuestionnaireDisqualified | null;
}

export const DEFAULT_ADMIN_DATA: AdminData = {
  notes: [],
  pipelineStage: 'Applied',
  rating: null,
  interviewScheduledAt: null,
  nextStep: '',
  tags: [],
  emailsSent: [],
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
  likertResponses: Record<number, number>; // Q3-20
  trueScaleResponses: Record<number, number>; // Q21-30
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