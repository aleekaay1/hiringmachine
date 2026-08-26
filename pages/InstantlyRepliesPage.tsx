import React from 'react';
import { ExternalLink, PhoneCall, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  displayName,
  displayPhone,
  listHmReplies,
  syncInstantlyReplies,
  type HmPerson,
} from '../services/hiringMachineService';
import { stringifySupabaseError } from '../services/pipelineService';

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-CA', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

const InstantlyRepliesPage: React.FC = () => {
  const [people, setPeople] = React.useState<HmPerson[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [syncing, setSyncing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [actionMsg, setActionMsg] = React.useState<string | null>(null);

  const selected = people.find((p) => p.id === selectedId) || people[0] || null;

  const load = React.useCallback(async () => {
    setError(null);
    try {
      const next = await listHmReplies();
      setPeople(next);
      setSelectedId((prev) => (prev && next.some((p) => p.id === prev) ? prev : next[0]?.id || null));
    } catch (err) {
      setError(stringifySupabaseError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const refresh = async () => {
    setSyncing(true);
    setError(null);
    setActionMsg(null);
    try {
      const result = await syncInstantlyReplies();
      setActionMsg(
        result.upserted
          ? `Synced ${result.upserted} Instantly ${result.upserted === 1 ? 'reply' : 'replies'}.`
          : 'No new Instantly replies.',
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sync Instantly replies');
      setSyncing(false);
      setLoading(false);
    }
  };

  return (
    <div className="hm-shell mx-auto w-full max-w-[1400px] space-y-4 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-[#d9cfc0] pb-4">
        <div>
          <p className="hm-kicker">Instantly</p>
          <h1 className="font-display text-4xl text-[#1c1915]">Replies</h1>
          <p className="mt-2 max-w-xl text-sm text-[#5c554c]">
            Saved in your database. Opening this page is instant; Sync replies pulls the latest from Instantly.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="hm-btn-ghost inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs"
        >
          <RefreshCw size={14} className={syncing || loading ? 'animate-spin' : ''} />
          {syncing ? 'Syncing…' : 'Sync replies'}
        </button>
      </header>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">{error}</div>}
      {actionMsg && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-900">{actionMsg}</div>
      )}

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="hm-card max-h-[72vh] overflow-y-auto rounded-2xl p-3">
          <p className="hm-kicker px-2 py-2">{people.length} replies</p>
          {people.length === 0 && (
            <p className="px-2 py-6 text-sm text-[#6f675c]">
              No Instantly replies saved yet. Click Sync replies to pull the latest from Instantly.
            </p>
          )}
          <ul className="space-y-1">
            {people.map((person) => {
              const active = person.id === selected?.id;
              return (
                <li key={person.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(person.id)}
                    className={`w-full rounded-xl px-3 py-2.5 text-left ${active ? 'bg-[#1c1915] text-[#f4efe6]' : 'hover:bg-[#eadfce]'}`}
                  >
                    <p className="truncate text-sm font-medium">{displayName(person)}</p>
                    <p className={`truncate text-[11px] ${active ? 'text-[#d4c4a8]' : 'text-[#6f675c]'}`}>
                      {person.email}
                    </p>
                    <p className={`mt-1 line-clamp-2 text-[11px] ${active ? 'text-[#cbbca3]' : 'text-[#8a8174]'}`}>
                      {person.reply_snippet || person.last_reply_text}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <section className="hm-card rounded-2xl p-5">
          {!selected ? (
            <p className="py-16 text-center text-sm text-[#6f675c]">Select a reply to read it.</p>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-3xl text-[#1c1915]">{displayName(selected)}</h2>
                  <p className="mt-1 text-sm text-[#5c554c]">{selected.email}</p>
                  {selected.campaign_name ? (
                    <p className="text-xs text-[#8a8174]">{selected.campaign_name}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {selected.unibox_url ? (
                    <a
                      href={selected.unibox_url}
                      target="_blank"
                      rel="noreferrer"
                      className="hm-btn-ghost inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs"
                    >
                      Instantly thread <ExternalLink size={12} />
                    </a>
                  ) : null}
                  <Link
                    to="/pipeline/call"
                    className="hm-btn-brass inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs"
                  >
                    <PhoneCall size={12} /> Call workspace
                  </Link>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-[#faf6ef] px-4 py-3">
                  <p className="hm-kicker">Phone</p>
                  <p className="mt-1 tabular-nums text-sm text-[#1c1915]">{displayPhone(selected) || 'Not in reply'}</p>
                </div>
                <div className="rounded-xl bg-[#faf6ef] px-4 py-3">
                  <p className="hm-kicker">Stage</p>
                  <p className="mt-1 text-sm capitalize text-[#1c1915]">{String(selected.stage || 'replied').replace(/_/g, ' ')}</p>
                </div>
                <div className="rounded-xl bg-[#faf6ef] px-4 py-3">
                  <p className="hm-kicker">Updated</p>
                  <p className="mt-1 text-sm text-[#1c1915]">{formatWhen(selected.updated_at)}</p>
                </div>
              </div>

              <div>
                <p className="hm-kicker">Subject</p>
                <p className="mt-1 text-sm font-medium text-[#1c1915]">{selected.last_reply_subject || '—'}</p>
              </div>

              <div>
                <p className="hm-kicker">Reply</p>
                <pre className="mt-2 whitespace-pre-wrap rounded-xl bg-[#faf6ef] px-4 py-3 font-sans text-sm leading-6 text-[#3f3a34]">
                  {selected.last_reply_text || selected.reply_snippet || 'No reply body stored.'}
                </pre>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default InstantlyRepliesPage;
