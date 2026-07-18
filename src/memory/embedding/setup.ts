// Trigram-hash embedding — zero-dependency, 384-dim, local generation
// Provides lightweight semantic search without GPU or model downloads

/**
 * Generate a 384-dim normalized embedding vector from text.
 * Uses trigram hashing + word-level features + L2 normalization.
 * No external dependencies, instant generation.
 */
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

/**
 * Cosine similarity between two embedding vectors.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) { dotProduct += a[i] * b[i]; normA += a[i] * a[i]; normB += b[i] * b[i]; }
  const normProduct = Math.sqrt(normA) * Math.sqrt(normB);
  return normProduct === 0 ? 0 : dotProduct / normProduct;
}
