/**
 * Synced copy of services/postCheckinEmailTemplate.ts — update both when changing.
 * Post check-in email (Live Online Career Session). Used by admin templates + send-candidate-email Edge Function.
 * Keep merge placeholders: {{candidateName}}, {{zoomUrl}}, {{emailSignature}}
 */

export const POST_CHECKIN_EMAIL_SUBJECT =
  "Live Online Career Session – you're invited | Globe Life AIL · Paz Organization";

/** Body with placeholders for mergeTemplate / Edge Function. */
export const POST_CHECKIN_EMAIL_BODY_HTML = `
<p>Dear {{candidateName}},</p>
<p>The check-in form has been successfully received and reviewed.</p>
<p>You have been selected to attend the <strong>Live Online Career Session</strong>, an exclusive and interactive presentation designed for individuals who are seriously evaluating a long-term professional opportunity.</p>
<p>This is not a pre-recorded webinar. The session will be hosted live by the CEO and Agency Owner, Alex Paz, providing a direct and transparent breakdown of the business, expectations, and the standards required to succeed within the organization.</p>
<p><strong><a href="{{zoomUrl}}" target="_blank" rel="noopener noreferrer">Zoom Link</a></strong></p>
<p>This session is intended for individuals who are:</p>
<ul>
<li>Ambitious and results-driven</li>
<li>Open to professional growth and development</li>
<li>Serious about exploring a leadership-oriented career path</li>
</ul>
<p><strong>What to Expect (25–30 minutes):</strong></p>
<ul>
<li>Company history and long-term vision</li>
<li>Marketing, branding, and client acquisition strategy</li>
<li>Compensation structure and performance expectations</li>
<li>Training, licensing, and professional standards</li>
<li>Expansion plans across Canada and leadership career path within the Globe Life AIL Division</li>
</ul>
<p><strong>Strict Session Standards &amp; Preparation:</strong><br/>
To maintain the integrity and professionalism of this process, all candidates are expected to:</p>
<ul>
<li>Join at least 5 minutes early (late entry will not be accommodated)</li>
<li>Be fully present for the entire session (25–30 minutes)</li>
<li>Have a notebook and pen ready for note-taking</li>
<li>Keep the camera on and remain in a distraction-free environment</li>
<li>Demonstrate professionalism, focus, and respect throughout</li>
</ul>
<p>This session is designed to provide clear facts, expectations, and the realities of the opportunity—so an informed career decision can be made.</p>
<p><strong>Next Steps:</strong><br/>
At the conclusion of the session, candidates who wish to proceed will complete a brief Leadership Assessment. Only those who meet the required standards will be invited to a final one-on-one hiring interview, where alignment, potential, and readiness for growth will be further evaluated.</p>
<p>This process is intentional. Those who are committed, coachable, and driven to grow will find this to be a significant opportunity.</p>
<p>Best regards,</p>
{{emailSignature}}
`.trim();

export function applyPostCheckinMerge(
  candidateName: string,
  zoomUrl: string,
  emailSignatureHtml: string
): string {
  return POST_CHECKIN_EMAIL_BODY_HTML.split('{{candidateName}}')
    .join(candidateName)
    .split('{{zoomUrl}}')
    .join(zoomUrl)
    .split('{{emailSignature}}')
    .join(emailSignatureHtml);
}
