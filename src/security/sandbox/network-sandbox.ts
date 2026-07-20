// NetworkSandbox — prevents SSRF and unsafe network requests
// Blocks internal IPs and unsafe URL schemes. DNS resolution is delegated to
// the runtime, so every redirect target must be validated by the caller too.

import type { ISandbox, SandboxResult } from "./sandbox.js";

/** IPv4 prefixes that are private/internal (RFC 1918 + loopback + link-local). */
const PRIVATE_IP_PATTERNS = [
  /^https?:\/\/127\./,
  /^https?:\/\/10\./,
  /^https?:\/\/172\.(1[6-9]|2\d|3[01])\./,
  /^https?:\/\/192\.168\./,
  /^https?:\/\/0\.0\.0\.0/,
  /^https?:\/\/localhost/,
  /^https?:\/\/\[::1\]/,
  /^https?:\/\/169\.254\./,  // link-local
];

/** Blocked URL schemes. */
const BLOCKED_SCHEMES = ["file:", "ftp:", "gopher:", "data:"];

export class NetworkSandbox implements ISandbox {
  readonly name = "network-sandbox";

  validate(toolName: string, input: Record<string, unknown>, _workingDir: string): SandboxResult {
    if (toolName !== "WebFetch") {
      return { allowed: true };
    }

    const url = input.url as string | undefined;
    if (!url) return { allowed: false, reason: "WebFetch requires a URL." };

    const normalized = url.toLowerCase().trim();

    // 1. Block dangerous schemes
    for (const scheme of BLOCKED_SCHEMES) {
      if (normalized.startsWith(scheme)) {
        return { allowed: false, reason: `Blocked URL scheme: "${scheme}". Only https:// is allowed.` };
      }
    }

    // 2. Non-HTTP(S) URLs
    if (!normalized.startsWith("https://") && !normalized.startsWith("http://")) {
      return { allowed: false, reason: `Only https:// URLs are allowed. Got: "${url.slice(0, 60)}"` };
    }

    // 3. Block private IPs (SSRF prevention)
    for (const pattern of PRIVATE_IP_PATTERNS) {
      if (pattern.test(normalized)) {
        return { allowed: false, reason: `Blocked internal/private network URL: "${url.slice(0, 60)}"` };
      }
    }

    return { allowed: true };
  }
}
