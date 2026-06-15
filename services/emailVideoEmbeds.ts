/**
 * Vimeo privacy links → email-safe watch button (no iframe — most clients block embeds).
 */

export type VimeoPrivacySpec = {
  videoId: string;
  /** Unlisted / private hash from the vimeo.com/ID/HASH URL */
  hash: string;
};

export function vimeoWatchPageUrl(spec: VimeoPrivacySpec): string {
  return `https://vimeo.com/${spec.videoId}/${spec.hash}`;
}

/** After check-in — invite to Live Online Career Session */
export const VIMEO_CHECKIN_LIVE_SESSION_INVITE: VimeoPrivacySpec = {
  videoId: '1191971908',
  hash: 'bb3c2436e2',
};

/** Session attended — Leadership Assessment (Talent Acquisition copy) */
export const VIMEO_STAGE3_ASSESSMENT_AFTER_ATTENDED: VimeoPrivacySpec = {
  videoId: '1191971952',
  hash: '4f1d10f9d9',
};

/** After career overview — ask for Leadership Assessment (alternate / CEO-style send) */
export const VIMEO_STAGE3_ASSESSMENT_POST_OVERVIEW: VimeoPrivacySpec = {
  videoId: '1191971913',
  hash: '465fc44238',
};

/** Missed live overview — reschedule (Calendly in body) */
export const VIMEO_MISSED_LIVE_SESSION_RESCHEDULE: VimeoPrivacySpec = {
  videoId: '1191971914',
  hash: '87db4b2a69',
};

/** Post–Leadership Assessment submission (candidate thank-you / next steps). */
export const VIMEO_POST_ASSESSMENT_SUBMIT_PLANNED: VimeoPrivacySpec = {
  videoId: '1191971907',
  hash: 'ede5e12aeb',
};

/** Email-safe CTA button that opens the Vimeo watch page. */
export function vimeoEmailWatchButton(spec: VimeoPrivacySpec, label = 'Watch video'): string {
  const page = vimeoWatchPageUrl(spec);
  const safeLabel = label.replace(/"/g, '&quot;');
  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0;font-family:Arial,Helvetica,sans-serif;">
  <tr>
    <td>
      <a href="${page}" target="_blank" rel="noopener noreferrer"
        style="display:inline-block;padding:12px 20px;background-color:#005EB8;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:bold;">
        ${safeLabel}
      </a>
    </td>
  </tr>
</table>
  `.trim();
}

/** One value-add sentence plus watch button (keeps existing copy unchanged around it). */
export function vimeoEmailValueAdd(spec: VimeoPrivacySpec, oneLiner: string, _title?: string): string {
  return `<p>${oneLiner}</p>\n${vimeoEmailWatchButton(spec)}`;
}
