// Soul — personality definition loaded from soul.md
// Priority 5 (highest, before all other context sources)
// Loads from ~/.rubato/soul.md (global) and .agent/soul.md (project)

import fs from "fs";
import path from "path";
import type { ContextSource, ContextBlock, AgentContext } from "../core-types.js";

export class SoulSource implements ContextSource {
  readonly name = "soul";
  readonly priority = 5; // highest priority — personality comes first

  async fetch(_query: string, _ctx: AgentContext): Promise<ContextBlock | null> {
    const parts: string[] = [];

    // 1. Global soul (~/.rubato/soul.md)
    const globalSoul = this.loadSoul(globalSoulPath());
    if (globalSoul) {
      parts.push(globalSoul);
    }

    // 2. Project-local soul (.agent/soul.md)
    const localSoul = this.loadSoul(localSoulPath(_ctx.workingDir));
    if (localSoul) {
      parts.push("## Project-Specific Personality", localSoul);
    }

    if (parts.length === 0) {
      // No soul files found — return the default built-in soul
      return {
        content: defaultSoul(),
        priority: this.priority,
        source: this.name,
      };
    }

    return {
      content: parts.join("\n\n"),
      priority: this.priority,
      source: this.name,
    };
  }

  private loadSoul(filePath: string): string | null {
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf-8").trim();
        if (content) return content;
      }
    } catch {
      // Permission errors, etc.
    }
    return null;
  }
}

function globalSoulPath(): string {
  const home = process.env.HOME ?? "/tmp";
  return path.join(home, ".rubato", "soul.md");
}

function localSoulPath(workingDir: string): string {
  return path.join(workingDir, ".agent", "soul.md");
}

/** Default soul when no soul.md files exist — minimal but sufficient */
function defaultSoul(): string {
  return `# Soul

You are **Rubato** — a coding agent named after the musical term for expressive, elastic tempo. You adapt your pace to the user: slowing down to ask questions, speeding up when the path is clear.

## Core Traits
- Patient and supportive, especially with beginners.
- Direct and understated. No flattery, no exclamation marks.
- Proactive but not pushy. Mention related issues, don't derail.

## Your Rhythm
- **Adagio** — new task: slow down, ask clarifying questions, make a plan.
- **Fermata** — after presenting a plan, STOP and wait for confirmation.
- **Andante** — executing: steady, one task at a time.
- **Allegro** — quick answers: fast, precise, no ceremony.

## Boundaries
- Never commit/push unless explicitly asked.
- Never reveal model providers or tool vendors.
- Git write ops require preview + confirmation.`;
}
