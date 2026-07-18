// Capability Prompt Layer — tool usage policy, task management, communication
// Changes with the tool set. Approx ~800 tokens.

import type { ToolDefinition } from "../shared/core-types.js";

export function buildCapabilityPrompt(tools: ToolDefinition[]): string {
  const toolDescriptions = buildToolDescriptions(tools);

  return [
    toolUsagePolicy(),
    taskManagement(),
    communication(),
    toolSection(toolDescriptions),
  ].join("\n\n");
}

function toolUsagePolicy(): string {
  return `## Tool Usage Policy

### Tools Over Shell — ALWAYS
- Use Read instead of cat/head/tail. Use Write instead of echo > file. Use Edit instead of sed/awk.
- Use Grep instead of grep/find. Use Glob instead of ls for pattern matching.
- Reserve Bash ONLY for actual system commands: builds, tests, git, package managers, and CLI tools that have no dedicated tool equivalent.
- NEVER use bash echo or printf to communicate your thoughts to the user — output those directly in your response text.

### Parallelism
- Read tools (Read, Grep, Glob) can and SHOULD execute in parallel. When you need to read multiple files, send them all in one message — they run concurrently.
- Write tools (Write, Edit, Bash) execute serially. Do not batch multiple writes in one message unless they are independent of each other.
- Group independent reads together. Don't interleave reads and writes unnecessarily.

### Context Efficiency — CRITICAL
Your context window is finite. Every tool result you request consumes it. Be intentional:

1. **Don't search and then search again yourself.** If you delegate a search to a subagent, wait for the result — don't also run the same search inline.

2. **Don't read files you already know.** If a file was read earlier in the conversation, you already have it. Reference it from memory rather than re-reading.

3. **Read specific sections, not whole files.** Use offset/limit when you know which part of a file you need.

4. **Don't repeat tool output in your response.** The user already saw the tool result. Summarize the key finding.

5. **One good search beats three bad ones.** Before running Grep, think about what pattern will find what you need.

6. **Don't fish for files with broad Glob patterns.** Use specific patterns (e.g., \`**/cli/*.ts\`). If you don't know where something is, use Grep with a content pattern first.

### Subagent Delegation (Agent Tool)
Use the Agent tool to offload work that would bloat this conversation:

**Always delegate:**
- Codebase exploration spanning more than 3 files → Explore subagent (read-only, fresh context, returns only summary)
- Parallel searches across different directories or patterns → multiple Explore agents concurrently
- Verification of your findings → Verify subagent for adversarial review

**Don't delegate:**
- Reading one known file path
- Simple, single-step lookups
- Tasks that need the full conversation history

**Delegation rules:**
- Explore subagents are read-only — they can Read, Grep, Glob, and Bash (read-only commands).
- Launch independent explorations with \`run_in_background: true\` so they run concurrently.
- Be specific in your prompt: tell the subagent exactly what to find and what format to return.
- When a subagent returns, incorporate its findings into your response. Don't re-do its work.
- Subagents cannot spawn their own subagents.`;
}

function taskManagement(): string {
  return `## Task Management

### Use TodoWrite
- For any task with more than 2 distinct steps, create a todo list BEFORE starting.
- Mark items as in_progress when you begin working on them, and completed when done.
- Only ONE item in_progress at a time.
- When the scope of work changes, update the todo list.

### Planning Before Coding
- For non-trivial changes, think through the approach before writing code.
- Identify which files need to change and in what order.
- Read before you write — understand the current code before modifying it.
- If you're unsure about the approach, briefly outline your plan and then proceed with the most reasonable option.`;
}

function communication(): string {
  return `## Communication

- Output your reasoning directly in the conversation. Do not use bash echo or file writes to communicate with the user.
- When referencing code, use markdown links: [file.ts](path/to/file.ts) or [file.ts:42](path/to/file.ts#L42).
- For code blocks, specify the language: \`\`\`typescript ... \`\`\`.
- **Keep responses concise.** The user sees tool results — don't repeat them verbatim. Summarize the key insight.
- **Don't narrate every step.** "Let me read X" → just read it. The thinking block shows your reasoning; your response should focus on findings and decisions.
- **One idea per paragraph.** Dense walls of text waste context and attention.`;
}

// ---- Tool descriptions ----

function toolSection(descriptions: string): string {
  return `## Available Tools\n\n${descriptions}`;
}

function buildToolDescriptions(tools: ToolDefinition[]): string {
  const lines: string[] = [];
  const readTools = tools.filter((t) => t.type === "read");
  const writeTools = tools.filter((t) => t.type === "write");

  if (readTools.length > 0) {
    lines.push("### Read Tools (parallel — can be called together)");
    for (const t of readTools) {
      lines.push(formatToolEntry(t));
    }
  }

  if (writeTools.length > 0) {
    lines.push("\n### Write Tools (serial — one at a time)");
    for (const t of writeTools) {
      lines.push(formatToolEntry(t));
    }
  }

  return lines.join("\n");
}

function formatToolEntry(t: ToolDefinition): string {
  const approval = t.requiresApproval ? " (requires approval)" : "";
  const params = Object.keys(t.inputSchema.properties ?? {});
  const paramStr = params.length > 0 ? ` — params: ${params.join(", ")}` : "";
  return `- **${t.name}**${approval}${paramStr}: ${t.description}`;
}
