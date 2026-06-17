/**
 * Automated hiring emails (check-in submit, assessment submit, scheduled reminders).
 * Check-in: triggerPostCheckinEmail → send-candidate-email. Assessment submit → send-assessment-email.
 * 24h leadership reminder: scheduled POST → send-leadership-assessment-reminders (x-cron-secret).
 * Live bodies use the classic HTML templates (no embedded video) until a revised automation flow is approved.
 */
import type { EmailTemplate } from './emailTemplates';
import { EMAIL_TEMPLATES, POST_ASSESSMENT_SUBMIT_TEMPLATE } from './emailTemplates';
import { MID_WEEK_COACHING_ENABLED } from './midWeekCoachingConfig';

export const AUTOMATED_EMAILS_ENABLED = false;

export type AutomationTriggerId =
  | 'postCheckin'
  | 'postAssessmentSubmit'
  | 'leadershipReminder24hAfterCheckin'
  | 'midWeekPerformanceCheckIn';

/** Mid-week recruiter coaching emails — gated by MID_WEEK_COACHING_ENABLED (Edge: PERFORMANCE_CHECKIN_AUTOMATION_ENABLED). */
export const PERFORMANCE_CHECKIN_AUTOMATION_ENABLED = MID_WEEK_COACHING_ENABLED;

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
  {
    id: 'midWeekPerformanceCheckIn',
    description:
      'Mon/Tue Toronto: email recruiters & leadership below 50% mid-week pace with internal coaching form link.',
    hookHint:
      'Implemented: POST functions/v1/performance-check-in-reminder with x-cron-secret (PERFORMANCE_CHECKIN_CRON_SECRET). Disabled until Edge secret PERFORMANCE_CHECKIN_AUTOMATION_ENABLED=true. Form: /performance-check-in. Admin: /performance-check-ins.',
  },
];
