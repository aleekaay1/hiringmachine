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

function extensionFromContentType(contentType: string): string {
  const ct = contentType.toLowerCase();
  if (ct.includes('wav')) return 'wav';
  if (ct.includes('ogg')) return 'ogg';
  if (ct.includes('webm')) return 'webm';
  if (ct.includes('mp4') || ct.includes('m4a')) return 'm4a';
  return 'mp3';
}

function parseCachedTranscript(meta: Record<string, unknown>): CallRecordingTranscript | null {
  const raw = meta.recording_transcript;
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
    model: String(obj.model || 'whisper-1'),
    transcribedAt: String(obj.transcribed_at || obj.transcribedAt || ''),
    language: String(obj.language || 'en'),
  };
}

export function readTranscriptFromCallMetadata(
  metadata: Record<string, unknown> | null | undefined,
): CallRecordingTranscript | null {
  if (!metadata || typeof metadata !== 'object') return null;
  return parseCachedTranscript(metadata);
}

export async function transcribeRecordingAudio(
  audioBytes: ArrayBuffer,
  contentType: string,
): Promise<CallRecordingTranscript> {
  const apiKey = Deno.env.get('OPENAI_API_KEY')?.trim();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured for transcription.');
  }

  const ext = extensionFromContentType(contentType);
  const form = new FormData();
  form.append('file', new Blob([audioBytes], { type: contentType || 'audio/mpeg' }), `recording.${ext}`);
  form.append('model', 'whisper-1');
  form.append('language', 'en');
  form.append('response_format', 'verbose_json');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  const payload = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok) {
    const detail = String(payload.error && typeof payload.error === 'object'
      ? (payload.error as Record<string, unknown>).message
      : payload.error || payload.message || `Transcription failed (${res.status})`);
    throw new Error(detail);
  }

  const text = String(payload.text || '').trim();
  const segments = Array.isArray(payload.segments)
    ? payload.segments
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
    model: 'whisper-1',
    transcribedAt: new Date().toISOString(),
    language: String(payload.language || 'en'),
  };
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
