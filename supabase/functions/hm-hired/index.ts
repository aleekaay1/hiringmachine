// Hired-agent onboarding: welcome email, signature card, portal invite.
// Deploy: supabase functions deploy hm-hired --project-ref ofhcnsuwrhyvxtvtdunw --no-verify-jwt

import nodemailer from 'npm:nodemailer@6.9.10';
import {
  corsHeaders,
  json,
  normalizeEmail,
  serviceClient,
  str,
  userIsAuthenticated,
} from '../_shared/hiringMachine.ts';
import { insertEmailSendLog } from '../_shared/emailSendLog.ts';
import { mergePortalBcc } from '../_shared/portalEmailBcc.ts';
import {
  AGENT_ADDRESS_DEFAULT,
  AGENT_LOGO_URL,
  AGENT_OFFICE_DEFAULT,
  AGENT_TAGLINE_DEFAULT,
  AGENT_TEAM_DEFAULT,
  AGENT_TITLE_DEFAULT,
  AGENT_WEBSITE_URL,
  buildAgentSignatureCardHtml,
  buildAgentVcard,
  buildSignatureSetupEmailHtml,
  defaultWelcomePackageHtml,
  type AgentCardInput,
  type PortalLoginInfo,
} from '../_shared/agentOnboardingHtml.ts';
import { WELCOME_PDF_BASE64 } from './welcomePdfB64.ts';

const PRODUCTION_APP_URL = 'https://aopaz.vercel.app';

function siteOrigin(): string {
  const raw = (
    Deno.env.get('OPS_APP_URL')?.trim() ||
    Deno.env.get('PUBLIC_SITE_URL')?.trim() ||
    PRODUCTION_APP_URL
  ).replace(/\/$/, '');
  if (!raw || /localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]/i.test(raw)) {
    return PRODUCTION_APP_URL;
  }
  return raw;
}

function decodePdfBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function loadWelcomePdf(): Promise<Uint8Array | null> {
  try {
    if (WELCOME_PDF_BASE64) return decodePdfBase64(WELCOME_PDF_BASE64);
  } catch {
    /* fall through */
  }
  try {
    return await Deno.readFile(new URL('./AO-Welcome-Package.pdf', import.meta.url));
  } catch {
    try {
      const res = await fetch(`${siteOrigin()}/AO-Welcome-Package.pdf`);
      if (!res.ok) return null;
      return new Uint8Array(await res.arrayBuffer());
    } catch {
      return null;
    }
  }
}

function getTransport() {
  const host = Deno.env.get('SMTP_HOSTNAME')?.trim();
  const port = Number(Deno.env.get('SMTP_PORT') ?? 587);
  const secure = (Deno.env.get('SMTP_SECURE') ?? 'false') === 'true';
  const user = Deno.env.get('SMTP_USERNAME')?.trim();
  const pass = Deno.env.get('SMTP_PASSWORD')?.trim();
  if (!host || !user || !pass) throw new Error('Missing SMTP config');
  return nodemailer.createTransport({
    host,
    port: Number.isNaN(port) ? 587 : port,
    secure,
    auth: { user, pass },
    ...(port === 587 && !secure ? { requireTLS: true } : {}),
  });
}

function fromIdentity() {
  const fromEmailRaw =
    Deno.env.get('SMTP_FROM')?.trim() ||
    Deno.env.get('SMTP_USERNAME')?.trim() ||
    'noreply@example.com';
  const fromName = (Deno.env.get('SMTP_FROM_NAME')?.trim() || 'AO Globe Life - Team Paz')
    .replace(/["<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const angled = fromEmailRaw.match(/<([^>]+)>/);
  const fromEmail = (angled?.[1] || fromEmailRaw).trim().toLowerCase();
  return { from: { name: fromName, address: fromEmail }, fromEmail };
}

async function authUser(
  req: Request,
  admin: ReturnType<typeof serviceClient>,
): Promise<{ id: string; email: string | null } | null> {
  const auth = req.headers.get('authorization') || '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}

function makeSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 28) || 'agent';
  const rand = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
  return `${base}-${rand}`;
}

function cardFromRow(row: Record<string, unknown>, origin: string): AgentCardInput {
  const slug = str(row.contact_slug);
  return {
    fullName: str(row.full_name),
    title: str(row.title) || AGENT_TITLE_DEFAULT,
    teamLine: str(row.team_line) || AGENT_TEAM_DEFAULT,
    tagline: str(row.tagline) || AGENT_TAGLINE_DEFAULT,
    email: str(row.email),
    officePhone: str(row.office_phone) || AGENT_OFFICE_DEFAULT,
    officeExt: str(row.office_ext) || null,
    directPhone: str(row.direct_phone) || null,
    address: str(row.address) || AGENT_ADDRESS_DEFAULT,
    websiteUrl: str(row.website_url) || AGENT_WEBSITE_URL,
    logoUrl: AGENT_LOGO_URL,
    contactUrl: `${origin}/agent/${slug}`,
  };
}

async function sendAgentMail(opts: {
  admin: ReturnType<typeof serviceClient>;
  to: string;
  subject: string;
  html: string;
  userId: string | null;
  trigger: string;
  hiredId: string;
  attachments?: Array<{
    filename: string;
    content: string | Uint8Array;
    contentType?: string;
    encoding?: string;
  }>;
}): Promise<void> {
  const { from, fromEmail } = fromIdentity();
  const transport = getTransport();
  try {
    await transport.sendMail({
      from,
      to: opts.to,
      bcc: mergePortalBcc(),
      subject: opts.subject,
      html: opts.html,
      attachments: opts.attachments,
    });
    await insertEmailSendLog(opts.admin, {
      source: 'hm-hired',
      trigger_label: opts.trigger,
      from_email: fromEmail,
      to_email: opts.to,
      subject: opts.subject,
      sent_by_user_id: opts.userId,
      status: 'sent',
      metadata: { hired_id: opts.hiredId },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await insertEmailSendLog(opts.admin, {
      source: 'hm-hired',
      trigger_label: opts.trigger,
      from_email: fromEmail,
      to_email: opts.to,
      subject: opts.subject,
      sent_by_user_id: opts.userId,
      status: 'failed',
      error_message: message,
      metadata: { hired_id: opts.hiredId },
    });
    throw err;
  }
}

const STAFF_ROLES = new Set(['admin', 'leadership', 'hr', 'webinar']);
const PROTECTED_PORTAL_EMAILS = new Set([
  'ali@globelife-paz.com',
  'alex@globelife-paz.com',
  'aleekaay@gmail.com',
]);

function randomTempPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

async function ensureAgentCode(
  admin: ReturnType<typeof serviceClient>,
  existing: string | null | undefined,
): Promise<string> {
  const current = str(existing).toUpperCase();
  if (current) return current;
  for (let i = 0; i < 16; i++) {
    const code = `PAZ-${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    const { data } = await admin.from('hm_hired_agents').select('id').eq('agent_code', code).maybeSingle();
    if (!data) return code;
  }
  return `PAZ-${crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
}

function isProtectedStaff(email: string, role: string): boolean {
  if (PROTECTED_PORTAL_EMAILS.has(email)) return true;
  return STAFF_ROLES.has(role);
}

async function upsertHiredProfile(
  admin: ReturnType<typeof serviceClient>,
  input: {
    userId: string;
    email: string;
    fullName: string;
    phone?: string | null;
    hiredId: string;
    agentCode: string;
  },
): Promise<void> {
  const now = new Date().toISOString();
  await admin.from('user_profiles').upsert({
    user_id: input.userId,
    email: input.email,
    full_name: input.fullName,
    role: 'viewer',
    phone: input.phone || null,
    hired_agent_id: input.hiredId,
    agent_code: input.agentCode,
    updated_at: now,
  });
  await admin
    .from('user_profiles')
    .update({
      role: 'viewer',
      hired_agent_id: input.hiredId,
      agent_code: input.agentCode,
      full_name: input.fullName,
      updated_at: now,
    })
    .eq('user_id', input.userId);
}

async function ensurePortalAccount(
  admin: ReturnType<typeof serviceClient>,
  input: {
    hiredId: string;
    fullName: string;
    portalEmail: string;
    phone?: string | null;
    agentCode: string;
    existingPortalUserId?: string | null;
  },
): Promise<{
  portalUserId: string | null;
  login: PortalLoginInfo;
  alreadyHadAccess: boolean;
  error?: string;
}> {
  const origin = siteOrigin();
  const email = normalizeEmail(input.portalEmail);
  const loginUrl = `${origin}/home`;
  const baseLogin: PortalLoginInfo = {
    loginUrl,
    email,
    agentCode: input.agentCode,
  };

  const { data: existingProfile } = await admin
    .from('user_profiles')
    .select('user_id, email, role, hired_agent_id')
    .ilike('email', email)
    .maybeSingle();

  if (existingProfile?.user_id) {
    const userId = String(existingProfile.user_id);
    const role = str(existingProfile.role).toLowerCase();
    const profileEmail = normalizeEmail(existingProfile.email || email);
    const hiredFlag = str(existingProfile.hired_agent_id);
    const sameHired = hiredFlag === input.hiredId;
    const knownPortalUser = Boolean(input.existingPortalUserId && input.existingPortalUserId === userId);
    if (
      PROTECTED_PORTAL_EMAILS.has(profileEmail) ||
      role === 'admin' ||
      role === 'leadership' ||
      ((isProtectedStaff(profileEmail, role) || role === 'recruiter') && !sameHired && !hiredFlag && !knownPortalUser)
    ) {
      return {
        portalUserId: userId,
        login: { ...baseLogin, alreadyHadAccess: true },
        alreadyHadAccess: true,
      };
    }

    const password = randomTempPassword();
    const { error: pwErr } = await admin.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
      user_metadata: { full_name: input.fullName, hired_agent: true, agent_code: input.agentCode },
    });
    await upsertHiredProfile(admin, {
      userId,
      email,
      fullName: input.fullName,
      phone: input.phone,
      hiredId: input.hiredId,
      agentCode: input.agentCode,
    });
    return {
      portalUserId: userId,
      login: { ...baseLogin, password: pwErr ? null : password, alreadyHadAccess: true },
      alreadyHadAccess: true,
      error: pwErr?.message,
    };
  }

  const password = randomTempPassword();
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: input.fullName, hired_agent: true, agent_code: input.agentCode },
  });
  let userId = created.data.user?.id || null;
  if (created.error || !userId) {
    const mag = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo: loginUrl },
    });
    userId = mag.data?.user?.id || mag.user?.id || null;
    if (userId) {
      const { error: pwErr } = await admin.auth.admin.updateUserById(userId, { password, email_confirm: true });
      await upsertHiredProfile(admin, {
        userId,
        email,
        fullName: input.fullName,
        phone: input.phone,
        hiredId: input.hiredId,
        agentCode: input.agentCode,
      });
      return {
        portalUserId: userId,
        login: { ...baseLogin, password: pwErr ? null : password },
        alreadyHadAccess: false,
        error: created.error?.message,
      };
    }
    return {
      portalUserId: null,
      login: baseLogin,
      alreadyHadAccess: false,
      error: created.error?.message || 'Could not create portal account',
    };
  }

  await upsertHiredProfile(admin, {
    userId,
    email,
    fullName: input.fullName,
    phone: input.phone,
    hiredId: input.hiredId,
    agentCode: input.agentCode,
  });
  return {
    portalUserId: userId,
    login: { ...baseLogin, password },
    alreadyHadAccess: false,
  };
}

async function sendOnboardingBundle(
  admin: ReturnType<typeof serviceClient>,
  row: Record<string, unknown>,
  userId: string | null,
  opts: { welcome: boolean; signature: boolean; invite: boolean; welcomeHtml?: string | null },
): Promise<Record<string, unknown>> {
  const origin = siteOrigin();
  const card = cardFromRow(row, origin);
  card.logoUrl = AGENT_LOGO_URL;
  const to = str(row.email);
  const first = card.fullName.split(/\s+/)[0] || 'there';
  const hiredId = String(row.id);
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { updated_at: now, last_error: null };
  let portalLink: string | null = `${siteOrigin()}/home`;
  let login: PortalLoginInfo | null = null;
  const agentCode = await ensureAgentCode(admin, str(row.agent_code));
  patch.agent_code = agentCode;

  if (opts.invite || opts.welcome) {
    const portalEmail = normalizeEmail(str(row.portal_email) || to);
    const invite = await ensurePortalAccount(admin, {
      hiredId,
      fullName: card.fullName,
      portalEmail,
      phone: str(row.direct_phone) || str(row.office_phone) || null,
      agentCode,
      existingPortalUserId: str(row.portal_user_id) || null,
    });
    login = invite.login;
    portalLink = invite.login.loginUrl;
    if (invite.portalUserId) patch.portal_user_id = invite.portalUserId;
    if (opts.invite) patch.invite_sent_at = now;
    if (invite.error) patch.last_error = invite.error;
  }

  if (opts.welcome) {
    const html = defaultWelcomePackageHtml(first, portalLink, login);
    const pdf = await loadWelcomePdf();
    await sendAgentMail({
      admin,
      to,
      subject: 'Welcome to AO Globe Life',
      html,
      userId,
      trigger: 'hired_welcome',
      hiredId,
      attachments: pdf
        ? [
            {
              filename: 'AO Globe Life New Agent Welcome Guide.pdf',
              content: pdf,
              contentType: 'application/pdf',
            },
          ]
        : undefined,
    });
    patch.welcome_sent_at = now;
    patch.welcome_html = html;
  }

  if (opts.signature) {
    const html = buildSignatureSetupEmailHtml(card);
    const vcf = buildAgentVcard(card);
    await sendAgentMail({
      admin,
      to,
      subject: 'Your AO Globe Life email signature',
      html,
      userId,
      trigger: 'hired_signature',
      hiredId,
      attachments: [
        {
          filename: 'AO-email-signature.html',
          content: `<!DOCTYPE html><html><body style="margin:24px;background:#fff;">${buildAgentSignatureCardHtml(card)}</body></html>`,
          contentType: 'text/html; charset=utf-8',
        },
        {
          filename: `${card.fullName.replace(/\s+/g, '-')}-AO.vcf`,
          content: vcf,
          contentType: 'text/vcard; charset=utf-8',
        },
      ],
    });
    patch.signature_sent_at = now;
  }

  await admin.from('hm_hired_agents').update(patch).eq('id', hiredId);
  const { data: updated } = await admin.from('hm_hired_agents').select('*').eq('id', hiredId).maybeSingle();
  return { agent: updated, portal_link: portalLink };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  const admin = serviceClient();
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const action = str(body.action || body.mode).toLowerCase();

  try {
    if (action === 'public_card') {
      const slug = str(body.slug);
      if (!slug) return json(400, { error: 'Missing slug' });
      const { data, error } = await admin
        .from('hm_hired_agents')
        .select(
          'full_name, title, team_line, tagline, email, office_phone, office_ext, direct_phone, address, website_url, contact_slug',
        )
        .eq('contact_slug', slug)
        .maybeSingle();
      if (error) throw error;
      if (!data) return json(404, { error: 'Contact not found' });
      const origin = siteOrigin();
      const card = cardFromRow(data as Record<string, unknown>, origin);
      card.logoUrl = '/logo.png';
      return json(200, {
        ok: true,
        card,
        signature_html: buildAgentSignatureCardHtml(card),
        vcard: buildAgentVcard(card),
      });
    }

    const userOk = await userIsAuthenticated(req, admin);
    if (!userOk) return json(401, { error: 'Sign in required' });
    const user = await authUser(req, admin);

    if (action === 'list') {
      const { data, error } = await admin
        .from('hm_hired_agents')
        .select('*')
        .order('hired_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return json(200, { ok: true, agents: data || [] });
    }

    if (action === 'search') {
      const q = str(body.q || body.query).replace(/[%_,()]/g, ' ').trim();
      if (q.length < 2) return json(200, { ok: true, matches: [] });
      const like = `%${q}%`;
      const [{ data: signups }, { data: people }] = await Promise.all([
        admin
          .from('hm_public_webinar_signups')
          .select('id, first_name, last_name, email, phone, created_at')
          .or(`email.ilike.${like},first_name.ilike.${like},last_name.ilike.${like}`)
          .order('created_at', { ascending: false })
          .limit(20),
        admin
          .from('hm_people')
          .select('id, full_name, email, phone, extracted_phone, created_at')
          .or(`email.ilike.${like},full_name.ilike.${like}`)
          .order('updated_at', { ascending: false })
          .limit(20),
      ]);
      const matches: Array<Record<string, unknown>> = [];
      for (const row of signups || []) {
        const name = `${str(row.first_name)} ${str(row.last_name)}`.trim();
        matches.push({
          source: 'signup',
          id: row.id,
          full_name: name,
          email: row.email,
          phone: row.phone,
          created_at: row.created_at,
        });
      }
      for (const row of people || []) {
        matches.push({
          source: 'pipeline',
          id: row.id,
          full_name: row.full_name,
          email: row.email,
          phone: row.extracted_phone || row.phone,
          created_at: row.created_at,
        });
      }
      return json(200, { ok: true, matches });
    }

    if (action === 'mark_hired') {
      const fullName = str(body.full_name || body.fullName);
      const email = normalizeEmail(body.email);
      if (!fullName || !email || !email.includes('@')) {
        return json(400, { error: 'Name and email are required' });
      }
      const { data: already } = await admin
        .from('hm_hired_agents')
        .select('id, full_name, email, contact_slug, agent_code')
        .ilike('email', email)
        .maybeSingle();
      if (already?.id) {
        return json(409, {
          error: `${already.full_name || email} is already marked hired.`,
          agent: already,
        });
      }
      const sourceRaw = str(body.source) || 'manual';
      const source = ['signup', 'pipeline', 'manual'].includes(sourceRaw) ? sourceRaw : 'manual';
      const portalEmail = normalizeEmail(body.portal_email || body.portalEmail) || email;
      const row = {
        full_name: fullName,
        email,
        portal_email: portalEmail,
        title: str(body.title) || AGENT_TITLE_DEFAULT,
        team_line: str(body.team_line || body.teamLine) || AGENT_TEAM_DEFAULT,
        tagline: str(body.tagline) || AGENT_TAGLINE_DEFAULT,
        office_phone: str(body.office_phone || body.officePhone) || AGENT_OFFICE_DEFAULT,
        office_ext: str(body.office_ext || body.officeExt) || null,
        direct_phone: str(body.direct_phone || body.directPhone) || null,
        address: str(body.address) || AGENT_ADDRESS_DEFAULT,
        website_url: str(body.website_url || body.websiteUrl) || AGENT_WEBSITE_URL,
        source,
        signup_id: source === 'signup' ? str(body.signup_id || body.signupId) || null : null,
        person_id: source === 'pipeline' ? str(body.person_id || body.personId) || null : null,
        contact_slug: makeSlug(fullName),
        agent_code: await ensureAgentCode(admin, null),
        hired_by: user?.id || null,
        welcome_html: str(body.welcome_html || body.welcomeHtml) || null,
      };
      const { data: created, error } = await admin.from('hm_hired_agents').insert(row).select('*').single();
      if (error || !created) throw error || new Error('Could not save hired agent');
      const result = await sendOnboardingBundle(admin, created as Record<string, unknown>, user?.id || null, {
        welcome: body.send_welcome !== false,
        signature: body.send_signature !== false,
        invite: body.invite_portal !== false,
        welcomeHtml: str(body.welcome_html || body.welcomeHtml) || null,
      });
      return json(200, { ok: true, ...result });
    }

    if (action === 'resend') {
      const id = str(body.id || body.hired_id);
      if (!id) return json(400, { error: 'Missing hired agent id' });
      const { data: row, error } = await admin.from('hm_hired_agents').select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      if (!row) return json(404, { error: 'Hired agent not found' });
      const which = str(body.which || body.kind).toLowerCase();
      const result = await sendOnboardingBundle(admin, row as Record<string, unknown>, user?.id || null, {
        welcome: which === 'welcome' || which === 'all',
        signature: which === 'signature' || which === 'all',
        invite: which === 'invite' || which === 'all',
        welcomeHtml: str(body.welcome_html) || null,
      });
      return json(200, { ok: true, ...result });
    }

    if (action === 'delete' || action === 'remove') {
      const id = str(body.id || body.hired_id);
      if (!id) return json(400, { error: 'Missing hired agent id' });
      const { data: row, error } = await admin.from('hm_hired_agents').select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      if (!row) return json(404, { error: 'Hired agent not found' });

      const protectedEmails = new Set(
        ['ali@globelife-paz.com', 'alex@globelife-paz.com', 'aleekaay@gmail.com', normalizeEmail(user?.email)].filter(Boolean),
      );

      let portalUserId = str(row.portal_user_id) || '';
      const portalEmail = normalizeEmail(str(row.portal_email) || str(row.email));
      if (!portalUserId && portalEmail) {
        const { data: profile } = await admin
          .from('user_profiles')
          .select('user_id, email, role')
          .ilike('email', portalEmail)
          .maybeSingle();
        if (profile?.user_id) portalUserId = String(profile.user_id);
      }

      let accountDeleted = false;
      let accountSkipped: string | null = null;
      if (portalUserId) {
        if (user?.id && portalUserId === user.id) {
          accountSkipped = 'Would delete the signed-in staff account, so only the hired record was removed.';
        } else {
          const { data: profile } = await admin
            .from('user_profiles')
            .select('user_id, email, role, hired_agent_id')
            .eq('user_id', portalUserId)
            .maybeSingle();
          const profileEmail = normalizeEmail(profile?.email || portalEmail);
          const role = str(profile?.role).toLowerCase();
          const hiredFlag = str(profile?.hired_agent_id);
          const { data: authUser } = await admin.auth.admin.getUserById(portalUserId);
          const authCreated = authUser?.user?.created_at ? Date.parse(authUser.user.created_at) : 0;
          const hiredAt = row.hired_at ? Date.parse(String(row.hired_at)) : Date.now();
          const existedBeforeHire = Boolean(authCreated && hiredAt && authCreated < hiredAt - 2 * 60 * 1000);
          const createdForThisHire = hiredFlag === id;
          if (
            protectedEmails.has(profileEmail) ||
            role === 'admin' ||
            role === 'leadership' ||
            (existedBeforeHire && !createdForThisHire)
          ) {
            accountSkipped = existedBeforeHire
              ? 'Portal login already existed, so the account was left. Hired record was removed.'
              : 'Portal account was left in place (staff/admin). Hired record was removed.';
          } else {
            const { error: delAuthErr } = await admin.auth.admin.deleteUser(portalUserId);
            if (delAuthErr) {
              await admin.from('user_profiles').delete().eq('user_id', portalUserId);
              accountSkipped = delAuthErr.message;
            } else {
              accountDeleted = true;
            }
          }
        }
      }

      const { error: delRowErr } = await admin.from('hm_hired_agents').delete().eq('id', id);
      if (delRowErr) throw delRowErr;
      return json(200, {
        ok: true,
        deleted: true,
        account_deleted: accountDeleted,
        account_skipped: accountSkipped,
      });
    }

    return json(400, { error: `Unknown action: ${action || '(empty)'}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('hm-hired', message);
    return json(500, { error: message });
  }
});
