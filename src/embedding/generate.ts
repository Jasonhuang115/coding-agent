// Embedding generator — produces 384-dim vectors for memory entries and queries
import { generateSimpleEmbedding, setupEmbeddingInfrastructure } from "./setup.js";

let onnxReady = false;
let setupPromise: Promise<boolean> | null = null;

export async function initEmbeddings(): Promise<boolean> {
  if (setupPromise) return setupPromise;
  setupPromise = (async () => { const r = await setupEmbeddingInfrastructure(); onnxReady = r.ready; return onnxReady; })();
  return setupPromise;
}

export async function generate(text: string): Promise<Float32Array | null> {
  if (!text || text.trim().length === 0) return null;
  return generateSimpleEmbedding(text);
}

export async function generateBatch(texts: string[]): Promise<Float32Array[]> {
  return texts.map((t) => generateSimpleEmbedding(t));
}

export function isOnnxReady(): boolean { return onnxReady; }
