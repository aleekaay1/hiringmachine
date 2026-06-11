/**
 * 3CX AI transcription fields from CRM ReportCall ([Transcription], [Summary], etc.)
 * @see https://www.3cx.com/docs/ai-transcription/
 */

import type { CallRecordingTranscript } from './callRecordingTranscribe.ts';

export type ThreeCxTranscriptFields = {
  transcription: string | null;
  summary: string | null;
  sentiment: string | null;
};

function pickPayloadString(payload: Record<string, unknown>, keys: string[]): string {
  const lower = new Map<string, unknown>();
  for (const [k, v] of Object.entries(payload)) lower.set(k.toLowerCase(), v);
  for (const key of keys) {
    const v = payload[key] ?? lower.get(key.toLowerCase());
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

export function extractThreeCxTranscriptFromPayload(
  payload: Record<string, unknown> | null | undefined,
): ThreeCxTranscriptFields {
  if (!payload || typeof payload !== 'object') {
    return { transcription: null, summary: null, sentiment: null };
  }
  return {
    transcription: pickPayloadString(payload, [
      'transcription',
      'Transcription',
      'call_transcription',
    ]) || null,
    summary: pickPayloadString(payload, ['summary', 'Summary', 'call_summary']) || null,
    sentiment: pickPayloadString(payload, [
      'sentiment',
      'Sentiment',
      'sentiment_score',
      'SentimentScore',
    ]) || null,
  };
}

export function threeCxTranscriptMetaPatch(
  fields: ThreeCxTranscriptFields,
  receivedAt?: string,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (fields.transcription) {
    patch.threecx_transcription = fields.transcription;
    patch.recording_transcript = {
      text: fields.transcription,
      segments: [],
      model: '3cx-ai',
      language: 'en',
      transcribed_at: receivedAt || new Date().toISOString(),
      source: '3cx',
    };
  }
  if (fields.summary) patch.threecx_summary = fields.summary;
  if (fields.sentiment) patch.threecx_sentiment = fields.sentiment;
  if (fields.transcription || fields.summary) {
    patch.transcription_source = '3cx';
    patch.transcription_synced_at = receivedAt || new Date().toISOString();
  }
  return patch;
}

export function readThreeCxTranscriptFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): CallRecordingTranscript | null {
  if (!metadata || typeof metadata !== 'object') return null;

  const direct = metadata.recording_transcript;
  if (direct && typeof direct === 'object') {
    const obj = direct as Record<string, unknown>;
    const text = String(obj.text || '').trim();
    if (text) {
      return {
        text,
        segments: [],
        model: String(obj.model || '3cx-ai'),
        transcribedAt: String(obj.transcribed_at || obj.transcribedAt || ''),
        language: String(obj.language || 'en'),
      };
    }
  }

  const transcription = String(metadata.threecx_transcription || '').trim();
  if (!transcription) return null;

  return {
    text: transcription,
    segments: [],
    model: '3cx-ai',
    transcribedAt: String(metadata.transcription_synced_at || ''),
    language: 'en',
  };
}

export function readThreeCxSummaryFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const summary = String(metadata.threecx_summary || '').trim();
  return summary || null;
}
