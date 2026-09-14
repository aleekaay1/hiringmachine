import React from 'react';
import {
  FileSpreadsheet,
  Pause,
  Play,
  RefreshCw,
  Send,
  Settings2,
  Square,
  Upload,
} from 'lucide-react';
import {
  cancelBulkCampaign,
  createBulkCampaign,
  defaultBulkEmailBody,
  getBulkSettings,
  listBulkCampaigns,
  pauseBulkCampaign,
  processBulkNext,
  resumeBulkCampaign,
  saveBulkSettings,
  sendBulkTestEmail,
  sleep,
  type BulkAppSettings,
  type BulkCampaign,
  type BulkProgress,
  type BulkProvider,
} from '../services/bulkEmailService';
import {
  guessColumn,
  mapRecipients,
  parseSpreadsheetFile,
  type MappedRecipient,
  type SpreadsheetTable,
} from '../services/bulkEmailSpreadsheet';

type Tab = 'compose' | 'settings' | 'campaigns';

const PROVIDER_LABELS: Record<BulkProvider, string> = {
  smtp: 'SMTP (active)',
  instantly: 'Instantly',
  apollo: 'Apollo',
  billionmail: 'BillionMail',
};

function strField(obj: Record<string, unknown> | undefined, key: string): string {
  const v = obj?.[key];
  return typeof v === 'string' ? v : '';
}

const BulkEmailPage: React.FC = () => {
  const [tab, setTab] = React.useState<Tab>('compose');
  const [error, setError] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);

  const [table, setTable] = React.useState<SpreadsheetTable | null>(null);
  const [fileName, setFileName] = React.useState<string>('');
  const [nameCol, setNameCol] = React.useState('');
  const [emailCol, setEmailCol] = React.useState('');
  const [recipients, setRecipients] = React.useState<MappedRecipient[]>([]);
  const [skipped, setSkipped] = React.useState(0);

  const [campaignName, setCampaignName] = React.useState('');
  const [subject, setSubject] = React.useState('Opportunity with AO Globe Life');
  const [body, setBody] = React.useState(defaultBulkEmailBody());
  const [gapSeconds, setGapSeconds] = React.useState(60);
  const [dailyCap, setDailyCap] = React.useState(500);
  const [provider, setProvider] = React.useState<BulkProvider>('smtp');

  const [settings, setSettings] = React.useState<BulkAppSettings | null>(null);
  const [smtpFrom, setSmtpFrom] = React.useState('');
  const [dailySent, setDailySent] = React.useState(0);
  const [instantlyKey, setInstantlyKey] = React.useState('');
  const [instantlyWorkspace, setInstantlyWorkspace] = React.useState('');
  const [apolloKey, setApolloKey] = React.useState('');
  const [apolloBase, setApolloBase] = React.useState('https://api.apollo.io');
  const [billionApiUrl, setBillionApiUrl] = React.useState('');
  const [billionApiKey, setBillionApiKey] = React.useState('');
  const [savingSettings, setSavingSettings] = React.useState(false);

  const [campaigns, setCampaigns] = React.useState<BulkCampaign[]>([]);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState<BulkProgress | null>(null);
  const [sending, setSending] = React.useState(false);
  const [testTo, setTestTo] = React.useState('');
  const [testName, setTestName] = React.useState('Alex');
  const [testing, setTesting] = React.useState(false);
  const stopRef = React.useRef(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const loadSettings = React.useCallback(async () => {
    try {
      const data = await getBulkSettings();
      setSettings(data.settings);
      setSmtpFrom(data.smtp_from);
      setDailySent(data.daily_sent);
      setGapSeconds(data.settings.gap_seconds || 60);
      setDailyCap(Math.min(500, data.settings.daily_cap || 500));
      setProvider((data.settings.default_provider as BulkProvider) || 'smtp');
      setInstantlyKey(strField(data.settings.instantly, 'api_key'));
      setInstantlyWorkspace(strField(data.settings.instantly, 'workspace'));
      setApolloKey(strField(data.settings.apollo, 'api_key'));
      setApolloBase(strField(data.settings.apollo, 'base_url') || 'https://api.apollo.io');
      setBillionApiUrl(strField(data.settings.billionmail, 'api_url'));
      setBillionApiKey(strField(data.settings.billionmail, 'api_key'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load settings');
    }
  }, []);

  const loadCampaigns = React.useCallback(async () => {
    try {
      const list = await listBulkCampaigns();
      setCampaigns(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load campaigns');
    }
  }, []);

  React.useEffect(() => {
    void loadSettings();
    void loadCampaigns();
  }, [loadSettings, loadCampaigns]);

  React.useEffect(() => {
    if (!table) {
      setRecipients([]);
      setSkipped(0);
      return;
    }
    try {
      const mapped = mapRecipients(table, nameCol, emailCol);
      setRecipients(mapped.recipients);
      setSkipped(mapped.skipped);
      setError(null);
    } catch (err) {
      setRecipients([]);
      setError(err instanceof Error ? err.message : 'Mapping failed');
    }
  }, [table, nameCol, emailCol]);

  const onFile = async (file: File | null) => {
    if (!file) return;
    setError(null);
    setMsg(null);
    try {
      const parsed = await parseSpreadsheetFile(file);
      if (!parsed.headers.length) throw new Error('No columns found in file');
      setTable(parsed);
      setFileName(file.name);
      setEmailCol(guessColumn(parsed.headers, 'email') || parsed.headers[0]);
      setNameCol(guessColumn(parsed.headers, 'name') || '');
      setCampaignName(file.name.replace(/\.[^.]+$/, ''));
      setMsg(`Loaded ${parsed.rows.length} rows from ${file.name}`);
    } catch (err) {
      setTable(null);
      setError(err instanceof Error ? err.message : 'Upload failed');
    }
  };

  const onSaveSettings = async () => {
    setSavingSettings(true);
    setError(null);
    try {
      const saved = await saveBulkSettings({
        gap_seconds: gapSeconds,
        daily_cap: Math.min(500, dailyCap),
        default_provider: provider,
        smtp: { from: smtpFrom, note: 'Uses Edge secrets SMTP_*' },
        instantly: { api_key: instantlyKey, workspace: instantlyWorkspace },
        apollo: { api_key: apolloKey, base_url: apolloBase },
        billionmail: { api_url: billionApiUrl, api_key: billionApiKey },
      });
      setSettings(saved);
      setMsg('Settings saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingSettings(false);
    }
  };

  const runSendLoop = async (campaignId: string) => {
    setSending(true);
    stopRef.current = false;
    setActiveId(campaignId);
    setTab('campaigns');
    try {
      while (!stopRef.current) {
        const result = await processBulkNext(campaignId);
        setProgress(result);
        setDailySent(result.daily_sent);
        if (result.daily_cap_hit) {
          setMsg(`Paused: daily cap (${result.daily_cap}) reached for ${result.from_email}. Resume tomorrow.`);
          break;
        }
        if (result.paused) {
          setMsg('Campaign paused');
          break;
        }
        if (result.done) {
          setMsg(`Finished. Sent ${result.sent}, failed ${result.failed}.`);
          break;
        }
        const gap = Math.max(5, Number(result.gap_seconds || gapSeconds) || 60);
        setMsg(
          result.sent_one
            ? `Sent to ${result.to}. Waiting ${gap}s before next…`
            : result.failed_one
              ? `Failed one (${result.error}). Waiting ${gap}s…`
              : `Waiting ${gap}s…`,
        );
        await sleep(gap * 1000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send loop failed');
    } finally {
      setSending(false);
      await loadCampaigns();
      await loadSettings();
    }
  };

  const onSendTest = async () => {
    setError(null);
    setMsg(null);
    if (!testTo.trim() || !testTo.includes('@')) {
      setError('Enter a valid test email address');
      return;
    }
    if (!subject.trim() || !body.trim()) {
      setError('Subject and body are required for a test send');
      return;
    }
    setTesting(true);
    try {
      const result = await sendBulkTestEmail({
        to: testTo.trim(),
        name: testName.trim() || 'there',
        subject: subject.trim(),
        bodyText: body.trim(),
        fromEmail: smtpFrom,
      });
      setDailySent(result.daily_sent);
      setMsg(`Test sent to ${result.to} — subject “${result.subject}”.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test send failed');
    } finally {
      setTesting(false);
    }
  };

  const onStart = async () => {
    setError(null);
    setMsg(null);
    if (!recipients.length) {
      setError('Upload a file and map name/email columns first');
      return;
    }
    if (!subject.trim() || !body.trim()) {
      setError('Subject and body are required');
      return;
    }
    if (provider !== 'smtp') {
      setError(`${PROVIDER_LABELS[provider]} is for settings only right now. Switch provider to SMTP to send.`);
      return;
    }
    try {
      const created = await createBulkCampaign({
        name: campaignName || fileName || 'Bulk campaign',
        subject: subject.trim(),
        bodyText: body.trim(),
        gapSeconds,
        dailyCap: Math.min(500, dailyCap),
        provider: 'smtp',
        fromEmail: smtpFrom,
        sourceFile: fileName,
        emailColumn: emailCol,
        nameColumn: nameCol,
        recipients: recipients.map((r) => ({
          name: r.name,
          email: r.email,
          row_index: r.rowIndex,
          raw: r.raw,
        })),
      });
      setMsg(`Campaign created with ${created.total} recipients. Starting…`);
      await loadCampaigns();
      await runSendLoop(created.campaign_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start campaign');
    }
  };

  const previewRows = recipients.slice(0, 12);
  const mergePreviewName = recipients[0]?.name || 'Alex Candidate';
  const mergePreviewEmail = recipients[0]?.email || 'alex@example.com';
  const first = mergePreviewName.split(/\s+/)[0] || 'there';
  const previewSubject = subject
    .replace(/\{\{\s*name\s*\}\}/gi, mergePreviewName)
    .replace(/\{\{\s*full_?name\s*\}\}/gi, mergePreviewName)
    .replace(/\{\{\s*first_?name\s*\}\}/gi, first)
    .replace(/\{\{\s*email\s*\}\}/gi, mergePreviewEmail);
  const previewBody = body
    .replace(/\{\{\s*name\s*\}\}/gi, mergePreviewName)
    .replace(/\{\{\s*full_?name\s*\}\}/gi, mergePreviewName)
    .replace(/\{\{\s*first_?name\s*\}\}/gi, first)
    .replace(/\{\{\s*email\s*\}\}/gi, mergePreviewEmail);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="hm-kicker">Outreach</p>
          <h1 className="font-[Fraunces] text-3xl text-[#1f2a24]">Bulk email</h1>
          <p className="mt-1 max-w-xl text-sm text-[#6f675c]">
            Upload CSV/Excel, map name & email, preview, then send via SMTP with gaps (max 500/day per sending address).
          </p>
        </div>
        <div className="rounded-xl border border-[#e6e0d4] bg-[#fbf8f2] px-4 py-2 text-sm text-[#3f3a32]">
          Today: <strong>{dailySent}</strong> / {dailyCap} from {smtpFrom || 'SMTP'}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ['compose', 'Compose & send'],
            ['settings', 'Settings & more'],
            ['campaigns', 'Campaigns'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded-full px-4 py-2 text-xs font-medium ${
              tab === id ? 'hm-btn-brass' : 'border border-[#ddd5c6] bg-white text-[#5a5348]'
            }`}
          >
            {id === 'settings' ? (
              <span className="inline-flex items-center gap-1.5">
                <Settings2 size={14} /> {label}
              </span>
            ) : (
              label
            )}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}
      {msg && (
        <div className="rounded-xl border border-[#d9e5d4] bg-[#f3f8f1] px-4 py-3 text-sm text-[#2f4a38]">{msg}</div>
      )}

      {tab === 'compose' && (
        <div className="space-y-6">
        <section className="rounded-2xl border border-[#e6e0d4] bg-white p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="hm-kicker">Test email</p>
              <p className="mt-1 text-sm text-[#6f675c]">
                Send one copy of the current subject/body via SMTP before a mass send. Subject is prefixed with [TEST].
              </p>
            </div>
            <button
              type="button"
              disabled={testing || sending}
              onClick={() => void onSendTest()}
              className="hm-btn-brass inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs disabled:opacity-50"
            >
              <Send size={14} />
              {testing ? 'Sending test…' : 'Send test email'}
            </button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-[#6f675c]">
              Send test to
              <input
                type="email"
                className="mt-1 w-full rounded-lg border border-[#e0d8ca] px-3 py-2 text-sm"
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
                placeholder="you@globelife-paz.com"
              />
            </label>
            <label className="block text-xs text-[#6f675c]">
              Merge name (for {'{{first_name}}'} / {'{{name}}'})
              <input
                className="mt-1 w-full rounded-lg border border-[#e0d8ca] px-3 py-2 text-sm"
                value={testName}
                onChange={(e) => setTestName(e.target.value)}
                placeholder="Alex"
              />
            </label>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="space-y-4 rounded-2xl border border-[#e6e0d4] bg-white p-5">
            <p className="hm-kicker">1 · Upload</p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => void onFile(e.target.files?.[0] || null)}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[#cfc5b2] bg-[#fbf8f2] px-4 py-8 text-sm text-[#5a5348] hover:border-[#a8926a]"
            >
              <Upload size={18} />
              {fileName ? `Replace file (${fileName})` : 'Upload CSV or Excel'}
            </button>

            {table && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-xs text-[#6f675c]">
                    Name column
                    <select
                      className="mt-1 w-full rounded-lg border border-[#e0d8ca] bg-white px-3 py-2 text-sm"
                      value={nameCol}
                      onChange={(e) => setNameCol(e.target.value)}
                    >
                      <option value="">— optional —</option>
                      {table.headers.map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-xs text-[#6f675c]">
                    Email column
                    <select
                      className="mt-1 w-full rounded-lg border border-[#e0d8ca] bg-white px-3 py-2 text-sm"
                      value={emailCol}
                      onChange={(e) => setEmailCol(e.target.value)}
                    >
                      {table.headers.map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <p className="text-xs text-[#6f675c]">
                  <FileSpreadsheet size={12} className="mr-1 inline" />
                  {recipients.length} valid emails
                  {skipped > 0 ? ` · ${skipped} skipped (invalid/duplicate)` : ''}
                </p>
                <div className="overflow-auto rounded-xl border border-[#eee7db]">
                  <table className="min-w-full text-left text-xs">
                    <thead className="bg-[#f7f3eb] text-[#6f675c]">
                      <tr>
                        <th className="px-3 py-2 font-medium">Name</th>
                        <th className="px-3 py-2 font-medium">Email</th>
                        <th className="px-3 py-2 font-medium">Row</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((r) => (
                        <tr key={`${r.email}-${r.rowIndex}`} className="border-t border-[#f0ebe2]">
                          <td className="px-3 py-2 text-[#3f3a32]">{r.name || '—'}</td>
                          <td className="px-3 py-2 text-[#3f3a32]">{r.email}</td>
                          <td className="px-3 py-2 text-[#8a8276]">{r.rowIndex}</td>
                        </tr>
                      ))}
                      {!previewRows.length && (
                        <tr>
                          <td colSpan={3} className="px-3 py-4 text-[#8a8276]">No valid rows yet — check column mapping.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  {recipients.length > previewRows.length && (
                    <p className="border-t border-[#f0ebe2] px-3 py-2 text-[11px] text-[#8a8276]">
                      Showing first {previewRows.length} of {recipients.length}
                    </p>
                  )}
                </div>
              </>
            )}
          </section>

          <section className="space-y-4 rounded-2xl border border-[#e6e0d4] bg-white p-5">
            <p className="hm-kicker">2 · Message & pace</p>
            <label className="block text-xs text-[#6f675c]">
              Campaign name
              <input
                className="mt-1 w-full rounded-lg border border-[#e0d8ca] px-3 py-2 text-sm"
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
              />
            </label>
            <label className="block text-xs text-[#6f675c]">
              Subject
              <input
                className="mt-1 w-full rounded-lg border border-[#e0d8ca] px-3 py-2 text-sm"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </label>
            <label className="block text-xs text-[#6f675c]">
              Body (use {'{{first_name}}'}, {'{{name}}'}, {'{{email}}'})
              <textarea
                className="mt-1 min-h-[180px] w-full rounded-lg border border-[#e0d8ca] px-3 py-2 text-sm leading-relaxed"
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs text-[#6f675c]">
                Gap between emails (sec)
                <input
                  type="number"
                  min={5}
                  max={3600}
                  className="mt-1 w-full rounded-lg border border-[#e0d8ca] px-3 py-2 text-sm"
                  value={gapSeconds}
                  onChange={(e) => setGapSeconds(Number(e.target.value) || 60)}
                />
              </label>
              <label className="block text-xs text-[#6f675c]">
                Daily cap (max 500)
                <input
                  type="number"
                  min={1}
                  max={500}
                  className="mt-1 w-full rounded-lg border border-[#e0d8ca] px-3 py-2 text-sm"
                  value={dailyCap}
                  onChange={(e) => setDailyCap(Math.min(500, Number(e.target.value) || 500))}
                />
              </label>
            </div>
            <label className="block text-xs text-[#6f675c]">
              Provider
              <select
                className="mt-1 w-full rounded-lg border border-[#e0d8ca] bg-white px-3 py-2 text-sm"
                value={provider}
                onChange={(e) => setProvider(e.target.value as BulkProvider)}
              >
                {(Object.keys(PROVIDER_LABELS) as BulkProvider[]).map((p) => (
                  <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
                ))}
              </select>
            </label>
            <div className="rounded-xl bg-[#f7f3eb] px-3 py-3 text-xs text-[#5a5348]">
              <p className="hm-kicker mb-1">Preview</p>
              <p className="font-medium text-[#1f2a24]">{previewSubject}</p>
              <pre className="mt-2 whitespace-pre-wrap font-[IBM_Plex_Sans] text-[12px] leading-relaxed">{previewBody}</pre>
            </div>
            <button
              type="button"
              disabled={sending || !recipients.length}
              onClick={() => void onStart()}
              className="hm-btn-brass inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm disabled:opacity-50"
            >
              <Play size={16} />
              {sending ? 'Sending…' : `Start SMTP send (${recipients.length})`}
            </button>
          </section>
        </div>
        </div>
      )}

      {tab === 'settings' && (
        <section className="space-y-5 rounded-2xl border border-[#e6e0d4] bg-white p-5">
          <p className="hm-kicker">Providers</p>
          <p className="text-sm text-[#6f675c]">
            Outbound bulk sends use <strong>SMTP</strong> (Gmail Edge secrets). Instantly, Apollo, and BillionMail credentials are stored here for integrations — sending through those APIs is not enabled yet.
          </p>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-[#e6e0d4] p-4">
              <h3 className="font-medium text-[#1f2a24]">SMTP</h3>
              <p className="mt-1 text-xs text-[#8a8276]">From: {smtpFrom || '—'} · Cap 500/day · Gaps between sends</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <label className="text-xs text-[#6f675c]">
                  Default gap (sec)
                  <input
                    type="number"
                    min={5}
                    max={3600}
                    className="mt-1 w-full rounded-lg border border-[#e0d8ca] px-3 py-2 text-sm"
                    value={gapSeconds}
                    onChange={(e) => setGapSeconds(Number(e.target.value) || 60)}
                  />
                </label>
                <label className="text-xs text-[#6f675c]">
                  Default daily cap
                  <input
                    type="number"
                    min={1}
                    max={500}
                    className="mt-1 w-full rounded-lg border border-[#e0d8ca] px-3 py-2 text-sm"
                    value={dailyCap}
                    onChange={(e) => setDailyCap(Math.min(500, Number(e.target.value) || 500))}
                  />
                </label>
              </div>
            </div>

            <div className="rounded-xl border border-[#e6e0d4] p-4">
              <h3 className="font-medium text-[#1f2a24]">Instantly</h3>
              <label className="mt-2 block text-xs text-[#6f675c]">
                API key
                <input
                  type="password"
                  className="mt-1 w-full rounded-lg border border-[#e0d8ca] px-3 py-2 text-sm"
                  value={instantlyKey}
                  onChange={(e) => setInstantlyKey(e.target.value)}
                  placeholder="instantly api key"
                />
              </label>
              <label className="mt-2 block text-xs text-[#6f675c]">
                Workspace / notes
                <input
                  className="mt-1 w-full rounded-lg border border-[#e0d8ca] px-3 py-2 text-sm"
                  value={instantlyWorkspace}
                  onChange={(e) => setInstantlyWorkspace(e.target.value)}
                />
              </label>
            </div>

            <div className="rounded-xl border border-[#e6e0d4] p-4">
              <h3 className="font-medium text-[#1f2a24]">Apollo</h3>
              <label className="mt-2 block text-xs text-[#6f675c]">
                API key
                <input
                  type="password"
                  className="mt-1 w-full rounded-lg border border-[#e0d8ca] px-3 py-2 text-sm"
                  value={apolloKey}
                  onChange={(e) => setApolloKey(e.target.value)}
                />
              </label>
              <label className="mt-2 block text-xs text-[#6f675c]">
                Base URL
                <input
                  className="mt-1 w-full rounded-lg border border-[#e0d8ca] px-3 py-2 text-sm"
                  value={apolloBase}
                  onChange={(e) => setApolloBase(e.target.value)}
                />
              </label>
            </div>

            <div className="rounded-xl border border-[#e6e0d4] p-4">
              <h3 className="font-medium text-[#1f2a24]">BillionMail</h3>
              <label className="mt-2 block text-xs text-[#6f675c]">
                API URL
                <input
                  className="mt-1 w-full rounded-lg border border-[#e0d8ca] px-3 py-2 text-sm"
                  value={billionApiUrl}
                  onChange={(e) => setBillionApiUrl(e.target.value)}
                  placeholder="https://…"
                />
              </label>
              <label className="mt-2 block text-xs text-[#6f675c]">
                API key
                <input
                  type="password"
                  className="mt-1 w-full rounded-lg border border-[#e0d8ca] px-3 py-2 text-sm"
                  value={billionApiKey}
                  onChange={(e) => setBillionApiKey(e.target.value)}
                />
              </label>
            </div>
          </div>

          <button
            type="button"
            disabled={savingSettings}
            onClick={() => void onSaveSettings()}
            className="hm-btn-brass inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs disabled:opacity-50"
          >
            {savingSettings ? 'Saving…' : 'Save settings'}
          </button>
          {settings?.updated_at && (
            <p className="text-[11px] text-[#8a8276]">Last saved {new Date(settings.updated_at).toLocaleString()}</p>
          )}
        </section>
      )}

      {tab === 'campaigns' && (
        <section className="space-y-4 rounded-2xl border border-[#e6e0d4] bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="hm-kicker">Recent campaigns</p>
            <button
              type="button"
              onClick={() => void loadCampaigns()}
              className="inline-flex items-center gap-1.5 rounded-full border border-[#ddd5c6] px-3 py-1.5 text-xs text-[#5a5348]"
            >
              <RefreshCw size={12} /> Refresh
            </button>
          </div>

          {progress && activeId && (
            <div className="rounded-xl border border-[#d9e5d4] bg-[#f3f8f1] px-4 py-3 text-sm text-[#2f4a38]">
              Active: {progress.sent} sent · {progress.failed} failed · {progress.pending} pending
              {sending && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-full border border-[#b7c9b4] px-3 py-1 text-xs"
                    onClick={() => {
                      stopRef.current = true;
                      void pauseBulkCampaign(activeId).then(setProgress);
                    }}
                  >
                    <Pause size={12} /> Pause
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-full border border-red-200 px-3 py-1 text-xs text-red-700"
                    onClick={() => {
                      stopRef.current = true;
                      void cancelBulkCampaign(activeId).then(setProgress);
                    }}
                  >
                    <Square size={12} /> Cancel remaining
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="overflow-auto rounded-xl border border-[#eee7db]">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-[#f7f3eb] text-[#6f675c]">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Progress</th>
                  <th className="px-3 py-2">Created</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.id} className="border-t border-[#f0ebe2]">
                    <td className="px-3 py-2 text-[#3f3a32]">
                      <div className="font-medium">{c.name}</div>
                      <div className="text-[11px] text-[#8a8276]">{c.subject}</div>
                    </td>
                    <td className="px-3 py-2 capitalize text-[#3f3a32]">{c.status}</td>
                    <td className="px-3 py-2 text-[#3f3a32]">
                      {c.sent_count}/{c.total_count}
                      {c.failed_count ? ` · ${c.failed_count} fail` : ''}
                    </td>
                    <td className="px-3 py-2 text-[#8a8276]">
                      {new Date(c.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
                      {(c.status === 'queued' || c.status === 'paused' || c.status === 'sending') && (
                        <button
                          type="button"
                          disabled={sending}
                          className="hm-btn-brass rounded-full px-3 py-1 text-[11px] disabled:opacity-50"
                          onClick={() => {
                            void (async () => {
                              if (c.status === 'paused') await resumeBulkCampaign(c.id);
                              await runSendLoop(c.id);
                            })();
                          }}
                        >
                          {c.status === 'paused' ? 'Resume' : 'Continue'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {!campaigns.length && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-[#8a8276]">No campaigns yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
};

export default BulkEmailPage;
