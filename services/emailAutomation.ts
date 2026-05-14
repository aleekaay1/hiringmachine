/**
 * Automated hiring emails (check-in submit, assessment submit, scheduled reminders).
 * Check-in: triggerPostCheckinEmail → send-candidate-email. Assessment submit → send-assessment-email.
 * 24h leadership reminder: scheduled POST → send-leadership-assessment-reminders (x-cron-secret).
 * Live bodies use the classic HTML templates (no embedded video) until a revised automation flow is approved.
 */
import type { EmailTemplate } from './emailTemplates';
import { EMAIL_TEMPLATES, POST_ASSESSMENT_SUBMIT_TEMPLATE } from './emailTemplates';

export const AUTOMATED_EMAILS_ENABLED = false;

export type AutomationTriggerId = 'postCheckin' | 'postAssessmentSubmit' | 'leadershipReminder24hAfterCheckin';

export interface AutomationTrigger {
  id: AutomationTriggerId;
  description: string;
  /** Template used when automation is implemented */
  template?: EmailTemplate;
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
  {
    id: 'leadershipReminder24hAfterCheckin',
    description:
      'If the Leadership Assessment is still not submitted 24+ hours after check-in, send one reminder email with the assessment link (same cron + Edge path as before).',
    template: EMAIL_TEMPLATES.find((t) => t.id === 'stage3_assessment_link_post_overview'),
    hookHint:
      'Implemented: Supabase schedule → POST functions/v1/send-leadership-assessment-reminders with x-cron-secret. Sets adminData.leadershipAssessmentReminder24hSentAt. Uses adminData.checkedInAt (set on check-in) or falls back to candidates.timestamp.',
  },
];
