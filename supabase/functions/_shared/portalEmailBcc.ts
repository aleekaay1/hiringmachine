/** Blind-copy of every outbound portal email so staff can confirm send and review copy. */
export const PORTAL_EMAIL_BCC = 'pazhiringmachine@gmail.com';

export function mergePortalBcc(existing?: string | string[] | null): string[] {
  const list = (Array.isArray(existing) ? existing : existing ? [existing] : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const hasMonitor = list.some((value) => value.toLowerCase() === PORTAL_EMAIL_BCC);
  if (!hasMonitor) list.push(PORTAL_EMAIL_BCC);
  return list;
}
