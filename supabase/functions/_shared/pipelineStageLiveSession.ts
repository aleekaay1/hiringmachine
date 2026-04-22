/** Kept in sync with types.ts live session pipeline helpers + normalizePipelineStage. */

const ORDER = [
  'Checked In',
  'Invited to Live Career Overview Session',
  'Live Career Overview Session Attended',
  'Leadership assessment form sent',
  'Leadership form submitted, awaiting evaluation',
  'Evaluation Done',
  'Interview scheduled',
  'Final decision',
] as const;

const LEGACY: Record<string, (typeof ORDER)[number]> = {
  Applied: 'Checked In',
  Screening: 'Leadership form submitted, awaiting evaluation',
  'Check in': 'Checked In',
  'Checked in': 'Checked In',
  'Attended Live Session': 'Leadership assessment form sent',
  'Leadership Assessment Received Under Review': 'Leadership form submitted, awaiting evaluation',
  'Career session invited': 'Invited to Live Career Overview Session',
  'Interview Scheduled': 'Interview scheduled',
  Interviewed: 'Interview scheduled',
  Offer: 'Interview scheduled',
  Hired: 'Final decision',
  Rejected: 'Final decision',
  Withdrawn: 'Final decision',
  'Not Hired / Withdrawn': 'Final decision',
};

function normalize(raw: unknown): (typeof ORDER)[number] {
  const s = typeof raw === 'string' ? raw : '';
  if ((ORDER as readonly string[]).includes(s)) return s as (typeof ORDER)[number];
  if (LEGACY[s]) return LEGACY[s];
  return 'Checked In';
}

export function pipelineStageAfterLiveSessionInvited(current: unknown): (typeof ORDER)[number] {
  const cur = normalize(current);
  if (cur === 'Final decision') return cur;
  const target: (typeof ORDER)[number] = 'Invited to Live Career Overview Session';
  const ti = ORDER.indexOf(target);
  const ci = ORDER.indexOf(cur);
  if (ci > ti) return cur;
  return target;
}

export function pipelineStageAfterLiveSessionAttended(current: unknown): (typeof ORDER)[number] {
  const cur = normalize(current);
  if (cur === 'Final decision') return cur;
  const attendedIdx = ORDER.indexOf('Live Career Overview Session Attended');
  const ci = ORDER.indexOf(cur);
  if (ci === -1) return 'Live Career Overview Session Attended';
  if (ci > attendedIdx) return cur;
  return 'Live Career Overview Session Attended';
}

export function pipelineStageAfterAssessmentFormSent(current: unknown): (typeof ORDER)[number] {
  const cur = normalize(current);
  if (cur === 'Final decision') return cur;
  const targetIdx = ORDER.indexOf('Leadership assessment form sent');
  const ci = ORDER.indexOf(cur);
  if (ci === -1) return 'Leadership assessment form sent';
  if (ci > targetIdx) return cur;
  return 'Leadership assessment form sent';
}
