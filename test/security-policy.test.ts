// PolicyEngine tests — the policy path used by SecurityRuntime.
import { describe, it, expect } from "vitest";
import { PolicyEngine } from "../src/security/policy/engine.js";

const permissions = {
  bash: "auto" as const,
  read: "auto" as const,
  write: "auto" as const,
  edit: "auto" as const,
  web: "auto" as const,
  rules: [],
};

describe("PolicyEngine", () => {
  it("allows safe tools and common commands", () => {
    const engine = new PolicyEngine(permissions);
    expect(engine.check("Read", { file_path: "test.ts" }).allowed).toBe(true);
    expect(engine.check("Bash", { command: "ls -la" }).allowed).toBe(true);
    expect(engine.check("Bash", { command: "npm test" }).allowed).toBe(true);
  });

  it("blocks hard-blacklisted commands", () => {
    const engine = new PolicyEngine(permissions);
    expect(engine.check("Bash", { command: "rm -rf /" }).allowed).toBe(false);
    expect(engine.check("Bash", { command: "mkfs.ext4 /dev/sda" }).allowed).toBe(false);
  });

  it("honors manual and confirm permission modes", () => {
    const manual = new PolicyEngine({ ...permissions, bash: "manual" });
    expect(manual.check("Bash", { command: "python script.py" }).allowed).toBe(false);

    const confirm = new PolicyEngine({ ...permissions, bash: "confirm" });
    const result = confirm.check("Bash", { command: "npm run deploy" });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.mode).toBe("confirm");
  });

  it("supports session allow and deny decisions", () => {
    const engine = new PolicyEngine(permissions);
    engine.allowTool("Bash");
    expect(engine.check("Bash", { command: "anything" }).allowed).toBe(true);
    const denied = new PolicyEngine(permissions);
    denied.denyTool("Bash");
    expect(denied.check("Bash", { command: "ls" }).allowed).toBe(false);
  });
});
