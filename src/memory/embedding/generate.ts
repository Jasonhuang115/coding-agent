// Embedding generator — produces 384-dim vectors for memory entries and queries
import { generateSimpleEmbedding } from "./setup.js";

/**
 * Generate a 384-dim embedding vector for a text string.
 * Returns null for empty input.
 */
export async function generate(text: string): Promise<Float32Array | null> {
  if (!text || text.trim().length === 0) return null;
  return generateSimpleEmbedding(text);
}

/**
 * Generate embeddings for multiple texts in batch.
 */
export async function generateBatch(texts: string[]): Promise<Float32Array[]> {
  return texts.map((t) => generateSimpleEmbedding(t));
}
