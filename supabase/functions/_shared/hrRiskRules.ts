export interface RiskInput {
  stage: string;
  hasAssessment: boolean;
  invitedLiveSession: boolean;
  attendedLiveSession: boolean;
  webinarInvitedCount: number;
  webinarWatchedCount: number;
  readinessScore: number;
  fitCategory: string | null;
}

export interface RiskOutput {
  risk_type: 'no_show_risk' | 'ghost_risk' | 'low_conversion_risk';
  confidence: number;
  reason: string;
  metadata: Record<string, unknown>;
}

function conf(v: number): number {
  return Math.max(0, Math.min(1, Math.round(v * 100) / 100));
}

export function detectRisks(input: RiskInput): RiskOutput[] {
  const out: RiskOutput[] = [];
  if (input.invitedLiveSession && !input.attendedLiveSession && input.webinarInvitedCount > 0) {
    out.push({
      risk_type: 'no_show_risk',
      confidence: conf(0.72),
      reason: 'Invited to live session but no attendance signal found.',
      metadata: {
        webinar_invited_count: input.webinarInvitedCount,
        webinar_watched_count: input.webinarWatchedCount,
      },
    });
  }
  if ((input.stage === 'Checked In' || input.stage === 'Invited to Live Career Overview Session') && !input.hasAssessment && input.webinarWatchedCount === 0) {
    out.push({
      risk_type: 'ghost_risk',
      confidence: conf(0.66),
      reason: 'Early-stage candidate shows low activity and no webinar watch signal.',
      metadata: { stage: input.stage, has_assessment: input.hasAssessment },
    });
  }
  if (input.readinessScore < 45 || (input.fitCategory === 'Not Aligned' && !input.attendedLiveSession)) {
    out.push({
      risk_type: 'low_conversion_risk',
      confidence: conf(0.7),
      reason: 'Readiness and fit signals indicate lower probability of conversion.',
      metadata: { readiness_score: input.readinessScore, fit_category: input.fitCategory },
    });
  }
  return out;
}

