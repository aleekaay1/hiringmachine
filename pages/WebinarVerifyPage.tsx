import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, CircleAlert, Loader2, Search, Video } from 'lucide-react';
import PipelineAuthShell from '../components/PipelineAuthShell';
import { Button } from '../components/UI';
import { supabase } from '../services/supabaseClient';
import { formatDateTimeCanadaEastern } from '../services/dateDisplay';
import {
  verifyWebinarGeekEmail,
  type WebinarGeekVerifyStatus,
  type WebinarGeekVerifySubscription,
} from '../services/webinarGeekIntegrations';

function formatBroadcastDate(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 'Date TBD';
  const ms = n > 1e12 ? n : n * 1000;
  return formatDateTimeCanadaEastern(new Date(ms).toISOString());
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
  const [checking, setChecking] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [verifyStatus, setVerifyStatus] = React.useState<WebinarGeekVerifyStatus | null>(null);
  const [subscriptions, setSubscriptions] = React.useState<WebinarGeekVerifySubscription[]>([]);

  React.useEffect(() => {
    const fromQuery = searchParams.get('email') || '';
    if (fromQuery) setEmail(fromQuery);
  }, [searchParams]);

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
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Sign in to use the webinar portal.');
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
        setMessage('Registered in WebinarGeek, but they have not confirmed the invitation email yet.');
      } else {
        setMessage('No matching WebinarGeek registration found for this email.');
      }
    } catch (e) {
      setVerifyStatus(null);
      setSubscriptions([]);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  };

  React.useEffect(() => {
    const fromQuery = (searchParams.get('email') || '').trim();
    if (!fromQuery) return;
    void runVerify();
    // Auto-check once when opened with ?email= from Call workspace
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const status = statusMeta(verifyStatus);
  const StatusIcon = status.icon;

  return (
    <PipelineAuthShell
      title="Webinar verify"
      subtitle="Check WebinarGeek registration and email verification"
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
              Paste an email to see if they registered and verified in WebinarGeek.
            </p>
          </div>

          <div className="space-y-4">
            <section className="rounded-3xl border border-white/80 bg-white/90 p-5 shadow-[0_20px_60px_-40px_rgba(79,70,229,0.45)] backdrop-blur">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#0B1B34]">
                <Search className="h-4 w-4 text-violet-600" />
                Verify registration
              </div>
              <p className="mt-1 text-xs text-[#6b84a8]">
                Paste the email they used for WebinarGeek and hit Check.
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
                      {row.phone && <p className="mt-1">{row.phone}</p>}
                      <p className="mt-1">
                        {row.webinar_title || 'Webinar'} · {formatBroadcastDate(row.broadcast_date)}
                      </p>
                      <p className="mt-1">
                        Email verified: {row.email_verified ? 'Yes' : 'No'} · Watched:{' '}
                        {row.watched ? 'Yes' : 'No'} · Source: {String(row.registration_source || '—')}
                      </p>
                      {row.custom_field && (
                        <p className="mt-1">Tag: {String(row.custom_field)}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {error && (
              <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
            )}
          </div>
        </div>
      </div>
    </PipelineAuthShell>
  );
};

export default WebinarVerifyPage;
