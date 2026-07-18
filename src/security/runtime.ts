// Security Runtime — unified entry point for policy evaluation + sandbox enforcement
// Policy says WHAT is allowed; Sandbox enforces HOW it's safely executed.

import { PolicyEngine } from "../permissions/policy.js";
import type { AgentConfig } from "../shared/core-types.js";
import type { SecurityDecision, SecurityVerdict, RiskLevel } from "./sandbox/sandbox.js";
import type { SandboxResult } from "./sandbox/sandbox.js";
import { CompositeSandbox } from "./sandbox/composite.js";
import { FsSandbox } from "./sandbox/fs-sandbox.js";
import { ShellSandbox } from "./sandbox/shell-sandbox.js";
import { NetworkSandbox } from "./sandbox/network-sandbox.js";
import { GitSandbox } from "./sandbox/git-sandbox.js";
import { EnvSandbox } from "./sandbox/env-sandbox.js";

export { EnvSandbox } from "./sandbox/env-sandbox.js";
export type { SecurityDecision, SecurityVerdict, RiskLevel, SandboxResult } from "./sandbox/sandbox.js";
export type { ISandbox } from "./sandbox/sandbox.js";

/**
 * SecurityRuntime combines the PolicyEngine with sandbox enforcement.
 * It's the single entry point for all tool safety checks.
 */
export class SecurityRuntime {
  readonly policyEngine: PolicyEngine;
  readonly sandbox: CompositeSandbox;
  readonly envSandbox: EnvSandbox;

  constructor(permissions: AgentConfig["permissions"]) {
    this.policyEngine = new PolicyEngine(permissions);
    this.envSandbox = new EnvSandbox();
    this.sandbox = new CompositeSandbox([
      new FsSandbox(),
      new ShellSandbox(),
      new NetworkSandbox(),
      new GitSandbox(),
      this.envSandbox,
    ]);
  }

  /**
   * Full security check: policy evaluation + sandbox validation.
   * Returns a SecurityDecision that tells the caller what to do.
   */
  evaluate(toolName: string, input: Record<string, unknown>, workingDir: string): SecurityDecision {
    // 1. Policy check (is this allowed?)
    const policyResult = this.policyEngine.check(toolName, input);

    if (!policyResult.allowed) {
      const mode = "mode" in policyResult ? policyResult.mode : "manual";
      const reason = "reason" in policyResult ? policyResult.reason : "Blocked by policy";

      // Map policy mode to security verdict
      let verdict: SecurityVerdict;
      let risk: RiskLevel;
      if (mode === "manual") {
        verdict = "deny";
        risk = "critical";
      } else {
        verdict = "approval_required";
        risk = "medium";
      }

      return {
        verdict,
        risk,
        reason,
        constraints: {
          workspaceOnly: true,
          timeout: 120_000,
          networkAllowed: false,
          allowedDomains: [],
          filesystemScope: [],
        },
      };
    }

    // 2. Sandbox validation (how to safely execute?)
    const sandboxResult = this.sandbox.validate(toolName, input, workingDir);

    if (!sandboxResult.allowed) {
      return {
        verdict: "deny",
        risk: "high",
        reason: sandboxResult.reason ?? "Blocked by sandbox",
        constraints: {
          workspaceOnly: true,
          timeout: 120_000,
          networkAllowed: false,
          allowedDomains: [],
          filesystemScope: [],
        },
      };
    }

    // 3. Allowed
    return {
      verdict: "allow",
      risk: this.assessRisk(toolName, input),
      reason: "Approved",
      constraints: {
        workspaceOnly: true,
        timeout: toolName === "Bash" ? 600_000 : 120_000,
        networkAllowed: toolName === "WebFetch" || toolName === "WebSearch",
        allowedDomains: [],
        filesystemScope: [],
      },
    };
  }

  /**
   * Quick sandbox-only validation (skip policy, for tools already approved by policy).
   */
  validateSandbox(toolName: string, input: Record<string, unknown>, workingDir: string): SandboxResult {
    return this.sandbox.validate(toolName, input, workingDir);
  }

  /**
   * Get sanitized environment variables for child processes.
   */
  filterEnv(): Record<string, string | undefined> {
    return this.envSandbox.filterEnv();
  }

  // ---- Private ----

  private assessRisk(toolName: string, input: Record<string, unknown>): RiskLevel {
    // High risk: write tools
    if (["Write", "Edit"].includes(toolName)) return "medium";
    // Critical: shell execution
    if (toolName === "Bash") {
      const cmd = (input.command as string) ?? "";
      if (cmd.includes("sudo ")) return "critical";
      if (cmd.includes("rm ") || cmd.includes("mv /")) return "high";
      return "medium";
    }
    // Medium: network
    if (toolName === "WebFetch" || toolName === "WebSearch") return "medium";
    // Low: everything else
    return "low";
  }
}
