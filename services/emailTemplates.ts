import { buildEmailSignatureHtml } from './emailSignatureHtml';
import {
  buildAddToCalendarEmailHtml,
  buildGoogleCalendarUrl,
  resolveLiveSessionCalendar,
  type LiveSessionOccurrenceRecord,
} from './calendarInvite';
import { ALEX_PAZ_ORG_INTRO_PARAGRAPHS_HTML } from './pazOrganizationIntroEmail';
import { POST_CHECKIN_EMAIL_SUBJECT, POST_CHECKIN_EMAIL_BODY_HTML } from './postCheckinEmailTemplate';
import {
  DEFAULT_ASSESSMENT_LOOKUP_URL,
  LIVE_SESSION_RESCHEDULE_CALENDLY_URL,
  ZOOM_MEETING_URL,
} from './hiringUrls';

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
 * Optional Vimeo variants for later: `emailVideoEmbeds.ts`, `candidateEmailVimeoPlan.ts` (not merged into live bodies).
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
    name: 'Leadership assessment (after session attended)',
    hint: 'Primary: session attended → assessment link.',
    subject: 'Your Leadership Assessment – next step',
    bodyHtml: `
<p>Hi {{firstName}},</p>
<p>Thank you for attending today’s Live Online Career Session.</p>
<p>The next step in the process is to complete the <strong>Leadership &amp; Career Assessment</strong> using the link below:</p>
<p><strong>{{Assessment Link}}</strong></p>
<p>This assessment is designed to help us evaluate overall fit, mindset, professionalism, and leadership potential within our performance-driven environment.</p>
<p>Please complete it in one sitting and answer thoughtfully and honestly.</p>
<p>We look forward to reviewing your submission.</p>
<p>Best regards,</p>
{{emailSignature}}
    `.trim(),
  },
  {
    id: 'stage3_assessment_link_post_overview',
    name: 'Leadership assessment (post overview)',
    hint: 'Alternate after career overview session.',
    subject: 'Your next step: Leadership Assessment',
    bodyHtml: `
<p>Hi {{firstName}},</p>
<p>Thank you for attending our live online career session.</p>
${ALEX_PAZ_ORG_INTRO_PARAGRAPHS_HTML}
<p>Your next step is to complete the <strong>Leadership &amp; Career Assessment</strong> using the link below:</p>
<p><strong>{{Assessment Link}}</strong></p>
<p>We are currently moving forward with candidates who demonstrate responsiveness, professionalism, and consistency throughout the process.</p>
<p>Please complete the assessment as soon as possible to remain under consideration.</p>
<p>Best regards,</p>
{{emailSignature}}
    `.trim(),
  },
  {
    id: 'missed_live_session_reschedule',
    name: 'Missed live session – reschedule (one-time)',
    hint: 'Did not attend live overview; Calendly reschedule.',
    subject: 'One-time opportunity to reschedule your Live Online Career Session',
    bodyHtml: `
<p>Hi {{firstName}},</p>
<p>We noticed you were unable to attend the live career session today.</p>
<p>Because we saw potential in your initial application, we are extending a one-time opportunity to reschedule your session.</p>
<p>Please use the link below to select a new session time:</p>
<p><strong><a href="{{calendlyRescheduleUrl}}" target="_blank" rel="noopener noreferrer">{{calendlyRescheduleUrl}}</a></strong></p>
<p>Please note that punctuality, focus, and responsiveness are important standards within our organization.</p>
<p>We look forward to seeing you there.</p>
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

export type CrmEmailTemplateId = (typeof EMAIL_TEMPLATES)[number]['id'];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeZoomUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';

  // If a user pastes full anchor HTML, prefer its href.
  const hrefMatch = trimmed.match(/href\s*=\s*["']?([^"'\s>]+)/i);
  let candidate = hrefMatch?.[1] ?? trimmed;
  candidate = candidate.replace(/^["'\s]+|["'\s]+$/g, '');

  // Drop leaked attributes accidentally pasted into the URL field.
  const attrLeakStart = candidate.search(/[\s"'<>]/);
  if (attrLeakStart >= 0) {
    candidate = candidate.slice(0, attrLeakStart);
  }

  if (!candidate) return '';
  if (!/^https?:\/\//i.test(candidate)) return '';

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function renderZoomAnchor(url: string): string {
  if (!url) return '';
  const escaped = escapeHtml(url);
  return `<a href="${escaped}" target="_blank" rel="noopener noreferrer">${escaped}</a>`;
}

function replaceZoomLinkToken(bodyHtml: string, zoomUrl: string): string {
  if (!bodyHtml.includes('{{Zoom Link}}')) return bodyHtml;
  if (!zoomUrl) return bodyHtml.split('{{Zoom Link}}').join('');

  const anchor = renderZoomAnchor(zoomUrl);

  // If token appears in href, replace with plain URL first.
  let body = bodyHtml.replace(/href=(["'])\s*\{\{Zoom Link\}\}\s*\1/gi, `href="${escapeHtml(zoomUrl)}"`);

  // Any remaining token occurrences should become clickable anchors.
  body = body.split('{{Zoom Link}}').join(anchor);
  return body;
}

function linkifyPlainZoomUrl(bodyHtml: string, zoomUrl: string): string {
  if (!zoomUrl || !bodyHtml.includes(zoomUrl)) return bodyHtml;

  const anchor = renderZoomAnchor(zoomUrl);
  const zoomPattern = new RegExp(escapeRegExp(zoomUrl), 'g');
  const tokens = bodyHtml.split(/(<[^>]+>)/g);
  let insideAnchor = false;

  return tokens
    .map((token) => {
      if (token.startsWith('<')) {
        if (/^<a\b/i.test(token)) insideAnchor = true;
        if (/^<\/a\b/i.test(token)) insideAnchor = false;
        return token;
      }
      if (insideAnchor) return token;
      return token.replace(zoomPattern, anchor);
    })
    .join('');
}

/**
 * Stage 4 – sent after Leadership Assessment submission (automation only; not a manual button).
 * Sync HTML/subject with supabase/functions/_shared/postAssessmentSubmitEmailTemplate.ts (Edge Function).
 */
export const POST_ASSESSMENT_SUBMIT_TEMPLATE: EmailTemplate = {
  id: 'stage4_assessment_received',
  name: 'Stage 4 – Assessment received (automation)',
  hint: 'Thank you; we received results—no score disclosed.',
  subject: 'Thank you for completing the Leadership & Career Assessment',
  bodyHtml: `
<p>Dear {{candidateName}},</p>
<p>Thank you for completing the Leadership &amp; Career Assessment.</p>
<p>Your responses have been successfully received and recorded. This assessment generates an internal score that serves as one component of the overall evaluation process. Individual scores are not distributed; however, confirmation has been logged that this step has been completed.</p>
<p>The submitted assessment will be reviewed alongside the rest of your profile by the CEO and members of the Leadership Team. As part of this process, consideration is given to alignment with organizational standards, mindset, and long-term leadership potential.</p>
<p>The organization continues to prioritize attitude, coachability, and consistency as key indicators of success. Many of the top-performing individuals within the organization began without prior industry experience, reinforcing the focus on personal drive and the ability to develop through training.</p>
<p>Should your profile meet the required standards, a separate communication will be issued with next steps, including details regarding the final stage of the hiring process.</p>
<p>Appreciation is extended for the time and effort invested in completing this step. Further updates will be provided as the review process progresses.</p>
<p>Best regards,</p>
{{emailSignature}}
  `.trim(),
};

function postCheckinAddToCalendarHtmlForPreview(occurrence?: LiveSessionOccurrenceRecord | null): string {
  const event = resolveLiveSessionCalendar(
    {
      PUBLIC_LIVE_SESSION_START_ISO: (import.meta.env.VITE_PUBLIC_LIVE_SESSION_START_ISO as string | undefined)?.trim(),
      PUBLIC_LIVE_SESSION_END_ISO: (import.meta.env.VITE_PUBLIC_LIVE_SESSION_END_ISO as string | undefined)?.trim(),
    },
    ZOOM_MEETING_URL,
    occurrence ?? null,
  );
  return buildAddToCalendarEmailHtml({ primaryUrl: buildGoogleCalendarUrl(event) });
}

function postCheckinSessionLabelsForPreview(occurrence?: LiveSessionOccurrenceRecord | null): { date: string; time: string } {
  const resolved = resolveLiveSessionCalendar({}, ZOOM_MEETING_URL, occurrence ?? null);
  return { date: resolved.displayDate, time: resolved.displayTime };
}

export function mergeTemplate(
  subject: string,
  bodyHtml: string,
  candidate: { firstName: string; lastName: string; email: string; phone: string },
  extras?: Record<string, string>,
  options?: { siteOrigin?: string; liveSessionOccurrence?: LiveSessionOccurrenceRecord | null }
): { subject: string; bodyHtml: string } {
  const candidateName = `${candidate.firstName || ''} ${candidate.lastName || ''}`.trim();
  const sessionLabels = postCheckinSessionLabelsForPreview(options?.liveSessionOccurrence);
  const map: Record<string, string> = {
    '{{firstName}}': candidate.firstName || '',
    '{{lastName}}': candidate.lastName || '',
    '{{email}}': candidate.email || '',
    '{{phone}}': candidate.phone || '',
    '{{candidateName}}': candidateName,
    '{{zoomUrl}}': ZOOM_MEETING_URL,
    '{{assessmentLookupUrl}}': DEFAULT_ASSESSMENT_LOOKUP_URL,
    '{{Date}}': sessionLabels.date,
    '{{Time}}': sessionLabels.time,
    '{{sessionDate}}': sessionLabels.date,
    '{{sessionTime}}': sessionLabels.time,
    '{{calendlyRescheduleUrl}}': LIVE_SESSION_RESCHEDULE_CALENDLY_URL,
    '{{addToCalendarHtml}}': postCheckinAddToCalendarHtmlForPreview(options?.liveSessionOccurrence),
    ...(extras || {}),
  };
  const signature = buildEmailSignatureHtml(options?.siteOrigin);
  map['{{emailSignature}}'] = signature;

  const assessUrl = map['{{assessmentLookupUrl}}'] || '';
  const zoomUrlVal = normalizeZoomUrl(map['{{zoomUrl}}'] || '');
  map['{{zoomUrl}}'] = zoomUrlVal;
  map['{{First Name}}'] = map['{{firstName}}'];
  map['{{Assessment Link}}'] = assessUrl
    ? `<a href="${assessUrl}" target="_blank" rel="noopener noreferrer">${assessUrl}</a>`
    : '';
  map['{{Zoom Link}}'] = zoomUrlVal;

  let sub = subject;
  let body = replaceZoomLinkToken(bodyHtml, zoomUrlVal);
  for (const [key, value] of Object.entries(map)) {
    sub = sub.split(key).join(value);
    body = body.split(key).join(value);
  }
  body = linkifyPlainZoomUrl(body, zoomUrlVal);
  return { subject: sub, bodyHtml: body };
}
