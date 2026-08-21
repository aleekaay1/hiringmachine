import { supabase } from './supabaseClient';
import { getCandidateById, saveCandidate } from './storageService';
import { DEFAULT_ADMIN_DATA, type Candidate } from '../types';

const AO_HUB_URL =
  (import.meta.env.VITE_AO_INTERVIEW_HUB_URL as string | undefined)?.trim() ||
  'https://www.aointerview.com/apply/chris-hintz';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const LIST_COLUMNS =
  'id, first_name, last_name, email, phone, city, timestamp, status, admin_data, applicant_questionnaire';

export type CheckInRow = Candidate & {
  aoHubInviteSentAt: string | null;
  currentRole: string;
};

function asCheckInRow(c: Candidate): CheckInRow {
  const ao =
    typeof c.adminData?.aoHubInviteSentAt === 'string' ? c.adminData.aoHubInviteSentAt : null;
  const role = String(c.applicantQuestionnaire?.currentRole || '').trim();
  return { ...c, aoHubInviteSentAt: ao, currentRole: role };
}

/** Recent Instantly / public check-ins for the staff list. */
export async function listCheckInEntries(limit = 500): Promise<CheckInRow[]> {
  const { data, error } = await supabase
    .from('candidates')
    .select(LIST_COLUMNS)
    .order('timestamp', { ascending: false })
    .limit(limit);
  if (error) throw error;

  const rows = (data || []).map((row) => {
    // storageService fromRow is not exported; map lightly then hydrate via get path if needed
    const admin = (row as { admin_data?: Record<string, unknown> }).admin_data || {};
    const q = (row as { applicant_questionnaire?: Record<string, unknown> }).applicant_questionnaire || {};
    const candidate: Candidate = {
      id: String((row as { id: string }).id),
      firstName: String((row as { first_name?: string }).first_name || ''),
      lastName: String((row as { last_name?: string }).last_name || ''),
      email: String((row as { email?: string }).email || ''),
      phone: String((row as { phone?: string }).phone || ''),
      city: String((row as { city?: string }).city || ''),
      timestamp: String((row as { timestamp?: string }).timestamp || ''),
      status: ((row as { status?: Candidate['status'] }).status || 'new') as Candidate['status'],
      adminData: {
        ...DEFAULT_ADMIN_DATA,
        ...(admin as object),
        pipelineStage: (admin.pipelineStage as typeof DEFAULT_ADMIN_DATA.pipelineStage) || 'Checked In',
        notes: Array.isArray(admin.notes) ? (admin.notes as typeof DEFAULT_ADMIN_DATA.notes) : [],
        tags: Array.isArray(admin.tags) ? (admin.tags as string[]) : [],
        emailsSent: Array.isArray(admin.emailsSent)
          ? (admin.emailsSent as typeof DEFAULT_ADMIN_DATA.emailsSent)
          : [],
        checkedInAt: typeof admin.checkedInAt === 'string' ? admin.checkedInAt : null,
        aoHubInviteSentAt: typeof admin.aoHubInviteSentAt === 'string' ? admin.aoHubInviteSentAt : null,
      },
      applicantQuestionnaire: {
        occupation: String(q.occupation || ''),
        currentRole: String(q.currentRole || ''),
        backgroundAreas: Array.isArray(q.backgroundAreas) ? (q.backgroundAreas as string[]) : [],
        salesExperience: String(q.salesExperience || ''),
        somethingAboutYourself: String(q.somethingAboutYourself || ''),
        legallyEntitledCanada: (q.legallyEntitledCanada as 'yes' | 'no') || 'yes',
        resumeUrls: Array.isArray(q.resumeUrls) ? (q.resumeUrls as string[]) : [],
      },
    };
    return asCheckInRow(candidate);
  });

  // Prefer rows that completed check-in (have checkedInAt or instantly_checkin tag)
  const filtered = rows.filter((r) => {
    const tags = r.adminData?.tags || [];
    return Boolean(r.adminData?.checkedInAt) || tags.includes('instantly_checkin');
  });
  return filtered.length ? filtered : rows;
}

function aoHubEmailBodies(firstName: string): { subject: string; html: string; text: string } {
  const first = firstName.trim() || 'there';
  const hub = AO_HUB_URL;
  const text =
    `Hi ${first},\n\n` +
    `You're invited to continue to our interview hub and grab a spot on the next info session.\n\n` +
    `${hub}\n\n` +
    `It takes less than 2 minutes.\n\n` +
    `Best,\nAO Globe Life recruiting`;
  return {
    subject: 'Next step: AO Interview Hub',
    text,
    html:
      `Hi ${first},<br/><br/>` +
      `You're invited to continue to our interview hub and grab a spot on the next info session.<br/><br/>` +
      `<a href="${hub}">Register here → ${hub}</a><br/><br/>` +
      `It takes less than 2 minutes.<br/><br/>` +
      `Best,<br/>AO Globe Life recruiting`,
  };
}

async function getAccessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sign in again to send email.');
  return token;
}

/** Prefer Instantly thread reply when we have a matching hm_people row; else SMTP. */
export async function sendAoHubInviteForCheckIn(candidateId: string): Promise<{ channel: 'instantly' | 'smtp' }> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('Missing Supabase env');
  const full = await getCandidateById(candidateId);
  if (!full) throw new Error('Check-in not found.');
  const email = full.email.trim().toLowerCase();
  const token = await getAccessToken();
  const bodies = aoHubEmailBodies(full.firstName);

  const { data: hmPerson } = await supabase
    .from('hm_people')
    .select('id, instantly_email_id')
    .ilike('email', email)
    .maybeSingle();

  let channel: 'instantly' | 'smtp' = 'smtp';

  if (hmPerson?.id && hmPerson.instantly_email_id) {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/hm-instantly-send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ person_id: hmPerson.id, template_key: 'ao_hub' }),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(json.error || `Instantly send failed (${res.status})`);
    channel = 'instantly';
  } else {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: email,
        subject: bodies.subject,
        bodyHtml: bodies.html,
        bodyText: bodies.text,
        trigger: 'ao_hub_checkin',
        candidateId: full.id,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(json.error || `Email send failed (${res.status})`);
    channel = 'smtp';
  }

  const now = new Date().toISOString();
  const tags = Array.from(new Set([...(full.adminData?.tags || []), 'ao_hub_sent', 'instantly_checkin']));
  await saveCandidate({
    ...full,
    adminData: {
      ...DEFAULT_ADMIN_DATA,
      ...full.adminData,
      aoHubInviteSentAt: now,
      tags,
      nextStep: 'Sent AO Interview Hub invite',
      emailsSent: [
        ...(full.adminData?.emailsSent || []),
        {
          sentAt: now,
          subject: bodies.subject,
          type: 'ao_hub_invite',
        },
      ],
    },
  });

  return { channel };
}
