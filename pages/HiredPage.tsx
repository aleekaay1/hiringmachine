import React from 'react';
import { BadgeCheck, Plus, RefreshCw, Search, Send, Trash2, UserPlus } from 'lucide-react';
import { Button } from '../components/UI';
import {
  AGENT_ADDRESS_DEFAULT,
  AGENT_OFFICE_DEFAULT,
  AGENT_TAGLINE_DEFAULT,
  AGENT_TEAM_DEFAULT,
  AGENT_TITLE_DEFAULT,
  AGENT_WEBSITE_URL,
  ORG_SOCIAL_LINKS,
  SIGNATURE_ASSET_ORIGIN,
  buildAgentSignatureCardHtml,
  buildAgentVcard,
  buildStandaloneSignatureEmailHtml,
  type AgentCardInput,
  type SignatureSocials,
} from '../services/agentOnboardingHtml';
import { sendEmail } from '../services/emailService';
import { supabase } from '../services/supabaseClient';
import {
  listHiredAgents,
  markCandidateHired,
  deleteHiredAgent,
  resendHiredEmail,
  searchHiredCandidates,
  type HiredAgent,
  type HiredMatch,
} from '../services/hiredAgentsService';

function signaturePreviewDoc(cardHtml: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8" /></head><body style="margin:0;padding:16px;background:#ffffff;">${cardHtml}</body></html>`;
}

function agentSignatureHtml(row: HiredAgent): string {
  return buildAgentSignatureCardHtml({
    fullName: row.full_name,
    title: row.title,
    teamLine: row.team_line || AGENT_TEAM_DEFAULT,
    tagline: row.tagline || AGENT_TAGLINE_DEFAULT,
    email: row.email,
    officePhone: row.office_phone || AGENT_OFFICE_DEFAULT,
    officeExt: row.office_ext,
    directPhone: row.direct_phone,
    address: row.address || AGENT_ADDRESS_DEFAULT,
    websiteUrl: row.website_url || AGENT_WEBSITE_URL,
    contactUrl: `${SIGNATURE_ASSET_ORIGIN}/agent/${row.contact_slug}`,
    socials: storedSocials(row),
  });
}

function storedSocials(row: HiredAgent): SignatureSocials | undefined {
  const socials: SignatureSocials = {
    instagram: row.instagram_url,
    linkedin: row.linkedin_url,
    facebook: row.facebook_url,
    youtube: row.youtube_url,
    tiktok: row.tiktok_url,
  };
  return Object.values(socials).some((value) => (value || '').trim()) ? socials : undefined;
}

const HiredPage: React.FC = () => {
  const [query, setQuery] = React.useState('');
  const [matches, setMatches] = React.useState<HiredMatch[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [agents, setAgents] = React.useState<HiredAgent[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [signatureOnlyBusy, setSignatureOnlyBusy] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [pendingSend, setPendingSend] = React.useState<{
    id: string;
    which: 'welcome' | 'signature';
    label: string;
    html: string;
  } | null>(null);

  const [fullName, setFullName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [portalEmail, setPortalEmail] = React.useState('');
  const [title, setTitle] = React.useState(AGENT_TITLE_DEFAULT);
  const [officePhone, setOfficePhone] = React.useState(AGENT_OFFICE_DEFAULT);
  const [officeExt, setOfficeExt] = React.useState('');
  const [directPhone, setDirectPhone] = React.useState('');
  const [instagram, setInstagram] = React.useState(ORG_SOCIAL_LINKS.instagram);
  const [linkedin, setLinkedin] = React.useState(ORG_SOCIAL_LINKS.linkedin);
  const [facebook, setFacebook] = React.useState(ORG_SOCIAL_LINKS.facebook);
  const [youtube, setYoutube] = React.useState(ORG_SOCIAL_LINKS.youtube);
  const [tiktok, setTiktok] = React.useState(ORG_SOCIAL_LINKS.tiktok);
  const [source, setSource] = React.useState<'manual' | 'signup' | 'pipeline'>('manual');
  const [sourceId, setSourceId] = React.useState('');

  const signatureInput = React.useMemo<AgentCardInput>(() => {
    const socials: SignatureSocials = { instagram, linkedin, facebook, youtube, tiktok };
    return {
      fullName: fullName.trim() || 'Your name',
      title: title.trim() || AGENT_TITLE_DEFAULT,
      teamLine: AGENT_TEAM_DEFAULT,
      tagline: AGENT_TAGLINE_DEFAULT,
      email: email.trim() || 'name@email.com',
      officePhone: officePhone.trim() || AGENT_OFFICE_DEFAULT,
      officeExt: officeExt.trim(),
      directPhone: directPhone.trim(),
      address: AGENT_ADDRESS_DEFAULT,
      websiteUrl: AGENT_WEBSITE_URL,
      contactUrl: AGENT_WEBSITE_URL,
      socials,
    };
  }, [directPhone, email, facebook, fullName, instagram, linkedin, officeExt, officePhone, tiktok, title, youtube]);

  const signatureHtml = React.useMemo(() => buildAgentSignatureCardHtml(signatureInput), [signatureInput]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAgents(await listHiredAgents());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load hired agents');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setMatches([]);
      return;
    }
    const t = window.setTimeout(() => {
      setSearching(true);
      void searchHiredCandidates(q)
        .then(setMatches)
        .catch(() => setMatches([]))
        .finally(() => setSearching(false));
    }, 280);
    return () => window.clearTimeout(t);
  }, [query]);

  const pick = (row: HiredMatch) => {
    setFullName(String(row.full_name || ''));
    setEmail(String(row.email || ''));
    setPortalEmail(String(row.email || ''));
    setDirectPhone(String(row.phone || ''));
    setSource(row.source === 'signup' || row.source === 'pipeline' ? row.source : 'manual');
    setSourceId(String(row.id || ''));
    setMsg(`Filled from ${row.source === 'signup' ? 'form signup' : 'call queue'}. Add phone numbers, then mark hired.`);
  };

  const resetForm = () => {
    setFullName('');
    setEmail('');
    setPortalEmail('');
    setTitle(AGENT_TITLE_DEFAULT);
    setOfficePhone(AGENT_OFFICE_DEFAULT);
    setOfficeExt('');
    setDirectPhone('');
    setInstagram(ORG_SOCIAL_LINKS.instagram);
    setLinkedin(ORG_SOCIAL_LINKS.linkedin);
    setFacebook(ORG_SOCIAL_LINKS.facebook);
    setYoutube(ORG_SOCIAL_LINKS.youtube);
    setTiktok(ORG_SOCIAL_LINKS.tiktok);
    setSource('manual');
    setSourceId('');
  };

  const onHire = async () => {
    setError(null);
    setMsg(null);
    if (!fullName.trim() || !email.trim()) {
      setError('Name and email are required.');
      return;
    }
    if (
      !window.confirm(
        `Mark ${fullName.trim()} as hired?\n\nThis emails the welcome package, the signature card, and a portal login with a temporary password.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const created = await markCandidateHired({
        fullName: fullName.trim(),
        email: email.trim(),
        portalEmail: (portalEmail || email).trim(),
        title: title.trim(),
        officePhone: officePhone.trim(),
        officeExt: officeExt.trim(),
        directPhone: directPhone.trim(),
        instagram: instagram.trim(),
        linkedin: linkedin.trim(),
        facebook: facebook.trim(),
        youtube: youtube.trim(),
        tiktok: tiktok.trim(),
        source,
        signupId: source === 'signup' ? sourceId : undefined,
        personId: source === 'pipeline' ? sourceId : undefined,
      });
      setMsg(`Hired ${created.agent.full_name}. Welcome, signature, and portal login were sent to ${created.agent.email}.`);
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not mark hired');
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (row: HiredAgent) => {
    setError(null);
    setMsg(null);
    if (
      !window.confirm(
        `Delete ${row.full_name} from Hired?\n\nThis removes them from this list and deletes their portal login if one was created. Your own staff account will not be deleted.`,
      )
    ) {
      return;
    }
    setDeletingId(row.id);
    try {
      const result = await deleteHiredAgent(row.id);
      setMsg(
        result.account_deleted
          ? `Removed ${row.full_name} and deleted their portal account.`
          : result.account_skipped
            ? `Removed ${row.full_name} from Hired. ${result.account_skipped}`
            : `Removed ${row.full_name} from Hired.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete');
    } finally {
      setDeletingId(null);
    }
  };

  const onResend = async (id: string, which: 'welcome' | 'signature' | 'invite') => {
    setError(null);
    setMsg(null);
    try {
      await resendHiredEmail(id, which);
      setMsg(`Resent ${which}.`);
      setPendingSend(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Resend failed');
    }
  };

  const openSendPreview = (row: HiredAgent, which: 'welcome' | 'signature') => {
    setPendingSend({
      id: row.id,
      which,
      label:
        which === 'welcome'
          ? `Welcome package for ${row.full_name}`
          : `Email signature for ${row.full_name}`,
      html: agentSignatureHtml(row),
    });
  };

  const onSendSignatureOnly = async () => {
    setError(null);
    setMsg(null);
    if (!fullName.trim() || !email.trim()) {
      setError('Name and email are required before sending the signature.');
      return;
    }
    if (
      !window.confirm(
        `Send ${fullName.trim()}'s email signature to ${email.trim()}?\n\nThe welcome package will not be sent.`,
      )
    ) {
      return;
    }
    setSignatureOnlyBusy(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Sign in required to send email.');
      const card: AgentCardInput = {
        ...signatureInput,
        fullName: fullName.trim(),
        email: email.trim(),
      };
      const vcf = buildAgentVcard(card);
      const safeName = fullName.trim().replace(/[^\w.-]+/g, '-') || 'signature';
      const result = await sendEmail(token, {
        to: email.trim(),
        subject: `${fullName.trim()} — AO Globe Life`,
        bodyHtml: buildStandaloneSignatureEmailHtml(buildAgentSignatureCardHtml(card)),
        trigger: 'hired_signature_only',
        attachments: [
          {
            filename: `${safeName}.vcf`,
            contentBase64: btoa(unescape(encodeURIComponent(vcf))),
            contentType: 'text/vcard',
          },
        ],
      });
      if ('error' in result) throw new Error(result.error);
      setMsg(`Signature sent to ${email.trim()}. The welcome package was not included.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send signature');
    } finally {
      setSignatureOnlyBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2 text-[#005EB8]">
            <BadgeCheck className="h-5 w-5" />
            <p className="text-xs font-semibold uppercase tracking-wide">Onboarding</p>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Hired</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Find someone from webinar form signups or the call queue, or add them by hand. Marking
            hired sends the AO welcome letter, this person’s signature, and a portal login. The preview
            below updates as you type their name, designation, phones, and social links.
          </p>
        </div>
        <Button type="button" variant="outline" className="!min-h-0 h-10 px-3" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}
      {msg && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{msg}</div>
      )}

      <section className="space-y-4 rounded-2xl border border-[#e6e0d4] bg-white p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#8a8276]">Find or add</p>
        <label className="block text-xs text-[#6f675c]">
          Search registrations
          <div className="relative mt-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[#8a8276]" />
            <input
              className="w-full rounded-lg border border-[#e0d8ca] py-2 pl-9 pr-3 text-sm"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name or email from form signups / call queue"
            />
          </div>
        </label>
        {(searching || matches.length > 0) && (
          <div className="max-h-48 overflow-auto rounded-xl border border-[#eee7db]">
            {searching && <p className="px-3 py-2 text-xs text-[#8a8276]">Searching…</p>}
            {matches.map((row) => (
              <button
                key={`${row.source}-${row.id}`}
                type="button"
                className="flex w-full items-center justify-between gap-2 border-t border-[#f0ebe2] px-3 py-2 text-left text-sm hover:bg-[#fbf8f2]"
                onClick={() => pick(row)}
              >
                <span>
                  <span className="font-medium text-[#1f2a24]">{row.full_name || '—'}</span>
                  <span className="ml-2 text-[#6f675c]">{row.email}</span>
                </span>
                <span className="text-[10px] font-semibold uppercase text-[#8a8276]">
                  {row.source === 'signup' ? 'Form signup' : 'Call queue'}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs text-[#6f675c]">
            Full name
            <input className="mt-1 w-full rounded-lg border border-[#e0d8ca] px-3 py-2 text-sm" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </label>
          <label className="block text-xs text-[#6f675c]">
            Email (welcome + signature go here)
            <input type="email" className="mt-1 w-full rounded-lg border border-[#e0d8ca] px-3 py-2 text-sm" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="block text-xs text-[#6f675c]">
            Portal login email
            <input type="email" className="mt-1 w-full rounded-lg border border-[#e0d8ca] px-3 py-2 text-sm" value={portalEmail} onChange={(e) => setPortalEmail(e.target.value)} placeholder="Same as above unless they have a company inbox" />
          </label>
          <label className="block text-xs text-[#6f675c]">
            Designation
            <input className="mt-1 w-full rounded-lg border border-[#e0d8ca] px-3 py-2 text-sm" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Life Insurance Producer" />
          </label>
          <label className="block text-xs text-[#6f675c]">
            Office phone
            <input className="mt-1 w-full rounded-lg border border-[#e0d8ca] px-3 py-2 text-sm" value={officePhone} onChange={(e) => setOfficePhone(e.target.value)} />
          </label>
          <label className="block text-xs text-[#6f675c]">
            Office extension
            <input className="mt-1 w-full rounded-lg border border-[#e0d8ca] px-3 py-2 text-sm" value={officeExt} onChange={(e) => setOfficeExt(e.target.value)} placeholder="5201" />
          </label>
          <label className="block text-xs text-[#6f675c] sm:col-span-2">
            Direct / mobile
            <input className="mt-1 w-full rounded-lg border border-[#e0d8ca] px-3 py-2 text-sm" value={directPhone} onChange={(e) => setDirectPhone(e.target.value)} />
          </label>
          <label className="block text-xs text-[#6f675c] sm:col-span-2">
            Instagram
            <input className="mt-1 w-full rounded-lg border border-[#e0d8ca] px-3 py-2 text-sm" value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="Leave blank to hide" />
          </label>
          <label className="block text-xs text-[#6f675c]">
            LinkedIn
            <input className="mt-1 w-full rounded-lg border border-[#e0d8ca] px-3 py-2 text-sm" value={linkedin} onChange={(e) => setLinkedin(e.target.value)} placeholder="Leave blank to hide" />
          </label>
          <label className="block text-xs text-[#6f675c]">
            Facebook
            <input className="mt-1 w-full rounded-lg border border-[#e0d8ca] px-3 py-2 text-sm" value={facebook} onChange={(e) => setFacebook(e.target.value)} placeholder="Leave blank to hide" />
          </label>
          <label className="block text-xs text-[#6f675c]">
            YouTube
            <input className="mt-1 w-full rounded-lg border border-[#e0d8ca] px-3 py-2 text-sm" value={youtube} onChange={(e) => setYoutube(e.target.value)} placeholder="Leave blank to hide" />
          </label>
          <label className="block text-xs text-[#6f675c]">
            TikTok
            <input className="mt-1 w-full rounded-lg border border-[#e0d8ca] px-3 py-2 text-sm" value={tiktok} onChange={(e) => setTiktok(e.target.value)} placeholder="Leave blank to hide" />
          </label>
        </div>
        <div className="rounded-xl border border-[#e6e0d4] bg-[#fbf8f2] p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#8a8276]">Signature preview</p>
          <p className="mt-1 text-xs text-[#5a5348]">
            This is {fullName.trim() || 'this person'}’s card. It updates as you edit the form. Send signature only emails this card. Mark hired appends the same details to the welcome package.
          </p>
          <iframe
            title="Signature preview"
            sandbox="allow-popups allow-popups-to-escape-sandbox allow-downloads"
            srcDoc={signaturePreviewDoc(signatureHtml)}
            className="mt-3 h-[680px] w-full rounded-lg border border-[#e6e0d4] bg-white"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void onHire()}
            className="hm-btn-brass inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs disabled:opacity-50"
          >
            <UserPlus size={14} />
            {busy ? 'Sending…' : 'Mark hired & send emails'}
          </button>
          <button
            type="button"
            disabled={signatureOnlyBusy}
            onClick={() => void onSendSignatureOnly()}
            className="inline-flex items-center gap-2 rounded-full border border-[#389C50] bg-[#389C50] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            <Send size={14} />
            {signatureOnlyBusy ? 'Sending signature…' : 'Send signature only'}
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-full border border-[#ddd5c6] px-4 py-2 text-xs text-[#5a5348]"
            onClick={resetForm}
          >
            <Plus size={14} /> New blank person
          </button>
        </div>
      </section>

      <section className="overflow-auto rounded-2xl border border-[#e6e0d4] bg-white">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-[#f7f3eb] text-[#6f675c]">
            <tr>
              <th className="px-3 py-2">Agent</th>
              <th className="px-3 py-2">ID</th>
              <th className="px-3 py-2">Welcome</th>
              <th className="px-3 py-2">Signature</th>
              <th className="px-3 py-2">Portal</th>
              <th className="px-3 py-2">Card</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {agents.map((row) => (
              <tr key={row.id} className="border-t border-[#f0ebe2]">
                <td className="px-3 py-2">
                  <div className="font-medium text-[#1f2a24]">{row.full_name}</div>
                  <div className="text-[#6f675c]">{row.email}</div>
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-[#0A2F5C]">{row.agent_code || '—'}</td>
                <td className="px-3 py-2 text-[#5a5348]">{row.welcome_sent_at ? 'Sent' : '—'}</td>
                <td className="px-3 py-2 text-[#5a5348]">{row.signature_sent_at ? 'Sent' : '—'}</td>
                <td className="px-3 py-2 text-[#5a5348]">{row.invite_sent_at ? 'Login sent' : '—'}</td>
                <td className="px-3 py-2">
                  <a className="text-[#005EB8] underline" href={`/agent/${row.contact_slug}`} target="_blank" rel="noreferrer">
                    Open
                  </a>
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    <button type="button" className="rounded-full border border-[#ddd5c6] px-2 py-1 text-[11px]" onClick={() => openSendPreview(row, 'welcome')}>
                      <Send size={10} className="mr-1 inline" /> Welcome
                    </button>
                    <button type="button" className="rounded-full border border-[#ddd5c6] px-2 py-1 text-[11px]" onClick={() => openSendPreview(row, 'signature')}>
                      Signature
                    </button>
                    <button type="button" className="rounded-full border border-[#ddd5c6] px-2 py-1 text-[11px]" onClick={() => void onResend(row.id, 'invite')}>
                      Portal
                    </button>
                    <button
                      type="button"
                      disabled={deletingId === row.id}
                      className="rounded-full border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-800 disabled:opacity-50"
                      onClick={() => void onDelete(row)}
                    >
                      <Trash2 size={10} className="mr-1 inline" />
                      {deletingId === row.id ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && !agents.length && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-[#8a8276]">
                  No hired agents yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {pendingSend && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#1c1915]/40 p-4 sm:items-center">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[#e6e0d4] bg-white shadow-xl">
            <div className="border-b border-[#eee7db] px-4 py-3">
              <p className="text-sm font-semibold text-[#1f2a24]">{pendingSend.label}</p>
              <p className="mt-1 text-xs text-[#5a5348]">
                {pendingSend.which === 'welcome'
                  ? 'The welcome letter includes this person’s signature at the bottom. Confirm it before sending.'
                  : 'This person’s signature is sent on its own, without the welcome package.'}
              </p>
            </div>
            <iframe
              title="Signature preview before send"
              sandbox="allow-popups allow-popups-to-escape-sandbox allow-downloads"
              srcDoc={signaturePreviewDoc(pendingSend.html)}
              className="h-[560px] w-full bg-white"
            />
            <div className="flex flex-wrap justify-end gap-2 border-t border-[#eee7db] px-4 py-3">
              <button
                type="button"
                className="rounded-full border border-[#ddd5c6] px-4 py-2 text-xs text-[#5a5348]"
                onClick={() => setPendingSend(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-full bg-[#389C50] px-4 py-2 text-xs font-semibold text-white"
                onClick={() => void onResend(pendingSend.id, pendingSend.which)}
              >
                Send {pendingSend.which === 'welcome' ? 'welcome package' : 'signature'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HiredPage;
