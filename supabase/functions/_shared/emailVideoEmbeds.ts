/**
 * Vimeo privacy links → email-safe embeds (sync with services/emailVideoEmbeds.ts).
 */

export type VimeoPrivacySpec = {
  videoId: string;
  hash: string;
};

export function vimeoWatchPageUrl(spec: VimeoPrivacySpec): string {
  return `https://vimeo.com/${spec.videoId}/${spec.hash}`;
}

export function vimeoPlayerSrc(spec: VimeoPrivacySpec): string {
  return `https://player.vimeo.com/video/${spec.videoId}?h=${spec.hash}`;
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

export function vimeoEmailEmbedTable(spec: VimeoPrivacySpec, title: string): string {
  const src = vimeoPlayerSrc(spec);
  const page = vimeoWatchPageUrl(spec);
  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;margin:20px 0;font-family:Arial,Helvetica,sans-serif;">
  <tr>
    <td style="padding:0;border-radius:8px;overflow:hidden;background:#000;">
      <div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;">
        <iframe title="${title.replace(/"/g, '&quot;')}" src="${src}"
          style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;"
          allow="autoplay; fullscreen; picture-in-picture"
          allowfullscreen></iframe>
      </div>
    </td>
  </tr>
  <tr>
    <td style="padding:8px 0 0;font-size:12px;color:#4b5563;line-height:1.5;">
      If the video does not appear, <a href="${page}" target="_blank" rel="noopener noreferrer" style="color:#005EB8;">open it on Vimeo</a>.
    </td>
  </tr>
</table>
  `.trim();
}
