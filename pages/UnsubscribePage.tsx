import React from 'react';
import { useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { CheckCircle, Loader2 } from 'lucide-react';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const UnsubscribePage: React.FC = () => {
  const [params] = useSearchParams();
  const emailFromQuery = (params.get('email') || '').trim().toLowerCase();
  const [email, setEmail] = React.useState(emailFromQuery);
  const [status, setStatus] = React.useState<'idle' | 'loading' | 'done' | 'error'>(
    emailFromQuery ? 'loading' : 'idle',
  );
  const [error, setError] = React.useState<string | null>(null);

  const submit = React.useCallback(async (addr: string) => {
    const normalized = addr.trim().toLowerCase();
    if (!normalized || !normalized.includes('@')) {
      setError('Enter a valid email address.');
      setStatus('error');
      return;
    }
    if (!SUPABASE_URL || !ANON) {
      setError('App is not configured.');
      setStatus('error');
      return;
    }
    setStatus('loading');
    setError(null);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/hm-bulk-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: ANON,
        },
        body: JSON.stringify({ action: 'unsubscribe', email: normalized, source: 'public_page' }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
      setEmail(normalized);
      setStatus('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not unsubscribe');
      setStatus('error');
    }
  }, []);

  React.useEffect(() => {
    if (emailFromQuery) void submit(emailFromQuery);
  }, [emailFromQuery, submit]);

  return (
    <Layout compactHeader>
      <div className="flex flex-grow flex-col items-center justify-center p-6 text-center animate-fade-in">
        {status === 'done' ? (
          <>
            <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-green-50 text-[#37B06D]">
              <CheckCircle size={48} />
            </div>
            <h2 className="mb-2 text-3xl font-bold text-gray-900">You're unsubscribed</h2>
            <p className="mb-2 text-sm font-medium text-[#005EB8]">AO Paz Globelife</p>
            <p className="max-w-md text-gray-600">
              <strong>{email}</strong> will no longer receive our recruiting offers.
            </p>
          </>
        ) : (
          <>
            <h2 className="mb-2 text-3xl font-bold text-gray-900">Unsubscribe</h2>
            <p className="mb-6 max-w-md text-gray-600">
              Opt out of AO Globe Life recruiting offers. You can reach out anytime if you change your mind.
            </p>
            <form
              className="flex w-full max-w-md flex-col gap-3 text-left"
              onSubmit={(e) => {
                e.preventDefault();
                void submit(email);
              }}
            >
              <label className="text-sm text-gray-700">
                Email address
                <input
                  type="email"
                  required
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </label>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button
                type="submit"
                disabled={status === 'loading'}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#1f2a24] px-4 py-3 text-sm font-medium text-white disabled:opacity-60"
              >
                {status === 'loading' ? <Loader2 className="animate-spin" size={16} /> : null}
                {status === 'loading' ? 'Working…' : 'Unsubscribe me'}
              </button>
            </form>
          </>
        )}
      </div>
    </Layout>
  );
};

export default UnsubscribePage;
