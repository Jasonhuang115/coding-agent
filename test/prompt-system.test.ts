// PromptAssembler tests — the prompt path used by ContextAssembler.
import { describe, it, expect } from "vitest";
import { PromptAssembler, getPromptAssembler, resetPromptAssembler } from "../src/prompt/assembler.js";

const ctx = {
  workingDir: "/test",
  sessionId: "test",
  readGuard: {} as any,
  permissionManager: {} as any,
  config: { model: { provider: "deepseek", model: "deepseek-chat" } } as any,
  planManager: { getPlanSummary: () => "" } as any,
  depth: 0,
};

const tools = [
  { name: "Read", type: "read" as const, isConcurrencySafe: true, description: "Read file", inputSchema: { type: "object", properties: {} } },
  { name: "Write", type: "write" as const, description: "Write file", inputSchema: { type: "object", properties: {} } },
];

describe("PromptAssembler", () => {
  it("assembles the three production prompt layers", () => {
    const layers = new PromptAssembler("deepseek").assemble(ctx, tools);
    expect(layers.static).toBeTruthy();
    expect(layers.capability).toContain("Read");
    expect(layers.dynamic).toBeTruthy();
  });

  it("estimates and checks the assembled prompt budget", () => {
    const assembler = new PromptAssembler("deepseek");
    const estimate = assembler.estimateTokens(ctx, tools);
    expect(estimate.total).toBeGreaterThan(0);
    expect(assembler.checkBudget(ctx, tools).excess).toBeGreaterThanOrEqual(0);
  });

  it("keeps one production singleton", () => {
    resetPromptAssembler();
    const first = getPromptAssembler("deepseek");
    expect(getPromptAssembler()).toBe(first);
  });
});
