/** Kept in sync with types.ts pipelineStageAfterLiveSessionAttended + normalizePipelineStage. */

const ORDER = [
  'Check in',
  'Attended Live Session',
  'Leadership Assessment Received Under Review',
  'Interview scheduled',
  'Hired',
  'Not Hired / Withdrawn',
] as const;

const LEGACY: Record<string, (typeof ORDER)[number]> = {
  Applied: 'Check in',
  Screening: 'Leadership Assessment Received Under Review',
  'Interview Scheduled': 'Interview scheduled',
  Interviewed: 'Interview scheduled',
  Offer: 'Interview scheduled',
  Hired: 'Hired',
  Rejected: 'Not Hired / Withdrawn',
  Withdrawn: 'Not Hired / Withdrawn',
};

function normalize(raw: unknown): (typeof ORDER)[number] {
  const s = typeof raw === 'string' ? raw : '';
  if ((ORDER as readonly string[]).includes(s)) return s as (typeof ORDER)[number];
  if (LEGACY[s]) return LEGACY[s];
  return 'Check in';
}

export function pipelineStageAfterLiveSessionAttended(current: unknown): (typeof ORDER)[number] {
  const cur = normalize(current);
  if (cur === 'Hired' || cur === 'Not Hired / Withdrawn') return cur;
  const attendedIdx = ORDER.indexOf('Attended Live Session');
  const ci = ORDER.indexOf(cur);
  if (ci === -1) return 'Attended Live Session';
  if (ci > attendedIdx) return cur;
  return 'Attended Live Session';
}
