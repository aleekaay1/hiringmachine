/**
 * Copies ONNX Runtime WASM binaries into public/ so transcription never hits external CDNs.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '../node_modules/onnxruntime-web/dist');
const DEST = path.join(__dirname, '../public/onnxruntime-web');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

if (!fs.existsSync(SRC)) {
  console.error('[onnx] onnxruntime-web dist not found — run npm install first');
  process.exit(1);
}

copyDir(SRC, DEST);
console.log('[onnx] copied wasm runtime to public/onnxruntime-web');
