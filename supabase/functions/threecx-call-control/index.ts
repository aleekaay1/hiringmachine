import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

type ActionPayload = {
  action?: string;
  extension?: string;
  destination?: string;
  callId?: string;
  targetExtension?: string;
  dtmfDigits?: string;
  metadata?: Record<string, unknown>;
};

type ThreeCxCall = {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: Record<string, unknown>;
  fallbackPath?: string;
};

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function normalizeBase(v: string): string {
  return v.replace(/\/$/, '');
}

async function getThreeCxToken(): Promise<string> {
  const tokenUrl = Deno.env.get('THREECX_TOKEN_URL')?.trim();
  const baseUrl = Deno.env.get('THREECX_BASE_URL')?.trim();
  const clientId = Deno.env.get('THREECX_CLIENT_ID')?.trim();
  const clientSecret = Deno.env.get('THREECX_CLIENT_SECRET')?.trim();
  if (!baseUrl || !clientId || !clientSecret) {
    throw new HttpError(500, '3CX credentials are missing (THREECX_BASE_URL / THREECX_CLIENT_ID / THREECX_CLIENT_SECRET)');
  }
  const oauthUrl = tokenUrl || `${normalizeBase(baseUrl)}/connect/token`;
  const payload = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetch(oauthUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: payload.toString(),
  });
  const raw = await res.text();
  const jsonBody = (() => {
    try {
      return JSON.parse(raw) as { access_token?: string; error?: string; error_description?: string };
    } catch {
      return {};
    }
  })();
  if (!res.ok || !jsonBody.access_token) {
    const reason = String(jsonBody.error_description || jsonBody.error || raw || `3CX token request failed (${res.status})`).slice(0, 500);
    throw new HttpError(res.status === 401 || res.status === 403 ? 401 : 502, `3CX token request failed (${res.status}): ${reason}`);
  }
  return jsonBody.access_token;
}

function buildActionCall(input: ActionPayload): ThreeCxCall {
  const action = String(input.action || '').trim().toLowerCase();
  const ext = String(input.extension || '').trim();
  const callId = String(input.callId || '').trim();
  const dest = String(input.destination || '').trim();
  const targetExt = String(input.targetExtension || '').trim();
  const digits = String(input.dtmfDigits || '').trim();
  const metadata = input.metadata || {};
  if (typeof metadata.path === 'string' && metadata.path) {
    const methodRaw = String(metadata.method || 'POST').toUpperCase();
    const method = (['GET', 'POST', 'PUT', 'DELETE'] as const).includes(methodRaw as never)
      ? methodRaw as ThreeCxCall['method']
      : 'POST';
    return {
      method,
      path: metadata.path,
      body: (metadata.body && typeof metadata.body === 'object') ? metadata.body as Record<string, unknown> : undefined,
    };
  }

  switch (action) {
    case 'health':
      return { method: 'GET', path: '/xapi/v1/SystemStatus', fallbackPath: '/callcontrol' };
    case 'dial':
      if (!ext || !dest) throw new HttpError(400, 'dial requires extension and destination');
      // callcontrol makecall expects timeout fields on many PBX setups; include both names for compatibility.
      // xapi will ignore this because this project falls back to callcontrol when xapi is unavailable.
      return {
        method: 'POST',
        path: `/xapi/v1/CallControl/${encodeURIComponent(ext)}/makecall`,
        fallbackPath: `/callcontrol/${encodeURIComponent(ext)}/makecall`,
        body: {
          destination: dest,
          timeout: 30,
          timeoutSec: 30,
        },
      };
    case 'hangup':
      if (!callId) throw new HttpError(400, 'hangup requires callId');
      return { method: 'POST', path: `/xapi/v1/CallControl/Calls/${encodeURIComponent(callId)}/hangup` };
    case 'hold':
      if (!callId) throw new HttpError(400, 'hold requires callId');
      return { method: 'POST', path: `/xapi/v1/CallControl/Calls/${encodeURIComponent(callId)}/hold` };
    case 'resume':
      if (!callId) throw new HttpError(400, 'resume requires callId');
      return { method: 'POST', path: `/xapi/v1/CallControl/Calls/${encodeURIComponent(callId)}/resume` };
    case 'mute':
      if (!callId) throw new HttpError(400, 'mute requires callId');
      return { method: 'POST', path: `/xapi/v1/CallControl/Calls/${encodeURIComponent(callId)}/mute` };
    case 'unmute':
      if (!callId) throw new HttpError(400, 'unmute requires callId');
      return { method: 'POST', path: `/xapi/v1/CallControl/Calls/${encodeURIComponent(callId)}/unmute` };
    case 'transfer':
      if (!callId || !targetExt) throw new HttpError(400, 'transfer requires callId and targetExtension');
      return { method: 'POST', path: `/xapi/v1/CallControl/Calls/${encodeURIComponent(callId)}/transfer`, body: { extension: targetExt } };
    case 'dtmf':
      if (!callId || !digits) throw new HttpError(400, 'dtmf requires callId and dtmfDigits');
      return { method: 'POST', path: `/xapi/v1/CallControl/Calls/${encodeURIComponent(callId)}/dtmf`, body: { digits } };
    case 'active_calls':
      if (!ext) throw new HttpError(400, 'active_calls requires extension');
      return {
        method: 'GET',
        path: `/xapi/v1/CallControl/${encodeURIComponent(ext)}/calls`,
        fallbackPath: `/callcontrol/${encodeURIComponent(ext)}/participants`,
      };
    case 'agent_state':
      if (!ext) throw new HttpError(400, 'agent_state requires extension');
      return { method: 'GET', path: `/xapi/v1/Extensions/${encodeURIComponent(ext)}` };
    default:
      throw new HttpError(400, `Unsupported action: ${action}`);
  }
}

async function callThreeCx(apiToken: string, call: ThreeCxCall): Promise<Record<string, unknown>> {
  const baseUrl = Deno.env.get('THREECX_BASE_URL')?.trim();
  if (!baseUrl) throw new HttpError(500, 'THREECX_BASE_URL is missing');
  const buildUrl = (path: string) => `${normalizeBase(baseUrl)}${path.startsWith('/') ? '' : '/'}${path}`;
  const runHttp = async (
    path: string,
    bodyOverride?: Record<string, unknown>,
    methodOverride?: ThreeCxCall['method'],
  ) => {
    const method = methodOverride ?? call.method;
    const effectiveBody = bodyOverride ?? call.body;
    return fetch(buildUrl(path), {
      method,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
      body: method === 'GET' || method === 'DELETE'
        ? undefined
        : (effectiveBody ? JSON.stringify(effectiveBody) : undefined),
    });
  };
  let attemptedPath = call.path;
  let res = await runHttp(call.path);
  if (res.status === 404 && call.fallbackPath) {
    console.warn('threecx primary path 404, retrying fallback path', { primary: call.path, fallback: call.fallbackPath });
    attemptedPath = call.fallbackPath;
    res = await runHttp(call.fallbackPath);
  }
  const collectDeviceIds = (input: unknown, out: Set<string>, depth = 0, includeGenericId = false): void => {
    if (!input || depth > 4) return;
    if (Array.isArray(input)) {
      for (const item of input) collectDeviceIds(item, out, depth + 1);
      return;
    }
    if (typeof input !== 'object') return;
    const obj = input as Record<string, unknown>;
    const directKeys = includeGenericId ? ['device_id', 'deviceid', 'deviceId', 'id'] : ['device_id', 'deviceid', 'deviceId'];
    for (const k of directKeys) {
      const raw = obj[k];
      const val = String(raw ?? '').trim();
      if (val) out.add(val);
    }
    for (const v of Object.values(obj)) {
      if (v && (Array.isArray(v) || typeof v === 'object')) collectDeviceIds(v, out, depth + 1, includeGenericId);
    }
  };

  const getJson = async (path: string): Promise<unknown> => {
    const r = await runHttp(path, undefined, 'GET');
    const t = await r.text();
    try {
      return JSON.parse(t) as unknown;
    } catch {
      return null;
    }
  };

  // Some 3CX setups are strict about makecall request schema.
  // If generic /callcontrol/{dn}/makecall returns 422, retry with common payload variants first.
  if (res.status === 422 && attemptedPath.match(/^\/callcontrol\/[^/]+\/makecall$/i)) {
    const baseDest = String(call.body?.destination ?? '').trim();
    if (baseDest) {
      const variants: Record<string, unknown>[] = [
        { destination: baseDest },
        { destination: baseDest, timeout: 30 },
        { destination: baseDest, timeoutSec: 30 },
      ];
      for (const variant of variants) {
        console.warn('threecx makecall 422, retrying with payload variant', { attemptedPath, variantKeys: Object.keys(variant) });
        res = await runHttp(attemptedPath, variant);
        if (res.ok) break;
      }
    }
  }

  // Some 3CX setups require device-scoped makecall endpoint.
  // If generic /callcontrol/{dn}/makecall still returns 422, discover device and retry.
  if (res.status === 422 && attemptedPath.match(/^\/callcontrol\/[^/]+\/makecall$/i)) {
    const dnMatch = attemptedPath.match(/^\/callcontrol\/([^/]+)\/makecall$/i);
    const dn = dnMatch?.[1] ? decodeURIComponent(dnMatch[1]) : '';
    if (dn) {
      const dnStatePath = `/callcontrol/${encodeURIComponent(dn)}`;
      const dnDevicesPath = `/callcontrol/${encodeURIComponent(dn)}/devices`;
      const allCallcontrolPath = '/callcontrol';
      const [dnStatePayload, dnDevicesPayload, allPayload] = await Promise.all([
        getJson(dnStatePath),
        getJson(dnDevicesPath),
        getJson(allCallcontrolPath),
      ]);
      const deviceCandidates = new Set<string>();
      // /devices is authoritative; allow generic "id" there as device id.
      collectDeviceIds(dnDevicesPayload, deviceCandidates, 0, true);
      collectDeviceIds(dnStatePayload, deviceCandidates);
      if (Array.isArray(allPayload)) {
        const dnEntry = allPayload.find((x) => {
          if (!x || typeof x !== 'object') return false;
          const obj = x as Record<string, unknown>;
          return String(obj.dn ?? '').trim() === dn;
        });
        collectDeviceIds(dnEntry, deviceCandidates);
      }

      let retried = false;
      for (const deviceId of deviceCandidates) {
        const deviceMakecallPath = `/callcontrol/${encodeURIComponent(dn)}/devices/${encodeURIComponent(deviceId)}/makecall`;
        console.warn('threecx makecall 422, retrying device endpoint', { dn, deviceId, deviceMakecallPath });
        attemptedPath = deviceMakecallPath;
        const baseDest = String(call.body?.destination ?? '').trim();
        const variants: Record<string, unknown>[] = baseDest
          ? [
            { destination: baseDest, timeoutSec: 30 },
            { destination: baseDest, timeout: 30 },
            { destination: baseDest },
          ]
          : [call.body ?? {}];
        for (const variant of variants) {
          res = await runHttp(deviceMakecallPath, variant);
          retried = true;
          if (res.ok) break;
        }
        retried = true;
        if (res.ok) break;
      }

      if (!retried) {
        console.warn('threecx makecall 422 and no device id found', {
          dn,
          dnStatePath,
          dnDevicesPath,
          allCallcontrolPath,
          candidateCount: deviceCandidates.size,
        });
      }
    }
  }
  const raw = await res.text();
  const payload = (() => {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  })();
  if (!res.ok) {
    const upstreamMessage = String(payload.error || payload.message || raw || `3CX API failed (${res.status})`).slice(0, 600);
    throw new HttpError(res.status === 401 || res.status === 403 ? 401 : 502, `3CX API failed (${res.status}) at ${attemptedPath}: ${upstreamMessage}`);
  }
  return payload;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return json(401, { error: 'Unauthorized' });

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: authData, error: authErr } = await supabase.auth.getUser();
    if (authErr || !authData.user) return json(401, { error: 'Invalid or expired session' });

    const body = (await req.json().catch(() => ({}))) as ActionPayload;
    const actionCall = buildActionCall(body);
    console.log('threecx action request', {
      action: body.action,
      method: actionCall.method,
      path: actionCall.path,
      extension: body.extension || null,
    });
    const token = await getThreeCxToken();
    const data = await callThreeCx(token, actionCall);
    return json(200, {
      ok: true,
      action: body.action || 'custom',
      endpoint: actionCall.path,
      method: actionCall.method,
      data,
    });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : String(error);
    console.error('threecx-call-control failed', { status, message });
    return json(status, { error: message });
  }
});
