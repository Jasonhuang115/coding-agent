// Agent tool — spawn a subagent to handle independent subtasks
// Supports: built-in types, custom definitions, worktree isolation, background execution

import type { ToolDefinition, AgentContext } from "../core-types.js";
import { getBuiltinDefinition, spawnSubagent, spawnSubagentInWorktree, spawnSubagentInBackground } from "../agent/subagent.js";
import { findDefinition, getAllDefinitions } from "../agent/agent-defs.js";

async function getAvailableTypes(): Promise<string> {
  const defs = await getAllDefinitions();
  return defs.map((d) => `"${d.name}"`).join(" | ");
}

export const agentTool: ToolDefinition = {
  name: "Agent",
  description:
    "Launch a subagent to handle complex, multi-step tasks. " +
    "Subagents have scoped tools (no Agent tool access by default) and run independently. " +
    "Use for: parallel exploration, codebase research, verification, or any task " +
    "that can be delegated without the full tool set." +
    "\n\nAvailable subagent types: explore | general | verify (plus custom from .rubato/agents/*.md)" +
    "\n\nOptions:" +
    "\n- isolation: \"worktree\" runs the subagent in a git worktree for safe writes." +
    "\n- run_in_background: true to run asynchronously.",
  inputSchema: {
    type: "object",
    properties: {
      description: { type: "string", description: "A short (3-5 word) description of the task" },
      prompt: { type: "string", description: "The task for the subagent to perform" },
      subagent_type: { type: "string", description: "Type: 'explore', 'general', 'verify', or custom name from .rubato/agents/*.md" },
      model: { type: "string", description: "Optional model override. Use 'inherit' (default) or a specific model ID." },
      isolation: { type: "string", enum: ["none", "worktree"], description: "Isolation mode. 'worktree' creates a git worktree. Default: 'none'." },
      run_in_background: { type: "boolean", description: "Run subagent in background. Default: false." },
    },
    required: ["description", "prompt"],
  },
  type: "write",
  requiresApproval: false,
  async handler(input, ctx: AgentContext) {
    const subagentType = (input.subagent_type as string) ?? "general";
    const prompt = input.prompt as string;
    const model = input.model as string | undefined;
    const isolation = (input.isolation as string) ?? "none";
    const runInBackground = input.run_in_background === true;

    let definition;
    try {
      definition = getBuiltinDefinition(subagentType);
    } catch {
      const customDef = await findDefinition(subagentType);
      if (!customDef) {
        const defs = await getAllDefinitions();
        return { content: `Unknown subagent type "${subagentType}". Available: ${defs.map((d) => d.name).join(", ")}.`, isError: true };
      }
      definition = customDef;
    }

    if (model) definition.model = model;

    // Background execution
    if (runInBackground) {
      const handle = spawnSubagentInBackground(definition, prompt, ctx, ctx.config);
      return { content: `## Background Subagent Spawned\n**Agent ID:** ${handle.agentId}\n**Type:** ${definition.name}\n**Status:** running in background\n\nThe subagent is working independently.` };
    }

    // Worktree isolation
    let result;
    if (isolation === "worktree") {
      result = await spawnSubagentInWorktree(definition, prompt, ctx, ctx.config);
    } else {
      result = await spawnSubagent(definition, prompt, ctx, ctx.config);
    }

    const isolationNote = isolation === "worktree" ? " [isolated worktree]" : "";
    const header = `## Subagent: ${definition.name}${isolationNote} (${result.status})\n**Agent ID:** ${result.agentId}\n**Tokens:** ${result.usage.inputTokens} in / ${result.usage.outputTokens} out | **Tool calls:** ${result.usage.toolCalls}\n\n---\n\n`;

    return { content: header + result.output, isError: result.status === "failed" };
  },
};
