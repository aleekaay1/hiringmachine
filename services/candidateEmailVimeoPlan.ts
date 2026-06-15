/**
 * Vimeo → candidate email mapping (live in templates).
 *
 * | When | Vimeo | Template / automation |
 * |------|-------|------------------------|
 * | Check-in submitted | [1191971908](https://vimeo.com/1191971908/bb3c2436e2) | `postCheckinEmailTemplate`, automated `post_checkin` |
 * | Session attended → assessment link | [1191971952](https://vimeo.com/1191971952/4f1d10f9d9) | `stage3_assessment_link`, `stage3AssessmentLinkEmail`, Live Sessions auto-send |
 * | Final reminder / post-overview assessment | [1191971913](https://vimeo.com/1191971913/465fc44238) | `stage3_assessment_link_post_overview`, `send-leadership-assessment-reminders` |
 * | Missed live session → reschedule (no-shows) | [1191971914](https://vimeo.com/1191971914/87db4b2a69) | `missed_live_session_reschedule` (admin CRM) |
 * | Post–Leadership Assessment submit | [1191971907](https://vimeo.com/1191971907/ede5e12aeb) | `postAssessmentSubmitEmailTemplate`, automated `post_assessment_submit` |
 */

export {
  VIMEO_CHECKIN_LIVE_SESSION_INVITE,
  VIMEO_STAGE3_ASSESSMENT_AFTER_ATTENDED,
  VIMEO_STAGE3_ASSESSMENT_POST_OVERVIEW,
  VIMEO_MISSED_LIVE_SESSION_RESCHEDULE,
  VIMEO_POST_ASSESSMENT_SUBMIT_PLANNED as VIMEO_POST_ASSESSMENT_SUBMIT,
} from './emailVideoEmbeds';
