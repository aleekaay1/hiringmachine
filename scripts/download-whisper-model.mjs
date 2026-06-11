/**
 * Downloads Whisper ONNX assets into public/models for same-origin browser transcription.
 * Runs at build time (Vercel can reach Hugging Face even when user networks block it).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODEL = 'Xenova/whisper-small.en';
const REVISION = 'main';
const OUT_DIR = path.join(__dirname, '../public/models/Xenova/whisper-small.en');

const FILES = [
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/encoder_model_quantized.onnx',
  'onnx/decoder_model_merged_quantized.onnx',
];

async function downloadFile(relativePath) {
  const dest = path.join(OUT_DIR, relativePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1024) {
    console.log(`[whisper] skip ${relativePath}`);
    return;
  }

  const url = `https://huggingface.co/${MODEL}/resolve/${REVISION}/${relativePath}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`[whisper] failed ${url} (${res.status})`);

  const data = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, data);
  console.log(`[whisper] saved ${relativePath} (${(data.length / 1024 / 1024).toFixed(1)} MB)`);
}

async function main() {
  console.log('[whisper] downloading model files…');
  for (const file of FILES) {
    await downloadFile(file);
  }
  console.log('[whisper] done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
