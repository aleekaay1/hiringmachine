import React from 'react';
import { MailPlus, RefreshCw, Save, Search, Send, Square } from 'lucide-react';
import { Button } from '../components/UI';
import {
  enrollNurturePerson,
  listNurtureEnrollments,
  listNurtureSends,
  loadNurtureSequence,
  NURTURE_PREVIEW_PERSON,
  previewNurtureHtml,
  previewNurtureSubject,
  saveNurtureSequence,
  searchNurtureWatchers,
  sendNurtureDueNow,
  stopNurtureEnrollment,
  vimeoFieldError,
  type NurtureEnrollment,
  type NurtureSend,
  type NurtureSequence,
  type NurtureStep,
  type NurtureWatcher,
} from '../services/nurtureSequenceService';

type RosterFilter = 'active' | 'all' | 'stopped' | 'completed';

function formatWhen(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function personName(row: { first_name?: string | null; last_name?: string | null; email: string }): string {
  const name = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
  return name || row.email;
}

function stepLabel(row: NurtureEnrollment): string {
  if (row.status === 'completed') return 'Finished · email 6 sent';
  if (row.status === 'stopped' && row.stop_reason === 'questionnaire_submitted') {
    return 'Stopped · questionnaire submitted';
  }
  if (row.status === 'stopped' && row.stop_reason === 'unsubscribed') return 'Stopped · unsubscribed';
  if (row.status === 'stopped') return 'Stopped by staff';
  if (row.current_step <= 0) return 'Waiting for email 1';
  if (row.current_step >= 6) return 'Email 6 sent';
  return `Email ${row.current_step} sent · next is email ${row.next_step}`;
}

function statusBadge(row: NurtureEnrollment) {
  if (row.status === 'active') {
    return <span className="inline-flex rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-800">Active</span>;
  }
  if (row.status === 'completed') {
    return <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">Finished</span>;
  }
  return <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">Stopped</span>;
}

const NurtureSequencePage: React.FC = () => {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [sequence, setSequence] = React.useState<NurtureSequence | null>(null);
  const [steps, setSteps] = React.useState<NurtureStep[]>([]);
  const [selected, setSelected] = React.useState(1);
  const [saving, setSaving] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [enrollments, setEnrollments] = React.useState<NurtureEnrollment[]>([]);
  const [sends, setSends] = React.useState<NurtureSend[]>([]);
  const [rosterFilter, setRosterFilter] = React.useState<RosterFilter>('active');
  const [rosterQuery, setRosterQuery] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [firstName, setFirstName] = React.useState('');
  const [lastName, setLastName] = React.useState('');
  const [enrolling, setEnrolling] = React.useState(false);
  const [stoppingId, setStoppingId] = React.useState<string | null>(null);
  const [watcherQuery, setWatcherQuery] = React.useState('');
  const [watchers, setWatchers] = React.useState<NurtureWatcher[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [searchError, setSearchError] = React.useState<string | null>(null);

  const refreshPeople = React.useCallback(async () => {
    const [people, history] = await Promise.all([
      listNurtureEnrollments(),
      listNurtureSends(),
    ]);
    setEnrollments(people);
    setSends(history);
  }, []);

  const load = React.useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const bundle = await loadNurtureSequence();
      setSequence(bundle.sequence);
      setSteps(bundle.steps);
      await refreshPeople();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the nurture sequence');
    } finally {
      setLoading(false);
    }
  }, [refreshPeople]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const step = steps.find((item) => item.step_number === selected) || steps[0];
  const previewHtml = step ? previewNurtureHtml(step) : '';
  const vimeoError = step ? vimeoFieldError(step.vimeo_url) : null;
  const everyOtherDay = steps.slice(1).every((item) => item.delay_days === 2);

  const updateStep = (patch: Partial<NurtureStep>) => {
    setSteps((current) => current.map((item) => (
      item.step_number === selected ? { ...item, ...patch } : item
    )));
  };

  const onSave = async () => {
    if (!sequence) return;
    setError(null);
    setMsg(null);
    setSaving(true);
    try {
      await saveNurtureSequence({ enabled: sequence.enabled, steps });
      setMsg(sequence.enabled
        ? 'Sequence saved. Automatic enrollment is on for people who watched and still have no questionnaire 24 hours later.'
        : 'Sequence saved. Automatic enrollment is off. People you start by hand still send on their schedule.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the sequence');
    } finally {
      setSaving(false);
    }
  };

  const onSendDue = async () => {
    setError(null);
    setMsg(null);
    setSending(true);
    try {
      const result = await sendNurtureDueNow();
      const enrolled = result.auto_enroll?.enrolled ?? 0;
      setMsg(
        `Send due finished. Sent ${result.sent ?? 0}, failed ${result.failed ?? 0}, stopped ${result.stopped ?? 0}, skipped ${result.skipped ?? 0}. Newly enrolled ${enrolled}.`,
      );
      if (result.auto_enroll_error) {
        setError(`Automatic enrollment did not run: ${result.auto_enroll_error}`);
      }
      await refreshPeople();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send due emails');
    } finally {
      setSending(false);
    }
  };

  const onEnroll = async (input?: { email: string; firstName?: string; lastName?: string }) => {
    const target = input || { email, firstName, lastName };
    setError(null);
    setMsg(null);
    setEnrolling(true);
    try {
      const result = await enrollNurturePerson(target);
      if (result.already) setMsg(`${target.email} is already in the sequence.`);
      else if (result.resumed) setMsg(`Restarted the remaining emails for ${target.email}. The next unsent email is due now.`);
      else setMsg(`Started the sequence for ${target.email}. Email 1 is due now — use Send due now to deliver it without waiting.`);
      if (!input) {
        setEmail('');
        setFirstName('');
        setLastName('');
      }
      await refreshPeople();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the sequence');
    } finally {
      setEnrolling(false);
    }
  };

  const onSearch = async (query: string) => {
    setSearchError(null);
    setSearching(true);
    try {
      setWatchers(await searchNurtureWatchers(query));
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Could not search watchers');
    } finally {
      setSearching(false);
    }
  };

  const onStop = async (id: string) => {
    setError(null);
    setMsg(null);
    setStoppingId(id);
    try {
      await stopNurtureEnrollment(id);
      setMsg('Stopped. No further nurture emails will send to that person.');
      await refreshPeople();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not stop this person');
    } finally {
      setStoppingId(null);
    }
  };

  const visiblePeople = enrollments.filter((row) => {
    if (rosterFilter === 'active' && row.status !== 'active') return false;
    if (rosterFilter === 'stopped' && row.status !== 'stopped') return false;
    if (rosterFilter === 'completed' && row.status !== 'completed') return false;
    const q = rosterQuery.trim().toLowerCase();
    if (!q) return true;
    return personName(row).toLowerCase().includes(q) || row.email.toLowerCase().includes(q);
  });

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2 text-[#005EB8]">
            <MailPlus className="h-5 w-5" />
            <p className="text-xs font-semibold uppercase tracking-wide">Webinar</p>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Nurture emails</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Six emails for someone who watched the webinar and has not submitted the questionnaire.
            Email 1 starts 24 hours after the watch when this sequence is on, or immediately when you start someone by hand.
            Then one email every other day through email 6. Submitting the questionnaire stops the sequence.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="!min-h-0 h-10 px-3" onClick={() => void load()} disabled={loading || saving || sending}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button type="button" variant="outline" className="!min-h-0 h-10 px-3" onClick={() => void onSendDue()} disabled={loading || sending || !sequence}>
            <Send className="h-4 w-4" />
            {sending ? 'Sending…' : 'Send due now'}
          </Button>
          <Button type="button" className="!min-h-0 h-10 px-3" onClick={() => void onSave()} disabled={loading || saving || !sequence}>
            <Save className="h-4 w-4" />
            {saving ? 'Saving…' : 'Save sequence'}
          </Button>
        </div>
      </div>

      {msg && (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{msg}</p>
      )}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <p>{error}</p>
          <button type="button" className="mt-2 font-semibold text-red-800 underline" onClick={() => void load()}>
            Try again
          </button>
        </div>
      )}

      {loading && !sequence ? (
        <div className="space-y-3" aria-busy="true" aria-live="polite">
          <p className="text-sm text-slate-500">Loading the nurture sequence…</p>
          <div className="h-24 animate-pulse rounded-2xl bg-slate-100" />
          <div className="h-64 animate-pulse rounded-2xl bg-slate-100" />
          <div className="h-40 animate-pulse rounded-2xl bg-slate-100" />
        </div>
      ) : sequence && step ? (
        <>
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">{sequence.name}</h2>
                <p className="mt-1 max-w-2xl text-sm text-slate-600">
                  {everyOtherDay
                    ? 'Default cadence: email 1 at the start, then every other day. About 13–14 days for all six.'
                    : 'Later emails use the delay saved on each step. Email 1 still sends at the start of the sequence.'}
                  {' '}Turning the sequence on only enables the automatic 24-hour enrollment. People already in it keep sending either way.
                  Automatic enrollment looks at watches from the last 14 days, so older watchers are started by hand.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={sequence.enabled}
                onClick={() => setSequence({ ...sequence, enabled: !sequence.enabled })}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold ${
                  sequence.enabled
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                    : 'border-slate-200 bg-slate-50 text-slate-600'
                }`}
              >
                <span className={`h-2.5 w-2.5 rounded-full ${sequence.enabled ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                {sequence.enabled ? 'Automatic enrollment on' : 'Automatic enrollment off'}
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-500">Save the sequence to keep the switch and the six emails.</p>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-base font-semibold text-slate-900">The six emails</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {steps.map((item) => {
                const empty = !item.subject.trim() && !item.body_html.trim() && !item.vimeo_url.trim();
                const active = item.step_number === step.step_number;
                return (
                  <button
                    key={item.step_number}
                    type="button"
                    onClick={() => setSelected(item.step_number)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                      active
                        ? 'border-[#005EB8] bg-[#eef6ff] text-[#005EB8]'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Email {item.step_number}
                    {empty ? ' · empty' : ''}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="space-y-3">
                <label className="block text-sm font-medium text-slate-700">
                  Subject
                  <input
                    value={step.subject}
                    onChange={(event) => updateStep({ subject: event.target.value })}
                    placeholder={`Subject for email ${step.step_number}`}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none ring-[#005EB8]/30 focus:ring-2"
                  />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  Vimeo URL or id
                  <input
                    value={step.vimeo_url}
                    onChange={(event) => updateStep({ vimeo_url: event.target.value })}
                    placeholder="https://vimeo.com/123456789 or the video id"
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none ring-[#005EB8]/30 focus:ring-2"
                  />
                </label>
                {vimeoError && <p className="text-xs text-amber-800">{vimeoError}</p>}
                <p className="text-xs text-slate-500">
                  Sent as a clickable thumbnail and a watch link. Email apps do not show an embedded player.
                </p>
                {step.step_number === 1 ? (
                  <p className="text-sm text-slate-600">
                    Email 1 sends when the sequence starts: 24 hours after they watched, or right away if you start it by hand.
                  </p>
                ) : (
                  <label className="block text-sm font-medium text-slate-700">
                    Days after the previous email
                    <input
                      type="number"
                      min={0}
                      max={30}
                      value={step.delay_days}
                      onChange={(event) => updateStep({ delay_days: Number(event.target.value) })}
                      className="mt-1 w-28 rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none ring-[#005EB8]/30 focus:ring-2"
                    />
                  </label>
                )}
                <label className="block text-sm font-medium text-slate-700">
                  HTML body
                  <textarea
                    value={step.body_html}
                    onChange={(event) => updateStep({ body_html: event.target.value })}
                    rows={12}
                    placeholder="Paste the HTML for this email. Leave it blank until the draft is ready."
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 font-mono text-xs leading-relaxed outline-none ring-[#005EB8]/30 focus:ring-2"
                  />
                </label>
                <p className="text-xs text-slate-500">
                  Tokens: {'{{first_name}}'}, {'{{last_name}}'}, {'{{email}}'}. The company signature is added under the body when it sends.
                </p>
              </div>

              <div>
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">Preview · email {step.step_number}</h3>
                  <p className="text-xs text-slate-500">
                    Sample name {NURTURE_PREVIEW_PERSON.firstName} {NURTURE_PREVIEW_PERSON.lastName}
                  </p>
                </div>
                {!step.subject.trim() && !step.body_html.trim() && !step.vimeo_url.trim() && (
                  <p className="mt-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-sm text-slate-600">
                    Email {step.step_number} is empty. Paste a subject and HTML when the draft is ready. The signature below is the one already used on candidate email.
                  </p>
                )}
                {step.subject.trim() && (
                  <p className="mt-2 text-sm text-slate-800">
                    <span className="font-semibold text-slate-500">Subject: </span>
                    {previewNurtureSubject(step.subject)}
                  </p>
                )}
                <div
                  className="mt-2 max-h-[520px] overflow-auto rounded-xl border border-slate-200 bg-white px-4 py-4 text-sm leading-relaxed text-slate-800 [&_a]:text-[#005EB8] [&_img]:h-auto [&_img]:max-w-full"
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-base font-semibold text-slate-900">Start someone by hand</h2>
            <p className="mt-1 text-sm text-slate-600">
              Use this when you want the sequence now, without waiting 24 hours. It will not start if they already submitted the questionnaire.
            </p>
            <form
              className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.4fr_auto]"
              onSubmit={(event) => {
                event.preventDefault();
                void onEnroll();
              }}
            >
              <input
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                placeholder="First name"
                aria-label="First name"
                className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none ring-[#005EB8]/30 focus:ring-2"
              />
              <input
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                placeholder="Last name"
                aria-label="Last name"
                className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none ring-[#005EB8]/30 focus:ring-2"
              />
              <input
                required
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Email"
                aria-label="Email"
                className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none ring-[#005EB8]/30 focus:ring-2"
              />
              <Button type="submit" className="!min-h-0 h-11 px-3" disabled={enrolling}>
                {enrolling ? 'Starting…' : 'Start sequence'}
              </Button>
            </form>

            <form
              className="mt-4 flex flex-col gap-2 sm:flex-row"
              onSubmit={(event) => {
                event.preventDefault();
                void onSearch(watcherQuery);
              }}
            >
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={watcherQuery}
                  onChange={(event) => setWatcherQuery(event.target.value)}
                  placeholder="Search people who watched"
                  aria-label="Search people who watched"
                  className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm outline-none ring-[#005EB8]/30 focus:ring-2"
                />
              </div>
              <Button type="submit" variant="outline" className="!min-h-0 h-11 px-3" disabled={searching}>
                {searching ? 'Searching…' : 'Search watchers'}
              </Button>
              <Button type="button" variant="outline" className="!min-h-0 h-11 px-3" disabled={searching} onClick={() => void onSearch('')}>
                Recent watchers
              </Button>
            </form>
            {searchError && <p className="mt-2 text-sm text-red-700">{searchError}</p>}
            {watchers.length > 0 && (
              <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200">
                {watchers.map((row) => (
                  <li key={row.email} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
                    <div>
                      <p className="font-medium text-slate-900">{personName(row)}</p>
                      <p className="text-xs text-slate-500">{row.email} · watched {formatWhen(row.watched_at)}</p>
                    </div>
                    {row.questionnaire_submitted ? (
                      <span className="text-xs font-semibold text-slate-500">Questionnaire in</span>
                    ) : row.enrollment_status === 'active' ? (
                      <span className="text-xs font-semibold text-sky-800">In sequence</span>
                    ) : row.enrollment_status === 'completed' ? (
                      <span className="text-xs font-semibold text-emerald-800">Finished</span>
                    ) : (
                      <button
                        type="button"
                        className="rounded-lg border border-[#005EB8] px-2.5 py-1 text-xs font-semibold text-[#005EB8] hover:bg-sky-50 disabled:opacity-50"
                        disabled={enrolling}
                        onClick={() => void onEnroll({
                          email: row.email,
                          firstName: row.first_name || undefined,
                          lastName: row.last_name || undefined,
                        })}
                      >
                        {row.enrollment_status === 'stopped' ? 'Start again' : 'Start sequence'}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="mr-1 text-base font-semibold text-slate-900">In the sequence</h2>
              {([
                ['active', 'Active'],
                ['all', 'All'],
                ['stopped', 'Stopped'],
                ['completed', 'Finished'],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setRosterFilter(id)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${
                    rosterFilter === id
                      ? 'border-[#005EB8] bg-[#eef6ff] text-[#005EB8]'
                      : 'border-slate-200 bg-white text-slate-600'
                  }`}
                >
                  {label}
                </button>
              ))}
              <input
                value={rosterQuery}
                onChange={(event) => setRosterQuery(event.target.value)}
                placeholder="Filter by name or email"
                aria-label="Filter people in the sequence"
                className="min-w-[200px] flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none ring-[#005EB8]/30 focus:ring-2"
              />
            </div>

            {visiblePeople.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center">
                <p className="text-sm font-medium text-slate-800">No one is in this view.</p>
                <p className="mt-1 text-sm text-slate-500">
                  {enrollments.length === 0
                    ? 'Turn the sequence on and save it to enroll watchers after 24 hours, or start someone by hand.'
                    : 'Try another filter.'}
                </p>
              </div>
            ) : (
              <>
                <div className="space-y-2 md:hidden">
                  {visiblePeople.map((row) => (
                    <article key={row.id} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold text-slate-900">{personName(row)}</p>
                          <p className="text-xs text-slate-500">{row.email}</p>
                        </div>
                        {statusBadge(row)}
                      </div>
                      <p className="mt-2 text-sm text-slate-700">{stepLabel(row)}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {row.source === 'auto' ? 'Automatic' : 'Started by hand'}
                        {' · '}
                        Next send {row.status === 'active' ? formatWhen(row.next_send_at) : '—'}
                      </p>
                      {row.last_error && <p className="mt-1 text-xs text-red-700">{row.last_error}</p>}
                      {row.status === 'active' && (
                        <button
                          type="button"
                          className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-slate-600 underline disabled:opacity-50"
                          disabled={stoppingId === row.id}
                          onClick={() => void onStop(row.id)}
                        >
                          <Square className="h-3 w-3" />
                          {stoppingId === row.id ? 'Stopping…' : 'Stop'}
                        </button>
                      )}
                    </article>
                  ))}
                </div>
                <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm md:block">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2.5 font-semibold">Person</th>
                        <th className="px-3 py-2.5 font-semibold">How they started</th>
                        <th className="px-3 py-2.5 font-semibold">Where they are</th>
                        <th className="px-3 py-2.5 font-semibold">Next send</th>
                        <th className="px-3 py-2.5 font-semibold"> </th>
                      </tr>
                    </thead>
                    <tbody>
                      {visiblePeople.map((row) => (
                        <tr key={row.id} className="border-t border-slate-100 align-top">
                          <td className="px-3 py-2.5">
                            <p className="font-medium text-slate-900">{personName(row)}</p>
                            <p className="text-xs text-slate-500">{row.email}</p>
                            <div className="mt-1">{statusBadge(row)}</div>
                          </td>
                          <td className="px-3 py-2.5 text-slate-700">
                            {row.source === 'auto' ? 'Automatic, 24h after watch' : 'Started by hand'}
                            <p className="text-xs text-slate-500">Watched {formatWhen(row.watched_at)}</p>
                          </td>
                          <td className="px-3 py-2.5 text-slate-700">
                            {stepLabel(row)}
                            {row.last_error && <p className="mt-1 text-xs text-red-700">{row.last_error}</p>}
                          </td>
                          <td className="px-3 py-2.5 text-slate-700">
                            {row.status === 'active' ? formatWhen(row.next_send_at) : '—'}
                          </td>
                          <td className="px-3 py-2.5">
                            {row.status === 'active' && (
                              <button
                                type="button"
                                className="text-xs font-semibold text-slate-600 underline disabled:opacity-50"
                                disabled={stoppingId === row.id}
                                onClick={() => void onStop(row.id)}
                              >
                                {stoppingId === row.id ? 'Stopping…' : 'Stop'}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-base font-semibold text-slate-900">Recent sends</h2>
            {sends.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">No sends yet. A row is written for each attempt, including failures.</p>
            ) : (
              <ul className="mt-2 divide-y divide-slate-100">
                {sends.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                    <div>
                      <span className="font-medium text-slate-900">Email {row.step_number}</span>
                      <span className="text-slate-600"> · {row.email}</span>
                      {row.subject && <span className="text-slate-500"> · {row.subject}</span>}
                      {row.error && <p className="text-xs text-red-700">{row.error}</p>}
                    </div>
                    <p className="text-xs text-slate-500">
                      {row.status} · {formatWhen(row.sent_at || row.created_at)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
};

export default NurtureSequencePage;
