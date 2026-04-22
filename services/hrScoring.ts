import type { Candidate } from '../types';

export interface CandidateSignalInput {
  candidate: Candidate;
  invitedLiveSession: boolean;
  attendedLiveSession: boolean;
  webinarInvitedCount: number;
  webinarWatchedCount: number;
  webinarWatchedLiveCount: number;
  webinarWatchedReplayCount: number;
}

export interface ReadinessScoreResult {
  score: number;
  band: 'Hot' | 'Warm' | 'Monitor';
  componentScores: {
    engagement: number;
    responsiveness: number;
    completion: number;
    fit: number;
    recruiter: number;
  };
  why: string[];
}

function clamp0to100(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function stageIndex(stageRaw: unknown): number {
  const s = String(stageRaw || '').trim();
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
  return Math.max(0, ordered.indexOf(s));
}

export function calculateReadinessScore(input: CandidateSignalInput): ReadinessScoreResult {
  const { candidate } = input;
  const admin = candidate.adminData;

  const engagementRaw =
    (input.attendedLiveSession ? 45 : 0) +
    Math.min(20, input.webinarWatchedCount * 6) +
    Math.min(15, input.webinarWatchedLiveCount * 5) +
    Math.min(10, input.webinarWatchedReplayCount * 3) +
    (input.invitedLiveSession ? 10 : 0);
  const engagement = clamp0to100(engagementRaw);

  const hasAssessment = candidate.status === 'assessment_complete' || !!candidate.assessment;
  const responsiveness = clamp0to100(
    (hasAssessment ? 55 : 10) +
      (input.attendedLiveSession ? 20 : 0) +
      Math.min(25, stageIndex(admin?.pipelineStage) * 5),
  );

  const completion = clamp0to100(
    (candidate.applicantQuestionnaire ? 35 : 0) +
      (input.invitedLiveSession ? 20 : 0) +
      (input.attendedLiveSession ? 20 : 0) +
      (hasAssessment ? 25 : 0),
  );

  const fitFromAssessment = Math.max(0, Math.min(100, Number(candidate.score ?? 0)));
  const fitFromCategory =
    candidate.fitCategory === 'High Fit' ? 85 : candidate.fitCategory === 'Review' ? 60 : 35;
  const fit = clamp0to100(
    fitFromAssessment > 0 ? fitFromAssessment : fitFromCategory,
  );

  const recruiter = clamp0to100(
    (admin?.rating ? admin.rating * 18 : 25) +
      Math.min(20, (admin?.tags?.length ?? 0) * 4) +
      (admin?.resumeReviewedAt ? 10 : 0),
  );

  const weighted =
    engagement * 0.28 +
    responsiveness * 0.17 +
    completion * 0.2 +
    fit * 0.25 +
    recruiter * 0.1;
  const score = clamp0to100(weighted);
  const band: ReadinessScoreResult['band'] = score >= 80 ? 'Hot' : score >= 60 ? 'Warm' : 'Monitor';

  const why: string[] = [];
  if (engagement >= 70) why.push('High engagement from attendance/watch behavior');
  if (fit >= 75) why.push('Strong fit indicators from assessment/category');
  if (completion >= 75) why.push('Completed key journey milestones');
  if (score < 60) why.push('Needs recruiter intervention to progress');

  return {
    score,
    band,
    componentScores: { engagement, responsiveness, completion, fit, recruiter },
    why: why.length ? why : ['Balanced profile, monitor next-step movement'],
  };
}

