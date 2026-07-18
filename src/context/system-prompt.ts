// System prompt builder — constructs the base system prompt
// Delegates to the 3-layer PromptAssembler (static → capability → dynamic).
// The 4th layer (ephemeral) is handled by the agent loop per-turn.

import type { AgentContext, ToolDefinition } from "../shared/core-types.js";
import { getPromptAssembler } from "../prompt/assembler.js";

/**
 * Build the complete system prompt for the given context and tools.
 * Uses the 3-layer prompt architecture:
 *   Static (cacheable) → Capability (tool-dependent) → Dynamic (session-scoped)
 */
export function buildSystemPrompt(
  ctx: AgentContext,
  tools: ToolDefinition[]
): string {
  const provider = ctx.config.model.provider;
  const assembler = getPromptAssembler(provider);
  return assembler.assembleFlat(ctx, tools);
}
