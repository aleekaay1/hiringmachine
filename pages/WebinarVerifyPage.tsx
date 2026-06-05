import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, CircleAlert, ExternalLink, Loader2, Search, Sparkles, Video } from 'lucide-react';
import PipelineAuthShell from '../components/PipelineAuthShell';
import { Button } from '../components/UI';
import { supabase } from '../services/supabaseClient';
import { getPipelineUserCallSettings } from '../services/pipelineService';
import { formatDateTimeCanadaEastern } from '../services/dateDisplay';
import {
  bookWebinarGeekBroadcast,
  fetchWebinarGeekBookingIdentities,
  fetchWebinarGeekUpcomingBroadcasts,
  verifyWebinarGeekEmail,
  type WebinarGeekBookingIdentity,
  type WebinarGeekUpcomingBroadcast,
  type WebinarGeekVerifyStatus,
  type WebinarGeekVerifySubscription,
} from '../services/webinarGeekIntegrations';

function formatBroadcastDate(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 'Date TBD';
  const ms = n > 1e12 ? n : n * 1000;
  return formatDateTimeCanadaEastern(new Date(ms).toISOString());
}

function splitFullName(fullName: string): { firstname: string; surname: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstname: '', surname: '' };
  if (parts.length === 1) return { firstname: parts[0], surname: '' };
  return { firstname: parts[0], surname: parts.slice(1).join(' ') };
}

function statusMeta(status: WebinarGeekVerifyStatus | null) {
  if (status === 'verified_scheduled') {
    return {
      label: 'Verified & scheduled',
      tone: 'border-emerald-200 bg-emerald-50 text-emerald-800',
      icon: CheckCircle2,
    };
  }
  if (status === 'pending_verification') {
    return {
      label: 'Scheduled — email not verified yet',
      tone: 'border-amber-200 bg-amber-50 text-amber-900',
      icon: CircleAlert,
    };
  }
  return {
    label: 'Not found in WebinarGeek',
    tone: 'border-slate-200 bg-slate-50 text-slate-600',
    icon: Search,
  };
}

const WebinarVerifyPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [email, setEmail] = React.useState(searchParams.get('email') || '');
  const [firstname, setFirstname] = React.useState(searchParams.get('first') || '');
  const [surname, setSurname] = React.useState(searchParams.get('last') || '');
  const candidateId = searchParams.get('candidateId') || '';

  const [checking, setChecking] = React.useState(false);
  const [booking, setBooking] = React.useState(false);
  const [loadingBroadcasts, setLoadingBroadcasts] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const [verifyStatus, setVerifyStatus] = React.useState<WebinarGeekVerifyStatus | null>(null);
  const [subscriptions, setSubscriptions] = React.useState<WebinarGeekVerifySubscription[]>([]);
  const [broadcasts, setBroadcasts] = React.useState<WebinarGeekUpcomingBroadcast[]>([]);
  const [selectedBroadcastId, setSelectedBroadcastId] = React.useState('');
  const [bookingIdentities, setBookingIdentities] = React.useState<WebinarGeekBookingIdentity[]>([]);
  const [loadingIdentities, setLoadingIdentities] = React.useState(false);
  const [selectedLinkTag, setSelectedLinkTag] = React.useState('');

  React.useEffect(() => {
    const name = searchParams.get('name') || '';
    if (!firstname && !surname && name.trim()) {
      const split = splitFullName(name);
      setFirstname(split.firstname);
      setSurname(split.surname);
    }
  }, [searchParams, firstname, surname]);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const settings = await getPipelineUserCallSettings();
        if (cancelled) return;
        setSelectedBroadcastId(settings?.webinar_geek_default_broadcast_id || '');
        const settingsTag = settings?.webinar_geek_custom_field || '';
        if (settingsTag) setSelectedLinkTag(settingsTag);
      } catch {
        /* optional settings */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoadingIdentities(true);
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) return;
        const result = await fetchWebinarGeekBookingIdentities(token);
        if (cancelled || !result.ok) return;
        const rows = Array.isArray(result.data.identities)
          ? (result.data.identities as WebinarGeekBookingIdentity[])
          : [];
        setBookingIdentities(rows);
        setSelectedLinkTag((prev) => {
          if (prev && rows.some((row) => row.tag === prev)) return prev;
          return rows[0]?.tag || prev;
        });
      } finally {
        if (!cancelled) setLoadingIdentities(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoadingBroadcasts(true);
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) return;
        const result = await fetchWebinarGeekUpcomingBroadcasts(token);
        if (cancelled || !result.ok) return;
        const rows = Array.isArray(result.data.broadcasts)
          ? (result.data.broadcasts as WebinarGeekUpcomingBroadcast[])
          : [];
        setBroadcasts(rows);
        setSelectedBroadcastId((prev) => {
          if (prev && rows.some((row) => String(row.id) === prev)) return prev;
          return rows[0]?.id != null ? String(rows[0].id) : prev;
        });
      } finally {
        if (!cancelled) setLoadingBroadcasts(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const getToken = async (): Promise<string> => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('Sign in to use the webinar portal.');
    return token;
  };

  const runVerify = async () => {
    const normalized = email.trim().toLowerCase();
    if (!normalized) {
      setError('Enter the candidate email first.');
      return;
    }
    setChecking(true);
    setError(null);
    setMessage(null);
    try {
      const token = await getToken();
      const result = await verifyWebinarGeekEmail(token, normalized);
      if (!result.ok) throw new Error(result.error);
      const status = (result.data.status as WebinarGeekVerifyStatus) || 'not_found';
      const rows = Array.isArray(result.data.subscriptions)
        ? (result.data.subscriptions as WebinarGeekVerifySubscription[])
        : [];
      setVerifyStatus(status);
      setSubscriptions(rows);
      if (status === 'verified_scheduled') {
        setMessage('They are verified in WebinarGeek and show as scheduled.');
      } else if (status === 'pending_verification') {
        setMessage('They are registered but still need to confirm the WebinarGeek email.');
      } else {
        setMessage('No subscription found for this email yet.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setVerifyStatus(null);
      setSubscriptions([]);
    } finally {
      setChecking(false);
    }
  };

  const runBook = async () => {
    const normalized = email.trim().toLowerCase();
    if (!normalized || !firstname.trim() || !selectedBroadcastId) {
      setError('Email, first name, and a broadcast slot are required to book.');
      return;
    }
    if (!surname.trim()) {
      setError('Last name is required — WebinarGeek rejects bookings without a surname.');
      return;
    }
    if (!selectedLinkTag.trim()) {
      setError('Choose a Cooper/RMS registration link to book as.');
      return;
    }
    setBooking(true);
    setError(null);
    setMessage(null);
    try {
      const token = await getToken();
      const selected = broadcasts.find((row) => String(row.id) === selectedBroadcastId);
      const result = await bookWebinarGeekBroadcast(token, {
        email: normalized,
        firstname: firstname.trim(),
        surname: surname.trim() || undefined,
        broadcastId: selectedBroadcastId,
        webinarId: selected?.webinar_id != null ? String(selected.webinar_id) : undefined,
        customField: selectedLinkTag.trim(),
        candidateId: candidateId || undefined,
      });
      if (!result.ok) throw new Error(result.error);
      setMessage(String(result.data.message || 'Webinar booked through the portal.'));
      await runVerify();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBooking(false);
    }
  };

  const status = statusMeta(verifyStatus);
  const StatusIcon = status.icon;

  return (
    <PipelineAuthShell
      title="Webinar verify"
      subtitle="Quick WebinarGeek check & booking for callers"
      redirectPath="/pipeline/webinar-verify"
    >
      <div className="min-h-screen bg-gradient-to-br from-[#eef4ff] via-[#f8fbff] to-[#ede9fe] p-4 md:p-8">
        <div className="mx-auto max-w-2xl">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-600 text-white shadow-lg shadow-violet-300/40">
              <Video className="h-6 w-6" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-[#0B1B34]">Webinar verify</h1>
            <p className="mt-1 text-sm text-[#4b6d95]">
              Check if they confirmed WebinarGeek, or book them directly from here.
            </p>
          </div>

          <div className="space-y-4">
            <section className="rounded-3xl border border-white/80 bg-white/90 p-5 shadow-[0_20px_60px_-40px_rgba(79,70,229,0.45)] backdrop-blur">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#0B1B34]">
                <Search className="h-4 w-4 text-violet-600" />
                Verify registration
              </div>
              <p className="mt-1 text-xs text-[#6b84a8]">
                Paste the email they used (or will use) for WebinarGeek and hit Check.
              </p>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void runVerify();
                  }}
                  placeholder="candidate@email.com"
                  className="flex-1 rounded-xl border border-[#c8ddf4] bg-white px-3 py-2.5 text-sm text-[#0B1B34] outline-none ring-violet-200 focus:ring-2"
                />
                <Button
                  className="!min-h-0 h-11 px-5 bg-violet-600 hover:bg-violet-700 text-white border-0"
                  onClick={() => void runVerify()}
                  disabled={checking}
                >
                  {checking ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Checking…
                    </>
                  ) : (
                    'Check'
                  )}
                </Button>
              </div>

              {verifyStatus && (
                <div className={`mt-4 flex items-start gap-2 rounded-2xl border px-3 py-3 text-sm ${status.tone}`}>
                  <StatusIcon className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-semibold">{status.label}</p>
                    {message && <p className="mt-1 text-xs opacity-90">{message}</p>}
                  </div>
                </div>
              )}

              {subscriptions.length > 0 && (
                <div className="mt-4 space-y-2">
                  {subscriptions.map((row) => (
                    <div
                      key={String(row.id ?? `${row.email}-${row.created_at}`)}
                      className="rounded-2xl border border-[#dbe8f8] bg-[#f8fbff] px-3 py-3 text-xs text-[#365274]"
                    >
                      <p className="font-semibold text-[#0B1B34]">
                        {[row.firstname, row.surname].filter(Boolean).join(' ') || row.email || 'Subscriber'}
                      </p>
                      <p className="mt-1">{row.email}</p>
                      <p className="mt-1">
                        {row.webinar_title || 'Webinar'} · {formatBroadcastDate(row.broadcast_date)}
                      </p>
                      <p className="mt-1">
                        Email verified: {row.email_verified ? 'Yes' : 'No'} · Source:{' '}
                        {String(row.registration_source || '—')}
                      </p>
                      {row.custom_field && (
                        <p className="mt-1">Tag: {String(row.custom_field)}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-3xl border border-white/80 bg-white/90 p-5 shadow-[0_20px_60px_-40px_rgba(59,130,246,0.35)] backdrop-blur">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#0B1B34]">
                <Sparkles className="h-4 w-4 text-sky-600" />
                Book webinar
              </div>
              <p className="mt-1 text-xs text-[#6b84a8]">
                Registers them via WebinarGeek using your Cooper/RMS registration link.
              </p>

              <div className="mt-4 space-y-3 rounded-2xl border border-[#dbe8f8] bg-[#f8fbff] px-3 py-3">
                <p className="text-xs font-semibold text-[#0B1B34]">Book as</p>
                {loadingIdentities ? (
                  <p className="text-xs text-[#6b84a8]">Loading your registration links…</p>
                ) : (
                  <div className="space-y-2">
                    {bookingIdentities.map((identity) => (
                      <label
                        key={identity.tag}
                        className={`flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2 text-xs ${
                          selectedLinkTag === identity.tag
                            ? 'border-sky-300 bg-white text-[#0B1B34]'
                            : 'border-transparent bg-white/70 text-[#365274]'
                        }`}
                      >
                        <input
                          type="radio"
                          name="booking-as"
                          className="mt-0.5"
                          checked={selectedLinkTag === identity.tag}
                          onChange={() => setSelectedLinkTag(identity.tag)}
                        />
                        <span>
                          <span className="font-semibold">{identity.label}</span>
                          <span className="mt-0.5 block font-mono text-[10px] text-[#6b84a8]">{identity.tag}</span>
                        </span>
                      </label>
                    ))}
                    {!bookingIdentities.length && (
                      <p className="text-[11px] text-amber-800">
                        No Cooper/RMS links matched your first name yet. Add a tag in Pipeline settings, or ask admin to
                        run the booking-links SQL migration if this page is slow.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-medium text-[#365274]">
                  First name
                  <input
                    value={firstname}
                    onChange={(e) => setFirstname(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-[#c8ddf4] px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-xs font-medium text-[#365274]">
                  Last name
                  <input
                    value={surname}
                    onChange={(e) => setSurname(e.target.value)}
                    required
                    className="mt-1 w-full rounded-xl border border-[#c8ddf4] px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-xs font-medium text-[#365274] sm:col-span-2">
                  Email (same as verify)
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-[#c8ddf4] px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-xs font-medium text-[#365274] sm:col-span-2">
                  Upcoming session
                  <select
                    value={selectedBroadcastId}
                    onChange={(e) => setSelectedBroadcastId(e.target.value)}
                    disabled={loadingBroadcasts || !broadcasts.length}
                    className="mt-1 w-full rounded-xl border border-[#c8ddf4] px-3 py-2 text-sm"
                  >
                    {!broadcasts.length && <option value="">No upcoming broadcasts loaded</option>}
                    {broadcasts.map((row) => (
                      <option key={String(row.id)} value={String(row.id)}>
                        {row.title || `Broadcast ${row.id}`} · {formatBroadcastDate(row.date)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button
                  className="!min-h-0 h-11 px-5 bg-[#005EB8] hover:bg-[#004a93] text-white border-0"
                  onClick={() => void runBook()}
                  disabled={booking || loadingBroadcasts || !selectedLinkTag.trim() || !bookingIdentities.length}
                >
                  {booking ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Booking…
                    </>
                  ) : (
                    'Book webinar'
                  )}
                </Button>
                <a
                  href="/pipeline-settings"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#005EB8] hover:underline"
                >
                  Pipeline settings
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </section>

            {error && (
              <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
            )}
            {message && !verifyStatus && (
              <p className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">{message}</p>
            )}
          </div>
        </div>
      </div>
    </PipelineAuthShell>
  );
};

export default WebinarVerifyPage;
