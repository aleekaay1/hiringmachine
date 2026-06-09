import React from 'react';
import { Button } from '../UI';
import {
  getPipelineUserCallSettings,
  savePipelineUserCallSettings,
} from '../../services/pipelineService';

const RecruiterCallSettingsPanel: React.FC = () => {
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [callExtension, setCallExtension] = React.useState('');
  const [dialingLocale, setDialingLocale] = React.useState('ca');
  const [dailyUploadTarget, setDailyUploadTarget] = React.useState<number | ''>('');
  const [dailyWebinarBookingTarget, setDailyWebinarBookingTarget] = React.useState<number | ''>('');
  const [webinarGeekCustomField, setWebinarGeekCustomField] = React.useState('');
  const [webinarGeekDefaultBroadcastId, setWebinarGeekDefaultBroadcastId] = React.useState('');

  React.useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setMessage(null);
      try {
        const settings = await getPipelineUserCallSettings();
        if (cancelled) return;
        setCallExtension(settings?.extension || '');
        setDialingLocale(settings?.dialing_locale || 'ca');
        setDailyUploadTarget(settings?.daily_upload_target ?? '');
        setDailyWebinarBookingTarget(settings?.daily_webinar_booking_target ?? '');
        setWebinarGeekCustomField(settings?.webinar_geek_custom_field || '');
        setWebinarGeekDefaultBroadcastId(settings?.webinar_geek_default_broadcast_id || '');
      } catch (e) {
        if (!cancelled) setMessage(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const onSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await savePipelineUserCallSettings({
        extension: callExtension,
        dialingLocale,
        dailyUploadTarget: dailyUploadTarget === '' ? null : Number(dailyUploadTarget),
        dailyWebinarBookingTarget: dailyWebinarBookingTarget === '' ? null : Number(dailyWebinarBookingTarget),
        webinarGeekCustomField: webinarGeekCustomField.trim() || null,
        webinarGeekDefaultBroadcastId: webinarGeekDefaultBroadcastId.trim() || null,
      });
      setMessage('Call settings saved.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section id="recruiter-call-settings" className="rounded-2xl border border-[#d6deea] bg-white p-6 shadow-sm md:p-8">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-[#0B1B34]">Recruiter call settings</h2>
        <p className="mt-1 text-sm text-[#6b84a8]">
          3CX extension, dialing locale, and daily targets for the phone workstation. Profile phone/extension above is for contact info only.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-[#6b84a8]">Loading call settings…</p>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm text-[#0B1B34]">
              3CX extension
              <input
                value={callExtension}
                onChange={(e) => setCallExtension(e.target.value)}
                placeholder="e.g. 102"
                className="mt-1 w-full rounded-xl border border-[#c8ddf4] bg-[#f8fbff] px-4 py-3 text-sm"
              />
            </label>
            <label className="block text-sm text-[#0B1B34]">
              Dialing locale
              <select
                value={dialingLocale}
                onChange={(e) => setDialingLocale(e.target.value)}
                className="mt-1 w-full rounded-xl border border-[#c8ddf4] bg-white px-4 py-3 text-sm"
              >
                <option value="ca">Canada (default)</option>
                <option value="us">United States</option>
                <option value="intl">International</option>
              </select>
            </label>
            <label className="block text-sm text-[#0B1B34]">
              Daily call target
              <input
                type="number"
                min={0}
                value={dailyUploadTarget}
                onChange={(e) => setDailyUploadTarget(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
                placeholder="e.g. 100"
                className="mt-1 w-full rounded-xl border border-[#c8ddf4] bg-[#f8fbff] px-4 py-3 text-sm"
              />
            </label>
            <label className="block text-sm text-[#0B1B34]">
              Daily booked target
              <input
                type="number"
                min={0}
                value={dailyWebinarBookingTarget}
                onChange={(e) =>
                  setDailyWebinarBookingTarget(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))
                }
                placeholder="e.g. 8"
                className="mt-1 w-full rounded-xl border border-[#c8ddf4] bg-[#f8fbff] px-4 py-3 text-sm"
              />
            </label>
            <label className="block text-sm text-[#0B1B34] md:col-span-2">
              WebinarGeek recruiter tag (optional)
              <input
                value={webinarGeekCustomField}
                onChange={(e) => setWebinarGeekCustomField(e.target.value)}
                placeholder="e.g. cooper_name — auto-detected from email when possible"
                className="mt-1 w-full rounded-xl border border-[#c8ddf4] bg-[#f8fbff] px-4 py-3 text-sm"
              />
            </label>
            <label className="block text-sm text-[#0B1B34] md:col-span-2">
              Default WebinarGeek broadcast ID (optional)
              <input
                value={webinarGeekDefaultBroadcastId}
                onChange={(e) => setWebinarGeekDefaultBroadcastId(e.target.value)}
                placeholder="Broadcast id for quick booking"
                className="mt-1 w-full rounded-xl border border-[#c8ddf4] bg-[#f8fbff] px-4 py-3 text-sm"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void onSave()} disabled={saving}>
              {saving ? 'Saving…' : 'Save call settings'}
            </Button>
            {message && <p className="text-sm text-[#4b6d95]">{message}</p>}
          </div>
        </div>
      )}
    </section>
  );
};

export default RecruiterCallSettingsPanel;
