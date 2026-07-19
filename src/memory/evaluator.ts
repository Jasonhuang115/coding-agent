// Evaluator — multi-dimensional memory diagnostics and lifecycle decisions.

import { getMnemosyneStore } from "./store.js";
import type { MnemosyneStore, EntityRow } from "./store.js";

export interface MemoryScore {
  total: number;
  dimensions: { accuracy: number; freshness: number; relevance: number; conflict: number; frequency: number; feedback: number };
}

export interface ScoreReport {
  entityId: number; entityName: string;
  score: MemoryScore;
  decisions: {
    shouldInject: boolean;
    shouldPromote: boolean;
    shouldDormant: boolean;
    shouldDeleteNoise: boolean;
  };
  recommendation: "inject" | "hold" | "dormant" | "delete_noise" | "upgrade";
}

export const THRESHOLDS = {
  inject: 0.55,
  upgrade: 0.85,
  upgradeMinAccesses: 10,
  dormantAfterDays: 90,
};

export function evaluateMemory(entityId: number, store?: MnemosyneStore): ScoreReport | null {
  const s = store ?? getMnemosyneStore();
  const entity = s.getEntity(entityId);
  if (!entity) return null;

  const feedback = s.getFeedbackStats(entityId);
  const now = Date.now();

  const accuracy = computeAccuracy(feedback);
  const freshness = computeFreshness(entity, now);
  const relevance = computeRelevance(entityId, entity.access_count ?? 0, s);
  const conflict = computeConflict(entity, s);
  const frequency = computeFrequency(feedback);
  const feedbackScore = computeFeedbackScore(entity.feedback_score ?? 0);

  const weights = { accuracy: 0.25, freshness: 0.15, relevance: 0.15, conflict: 0.10, frequency: 0.15, feedback: 0.20 };
  const total = clamp(
    accuracy * weights.accuracy + freshness * weights.freshness +
    relevance * weights.relevance + conflict * weights.conflict +
    frequency * weights.frequency + feedbackScore * weights.feedback
  );

  const score: MemoryScore = { total, dimensions: { accuracy, freshness, relevance, conflict, frequency, feedback: feedbackScore } };

  const ageDays = (now - entity.updated_at) / (1000 * 60 * 60 * 24);
  const isActive = entity.status === "active";
  const shouldPromote = isActive && total >= THRESHOLDS.upgrade &&
    feedback.injections >= THRESHOLDS.upgradeMinAccesses && feedback.references >= 3;
  const shouldInject = isActive && total >= THRESHOLDS.inject;
  const shouldDormant = isActive && entity.protected === 0 && ageDays >= THRESHOLDS.dormantAfterDays &&
    entity.access_count === 0 && feedback.references === 0 && feedback.injections <= 1 && entity.feedback_score <= 0;
  const shouldDeleteNoise = shouldDormant && (entity.source === "auto" || entity.source === "seeder") &&
    entity.confidence <= 0.35 && isLowInformation(entity.content);

  let recommendation: ScoreReport["recommendation"] = "hold";
  if (shouldPromote) recommendation = "upgrade";
  else if (shouldInject) recommendation = "inject";
  else if (shouldDeleteNoise) recommendation = "delete_noise";
  else if (shouldDormant) recommendation = "dormant";

  return {
    entityId: entity.id, entityName: entity.name, score, recommendation,
    decisions: { shouldInject, shouldPromote, shouldDormant, shouldDeleteNoise },
  };
}

export function evaluateAll(limit = 200, store?: MnemosyneStore): ScoreReport[] {
  const s = store ?? getMnemosyneStore();
  return s.getAllEntityIds(limit)
    .map((row) => evaluateMemory(row.id, s))
    .filter((r): r is ScoreReport => r !== null)
    .sort((a, b) => b.score.total - a.score.total);
}

export function getInjectCandidates(query?: string, limit = 10, store?: MnemosyneStore): ScoreReport[] {
  const all = evaluateAll(100, store);
  const candidates = all.filter((r) => r.recommendation === "inject" || r.recommendation === "upgrade");
  if (query) {
    const lower = query.toLowerCase();
    candidates.sort((a, b) => {
      const aMatch = a.entityName.toLowerCase().includes(lower) ? 0.2 : 0;
      const bMatch = b.entityName.toLowerCase().includes(lower) ? 0.2 : 0;
      return (b.score.total + bMatch) - (a.score.total + aMatch);
    });
  }
  return candidates.slice(0, limit);
}

export function getDormantCandidates(limit = 20, store?: MnemosyneStore): ScoreReport[] {
  return evaluateAll(100, store).filter((r) => r.decisions.shouldDormant).slice(0, limit);
}

/** @deprecated Use getDormantCandidates; this no longer means physical deletion. */
export function getForgetCandidates(limit = 20, store?: MnemosyneStore): ScoreReport[] {
  return getDormantCandidates(limit, store);
}

// ---- Dimension computations ----

function computeAccuracy(feedback: { injections: number; successes: number; failures: number }): number {
  const total = feedback.successes + feedback.failures;
  if (total === 0) return 0.5;
  return (feedback.successes + 1) / (total + 2);
}

function computeFreshness(entity: EntityRow, now: number): number {
  const ageDays = (now - entity.updated_at) / (1000 * 60 * 60 * 24);
  return clamp(Math.exp(-0.0231 * ageDays));
}

function computeRelevance(entityId: number, accessCount: number, s: MnemosyneStore): number {
  const relationCount = s.getRelations(entityId).length;
  return clamp(0.3 + 0.7 * (1 / (1 + Math.exp(-0.3 * (accessCount - 3)))) + 0.05 * Math.min(relationCount, 10));
}

function computeFeedbackScore(feedbackScore: number): number {
  return clamp(0.5 + feedbackScore * 0.5);
}

function computeConflict(entity: EntityRow, s: MnemosyneStore): number {
  const relations = s.getRelations(entity.id);
  const conflictCount = relations.filter((r) => r.relation_type === "REPLACES" || r.relation_type === "ALTERNATIVE_TO").length;
  return clamp(1.0 - conflictCount * 0.2);
}

function computeFrequency(feedback: { injections: number; successes: number; failures: number }): number {
  return clamp(1 / (1 + Math.exp(-0.15 * (feedback.injections - 5))));
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function isLowInformation(content: string): boolean {
  const normalized = content.trim().toLowerCase();
  return normalized.length < 40 || /^(todo|fix later|tbd|unknown|n\/a)[.! ]*$/.test(normalized);
}
