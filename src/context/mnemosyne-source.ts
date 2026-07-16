// Mnemosyne context source — injects relevant memories into the system prompt
// Uses Evaluator scoring to filter memories above the inject threshold

import type { ContextSource, ContextBlock, AgentContext } from "../core-types.js";
import { getMnemosyneStore } from "../memory/store.js";
import type { EntityRow } from "../memory/store.js";
import { evaluateMemory, THRESHOLDS, getInjectCandidates } from "../memory/evaluator.js";

export class MnemosyneSource implements ContextSource {
  readonly name = "mnemosyne";
  readonly priority = 15;

  async fetch(query: string, ctx: AgentContext): Promise<ContextBlock | null> {
    try {
      const store = getMnemosyneStore();

      const candidates = getInjectCandidates(query, 8);
      const searchResults = store.searchWithRelevance(query, 5);

      const seen = new Set<number>();
      const merged: Array<{ entity: EntityRow; relevance: number; evaluatorScore: number }> = [];

      for (const c of candidates) {
        const entity = store.getEntity(c.entityId);
        if (entity && !seen.has(entity.id)) {
          seen.add(entity.id);
          merged.push({ entity, relevance: c.score.total, evaluatorScore: c.score.total });
        }
      }

      for (const { entity, relevance } of searchResults) {
        if (!seen.has(entity.id)) {
          seen.add(entity.id);
          const evalResult = evaluateMemory(entity.id);
          merged.push({ entity, relevance, evaluatorScore: evalResult?.score.total ?? 0.5 });
        }
      }

      const toInject = merged.filter((m) => m.evaluatorScore >= THRESHOLDS.inject || m.relevance >= 0.5);
      if (toInject.length === 0) return null;

      const lines = ["## 💡 Related Knowledge (Mnemosyne)", ""];

      for (const { entity, relevance, evaluatorScore } of toInject.slice(0, 5)) {
        const sourceTag = entity.source === "manual" ? " [📓 manual]" : entity.source === "memories_md" ? " [📓 MEMORY.md]" : entity.source === "seeder" ? " [🌱 seeded]" : "";
        const neighborStr = this.formatWithNeighbors(store, entity);
        lines.push(`### ${entity.name} (${entity.type}, score: ${evaluatorScore.toFixed(2)}, rel: ${relevance.toFixed(2)})${sourceTag}`);
        if (entity.content) lines.push(`> ${entity.content.slice(0, 200)}`);
        if (neighborStr) lines.push(neighborStr);
        lines.push("");
      }

      for (const { entity } of toInject.slice(0, 5)) {
        store.recordAccess(entity.id, ctx.sessionId);
        store.recordFeedback(entity.id, ctx.sessionId, "injected", 0, { query, source: "mnemosyne-source" });
      }

      return { content: lines.join("\n"), priority: this.priority, source: this.name };
    } catch {
      return null;
    }
  }

  private formatWithNeighbors(store: ReturnType<typeof getMnemosyneStore>, entity: { id: number }): string {
    const neighbors = store.getNeighbors(entity.id, 0.5);
    if (neighbors.length === 0) return "";
    const related = neighbors.slice(0, 5).map((n) => `  - ${n.relation.relation_type} → ${n.entity.name} (${n.relevance.toFixed(2)})`);
    return `  Related:\n${related.join("\n")}`;
  }
}
