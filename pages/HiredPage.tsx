import React from 'react';
import { BadgeCheck, Plus, RefreshCw, Search, Send, Trash2, UserPlus } from 'lucide-react';
import { Button } from '../components/UI';
import {
  AGENT_OFFICE_DEFAULT,
  AGENT_TITLE_DEFAULT,
} from '../services/agentOnboardingHtml';
import {
  listHiredAgents,
  markCandidateHired,
  deleteHiredAgent,
  resendHiredEmail,
  searchHiredCandidates,
  type HiredAgent,
  type HiredMatch,
} from '../services/hiredAgentsService';

const HiredPage: React.FC = () => {
  const [query, setQuery] = React.useState('');
  const [matches, setMatches] = React.useState<HiredMatch[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [agents, setAgents] = React.useState<HiredAgent[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);

  const [fullName, setFullName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [portalEmail, setPortalEmail] = React.useState('');
  const [title, setTitle] = React.useState(AGENT_TITLE_DEFAULT);
  const [officePhone, setOfficePhone] = React.useState(AGENT_OFFICE_DEFAULT);
  const [officeExt, setOfficeExt] = React.useState('');
  const [directPhone, setDirectPhone] = React.useState('');
  const [source, setSource] = React.useState<'manual' | 'signup' | 'pipeline'>('manual');
  const [sourceId, setSourceId] = React.useState('');

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
        `Mark ${fullName.trim()} as hired?\n\nThis emails the welcome package, the signature card, and a hiring-portal invite.`,
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
        source,
        signupId: source === 'signup' ? sourceId : undefined,
        personId: source === 'pipeline' ? sourceId : undefined,
      });
      setMsg(`Hired ${created.agent.full_name}. Welcome, signature, and portal invite were sent to ${created.agent.email}.`);
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
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Resend failed');
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
            hired sends the AO welcome letter with the New Agent Welcome Guide PDF, a personal email
            signature they can paste, and hiring-portal access.
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
            Title
            <input className="mt-1 w-full rounded-lg border border-[#e0d8ca] px-3 py-2 text-sm" value={title} onChange={(e) => setTitle(e.target.value)} />
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
            Direct / mobile (candidate can add this)
            <input className="mt-1 w-full rounded-lg border border-[#e0d8ca] px-3 py-2 text-sm" value={directPhone} onChange={(e) => setDirectPhone(e.target.value)} />
          </label>
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
                <td className="px-3 py-2 text-[#5a5348]">{row.welcome_sent_at ? 'Sent' : '—'}</td>
                <td className="px-3 py-2 text-[#5a5348]">{row.signature_sent_at ? 'Sent' : '—'}</td>
                <td className="px-3 py-2 text-[#5a5348]">{row.invite_sent_at ? 'Invited' : '—'}</td>
                <td className="px-3 py-2">
                  <a className="text-[#005EB8] underline" href={`/agent/${row.contact_slug}`} target="_blank" rel="noreferrer">
                    Open
                  </a>
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    <button type="button" className="rounded-full border border-[#ddd5c6] px-2 py-1 text-[11px]" onClick={() => void onResend(row.id, 'welcome')}>
                      <Send size={10} className="mr-1 inline" /> Welcome
                    </button>
                    <button type="button" className="rounded-full border border-[#ddd5c6] px-2 py-1 text-[11px]" onClick={() => void onResend(row.id, 'signature')}>
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
                <td colSpan={6} className="px-3 py-6 text-[#8a8276]">
                  No hired agents yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
};

export default HiredPage;
