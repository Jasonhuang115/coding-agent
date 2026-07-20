// EnvSandbox — filters sensitive environment variables before process spawn
// Prevents API keys and secrets from leaking to child processes.

import type { ISandbox, SandboxResult } from "./sandbox.js";

/** Environment variable names that should be stripped before spawning. */
const SENSITIVE_ENV_PATTERNS = [
  /_API_KEY$/i,
  /_SECRET$/i,
  /_TOKEN$/i,
  /_PASSWORD$/i,
  /_CREDENTIALS$/i,
  /^AWS_/i,
  /^GCLOUD_/i,
  /^GOOGLE_/i,
  /^AZURE_/i,
];

/** Environment variables always preserved (never stripped). */
const PRESERVED_ENV = [
  "PATH", "HOME", "USER", "SHELL", "PWD",
  "LANG", "LC_ALL", "TZ",
  "NODE_ENV", "NODE_PATH",
  "TERM", "EDITOR",
  "DISPLAY", "WAYLAND_DISPLAY",
  "XDG_SESSION_TYPE", "XDG_CURRENT_DESKTOP",
  "DBUS_SESSION_BUS_ADDRESS",
  "SSH_AUTH_SOCK", "SSH_AGENT_PID",
  "COLORTERM", "NO_COLOR", "FORCE_COLOR",
  "DEBUG", "NODE_OPTIONS", "TS_NODE_PROJECT",
];

export class EnvSandbox implements ISandbox {
  readonly name = "env-sandbox";

  validate(_toolName: string, _input: Record<string, unknown>, _workingDir: string): SandboxResult {
    // EnvSandbox doesn't block; it provides filtered env.
    // The actual filtering happens in filterEnv() called by Bash tool.
    return { allowed: true };
  }

  /**
   * Return a sanitized copy of process.env with sensitive keys removed.
   * Called by the Bash tool before spawning child processes.
   */
  filterEnv(): Record<string, string | undefined> {
    const filtered: Record<string, string | undefined> = {};

    for (const [key, value] of Object.entries(process.env)) {
      if (PRESERVED_ENV.includes(key)) {
        filtered[key] = value;
        continue;
      }

      const isSensitive = SENSITIVE_ENV_PATTERNS.some((pattern) => pattern.test(key));
      if (!isSensitive) {
        filtered[key] = value;
      }
      // Sensitive keys are silently omitted
    }

    return filtered;
  }
}
