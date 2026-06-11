export type TranscriptSegment = {
  start: number;
  end: number;
  text: string;
};

export type CallRecordingTranscript = {
  text: string;
  segments: TranscriptSegment[];
  model: string;
  transcribedAt: string;
  language: string;
};

function parseCachedTranscript(raw: unknown): CallRecordingTranscript | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const text = String(obj.text || '').trim();
  if (!text) return null;
  const segments = Array.isArray(obj.segments)
    ? obj.segments
      .map((row) => {
        if (!row || typeof row !== 'object') return null;
        const seg = row as Record<string, unknown>;
        const start = Number(seg.start);
        const end = Number(seg.end);
        const segText = String(seg.text || '').trim();
        if (!Number.isFinite(start) || !Number.isFinite(end) || !segText) return null;
        return { start, end, text: segText };
      })
      .filter((row): row is TranscriptSegment => row != null)
    : [];
  return {
    text,
    segments,
    model: String(obj.model || 'whisper-small.en-local'),
    transcribedAt: String(obj.transcribed_at || obj.transcribedAt || ''),
    language: String(obj.language || 'en'),
  };
}

export function readTranscriptFromCallMetadata(
  metadata: Record<string, unknown> | null | undefined,
): CallRecordingTranscript | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const from3cx = String(metadata.threecx_transcription || '').trim();
  if (from3cx) {
    return {
      text: from3cx,
      segments: [],
      model: '3cx-ai',
      transcribedAt: String(metadata.transcription_synced_at || ''),
      language: 'en',
    };
  }
  return parseCachedTranscript(metadata.recording_transcript);
}

export function transcriptForMetadataStorage(transcript: CallRecordingTranscript): Record<string, unknown> {
  return {
    text: transcript.text,
    segments: transcript.segments,
    model: transcript.model,
    language: transcript.language,
    transcribed_at: transcript.transcribedAt,
  };
}

export function normalizeTranscriptInput(input: unknown): CallRecordingTranscript | null {
  if (!input || typeof input !== 'object') return null;
  const obj = input as Record<string, unknown>;
  const text = String(obj.text || '').trim();
  if (!text) return null;
  const segments = Array.isArray(obj.segments)
    ? obj.segments
      .map((row) => {
        if (!row || typeof row !== 'object') return null;
        const seg = row as Record<string, unknown>;
        const start = Number(seg.start);
        const end = Number(seg.end);
        const segText = String(seg.text || '').trim();
        if (!Number.isFinite(start) || !Number.isFinite(end) || !segText) return null;
        return { start, end, text: segText };
      })
      .filter((row): row is TranscriptSegment => row != null)
    : [];
  return {
    text,
    segments,
    model: String(obj.model || 'whisper-small.en-local'),
    transcribedAt: String(obj.transcribedAt || obj.transcribed_at || new Date().toISOString()),
    language: String(obj.language || 'en'),
  };
}
