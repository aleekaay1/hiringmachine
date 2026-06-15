/**
 * Vimeo privacy links → email-safe watch button (sync with services/emailVideoEmbeds.ts).
 */

export type VimeoPrivacySpec = {
  videoId: string;
  hash: string;
};

export function vimeoWatchPageUrl(spec: VimeoPrivacySpec): string {
  return `https://vimeo.com/${spec.videoId}/${spec.hash}`;
}

export const VIMEO_CHECKIN_LIVE_SESSION_INVITE: VimeoPrivacySpec = {
  videoId: '1191971908',
  hash: 'bb3c2436e2',
};

export const VIMEO_STAGE3_ASSESSMENT_AFTER_ATTENDED: VimeoPrivacySpec = {
  videoId: '1191971952',
  hash: '4f1d10f9d9',
};

export const VIMEO_STAGE3_ASSESSMENT_POST_OVERVIEW: VimeoPrivacySpec = {
  videoId: '1191971913',
  hash: '465fc44238',
};

export const VIMEO_MISSED_LIVE_SESSION_RESCHEDULE: VimeoPrivacySpec = {
  videoId: '1191971914',
  hash: '87db4b2a69',
};

export const VIMEO_POST_ASSESSMENT_SUBMIT_PLANNED: VimeoPrivacySpec = {
  videoId: '1191971907',
  hash: 'ede5e12aeb',
};

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

export function vimeoEmailValueAdd(spec: VimeoPrivacySpec, oneLiner: string, _title?: string): string {
  return `<p>${oneLiner}</p>\n${vimeoEmailWatchButton(spec)}`;
}
