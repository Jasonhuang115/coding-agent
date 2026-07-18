// Dynamic Prompt Layer — workspace, git, memory, plan, skills
// Session-scoped. Changes with workspace context. Approx ~600 tokens.

import type { AgentContext } from "../shared/core-types.js";
import { getSkillRegistry } from "../skills/registry.js";

export function buildDynamicPrompt(ctx: AgentContext): string {
  return [
    planGuidance(ctx),
    gitPolicy(),
    environment(ctx),
    skillCatalog(),
  ].filter(Boolean).join("\n\n");
}

function planGuidance(ctx: AgentContext): string {
  const planSummary = ctx.planManager?.getPlanSummary();
  const planSection = planSummary
    ? `\n${planSummary}\n\n**CRITICAL:** You have an active plan. Every response must advance the current goal (\`**← current**\`). If the user's request deviates, warn them using the Grill Me options below.`
    : `\nNo active plan. If the user describes a non-trivial task, ENTER REQUIREMENTS GATHERING MODE immediately (see below).`;

  return `## Grill Me — Plan & Deviation Tracking${planSection}

### REQUIREMENTS GATHERING MODE (no plan exists yet)
When the user asks for any non-trivial task, OR explicitly says "规划"/"plan"/"方案"/"怎么修"/"怎么改", you MUST do this BEFORE writing ANY code:

1. **Stop and ask questions.** Do NOT jump into coding. Load the relevant checklist mentally:
   - Auth tasks: confirm auth method (JWT/Session/OAuth), user storage, password policy, session management, framework, testing
   - Database tasks: confirm DB type, ORM choice, migration strategy, schema design, indexes
   - API tasks: confirm API style (REST/GraphQL), routing, request/response format, auth, CORS
   - Frontend tasks: confirm framework, state management, styling, routing, responsive design
   - General: confirm core goal, scope boundaries, what's explicitly OUT of scope

2. **Ask in batches of 2-3 questions at a time.** Don't overwhelm the user with 10 questions at once. Prioritize critical decisions first.

3. **When enough info is gathered**, present the plan in this format:
   \`\`\`markdown
   # Plan: [Title]
   **Status:** draft | **Progress:** 0/N

   ## Goal
   [One paragraph: what we're building, key decisions made]

   ## Tasks
   - [ ] Task 1
     - [ ] Subtask 1.1
   - [ ] Task 2 (depends: Task 1)
   \`\`\`

4. **🚨 HARD RULE — ALWAYS WAIT FOR CONFIRMATION 🚨**
   After presenting the plan, you MUST explicitly ask the user to confirm.
   **DO NOT write any code, call any tool, or start execution until the user explicitly confirms.**
   This is NON-NEGOTIABLE.

5. **Skip signal:** If the user says "你先按默认方案来", "直接开始吧", or "skip", stop asking and present the plan with defaults. But STILL wait for confirmation.

### GRILL ME — Deviation Tracking (plan exists)
- Before EVERY tool call, check: does this advance the current \`**← current**\` goal?
- If the user asks something unrelated to the active goal, respond with deviation options (pause+handle, note+continue, continue).
- If the user wants to change a completed decision, re-evaluate affected tasks.

### PLAN MODE TRIGGERS
- "规划", "计划", "plan", "/plan", "先想一下", "方案", "怎么修", "怎么改" → enter plan mode regardless of task size.
- Any multi-step task without specific technical details → enter plan mode.

### SAVING THE PLAN
After the user confirms the plan, save it to \`.agent/plans/{branch}.md\` with checkbox markers.`;
}

function gitPolicy(): string {
  return `## Git Policy

- NEVER commit, push, or create a PR unless the user explicitly asks you to.
- You MAY run read-only git commands (status, diff, log, branch) freely to understand repository state.
- You MAY run git add as part of preparing a commit, but only after the user has asked you to commit.
- When committing: use conventional commit messages.
- If you're on the default branch (main/master), create a new branch before committing — ask the user for the branch name.
- Do NOT force-push or run destructive git commands (reset --hard, clean -fd) without explicit user confirmation.`;
}

function environment(ctx: AgentContext): string {
  return `## Environment
- Working directory: ${ctx.workingDir}
- Platform: ${process.platform}
- Shell: ${process.env.SHELL ?? "unknown"}
- OS: ${process.platform === "darwin" ? "macOS" : process.platform === "linux" ? "Linux" : process.platform}
- LLM Provider: ${ctx.config.model.provider} / ${ctx.config.model.model}`;
}

function skillCatalog(): string {
  try {
    const registry = getSkillRegistry();
    const skills = registry.listSkills();
    if (skills.length === 0) return "";

    const lines: string[] = [];
    lines.push("## Available Skills");
    lines.push("Skills are invoked by typing \`/skill-name\` in the REPL (fork mode spawns a subagent, inline mode injects instructions).");
    lines.push("");
    lines.push("| Command | Description | Mode |");
    lines.push("|---------|-------------|------|");
    for (const s of skills) {
      const desc = (s.description ?? "(no description)").slice(0, 60);
      const mode = s.context === "inline" ? "inline" : "fork";
      lines.push(`| \`/${s.name}\` | ${desc} | ${mode} |`);
    }
    return lines.join("\n");
  } catch {
    return "";
  }
}
