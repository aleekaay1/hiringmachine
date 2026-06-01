/**
 * Shared Alex Paz / Paz Organization intro copy (order per leadership request).
 * Sync: supabase/functions/_shared/pazOrganizationIntroEmail.ts
 */

export const PAZ_ORG_WEBSITE_URL = 'https://globelife-paz.com';

export const PAZ_ORG_WESTERN_CANADA_EXPANSION_URL =
  'https://drive.google.com/file/d/11WdKfamJRWLuqNmg3fC1xs2-jwF3guz9/view?usp=sharing';

/** Agency Owner / mission first, then tenure — do not reverse. */
export const ALEX_PAZ_ORG_INTRO_PARAGRAPHS_HTML = `
<p>Alex Paz is the Agency Owner and CEO of the Paz Organization (<a href="${PAZ_ORG_WEBSITE_URL}" target="_blank" rel="noopener noreferrer">${PAZ_ORG_WEBSITE_URL}</a>). Our Mission is to become the largest and finest life insurance agency in Canada. Most recently we have received approval to expand into Western Canada (<a href="${PAZ_ORG_WESTERN_CANADA_EXPANSION_URL}" target="_blank" rel="noopener noreferrer">expansion overview</a>) and currently seek individuals for both Client Centric Roles as well as Sales Leaders.</p>
<p>Alex Paz started with Globe Life AIL Division over 23 years ago and is the longest serving Agency Owner in all of Canada inside the AIL Division of Globe Life.</p>
`.trim();
