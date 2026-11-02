// Forwards the calling-bot API to hm-public-webinar-schedule, which performs the real booking.
const DEFAULT_FUNCTION_BASE =
  'https://ofhcnsuwrhyvxtvtdunw.supabase.co/functions/v1/hm-public-webinar-schedule';

export function functionBase() {
  const explicit = String(process.env.PUBLIC_WEBINAR_FUNCTION_URL || '').replace(/\/$/, '');
  if (explicit) return explicit;
  const supabase = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(
    /\/$/,
    '',
  );
  if (supabase) return `${supabase}/functions/v1/hm-public-webinar-schedule`;
  return DEFAULT_FUNCTION_BASE;
}

function headerValue(value) {
  if (Array.isArray(value)) return value[0] || '';
  return typeof value === 'string' ? value : '';
}

export async function proxyWebinarBooking(req, res, path) {
  const expected = path === 'sessions' ? 'GET' : 'POST';
  if (req.method !== expected) {
    res.status(405).setHeader('Content-Type', 'application/json; charset=utf-8');
    res.send(JSON.stringify({ error: 'Method not allowed.' }));
    return;
  }

  const headers = { Accept: 'application/json' };
  const auth = headerValue(req.headers.authorization);
  const apiKey = headerValue(req.headers['x-api-key']);
  if (auth) headers.Authorization = auth;
  if (apiKey) headers['X-API-Key'] = apiKey;

  let body;
  if (path === 'registrations') {
    headers['Content-Type'] = 'application/json';
    if (typeof req.body === 'string') body = req.body;
    else body = JSON.stringify(req.body ?? {});
  }

  const mode = path === 'sessions' ? 'bot-sessions' : 'bot-register';
  let upstream;
  try {
    upstream = await fetch(`${functionBase()}/${path}?mode=${mode}`, {
      method: req.method,
      headers,
      body,
    });
  } catch {
    res.status(502).setHeader('Content-Type', 'application/json; charset=utf-8');
    res.send(JSON.stringify({ error: 'Booking service is unavailable.' }));
    return;
  }

  const text = await upstream.text();
  res.status(upstream.status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.send(text || JSON.stringify({ error: 'Empty response from booking service.' }));
}
