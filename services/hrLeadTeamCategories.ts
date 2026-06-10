export type HrLeadTeamCategory = 'rms' | 'cooper' | 'custom';

export const HR_LEAD_TEAM_OPTIONS: Array<{ id: HrLeadTeamCategory; label: string }> = [
  { id: 'rms', label: 'RMS leads' },
  { id: 'cooper', label: 'Cooper leads' },
  { id: 'custom', label: 'Custom category' },
];

export function formatHrLeadTeamDisplay(value: string | null | undefined): string {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  if (normalized === 'rms') return 'RMS';
  if (normalized === 'cooper') return 'Cooper';
  return String(value).trim();
}

function filenameTokens(filename: string): string[] {
  return String(filename || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function detectLeadTeamCategoryFromFilename(filename: string): HrLeadTeamCategory | null {
  const tokens = filenameTokens(filename);
  if (!tokens.length) return null;
  if (tokens.includes('rms')) return 'rms';
  if (tokens.includes('cooper')) return 'cooper';
  return null;
}

export function detectLeadTeamFromFilename(filename: string): string | null {
  const category = detectLeadTeamCategoryFromFilename(filename);
  if (!category || category === 'custom') return null;
  return formatHrLeadTeamDisplay(category);
}

export function resolveHrLeadTeamValue(input: {
  category?: HrLeadTeamCategory | '' | null;
  customLabel?: string | null;
  sourceFilename?: string | null;
}): string | null {
  const category = input.category || detectLeadTeamCategoryFromFilename(String(input.sourceFilename || ''));
  if (category === 'rms') return 'RMS';
  if (category === 'cooper') return 'Cooper';
  if (category === 'custom') {
    const custom = String(input.customLabel || '').trim();
    return custom || 'Custom';
  }
  return detectLeadTeamFromFilename(String(input.sourceFilename || ''));
}

export function buildHrImportBatchLabel(team: string | null, filename: string): string {
  const base = String(filename || '').replace(/\.[^.]+$/, '').trim() || 'HR import';
  const teamLabel = formatHrLeadTeamDisplay(team);
  return teamLabel ? `${teamLabel} · ${base}` : base;
}

export function hrLeadTeamBadgeClass(team: string | null | undefined): string {
  const normalized = String(team || '').trim().toLowerCase();
  if (normalized === 'rms') return 'bg-sky-100 text-sky-800 border-sky-200';
  if (normalized === 'cooper') return 'bg-violet-100 text-violet-800 border-violet-200';
  if (!normalized) return 'bg-slate-100 text-slate-600 border-slate-200';
  return 'bg-amber-50 text-amber-900 border-amber-200';
}

export function readCandidateLeadTeam(metadata: Record<string, unknown> | null | undefined): string {
  const team = String(metadata?.lead_team || '').trim();
  if (team) return formatHrLeadTeamDisplay(team) || team;
  const leadAge = String(metadata?.lead_age || '').trim();
  if (leadAge) return leadAge;
  return '';
}
