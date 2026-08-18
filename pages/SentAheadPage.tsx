import React from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { displayName, displayPhone, listHmSentAhead, type HmPerson } from '../services/hiringMachineService';
import { stringifySupabaseError } from '../services/pipelineService';

function formatWhen(iso: string | null): string {
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

const SentAheadPage: React.FC = () => {
  const [people, setPeople] = React.useState<HmPerson[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setError(null);
    try {
      setPeople(await listHmSentAhead());
    } catch (err) {
      setError(stringifySupabaseError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="hm-shell mx-auto w-full max-w-5xl space-y-6 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[#d9cfc0] pb-5">
        <div>
          <p className="hm-kicker">Output</p>
          <h1 className="font-display text-4xl text-[#1c1915]">Sent ahead</h1>
          <p className="mt-2 max-w-xl text-sm text-[#5c554c]">
            People Edlyn tagged after a call. Each received the AO Interview Hub link.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            void load();
          }}
          className="hm-btn-ghost inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </header>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

      <div className="hm-card overflow-hidden rounded-2xl">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#1c1915] text-[11px] uppercase tracking-[0.16em] text-[#d4c4a8]">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Phone</th>
              <th className="px-4 py-3 font-medium">Sent</th>
              <th className="px-4 py-3 font-medium">Score</th>
            </tr>
          </thead>
          <tbody>
            {people.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-[#6f675c]">
                  Nobody has been sent to AO Interview Hub yet.
                </td>
              </tr>
            )}
            {people.map((person) => (
              <tr key={person.id} className="border-t border-[#eadfce]">
                <td className="px-4 py-3 font-medium text-[#1c1915]">
                  <div className="flex items-center gap-2">
                    {displayName(person)}
                    {person.unibox_url ? (
                      <a href={person.unibox_url} target="_blank" rel="noreferrer" className="text-[#b08d57]">
                        <ExternalLink size={12} />
                      </a>
                    ) : null}
                  </div>
                </td>
                <td className="px-4 py-3 text-[#5c554c]">{person.email}</td>
                <td className="px-4 py-3 tabular-nums text-[#5c554c]">{displayPhone(person) || '—'}</td>
                <td className="px-4 py-3 text-[#5c554c]">{formatWhen(person.sent_to_hub_at)}</td>
                <td className="px-4 py-3 tabular-nums text-[#5c554c]">{person.ai_score ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default SentAheadPage;
