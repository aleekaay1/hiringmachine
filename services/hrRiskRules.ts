import type { Candidate } from '../types';

export interface RiskRuleInput {
  candidate: Candidate;
  invitedLiveSession: boolean;
  attendedLiveSession: boolean;
  webinarInvitedCount: number;
  webinarWatchedCount: number;
  readinessScore: number;
}

export interface RiskFlagResult {
  riskType: 'no_show_risk' | 'ghost_risk' | 'low_conversion_risk';
  confidence: number;
  reason: string;
  metadata: Record<string, unknown>;
}

function confidence(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}

export function detectRiskFlags(input: RiskRuleInput): RiskFlagResult[] {
  const flags: RiskFlagResult[] = [];
  const stage = String(input.candidate.adminData?.pipelineStage || 'Checked In');
  const hasAssessment = input.candidate.status === 'assessment_complete' || !!input.candidate.assessment;

  if (input.invitedLiveSession && !input.attendedLiveSession && input.webinarInvitedCount > 0) {
    flags.push({
      riskType: 'no_show_risk',
      confidence: confidence(0.72),
      reason: 'Invited to live session but no attendance signal found.',
      metadata: {
        webinarInvitedCount: input.webinarInvitedCount,
        webinarWatchedCount: input.webinarWatchedCount,
      },
    });
  }

  if ((stage === 'Checked In' || stage === 'Invited to Live Career Overview Session') && !hasAssessment && input.webinarWatchedCount === 0) {
    flags.push({
      riskType: 'ghost_risk',
      confidence: confidence(0.66),
      reason: 'Early-stage candidate shows low activity and no webinar watch signal.',
      metadata: {
        stage,
        hasAssessment,
      },
    });
  }

  if (input.readinessScore < 45 || (input.candidate.fitCategory === 'Not Aligned' && !input.attendedLiveSession)) {
    flags.push({
      riskType: 'low_conversion_risk',
      confidence: confidence(0.7),
      reason: 'Readiness and fit signals indicate lower probability of conversion.',
      metadata: {
        readinessScore: input.readinessScore,
        fitCategory: input.candidate.fitCategory ?? null,
      },
    });
  }

  return flags;
}

