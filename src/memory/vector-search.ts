// Vector search — brute-force cosine similarity over entity embeddings
import { cosineSimilarity } from "./embedding/setup.js";
import type { MnemosyneStore, EntityRow } from "./store.js";

export interface VectorSearchResult { entity: EntityRow; similarity: number; }

export function storeEmbedding(store: MnemosyneStore, entityId: number, embedding: Float32Array): void {
  store.setEmbedding(entityId, Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength));
}

export async function embedAndStore(store: MnemosyneStore, entityId: number, text: string): Promise<void> {
  const { generate } = await import("./embedding/generate.js");
  const embedding = await generate(text);
  if (embedding) storeEmbedding(store, entityId, embedding);
}

export async function searchByVector(store: MnemosyneStore, queryEmbedding: Float32Array, limit = 10): Promise<VectorSearchResult[]> {
  const results: VectorSearchResult[] = [];
  for (const { id } of store.getAllEntityIds(500)) {
    const entity = store.getEntity(id);
    if (!entity || !entity.embedding) continue;
    const entityEmbedding = new Float32Array(entity.embedding.buffer, entity.embedding.byteOffset, entity.embedding.byteLength / 4);
    const similarity = cosineSimilarity(queryEmbedding, entityEmbedding);
    if (similarity > 0.1) results.push({ entity, similarity });
  }
  return results.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
}

export async function embedAllEntities(store: MnemosyneStore, onProgress?: (done: number, total: number) => void): Promise<number> {
  const allIds = store.getAllEntityIds(1000);
  let embedded = 0;
  for (let i = 0; i < allIds.length; i++) {
    const entity = store.getEntity(allIds[i].id);
    if (!entity || entity.embedding) continue;
    await embedAndStore(store, entity.id, `${entity.name} ${entity.content}`.slice(0, 500));
    embedded++;
    if (onProgress) onProgress(i + 1, allIds.length);
  }
  return embedded;
}
