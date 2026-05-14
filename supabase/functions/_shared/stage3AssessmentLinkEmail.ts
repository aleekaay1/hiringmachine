import { buildEmailSignatureHtml } from './emailSignatureHtml.ts';
import { DEFAULT_ASSESSMENT_LOOKUP_URL } from './hiringUrls.ts';

export const STAGE3_ASSESSMENT_LINK_SUBJECT = 'Your Leadership Assessment – next step';

/** Primary “session attended → assessment” email (sync with services/emailTemplates stage3_assessment_link). */
export function buildStage3AssessmentLinkHtml(firstName: string, assessmentLookupUrl: string): string {
  const sig = buildEmailSignatureHtml();
  const fn = (firstName || 'there').trim();
  const link = `<a href="${assessmentLookupUrl}" target="_blank" rel="noopener noreferrer">${assessmentLookupUrl}</a>`;
  return `
<p>Hi ${fn},</p>
<p>Thank you for attending today’s Live Online Career Session.</p>
<p>The next step in the process is to complete the <strong>Leadership &amp; Career Assessment</strong> using the link below:</p>
<p><strong>${link}</strong></p>
<p>This assessment is designed to help us evaluate overall fit, mindset, professionalism, and leadership potential within our performance-driven environment.</p>
<p>Please complete it in one sitting and answer thoughtfully and honestly.</p>
<p>We look forward to reviewing your submission.</p>
<p>Best regards,</p>
${sig}
`.trim();
}

export function getAssessmentLookupUrlForEdge(): string {
  return Deno.env.get('PUBLIC_ASSESSMENT_LOOKUP_URL')?.trim() || DEFAULT_ASSESSMENT_LOOKUP_URL;
}
