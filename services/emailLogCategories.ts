export type EmailLogCategory =
  | 'leadership_assessment'
  | 'wednesday_live'
  | 'pipeline_crm'
  | 'reminder'
  | 'other';

export type EmailLogMode = 'auto' | 'manual' | 'unknown';

export type EmailLogRowLike = {
  source: string;
  trigger_label: string | null;
  subject: string;
  status: string;
  metadata?: Record<string, unknown> | null;
};

const LEADERSHIP_TRIGGERS = new Set([
  'automated_stage3_after_live_session',
  'stage3_assessment_link',
  'crm_template:stage3_assessment_link',
  'crm_template:stage3_assessment_link_post_overview',
  'stage3_assessment_link_post_overview',
]);

const WEDNESDAY_TRIGGERS = new Set(['manual_wednesday_live_overview']);

export function categorizeEmailLog(row: EmailLogRowLike): {
  category: EmailLogCategory;
  mode: EmailLogMode;
  categoryLabel: string;
  modeLabel: string;
} {
  const trigger = String(row.trigger_label || '').trim().toLowerCase();
  const source = String(row.source || '').trim().toLowerCase();
  const subject = String(row.subject || '').trim().toLowerCase();
  const meta = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  const metaCategory = String(meta.category || '').trim().toLowerCase();
  const metaMode = String(meta.send_mode || '').trim().toLowerCase();

  let category: EmailLogCategory = 'other';
  if (metaCategory === 'leadership_assessment' || LEADERSHIP_TRIGGERS.has(trigger)) {
    category = 'leadership_assessment';
  } else if (WEDNESDAY_TRIGGERS.has(trigger) || /wednesday|live overview|live career/i.test(subject)) {
    category = 'wednesday_live';
  } else if (/reminder|24h|follow-up followup/i.test(subject) || trigger.includes('reminder')) {
    category = 'reminder';
  } else if (
    source.includes('send-email') ||
    source.includes('send-candidate-email') ||
    source.includes('crm') ||
    trigger.startsWith('crm_') ||
    trigger.startsWith('manual')
  ) {
    category = 'pipeline_crm';
  }

  let mode: EmailLogMode = 'unknown';
  if (metaMode === 'auto' || source.includes('auto') || trigger.startsWith('automated')) {
    mode = 'auto';
  } else if (metaMode === 'manual' || trigger.startsWith('manual') || Boolean(row.trigger_label)) {
    mode = 'manual';
  }

  const categoryLabel =
    category === 'leadership_assessment'
      ? 'Leadership assessment'
      : category === 'wednesday_live'
        ? 'Wednesday live session'
        : category === 'reminder'
          ? 'Reminder'
          : category === 'pipeline_crm'
            ? 'CRM / pipeline'
            : 'Other';

  const modeLabel = mode === 'auto' ? 'Automated' : mode === 'manual' ? 'Manual' : '—';

  return { category, mode, categoryLabel, modeLabel };
}
