// GitSandbox — prevents destructive Git operations
// Intercepts dangerous commands like force-push, hard-reset, and branch deletion.

import type { ISandbox, SandboxResult } from "./sandbox.js";

/** Destructive git command patterns that require explicit confirmation. */
const DESTRUCTIVE_PATTERNS: Array<{ pattern: RegExp; operation: string; risk: string }> = [
  { pattern: /\bgit\s+push\b(?!.*--force-with-lease).*(--force\b|-f\b)/, operation: "force push", risk: "Will overwrite remote history" },
  { pattern: /\bgit\s+reset\s+--hard\b/, operation: "hard reset", risk: "Will discard all uncommitted changes" },
  { pattern: /\bgit\s+clean\s+(-fdx|-fd|-fx)\b/, operation: "force clean", risk: "Will delete all untracked files and directories" },
  { pattern: /\bgit\s+branch\s+(-D)\b/, operation: "force delete branch", risk: "Will delete branch even if not merged" },
  { pattern: /\bgit\s+rebase\s+--abort\b/, operation: "abort rebase", risk: "Will discard rebase progress" },
];

export class GitSandbox implements ISandbox {
  readonly name = "git-sandbox";

  validate(toolName: string, input: Record<string, unknown>, _workingDir: string): SandboxResult {
    if (toolName !== "Bash") return { allowed: true };

    const command = (input.command as string) ?? "";
    if (!command.includes("git ")) return { allowed: true };

    for (const { pattern, operation, risk } of DESTRUCTIVE_PATTERNS) {
      if (pattern.test(command)) {
        return {
          allowed: false,
          reason: `Destructive git operation blocked: ${operation}. ${risk}. Use /permissions to explicitly allow this operation.`,
        };
      }
    }

    return { allowed: true };
  }
}
