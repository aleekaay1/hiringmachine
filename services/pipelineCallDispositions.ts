/** Resume / cold-call dispositions required after each pipeline dial. */
export const PIPELINE_CALL_DISPOSITIONS = [
  'No answer',
  'Voicemail left',
  'Busy / line busy',
  'Callback requested',
  'Booked',
  'Wrong number',
  'Not interested',
  'Connected',
  'Interested – next step',
  'Scheduled interview',
  'Do not call',
  'Send to AO Hub',
] as const;

export const HM_CALL_DISPOSITIONS = [
  'No answer',
  'Voicemail left',
  'Callback requested',
  'Not interested',
  'Send to AO Hub',
  'Do not call',
] as const;

export type HmCallDisposition = (typeof HM_CALL_DISPOSITIONS)[number];

export type PipelineCallDisposition = (typeof PIPELINE_CALL_DISPOSITIONS)[number];
export const PIPELINE_BOOKED_SUBTYPES = ['Live Session', 'Webinar'] as const;
export type PipelineBookedSubtype = (typeof PIPELINE_BOOKED_SUBTYPES)[number];

export const PIPELINE_PENDING_CALL_STORAGE_KEY = 'pohiring_pipeline_pending_call_v1';

export interface PipelinePendingCallSession {
  sessionId: string;
  candidateId: string;
  candidateName: string;
  resumeId: string | null;
  dialedNumber: string;
  dialLogId: string | null;
  webclientUrl: string | null;
  startedAt: string;
}

export function isPipelineCallDisposition(value: string): value is PipelineCallDisposition {
  return (PIPELINE_CALL_DISPOSITIONS as readonly string[]).includes(value);
}

/** Suggested journey stage after a call disposition is saved. */
export function journeyStageForCallDisposition(disposition: PipelineCallDisposition): string {
  switch (disposition) {
    case 'No answer':
    case 'Voicemail left':
    case 'Busy / line busy':
      return 'attempted';
    case 'Callback requested':
      return 'follow_up';
    case 'Wrong number':
      return 'attempted';
    case 'Not interested':
    case 'Do not call':
      return 'not_interested';
    case 'Booked':
      return 'qualified';
    case 'Connected':
      return 'connected';
    case 'Interested – next step':
      return 'qualified';
    case 'Send to AO Hub':
      return 'qualified';
    case 'Scheduled interview':
      return 'follow_up';
    default:
      return 'attempted';
  }
}
