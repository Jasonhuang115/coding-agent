// Journal Recall — triggered recall of relevant knowledge
// Phase 2: Backed by unified Mnemosyne entities table

import { getMnemosyneStore } from "../memory/store.js";
import type { EntityRow } from "../memory/store.js";

export interface RecallResult {
  query: string; entries: EntityRow[]; summary: string; contextBlock: string | null;
}

export function recallKnowledge(query: string, limit = 5): RecallResult {
  const store = getMnemosyneStore();
  const results = store.searchWithRelevance(query, limit);
  const entries = results.map((r) => r.entity);
  const summary = entries.length > 0 ? `从记忆图谱中找到 ${entries.length} 条相关知识` : "记忆图谱中没有找到相关内容";
  return { query, entries, summary, contextBlock: buildContextBlock(entries) };
}

export function recallOnMessage(message: string): string | null {
  if (!shouldRecall(message)) return null;
  return recallKnowledge(message, 3).contextBlock;
}

function shouldRecall(message: string): boolean {
  const triggers = [/之前.*怎么/, /上次.*解决/, /我记得/, /怎么处理/, /有什么.*建议/, /之前.*bug/, /how did (we|you|i) (fix|solve|handle)/i];
  return triggers.some((re) => re.test(message));
}

export function sessionStartRecall(projectPath: string): string | null {
  const store = getMnemosyneStore();
  const projectName = projectPath.split("/").pop() || "";
  const results = store.searchWithRelevance(projectName, 5);
  const manualMemories = store.getManualMemories(3);

  const seen = new Set<number>();
  const merged: EntityRow[] = [];
  for (const { entity } of results) { if (!seen.has(entity.id)) { seen.add(entity.id); merged.push(entity); } }
  for (const entity of manualMemories) { if (!seen.has(entity.id)) { seen.add(entity.id); merged.push(entity); } }

  return merged.length > 0 ? buildContextBlock(merged.slice(0, 5)) : null;
}

function buildContextBlock(entries: EntityRow[]): string | null {
  if (entries.length === 0) return null;
  const lines = ["## 🧠 Mnemosyne 记忆图谱 — 相关知识", ""];
  for (const entry of entries) {
    const icon = { config: "📝", error: "🔧", concept: "📖", dependency: "📦", api: "🔌", deploy: "🚀", test: "✅" }[entry.type] ?? "📌";
    const sourceTag = entry.source === "manual" ? " [📓 手动]" : entry.source === "memories_md" ? " [📓 MD]" : entry.source === "seeder" ? " [🌱]" : "";
    lines.push(`### ${icon} ${entry.name}${sourceTag}`);
    lines.push(`> ${entry.content.slice(0, 300)}`);
    lines.push("");
  }
  lines.push("💡 用 `/memory search <关键词>` 搜索更多。");
  return lines.join("\n");
}

export function detectKnowledgeGaps(recentTopics: string[]): Array<{ topic: string; suggestion: string }> {
  const store = getMnemosyneStore();
  return recentTopics
    .filter((topic) => store.searchWithRelevance(topic, 1).length === 0)
    .map((topic) => ({ topic, suggestion: `你最近遇到了「${topic}」相关的问题，建议用 /remember 记录下来。` }));
}
