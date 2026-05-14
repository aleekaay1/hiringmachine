/**
 * Automated 24h post–check-in reminder: complete Leadership Assessment (no “session attended” claim).
 */
import { buildEmailSignatureHtml } from './emailSignatureHtml.ts';

export const LEADERSHIP_ASSESSMENT_REMINDER_24H_SUBJECT = 'Reminder: Complete your Leadership Assessment';

export function buildLeadershipAssessmentReminder24hHtml(
  firstName: string,
  assessmentLookupUrl: string,
): string {
  const sig = buildEmailSignatureHtml();
  const fn = (firstName || 'there').trim();
  const link = `<a href="${assessmentLookupUrl}" target="_blank" rel="noopener noreferrer">${assessmentLookupUrl}</a>`;
  return `
<p>Hi ${fn},</p>
<p>This is a friendly reminder to complete your <strong>Leadership &amp; Career Assessment</strong> if you have not already done so.</p>
<p>Please use the link below. The same email address you used at check-in is required to access your record:</p>
<p><strong>${link}</strong></p>
<p>We are moving forward with candidates who demonstrate responsiveness and consistency throughout the process—completing this step helps us keep your application on track.</p>
<p>Best regards,</p>
${sig}
`.trim();
}
