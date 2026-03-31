/**
 * Synced with services/emailTemplates.ts — POST_ASSESSMENT_SUBMIT_TEMPLATE.
 * Stage 4: sent after Leadership Assessment submission (send-candidate-email).
 * Placeholders: {{firstName}}, {{emailSignature}}
 */

export const POST_ASSESSMENT_SUBMIT_EMAIL_SUBJECT = 'We received your Leadership Assessment';

export const POST_ASSESSMENT_SUBMIT_EMAIL_BODY_HTML = `
    <p>Hi {{firstName}},</p>
    <p>Thank you for submitting your Leadership &amp; Career Assessment. We have successfully received your responses.</p>
    <p>Your assessment produces a score that our team uses as one part of our evaluation. <strong>We are not sharing individual scores by email</strong>; we have recorded that your assessment is complete and will review it along with the rest of your information.</p>
    <p>We will evaluate your profile and get back to you with next steps when there is an update.</p>
    <p>Best regards,</p>
    {{emailSignature}}
  `.trim();

export function applyPostAssessmentSubmitMerge(firstName: string, emailSignatureHtml: string): string {
  return POST_ASSESSMENT_SUBMIT_EMAIL_BODY_HTML.split('{{firstName}}')
    .join(firstName)
    .split('{{emailSignature}}')
    .join(emailSignatureHtml);
}
