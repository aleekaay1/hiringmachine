/** Zoom Server-to-Server OAuth token for Edge Functions. */

export async function getZoomServerToken(): Promise<string> {
  const accountId = Deno.env.get('ZOOM_ACCOUNT_ID')?.trim();
  const clientId = Deno.env.get('ZOOM_CLIENT_ID')?.trim();
  const clientSecret = Deno.env.get('ZOOM_CLIENT_SECRET')?.trim();
  if (!accountId || !clientId || !clientSecret) {
    throw new Error('Missing Zoom Server-to-Server OAuth secrets (ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET)');
  }
  const res = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    },
  );
  if (!res.ok) throw new Error(`Zoom OAuth failed: ${res.status} ${await res.text()}`);
  return String(((await res.json()) as { access_token?: string }).access_token || '');
}

export const ZOOM_API_BASE = 'https://api.zoom.us/v2';

export async function zoomApiGet(token: string, path: string): Promise<unknown> {
  const res = await fetch(`${ZOOM_API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Zoom GET ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}
