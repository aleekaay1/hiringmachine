/**
 * Synced with services/emailTemplates.ts — POST_ASSESSMENT_SUBMIT_TEMPLATE.
 * Stage 4: sent after Leadership Assessment submission (send-candidate-email, send-assessment-email).
 * Placeholders: {{candidateName}}, {{emailSignature}}
 */

export const POST_ASSESSMENT_SUBMIT_EMAIL_SUBJECT =
  'Thank you for completing the Leadership & Career Assessment';

export const POST_ASSESSMENT_SUBMIT_EMAIL_BODY_HTML = `
<p>Dear {{candidateName}},</p>
<p>Thank you for completing the Leadership &amp; Career Assessment.</p>
<p>Your responses have been successfully received and recorded. This assessment generates an internal score that serves as one component of the overall evaluation process. Individual scores are not distributed; however, confirmation has been logged that this step has been completed.</p>
<p>The submitted assessment will be reviewed alongside the rest of your profile by the CEO and members of the Leadership Team. As part of this process, consideration is given to alignment with organizational standards, mindset, and long-term leadership potential.</p>
<p>The organization continues to prioritize attitude, coachability, and consistency as key indicators of success. Many of the top-performing individuals within the organization began without prior industry experience, reinforcing the focus on personal drive and the ability to develop through training.</p>
<p>Should your profile meet the required standards, a separate communication will be issued with next steps, including details regarding the final stage of the hiring process.</p>
<p>Appreciation is extended for the time and effort invested in completing this step. Further updates will be provided as the review process progresses.</p>
<p>Best regards,</p>
{{emailSignature}}
  `.trim();

export function applyPostAssessmentSubmitMerge(
  candidateName: string,
  emailSignatureHtml: string
): string {
  return POST_ASSESSMENT_SUBMIT_EMAIL_BODY_HTML.split('{{candidateName}}')
    .join(candidateName)
    .split('{{emailSignature}}')
    .join(emailSignatureHtml);
}
