import { buildEmailSignatureHtml } from './emailSignatureHtml';
import { POST_CHECKIN_EMAIL_SUBJECT, POST_CHECKIN_EMAIL_BODY_HTML } from './postCheckinEmailTemplate';
import { DEFAULT_ASSESSMENT_LOOKUP_URL, ZOOM_MEETING_URL } from './hiringUrls';

/** Merge fields for candidate data in email templates */
export const EMAIL_MERGE_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'assessmentLookupUrl',
  'candidateName',
  'zoomUrl',
] as const;
export type EmailMergeField = (typeof EMAIL_MERGE_FIELDS)[number];

export interface EmailTemplate {
  id: string;
  /** Short label for admin buttons */
  name: string;
  /** One-line context for admins */
  hint?: string;
  subject: string;
  bodyHtml: string;
}

/**
 * Manual stage emails (admin buttons). Check-in is also sent automatically on form submit (Edge Function).
 * Stage 3 → assessment link. Stage 5 → evaluation (manual only).
 */
export const EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    id: 'stage2_post_checkin',
    name: 'Stage 2 – Post check-in',
    hint: 'Sent automatically when someone submits check-in; also available in admin.',
    subject: POST_CHECKIN_EMAIL_SUBJECT,
    bodyHtml: POST_CHECKIN_EMAIL_BODY_HTML,
  },
  {
    id: 'stage3_assessment_link',
    name: 'Stage 3 – Leadership Assessment link',
    hint: 'After they attend the online overview; sends the assessment lookup link.',
    subject: 'Your Leadership Assessment – next step',
    bodyHtml: `
<p>Dear {{firstName}},</p>
<p>Thank you for attending the Live Online Career Session.</p>
<p>This session was designed to provide a clear and transparent overview of the business, expectations, and long-term opportunity within the Globe Life AIL Division – Paz Organization. Attendance reflects a level of interest and initiative that is recognized and appreciated.</p>
<p>The next step in the selection process is to complete the <strong>Leadership &amp; Career Assessment</strong>.</p>
<p>This assessment is designed to evaluate alignment, mindset, and overall fit for a performance-driven, leadership-oriented environment. It is a critical step in determining which candidates will move forward in the hiring process.</p>
<p>Please use the link below to access the assessment. The same email address used during the check-in process will be required to retrieve the record:</p>
<p><strong><a href="{{assessmentLookupUrl}}">{{assessmentLookupUrl}}</a></strong></p>
<p><strong>Important Guidelines:</strong></p>
<ul>
<li>Complete the assessment in one sitting</li>
<li>Set aside uninterrupted time to provide thoughtful and accurate responses</li>
<li>Ensure all answers reflect personal perspective and professional intent</li>
</ul>
<p>Only candidates who successfully complete this step and meet the required standards will be contacted for a final one-on-one hiring interview. During that conversation, alignment, goals, and long-term growth potential within the organization will be further evaluated.</p>
<p>If there are any issues accessing the assessment, a reply to this email will ensure prompt support.</p>
<p>Best regards,</p>
{{emailSignature}}
    `.trim(),
  },
  {
    id: 'stage5_evaluation',
    name: 'Stage 5 – Evaluation & callback',
    hint: 'Manual only; no form trigger.',
    subject: 'Your application – under review',
    bodyHtml: `
<p>Dear {{firstName}},</p>
<p>Thank you for your time, effort, and engagement throughout the hiring process to this point.</p>
<p>Your profile is currently under careful review by the CEO and members of the Leadership Team. Each submission is evaluated with intention, as the focus remains on identifying individuals who demonstrate strong alignment with the standards, expectations, and long-term vision of the organization.</p>
<p>This stage of the process is selective. Consideration is being given to factors such as professionalism, responsiveness, assessment quality, consistency, and overall leadership potential.</p>
<p>The organization places a strong emphasis on attitude, coachability, and the ability to persevere through challenges. Technical skills can be developed through training; however, long-term success is most often achieved by individuals who demonstrate resilience, discipline, and a strong internal drive. Notably, many of the top performers within the organization began without prior experience in the insurance industry.</p>
<p>If selected to move forward, a separate communication will be sent with an invitation to a final one-on-one interview, including full details on next steps and expectations.</p>
<p>While this review process is ongoing, patience is appreciated. Every candidate is being given thoughtful and thorough consideration.</p>
<p>Interest in joining the Globe Life AIL Division – Paz Organization is both recognized and respected.</p>
<p>Best regards,</p>
{{emailSignature}}
    `.trim(),
  },
];

/**
 * Stage 4 – sent after Leadership Assessment submission (automation only; not a manual button).
 * When automation is enabled, use this template with mergeTemplate(..., assessmentExtras).
 */
export const POST_ASSESSMENT_SUBMIT_TEMPLATE: EmailTemplate = {
  id: 'stage4_assessment_received',
  name: 'Stage 4 – Assessment received (automation)',
  hint: 'Thank you; we received results—no score disclosed.',
  subject: 'We received your Leadership Assessment',
  bodyHtml: `
    <p>Hi {{firstName}},</p>
    <p>Thank you for submitting your Leadership &amp; Career Assessment. We have successfully received your responses.</p>
    <p>Your assessment produces a score that our team uses as one part of our evaluation. <strong>We are not sharing individual scores by email</strong>; we have recorded that your assessment is complete and will review it along with the rest of your information.</p>
    <p>We will evaluate your profile and get back to you with next steps when there is an update.</p>
    <p>Best regards,</p>
    {{emailSignature}}
  `.trim(),
};

export function mergeTemplate(
  subject: string,
  bodyHtml: string,
  candidate: { firstName: string; lastName: string; email: string; phone: string },
  extras?: Record<string, string>,
  options?: { siteOrigin?: string }
): { subject: string; bodyHtml: string } {
  const candidateName = `${candidate.firstName || ''} ${candidate.lastName || ''}`.trim();
  const map: Record<string, string> = {
    '{{firstName}}': candidate.firstName || '',
    '{{lastName}}': candidate.lastName || '',
    '{{email}}': candidate.email || '',
    '{{phone}}': candidate.phone || '',
    '{{candidateName}}': candidateName,
    '{{zoomUrl}}': ZOOM_MEETING_URL,
    '{{assessmentLookupUrl}}': DEFAULT_ASSESSMENT_LOOKUP_URL,
    ...(extras || {}),
  };
  const signature = buildEmailSignatureHtml(options?.siteOrigin);
  map['{{emailSignature}}'] = signature;

  let sub = subject;
  let body = bodyHtml;
  for (const [key, value] of Object.entries(map)) {
    sub = sub.split(key).join(value);
    body = body.split(key).join(value);
  }
  return { subject: sub, bodyHtml: body };
}
