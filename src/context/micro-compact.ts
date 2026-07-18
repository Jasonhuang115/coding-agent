// Micro-compact: pre-request cleanup of stale tool results.
// Position-based clearing — when many tool results have accumulated since
// the last assistant message (indicating heavy tool execution), old results
// from heavy-context tools (Read, Bash, Grep, etc.) are replaced with a
// placeholder to free context budget before the next API call.
//
// This is a zero-LLM-cost operation that mirrors Claude Code's
// time-based micro-compact, adapted for Rubato's message model
// (which doesn't carry per-message timestamps).

import type { Message } from "../shared/core-types.js";

// ---- Configuration ----

/** Tools whose results are safe to clear when stale. Edit/Write/TodoWrite
 *  results are preserved since their side effects are persistent. */
const COMPACTABLE_TOOLS = new Set([
  "Read",
  "Bash",
  "Grep",
  "Glob",
  "WebFetch",
  "WebSearch",
]);

/** Placeholder inserted in place of cleared tool result content. */
const CLEARED_MESSAGE = "[Old tool result content cleared]";

/** If the last assistant message is more than this many messages ago,
 *  stale tool result clearing is triggered. */
const DEFAULT_GAP_MESSAGES = 20;

/** Number of most recent compactable tool results to keep. */
const DEFAULT_KEEP_RECENT = 5;

// ---- Public API ----

export interface MicroCompactResult {
  messages: Message[];
  /** Number of tool results cleared (0 = no change). */
  cleared: number;
}

/**
 * Apply position-based micro-compaction to messages before an API request.
 *
 * When the last assistant message is far back in the conversation
 * (many tool results have accumulated since), content-clear all but the
 * most recent N compactable tool results.
 *
 * This shrinks the request body without using an LLM, keeping only
 * the most recent tool outputs that are likely still relevant.
 *
 * Returns unchanged messages when the trigger doesn't fire.
 */
export function microCompactBeforeRequest(
  messages: Message[],
  gapMessages: number = DEFAULT_GAP_MESSAGES,
  keepRecent: number = DEFAULT_KEEP_RECENT,
): MicroCompactResult {
  // 1. Find the last assistant message position
  const lastAssistantIdx = findLastAssistantIndex(messages);
  if (lastAssistantIdx < 0) return { messages, cleared: 0 };

  // 2. Check position-based gap: how many messages since last assistant?
  const messagesSinceAssistant = messages.length - 1 - lastAssistantIdx;
  if (messagesSinceAssistant < gapMessages) {
    return { messages, cleared: 0 };
  }

  // 3. Collect compactable tool_use IDs in encounter order
  const compactableIds = collectCompactableToolIds(messages);
  if (compactableIds.length === 0) return { messages, cleared: 0 };

  // 4. Keep the most recent N, clear the rest
  const keepSet = new Set(compactableIds.slice(-Math.max(1, keepRecent)));
  const clearSet = new Set(compactableIds.filter((id) => !keepSet.has(id)));

  if (clearSet.size === 0) return { messages, cleared: 0 };

  // 5. Replace content of stale tool results
  let cleared = 0;
  const result: Message[] = messages.map((msg) => {
    if (msg.role !== "user" || typeof msg.content === "string") {
      return msg;
    }
    let touched = false;
    const newContent = msg.content.map((block) => {
      if (
        block.type === "tool_result" &&
        clearSet.has(block.tool_use_id) &&
        block.content !== CLEARED_MESSAGE
      ) {
        cleared++;
        touched = true;
        return { ...block, content: CLEARED_MESSAGE };
      }
      return block;
    });
    if (!touched) return msg;
    return { ...msg, content: newContent };
  });

  return { messages: result, cleared };
}

// ---- Helpers ----

function findLastAssistantIndex(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "assistant") {
      return i;
    }
  }
  return -1;
}

/**
 * Walk messages and collect tool_use IDs for compactable tools,
 * in encounter order.
 */
function collectCompactableToolIds(messages: Message[]): string[] {
  const ids: string[] = [];
  for (const msg of messages) {
    if (msg.role === "assistant" && typeof msg.content !== "string") {
      for (const block of msg.content) {
        if (
          block.type === "tool_use" &&
          COMPACTABLE_TOOLS.has(block.name)
        ) {
          ids.push(block.id);
        }
      }
    }
  }
  return ids;
}
