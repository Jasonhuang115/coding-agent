// Embedding infrastructure — ONNX model lazy download + trigram-hash embeddings
// Phase 2: Lightweight embeddings with zero dependencies

import fs from "fs";
import path from "path";
import https from "https";

const MODEL_DIR = path.join(process.env.HOME ?? "/tmp", ".rubato", "models");
const MODEL_NAME = "all-MiniLM-L6-v2";
const MODEL_URL = "https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/onnx/model.onnx";

export interface EmbeddingSetupResult { ready: boolean; reason?: string; modelPath?: string; }

export async function setupEmbeddingInfrastructure(): Promise<EmbeddingSetupResult> {
  const modelDir = path.join(MODEL_DIR, MODEL_NAME);
  const modelPath = path.join(modelDir, "model.onnx");
  if (fs.existsSync(modelPath)) return { ready: true, modelPath };
  try { await downloadModel(modelDir, modelPath); return { ready: true, modelPath }; }
  catch (err) { return { ready: false, reason: `Failed to download model: ${err}` }; }
}

function downloadModel(modelDir: string, modelPath: string): Promise<void> {
  fs.mkdirSync(modelDir, { recursive: true });
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(modelPath);
    https.get(MODEL_URL, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) { file.close(); fs.unlinkSync(modelPath); https.get(redirectUrl, (rr) => { rr.pipe(file); file.on("finish", () => { file.close(); resolve(); }); }).on("error", reject); return; }
      }
      if (response.statusCode !== 200) { file.close(); fs.unlinkSync(modelPath); reject(new Error(`HTTP ${response.statusCode}`)); return; }
      response.pipe(file);
      file.on("finish", () => { file.close(); resolve(); });
    }).on("error", (err) => { file.close(); if (fs.existsSync(modelPath)) fs.unlinkSync(modelPath); reject(err); });
  });
}

// ---- Simple trigram-hash embedding (zero-dependency, 384-dim) ----

export function generateSimpleEmbedding(text: string): Float32Array {
  const DIM = 384;
  const vector = new Float32Array(DIM);
  const lower = text.toLowerCase().trim();

  // Trigram features
  for (let i = 0; i < lower.length - 2; i++) {
    let hash = 0;
    for (let j = 0; j < 3; j++) hash = ((hash << 5) - hash) + lower.charCodeAt(i + j);
    vector[Math.abs(hash) % DIM] += 0.1;
  }

  // Word-level features
  const words = lower.split(/[\s,.;:!?()[\]{}"'/\\|`~@#$%^&*+=<>]+/);
  for (const word of words) {
    if (word.length < 2) continue;
    let hash = 0;
    for (let j = 0; j < word.length; j++) hash = ((hash << 5) - hash) + word.charCodeAt(j);
    vector[Math.abs(hash) % DIM] += 0.3;
  }

  // L2 normalize
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (norm > 0) for (let i = 0; i < DIM; i++) vector[i] /= norm;

  return vector;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) { dotProduct += a[i] * b[i]; normA += a[i] * a[i]; normB += b[i] * b[i]; }
  const normProduct = Math.sqrt(normA) * Math.sqrt(normB);
  return normProduct === 0 ? 0 : dotProduct / normProduct;
}

export function getModelDir(): string { return path.join(MODEL_DIR, MODEL_NAME); }

export const MEMORY_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS memory_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, content TEXT NOT NULL, source TEXT, timestamp INTEGER NOT NULL, embedding BLOB);
CREATE TABLE IF NOT EXISTS memory_edges (id INTEGER PRIMARY KEY AUTOINCREMENT, source_id INTEGER NOT NULL REFERENCES memory_entries(id), target_id INTEGER NOT NULL REFERENCES memory_entries(id), relation TEXT NOT NULL, weight REAL DEFAULT 1.0, timestamp INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_memory_type ON memory_entries(type);
CREATE INDEX IF NOT EXISTS idx_memory_edges_source ON memory_edges(source_id);
CREATE INDEX IF NOT EXISTS idx_memory_edges_target ON memory_edges(target_id);
`;

export function getMemoryDBPath(): string {
  return path.join(process.env.HOME ?? "/tmp", ".rubato", "mnemosyne.db");
}
