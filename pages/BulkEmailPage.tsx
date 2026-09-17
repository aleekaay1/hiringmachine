import React from 'react';
import {
  FileSpreadsheet,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  Send,
  Settings2,
  Square,
  Upload,
} from 'lucide-react';
import {
  cancelBulkCampaign,
  clearBulkDraftLeads,
  createBulkCampaign,
  defaultBulkEmailBody,
  applyBulkMerge,
  getBulkCampaign,
  getBulkSettings,
  listBulkCampaigns,
  listBulkDraftLeads,
  looksLikeHtml,
  pauseBulkCampaign,
  resumeBulkCampaign,
  listBulkRecipients,
  tickBulkCampaigns,
  getBulkCampaignStatus,
  getBulkEmailStats,
  saveBulkDraftLeads,
  saveBulkSettings,
  saveBulkTemplate,
  sendBulkTestEmail,
  sleep,
  splitBulkEmailBody,
  updateBulkCampaign,
  withBulkUnsubscribePreview,
  type BulkAppSettings,
  type BulkCampaign,
  type BulkEmailStats,
  type BulkProgress,
  type BulkProvider,
  type BulkRecipientRow,
  type BulkSmtpAccountUsage,
} from '../services/bulkEmailService';
import {
  guessColumn,
  mapRecipients,
  parseSpreadsheetFile,
  type MappedRecipient,
  type SpreadsheetTable,
} from '../services/bulkEmailSpreadsheet';

type Tab = 'compose' | 'settings' | 'campaigns' | 'stats';

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
  const [gapSeconds, setGapSeconds] = React.useState(120);
  const [dailyCap, setDailyCap] = React.useState(500);
  const [provider, setProvider] = React.useState<BulkProvider>('smtp');
  const [stats, setStats] = React.useState<BulkEmailStats | null>(null);
  const [loadingStats, setLoadingStats] = React.useState(false);
  const [businessDay, setBusinessDay] = React.useState<string>('');

  const [settings, setSettings] = React.useState<BulkAppSettings | null>(null);
  const [smtpFrom, setSmtpFrom] = React.useState('auto');
  const [smtpAccounts, setSmtpAccounts] = React.useState<BulkSmtpAccountUsage[]>([]);
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
  const [editingCampaignId, setEditingCampaignId] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState<BulkProgress | null>(null);
  const [leads, setLeads] = React.useState<BulkRecipientRow[]>([]);
  const [leadFilter, setLeadFilter] = React.useState<'all' | 'pending' | 'sent' | 'failed'>('all');
  const [leadQuery, setLeadQuery] = React.useState('');
  const [loadingLeads, setLoadingLeads] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [pausing, setPausing] = React.useState(false);
  const [savingCampaign, setSavingCampaign] = React.useState(false);
  const [testTo, setTestTo] = React.useState('');
  const [testName, setTestName] = React.useState('Alex');
  const [testing, setTesting] = React.useState(false);
  const [savingDraft, setSavingDraft] = React.useState(false);
  const [draftSavedAt, setDraftSavedAt] = React.useState<string | null>(null);
  const [hydrated, setHydrated] = React.useState(false);
  const stopRef = React.useRef(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const skipNextLeadPersist = React.useRef(false);

  const loadSettings = React.useCallback(async () => {
    try {
      const data = await getBulkSettings();
      setSettings(data.settings);
      setSmtpAccounts(data.smtp_accounts || []);
      const savedFrom = data.settings.draft_from_email || '';
      setSmtpFrom(() => {
        const preferred = savedFrom || 'auto';
        if (preferred === 'auto') return 'auto';
        // Never stick to suspended aopaz — force rotation onto apply/careers.
        if (preferred.includes('aopaz@')) return 'auto';
        if (data.smtp_accounts.some((a) => a.email === preferred)) return preferred;
        return 'auto';
      });
      setDailySent(
        data.smtp_accounts.reduce((sum, a) => sum + (a.daily_sent || 0), 0) || data.daily_sent,
      );
      setGapSeconds(Math.max(90, data.settings.draft_gap_seconds || data.settings.gap_seconds || 120));
      setDailyCap(Math.min(500, data.settings.draft_daily_cap || data.settings.daily_cap || 500));
      setBusinessDay(data.business_day || '');
      setProvider((data.settings.default_provider as BulkProvider) || 'smtp');
      setInstantlyKey(strField(data.settings.instantly, 'api_key'));
      setInstantlyWorkspace(strField(data.settings.instantly, 'workspace'));
      setApolloKey(strField(data.settings.apollo, 'api_key'));
      setApolloBase(strField(data.settings.apollo, 'base_url') || 'https://api.apollo.io');
      setBillionApiUrl(strField(data.settings.billionmail, 'api_url'));
      setBillionApiKey(strField(data.settings.billionmail, 'api_key'));

      if (data.settings.template_subject) setSubject(data.settings.template_subject);
      if (typeof data.settings.template_body === 'string' && data.settings.template_body.length) {
        setBody(data.settings.template_body);
      }
      if (data.settings.draft_campaign_name) setCampaignName(data.settings.draft_campaign_name);
      if (data.settings.draft_source_file) setFileName(data.settings.draft_source_file);
      if (data.settings.draft_name_column != null) setNameCol(data.settings.draft_name_column || '');
      if (data.settings.draft_email_column) setEmailCol(data.settings.draft_email_column);

      // Restore template first; leads load in pages so large lists don't wipe the whole page.
      setHydrated(true);

      if (data.draft_leads_count > 0) {
        setMsg(`Restoring ${data.draft_leads_count} saved leads…`);
        const draftLeads = await listBulkDraftLeads();
        skipNextLeadPersist.current = true;
        setRecipients(
          draftLeads.map((lead, idx) => ({
            name: String(lead.full_name || ''),
            email: String(lead.email || '').toLowerCase(),
            rowIndex: typeof lead.row_index === 'number' ? lead.row_index : idx + 2,
            raw: (lead.raw || {}) as Record<string, string>,
          })),
        );
        setSkipped(0);
        setDraftSavedAt(new Date().toISOString());
        setMsg(`Restored ${draftLeads.length} saved leads and your HTML template.`);
      } else if (data.settings.template_body || data.settings.template_subject) {
        setDraftSavedAt(data.settings.updated_at || new Date().toISOString());
        setMsg('Restored your saved email template.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load settings');
      setHydrated(true);
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

  // Poll campaign list only — cron owns sending (avoids 3/min bursts from tab + worker).
  const hasServerCampaigns = campaigns.some((c) => c.status === 'sending' || c.status === 'queued');
  React.useEffect(() => {
    if (!hasServerCampaigns) return;
    const id = window.setInterval(() => {
      void loadCampaigns();
      void loadSettings();
    }, 15_000);
    return () => window.clearInterval(id);
  }, [hasServerCampaigns, loadCampaigns, loadSettings]);

  const loadStats = React.useCallback(async () => {
    setLoadingStats(true);
    try {
      const data = await getBulkEmailStats(activeId || undefined);
      setStats(data);
      setBusinessDay(data.business_day || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load stats');
    } finally {
      setLoadingStats(false);
    }
  }, [activeId]);

  React.useEffect(() => {
    if (tab !== 'stats') return;
    void loadStats();
    const id = window.setInterval(() => void loadStats(), 20_000);
    return () => window.clearInterval(id);
  }, [tab, loadStats]);

  React.useEffect(() => {
    if (!table) return;
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

  // Auto-save HTML/plain template + compose fields.
  React.useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const saved = await saveBulkTemplate({
            subject,
            body,
            campaignName,
            fromEmail: smtpFrom,
            sourceFile: fileName,
            nameColumn: nameCol,
            emailColumn: emailCol,
            gapSeconds,
            dailyCap,
          });
          setSettings(saved);
          setDraftSavedAt(saved.updated_at || new Date().toISOString());
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Could not auto-save template');
        }
      })();
    }, 900);
    return () => window.clearTimeout(timer);
  }, [hydrated, subject, body, campaignName, smtpFrom, fileName, nameCol, emailCol, gapSeconds, dailyCap]);

  // Persist mapped leads whenever the recipient list changes from upload/mapping.
  React.useEffect(() => {
    if (!hydrated) return;
    if (skipNextLeadPersist.current) {
      skipNextLeadPersist.current = false;
      return;
    }
    if (!table && !recipients.length) return;
    if (!recipients.length && !fileName) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        setSavingDraft(true);
        try {
          const saved = await saveBulkDraftLeads({
            recipients: recipients.map((r) => ({
              name: r.name,
              email: r.email,
              row_index: r.rowIndex,
              raw: r.raw,
            })),
            sourceFile: fileName,
            nameColumn: nameCol,
            emailColumn: emailCol,
            campaignName,
          });
          setDraftSavedAt(new Date().toISOString());
          setMsg(`Saved ${saved.total} leads to the database.`);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Could not save leads');
        } finally {
          setSavingDraft(false);
        }
      })();
    }, 700);
    return () => window.clearTimeout(timer);
  }, [hydrated, recipients, table, fileName, nameCol, emailCol, campaignName]);

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

  const onClearDraftLeads = async () => {
    setError(null);
    try {
      await clearBulkDraftLeads();
      skipNextLeadPersist.current = true;
      setTable(null);
      setRecipients([]);
      setSkipped(0);
      setFileName('');
      setNameCol('');
      setEmailCol('');
      setMsg('Cleared saved leads.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not clear leads');
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

  const waitGap = React.useCallback(async (seconds: number) => {
    const end = Date.now() + Math.max(1, seconds) * 1000;
    while (Date.now() < end) {
      if (stopRef.current) return;
      await sleep(Math.min(200, end - Date.now()));
    }
  }, []);

  const onPauseCampaign = async (campaignId: string) => {
    stopRef.current = true;
    setPausing(true);
    setMsg('Pausing now…');
    try {
      const result = await pauseBulkCampaign(campaignId);
      setProgress(result);
      setActiveId(campaignId);
      setMsg('Campaign paused. You can edit it, then Resume.');
      await loadCampaigns();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not pause');
    } finally {
      setPausing(false);
    }
  };

  const loadLeads = React.useCallback(async (campaignId: string) => {
    setLoadingLeads(true);
    try {
      const data = await listBulkRecipients(campaignId, {
        status: leadFilter === 'all' ? '' : leadFilter,
        q: leadQuery,
      });
      setLeads(data.recipients);
      if (data.campaign) {
        setProgress({
          campaign: data.campaign,
          pending: data.pending || 0,
          sent: data.sent || 0,
          failed: data.failed || 0,
          daily_sent: data.daily_sent || 0,
          daily_cap: data.daily_cap || dailyCap,
          from_email: data.from_email || smtpFrom,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load leads');
    } finally {
      setLoadingLeads(false);
    }
  }, [leadFilter, leadQuery, dailyCap, smtpFrom]);

  React.useEffect(() => {
    if (!activeId) return;
    void loadLeads(activeId);
  }, [activeId, leadFilter, leadQuery, loadLeads]);

  // Live refresh while a campaign is selected (Instantly-style dashboard).
  React.useEffect(() => {
    if (!activeId) return;
    const status = progress?.campaign?.status;
    const live = sending || status === 'sending' || status === 'queued';
    if (!live) return;
    const id = window.setInterval(() => {
      void loadLeads(activeId);
      void loadCampaigns();
    }, 8000);
    return () => window.clearInterval(id);
  }, [activeId, sending, progress?.campaign?.status, loadLeads, loadCampaigns]);

  const runSendLoop = async (campaignId: string) => {
    setSending(true);
    stopRef.current = false;
    setActiveId(campaignId);
    setTab('campaigns');
    setMsg('Campaign is running on the server. You can close this page — sending continues.');
    try {
      // Server cron is the source of truth; this tab only accelerates while open.
      void tickBulkCampaigns().catch(() => undefined);
      await loadLeads(campaignId);
      while (!stopRef.current) {
        // Nudge the server worker each cycle; do not own the send lifecycle in the browser.
        const tick = await tickBulkCampaigns().catch(() => null);
        const status = await getBulkCampaignStatus(campaignId);
        setProgress(status);
        setDailySent(status.daily_sent);
        await loadLeads(campaignId);

        if (status.campaign?.status === 'paused' || status.paused) {
          setMsg('Campaign paused');
          break;
        }
        if (status.daily_cap_hit || status.campaign?.status === 'paused') {
          setMsg(
            `Paused: daily cap (${status.daily_cap}) reached for ${status.from_email || 'sender'}. Resume tomorrow.`,
          );
          break;
        }
        if (status.done || status.campaign?.status === 'completed' || (status.pending || 0) === 0) {
          setMsg(`Finished. Sent ${status.sent}, failed ${status.failed}.`);
          break;
        }
        if (status.campaign?.status === 'cancelled') {
          setMsg('Campaign cancelled');
          break;
        }

        const gap = Math.max(5, Number(status.gap_seconds || gapSeconds) || 60);
        const tickResults = Array.isArray((tick as { results?: unknown })?.results)
          ? ((tick as { results: Array<Record<string, unknown>> }).results)
          : [];
        const last = tickResults.length ? tickResults[tickResults.length - 1] : null;
        setMsg(
          last?.sent_one
            ? `Sent to ${String(last.to || 'lead')}. Server keeps going if you close this page.`
            : `Server sending… ${status.sent} sent · ${status.pending} remaining (safe to close).`,
        );
        await waitGap(Math.min(gap, 20));
        if (stopRef.current) break;
      }
    } catch (err) {
      // Tab errors must never pause the campaign — cron continues.
      setError(err instanceof Error ? err.message : 'Browser helper stopped — server is still sending');
      try {
        const status = await getBulkCampaignStatus(campaignId);
        setProgress(status);
      } catch {
        /* ignore */
      }
    } finally {
      setSending(false);
      await loadCampaigns();
      await loadSettings();
      await loadLeads(campaignId);
    }
  };

  const onEditCampaign = async (campaignId: string) => {
    setError(null);
    try {
      const data = await getBulkCampaign(campaignId);
      const c = data.campaign;
      setEditingCampaignId(c.id);
      setCampaignName(c.name || '');
      setSubject(c.subject || '');
      const rawBody = (c.body_html && String(c.body_html).trim()) || c.body_text || '';
      setBody(rawBody);
      setGapSeconds(Math.max(90, c.gap_seconds || 120));
      setDailyCap(Math.min(500, c.daily_cap || 500));
      setSmtpFrom(c.from_email || 'auto');
      setActiveId(c.id);
      if (data.pending != null || data.sent != null) {
        setProgress({
          campaign: c,
          pending: data.pending || 0,
          sent: data.sent || 0,
          failed: data.failed || 0,
          daily_sent: data.daily_sent || 0,
          daily_cap: data.daily_cap || c.daily_cap || 500,
          from_email: data.from_email || c.from_email || 'auto',
        });
      }
      setTab('compose');
      setMsg(
        `Editing “${c.name}” (${c.status}). Save changes below, or pause first if it’s still sending.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load campaign');
    }
  };

  const onSaveCampaignEdits = async () => {
    if (!editingCampaignId) return;
    setError(null);
    if (!subject.trim() || !body.trim()) {
      setError('Subject and body are required');
      return;
    }
    setSavingCampaign(true);
    try {
      const parts = splitBulkEmailBody(body);
      const updated = await updateBulkCampaign({
        campaignId: editingCampaignId,
        name: campaignName || undefined,
        subject: subject.trim(),
        bodyText: parts.bodyText,
        bodyHtml: parts.bodyHtml,
        gapSeconds,
        dailyCap: Math.min(500, dailyCap),
        fromEmail: smtpFrom,
      });
      setMsg(`Saved edits to “${updated.name}”.`);
      await loadCampaigns();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save campaign');
    } finally {
      setSavingCampaign(false);
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
      const parts = splitBulkEmailBody(body);
      const result = await sendBulkTestEmail({
        to: testTo.trim(),
        name: testName.trim() || 'there',
        subject: subject.trim(),
        bodyText: parts.bodyText,
        bodyHtml: parts.bodyHtml,
        fromEmail: smtpFrom,
      });
      setDailySent(result.daily_sent);
      if (result.smtp_accounts?.length) setSmtpAccounts(result.smtp_accounts);
      setMsg(`Test sent from ${result.from_email} to ${result.to} — subject “${result.subject}”.`);
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
      const parts = splitBulkEmailBody(body);
      const created = await createBulkCampaign({
        name: campaignName || fileName || 'Bulk campaign',
        subject: subject.trim(),
        bodyText: parts.bodyText,
        bodyHtml: parts.bodyHtml,
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
      // Keep draft leads/template in DB so refresh still restores them.
      await loadCampaigns();
      await runSendLoop(created.campaign_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start campaign');
    }
  };

  const previewRows = recipients.slice(0, 12);
  const mergePreviewName = recipients[0]?.name || testName || 'Alex Candidate';
  const mergePreviewEmail = recipients[0]?.email || testTo || 'alex@example.com';
  const previewSubject = applyBulkMerge(subject, mergePreviewName, mergePreviewEmail);
  const previewParts = splitBulkEmailBody(applyBulkMerge(body, mergePreviewName, mergePreviewEmail));
  const previewHtmlWithUnsub = withBulkUnsubscribePreview(
    previewParts.bodyHtml || '<p></p>',
    mergePreviewEmail,
  );
  const bodyIsHtml = looksLikeHtml(body);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="hm-kicker">Outreach</p>
          <h1 className="font-[Fraunces] text-3xl text-[#1f2a24]">Bulk email</h1>
          <p className="mt-1 max-w-xl text-sm text-[#6f675c]">
            Upload CSV/Excel, map name & email, preview, then send via SMTP with gaps (max 500/day per sending address).
            Auto-rotate alternates apply@ ↔ careers@ so one mailbox never takes the full load. Campaigns keep sending if you close this tab.
          </p>
        </div>
        <div className="rounded-xl border border-[#e6e0d4] bg-[#fbf8f2] px-4 py-2 text-sm text-[#3f3a32]">
          Today ({businessDay || 'Pacific'}):{' '}
          <strong>
            {smtpAccounts.length
              ? smtpAccounts.reduce((s, a) => s + a.daily_sent, 0)
              : dailySent}
          </strong>
          {' / '}
          {(smtpAccounts[0]?.daily_cap || dailyCap) * Math.max(1, smtpAccounts.length || 1)} across{' '}
          {smtpAccounts.length || 1} sender{smtpAccounts.length === 1 ? '' : 's'}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ['compose', 'Compose & send'],
            ['settings', 'Settings & more'],
            ['campaigns', 'Campaigns'],
            ['stats', 'Stats'],
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
                Send one copy of the current subject/body via SMTP before a mass send.
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
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
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
            <label className="block text-xs text-[#6f675c]">
              Send from
              <select
                className="mt-1 w-full rounded-lg border border-[#e0d8ca] bg-white px-3 py-2 text-sm"
                value={smtpFrom}
                onChange={(e) => setSmtpFrom(e.target.value)}
              >
                <option value="auto">Auto (best remaining capacity)</option>
                {smtpAccounts.map((a) => (
                  <option key={a.email} value={a.email}>
                    {a.email} · {a.daily_sent}/{a.daily_cap}
                  </option>
                ))}
              </select>
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
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#8a8276]">
              <span>
                {savingDraft
                  ? 'Saving leads…'
                  : draftSavedAt
                    ? `Draft saved ${new Date(draftSavedAt).toLocaleString()}`
                    : 'Template & leads auto-save to the database'}
              </span>
              {recipients.length > 0 && (
                <button
                  type="button"
                  onClick={() => void onClearDraftLeads()}
                  className="rounded-full border border-[#ddd5c6] px-3 py-1 text-[11px] text-[#5a5348]"
                >
                  Clear saved leads
                </button>
              )}
            </div>

            {table && (
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
            )}

            {(table || recipients.length > 0) && (
              <>
                <p className="text-xs text-[#6f675c]">
                  <FileSpreadsheet size={12} className="mr-1 inline" />
                  {recipients.length} valid emails
                  {skipped > 0 ? ` · ${skipped} skipped (invalid/duplicate)` : ''}
                  {!table && recipients.length > 0 ? ' · restored from database' : ''}
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
            {editingCampaignId && (
              <div className="rounded-xl border border-[#d9e5d4] bg-[#f3f8f1] px-3 py-2 text-xs text-[#2f4a38]">
                Editing campaign <strong>{editingCampaignId.slice(0, 8)}…</strong>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={savingCampaign}
                    onClick={() => void onSaveCampaignEdits()}
                    className="hm-btn-brass rounded-full px-3 py-1 text-[11px] disabled:opacity-50"
                  >
                    {savingCampaign ? 'Saving…' : 'Save campaign edits'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingCampaignId(null);
                      setMsg('Exited campaign edit mode.');
                    }}
                    className="rounded-full border border-[#ddd5c6] px-3 py-1 text-[11px] text-[#5a5348]"
                  >
                    Done editing
                  </button>
                </div>
              </div>
            )}
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
              Body — plain text or HTML (use {'{{first_name}}'}, {'{{name}}'}, {'{{email}}'})
              <textarea
                className="mt-1 min-h-[200px] w-full rounded-lg border border-[#e0d8ca] px-3 py-2 font-mono text-[12px] leading-relaxed"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={'<p>Hi {{first_name}},</p>\n<p>Your message…</p>'}
              />
            </label>
            <p className="text-[11px] text-[#8a8276]">
              {bodyIsHtml
                ? 'HTML detected — preview renders it and SMTP sends as HTML + plain-text fallback.'
                : 'Plain text — preview shows line breaks; add tags like <p>, <b>, <a> for HTML.'}{' '}
              An unsubscribe link is appended automatically at the end of every email.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs text-[#6f675c]">
                Gap between emails (sec)
                <input
                  type="number"
                  min={90}
                  max={3600}
                  className="mt-1 w-full rounded-lg border border-[#e0d8ca] px-3 py-2 text-sm"
                  value={gapSeconds}
                  onChange={(e) => setGapSeconds(Math.max(90, Number(e.target.value) || 120))}
                />
                <span className="mt-1 block text-[11px] text-[#8a8276]">
                  Minimum 90s (default 120s) so messages don’t burst into spam.
                </span>
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
              Send from
              <select
                className="mt-1 w-full rounded-lg border border-[#e0d8ca] bg-white px-3 py-2 text-sm"
                value={smtpFrom}
                onChange={(e) => setSmtpFrom(e.target.value)}
              >
                <option value="auto">Auto-rotate (1st apply · 2nd careers · 3rd apply…)</option>
                {smtpAccounts.map((a) => (
                  <option key={a.email} value={a.email}>
                    {a.email} · {a.remaining} left today
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[11px] text-[#8a8276]">
                Prefer Auto-rotate. Suspended mailboxes (aopaz@) are blocked and will not send.
              </span>
            </label>
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
              <p className="hm-kicker mb-1">Preview {bodyIsHtml ? '· HTML' : '· text'} · includes unsubscribe footer</p>
              <p className="font-medium text-[#1f2a24]">{previewSubject}</p>
              <div
                className="bulk-email-preview mt-2 max-h-64 overflow-auto rounded-lg border border-[#e6e0d4] bg-white px-3 py-3 text-[13px] leading-relaxed text-[#1f2a24] [&_a]:text-[#3f6b4e] [&_a]:underline [&_p]:mb-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5"
                dangerouslySetInnerHTML={{ __html: previewHtmlWithUnsub }}
              />
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
              <p className="mt-1 text-xs text-[#8a8276]">
                Cap 500/day per sender. Passwords live in Edge secrets (not this form). Auto-rotate alternates senders each email.
                Suspended aopaz@globelife-paz.com is blocked.
              </p>
              <ul className="mt-3 space-y-1 text-xs text-[#3f3a32]">
                {smtpAccounts.length ? (
                  smtpAccounts.map((a) => (
                    <li key={a.email}>
                      {a.email}: <strong>{a.daily_sent}</strong>/{a.daily_cap} today · {a.remaining} left
                    </li>
                  ))
                ) : (
                  <li>No senders loaded yet.</li>
                )}
              </ul>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <label className="text-xs text-[#6f675c]">
                  Default gap (sec)
                  <input
                    type="number"
                    min={90}
                    max={3600}
                    className="mt-1 w-full rounded-lg border border-[#e0d8ca] px-3 py-2 text-sm"
                    value={gapSeconds}
                    onChange={(e) => setGapSeconds(Math.max(90, Number(e.target.value) || 120))}
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
              <p className="mt-1 text-[11px] text-[#5a6f5c]">
                Sending continues on the server if you close this window. Open a campaign below to see every lead.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {(sending || progress.campaign?.status === 'sending' || progress.campaign?.status === 'queued') && (
                  <button
                    type="button"
                    disabled={pausing}
                    className="inline-flex items-center gap-1 rounded-full border border-[#b7c9b4] px-3 py-1 text-xs disabled:opacity-50"
                    onClick={() => void onPauseCampaign(activeId)}
                  >
                    <Pause size={12} /> {pausing ? 'Pausing…' : 'Pause now'}
                  </button>
                )}
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-full border border-[#ddd5c6] px-3 py-1 text-xs"
                  onClick={() => void onEditCampaign(activeId)}
                >
                  <Pencil size={12} /> Edit
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-full border border-[#ddd5c6] px-3 py-1 text-xs"
                  onClick={() => void loadLeads(activeId)}
                >
                  <RefreshCw size={12} /> Refresh leads
                </button>
                {sending && (
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
                )}
              </div>
            </div>
          )}

          {activeId && (
            <div className="space-y-3 rounded-xl border border-[#eee7db] bg-[#fbfaf7] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="hm-kicker">Campaign leads</p>
                <div className="flex flex-wrap gap-1">
                  {(['all', 'pending', 'sent', 'failed'] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setLeadFilter(f)}
                      className={`rounded-full px-3 py-1 text-[11px] capitalize ${
                        leadFilter === f
                          ? 'bg-[#1c1915] text-white'
                          : 'border border-[#ddd5c6] text-[#5a5348]'
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>
              <input
                value={leadQuery}
                onChange={(e) => setLeadQuery(e.target.value)}
                placeholder="Search name or email…"
                className="w-full rounded-lg border border-[#e0d8ca] bg-white px-3 py-2 text-sm"
              />
              <div className="max-h-[420px] overflow-auto rounded-xl border border-[#eee7db] bg-white">
                <table className="min-w-full text-left text-xs">
                  <thead className="sticky top-0 bg-[#f7f3eb] text-[#6f675c]">
                    <tr>
                      <th className="px-3 py-2">#</th>
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">Email</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Sent at</th>
                      <th className="px-3 py-2">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingLeads && (
                      <tr>
                        <td colSpan={6} className="px-3 py-6 text-[#8a8276]">Loading leads…</td>
                      </tr>
                    )}
                    {!loadingLeads &&
                      leads.map((row) => (
                        <tr key={row.id} className="border-t border-[#f0ebe2]">
                          <td className="px-3 py-2 text-[#8a8276]">{(row.row_index ?? 0) + 1}</td>
                          <td className="px-3 py-2 text-[#3f3a32]">{row.full_name || '—'}</td>
                          <td className="px-3 py-2 text-[#3f3a32]">{row.email}</td>
                          <td className="px-3 py-2 capitalize">
                            <span
                              className={
                                row.status === 'sent'
                                  ? 'text-emerald-700'
                                  : row.status === 'failed'
                                    ? 'text-red-700'
                                    : row.status === 'pending'
                                      ? 'text-amber-700'
                                      : 'text-[#5a5348]'
                              }
                            >
                              {row.status}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-[#8a8276]">
                            {row.sent_at ? new Date(row.sent_at).toLocaleString() : '—'}
                          </td>
                          <td className="max-w-[220px] truncate px-3 py-2 text-red-700" title={row.error || ''}>
                            {row.error || '—'}
                          </td>
                        </tr>
                      ))}
                    {!loadingLeads && !leads.length && (
                      <tr>
                        <td colSpan={6} className="px-3 py-6 text-[#8a8276]">No leads for this filter.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-[#8a8276]">
                {leads.length} row{leads.length === 1 ? '' : 's'} shown
                {progress ? ` · ${progress.sent} sent · ${progress.pending} remaining · ${progress.failed} failed` : ''}
              </p>
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
                    <td className="px-3 py-2 capitalize text-[#3f3a32]">
                      {c.status}
                      {(c.status === 'sending' || c.status === 'queued') && (
                        <div className="text-[10px] font-normal normal-case text-emerald-700">
                          Running on server
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[#3f3a32]">
                      {c.sent_count}/{c.total_count}
                      {c.failed_count ? ` · ${c.failed_count} fail` : ''}
                    </td>
                    <td className="px-3 py-2 text-[#8a8276]">
                      {new Date(c.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          className="rounded-full border border-[#ddd5c6] px-3 py-1 text-[11px] text-[#5a5348]"
                          onClick={() => {
                            setActiveId(c.id);
                            void loadLeads(c.id);
                          }}
                        >
                          Leads
                        </button>
                        {c.status !== 'cancelled' && c.status !== 'completed' && (
                          <button
                            type="button"
                            className="rounded-full border border-[#ddd5c6] px-3 py-1 text-[11px] text-[#5a5348]"
                            onClick={() => void onEditCampaign(c.id)}
                          >
                            Edit
                          </button>
                        )}
                        {(c.status === 'sending' || c.status === 'queued') && (
                          <button
                            type="button"
                            disabled={pausing}
                            className="rounded-full border border-[#b7c9b4] px-3 py-1 text-[11px] text-[#2f4a38] disabled:opacity-50"
                            onClick={() => void onPauseCampaign(c.id)}
                          >
                            Pause
                          </button>
                        )}
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
                      </div>
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

      {tab === 'stats' && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="hm-kicker">Email stats</p>
              <p className="text-sm text-[#6f675c]">
                Pacific business day {stats?.business_day || businessDay || '—'}. SMTP does not track inbox
                replies; bounce count is estimated from send-log errors.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadStats()}
              className="inline-flex items-center gap-1.5 rounded-full border border-[#ddd5c6] px-3 py-1.5 text-xs text-[#5a5348]"
            >
              <RefreshCw size={12} /> {loadingStats ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: 'Sent today', value: stats?.totals.sent_today ?? '—' },
              { label: 'Sent (all campaigns)', value: stats?.totals.sent ?? '—' },
              { label: 'Failed', value: stats?.totals.failed ?? '—' },
              { label: 'Pending', value: stats?.totals.pending ?? '—' },
              { label: 'Bounced (est.)', value: stats?.totals.bounced ?? '—' },
              { label: 'Replies', value: stats?.totals.replies ?? 0 },
              {
                label: 'Reply rate',
                value:
                  stats?.totals.reply_rate == null
                    ? 'n/a'
                    : `${Math.round((stats.totals.reply_rate || 0) * 1000) / 10}%`,
              },
              {
                label: 'Log sends',
                value: stats?.totals.sent_logs ?? '—',
              },
            ].map((card) => (
              <div
                key={card.label}
                className="rounded-xl border border-[#eee7db] bg-[#fbfaf7] px-4 py-3"
              >
                <p className="text-[11px] uppercase tracking-wide text-[#8a8276]">{card.label}</p>
                <p className="mt-1 font-[Fraunces] text-2xl text-[#1f2a24]">{card.value}</p>
              </div>
            ))}
          </div>

          <div className="overflow-auto rounded-xl border border-[#eee7db]">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-[#f7f3eb] text-[#6f675c]">
                <tr>
                  <th className="px-3 py-2">Campaign</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Sent</th>
                  <th className="px-3 py-2">Failed</th>
                  <th className="px-3 py-2">Total</th>
                  <th className="px-3 py-2">Gap</th>
                </tr>
              </thead>
              <tbody>
                {(stats?.campaigns || []).map((c) => (
                  <tr key={c.id} className="border-t border-[#f0ebe2]">
                    <td className="px-3 py-2 text-[#3f3a32]">{c.name}</td>
                    <td className="px-3 py-2 capitalize text-[#3f3a32]">{c.status}</td>
                    <td className="px-3 py-2 text-[#3f3a32]">{c.sent_count}</td>
                    <td className="px-3 py-2 text-[#3f3a32]">{c.failed_count}</td>
                    <td className="px-3 py-2 text-[#3f3a32]">{c.total_count}</td>
                    <td className="px-3 py-2 text-[#8a8276]">{c.gap_seconds}s</td>
                  </tr>
                ))}
                {!loadingStats && !(stats?.campaigns || []).length && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-[#8a8276]">
                      No campaign stats yet.
                    </td>
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
