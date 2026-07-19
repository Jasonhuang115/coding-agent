// Consolidator — background memory maintenance
// Clusters similar memories, abstracts to principles, and archives stale entries.

import { getMnemosyneStore } from "./store.js";
import type { EntityRow } from "./store.js";
import { evaluateAll } from "./evaluator.js";

export interface ConsolidationResult {
  merged: number; abstracted: number; dormant: number; deleted: number;
  errors: string[];
}

let sessionCount = 0;
let lastConsolidationTime = 0;

export function shouldConsolidate(): boolean {
  sessionCount++;
  const stats = getMnemosyneStore().getStats();
  const timeElapsed = Date.now() - lastConsolidationTime;
  return sessionCount >= 5 && (stats.entities > 50 || timeElapsed > 30 * 60 * 1000);
}

export async function consolidateMemories(): Promise<ConsolidationResult> {
  const store = getMnemosyneStore();
  const result: ConsolidationResult = { merged: 0, abstracted: 0, dormant: 0, deleted: 0, errors: [] };
  lastConsolidationTime = Date.now();
  sessionCount = 0;

  try {
    const scored = evaluateAll(200);

    // Cluster similar memories
    const entities = scored.map((s) => store.getEntity(s.entityId)).filter(Boolean) as EntityRow[];
    const clusters = findClusters(entities);

    // Abstract each cluster
    for (const cluster of clusters) {
      try { if (abstractCluster(store, cluster)) result.abstracted++; }
      catch (err) { result.errors.push(`Abstract "${cluster.subject}": ${err}`); }
    }

    // Merge duplicates
    result.merged = mergeDuplicates(store);

    // Old memories leave default retrieval first. Only clear auto-generated noise is deleted.
    const noiseIds: number[] = [];
    for (const candidate of scored) {
      if (candidate.decisions.shouldDeleteNoise) noiseIds.push(candidate.entityId);
      else if (candidate.decisions.shouldDormant && store.markDormant(candidate.entityId)) result.dormant++;
    }
    result.deleted = store.deleteNoiseCandidates(noiseIds);
  } catch (err) {
    result.errors.push(`Consolidation failed: ${err}`);
  }

  return result;
}

function findClusters(entities: EntityRow[]): Array<{ entities: EntityRow[]; subject: string; cohesion: number }> {
  const clusters: Array<{ entities: EntityRow[]; subject: string; cohesion: number }> = [];
  const assigned = new Set<number>();

  for (const entity of entities) {
    if (assigned.has(entity.id)) continue;
    const similar = entities.filter((o) => o.id !== entity.id && !assigned.has(o.id) && isSimilar(entity, o));
    if (similar.length >= 2) {
      const clusterEntities = [entity, ...similar];
      clusterEntities.forEach((e) => assigned.add(e.id));
      clusters.push({ entities: clusterEntities, subject: extractCommonSubject(clusterEntities), cohesion: computeCohesion(clusterEntities) });
    }
  }
  return clusters.sort((a, b) => b.cohesion - a.cohesion);
}

function isSimilar(a: EntityRow, b: EntityRow): boolean {
  if (a.type === b.type && jaccardSimilarity(a.name, b.name) > 0.3) return true;
  const wordsA = new Set(a.name.toLowerCase().split(/[/_-]/));
  const wordsB = new Set(b.name.toLowerCase().split(/[/_-]/));
  if ([...wordsA].filter((w) => wordsB.has(w) && w.length > 2).length >= 1) return true;
  return jaccardSimilarity(a.content.slice(0, 200), b.content.slice(0, 200)) > 0.4;
}

function extractCommonSubject(entities: EntityRow[]): string {
  const words = entities.flatMap((e) => e.name.toLowerCase().split(/[/_-]/));
  const freq = new Map<string, number>();
  for (const w of words) { if (w.length > 2) freq.set(w, (freq.get(w) || 0) + 1); }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w]) => w).join("/") || entities[0].type;
}

function computeCohesion(entities: EntityRow[]): number {
  if (entities.length < 2) return 0;
  let total = 0, pairs = 0;
  for (let i = 0; i < entities.length; i++)
    for (let j = i + 1; j < entities.length; j++)
      { total += jaccardSimilarity(entities[i].content, entities[j].content); pairs++; }
  return pairs > 0 ? total / pairs : 0;
}

function abstractCluster(store: ReturnType<typeof getMnemosyneStore>, cluster: { entities: EntityRow[]; subject: string }): boolean {
  if (cluster.entities.length < 2) return false;
  const avgConf = cluster.entities.reduce((s, e) => s + e.confidence, 0) / cluster.entities.length;
  const abstractContent = [
    `Abstracted from ${cluster.entities.length} related memories: ${cluster.entities.map((e) => e.name).join(", ")}`,
    `Subject: ${cluster.subject}`, `Type: ${cluster.entities[0].type}`,
    `Coverage: ${cluster.entities.map((e) => e.content.slice(0, 100)).join(" | ")}`,
  ].join("\n");

  store.upsertEntity(`principle/${cluster.subject}`, cluster.entities[0].type, abstractContent, "consolidator", Math.min(1.0, avgConf + 0.1), "auto", 0);
  const principle = store.findEntityByName(`principle/${cluster.subject}`);
  if (principle) {
    for (const member of cluster.entities)
      store.addRelation(principle.id, member.id, "RELATED_TO", 0.7, `Clustered by Consolidator`);
  }
  return true;
}

function mergeDuplicates(store: ReturnType<typeof getMnemosyneStore>): number {
  let merged = 0;
  const allIds = store.getAllEntityIds(500);
  const seen = new Map<string, number>();

  for (const { id } of allIds) {
    const entity = store.getEntity(id);
    if (!entity || entity.protected === 1) continue;
    const key = `${entity.type}:${entity.name.toLowerCase().trim()}`;
    if (seen.has(key)) {
      const existing = store.getEntity(seen.get(key)!);
      if (existing) {
        store.upsertEntity(existing.name, existing.type, existing.content.includes(entity.content) ? existing.content : `${existing.content}\n${entity.content}`, "consolidator", Math.max(existing.confidence, entity.confidence), existing.source, existing.protected);
        merged++;
      }
    } else { seen.set(key, id); }
  }
  return merged;
}

function jaccardSimilarity(a: string, b: string): number {
  const tokensA = new Set(tokenize(a)), tokensB = new Set(tokenize(b));
  if (tokensA.size === 0 && tokensB.size === 0) return 1;
  const intersection = [...tokensA].filter((t) => tokensB.has(t)).length;
  const union = new Set([...tokensA, ...tokensB]).size;
  return union > 0 ? intersection / union : 0;
}

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[\s,.;:!?()[\]{}"'/\\|`~@#$%^&*+=<>]+/).filter((t) => t.length > 1);
}
