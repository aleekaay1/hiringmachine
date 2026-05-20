import { supabase } from './supabaseClient';

export const WEDNESDAY_CAMPAIGN_TRIGGER_LABEL = 'manual_wednesday_live_overview';

export type WednesdayCampaignRecipientSendStatus = 'pending' | 'sent' | 'failed' | 'skipped';

export interface WednesdayCampaignRunSnapshotRecipientInput {
  recipientKey: string;
  inviteeName: string;
  inviteeEmail: string;
  inviteeStatus: string;
  selected: boolean;
  sendStatus: WednesdayCampaignRecipientSendStatus;
  candidateId?: string | null;
  errorMessage?: string | null;
  inviteeUri?: string | null;
  eventUri?: string | null;
}

export interface WednesdayCampaignRun {
  id: string;
  created_at: string;
  updated_at: string;
  trigger_label: string;
  source: string;
  initiated_by_user_id: string | null;
  session_title: string;
  session_start_at: string;
  session_label: string;
  fetched_invitee_count: number;
  selected_count: number;
  sent_count: number;
  failed_count: number;
  skipped_count: number;
  metadata: Record<string, unknown> | null;
}

export interface WednesdayCampaignRunRecipient {
  id: string;
  run_id: string;
  created_at: string;
  updated_at: string;
  recipient_key: string;
  invitee_name: string;
  invitee_email: string;
  invitee_status: string | null;
  candidate_id: string | null;
  selected: boolean;
  send_status: WednesdayCampaignRecipientSendStatus;
  sent_at: string | null;
  error_message: string | null;
  email_send_log_id: string | null;
  invitee_uri: string | null;
  event_uri: string | null;
}

export interface WednesdayCampaignRunWithRecipients {
  run: WednesdayCampaignRun;
  recipients: WednesdayCampaignRunRecipient[];
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export async function createWednesdayCampaignRunSnapshot(input: {
  sessionTitle: string;
  sessionStartAt: string;
  sessionLabel: string;
  source?: string;
  recipients: WednesdayCampaignRunSnapshotRecipientInput[];
  metadata?: Record<string, unknown>;
}): Promise<WednesdayCampaignRun> {
  const { data: auth } = await supabase.auth.getUser();
  const selectedCount = input.recipients.filter((r) => r.selected).length;
  const sentCount = input.recipients.filter((r) => r.sendStatus === 'sent').length;
  const failedCount = input.recipients.filter((r) => r.sendStatus === 'failed').length;
  const skippedCount = input.recipients.filter((r) => r.sendStatus === 'skipped').length;

  const { data: runData, error: runError } = await supabase
    .from('pipeline_wednesday_campaign_runs')
    .insert({
      trigger_label: WEDNESDAY_CAMPAIGN_TRIGGER_LABEL,
      source: input.source || 'email_log',
      initiated_by_user_id: auth.user?.id ?? null,
      session_title: input.sessionTitle.trim(),
      session_start_at: input.sessionStartAt,
      session_label: input.sessionLabel.trim(),
      fetched_invitee_count: input.recipients.length,
      selected_count: selectedCount,
      sent_count: sentCount,
      failed_count: failedCount,
      skipped_count: skippedCount,
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single();

  if (runError) throw runError;
  const run = runData as WednesdayCampaignRun;

  if (input.recipients.length > 0) {
    const rows = input.recipients.map((recipient) => ({
      run_id: run.id,
      recipient_key: recipient.recipientKey,
      invitee_name: recipient.inviteeName.trim() || '(No name)',
      invitee_email: normalizeEmail(recipient.inviteeEmail),
      invitee_status: recipient.inviteeStatus || null,
      candidate_id: recipient.candidateId?.trim() || null,
      selected: recipient.selected,
      send_status: recipient.sendStatus,
      sent_at: recipient.sendStatus === 'sent' ? new Date().toISOString() : null,
      error_message: recipient.errorMessage ?? null,
      invitee_uri: recipient.inviteeUri ?? null,
      event_uri: recipient.eventUri ?? null,
    }));
    const { error: recipientError } = await supabase
      .from('pipeline_wednesday_campaign_run_recipients')
      .insert(rows);
    if (recipientError) throw recipientError;
  }

  return run;
}

export async function prepareWednesdayCampaignRunForSend(input: {
  runId: string;
  selectedRecipientKeys: string[];
}): Promise<void> {
  const selectedRecipientKeys = [...new Set(input.selectedRecipientKeys.map((key) => key.trim()).filter(Boolean))];

  const { error: resetError } = await supabase
    .from('pipeline_wednesday_campaign_run_recipients')
    .update({
      selected: false,
      send_status: 'skipped',
      error_message: 'Not selected for send in this run.',
      sent_at: null,
      email_send_log_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq('run_id', input.runId);
  if (resetError) throw resetError;

  if (selectedRecipientKeys.length > 0) {
    const { error: selectedError } = await supabase
      .from('pipeline_wednesday_campaign_run_recipients')
      .update({
        selected: true,
        send_status: 'pending',
        error_message: null,
        sent_at: null,
        email_send_log_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq('run_id', input.runId)
      .in('recipient_key', selectedRecipientKeys);
    if (selectedError) throw selectedError;
  }

  const skippedCount = Math.max(0, await countWednesdayCampaignRecipientsByStatus(input.runId, 'skipped'));
  const { error: runUpdateError } = await supabase
    .from('pipeline_wednesday_campaign_runs')
    .update({
      selected_count: selectedRecipientKeys.length,
      skipped_count: skippedCount,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.runId);
  if (runUpdateError) throw runUpdateError;
}

async function countWednesdayCampaignRecipientsByStatus(
  runId: string,
  status: WednesdayCampaignRecipientSendStatus,
): Promise<number> {
  const { count, error } = await supabase
    .from('pipeline_wednesday_campaign_run_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('run_id', runId)
    .eq('send_status', status);
  if (error) throw error;
  return count || 0;
}

async function findLatestEmailSendLogId(input: {
  toEmail: string;
  candidateId?: string | null;
}): Promise<string | null> {
  let query = supabase
    .from('email_send_logs')
    .select('id')
    .eq('trigger_label', WEDNESDAY_CAMPAIGN_TRIGGER_LABEL)
    .eq('to_email', normalizeEmail(input.toEmail))
    .order('created_at', { ascending: false })
    .limit(1);
  if (input.candidateId) {
    query = query.eq('candidate_id', input.candidateId);
  }
  const { data, error } = await query;
  if (error) return null;
  const row = ((data || [])[0] || null) as { id?: string } | null;
  return row?.id || null;
}

export async function recordWednesdayCampaignRecipientSendResult(input: {
  runId: string;
  recipientKey: string;
  inviteeEmail: string;
  sendStatus: 'sent' | 'failed';
  candidateId?: string | null;
  errorMessage?: string | null;
}): Promise<void> {
  const emailSendLogId =
    input.sendStatus === 'sent'
      ? await findLatestEmailSendLogId({ toEmail: input.inviteeEmail, candidateId: input.candidateId })
      : null;
  const { error } = await supabase
    .from('pipeline_wednesday_campaign_run_recipients')
    .update({
      selected: true,
      send_status: input.sendStatus,
      sent_at: input.sendStatus === 'sent' ? new Date().toISOString() : null,
      error_message: input.errorMessage ?? null,
      email_send_log_id: emailSendLogId,
      updated_at: new Date().toISOString(),
    })
    .eq('run_id', input.runId)
    .eq('recipient_key', input.recipientKey)
    .eq('invitee_email', normalizeEmail(input.inviteeEmail));
  if (error) throw error;
}

export async function finalizeWednesdayCampaignRunCounts(input: {
  runId: string;
  selectedCount: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
}): Promise<void> {
  const { error } = await supabase
    .from('pipeline_wednesday_campaign_runs')
    .update({
      selected_count: input.selectedCount,
      sent_count: input.sentCount,
      failed_count: input.failedCount,
      skipped_count: input.skippedCount,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.runId);
  if (error) throw error;
}

export async function listWednesdayCampaignRuns(limit = 50): Promise<WednesdayCampaignRunWithRecipients[]> {
  const { data: runsData, error: runsError } = await supabase
    .from('pipeline_wednesday_campaign_runs')
    .select('*')
    .eq('trigger_label', WEDNESDAY_CAMPAIGN_TRIGGER_LABEL)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (runsError) throw runsError;

  const runs = (runsData || []) as WednesdayCampaignRun[];
  if (!runs.length) return [];

  const runIds = runs.map((run) => run.id);
  const { data: recipientData, error: recipientError } = await supabase
    .from('pipeline_wednesday_campaign_run_recipients')
    .select('*')
    .in('run_id', runIds)
    .order('created_at', { ascending: true })
    .limit(10000);
  if (recipientError) throw recipientError;
  const recipients = (recipientData || []) as WednesdayCampaignRunRecipient[];

  const recipientsByRun = new Map<string, WednesdayCampaignRunRecipient[]>();
  for (const recipient of recipients) {
    const current = recipientsByRun.get(recipient.run_id) || [];
    current.push(recipient);
    recipientsByRun.set(recipient.run_id, current);
  }

  return runs.map((run) => ({
    run,
    recipients: (recipientsByRun.get(run.id) || []).sort((a, b) => a.invitee_email.localeCompare(b.invitee_email)),
  }));
}
