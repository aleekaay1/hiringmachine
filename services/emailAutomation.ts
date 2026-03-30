/**
 * Automated hiring emails (check-in submit, assessment submit).
 * Keep AUTOMATED_EMAILS_ENABLED false until you explicitly turn it on in code and wire triggers.
 */
import type { EmailTemplate } from './emailTemplates';
import { EMAIL_TEMPLATES, POST_ASSESSMENT_SUBMIT_TEMPLATE } from './emailTemplates';

export const AUTOMATED_EMAILS_ENABLED = false;

export type AutomationTriggerId = 'postCheckin' | 'postAssessmentSubmit';

export interface AutomationTrigger {
  id: AutomationTriggerId;
  description: string;
  /** Template used when automation is implemented */
  template: EmailTemplate;
  /** Where to hook when enabling (for maintainers) */
  hookHint: string;
}

export const AUTOMATION_TRIGGERS: AutomationTrigger[] = [
  {
    id: 'postCheckin',
    description:
      'Send Stage 2 email after the candidate submits the check-in form (Interview flow).',
    template: EMAIL_TEMPLATES.find((t) => t.id === 'stage2_post_checkin')!,
    hookHint: 'InterviewForm: after successful saveCandidate / check-in submit (non-disqualified path).',
  },
  {
    id: 'postAssessmentSubmit',
    description:
      'Send Stage 4 acknowledgment after Leadership Assessment submission (no score in email).',
    template: POST_ASSESSMENT_SUBMIT_TEMPLATE,
    hookHint: 'AssessmentRoomForm (or save path): after merged assessment + questionnaire submit.',
  },
];
