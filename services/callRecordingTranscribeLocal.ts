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

const ONNX_WASM_CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.14.0/dist/';

function configureTransformersEnv(env: {
  allowLocalModels: boolean;
  useBrowserCache: boolean;
  backends: { onnx: { wasm: { wasmPaths: string } } };
}): void {
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  env.backends.onnx.wasm.wasmPaths = ONNX_WASM_CDN;
}

function friendlyTranscribeError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('<!DOCTYPE') || msg.includes('Unexpected token')) {
    return new Error(
      'Could not download the free speech model (Hugging Face or CDN blocked on this network). Try another network, disable ad blockers, then reload.',
    );
  }
  return err instanceof Error ? err : new Error(msg || 'Local transcription failed.');
}

async function getTranscriber(onStatus?: (message: string) => void): Promise<Transcriber> {
  if (!transcriberPromise) {
    transcriberPromise = (async () => {
      onStatus?.('Loading free local speech model (first time only)…');
      const { pipeline, env } = await import('@xenova/transformers');
      configureTransformersEnv(env);
      return pipeline('automatic-speech-recognition', LOCAL_WHISPER_MODEL, {
        progress_callback: (progress: { status?: string; file?: string; progress?: number }) => {
          if (progress.status === 'progress' && progress.file && Number.isFinite(progress.progress)) {
            const pct = Math.round(Number(progress.progress));
            onStatus?.(`Downloading model… ${pct}%`);
            return;
          }
          if (progress.status === 'done' && progress.file) {
            onStatus?.('Preparing local transcriber…');
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

/** Free in-browser English transcription (Whisper via Transformers.js). */
export async function transcribeRecordingLocally(
  audioUrl: string,
  onStatus?: (message: string) => void,
): Promise<RecordingTranscript> {
  try {
    onStatus?.('Transcribing in your browser…');
    const transcriber = await getTranscriber(onStatus);
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
