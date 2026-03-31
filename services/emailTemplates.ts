import { buildEmailSignatureHtml } from './emailSignature';

/** Merge fields for candidate data in email templates */
export const EMAIL_MERGE_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'assessmentLookupUrl',
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
 * Manual stage emails (admin buttons). Stage 4 is automation-only (see emailAutomation.ts).
 * Stage 2 → after check-in (auto later). Stage 3 → assessment link after overview. Stage 5 → evaluation.
 */
export const EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    id: 'stage2_post_checkin',
    name: 'Stage 2 – Post check-in',
    hint: 'After they submit the check-in form (automate later).',
    subject: 'Thank you for checking in – Paz Organization / Globe Life AIL',
    bodyHtml: `
      <p>Hi {{firstName}},</p>
      <p>Thank you for completing your check-in with us. We’re glad you’re exploring a career opportunity with the Paz Organization / Globe Life AIL Division.</p>
      <p>If you joined your scheduled Career Overview Session on Zoom, we appreciate you taking the time. If you still need to join, please use the Zoom information you received at check-in.</p>
      <p>We’ll be in touch with next steps as you move forward in the process.</p>
      <p>Best regards,</p>
      {{emailSignature}}
    `.trim(),
  },
  {
    id: 'stage3_assessment_link',
    name: 'Stage 3 – Leadership Assessment link',
    hint: 'After they attend the online overview; sends the assessment lookup link.',
    subject: 'Your Leadership Assessment – next step',
    bodyHtml: `
      <p>Hi {{firstName}},</p>
      <p>Thank you for attending the online Career Overview Session. The next step is to complete your <strong>Leadership &amp; Career Assessment</strong>.</p>
      <p>Please use the link below. You’ll enter the email address you used when you checked in so we can load your record:</p>
      <p><a href="{{assessmentLookupUrl}}">{{assessmentLookupUrl}}</a></p>
      <p>If you have any trouble accessing the form, reply to this email and we’ll help.</p>
      <p>Best regards,</p>
      {{emailSignature}}
    `.trim(),
  },
  {
    id: 'stage5_evaluation',
    name: 'Stage 5 – Evaluation & callback',
    hint: 'They are under evaluation; final interview if selected.',
    subject: 'Your application – under review',
    bodyHtml: `
      <p>Hi {{firstName}},</p>
      <p>Thank you for your time and engagement throughout our hiring process so far.</p>
      <p>Your profile is <strong>currently under evaluation</strong> by our team. We are reviewing your information carefully and will follow up with you as the process continues.</p>
      <p>If you are selected to move forward, you will receive a separate message inviting you to a <strong>final interview</strong> with additional details.</p>
      <p>We appreciate your patience and interest in joining our team.</p>
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
  const map: Record<string, string> = {
    '{{firstName}}': candidate.firstName || '',
    '{{lastName}}': candidate.lastName || '',
    '{{email}}': candidate.email || '',
    '{{phone}}': candidate.phone || '',
    ...(extras || {}),
  };
  const signature = options?.siteOrigin ? buildEmailSignatureHtml(options.siteOrigin) : '';
  map['{{emailSignature}}'] = signature;

  let sub = subject;
  let body = bodyHtml;
  for (const [key, value] of Object.entries(map)) {
    sub = sub.split(key).join(value);
    body = body.split(key).join(value);
  }
  return { subject: sub, bodyHtml: body };
}
