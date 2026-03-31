/**
 * Automated hiring emails (check-in submit, assessment submit).
 * Check-in: triggerPostCheckinEmail in InterviewForm → send-candidate-email Edge Function.
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
      'Sends Stage 2 (post check-in) email after eligible candidate submits check-in (InterviewForm → send-candidate-email).',
    template: EMAIL_TEMPLATES.find((t) => t.id === 'stage2_post_checkin')!,
    hookHint: 'Implemented: candidateEmailTrigger.triggerPostCheckinEmail after successful save.',
  },
  {
    id: 'postAssessmentSubmit',
    description:
      'Send Stage 4 acknowledgment after Leadership Assessment submission (no score in email).',
    template: POST_ASSESSMENT_SUBMIT_TEMPLATE,
    hookHint: 'Implemented: triggerPostAssessmentSubmitEmail after save in AssessmentRoomForm and Assessment.',
  },
];
