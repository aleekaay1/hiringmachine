import React from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, History, Phone, RefreshCw, Settings } from 'lucide-react';
import {
  applyHmDisposition,
  displayName,
  displayPhone,
  listHmCallQueue,
  listHmCallRecords,
  markHmCalled,
  sendAoHubEmail,
  updateHmPersonPhone,
  type HmPerson,
} from '../services/hiringMachineService';
import {
  logPipelineCallAction,
  normalizeDialDestination,
  stringifySupabaseError,
  type PipelineCallRecord,
} from '../services/pipelineService';
import { HM_CALL_DISPOSITIONS, type PipelineCallDisposition } from '../services/pipelineCallDispositions';
import { buildThreeCxWebclientUrl } from '../services/threeCxService';
import { getCurrentUserProfile } from '../services/accessControl';

function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const HmCallWorkspace: React.FC = () => {
  const [people, setPeople] = React.useState<HmPerson[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [phoneInput, setPhoneInput] = React.useState('');
  const [records, setRecords] = React.useState<PipelineCallRecord[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [actionMsg, setActionMsg] = React.useState<string | null>(null);
  const [disposition, setDisposition] = React.useState<PipelineCallDisposition | ''>('');
  const [comment, setComment] = React.useState('');
  const [callbackAt, setCallbackAt] = React.useState('');
  const [showDisposition, setShowDisposition] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [showHistory, setShowHistory] = React.useState(false);
  const dialStartedAtRef = React.useRef<string | null>(null);
  const actorLabelRef = React.useRef<string | null>(null);

  const selected = people.find((p) => p.id === selectedId) || people[0] || null;

  const load = React.useCallback(async () => {
    setError(null);
    try {
      const [queue, profile] = await Promise.all([
        listHmCallQueue(),
        getCurrentUserProfile(),
      ]);
      actorLabelRef.current = profile?.full_name || profile?.email || null;
      setPeople(queue);
      setSelectedId((prev) => (prev && queue.some((p) => p.id === prev) ? prev : queue[0]?.id || null));
      const recs = await listHmCallRecords(queue);
      setRecords(recs);
    } catch (err) {
      setError(stringifySupabaseError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (!selected) {
      setPhoneInput('');
      return;
    }
    setPhoneInput(displayPhone(selected));
  }, [selected]);

  const placeCall = async () => {
    if (!selected) return;
    const destination = normalizeDialDestination(phoneInput || displayPhone(selected));
    if (!destination) {
      setError('No valid phone number.');
      return;
    }
    const url = buildThreeCxWebclientUrl(destination);
    if (!url) {
      setError('Set VITE_3CX_WEBCLIENT_URL before using popup dialing.');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
    dialStartedAtRef.current = new Date().toISOString();
    setShowDisposition(true);
    setActionMsg(`Opened 3CX for ${displayName(selected)}.`);
    try {
      await markHmCalled(selected.id);
      if (selected.pipeline_candidate_id) {
        await logPipelineCallAction({
          candidateId: selected.pipeline_candidate_id,
          action: 'dial_workspace_call',
          outcome: 'ok',
          requestPayload: { destination, mode: 'hiring_machine_call' },
          actorLabel: actorLabelRef.current,
        });
      }
    } catch {
      // keep call flow going
    }
  };

  const saveDisposition = async () => {
    if (!selected || !disposition) return;
    if (disposition === 'Callback requested' && !callbackAt) {
      setError('Callback date and time is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (phoneInput.trim() && phoneInput.trim() !== displayPhone(selected)) {
        await updateHmPersonPhone(selected.id, phoneInput, selected.pipeline_candidate_id);
      }
      await applyHmDisposition({
        person: { ...selected, phone: phoneInput.trim() || selected.phone },
        disposition,
        comment,
        callbackAt: callbackAt || null,
        dialedNumber: normalizeDialDestination(phoneInput || displayPhone(selected)),
        dialStartedAt: dialStartedAtRef.current || new Date().toISOString(),
        actorLabel: actorLabelRef.current,
      });
      if (disposition === 'Send to AO Hub') {
        await sendAoHubEmail(selected.id);
        setActionMsg(`Sent AO Interview Hub email to ${displayName(selected)}.`);
      } else {
        setActionMsg('Disposition saved.');
      }
      setShowDisposition(false);
      setDisposition('');
      setComment('');
      setCallbackAt('');
      await load();
    } catch (err) {
      setError(stringifySupabaseError(err));
    } finally {
      setSaving(false);
    }
  };

  const selectedRecords = records.filter((r) => r.candidate_id === selected?.pipeline_candidate_id);

  return (
    <div className="hm-shell mx-auto w-full max-w-[1400px] space-y-4 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#d9cfc0] pb-4">
        <div>
          <p className="hm-kicker">Call workspace</p>
          <h1 className="font-display text-3xl text-[#1c1915]">One lead. Call. Tag.</h1>
          <p className="mt-1 text-sm text-[#5c554c]">AI-qualified Instantly replies with a phone number.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setShowHistory(true)} className="hm-btn-ghost inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs">
            <History size={14} /> History
          </button>
          <Link to="/account#recruiter-call-settings" className="hm-btn-ghost inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs">
            <Settings size={14} /> Settings
          </Link>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              void load();
            }}
            className="hm-btn-ghost inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </header>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">{error}</div>}
      {actionMsg && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-900">{actionMsg}</div>}

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="hm-card max-h-[72vh] overflow-y-auto rounded-2xl p-3">
          <p className="hm-kicker px-2 py-2">{people.length} in queue</p>
          {people.length === 0 && (
            <p className="px-2 py-6 text-sm text-[#6f675c]">Queue is empty. When Instantly gets a positive reply and AI finds a phone, they show up here.</p>
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
                    <p className={`truncate text-[11px] tabular-nums ${active ? 'text-[#d4c4a8]' : 'text-[#6f675c]'}`}>
                      {displayPhone(person)}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <section className="hm-card rounded-2xl p-5">
          {!selected ? (
            <p className="py-16 text-center text-sm text-[#6f675c]">Select someone from the queue.</p>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-3xl text-[#1c1915]">{displayName(selected)}</h2>
                  <p className="mt-1 text-sm text-[#5c554c]">{selected.email}</p>
                  {selected.campaign_name ? <p className="text-xs text-[#8a8174]">{selected.campaign_name}</p> : null}
                </div>
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
              </div>

              <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                <label className="block text-sm">
                  <span className="hm-kicker">Phone</span>
                  <input
                    value={phoneInput}
                    onChange={(e) => setPhoneInput(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-[#d9cfc0] bg-white px-3 py-2.5 tabular-nums text-[#1c1915]"
                  />
                </label>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={() => void placeCall()}
                    className="hm-btn-brass inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-medium"
                  >
                    <Phone size={16} /> Call
                  </button>
                </div>
              </div>

              <div>
                <p className="hm-kicker">AI summary {selected.ai_score != null ? `· ${selected.ai_score}` : ''}</p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#3f3a34]">
                  {selected.ai_summary || 'AI summary will appear after Groq qualifies the reply.'}
                </p>
              </div>

              <div>
                <p className="hm-kicker">Their reply</p>
                <p className="mt-2 whitespace-pre-wrap rounded-xl bg-[#faf6ef] px-4 py-3 text-sm text-[#4a453e]">
                  {selected.last_reply_text || selected.reply_snippet || 'No reply text stored yet.'}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setDisposition('Send to AO Hub');
                    setShowDisposition(true);
                  }}
                  className="hm-btn-brass rounded-full px-4 py-2 text-xs"
                >
                  Send to AO Hub
                </button>
                <button
                  type="button"
                  onClick={() => setShowDisposition(true)}
                  className="hm-btn-ghost rounded-full px-4 py-2 text-xs"
                >
                  Save disposition
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

      {showDisposition && selected && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#1c1915]/40 p-4 sm:items-center">
          <div className="hm-card w-full max-w-md rounded-2xl p-5">
            <p className="hm-kicker">After the call</p>
            <h3 className="font-display text-2xl text-[#1c1915]">{displayName(selected)}</h3>
            <label className="mt-4 block text-sm">
              <span className="text-[#6f675c]">Disposition</span>
              <select
                value={disposition}
                onChange={(e) => setDisposition(e.target.value as PipelineCallDisposition)}
                className="mt-1 w-full rounded-xl border border-[#d9cfc0] bg-white px-3 py-2"
              >
                <option value="">Select…</option>
                {HM_CALL_DISPOSITIONS.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </label>
            {disposition === 'Callback requested' && (
              <label className="mt-3 block text-sm">
                <span className="text-[#6f675c]">Callback at</span>
                <input
                  type="datetime-local"
                  value={callbackAt}
                  onChange={(e) => setCallbackAt(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-[#d9cfc0] bg-white px-3 py-2"
                />
              </label>
            )}
            <label className="mt-3 block text-sm">
              <span className="text-[#6f675c]">Note</span>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-xl border border-[#d9cfc0] bg-white px-3 py-2"
              />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setShowDisposition(false)} className="hm-btn-ghost rounded-full px-4 py-2 text-sm">
                Cancel
              </button>
              <button
                type="button"
                disabled={!disposition || saving}
                onClick={() => void saveDisposition()}
                className="hm-btn-brass rounded-full px-4 py-2 text-sm disabled:opacity-50"
              >
                {saving ? 'Saving…' : disposition === 'Send to AO Hub' ? 'Save & send email' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showHistory && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#1c1915]/40 p-4 sm:items-center">
          <div className="hm-card max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-display text-2xl text-[#1c1915]">Call history</h3>
              <button type="button" onClick={() => setShowHistory(false)} className="text-sm text-[#6f675c]">Close</button>
            </div>
            {selectedRecords.length === 0 && <p className="text-sm text-[#6f675c]">No calls logged for this person yet.</p>}
            <ul className="space-y-3">
              {selectedRecords.map((row) => (
                <li key={row.id} className="border-t border-[#eadfce] pt-3 first:border-0 first:pt-0">
                  <p className="text-sm font-medium text-[#1c1915]">{row.disposition}</p>
                  <p className="text-xs text-[#6f675c]">{row.dialed_number} · {toDatetimeLocalValue(row.disposed_at || row.created_at)}</p>
                  {row.comment ? <p className="mt-1 text-sm text-[#4a453e]">{row.comment}</p> : null}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};

export default HmCallWorkspace;
