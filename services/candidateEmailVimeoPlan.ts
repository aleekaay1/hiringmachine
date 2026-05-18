/**
 * Vimeo → candidate email mapping (reference for ops & future automation).
 *
 * | When | Vimeo page | In codebase |
 * |------|------------|---------------|
 * | Check-in submitted | [1191971908](https://vimeo.com/1191971908/bb3c2436e2) | `postCheckinEmailTemplate`, automated `post_checkin` |
 * | Session attended → assessment link (primary) | [1191971952](https://vimeo.com/1191971952/4f1d10f9d9) | `EMAIL_TEMPLATES` `stage3_assessment_link`, `stage3AssessmentLinkEmail` |
 * | After overview → assessment (alternate / CEO tone) | [1191971913](https://vimeo.com/1191971913/465fc44238) | `EMAIL_TEMPLATES` `stage3_assessment_link_post_overview` |
 * | Missed live session → reschedule | [1191971914](https://vimeo.com/1191971914/87db4b2a69) | `EMAIL_TEMPLATES` `missed_live_session_reschedule` |
 * | Post–Leadership Assessment submit | [1191971907](https://vimeo.com/1191971907/ede5e12aeb) | **Planned only** — `PLANNED_POST_ASSESSMENT_SUBMIT_EMAIL_BODY_HTML` (do not wire until approved) |
 * | 24h after check-in, no assessment | [1191971913](https://vimeo.com/1191971913/465fc44238) | `send-leadership-assessment-reminders` Edge (scheduled) + `leadershipAssessment24hReminderEmail.ts` |
 */

import { vimeoEmailEmbedTable, VIMEO_POST_ASSESSMENT_SUBMIT_PLANNED } from './emailVideoEmbeds';

/** Subject suggested when switching automation to this body. */
export const PLANNED_POST_ASSESSMENT_SUBMIT_EMAIL_SUBJECT =
  'Your Assessment Has Been Reviewed — Next Steps';

/**
 * Draft + embed for post–assessment automation. **Not sent** by Edge Functions yet;
 * replace `POST_ASSESSMENT_SUBMIT_EMAIL_BODY_HTML` in `_shared/postAssessmentSubmitEmailTemplate.ts`
 * (and sync `emailTemplates.ts`) when you want to go live.
 */
export const PLANNED_POST_ASSESSMENT_SUBMIT_EMAIL_BODY_HTML = `
<p>Hi {{firstName}},</p>
${vimeoEmailEmbedTable(VIMEO_POST_ASSESSMENT_SUBMIT_PLANNED, 'Assessment reviewed')}
<p>Thank you for completing the Leadership &amp; Career Assessment.</p>
<p>Our leadership team is now personally reviewing your profile and responses as we continue selecting candidates for the next stage of the process.</p>
<p>We look beyond experience and focus heavily on qualities such as coachability, resilience, professionalism, and leadership potential.</p>
<p>If selected, you will be contacted directly regarding a final one-on-one interview.</p>
<p>Thank you again for your interest in joining Globe Life – Paz Organization.</p>
<p>Best regards,</p>
{{emailSignature}}
`.trim();
