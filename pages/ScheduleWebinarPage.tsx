import React, { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { Button, Input } from '../components/UI';
import {
  bookPublicWebinar,
  fetchPublicUpcomingBroadcasts,
  formatBroadcastWhen,
  type PublicUpcomingBroadcast,
} from '../services/publicWebinarSchedule';

/**
 * Public cold-email landing: candidates pick an upcoming WebinarGeek session and register.
 * Confirmation email is sent by WebinarGeek after a successful booking.
 */
const ScheduleWebinarPage: React.FC = () => {
  const [broadcasts, setBroadcasts] = useState<PublicUpcomingBroadcast[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState<{ message: string; when: string } | null>(null);
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    broadcastId: '',
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingSessions(true);
      setLoadError('');
      const result = await fetchPublicUpcomingBroadcasts();
      if (cancelled) return;
      if (!result.ok) {
        setLoadError(result.error);
        setBroadcasts([]);
      } else {
        setBroadcasts(result.broadcasts);
        if (result.broadcasts.length === 1 && result.broadcasts[0]?.id != null) {
          setForm((prev) => ({ ...prev, broadcastId: String(result.broadcasts[0].id) }));
        }
      }
      setLoadingSessions(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!form.firstName.trim()) e.firstName = 'Required';
    if (!form.lastName.trim()) e.lastName = 'Required';
    if (!form.email.trim()) e.email = 'Required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Invalid email';
    if (!form.phone.trim()) e.phone = 'Required';
    if (!form.broadcastId) e.broadcastId = 'Please choose a session';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    const selected = broadcasts.find((b) => String(b.id) === form.broadcastId);
    try {
      setSubmitting(true);
      setErrors({});
      const result = await bookPublicWebinar({
        email: form.email.trim().toLowerCase(),
        firstname: form.firstName.trim(),
        surname: form.lastName.trim(),
        phone: form.phone.replace(/\D/g, ''),
        broadcast_id: form.broadcastId,
        webinar_id: selected?.webinar_id != null ? String(selected.webinar_id) : undefined,
      });
      if (!result.ok) {
        setErrors({ _form: result.error });
        return;
      }
      const when = formatBroadcastWhen(result.data.broadcast?.date ?? selected?.date);
      setSuccess({
        message:
          result.data.message ||
          'You are registered. Check your email for the WebinarGeek confirmation and join link.',
        when,
      });
    } catch (err) {
      console.error(err);
      setErrors({ _form: 'Something went wrong. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Layout compactHeader hideHeaderOnScroll>
      <div className="mx-auto flex w-full max-w-lg flex-grow flex-col items-center px-4 py-8 pb-24 text-center sm:p-6">
        <div className="mb-5 flex w-full justify-center">
          <img
            src="/header.PNG"
            alt="AO Paz Globelife"
            className="mx-auto h-auto w-full max-w-md object-contain"
            onError={(ev) => {
              (ev.target as HTMLImageElement).style.display = 'none';
            }}
          />
        </div>

        <h2 className="mb-2 w-full text-2xl font-bold text-gray-900">Schedule a webinar</h2>
        <p className="mb-1 text-sm font-medium text-[#005EB8]">AO Paz Globelife</p>
        <p className="mb-6 max-w-md text-sm text-gray-600">
          Pick a live session that works for you. After you register, WebinarGeek will email you the
          confirmation and join details automatically.
        </p>

        {success ? (
          <div className="w-full rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-5 text-left">
            <p className="text-base font-semibold text-emerald-900">You&apos;re registered</p>
            <p className="mt-2 text-sm text-emerald-800">{success.message}</p>
            {success.when && success.when !== 'Date TBA' && (
              <p className="mt-3 text-sm font-medium text-emerald-900">Session: {success.when}</p>
            )}
            <p className="mt-3 text-xs text-emerald-700">
              If you do not see the email in a few minutes, check spam or promotions.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="w-full space-y-4 text-left">
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="First Name"
                value={form.firstName}
                onChange={(ev) => setForm({ ...form, firstName: ev.target.value })}
                error={errors.firstName}
                required
              />
              <Input
                label="Last Name"
                value={form.lastName}
                onChange={(ev) => setForm({ ...form, lastName: ev.target.value })}
                error={errors.lastName}
                required
              />
            </div>
            <Input
              label="Email Address"
              type="email"
              value={form.email}
              onChange={(ev) => setForm({ ...form, email: ev.target.value })}
              error={errors.email}
              required
            />
            <Input
              label="Phone Number"
              type="tel"
              value={form.phone}
              onChange={(ev) => setForm({ ...form, phone: ev.target.value })}
              error={errors.phone}
              required
            />

            <fieldset>
              <legend className="mb-2 block text-sm font-medium text-gray-700">
                Choose a session <span className="text-red-500">*</span>
              </legend>
              {loadingSessions ? (
                <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-600">
                  Loading upcoming sessions…
                </p>
              ) : loadError ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  {loadError}
                </p>
              ) : broadcasts.length === 0 ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  No upcoming sessions are open right now. Please check back soon.
                </p>
              ) : (
                <div className="space-y-2">
                  {broadcasts.map((row) => {
                    const id = row.id != null ? String(row.id) : '';
                    if (!id) return null;
                    const selected = form.broadcastId === id;
                    const label = String(row.title || 'Live webinar').trim() || 'Live webinar';
                    return (
                      <label
                        key={id}
                        className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 text-sm transition ${
                          selected
                            ? 'border-[#005EB8] bg-[#005EB8]/[0.06] ring-1 ring-[#005EB8]/40'
                            : 'border-gray-200 bg-white hover:border-gray-300'
                        }`}
                      >
                        <input
                          type="radio"
                          name="broadcast"
                          className="mt-1"
                          checked={selected}
                          onChange={() => setForm({ ...form, broadcastId: id })}
                        />
                        <span className="min-w-0 flex-1 text-left">
                          <span className="block font-medium text-gray-900">{label}</span>
                          <span className="mt-0.5 block text-gray-600">
                            {formatBroadcastWhen(row.date)}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
              {errors.broadcastId && (
                <p className="mt-1 text-xs text-red-600">{errors.broadcastId}</p>
              )}
            </fieldset>

            {errors._form && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {errors._form}
              </p>
            )}

            <Button
              type="submit"
              fullWidth
              disabled={submitting || loadingSessions || broadcasts.length === 0}
              className="min-h-[48px]"
            >
              {submitting ? 'Scheduling…' : 'Schedule me'}
            </Button>
          </form>
        )}
      </div>
    </Layout>
  );
};

export default ScheduleWebinarPage;
