export interface ScoreInput {
  score: number | null;
  fitCategory: string | null;
  stage: string;
  rating: number | null;
  tagsCount: number;
  invitedLiveSession: boolean;
  attendedLiveSession: boolean;
  webinarInvitedCount: number;
  webinarWatchedCount: number;
  webinarWatchedLiveCount: number;
  webinarWatchedReplayCount: number;
  hasAssessment: boolean;
}

export interface ScoreOutput {
  score: number;
  band: 'Hot' | 'Warm' | 'Monitor';
  componentScores: Record<string, number>;
  why: string[];
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function stageProgress(stage: string): number {
  const ordered = [
    'Checked In',
    'Invited to Live Career Overview Session',
    'Live Career Overview Session Attended',
    'Leadership assessment form sent',
    'Leadership form submitted, awaiting evaluation',
    'Evaluation Done',
    'Interview scheduled',
    'Final decision',
  ];
  const idx = ordered.indexOf(stage);
  return idx < 0 ? 0 : idx;
}

export function computeReadiness(input: ScoreInput): ScoreOutput {
  const engagement = clamp(
    (input.attendedLiveSession ? 45 : 0) +
      Math.min(20, input.webinarWatchedCount * 6) +
      Math.min(15, input.webinarWatchedLiveCount * 5) +
      Math.min(10, input.webinarWatchedReplayCount * 3) +
      (input.invitedLiveSession ? 10 : 0),
  );

  const responsiveness = clamp(
    (input.hasAssessment ? 55 : 10) +
      (input.attendedLiveSession ? 20 : 0) +
      Math.min(25, stageProgress(input.stage) * 5),
  );

  const completion = clamp(
    (input.invitedLiveSession ? 20 : 0) +
      (input.attendedLiveSession ? 20 : 0) +
      (input.hasAssessment ? 60 : 0),
  );

  const fitFromAssessment = Math.max(0, Math.min(100, Number(input.score ?? 0)));
  const fitFromCategory =
    input.fitCategory === 'High Fit' ? 85 : input.fitCategory === 'Review' ? 60 : 35;
  const fit = clamp(fitFromAssessment > 0 ? fitFromAssessment : fitFromCategory);

  const recruiter = clamp((input.rating ? input.rating * 18 : 25) + Math.min(25, input.tagsCount * 5));

  const weighted =
    engagement * 0.28 +
    responsiveness * 0.17 +
    completion * 0.2 +
    fit * 0.25 +
    recruiter * 0.1;

  const score = clamp(weighted);
  const band: ScoreOutput['band'] = score >= 80 ? 'Hot' : score >= 60 ? 'Warm' : 'Monitor';

  const why: string[] = [];
  if (engagement >= 70) why.push('High engagement from attendance/watch behavior');
  if (fit >= 75) why.push('Strong fit indicators from assessment/category');
  if (completion >= 75) why.push('Completed key journey milestones');
  if (score < 60) why.push('Needs recruiter intervention to progress');

  return {
    score,
    band,
    componentScores: { engagement, responsiveness, completion, fit, recruiter },
    why: why.length > 0 ? why : ['Balanced profile, monitor next-step movement'],
  };
}

