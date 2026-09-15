import React, { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { Button, Input } from '../components/UI';
import {
  bookPublicWebinar,
  dayLabelText,
  fetchPublicUpcomingBroadcasts,
  formatBroadcastWhen,
  type PublicUpcomingBroadcast,
} from '../services/publicWebinarSchedule';

type ScheduleMode = 'pick' | 'quick';

/**
 * Public cold-email landing: candidates pick today/tomorrow sessions, or watch-soon.
 * Confirmation email is sent by WebinarGeek after a successful booking.
 */
const ScheduleWebinarPage: React.FC = () => {
  const [broadcasts, setBroadcasts] = useState<PublicUpcomingBroadcast[]>([]);
  const [quickSlot, setQuickSlot] = useState<PublicUpcomingBroadcast | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState<{ message: string; when: string } | null>(null);
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>('pick');
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
        setQuickSlot(null);
      } else {
        setBroadcasts(result.broadcasts);
        setQuickSlot(result.quickSlot);
        if (result.broadcasts.length === 1 && result.broadcasts[0]?.id != null) {
          setForm((prev) => ({ ...prev, broadcastId: String(result.broadcasts[0].id) }));
        }
        if (result.quickSlot && !result.broadcasts.length) {
          setScheduleMode('quick');
        }
      }
      setLoadingSessions(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedBroadcast = broadcasts.find((b) => String(b.id) === form.broadcastId) || null;

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!form.firstName.trim()) e.firstName = 'Required';
    if (!form.lastName.trim()) e.lastName = 'Required';
    if (!form.email.trim()) e.email = 'Required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Invalid email';
    if (!form.phone.trim()) e.phone = 'Required';
    if (scheduleMode === 'pick' && !form.broadcastId) e.broadcastId = 'Please choose a session';
    if (scheduleMode === 'quick' && !quickSlot) {
      e.broadcastId = 'No soon session is available right now. Pick a time below instead.';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    const selected = scheduleMode === 'quick' ? quickSlot : selectedBroadcast;
    try {
      setSubmitting(true);
      setErrors({});
      const result = await bookPublicWebinar({
        email: form.email.trim().toLowerCase(),
        firstname: form.firstName.trim(),
        surname: form.lastName.trim(),
        phone: form.phone.replace(/\D/g, ''),
        broadcast_id:
          scheduleMode === 'pick' && form.broadcastId ? form.broadcastId : undefined,
        webinar_id: selected?.webinar_id != null ? String(selected.webinar_id) : undefined,
        quick: scheduleMode === 'quick',
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
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    } catch (err) {
      console.error(err);
      setErrors({ _form: 'Something went wrong. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  const todayRows = broadcasts.filter((b) => b.day_label === 'today');
  const tomorrowRows = broadcasts.filter((b) => b.day_label !== 'today');

  const renderSessionList = (rows: PublicUpcomingBroadcast[], heading: string) => {
    if (!rows.length) return null;
    return (
      <div className="space-y-1">
        <p className="sticky top-0 z-[1] bg-gray-50/95 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 backdrop-blur-sm">
          {heading}
        </p>
        {rows.map((row) => {
          const id = row.id != null ? String(row.id) : '';
          if (!id) return null;
          const selected = form.broadcastId === id;
          const label = String(row.title || 'Live webinar').trim() || 'Live webinar';
          return (
            <label
              key={id}
              className={`flex min-h-[52px] cursor-pointer items-start gap-3 px-3 py-3 text-sm touch-manipulation transition active:bg-gray-50 ${
                selected
                  ? 'bg-[#005EB8]/[0.08] ring-inset ring-2 ring-[#005EB8]'
                  : 'bg-white'
              }`}
            >
              <input
                type="radio"
                name="broadcast"
                className="mt-1.5 h-4 w-4 shrink-0 accent-[#005EB8]"
                checked={selected}
                onChange={() => {
                  setScheduleMode('pick');
                  setForm({ ...form, broadcastId: id });
                }}
              />
              <span className="min-w-0 flex-1 text-left">
                <span className="block font-medium leading-snug text-gray-900">{label}</span>
                <span className="mt-0.5 block text-[13px] leading-snug text-gray-600 sm:text-sm">
                  {formatBroadcastWhen(row.date)}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    );
  };

  return (
    <Layout compactHeader hideHeaderOnScroll>
      <div className="mx-auto flex w-full max-w-lg flex-grow flex-col items-center px-3 py-5 pb-28 text-center sm:px-6 sm:py-8 sm:pb-24">
        <div className="mb-3 flex w-full justify-center sm:mb-5">
          <img
            src="/header.PNG"
            alt="AO Paz Globelife"
            className="mx-auto h-auto w-full max-w-[280px] object-contain sm:max-w-md"
            onError={(ev) => {
              (ev.target as HTMLImageElement).style.display = 'none';
            }}
          />
        </div>

        <h2 className="mb-1 w-full text-xl font-bold text-gray-900 sm:mb-2 sm:text-2xl">
          Schedule a webinar
        </h2>
        <p className="mb-1 text-sm font-medium text-[#005EB8]">AO Paz Globelife</p>
        <p className="mb-4 max-w-md text-sm leading-snug text-gray-600 sm:mb-6">
          Choose a session today or tomorrow — or start soon if you want to watch right away.
          WebinarGeek emails your join link automatically.
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
          <form onSubmit={handleSubmit} className="w-full space-y-3 text-left sm:space-y-4">
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-gray-200 bg-white p-1">
              <button
                type="button"
                onClick={() => setScheduleMode('pick')}
                className={`min-h-[44px] rounded-lg px-2 text-sm font-semibold touch-manipulation transition ${
                  scheduleMode === 'pick'
                    ? 'bg-[#005EB8] text-white shadow'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                Pick a time
              </button>
              <button
                type="button"
                onClick={() => {
                  setScheduleMode('quick');
                  setForm((prev) => ({ ...prev, broadcastId: '' }));
                }}
                disabled={!quickSlot && !loadingSessions}
                className={`min-h-[44px] rounded-lg px-2 text-sm font-semibold touch-manipulation transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  scheduleMode === 'quick'
                    ? 'bg-[#37B06D] text-white shadow'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                Watch soon
              </button>
            </div>

            {scheduleMode === 'quick' ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-900">
                {quickSlot ? (
                  <>
                    <p className="font-semibold">Start soon — no waiting for a later slot</p>
                    <p className="mt-1 text-[13px] leading-snug">
                      We&apos;ll register you for the soonest session
                      {quickSlot.starts_in_minutes
                        ? ` (about ${quickSlot.starts_in_minutes} min)`
                        : ''}
                      :{' '}
                      <span className="font-medium">{formatBroadcastWhen(quickSlot.date)}</span>
                    </p>
                  </>
                ) : (
                  <p>
                    No session starts within the next 90 minutes. Switch to{' '}
                    <button
                      type="button"
                      className="font-semibold underline"
                      onClick={() => setScheduleMode('pick')}
                    >
                      Pick a time
                    </button>
                    .
                  </p>
                )}
              </div>
            ) : (
              <fieldset className="min-w-0">
                <div className="mb-2 flex items-end justify-between gap-2">
                  <legend className="block text-sm font-medium text-gray-700">
                    Today &amp; tomorrow <span className="text-red-500">*</span>
                  </legend>
                  {!loadingSessions && broadcasts.length > 0 && (
                    <span className="shrink-0 text-xs text-gray-500">
                      {broadcasts.length} times · scroll
                    </span>
                  )}
                </div>

                {loadingSessions ? (
                  <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-600">
                    Loading sessions…
                  </p>
                ) : loadError ? (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    {loadError}
                  </p>
                ) : broadcasts.length === 0 ? (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    No sessions are open for today or tomorrow right now.
                  </p>
                ) : (
                  <div
                    className="max-h-[40vh] overflow-y-auto overscroll-contain rounded-xl border border-gray-200 bg-white [-webkit-overflow-scrolling:touch] sm:max-h-[280px]"
                    role="listbox"
                    aria-label="Today and tomorrow webinar sessions"
                  >
                    {renderSessionList(todayRows, dayLabelText('today') || 'Today')}
                    {renderSessionList(tomorrowRows, dayLabelText('tomorrow') || 'Tomorrow')}
                  </div>
                )}

                {selectedBroadcast && (
                  <p className="mt-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-[#005EB8] sm:text-sm">
                    Selected:{' '}
                    <span className="font-medium">{formatBroadcastWhen(selectedBroadcast.date)}</span>
                  </p>
                )}
                {errors.broadcastId && (
                  <p className="mt-1 text-xs text-red-600">{errors.broadcastId}</p>
                )}
              </fieldset>
            )}

            {scheduleMode === 'quick' && errors.broadcastId && (
              <p className="text-xs text-red-600">{errors.broadcastId}</p>
            )}

            <div className="grid grid-cols-1 gap-0 sm:grid-cols-2 sm:gap-4">
              <Input
                label="First Name"
                autoComplete="given-name"
                value={form.firstName}
                onChange={(ev) => setForm({ ...form, firstName: ev.target.value })}
                error={errors.firstName}
                required
                className="mb-3 sm:mb-0"
              />
              <Input
                label="Last Name"
                autoComplete="family-name"
                value={form.lastName}
                onChange={(ev) => setForm({ ...form, lastName: ev.target.value })}
                error={errors.lastName}
                required
                className="mb-3 sm:mb-0"
              />
            </div>
            <Input
              label="Email Address"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={form.email}
              onChange={(ev) => setForm({ ...form, email: ev.target.value })}
              error={errors.email}
              required
              className="mb-3 sm:mb-0"
            />
            <Input
              label="Phone Number"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={form.phone}
              onChange={(ev) => setForm({ ...form, phone: ev.target.value })}
              error={errors.phone}
              required
              className="mb-3 sm:mb-0"
            />

            {errors._form && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {errors._form}
              </p>
            )}

            <div className="sticky bottom-0 -mx-3 border-t border-gray-100 bg-[color:var(--page-bg,#F4F9F8)]/95 px-3 pt-3 backdrop-blur-sm sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:pt-1 sm:backdrop-blur-none">
              <Button
                type="submit"
                fullWidth
                disabled={
                  submitting ||
                  loadingSessions ||
                  (scheduleMode === 'pick' && broadcasts.length === 0) ||
                  (scheduleMode === 'quick' && !quickSlot)
                }
                className="min-h-[48px] shadow-lg sm:shadow-md"
              >
                {submitting
                  ? 'Scheduling…'
                  : scheduleMode === 'quick'
                  ? 'Register me for soon'
                  : 'Schedule me'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Layout>
  );
};

export default ScheduleWebinarPage;
