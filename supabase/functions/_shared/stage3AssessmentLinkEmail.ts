import { buildEmailSignatureHtml } from './emailSignatureHtml.ts';
import { DEFAULT_ASSESSMENT_LOOKUP_URL } from './hiringUrls.ts';

export const STAGE3_ASSESSMENT_LINK_SUBJECT = 'Your Leadership Assessment – next step';

export function buildStage3AssessmentLinkHtml(
  firstName: string,
  assessmentLookupUrl: string,
): string {
  const sig = buildEmailSignatureHtml();
  const fn = (firstName || 'there').trim();
  return `
<p>Dear ${fn},</p>
<p>Thank you for attending the Live Online Career Session.</p>
<p>This session was designed to provide a clear and transparent overview of the business, expectations, and long-term opportunity within the Globe Life AIL Division – Paz Organization. Attendance reflects a level of interest and initiative that is recognized and appreciated.</p>
<p>The next step in the selection process is to complete the <strong>Leadership &amp; Career Assessment</strong>.</p>
<p>This assessment is designed to evaluate alignment, mindset, and overall fit for a performance-driven, leadership-oriented environment. It is a critical step in determining which candidates will move forward in the hiring process.</p>
<p>Please use the link below to access the assessment. The same email address used during the check-in process will be required to retrieve the record:</p>
<p><strong><a href="${assessmentLookupUrl}">${assessmentLookupUrl}</a></strong></p>
<p><strong>Important Guidelines:</strong></p>
<ul>
<li>Complete the assessment in one sitting</li>
<li>Set aside uninterrupted time to provide thoughtful and accurate responses</li>
<li>Ensure all answers reflect personal perspective and professional intent</li>
</ul>
<p>Only candidates who successfully complete this step and meet the required standards will be contacted for a final one-on-one hiring interview. During that conversation, alignment, goals, and long-term growth potential within the organization will be further evaluated.</p>
<p>If there are any issues accessing the assessment, a reply to this email will ensure prompt support.</p>
<p>Best regards,</p>
${sig}
`.trim();
}

export function getAssessmentLookupUrlForEdge(): string {
  return Deno.env.get('PUBLIC_ASSESSMENT_LOOKUP_URL')?.trim() || DEFAULT_ASSESSMENT_LOOKUP_URL;
}
