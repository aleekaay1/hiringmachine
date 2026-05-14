/**
 * Post check-in email (Live Online Career Session). Used by admin templates + send-candidate-email Edge Function.
 * Sync: supabase/functions/_shared/postCheckinEmailTemplate.ts
 * Placeholders: {{firstName}}, {{Date}}, {{Time}}, {{zoomUrl}}, {{emailSignature}}
 * Edge: override date/time via PUBLIC_LIVE_SESSION_DISPLAY_DATE / PUBLIC_LIVE_SESSION_DISPLAY_TIME
 */

export const POST_CHECKIN_EMAIL_SUBJECT =
  "Live Online Career Session – you're invited | Globe Life AIL · Paz Organization";

export const POST_CHECKIN_EMAIL_BODY_HTML = `
<p>Hi {{firstName}},</p>
<p>Your check-in form has been received and reviewed.</p>
<p>You’ve been selected to attend our <strong>Live Online Career Session</strong> hosted by Alex Paz.</p>
<p><strong>Session Details:</strong><br/>
📅 {{Date}}<br/>
⏰ {{Time}}<br/>
📍 <a href="{{zoomUrl}}" target="_blank" rel="noopener noreferrer">{{zoomUrl}}</a></p>
<p>Please join at least 5 minutes early, have your camera on, and be prepared to take notes in a distraction-free environment.</p>
<p>This is a live interactive session and late entries will not be accommodated.</p>
<p>We look forward to meeting you.</p>
<p>Best regards,</p>
{{emailSignature}}
`.trim();

export type PostCheckinMergeParams = {
  firstName: string;
  sessionDate: string;
  sessionTime: string;
  zoomUrl: string;
  emailSignatureHtml: string;
};

export function applyPostCheckinMerge(p: PostCheckinMergeParams): string {
  return POST_CHECKIN_EMAIL_BODY_HTML.split('{{firstName}}')
    .join(p.firstName)
    .split('{{Date}}')
    .join(p.sessionDate)
    .split('{{Time}}')
    .join(p.sessionTime)
    .split('{{zoomUrl}}')
    .join(p.zoomUrl)
    .split('{{emailSignature}}')
    .join(p.emailSignatureHtml);
}
