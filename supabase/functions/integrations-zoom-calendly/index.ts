/**
 * Aggregates Zoom meeting + participant data; optionally Calendly invitees when CALENDLY_API_TOKEN is set.
 * Zoom-only: omit CALENDLY_API_TOKEN — Calendly fields will be empty / null.
 * Auth: Supabase JWT (same as send-email).
 * Deploy: supabase functions deploy integrations-zoom-calendly
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
};

const ZOOM_API = 'https://api.zoom.us/v2';
const CALENDLY_API = 'https://api.calendly.com';

type ZoomTokenResponse = { access_token: string; expires_in: number };

async function getZoomAccessToken(): Promise<string> {
  const accountId = Deno.env.get('ZOOM_ACCOUNT_ID')?.trim();
  const clientId = Deno.env.get('ZOOM_CLIENT_ID')?.trim();
  const clientSecret = Deno.env.get('ZOOM_CLIENT_SECRET')?.trim();
  if (!accountId || !clientId || !clientSecret) {
    throw new Error(
      'Missing Zoom Server-to-Server OAuth: set ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET in Edge Function secrets',
    );
  }
  const basic = btoa(`${clientId}:${clientSecret}`);
  const res = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    },
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Zoom OAuth failed: ${res.status} ${t}`);
  }
  const j = (await res.json()) as ZoomTokenResponse;
  return j.access_token;
}

/** Zoom requires double-encoding the meeting UUID in the path for report endpoints. */
function encodeZoomMeetingUuid(uuid: string): string {
  return encodeURIComponent(encodeURIComponent(uuid));
}

async function zoomGet(token: string, path: string): Promise<unknown> {
  const res = await fetch(`${ZOOM_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Zoom API ${path}: ${res.status} ${t}`);
  }
  return res.json();
}

/** Zoom allows userId as the user’s id or email in GET /users/{userId}. */
async function zoomGetUserIdByEmail(token: string, email: string): Promise<string> {
  const enc = encodeURIComponent(email);
  const j = (await zoomGet(token, `/users/${enc}`)) as { id?: string };
  const id = j.id;
  if (!id) throw new Error(`Zoom user not found for email: ${email}`);
  return id;
}

async function zoomListPastMeetings(
  token: string,
  userId: string,
  maxPages = 5,
): Promise<Array<Record<string, unknown>>> {
  const all: Array<Record<string, unknown>> = [];
  let next: string | null =
    `/users/${encodeURIComponent(userId)}/meetings?type=past&page_size=30`;
  let pages = 0;
  while (next && pages < maxPages) {
    const res = await fetch(`${ZOOM_API}${next}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Zoom list meetings: ${res.status} ${t}`);
    }
    const j = (await res.json()) as {
      meetings?: Array<Record<string, unknown>>;
      next_page_token?: string;
    };
    for (const m of j.meetings || []) all.push(m);
    if (j.next_page_token) {
      next = `/users/${encodeURIComponent(userId)}/meetings?type=past&page_size=30&next_page_token=${encodeURIComponent(j.next_page_token)}`;
    } else {
      next = null;
    }
    pages++;
  }
  return all;
}

async function zoomListUpcomingMeetings(
  token: string,
  userId: string,
): Promise<Array<Record<string, unknown>>> {
  const j = (await zoomGet(
    token,
    `/users/${encodeURIComponent(userId)}/meetings?type=upcoming&page_size=50`,
  )) as { meetings?: Array<Record<string, unknown>> };
  return j.meetings || [];
}

async function zoomMeetingParticipants(
  token: string,
  meetingUuid: string,
): Promise<Array<{ name?: string; user_email?: string; join_time?: string; leave_time?: string }>> {
  const path = `/report/meetings/${encodeZoomMeetingUuid(meetingUuid)}/participants?page_size=300`;
  const res = await fetch(`${ZOOM_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const t = await res.text();
    console.warn('Zoom participants failed', meetingUuid, res.status, t);
    return [];
  }
  const j = (await res.json()) as {
    participants?: Array<{
      name?: string;
      user_email?: string;
      join_time?: string;
      leave_time?: string;
    }>;
  };
  return j.participants || [];
}

async function calendlyGet(token: string, path: string): Promise<unknown> {
  const res = await fetch(`${CALENDLY_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Calendly API ${path}: ${res.status} ${t}`);
  }
  return res.json();
}

function normalizeEmail(e: string | undefined): string {
  return (e || '').trim().toLowerCase();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Invalid or expired session' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const calendlyToken = Deno.env.get('CALENDLY_API_TOKEN')?.trim();
    const zoomHostEmail = Deno.env.get('ZOOM_HOST_USER_EMAIL')?.trim();
    const calendlyEnabled = !!calendlyToken;

    if (!zoomHostEmail) {
      return new Response(
        JSON.stringify({
          error: 'Missing ZOOM_HOST_USER_EMAIL',
          hint: 'Set the Zoom login email for the user whose meetings you want to list.',
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const zoomToken = await getZoomAccessToken();
    const zoomUserId = await zoomGetUserIdByEmail(zoomToken, zoomHostEmail);

    const [pastMeetings, scheduledMeetings] = await Promise.all([
      zoomListPastMeetings(zoomToken, zoomUserId),
      zoomListUpcomingMeetings(zoomToken, zoomUserId),
    ]);

    type CalEvent = {
      uri?: string;
      name?: string;
      start_time?: string;
      end_time?: string;
      status?: string;
      location?: { type?: string; join_url?: string; data?: { id?: string } };
    };

    let calEvents: CalEvent[] = [];
    let calUser: { resource?: { uri?: string; name?: string; email?: string } } = {};

    const calInviteesCache = new Map<
      string,
      Array<{ email: string; name: string; status: string; no_show?: boolean }>
    >();

    async function loadInvitees(eventUri: string, token: string) {
      if (calInviteesCache.has(eventUri)) return calInviteesCache.get(eventUri)!;
      const uuid = eventUri.replace(/\/$/, '').split('/').pop() || '';
      const inv = (await calendlyGet(
        token,
        `/scheduled_events/${encodeURIComponent(uuid)}/invitees?count=100`,
      )) as {
        collection?: Array<{
          email?: string;
          name?: string;
          status?: string;
          no_show?: boolean;
        }>;
      };
      const list = (inv.collection || []).map((r) => ({
        email: normalizeEmail(r.email),
        name: (r.name || '').trim(),
        status: (r.status || '').trim(),
        no_show: !!r.no_show,
      }));
      calInviteesCache.set(eventUri, list);
      return list;
    }

    if (calendlyEnabled && calendlyToken) {
      calUser = (await calendlyGet(calendlyToken, '/users/me')) as typeof calUser;
      const calUserUri = calUser.resource?.uri;
      if (!calUserUri) {
        throw new Error('Calendly /users/me did not return resource.uri');
      }

      const now = new Date();
      const minStart = new Date(now);
      minStart.setDate(minStart.getDate() - 120);
      const maxStart = new Date(now);
      maxStart.setDate(maxStart.getDate() + 60);

      const calEventsUrl =
        `/scheduled_events?user=${encodeURIComponent(calUserUri)}` +
        `&min_start_time=${encodeURIComponent(minStart.toISOString())}` +
        `&max_start_time=${encodeURIComponent(maxStart.toISOString())}` +
        `&count=100`;

      const calEventsRes = (await calendlyGet(calendlyToken, calEventsUrl)) as {
        collection?: CalEvent[];
      };
      calEvents = calEventsRes.collection || [];

      for (const ev of calEvents) {
        if (ev.uri) await loadInvitees(ev.uri, calendlyToken);
      }
    }

    function findMatchingCalendly(zoomStart: string): CalEvent | null {
      let best: CalEvent | null = null;
      let bestDelta = Infinity;
      for (const ev of calEvents) {
        const st = ev.start_time;
        if (!st) continue;
        const d = Math.abs(new Date(st).getTime() - new Date(zoomStart).getTime());
        if (d < bestDelta && d <= 10 * 60 * 1000) {
          bestDelta = d;
          best = ev;
        }
      }
      return best;
    }

    const combinedPast = await Promise.all(
      pastMeetings.map(async (m) => {
        const uuid = String(m.uuid || '');
        const topic = String(m.topic || '');
        const start = String(m.start_time || '');
        const duration = Number(m.duration || 0);
        const host = String((m as { host_email?: string }).host_email || zoomHostEmail);
        const participants = uuid ? await zoomMeetingParticipants(zoomToken, uuid) : [];
        const participantEmails = new Set(
          participants.map((p) => normalizeEmail(p.user_email)).filter(Boolean),
        );

        const calMatch = calendlyEnabled && start ? findMatchingCalendly(start) : null;
        let invitees: Array<{ email: string; name: string; status: string; no_show: boolean }> = [];
        if (calendlyEnabled && calMatch?.uri && calendlyToken) {
          invitees = await loadInvitees(calMatch.uri, calendlyToken);
        }

        const invitedActive = invitees.filter((i) => i.status !== 'canceled');
        const attendedFromCalendly = invitedActive.filter((i) => participantEmails.has(i.email));
        const notInZoom = invitedActive.filter((i) => !participantEmails.has(i.email));
        const zoomOnly = [...participantEmails].filter(
          (e) => !invitedActive.some((i) => i.email === e),
        );

        return {
          source: 'past' as const,
          zoom: {
            uuid,
            topic,
            start_time: start,
            duration_minutes: duration,
            host_email: host,
            meeting_id: m.id,
          },
          calendly: calMatch
            ? {
                name: calMatch.name,
                start_time: calMatch.start_time,
                end_time: calMatch.end_time,
                status: calMatch.status,
                uri: calMatch.uri,
              }
            : null,
          participants: participants.map((p) => ({
            name: p.name,
            email: normalizeEmail(p.user_email),
            join_time: p.join_time,
            leave_time: p.leave_time,
          })),
          invitees: invitedActive.map((i) => ({
            email: i.email,
            name: i.name,
            status: i.status,
            no_show: i.no_show,
            attended_zoom: participantEmails.has(i.email),
          })),
          stats: {
            invited_count: invitedActive.length,
            attended_matched_count: attendedFromCalendly.length,
            no_show_or_absent_count: notInZoom.length,
            zoom_participant_count: participants.length,
            zoom_only_emails: zoomOnly,
          },
        };
      }),
    );

    const upcomingRows = scheduledMeetings.map((m) => {
      const start = String(m.start_time || '');
      const calMatch = calendlyEnabled && start ? findMatchingCalendly(start) : null;
      return {
        source: 'scheduled' as const,
        zoom: {
          uuid: String(m.uuid || ''),
          topic: String(m.topic || ''),
          start_time: start,
          duration_minutes: Number(m.duration || 0),
          host_email: String((m as { host_email?: string }).host_email || zoomHostEmail),
          join_url: String((m as { join_url?: string }).join_url || ''),
          meeting_id: m.id,
        },
        calendly: calMatch
          ? {
              name: calMatch.name,
              start_time: calMatch.start_time,
              end_time: calMatch.end_time,
              status: calMatch.status,
              uri: calMatch.uri,
            }
          : null,
      };
    });

    return new Response(
      JSON.stringify({
        ok: true,
        generated_at: new Date().toISOString(),
        calendly_configured: calendlyEnabled,
        zoom_user: { id: zoomUserId, email: zoomHostEmail },
        calendly_user: calendlyEnabled
          ? {
              name: calUser.resource?.name,
              email: calUser.resource?.email,
            }
          : null,
        past_meetings: combinedPast.sort(
          (a, b) =>
            new Date(b.zoom.start_time).getTime() - new Date(a.zoom.start_time).getTime(),
        ),
        upcoming_meetings: upcomingRows.sort(
          (a, b) =>
            new Date(a.zoom.start_time).getTime() - new Date(b.zoom.start_time).getTime(),
        ),
        calendly_events_in_range: calEvents.length,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    console.error('integrations-zoom-calendly', e);
    return new Response(
      JSON.stringify({
        error: e instanceof Error ? e.message : 'Integration error',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
