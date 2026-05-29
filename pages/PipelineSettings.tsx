import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import { Button } from '../components/UI';
import { supabase } from '../services/supabaseClient';
import {
  getPipelineUserCallSettings,
  savePipelineUserCallSettings,
} from '../services/pipelineService';

const PipelineSettings: React.FC = () => {
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [extension, setExtension] = useState('');
  const [dialingLocale, setDialingLocale] = useState('ca');
  const [dailyWebinarBookingTarget, setDailyWebinarBookingTarget] = useState<number | ''>('');

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setAuthenticated(Boolean(data.session));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setMessage(null);
      try {
        const settings = await getPipelineUserCallSettings();
        if (cancelled) return;
        setExtension(settings?.extension || '');
        setDialingLocale(settings?.dialing_locale || 'ca');
        setDailyWebinarBookingTarget(settings?.daily_webinar_booking_target ?? '');
      } catch (e) {
        if (!cancelled) {
          setMessage(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [authenticated]);

  if (!authenticated) {
    return (
      <Layout isAdmin>
        <div className="mx-auto w-full max-w-3xl p-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h1 className="text-xl font-semibold text-slate-900">Pipeline settings</h1>
            <p className="mt-2 text-sm text-slate-600">
              Sign in first, then reopen this page from the pipeline screen.
            </p>
            <Link to="/pipeline" className="mt-4 inline-block text-sm font-semibold text-[#005EB8] hover:underline">
              Go to pipeline
            </Link>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout isAdmin>
      <div className="mx-auto w-full max-w-3xl p-6">
        <div className="rounded-3xl border border-[#c8ddf4] bg-white p-6 shadow-[0_24px_64px_-36px_rgba(11,27,52,0.45)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold text-[#0B1B34]">Pipeline call settings</h1>
              <p className="mt-1 text-sm text-[#365274]">
                Saved per user and attached to dial, disposition, evaluation, and timeline logs.
              </p>
            </div>
            <Link to="/pipeline" className="text-sm font-semibold text-[#005EB8] hover:text-[#0B1B34]">
              Back to pipeline
            </Link>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <label className="text-sm text-[#0B1B34]">
              Extension
              <input
                value={extension}
                onChange={(e) => setExtension(e.target.value)}
                placeholder="e.g. 102"
                className="mt-1 w-full rounded-xl border border-[#b8d2ef] bg-white px-3 py-2 text-sm text-[#0B1B34]"
              />
            </label>
            <label className="text-sm text-[#0B1B34] md:col-span-2">
              Dialing locale
              <select
                value={dialingLocale}
                onChange={(e) => setDialingLocale(e.target.value)}
                className="mt-1 w-full rounded-xl border border-[#b8d2ef] bg-white px-3 py-2 text-sm text-[#0B1B34]"
              >
                <option value="ca">Canada (default)</option>
                <option value="us">United States</option>
                <option value="intl">International</option>
              </select>
            </label>
            <label className="text-sm text-[#0B1B34] md:col-span-2">
              Daily webinar booking target
              <input
                type="number"
                min={0}
                step={1}
                value={dailyWebinarBookingTarget}
                onChange={(e) => {
                  const next = e.target.value;
                  setDailyWebinarBookingTarget(next === '' ? '' : Math.max(0, Number(next)));
                }}
                placeholder="e.g. 8"
                className="mt-1 w-full rounded-xl border border-[#b8d2ef] bg-white px-3 py-2 text-sm text-[#0B1B34]"
              />
            </label>
          </div>

          <div className="mt-6 flex items-center gap-3">
            <Button
              onClick={async () => {
                setSaving(true);
                setMessage(null);
                try {
                  await savePipelineUserCallSettings({
                    extension,
                    dialingLocale,
                    dailyWebinarBookingTarget:
                      dailyWebinarBookingTarget === '' ? null : Number(dailyWebinarBookingTarget),
                  });
                  setMessage('Settings saved.');
                } catch (e) {
                  setMessage(e instanceof Error ? e.message : String(e));
                } finally {
                  setSaving(false);
                }
              }}
              disabled={saving || loading}
            >
              {saving ? 'Saving…' : 'Save settings'}
            </Button>
            {(loading || message) && (
              <p className="text-sm text-[#365274]">{loading ? 'Loading settings…' : message}</p>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default PipelineSettings;
