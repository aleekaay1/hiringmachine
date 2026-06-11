import type { RecordingTranscript, RecordingTranscriptSegment } from './threecxCallLogAdmin';

const LOCAL_WHISPER_MODEL = 'Xenova/whisper-small.en';

type Transcriber = (
  audio: string,
  options?: Record<string, unknown>,
) => Promise<{
  text?: string;
  chunks?: Array<{ timestamp?: [number, number | null]; text?: string }>;
}>;

let transcriberPromise: Promise<Transcriber> | null = null;

function configureTransformersEnv(env: {
  allowLocalModels: boolean;
  allowRemoteModels: boolean;
  useBrowserCache: boolean;
  localModelPath: string;
  backends: { onnx: { wasm: { wasmPaths: string } } };
}): void {
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.localModelPath = '/models/';
  env.useBrowserCache = true;
  env.backends.onnx.wasm.wasmPaths = '/onnxruntime-web/';
}

function userStatusMessage(raw: string): string {
  if (raw.includes('Downloading model') || raw.includes('progress')) {
    const pct = raw.match(/(\d+)%/);
    return pct ? `Getting ready… ${pct[1]}%` : 'Getting ready…';
  }
  if (raw.includes('first time') || raw.includes('Loading free') || raw.includes('speech model')) {
    return 'Setting up on your device — only needed once';
  }
  if (raw.includes('Preparing')) return 'Almost ready…';
  if (raw.includes('Transcribing')) return 'Transcribing your call…';
  return 'Transcribing your call…';
}

function friendlyTranscribeError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('<!DOCTYPE') || msg.includes('Unexpected token') || msg.includes('404')) {
    return new Error('We could not load transcription on this device. Refresh and try again.');
  }
  if (/fetch|network|failed/i.test(msg)) {
    return new Error('Connection issue while transcribing. Try again in a moment.');
  }
  return new Error('We could not transcribe this call. Try again in a moment.');
}

async function getTranscriber(onStatus?: (message: string) => void): Promise<Transcriber> {
  if (!transcriberPromise) {
    transcriberPromise = (async () => {
      onStatus?.('Setting up on your device — only needed once');
      const { pipeline, env } = await import('@xenova/transformers');
      configureTransformersEnv(env);
      return pipeline('automatic-speech-recognition', LOCAL_WHISPER_MODEL, {
        progress_callback: (progress: { status?: string; file?: string; progress?: number }) => {
          if (progress.status === 'progress' && progress.file && Number.isFinite(progress.progress)) {
            const pct = Math.round(Number(progress.progress));
            onStatus?.(`Getting ready… ${pct}%`);
            return;
          }
          if (progress.status === 'done' && progress.file) {
            onStatus?.('Almost ready…');
          }
        },
      }) as Promise<Transcriber>;
    })();
  }
  return transcriberPromise;
}

function chunksToSegments(
  chunks: Array<{ timestamp?: [number, number | null]; text?: string }>,
): RecordingTranscriptSegment[] {
  const segments: RecordingTranscriptSegment[] = [];
  for (const chunk of chunks) {
    const text = String(chunk.text || '').trim();
    if (!text) continue;
    const start = Number(chunk.timestamp?.[0] ?? NaN);
    const endRaw = chunk.timestamp?.[1];
    const end = endRaw == null ? start + 2 : Number(endRaw);
    if (!Number.isFinite(start)) continue;
    segments.push({
      start,
      end: Number.isFinite(end) && end > start ? end : start + 2,
      text,
    });
  }
  return segments;
}

/** In-browser English transcription — model served from this app, runs on the user's device. */
export async function transcribeRecordingLocally(
  audioUrl: string,
  onStatus?: (message: string) => void,
): Promise<RecordingTranscript> {
  try {
    onStatus?.('Transcribing your call…');
    const transcriber = await getTranscriber((message) => onStatus?.(userStatusMessage(message)));
    const output = await transcriber(audioUrl, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true,
      language: 'english',
      task: 'transcribe',
    });

    const text = String(output?.text || '').trim();
    const segments = Array.isArray(output?.chunks) ? chunksToSegments(output.chunks) : [];

    return {
      text: text || segments.map((seg) => seg.text).join(' ').trim(),
      segments,
      model: LOCAL_WHISPER_MODEL,
      transcribedAt: new Date().toISOString(),
      language: 'en',
    };
  } catch (err) {
    throw friendlyTranscribeError(err);
  }
}
